// 阶段 3 · 通知适配器(任务 3.6, §5.3): 钉钉群机器人 webhook + 定时任务
// 依赖注入式: createNotify(deps) —— deps = {
//   getSetting(k), setSetting(k, v),   // settings 表原始字符串读写(幂等标记)
//   post(url, payload),                // 底层 HTTP 发送(默认 spawn curl, 测试注入替身)
//   listReviews(),                     // 在途单据列表(周一汇总/周四加推数据源)
//   reportLink(id),                    // 单据链接(任务链接)
//   phonesOf(dept),                    // 部门手机号(@提醒)
//   now()                              // 时钟注入(N-03 幂等测试)
//   allow(event, channel)              // V4.0-T10 通知矩阵开关(缺省全放行)
//   resolveUrl(channel)                // V4.0-T10 发送目标 {source,url,secret}(缺省读 config.json)
// }
// 铁律(N-02): 通知失败重试 1 次后 console.error, 永不阻断主流程; webhook 未配置静默跳过
// 8 触发点(§5.3): 提交分派/部门退回/红灯打回/研判完成/绿灯发布(委员会群)/周一汇总/周四加推/结论归档
//   —— 前 5+归档由 server.js 各端点调 send(), 周一/周四由 startScheduler() 定时触发
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 默认底层发送: spawn curl POST(公司防火墙会重置 Node 原生 TLS 指纹, 与 LLM 通道同由)
function postViaCurl(url, payload) {
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const cp = spawn('curl', ['-s', '-X', 'POST', url,
      '-H', 'Content-Type: application/json', '--data-binary', '@-', '--max-time', '5'], { windowsHide: true });
    let out = '', err = '';
    cp.stdout.on('data', d => out += d);
    cp.stderr.on('data', d => err += d);
    cp.on('error', reject);
    cp.on('close', code => code === 0 ? resolve(out) : reject(new Error('请求失败:' + err.slice(0, 100))));
    cp.stdin.on('error', () => {}); // 审查整改#4: EPIPE 吞掉(webhook 快速断开时), 由 close 的 reject 兜底, 防进程级崩溃
    cp.stdin.write(body);
    cp.stdin.end();
  });
}

