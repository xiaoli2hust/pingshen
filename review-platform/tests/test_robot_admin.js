// V4.0-T10 机器人管理中心用例: RB-01~RB-11(admin 门禁/secret 掩码/webhook 参数位面/通知矩阵开关/六事件实名命中/真源优先级只发一次/N-02/白名单 scope/门禁不豁免/迁移幂等)
// 红基线: 旧代码无 /api/admin/robot/* 端点、无三表、发送不读矩阵 -> RB-01/02/03/04/05/06/07/09/11 必 FAIL; RB-08/RB-10 为回归防护(旧代码即绿)
// 用法: node tests/test_robot_admin.js [--log=tests/_t10_post_robot.txt]  (需服务运行于 8600)
// 9803 桩: 记录每次出站的 path + markdown.title + text; 按本轮唯一单据标题过滤, 不受并行会话的通知串扰
// config.json: 两个 webhook 键全程指向桩的 /cfg-* 路径(杜绝真群出站), finally 按原始字节复位(与 SN 同口径)
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const CFG = path.join(__dirname, '..', 'config.json');
const SRV = path.join(__dirname, '..', 'server.js');
const STUB_PORT = 9803;
const STUB = 'http://127.0.0.1:' + STUB_PORT;
const S = String(Date.now()).slice(-7);
const TITLE = { task_dispatch: '评审任务分发', judged: '研判完成', red_reject: '红灯自动打回', green_publish: '评审结论发布', archived: '评审归档', returned: '评审退回' };
const ROUTE = { red_reject: ['applicant', 'notify'], judged: ['applicant', 'notify'], task_dispatch: ['dept', 'notify'], green_publish: ['committee', 'committee'], archived: ['sales_group', 'notify'], returned: ['applicant', 'notify'] };

