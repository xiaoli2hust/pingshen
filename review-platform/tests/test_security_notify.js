// 阶段 3 结论/关联/通知: API-21~23 + R-33 + J-01/J-02 + N-01~03(服务运行中)
// 用法: node tests/test_security_notify.js [--log=tests/green_stage3_notify.txt]
// 红绿纪律: API-21~23/R-33/J-01 在阶段 3 旧代码上必 FAIL(decision/preview-light 404);
//   J-02②/N-02 为回归防护用例(旧代码即绿); N-03 依赖 notify.js(旧代码 require 失败=红)
// 桩方案: 本地 9802 webhook 应答器记录收到的 payload; config NOTIFY_WEBHOOK_URL/COMMITTEE_WEBHOOK_URL
//   临时改写(整体读写, try/finally 恢复原始字节); N-03 直调 createNotify 注入桩 deps(无需服务)
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const http = require('http');
const path = require('path');
const CFG_PATH = path.join(__dirname, '..', 'config.json');

async function raw(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function api(token, reqPath, method, body) {
  const r = await raw(token, reqPath, method, body);
  if (r.status >= 400) throw new Error(reqPath + ' -> ' + r.status + ' ' + (r.data.error || ''));
  return r.data;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;

// ---------- 流程辅助 ----------
const GREEN_BUDGET = { // margin≈41.9 绿
  contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000,
  project_name: '通知流程基线预算', customer: '通知基线客户'
};
const LOW_MARGIN_BUDGET = { // 交付成本拉高 -> 贡献毛利转负/低于 10%(黄, 证明 J-01 读 budgets.calc)
  contract: 1000000, sub_cost: 600000, dev_dept: '交付处', dev_pd: 300, del_travel: 50000
};
const makeLockedBudget = async (token, fields, name) => {
  const id = (await api(token, '/api/budget', 'POST', { project_name: name })).id;
  await api(token, `/api/budget/${id}`, 'PUT', { fields });
  await api(token, `/api/budget/${id}/delivery`, 'PUT', { rows: [{ content: '回归明细(附3递进门禁)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
  await api(token, `/api/budget/${id}/lock`, 'POST');
  return id;
};
const BID_BASE = { // 全绿 bid 基线(与 test_rules_e2e BASES.bid 同源)
  opp_code: 'PL-T-RM', opp_stage: '投标决策', region: '华北营销处-渠道', customer: '通知基线客户',
  biz_line: 'G1', contract_amount: '24', sales: '王超', pm: '冯金华', sign_date: '2026-12-31',
  gross_margin: '15', cost_happened: '0', ops_years: '1', sign_path: '客户公司→丰图科技(深圳)有限公司',
  sub_amount: '0', designated_sub_amount: '0', survey_sub_amount: '0', sub_core: '否', survey: '否',
  jiadao: '否', secret: '否', province: '江西省', product_type: '标品', promo_target: '无', promo_amount: '0',
  settle_method: '银行转账', payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: '通知基线', data_review: '是', data_plan: '公开POI数据', data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};
const DEPTS = { bid: ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'], presale: ['fde1', 'comp1', 'pur1', 'fin1'] };
// 建单(可选关联)->提交->全部门绿灯->judged
async function makeJudged(token, tokens, { type = 'bid', form, budget_id }) {
  const rid = (await api(token, '/api/reviews', 'POST', { type, title: `[T]${type} 通知流程单`, form, submit: false, budget_id })).id;
  await api(token, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'rm.xlsx', data: Buffer.from('x').toString('base64') });
  await api(token, `/api/reviews/${rid}/submit`, 'POST');
  for (const u of DEPTS[type]) {
    const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
    for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
  }
  return rid;
}

// ---------- 桩 webhook: 9802, 记录收到的 payload ----------
const webhooks = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => { webhooks.push({ url: req.url, body }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
});
const waitHook = async (n = 1, ms = 3000) => {
  for (let i = 0; i < ms / 100 && webhooks.length < n; i++) await new Promise(r => setTimeout(r, 100));
  return webhooks.length >= n;
};

// ---------- config.json 通知键临时改写(整体读写, finally 恢复原始字节) ----------
let cfgRaw = null;
const setNotifyCfg = (kv) => {
  if (cfgRaw === null) cfgRaw = fs.readFileSync(CFG_PATH, 'utf8');
  const cfg = JSON.parse(cfgRaw);
  Object.assign(cfg, kv);
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
};
const restoreCfg = () => { if (cfgRaw !== null) { fs.writeFileSync(CFG_PATH, cfgRaw, 'utf8'); cfgRaw = null; } };

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name;
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

(async () => {
  await new Promise(r => hook.listen(9802, '127.0.0.1', r));
  const sales = await login('sales1');
  const admin = await login('zhichizu');
  const tokens = {};
  for (const u of new Set([...DEPTS.bid, ...DEPTS.presale])) tokens[u] = await login(u);
  // N-01 前置: 直开库给 sales1 设 phone(并发写有锁风险, 失败降级为弱断言)
  let phoneOk = false;
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
    db.prepare("UPDATE users SET phone='13800000001' WHERE username='sales1'").run();
    db.close();
    phoneOk = true;
  } catch (e) { console.log('(phone 设定跳过:' + e.message + ')'); }

  try {
    // ---------- API-23: preview-light 草稿单 dry-run(status 不变) ----------
    {
      const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]API-23 预判草稿', form: { ...BID_BASE, gross_margin: '5.52' }, submit: false })).id;
      const r = await raw(sales, `/api/reviews/${rid}/preview-light`);
      const d = r.data || {};
      check('API-23', '草稿单 200 返回 light/route/items', r.status === 200 && typeof d.light === 'string' && typeof d.route === 'string' && Array.isArray(d.items));
      check('API-23', 'dry-run 不改 status(仍 draft)', ((await raw(sales, '/api/reviews/' + rid)).data.review || {}).status === 'draft');
      const it = (d.items || []).find(i => i.name.includes('贡献利润'));
      check('API-23', '预判黄项(贡献利润 5.52)', d.light === 'yellow' && it && it.level === 'yellow');
    }

    // ---------- J-02①: 无关联 bid 草稿在线填预算 -> preview-light 回落 budget_json ----------
    {
      const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]J-02 在线预算草稿', form: { ...BID_BASE }, submit: false })).id;
      await api(sales, `/api/reviews/${rid}/budget`, 'PUT', { inputs: LOW_MARGIN_BUDGET });
      const d = (await raw(sales, `/api/reviews/${rid}/preview-light`)).data || {};
      const it = (d.items || []).find(i => i.name.includes('贡献利润'));
      check('J-02', '无关联回落 budget_json(取自在线预算表)', it && it.level === 'yellow' && /在线预算表/.test(it.reason || ''));
    }

    // ---------- J-01: 关联单研判取 budgets.calc(不读表单手填) ----------
    let j1 = 0;
    {
      const bg = await makeLockedBudget(sales, LOW_MARGIN_BUDGET, 'J-01 低毛利预算');
      const form = { ...BID_BASE, gross_margin: '99' }; // 坑值: 若读表单会判绿
      j1 = await makeJudged(sales, tokens, { form, budget_id: bg });
      const d = (await raw(sales, '/api/reviews/' + j1)).data || {};
      const detail = JSON.parse((d.review || {}).judge_detail || '[]');
      const it = detail.find(i => i.name.includes('贡献利润'));
      check('J-01', '关联单研判取 budgets.calc(黄, 非表单 99 绿)', (d.review || {}).light === 'yellow' && it && it.level === 'yellow');
      check('J-01', '理由标注取自关联预算单', it && /关联预算单/.test(it.reason || ''));
    }

    // ---------- J-02②: presale 在线填预算提交研判兜底(T3 口径: 关联锁定预算单) ----------
    {
      const form = { customer: '售前通知客户', biz_line: 'G1', contract_amount: '100', sign_date: '2026-12-31', survey: '否', sub_early_flag: '否', presale_invest: '1', presale_period: '2', summary: 'J-02' };
      const bg = await makeLockedBudget(sales, LOW_MARGIN_BUDGET, 'J-02 售前预算');
      const rid = (await api(sales, '/api/reviews', 'POST', { type: 'presale', title: '[T]J-02 售前在线预算单', form, submit: false, budget_id: bg })).id;
      await api(sales, `/api/reviews/${rid}/budget`, 'PUT', { inputs: LOW_MARGIN_BUDGET });
      await api(sales, `/api/reviews/${rid}/submit`, 'POST');
      for (const u of DEPTS.presale) {
        const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
        for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
      }
      const d = (await raw(sales, '/api/reviews/' + rid)).data || {};
      check('J-02', 'presale 在线预算单全流程研判正常(judged)', (d.review || {}).status === 'judged');
    }

    // ---------- 全绿单(供 API-21/N-01) ----------
    const gbg = await makeLockedBudget(sales, GREEN_BUDGET, '通知绿灯预算');
    const gr = await makeJudged(sales, tokens, { form: { ...BID_BASE }, budget_id: gbg });
    check('PRE', '全绿单就绪(judged/green)', ((await raw(sales, '/api/reviews/' + gr)).data.review || {}).light === 'green');

    // ---------- API-22: 普通申请人调 decision 403 ----------
    {
      const r = await raw(sales, `/api/reviews/${gr}/decision`, 'POST', { decision_result: '同意' });
      check('API-22', '普通申请人 403', r.status === 403);
    }

    // ---------- API-21 + N-01: 支持组录结论 + 绿灯发布进委员会群(桩) ----------
    {
      setNotifyCfg({ COMMITTEE_WEBHOOK_URL: 'http://127.0.0.1:9802/committee' });
      const r = await raw(admin, `/api/reviews/${gr}/decision`, 'POST', { decision_result: '同意', decision_note: '绿灯免上会,同意推进' });
      check('API-21', '支持组录结论 200', r.status === 200);
      const d = (await raw(sales, '/api/reviews/' + gr)).data || {};
      const rv = d.review || {};
      check('API-21', '四列落库(result/note/by/at)', rv.decision_result === '同意' && /绿灯免上会/.test(rv.decision_note || '') && !!rv.decision_by && !!rv.decision_at);
      check('API-21', 'addEvent 留痕(录入结论)', (d.events || []).some(e => /录入结论/.test(e.action || '')));
      const got = await waitHook(1, 4000);
      const w = webhooks[0] || {};
      const md = (() => { try { return JSON.parse(w.body || '{}'); } catch (e) { return {}; } })();
      const text = ((md.markdown || {}).text) || '';
      check('N-01', '绿灯发布 markdown 到委员会群', got && (md.msgtype === 'markdown') && !!((md.markdown || {}).title));
      check('N-01', 'payload 含项目名/结论/链接', /通知流程单/.test(text) && /同意/.test(text) && /review/.test(text));
      if (phoneOk) check('N-01', '@申请人手机号', /@13800000001/.test(text));
      else check('N-01', '(phone 未设, @ 断言跳过)', true);
    }

    // ---------- R-33: opinion_conflict -> reroute_xo(只升路由不改灯色) ----------
    {
      const r = await raw(admin, `/api/reviews/${j1}/decision`, 'POST', { decision_result: '同意', decision_note: '部门意见冲突', opinion_conflict: true });
      check('R-33', '冲突结论录入 200', r.status === 200);
      const d = (await raw(sales, '/api/reviews/' + j1)).data || {};
      const rv = d.review || {};
      check('R-33', '路由升级 XO(意见冲突重路由)', /XO/.test(rv.route || '') && /意见冲突/.test(rv.route || ''));
      check('R-33', '灯色不变(仍 yellow)', rv.light === 'yellow');
      check('R-33', 'reroute_xo 事件留痕', (d.events || []).some(e => e.action === 'reroute_xo'));
    }

    // ---------- N-02: webhook 失败不阻断主流程(提交分派触发) ----------
    {
      setNotifyCfg({ NOTIFY_WEBHOOK_URL: 'http://127.0.0.1:9' });
      const bg = await makeLockedBudget(sales, GREEN_BUDGET, 'N-02 预算');
      const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]N-02 提交通知不阻断', form: { ...BID_BASE }, submit: false, budget_id: bg })).id;
      await api(sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'rm.xlsx', data: Buffer.from('x').toString('base64') });
      const t0 = Date.now();
      const r = await raw(sales, `/api/reviews/${rid}/submit`, 'POST');
      check('N-02', 'webhook 失败主流程仍 200(不 throw, 不久等)', r.status === 200 && Date.now() - t0 < 5000);
    }

    // ---------- N-03: 同一周一两次 weeklyDigest 仅发一次(settings.last_weekly_sent 幂等) ----------
    {
      let createNotify = null;
      try { createNotify = require('../notify.js').createNotify; } catch (e) {}
      if (!createNotify) {
        check('N-03', 'notify.js 可加载(createNotify 导出)', false);
      } else {
        const posts = [];
        const store = {};
        const notify = createNotify({
          getSetting: k => store[k],
          setSetting: (k, v) => { store[k] = v; },
          post: async (url, payload) => posts.push({ url, payload }),
          listReviews: () => [{ id: 1, title: 'A', light: 'green', status: 'judged' }],
          reportLink: id => 'http://127.0.0.1:8600/#/review/' + id,
          phonesOf: () => [],
          now: () => new Date('2026-10-05T09:30:00') // 周一 9:30
        });
        await notify.weeklyDigest();
        await notify.weeklyDigest();
        check('N-03', '同一周一两次仅发一次(幂等)', posts.length === 1 && !!store.last_weekly_sent);
      }
    }

    // ---------- 清理: judged 单归档 ----------
    for (const rid of [j1, gr]) { try { await api(admin, `/api/reviews/${rid}/archive`, 'POST'); } catch (e) {} }
  } finally {
    restoreCfg();
    hook.close();
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  console.log('config.json 通知键已恢复');
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { restoreCfg(); hook.close(); console.error('FAIL:', e.message); process.exit(1); });