function createNotify(deps) {
  const d = deps || {};
  const getSetting = d.getSetting || (() => undefined);
  const setSetting = d.setSetting || (() => {});
  const post = d.post || postViaCurl;
  const listReviews = d.listReviews || (() => []);
  const reportLink = d.reportLink || (id => '#' + id);
  const phonesOf = d.phonesOf || (() => []);
  const now = d.now || (() => new Date());

  // webhook 地址: 每次发送时读 config.json(与 LLM_* 同居, 改写即时生效; 未配置返回空 -> 静默跳过)
  const cfgUrl = key => {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
      return String(cfg[key] || '');
    } catch (e) { return ''; }
  };

  // V4.0-T10: allow(event, channel) = 通知矩阵开关(server 注入); resolveUrl(channel) = 发送目标(DB 真源优先, config 回落)
  //   缺省: 全放行 + 只读 config.json(与 T10 前行为逐字等价, N-03 不注入亦不受影响)
  const allow = d.allow || (() => true);
  const resolveUrl = d.resolveUrl || (channel => {
    const name = channel === 'committee' ? 'COMMITTEE_WEBHOOK_URL' : 'NOTIFY_WEBHOOK_URL';
    return { source: 'config', name, url: cfgUrl(name), secret: '' };
  });

  // 钉钉加签: url 追加 timestamp + sign = urlencode(base64(HmacSHA256(secret, ts+"\n"+secret)))
  const signedUrl = (url, secret) => {
    if (!secret) return url;
    const ts = String(Date.now());
    const sign = crypto.createHmac('sha256', secret).update(ts + '\n' + secret).digest('base64');
    return url + (url.includes('?') ? '&' : '?') + 'timestamp=' + ts + '&sign=' + encodeURIComponent(sign);
  };

  // 投递: 首次 + 重试 1 次, 失败 console.error 不 throw(N-02)
  async function deliver(t, payload) {
    for (let i = 0; i < 2; i++) {
      try { await post(signedUrl(t.url, t.secret), payload); return true; }
      catch (e) {
        if (i === 0) continue;
        console.error('[notify:' + (t.source || 'config') + '] 发送失败(已重试 1 次, 不阻断主流程):' + e.message);
        return false;
      }
    }
    return false;
  }

  // 发送 markdown 到群: channel='notify'(通知群)/'committee'(评审委员会群)
  //   opts.event 交矩阵判定(唯一判定处: 六个业务点 + 周报/加推都经此函数); @手机号拼在 text 头部(N-01)
  async function send(channel, md, opts) {
    const o = opts || {};
    let ok = true;
    try { ok = allow(o.event, channel) !== false; } catch (e) { ok = true; } // 矩阵异常 fail-open
    if (!ok) return false;
    let t = {};
    try { t = resolveUrl(channel) || {}; } catch (e) { t = {}; }
    if (!t.url) return false; // 未配置静默跳过(服务无 webhook 也能跑)
    const phones = (o.phones || []).filter(Boolean);
    const text = (phones.length ? '@' + phones.join(' @') + '\n' : '') + md;
    const payload = { msgtype: 'markdown', markdown: { title: o.title || '评审平台通知', text } };
    return deliver(t, payload);
  }

  // 管理端连通性探针: 单次直发不重试, 钉钉 errcode!=0 视为失败; 恒返回 {ok, ms, error}
  async function probe(t, md, title) {
    const t0 = Date.now();
    try {
      const out = await post(signedUrl(t.url, t.secret), { msgtype: 'markdown', markdown: { title: title || '机器人连通性测试', text: md } });
      let j = null;
      try { j = JSON.parse(String(out || '')); } catch (e) {}
      if (j && j.errcode !== undefined && Number(j.errcode) !== 0) return { ok: false, ms: Date.now() - t0, error: '钉钉返回 errcode=' + j.errcode + ' ' + String(j.errmsg || '').slice(0, 100) };
      return { ok: true, ms: Date.now() - t0 };
    } catch (e) { return { ok: false, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) }; }
  }

  // 本周一 ISO 日期(yyyy-mm-dd)
  const mondayOf = dt => {
    const x = new Date(dt);
    x.setDate(x.getDate() - (x.getDay() + 6) % 7);
    return x.toISOString().slice(0, 10);
  };
  const thursdayOf = dt => {
    const x = new Date(mondayOf(dt));
    x.setDate(x.getDate() + 3);
    return x.toISOString().slice(0, 10);
  };

  // 周一>=9 点周报(幂等: settings.last_weekly_sent 存本周一 ISO, 同周只发一次, N-03)
  async function weeklyDigest() {
    const t = now();
    if (t.getDay() !== 1 || t.getHours() < 9) return false;
    const wk = mondayOf(t);
    if (getSetting('last_weekly_sent') === wk) return false;
    const rows = listReviews();
    const reviewing = rows.filter(r => r.status === 'reviewing');
    const judged = rows.filter(r => r.status === 'judged');
    const reds = rows.filter(r => r.light === 'red');
    const md = `### 评审周报(${wk})\n在途评审 **${reviewing.length}** 单,已研判 **${judged.length}** 单,红灯 **${reds.length}** 单。\n` +
      (reviewing.slice(0, 10).map(r => `- ${r.title}(第${r.round || '?'}轮,${r.light ? '灯:' + r.light : '待研判'}) [查看](${reportLink(r.id)})`).join('\n') || '本周无在途单。');
    const ok = await send('notify', md, { title: '评审周报', event: 'weekly' });
    setSetting('last_weekly_sent', wk); // 无论发送成败都记幂等(未配置/失败不重发, 由重试逻辑兜底)
    return ok;
  }

  // 周四>=9 点 XO 待上会加推(幂等: last_xo_push 存本周四 ISO)
  async function xoPush() {
    const t = now();
    if (t.getDay() !== 4 || t.getHours() < 9) return false;
    const th = thursdayOf(t);
    if (getSetting('last_xo_push') === th) return false;
    const rows = listReviews();
    const xo = rows.filter(r => (r.route || '').includes('XO') && r.status === 'judged');
    const md = `### XO 级评审会待上会加推(${th})\n` +
      (xo.length ? xo.map(r => `- ${r.title}(${r.light}灯,${r.route}) [查看](${reportLink(r.id)})`).join('\n')
        : '当前无待上会 XO 级单据。');
    const ok = await send('notify', md, { title: 'XO 待上会加推', event: 'xo_push' });
    setSetting('last_xo_push', th);
    return ok;
  }

  // 定时器: 每分钟检查(启动即查一次, 补发漏发的周一/周四); 返回 interval 便于测试清理
  function startScheduler(intervalMs) {
    const tick = async () => {
      try { await weeklyDigest(); } catch (e) { console.error('[notify] 周报调度异常:' + e.message); }
      try { await xoPush(); } catch (e) { console.error('[notify] 加推调度异常:' + e.message); }
    };
    tick();
    return setInterval(tick, intervalMs || 60000);
  }

  return { send, probe, weeklyDigest, xoPush, startScheduler };
}

module.exports = { createNotify };