// ---------- 桩 ----------
const hits = [];
let stub = null;
const stubUp = () => new Promise(r => {
  stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch (e) {}
      const md = j.markdown || {};
      hits.push({ path: req.url.split('?')[0], query: req.url.split('?')[1] || '', title: md.title || '', text: md.text || '' });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"errcode":0,"errmsg":"ok"}');
    });
  });
  stub.listen(STUB_PORT, '127.0.0.1', r);
});
const stubDown = () => new Promise(r => { if (!stub) return r(); stub.close(() => r()); stub.closeAllConnections && stub.closeAllConnections(); stub = null; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 本轮某单据(按唯一标题)收到的某事件请求
const got = (rt, ev) => hits.filter(h => h.title === TITLE[ev] && h.text.includes(rt));
const OFFLINE = process.env.RP_OFFLINE === '1';
const settle = async actions => {
  if (!OFFLINE) return sleep(1500);
  if (!Array.isArray(actions) || !actions.length) throw new Error('离线观察缺少已登记请求');
  await Promise.all([...new Set(actions)].map(async action => {
    if (!/^[0-9a-f-]{36}$/.test(action || '')) throw new Error('离线请求缺少屏障标识');
    const r = await fetch(B + '/__rp_offline/barrier?action=' + encodeURIComponent(action) + '&timeout_ms=15000',
      { method: 'POST', signal: AbortSignal.timeout(20000) });
    const state = await r.json();
    if (r.status !== 200 || state.ok !== true || state.action !== action || state.handler_done !== true ||
        state.response_done !== true || state.pending_sends !== 0 || state.pending_children !== 0)
      throw new Error('离线投递屏障失败: ' + r.status + ' ' + (state.error || '非 idle'));
  }));
};
const waitGot = async (rt, ev, actions, ms = 4000) => {
  if (OFFLINE) await settle(actions);
  else for (let i = 0; i < ms / 100 && !got(rt, ev).length; i++) await sleep(100);
  return got(rt, ev);
};

async function raw(token, reqPath, method, body, extra) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(extra || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text, action: r.headers.get('X-RP-Offline-Action') };
}
const login = async u => (await raw(null, '/api/login', 'POST', { username: u, password: '123456' })).data.token;
const ROBOT = { 'X-Via-Robot': '1' };

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

// ---------- 业务夹具(同 SN/CH 口径) ----------
const GREEN_BUDGET = { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, project_name: 'RB 基线预算', customer: 'RB 客户' };
const BID_BASE = {
  opp_code: 'PL-T-RB', opp_stage: '投标决策', region: '华北营销处-渠道', customer: 'RB 客户', biz_line: 'G1',
  contract_amount: '24', sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15', cost_happened: '0',
  ops_years: '1', sign_path: '客户公司→丰图科技(深圳)有限公司', sub_amount: '0', designated_sub_amount: '0',
  survey_sub_amount: '0', sub_core: '否', survey: '否', jiadao: '否', secret: '否', province: '江西省',
  product_type: '标品', promo_target: '无', promo_amount: '0', settle_method: '银行转账',
  payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: 'RB 用例', data_review: '是', data_plan: '公开POI数据', data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};
let T = {};
const makeLockedBudget = async name => {
  const id = (await raw(T.sales, '/api/budget', 'POST', { project_name: name })).data.id;
  await raw(T.sales, `/api/budget/${id}`, 'PUT', { fields: GREEN_BUDGET });
  await raw(T.sales, `/api/budget/${id}/delivery`, 'PUT', { rows: [{ content: 'RB 明细', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
  await raw(T.sales, `/api/budget/${id}/lock`, 'POST');
  return id;
};
let seq = 0;
// 本轮真实创建的 review_id: 夹具的 opp_code 恒为 'PL-T-RB'(所有 RB 轮次共用一个商机),
// 所以清理只能按「本轮自己的 review_id 集」而不是前缀, 否则会误删历史轮/他人行
const myReviewIds = [];
// 建单 -> 提交(触发 task_dispatch); 返回 {rid, rt(唯一标题), st(提交响应)}
const submitted = async (tag, headers) => {
  const rt = `[T]RB-${tag}-${S}-${++seq}`;
  const bg = await makeLockedBudget('RB 预算 ' + rt);
  const rid = (await raw(T.sales, '/api/reviews', 'POST', { type: 'bid', title: rt, form: { ...BID_BASE }, submit: false, budget_id: bg })).data.id;
  myReviewIds.push(rid);
  const t0 = Date.now();
  const st = await raw(T.sales, `/api/reviews/${rid}/submit`, 'POST', undefined, headers);
  return { rid, rt, st, ms: Date.now() - t0, actions: [st.action] };
};
const tasksOf = async rid => ((await raw(T.zcz, '/api/tasks?scope=all')).data.tasks || []).filter(t => t.review_id === rid && t.status === 'pending');
const completeAll = async (rid, firstLight, actions) => {
  const ts = await tasksOf(rid);
  for (let i = 0; i < ts.length; i++) {
    const light = i === 0 && firstLight ? firstLight : 'green';
    const r = await raw(T.zcz, `/api/tasks/${ts[i].id}/complete`, 'POST', { light, opinion: light === 'green' ? '' : 'RB 红灯意见' });
    if (actions) actions.push(r.action);
  }
};
const statusOf = async rid => ((await raw(T.sales, '/api/reviews/' + rid)).data.review || {}).status;
// 三条流程覆盖六个真实事件点
const flowGreen = async tag => {
  const f = await submitted(tag); await completeAll(f.rid, undefined, f.actions);
  const decision = await raw(T.admin, `/api/reviews/${f.rid}/decision`, 'POST', { decision_result: '同意', decision_note: 'RB' });
  const archive = await raw(T.admin, `/api/reviews/${f.rid}/archive`, 'POST');
  f.actions.push(decision.action, archive.action); return f;
};
const flowRed = async tag => { const f = await submitted(tag); await completeAll(f.rid, 'red', f.actions); return f; };
const flowReturn = async tag => {
  const f = await submitted(tag); const ts = await tasksOf(f.rid);
  if (ts[0]) { const r = await raw(T.zcz, `/api/tasks/${ts[0].id}/return`, 'POST', { opinion: 'RB 退回' }); f.actions.push(r.action); }
  return f;
};
const EV_FLOW = { task_dispatch: 'G', judged: 'G', green_publish: 'G', archived: 'G', red_reject: 'R', returned: 'X' };

// ---------- 管理端点 ----------
const A = {
  list: () => raw(T.admin, '/api/admin/robot/instances'),
  add: b => raw(T.admin, '/api/admin/robot/instances', 'POST', b),
  put: (id, b) => raw(T.admin, '/api/admin/robot/instances/' + id, 'PUT', b),
  del: id => raw(T.admin, '/api/admin/robot/instances/' + id, 'DELETE'),
  test: id => raw(T.admin, '/api/admin/robot/test', 'POST', { id }),
  matrix: () => raw(T.admin, '/api/admin/robot/matrix'),
  mset: (event, enabled) => raw(T.admin, '/api/admin/robot/matrix', 'PUT', { event, target: ROUTE[event][0], channel: ROUTE[event][1], enabled }),
  mdel: event => raw(T.admin, '/api/admin/robot/matrix?event=' + encodeURIComponent(event), 'DELETE'),
  wl: () => raw(T.admin, '/api/admin/robot/whitelist'),
  wadd: b => raw(T.admin, '/api/admin/robot/whitelist', 'POST', b),
  wdel: id => raw(T.admin, '/api/admin/robot/whitelist/' + id, 'DELETE'),
  imp: () => raw(T.admin, '/api/admin/robot/import-config', 'POST', {})
};

// ---------- 仅用于快照/复位的直连(表不存在 = 旧代码, 静默跳过) ----------
const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
db.exec('PRAGMA busy_timeout = 5000');
const tryAll = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return null; } };
const tryRun = (sql, ...a) => { try { return db.prepare(sql).run(...a); } catch (e) { return null; } };
const cnt = t => { const r = tryAll(`SELECT COUNT(*) c FROM ${t}`); return r ? r[0].c : -1; };

(async () => {
  const cfgRaw = fs.readFileSync(CFG, 'utf8');
  const cfgBefore = JSON.parse(cfgRaw);
  const writeCfg = kv => fs.writeFileSync(CFG, JSON.stringify(Object.assign(JSON.parse(cfgRaw), kv), null, 2), 'utf8');
  const matrixSnap = tryAll('SELECT event,target,channel,enabled FROM notify_matrix') || [];
  const enabledSnap = (tryAll('SELECT id FROM robot_instances WHERE enabled=1') || []).map(r => r.id);
  const wlSnap = (tryAll('SELECT id FROM robot_whitelist') || []).map(r => r.id);
  const myRobots = [];
  const SECRETS = [];
  const bodies = []; // 管理端点全部响应体(RB-02 全量 grep)
  await stubUp();
  try {
    const adminUser = db.prepare("SELECT username FROM users WHERE role='admin' LIMIT 1").get();
    if (!adminUser) throw new Error('库内无 role=admin 用户');
    T.admin = await login(adminUser.username);
    T.sales = await login('sales1');
    T.zcz = await login('zhichizu');
    const salesId = ((await raw(T.sales, '/api/me')).data.user || {}).id;
    if (!salesId) throw new Error('/api/me 未返回 sales1 的 user.id');
    writeCfg({ NOTIFY_WEBHOOK_URL: STUB + '/cfg-notify', COMMITTEE_WEBHOOK_URL: STUB + '/cfg-committee' });
    tryRun('UPDATE robot_instances SET enabled=0 WHERE enabled=1');
    tryRun('DELETE FROM notify_matrix');
    const mk = async (tag, ch, url, extra) => {
      const r = await A.add({ name: `[T]RB-${tag}-${S}`, webhook: url, channel: ch, env: 'sit', enabled: 1, ...(extra || {}) });
      bodies.push(r.text);
      if (r.data.id) myRobots.push(r.data.id);
      return r;
    };

    // ---------- RB-01 非 admin 一律 403 ----------
    {
      const EP = [['GET', '/api/admin/robot/instances'], ['POST', '/api/admin/robot/instances'], ['PUT', '/api/admin/robot/instances/1'], ['DELETE', '/api/admin/robot/instances/1'],
        ['POST', '/api/admin/robot/test'], ['GET', '/api/admin/robot/matrix'], ['PUT', '/api/admin/robot/matrix'], ['DELETE', '/api/admin/robot/matrix?event=judged'],
        ['GET', '/api/admin/robot/whitelist'], ['POST', '/api/admin/robot/whitelist'], ['DELETE', '/api/admin/robot/whitelist/1'], ['POST', '/api/admin/robot/import-config']];
      for (const [who, tk] of [['sales1', T.sales], ['zhichizu', T.zcz]]) {
        const rs = [];
        for (const [m, u] of EP) rs.push(await raw(tk, u, m, m === 'GET' || m === 'DELETE' ? undefined : { name: 'x', webhook: 'http://127.0.0.1:9', id: 1 }));
        check('RB-01', `${who} 对 12 个机器人管理端点一律 403 且文案前缀「仅 admin」`, rs.every(r => r.status === 403 && /^仅 admin/.test(r.data.error || '')),
          rs.map(r => r.status).join(','));
      }
    }

    // ---------- RB-03 webhook 参数位面四拒 ----------
    {
      const bad = [['空值', ''], ['- 开头', '-K/etc/passwd'], ['非法 URL', 'not a url'], ['ftp 协议', 'ftp://127.0.0.1/x']];
      const rs = [];
      for (const [, u] of bad) rs.push(await A.add({ name: `[T]RB-03-${S}-${rs.length}`, webhook: u, channel: 'notify' }));
      rs.forEach(r => { bodies.push(r.text); if (r.data.id) myRobots.push(r.data.id); });
      const msgs = rs.map(r => r.data.error || '');
      check('RB-03', '四类非法 webhook 各 400', rs.every(r => r.status === 400), rs.map(r => r.status).join(','));
      check('RB-03', '四条拒绝文案两两可区分', new Set(msgs).size === 4 && msgs.every(Boolean), msgs.join(' / '));
      check('RB-03', '「-」开头文案点名 curl 选项解析', /-/.test(msgs[1]) && /curl/.test(msgs[1]));
      const ok = await mk('03ok', 'notify', STUB + '/ok03', { enabled: 0 });
      const pr = ok.data.id ? await A.put(ok.data.id, { webhook: '-o x' }) : { status: 0, data: {} };
      bodies.push(pr.text || '');
      check('RB-03', 'PUT 同样过参数位面校验(400)', pr.status === 400 && /-/.test(pr.data.error || ''), pr.status + ':' + (pr.data.error || ''));
    }

    // ---------- RB-02 secret 只写不回显 ----------
    {
      const sec = 'SECrb02' + S + 'zzQQ9876';
      SECRETS.push(sec);
      const c = await mk('02', 'notify', STUB + '/sec02?access_token=TOKrb02' + S + 'abcd', { secret: sec, enabled: 0 });
      check('RB-02', '带 secret 建实例 200', c.status === 200 && !!c.data.id, c.status + ':' + (c.data.error || ''));
      const g = await A.list(); bodies.push(g.text);
      const mine = (g.data.instances || []).find(x => x.id === c.data.id) || {};
      check('RB-02', 'GET 列表只回 **** 掩码, 不含 secret 明文', !!mine.id && !g.text.includes(sec) && /\*\*\*\*/.test(String(mine.secret_masked || '')), 'secret_masked=' + mine.secret_masked);
      const u = c.data.id ? await A.put(c.data.id, { env: 'prod' }) : { text: '' }; bodies.push(u.text || '');
      const t = c.data.id ? await A.test(c.data.id) : { text: '' }; bodies.push(t.text || '');
      check('RB-02', 'PUT 不带 secret 不清空原值(仍 has_secret)', ((await A.list()).data.instances || []).some(x => x.id === c.data.id && x.has_secret === true));
      const hitSign = hits.filter(h => h.path === '/sec02').pop();
      check('RB-02', '探活出站带钉钉加签参数 timestamp+sign(secret 真正参与发送)', !!hitSign && /timestamp=\d+/.test(hitSign.query) && /sign=/.test(hitSign.query), hitSign ? hitSign.query.replace(/sign=[^&]+/, 'sign=…') : '未收到');
    }

    // ---------- RB-07 真源优先级 + 只发一次 ----------
    {
      const rn = await mk('07n', 'notify', STUB + '/db-notify');
      const rc = await mk('07c', 'committee', STUB + '/db-committee');
      const g = await A.list(); bodies.push(g.text);
      check('RB-07', 'DB 有 enabled 实例时 active.notify.source=db', ((g.data.active || {}).notify || {}).source === 'db', JSON.stringify(g.data.active || {}));
      const f1 = await submitted('07a');
      const h1 = await waitGot(f1.rt, 'task_dispatch', f1.actions); await settle(f1.actions);
      const h1b = got(f1.rt, 'task_dispatch');
      check('RB-07', 'DB 优先: 桩只在 /db-notify 收到且恰 1 次(config 侧未双推)', h1b.length === 1 && h1b[0].path === '/db-notify', h1b.map(h => h.path).join(',') || '0 次');
      const outbox1 = tryAll("SELECT idempotency_key,target_key FROM robot_outbox WHERE review_id=? AND event='task_dispatch'", f1.rid);
      check('RB-07b', '新外发箱入箱后既有 notify webhook 仍恰一次，不因 outbox 双发',
        Array.isArray(outbox1) && outbox1.length > 0 && new Set(outbox1.map(r => r.idempotency_key)).size === outbox1.length && h1b.length === 1,
        'outbox=' + (outbox1 ? outbox1.length : '表不存在') + ' webhook=' + h1b.length);
      const tc = rc.data.id ? await A.test(rc.data.id) : { data: {}, text: '' }; bodies.push(tc.text || '');
      check('RB-07', '探活响应标注 source=db 且 ok', tc.data.ok === true && tc.data.source === 'db', JSON.stringify(tc.data));
      for (const id of [rn.data.id, rc.data.id]) if (id) bodies.push((await A.del(id)).text);
      const g2 = await A.list(); bodies.push(g2.text);
      check('RB-07', '删除后回落 config: active.notify.source=config', ((g2.data.active || {}).notify || {}).source === 'config', JSON.stringify(g2.data.active || {}));
      check('RB-07', 'config 两键只读展示且掩码(不回原值全文)', typeof (g2.data.config || {}).NOTIFY_WEBHOOK_URL === 'string' && !!(g2.data.config || {}).NOTIFY_WEBHOOK_URL);
      const f2 = await submitted('07b');
      await waitGot(f2.rt, 'task_dispatch', f2.actions); await settle(f2.actions);
      const h2 = got(f2.rt, 'task_dispatch');
      check('RB-07', '回落后桩只在 /cfg-notify 收到且恰 1 次', h2.length === 1 && h2[0].path === '/cfg-notify', h2.map(h => h.path).join(',') || '0 次');
    }

    // 以下用例统一走 DB 实例(notify + committee 各一)
    const rn = await mk('N', 'notify', STUB + '/db-notify');
    const rc = await mk('C', 'committee', STUB + '/db-committee');

    // ---------- RB-04 enabled=0 不出站, 改回 1 立即恢复 ----------
    {
      const off = await A.mset('task_dispatch', 0);
      check('RB-04', '矩阵 PUT task_dispatch enabled=0 → 200', off.status === 200, off.status + ':' + (off.data.error || ''));
      const f1 = await submitted('04off'); await settle(f1.actions);
      check('RB-04', 'enabled=0: 提交仍 200 但桩 0 次', f1.st.status === 200 && got(f1.rt, 'task_dispatch').length === 0, 'submit=' + f1.st.status + ' hits=' + got(f1.rt, 'task_dispatch').length);
      const on = await A.mset('task_dispatch', 1);
      const f2 = await submitted('04on');
      const h = await waitGot(f2.rt, 'task_dispatch', f2.actions);
      check('RB-04', '改回 enabled=1 后立即恢复(1 次)', on.status === 200 && h.length === 1, 'hits=' + h.length);
      const bad = await raw(T.admin, '/api/admin/robot/matrix', 'PUT', { event: 'judged_x', target: 'applicant', channel: 'notify', enabled: 0 });
      const bad2 = await raw(T.admin, '/api/admin/robot/matrix', 'PUT', { event: 'judged', target: 'committee', channel: 'notify', enabled: 0 });
      check('RB-04', '矩阵拒绝新造事件名与错配接收人(400, 防死行)', bad.status === 400 && bad2.status === 400, bad.status + '/' + bad2.status);
    }

    // ---------- RB-05 矩阵无该行 => 默认放行 ----------
    {
      const d = await A.mdel('task_dispatch');
      const m = await A.matrix();
      const row = (m.data.events || []).find(e => e.event === 'task_dispatch') || {};
      check('RB-05', '删行后矩阵视图标注未配置(configured=false)且仍放行(enabled=1)', d.status === 200 && row.configured === false && row.enabled === 1, JSON.stringify(row));
      check('RB-05', '矩阵视图列出 8 个实名事件(与调用点一致, 无第九名)', JSON.stringify((m.data.events || []).map(e => e.event).sort()) === JSON.stringify(['archived', 'green_publish', 'judged', 'red_reject', 'returned', 'task_dispatch', 'weekly', 'xo_push']));
      const f = await submitted('05');
      const h = await waitGot(f.rt, 'task_dispatch', f.actions);
      check('RB-05', '无行事件照常出站到 DB 实例(1 次)', h.length === 1 && h[0].path === '/db-notify', h.map(x => x.path).join(',') || '0 次');
    }

    // ---------- RB-06 六个真实事件逐一被矩阵命中(三组: 全开 / 关 A 组 / 关 B 组) ----------
    {
      const EVS = Object.keys(TITLE);
      const runAll = async tag => ({ G: await flowGreen(tag + 'G'), R: await flowRed(tag + 'R'), X: await flowReturn(tag + 'X') });
      const observe = async (fl, on) => {
        if (!OFFLINE) for (const ev of on) await waitGot(fl[EV_FLOW[ev]].rt, ev);
        await settle(Object.values(fl).flatMap(f => f.actions));
        const o = {};
        for (const ev of EVS) o[ev] = got(fl[EV_FLOW[ev]].rt, ev).length;
        return o;
      };
      for (const ev of EVS) await A.mset(ev, 1);
      const fa = await runAll('06a');
      check('RB-06', '前提: 红灯流自动打回(returned)、绿流归档(archived)', (await statusOf(fa.R.rid)) === 'returned' && (await statusOf(fa.G.rid)) === 'archived');
      const oa = await observe(fa, EVS);
      for (const ev of EVS) check('RB-06', `全开: ${ev}(${TITLE[ev]}) 桩收到 1 次`, oa[ev] === 1, 'hits=' + oa[ev]);
      const GRP = [['judged', 'archived', 'returned'], ['task_dispatch', 'green_publish', 'red_reject']];
      for (let gi = 0; gi < 2; gi++) {
        for (const ev of EVS) await A.mset(ev, GRP[gi].includes(ev) ? 0 : 1);
        const fl = await runAll('06' + 'bc'[gi]);
        const o = await observe(fl, EVS.filter(e => !GRP[gi].includes(e)));
        for (const ev of EVS) {
          const off = GRP[gi].includes(ev);
          check('RB-06', `关 ${GRP[gi].join('/')}: ${ev} ${off ? '0 次(被矩阵关断)' : '1 次(未受牵连)'}`, o[ev] === (off ? 0 : 1), 'hits=' + o[ev]);
        }
      }
      for (const ev of EVS) await A.mset(ev, 1);
      const gp = hits.filter(h => h.title === TITLE.green_publish && h.text.includes(fa.G.rt));
      check('RB-06', 'green_publish 走 committee 频道实例(/db-committee)', gp.length === 1 && gp[0].path === '/db-committee', gp.map(h => h.path).join(','));
    }

    // ---------- RB-08 桩端口关掉 => 业务仍 200 ----------
    {
      await stubDown();
      const f = await submitted('08');
      check('RB-08', '通知全故障: 提交仍 200 且 <5s', f.st.status === 200 && f.ms < 5000, 'status=' + f.st.status + ' ms=' + f.ms);
      await completeAll(f.rid);
      check('RB-08', '通知全故障: 打灯后自动研判正常(judged)', (await statusOf(f.rid)) === 'judged');
      const t = rn.data.id ? await A.test(rn.data.id) : { status: 0, data: {}, text: '' }; bodies.push(t.text || '');
      check('RB-08', '探活对断开的实例如实报失败(200 + ok=false, 不抛 500)', t.status === 200 && t.data.ok === false, t.status + ':' + JSON.stringify(t.data));
      await raw(T.admin, `/api/reviews/${f.rid}/archive`, 'POST');
      await stubUp();
    }

    // ---------- RB-09 白名单 scope 边界 ----------
    let wlIds = [];
    {
      const oppBody = n => ({ opp_code: `PL-T10-${S}-${n}`, title: 'T10 机器人建档-' + n, customer: 'RB 客户', region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: 'RB-09' });
      const g0 = await raw(T.sales, '/api/reviews', 'GET', undefined, ROBOT);
      check('RB-09', '未入白名单: 机器人路径查询 403', g0.status === 403, g0.status + ':' + (g0.data.error || ''));
      const wq = await A.wadd({ ident: String(salesId), kind: 'user_id', scope: 'query' }); bodies.push(wq.text);
      if (wq.data.id) wlIds.push(wq.data.id);
      const g1 = await raw(T.sales, '/api/reviews', 'GET', undefined, ROBOT);
      const c1 = await raw(T.sales, '/api/opp', 'POST', oppBody('q'), ROBOT);
      check('RB-09', 'query 身份: 查询 200', wq.status === 200 && g1.status === 200, wq.status + '/' + g1.status);
      check('RB-09', 'query 身份: 建档 403(不得触发建档/提交)', c1.status === 403, c1.status + ':' + (c1.data.error || ''));
      const wc = await A.wadd({ ident: String(salesId), kind: 'user_id', scope: 'create' }); bodies.push(wc.text);
      if (wc.data.id) wlIds.push(wc.data.id);
      const c2 = await raw(T.sales, '/api/opp', 'POST', oppBody('c'), ROBOT);
      check('RB-09', 'create 身份: 建档 200', wc.status === 200 && c2.status === 200, wc.status + '/' + c2.status + ':' + (c2.data.error || ''));
      const dup = await A.wadd({ ident: String(salesId), kind: 'user_id', scope: 'create' });
      const badk = await A.wadd({ ident: '1', kind: 'role', scope: 'query' });
      check('RB-09', '白名单重复 409、非法 kind 400', dup.status === 409 && badk.status === 400, dup.status + '/' + badk.status);
    }

    // ---------- RB-10 机器人路径不豁免门禁 ----------
    {
      const code = `PL-T10-${S}-g3`;
      await raw(T.sales, '/api/opp', 'POST', { opp_code: code, title: 'T10 三步链', customer: 'RB 客户', region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: 'RB-10' });
      const rows = [{ content: '实施', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 }];
      await raw(T.sales, `/api/opp/${encodeURIComponent(code)}/delivery`, 'PUT', { rows });
      await raw(T.sales, `/api/opp/${encodeURIComponent(code)}/delivery/confirm`, 'POST', {});
      const bid = (await raw(T.sales, '/api/budget', 'POST', { project_name: 'T10 链预算', opp_code: code, fields: { ...GREEN_BUDGET, opp_code: code } })).data.id;
      const lk = await raw(T.sales, `/api/budget/${bid}/lock`, 'POST');
      await raw(T.sales, `/api/opp/${encodeURIComponent(code)}/delivery`, 'PUT', { rows }); // ① 漂移回草稿
      const rid = (await raw(T.sales, '/api/reviews', 'POST', { type: 'bid', title: `[T]RB-10a-${S}`, form: { ...BID_BASE, opp_code: code }, submit: false, budget_id: bid })).data.id;
      const r1 = await raw(T.sales, `/api/reviews/${rid}/submit`, 'POST', undefined, ROBOT);
      check('RB-10', '机器人路径(create 白名单)提交未确认①: 同样 400 三步链未闭合', lk.status === 200 && r1.status === 400 && /^三步链未闭合/.test(r1.data.error || ''), 'lock=' + lk.status + ' submit=' + r1.status + ':' + (r1.data.error || ''));
      const bg = await makeLockedBudget('RB-10b');
      const form = { ...BID_BASE }; delete form.sign_path;
      const rid2 = (await raw(T.sales, '/api/reviews', 'POST', { type: 'bid', title: `[T]RB-10b-${S}`, form, submit: false, budget_id: bg })).data.id;
      const r2 = await raw(T.sales, `/api/reviews/${rid2}/submit`, 'POST', undefined, ROBOT);
      check('RB-10', '机器人路径缺必填: 同样 400 必填缺失:', r2.status === 400 && /^必填缺失:/.test(r2.data.error || '') && (r2.data.missing || []).includes('sign_path'), r2.status + ':' + (r2.data.error || ''));
      check('RB-10', '两单状态仍 draft(门禁拦下未落库)', (await statusOf(rid)) === 'draft' && (await statusOf(rid2)) === 'draft');
    }
    for (const id of wlIds) bodies.push((await A.wdel(id)).text);

    // ---------- RB-11 迁移幂等 ----------
    {
      const src = fs.readFileSync(SRV, 'utf8');
      const m = src.match(/db\.exec\(`(CREATE TABLE IF NOT EXISTS robot_instances[\s\S]*?)`\)/);
      check('RB-11', 'server.js 含三表建表语句(IF NOT EXISTS)', !!m && /notify_matrix/.test(m[1]) && /robot_whitelist/.test(m[1]));
      const before = ['robot_instances', 'notify_matrix', 'robot_whitelist'].map(cnt);
      let err = '';
      if (m) { try { db.exec(m[1]); db.exec(m[1]); } catch (e) { err = e.message; } }
      const after = ['robot_instances', 'notify_matrix', 'robot_whitelist'].map(cnt);
      check('RB-11', '建表语句重复执行两遍不报错、三表行数不变', !!m && !err && before.every(c => c >= 0) && JSON.stringify(before) === JSON.stringify(after), err || before.join(',') + ' -> ' + after.join(','));
      const NAMES = ['config:NOTIFY_WEBHOOK_URL', 'config:COMMITTEE_WEBHOOK_URL'];
      const pre = (tryAll(`SELECT name FROM robot_instances WHERE name IN (?,?)`, ...NAMES) || []).map(r => r.name);
      const i1 = await A.imp(); bodies.push(i1.text);
      const c1 = cnt('robot_instances');
      const i2 = await A.imp(); bodies.push(i2.text);
      const c2 = cnt('robot_instances');
      const rows = tryAll(`SELECT name, enabled FROM robot_instances WHERE name IN (?,?)`, ...NAMES) || [];
      check('RB-11', 'config 导入两次: 第二次 inserted=0 且行数不变', i1.status === 200 && i2.status === 200 && i2.data.inserted === 0 && c1 === c2, `${i1.status}/${i2.status} inserted=${i1.data.inserted},${i2.data.inserted} rows=${c1},${c2}`);
      check('RB-11', '导入行默认停用(enabled=0, 不抢真源也不双推)', rows.length === 2 && rows.filter(r => !pre.includes(r.name)).every(r => r.enabled === 0), JSON.stringify(rows));
      for (const r of rows) if (!pre.includes(r.name)) tryRun('DELETE FROM robot_instances WHERE name=?', r.name);
    }

    // ---------- RB-02 收尾: 全部管理端点响应体 grep ----------
    check('RB-02', `本轮 ${bodies.length} 个管理端点响应体均不含任何 secret 明文`, bodies.length > 0 && SECRETS.every(s => bodies.every(b => !String(b).includes(s))));
    check('RB-02', '本轮管理端点响应体不含 webhook 的 access_token 明文', bodies.every(b => !String(b).includes('TOKrb02' + S + 'abcd')));
  } finally {
    for (const id of myRobots) tryRun('DELETE FROM robot_instances WHERE id=?', id);
    tryRun("DELETE FROM robot_instances WHERE name LIKE ?", '[T]RB-%-' + S);
    for (const id of enabledSnap) tryRun('UPDATE robot_instances SET enabled=1 WHERE id=?', id);
    if (tryAll('SELECT 1 FROM notify_matrix LIMIT 1') !== null) {
      tryRun('DELETE FROM notify_matrix');
      for (const r of matrixSnap) tryRun('INSERT INTO notify_matrix(event,target,channel,enabled) VALUES(?,?,?,?)', r.event, r.target, r.channel, r.enabled);
    }
    const wlNow = (tryAll('SELECT id FROM robot_whitelist') || []).map(r => r.id);
    for (const id of wlNow) if (!wlSnap.includes(id)) tryRun('DELETE FROM robot_whitelist WHERE id=?', id);
    // 止住 robot_outbox 累积: 夹具 opp_code 恒为 'PL-T-RB'(共用一个商机), 故只能按本轮 review_id 集删,
    // 既不碰历史轮/他人行, 又让每轮 RB 不再往共享库叠加 task_dispatch 行
    if (myReviewIds.length) {
      const ph = myReviewIds.map(() => '?').join(',');
      const gone = tryRun('DELETE FROM robot_outbox WHERE review_id IN (' + ph + ')', ...myReviewIds);
      const left = tryAll('SELECT COUNT(*) c FROM robot_outbox WHERE review_id IN (' + ph + ')', ...myReviewIds);
      LOG.push('CLEANUP - RB 本轮 review=' + myReviewIds.length + ' robot_outbox 删除=' + (gone ? gone.changes : '表不存在或删失败') + ' 残留=' + (left ? left[0].c : '表不存在'));
    }
    fs.writeFileSync(CFG, cfgRaw, 'utf8');
    await stubDown();
    db.close();
  }
  const cfgAfter = JSON.parse(fs.readFileSync(CFG, 'utf8'));
  const FOUR = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'REPORT_SECRET'];
  check('POST', 'config.json 按原始字节复位且四键完好', FOUR.every(k => cfgAfter[k] === cfgBefore[k]) && fs.readFileSync(CFG, 'utf8') === cfgRaw);

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) { fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8'); console.log('日志已写入: ' + logFile.slice(6)); }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => {
  console.error('FAIL:', e.stack || e.message);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\nCRASH: ' + e.message + '\n' + `${pass} passed, ${fail + 1} failed -> SOME FAIL` + '\n', 'utf8');
  process.exit(1);
});
