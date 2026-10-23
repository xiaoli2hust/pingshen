// 红基线：缺证据/meta/就绪态/留痕/统计/待办聚合；PRE 与 PIN 固定既有真实 HTTP 链路，所有夹具由外层快照还原。
'use strict';
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
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
let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = a => [...(a || [])].sort();
const names = a => sorted((a || []).map(i => i.name));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function srcConst(name) {
  const i = SRC.indexOf('\nconst ' + name + ' = {');
  if (i < 0) return null;
  const j = SRC.indexOf('{', i), k = SRC.indexOf('\n};', j);
  if (k < 0) return null;
  try { return Function('"use strict";return (' + SRC.slice(j, k + 2) + ')')(); } catch (e) { return null; }
}
function judgePushSets() {
  const a = SRC.indexOf('function judge(review) {'), end = SRC.indexOf('// 前置评审人工灯态', a);
  if (a < 0 || end < 0) return null;
  const body = SRC.slice(a, end);
  const ib = body.indexOf("if (review.type === 'bid')"), ip = body.indexOf("if (review.type === 'presale')"), ic = body.indexOf("if (review.type === 'change')");
  if ([ib, ip, ic].some(x => x < 0)) return null;
  const collect = s => sorted([...new Set([...s.matchAll(/push\('([^']+)'/g)].map(m => m[1]))]);
  return { bid: collect(body.slice(ib, ip)), presale: collect(body.slice(ip, ic)), change: collect(body.slice(ic)) };
}
// ---------- era 不变式普查(R-66) ----------
// CH-11b / C2-11-identity / OD-08-inflight / OD-09-flip 四条见证要求的状态(非归档 history 行、同一行改 era)
// 无已授权 HTTP 产地。这里不假设该结论, 而是普查 server.js 的 era 写入点与归档态出口, 并证明三类变异会被拒。
function sqlBalanced(src, start, open, close) {
  let d = 0, s = '', i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === open) { d++; if (d === 1) continue; }
    if (c === close) { d--; if (!d) break; }
    s += c;
  }
  return { text: s, end: i };
}
function splitTop(s) {
  const out = []; let d = 0, q = '', cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') d++;
    if (c === ')' || c === ']' || c === '}') d--;
    if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function reviewInsertSites(src) {
  const res = [];
  for (const m of src.matchAll(/INSERT INTO reviews\(/g)) {
    const cols = sqlBalanced(src, m.index + m[0].length - 1, '(', ')');
    if (!/^\s*VALUES\s*\(/.test(src.slice(cols.end + 1, cols.end + 12))) continue;
    const ph = sqlBalanced(src, src.indexOf('(', cols.end + 1), '(', ')');
    const r = src.indexOf('.run(', ph.end);
    const gt = src.indexOf('.get(', ph.end);
    if (r < 0 || (gt >= 0 && gt < r)) continue;
    const args = sqlBalanced(src, src.indexOf('(', r), '(', ')');
    res.push({ line: src.slice(0, m.index).split('\n').length, cols: cols.text.split(',').map(x => x.trim()), args: splitTop(args.text) });
  }
  return res;
}
function eraViolations(src) {
  const v = [];
  const eraIns = reviewInsertSites(src).filter(x => x.cols.includes('era'));
  if (eraIns.length !== 1) v.push({ g: 'INS', m: 'era 写入型 INSERT 数=' + eraIns.length + ' 应为 1' });
  for (const x of eraIns) {
    const eraVal = x.args[x.cols.indexOf('era')];
    const stVal = x.cols.includes('status') ? x.args[x.cols.indexOf('status')] : null;
    if (eraVal !== "'history'") v.push({ g: 'INS', m: 'L' + x.line + ' era 实参=' + eraVal });
    if (stVal !== "'archived'") v.push({ g: 'INS', m: 'L' + x.line + ' status 实参=' + stVal + '(非归档 history 行由此可达)' });
  }
  for (const m of src.matchAll(/UPDATE reviews SET[\s\S]{0,160}?(?=['"`])/g)) {
    if (!/(^|[\s,(])era\s*=/.test(m[0])) continue;
    if (!/SET era='online' WHERE era IS NULL/.test(src.substr(m.index, m[0].length + 60))) v.push({ g: 'UPD', m: '改 era 的 UPDATE: ' + m[0].replace(/\s+/g, ' ').slice(0, 70) });
  }
  // 加宽: 拼接式 SQL 与 upsert 的 DO UPDATE SET 都不会被上面的整句字面量匹配到, 故按 SET 后窗口扫 era 词元
  for (const m of src.matchAll(/(?:UPDATE reviews SET|DO UPDATE SET)/g)) {
    const tail = src.substr(m.index + m[0].length, 80);
    if (!/(^|[^\w$])era([^\w$]|$)/.test(tail)) continue;
    if (/^UPDATE reviews SET era='online' WHERE era IS NULL/.test(m[0] + tail)) continue;
    v.push({ g: 'UPD', m: 'era 落入写语句 SET 窗口: ' + (m[0] + tail).replace(/\s+/g, ' ').slice(0, 70) });
  }
  for (const m of src.matchAll(/\[([^\]]*)\]\.includes\(review\.status\)/g)) {
    const list = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    if (list.includes('archived')) v.push({ g: 'GUARD', m: '状态守卫放行 archived: [' + m[1] + ']' });
  }
  for (const m of src.matchAll(/UPDATE reviews SET status=[\s\S]{0,200}?(?=['"`])/g)) {
    if (/archived/.test(m[0].split('WHERE')[1] || '')) v.push({ g: 'GUARD', m: '状态写入可命中 archived: ' + m[0].replace(/\s+/g, ' ').slice(0, 70) });
  }
  return v;
}
const msgOf = (list, g) => list.filter(x => x.g === g).map(x => x.m).join(' / ');
const MUT_HISTORY_DRAFT = SRC.replace(".run(type, title, user.id, user.name, 'archived', 1, JSON.stringify(form), 'none', decision, JSON.stringify(jd), archAt, 'history'",
  ".run(type, title, user.id, user.name, 'draft', 1, JSON.stringify(form), 'none', decision, JSON.stringify(jd), archAt, 'history'");
const MUT_ERA_FLIP = SRC.replace("db.prepare('UPDATE reviews SET status=?, updated_at=? WHERE id=?').run('returned', now(), review.id);",
  "db.prepare('UPDATE reviews SET status=?, era=?, updated_at=? WHERE id=?').run('returned', 'online', now(), review.id);");
const MUT_ARCHIVED_EDIT = SRC.replace("if (!['draft', 'returned', 'judged'].includes(review.status))",
  "if (!['draft', 'returned', 'judged', 'archived'].includes(review.status))");
// 第二波绕过面: 拼接式 UPDATE 与 upsert 的 DO UPDATE SET(普查若只看整句字面量就会漏)
const MUT_ERA_CONCAT = SRC.replace("db.prepare('UPDATE reviews SET budget_json=?, updated_at=? WHERE id=?')",
  "db.prepare('UPDATE reviews SET ' + 'era' + '=?, updated_at=? WHERE id=?')");
const MUT_ERA_UPSERT = SRC.replace("INSERT INTO reviews(type,title,applicant_id,applicant_name,status,round,form_json,budget_id,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
  "INSERT INTO reviews(type,title,applicant_id,applicant_name,status,round,form_json,budget_id,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET era=excluded.era");
const S = String(Date.now()).slice(-7), RM = n => 'PL-RM-' + S + '-' + n, CUST = 'RM证据客户-' + S;
const OPP = n => ({ opp_code: RM(n), title: 'RM整改商机-' + n, customer: CUST,
  region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策',
  sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: '整改真实链路用例' });
const BF = code => ({ project_name: 'RM链预算', customer: CUST, contract: 2400000,
  sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, opp_code: code });
const mkRows = () => [{ content: '实施', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 }, { content: '运维', stage: '运维', pm_pd: 2 }];
const CH_BID_BASE = {
  opp_code: 'PL-T3', opp_stage: '投标决策', region: '华北营销处-渠道', customer: 'AV客户', biz_line: 'G1',
  contract_amount: '24', sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15', cost_happened: '0',
  ops_years: '1', sign_path: '客户公司→丰图科技(深圳)有限公司', sub_amount: '0', designated_sub_amount: '0',
  survey_sub_amount: '0', sub_core: '否', survey: '否', jiadao: '否', secret: '否', province: '江西省',
  product_type: '标品', promo_target: '无', promo_amount: '0', settle_method: '银行转账',
  payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: 'CH 链用例', data_review: '是', data_plan: '公开POI数据', data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};
const CH_PRESALE_BASE = { customer: '售前通知客户', biz_line: 'G1', contract_amount: '100', sign_date: '2026-12-31',
  survey: '否', sub_early_flag: '否', presale_invest: '1', presale_period: '2', summary: 'CH 链用例' };
const CH_CHANGE_BASE = { proj_code: 'PRJ-CH', biz_line: 'G1', proj_stage: '实施中', change_type: '项目成本变动',
  old_contract_amount: '100', old_gross_margin: '15', new_contract_amount: '100', new_gross_margin: '15',
  old_sub_amount: '0', new_sub_amount: '0', old_delivery_cost: '50', new_delivery_cost: '55',
  old_sales_cost: '10', new_sales_cost: '10', over_pay: '否', path_change: '否', delivery_change: '否', summary: 'CH 链用例' };
const T = {}, DEPTS = ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'];
const mkBudget = async code => (await raw(T.sales1, '/api/budget', 'POST', { project_name: 'RM链预算', opp_code: code, fields: BF(code) })).data.id || 0;
const lockBudget = id => raw(T.sales1, '/api/budget/' + id + '/lock', 'POST');
const dlvPut = code => raw(T.sales1, '/api/opp/' + encodeURIComponent(code) + '/delivery', 'PUT', { rows: mkRows() });
const dlvConfirm = code => raw(T.sales1, '/api/opp/' + encodeURIComponent(code) + '/delivery/confirm', 'POST', {});
const opp360 = (code, token = T.zhichizu) => raw(token, '/api/opp/' + encodeURIComponent(code) + '/360');
async function fullOpp(n) {
  const code = RM(n), a = await raw(T.sales1, '/api/opp', 'POST', OPP(n)), b = await dlvPut(code), c = await dlvConfirm(code);
  const budgetId = await mkBudget(code), d = await lockBudget(budgetId);
  return { code, budgetId, ok: [a, b, c, d].every(r => r.status === 200) && budgetId > 0, st: [a, b, c, d].map(r => r.status).join('/') };
}
async function mkReview(type, code, budgetId, patch = {}, omit = []) {
  const base = type === 'bid' ? CH_BID_BASE : type === 'presale' ? CH_PRESALE_BASE : CH_CHANGE_BASE;
  const form = { ...base, customer: CUST, opp_code: code, ...patch };
  for (const k of omit) delete form[k];
  return (await raw(T.sales1, '/api/reviews', 'POST', { type, title: `[T]RM-${type}-${S}`, form, submit: false, budget_id: budgetId })).data.id || 0;
}
const submit = rid => raw(T.sales1, '/api/reviews/' + rid + '/submit', 'POST');
const detail = rid => raw(T.zhichizu, '/api/reviews/' + rid);
const tasksOf = async rid => (await detail(rid)).data.tasks || [];
const ev = (token, id) => raw(token, '/api/tasks/' + id + '/evidence');
const taskBy = async (rid, key) => (await tasksOf(rid)).find(t => t.ind_key === key) || {};
const complete = (u, id) => raw(T[u], '/api/tasks/' + id + '/complete', 'POST', { light: 'green', opinion: '' });
async function completeAllGreen(rid) {
  let ok = true;
  for (const u of DEPTS) {
    const ts = (await raw(T[u], '/api/tasks?scope=mine')).data.tasks || [];
    for (const t of ts.filter(t => t.review_id === rid)) ok = (await complete(u, t.id)).status === 200 && ok;
  }
  return ok;
}
const allStats = async () => (await raw(T.zhichizu, '/api/tasks?scope=all')).data;
(async () => {
  try {
    for (const u of ['sales1', 'zhichizu', ...DEPTS, 'admin']) T[u] = await login(u);
    check('PIN RL-06', '未登录 /api/me=401', (await raw(null, '/api/me')).status === 401);
    check('PIN EV-401', '证据端点未登录=401', (await ev(null, 1)).status === 401);
    const meta = (await raw(T.sales1, '/api/meta/fields')).data;
    check('PIN MT-01', 'meta 保留原五键', ['opp', 'budget', 'presale', 'bid', 'change'].every(k => k in meta));
    check('MT-01', '新增证据与夹具元信息', ['bid', 'presale', 'change'].every(t => Array.isArray(meta.indEvidence?.[t])) && typeof meta.fixtureCodePattern === 'string');
    const reMatch = SRC.match(/\nconst FIXTURE_CODE_RE = \/(.+)\/([a-z]*);/);
    const srcRe = reMatch ? new RegExp(reMatch[1], reMatch[2]) : null;
    const metaRe = typeof meta.fixtureCodePattern === 'string' ? new RegExp(meta.fixtureCodePattern) : null;
    for (const [c, want] of [['PL00006204', false], ['PL-T3-x', true], ['PL-RW-1-MAIN', true], ['PL-A-DL-1', true], ['PL-AD-RB-1', true], ['', false], [RM(1), true]])
      check('MT-02', '夹具样本 ' + JSON.stringify(c), !!srcRe && !!metaRe && srcRe.source === metaRe.source && srcRe.test(c) === want && metaRe.test(c) === want);
    check('PIN MT-04', '前端不复制夹具正则', !/\^PL-/.test(APP) && !/PL-\[A-Za-z0-9\]/.test(APP));
    const eraV = eraViolations(SRC);
    check('ERA-01', 'era 仅历史导入一个 INSERT 写入点且恒为 history+archived', msgOf(eraV, 'INS') === '', msgOf(eraV, 'INS'));
    check('ERA-02', '除启动期 era IS NULL 回填外无任何改 era 的 UPDATE', msgOf(eraV, 'UPD') === '', msgOf(eraV, 'UPD'));
    check('ERA-03', '归档态无退出入口(状态守卫与写入 WHERE 均不接 archived)', msgOf(eraV, 'GUARD') === '', msgOf(eraV, 'GUARD'));
    for (const [nm, mut, grp] of [['历史导入写非归档态', MUT_HISTORY_DRAFT, 'INS'], ['同一行改 era', MUT_ERA_FLIP, 'UPD'], ['归档单可回草稿', MUT_ARCHIVED_EDIT, 'GUARD'],
      ['拼接式 UPDATE 改 era', MUT_ERA_CONCAT, 'UPD'], ['upsert DO UPDATE SET 改 era', MUT_ERA_UPSERT, 'UPD']]) {
      const mv = eraViolations(mut);
      check('ERA-04', '变异须被对应分区拒绝: ' + nm, mut !== SRC && mv.some(x => x.g === grp) && msgOf(eraV, grp) === '',
        mut === SRC ? '变异未生效' : JSON.stringify({ 期望分区: grp, 变异命中: mv.map(x => x.g), 原码该分区: msgOf(eraV, grp) || '空' }));
    }
    const RUNALL = fs.readFileSync(path.join(__dirname, 'run_all.js'), 'utf8');
    const declRaw = (RUNALL.match(/const DECLARED_GAPS = \[([^\]]*)\]/) || [])[1] || '';
    const decl = declRaw.split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    const suiteIds = ['test_chain.js', 'test_opp360.js', 'test_opp_dialog.js']
      .flatMap(f => [...fs.readFileSync(path.join(__dirname, f), 'utf8').matchAll(/^\s*gap\('([^']+)'/gm)].map(m => m[1]));
    check('ERA-05', 'run_all 白名单与三套件 gap() 声明逐字一致且恰四条', same(sorted(decl), sorted(suiteIds)) && decl.length === 4, JSON.stringify({ decl, suiteIds }));
    const cls = {
      presale: { tech: 'C', resource: 'C', survey_deliver: 'B', sub_early: 'B', credit_history: 'C' },
      bid: { sub_reason: 'B+C', tech: 'C', arrears: 'C', credit: 'C', related_tx: 'C', payment: 'B', upstream: 'B+C', subcontract_limit: 'B', compliance: 'C', data: 'B+C' },
      change: { tech: 'C', sub_reason: 'B+C', sign_diff: 'B', deduction: 'B+C' }
    };
    const indicators = srcConst('INDICATORS'), mapping = srcConst('IND_EVIDENCE'), qi = srcConst('QUANT_ITEMS'), jp = judgePushSets();
    let total = 0;
    for (const t of ['presale', 'bid', 'change']) {
      const rows = meta.indEvidence?.[t] || []; total += rows.length;
      for (const [k, want] of Object.entries(cls[t])) check('MT-03', t + '.' + k + '=' + want, rows.find(i => i.key === k)?.cls === want);
      check('EV-03', t + ' 指标映射完整且角色/名称同源', !!mapping?.[t] && same(sorted((indicators?.[t] || []).map(i => i.key)), sorted(Object.keys(mapping[t]))) && same(sorted(rows.map(i => i.key)), sorted(Object.keys(mapping[t]))) && rows.every(i => i.registered === true && indicators[t].some(j => j.key === i.key && j.name === i.name && j.dept === i.dept)));
      check('EV-04a', t + ' 定量覆盖全集', !!qi?.[t] && same(sorted(qi[t]), jp?.[t]));
    }
    check('EV-03', '登记 19 项', total === 19, '实际=' + total);
    check('PRE', 'judge 可独立抽取 12/4/4 定量项', jp?.bid?.length === 12 && jp?.presale?.length === 4 && jp?.change?.length === 4);
    const o1 = await fullOpp(1);
    check('PRE', '建档→交付确认→预算锁定', o1.ok, o1.st);
    const rids = {};
    for (const [n, type, patch, omit] of [['ev', 'bid', { sub_amount: '5' }, []], ['pre', 'presale', {}, []], ['chg', 'change', {}, []], ['ev6', 'bid', {}, ['sub_amount']], ['sm1', 'bid', {}, []], ['sm2', 'bid', {}, []], ['nt', 'bid', {}, []]]) {
      const rid = await mkReview(type, o1.code, o1.budgetId, patch, omit); rids[n] = rid;
      const sub = await submit(rid);
      check('PRE', n + ' 草稿→提交', rid > 0 && sub.status === 200, 'id=' + rid + ',status=' + sub.status + ',error=' + (sub.data.error || ''));
    }
    const subTask = await taskBy(rids.ev, 'sub_reason'), beforeEvents = (await detail(rids.ev)).data.events?.length;
    const e1 = await ev(T.pur1, subTask.id), x = e1.data;
    check('EV-01', '分包证据 HTTP 200 与 B+C', e1.status === 200 && x.cls === 'B+C');
    check('EV-01', '系统已算分包占比且重点标注', (x.computed || []).some(i => i.name === '分包占比' && i.focus === true));
    check('EV-01', '表单事实字段/注册标签/值', ['sub_core', 'sub_amount', 'designated_sub_amount', 'b2b_scene'].every(k => (x.formFacts || []).some(i => i.k === k && i.label === (meta.bid || []).find(f => f.k === k)?.l)) && (x.formFacts || []).find(i => i.k === 'sub_amount')?.value === '5');
    check('EV-01', '外部依据明确且查询锚点对应本单', x.external?.required === true && !!x.external?.hint && (x.anchors || []).some(i => i.label === '商机代码' && i.value === o1.code) && (x.anchors || []).some(i => /客户名称/.test(i.label) && i.value === CUST));
    check('EV-01', '任务和评审身份准确', x.task?.id === subTask.id && x.review?.id === rids.ev);
    check('PIN EV-01', '读证据不写事件', (await detail(rids.ev)).data.events?.length === beforeEvents);
    check('PIN EV-AUTH', '无关普通部门登录后仍可只读证据', (await ev(T.legal1, subTask.id)).status === 200);
    const arrears = await taskBy(rids.ev, 'arrears'), e2 = (await ev(T.fin1, arrears.id)).data;
    check('EV-02', '历史欠款纯 C 且无虚构表单事实', e2.cls === 'C' && Array.isArray(e2.formFacts) && e2.formFacts.length === 0 && e2.external?.required === true && !!e2.external?.hint);
    check('EV-02', '查询锚点含预计回款时间', (e2.anchors || []).length >= 3 && (e2.anchors || []).some(i => i.label === '预计回款时间' && i.value === CH_BID_BASE.payback_time));
    const partitions = {
      bid: { c: ['分包占比', '贡献利润', '合同金额', '项目运维周期', '签约转包次数', '结算方式'], n: ['测绘类分包占比', '指定供应商', '推广激励', '合同担保事项', '竞业事项'], s: ['条款外激励'] },
      presale: { c: ['售前投入成本', '售前投入占比', '售前实施周期', '预计签单时间'], n: [], s: [] },
      change: { c: ['成本变动-交付成本'], n: ['贡献利润', '合同金额', '分包超进度支付'], s: [] }
    };
    for (const [type, rid] of [['bid', rids.ev], ['presale', rids.pre], ['change', rids.chg]]) {
      const task = (await tasksOf(rid))[0] || {}, e = (await ev(T.zhichizu, task.id)).data, want = partitions[type];
      const c = names(e.computed), n = names(e.notTriggered), s = names(e.skipped), union = [...c, ...n, ...s];
      check('EV-04b', type + ' 已算/未触发/缺失三分区准确', same(c, sorted(want.c)) && same(n, sorted(want.n)) && same(s, sorted(want.s)), JSON.stringify({ c, n, s }));
      check('EV-04b', type + ' 全集完整且两两不交', same(sorted(union), jp?.[type]) && new Set(union).size === union.length);
    }
    const t6 = await taskBy(rids.ev6, 'sub_reason'), e6 = (await ev(T.pur1, t6.id)).data;
    check('EV-06', '缺分包金额证据披露 skipped', (e6.skipped || []).some(i => i.name === '分包占比'));
    check('EV-06', '研判前 coverage=null', (await detail(rids.ev6)).data.coverage === null);
    const done6 = await completeAllGreen(rids.ev6), d6 = (await detail(rids.ev6)).data;
    check('PRE', '部门逐项打灯后机器自然研判', done6 && ['judged', 'returned'].includes(d6.review?.status));
    check('EV-06', '研判后 coverage 仍披露缺分包金额', (d6.coverage?.skipped || []).some(i => i.name === '分包占比'));
    check('PIN EV-06', 'judge 不凭空产出缺失定量项', !JSON.parse(d6.review?.judge_detail || '[]').some(i => i.name === '分包占比'));
    const missing = await ev(T.zhichizu, 999999999);
    check('EV-404', '不存在任务=404 且准确错误', missing.status === 404 && /任务不存在/.test(missing.data.error || ''));
    const code2 = RM(2); await raw(T.sales1, '/api/opp', 'POST', OPP(2));
    let launch = (await opp360(code2)).data.launch || {};
    check('RD-01', '缺①卡片阻塞并给可达锚点', launch.bid?.state === 'blocked' && launch.presale?.state === 'blocked' && launch.change?.state === 'na' && launch.bid?.gaps?.[0]?.key === 'delivery' && launch.bid.gaps[0].href.startsWith('#/opp/') && launch.bid.gaps[0].href.includes(code2) && launch.bid.gaps[0].anchor === 'delivery');
    await dlvPut(code2); await dlvConfirm(code2);
    launch = (await opp360(code2)).data.launch || {};
    check('RD-01', '确认①后只缺②', launch.bid?.state === 'blocked' && same((launch.bid?.gaps || []).map(g => g.key), ['budget']));
    const b2a = await mkBudget(code2), l2a = await lockBudget(b2a);
    launch = (await opp360(code2)).data.launch || {};
    check('PRE', '第二商机预算锁定', b2a > 0 && l2a.status === 200);
    check('RD-01', '①②齐后三卡就绪', ['bid', 'presale', 'change'].every(t => launch[t]?.state === 'ready'));
    const adminBudgets = (await raw(T.admin, '/api/budget')).data.budgets || [];
    const supportBudgets = (await raw(T.zhichizu, '/api/budget')).data.budgets || [];
    check('IA-45b', 'admin 全部预算与支持组同范围且含销售预算', same(sorted(adminBudgets.map(b => b.id)), sorted(supportBudgets.map(b => b.id))) && adminBudgets.some(b => b.id === b2a));
    const b2b = await mkBudget(code2), l2b = await lockBudget(b2b), r2 = await mkReview('bid', code2, b2a);
    const put2 = await raw(T.sales1, '/api/reviews/' + r2, 'PUT', { budget_id: b2b });
    check('PIN RD-03', '草稿可变更同商机锁定预算关联', b2b > 0 && l2b.status === 200 && put2.status === 200 && (await detail(r2)).data.review?.budget_id === b2b);
    const region = 'RM区-' + S, patch = await raw(T.zhichizu, '/api/opp/' + code2, 'PUT', { region });
    const p2 = (await opp360(code2)).data;
    check('IA-47', '人工修正事件包含字段/旧值/新值', patch.status === 200 && (p2.profile_events || []).some(e => e.action === '档案人工修正' && e.detail.includes('字段 营销区域 由 华东 改为 ' + region)));
    check('IA-47', '编辑入口与既有写鉴权一致', p2.profile_can_edit === true && (await opp360(code2, T.sales1)).data.profile_can_edit === true && (await opp360(code2, T.fde1)).data.profile_can_edit === false);
    check('PIN IA-47', 'FDE 档案 PUT=403', (await raw(T.fde1, '/api/opp/' + code2, 'PUT', { region: '禁止值' })).status === 403);
    const smSub = await taskBy(rids.sm1, 'sub_reason'); await complete('pur1', smSub.id);
    const stats0 = await allStats(), smArr = await taskBy(rids.sm1, 'arrears');
    const ret = await raw(T.fin1, '/api/tasks/' + smArr.id + '/return', 'POST', { opinion: 'RM退回补材料' });
    const dsm1 = (await detail(rids.sm1)).data, stats1 = await allStats(), smTs = dsm1.tasks || [];
    check('SM-01', '退回保留 done/returned 并作废八项同轮兄弟', ret.status === 200 && smTs.find(t => t.id === smSub.id)?.status === 'done' && smTs.find(t => t.id === smArr.id)?.status === 'returned' && smTs.filter(t => t.status === 'cancelled' && t.round === 1).length === 8);
    check('SM-01', '任务作废事件可审计', (dsm1.events || []).some(e => e.action === '任务作废' && /8 项/.test(e.detail)));
    check('SM-01', '全量统计增量 cancelled+8/handled+1/zombie+0', ['cancelled', 'handled', 'zombie', 'proxy'].every(k => typeof stats0.stats_all?.[k] === 'number' && typeof stats1.stats_all?.[k] === 'number') && stats1.stats_all.cancelled - stats0.stats_all.cancelled === 8 && stats1.stats_all.handled - stats0.stats_all.handled === 1 && stats1.stats_all.zombie === stats0.stats_all.zombie);
    check('SM-01', '净统计不计测试夹具', typeof stats0.stats?.cancelled === 'number' && stats1.stats?.cancelled === stats0.stats.cancelled);
    for (const u of ['fde1', 'legal1']) check('PIN SM-01', u + ' 待办不回传退回单', !((await raw(T[u], '/api/tasks?scope=mine')).data.tasks || []).some(t => t.review_id === rids.sm1));
    const originalForm = JSON.parse(dsm1.review.form_json);
    for (const [amount, promo, partition] of [['', '10', 'skipped'], ['', '30', 'computed'], ['100', '10', 'notTriggered']]) {
      const changed = await raw(T.sales1, '/api/reviews/' + rids.sm1, 'PUT', { form: { ...originalForm, contract_amount: amount, promo_target: '外部', promo_amount: promo } });
      const e = (await ev(T.pur1, smSub.id)).data;
      check('EV-04c', `推广激励 合同=${JSON.stringify(amount)}/激励=${promo} 属${partition}`, changed.status === 200 && (e[partition] || []).some(i => i.name === '推广激励') && ['computed', 'skipped', 'notTriggered'].filter(k => (e[k] || []).some(i => i.name === '推广激励')).length === 1);
    }
    await raw(T.sales1, '/api/reviews/' + rids.sm1, 'PUT', { form: originalForm });
    const resub = await submit(rids.sm1), round2 = (await tasksOf(rids.sm1)).filter(t => t.round === 2 && t.status === 'pending');
    check('PIN SM-01', '再提交自然进入第二轮十项待办', resub.status === 200 && resub.data.round === 2 && round2.length === 10);
    check('PIN SM-ROUND', '真实重提链不存在旧轮pending且旧任务不可再退回', !(await tasksOf(rids.sm1)).some(t => t.round < 2 && t.status === 'pending') && (await raw(T.fin1, '/api/tasks/' + smArr.id + '/return', 'POST', { opinion: '旧轮不得退回' })).status === 400);
    const stProxy0 = await allStats(), smCredit = await taskBy(rids.sm2, 'credit'); await complete('zhichizu', smCredit.id);
    const dsm2 = (await detail(rids.sm2)).data, proxyT = (dsm2.tasks || []).find(t => t.id === smCredit.id) || {}, stProxy1 = await allStats();
    check('SM-02', '支持组代财务判断角色可见', proxyT.proxy === true && proxyT.done_role === '销售支持组');
    check('SM-02', '代打事件与统计准确', (dsm2.events || []).some(e => e.action === '代打' && e.detail.includes('由 销售支持组 代 财务BP 完成')) && typeof stProxy0.stats_all?.proxy === 'number' && stProxy1.stats_all?.proxy - stProxy0.stats_all.proxy === 1);
    const related = await taskBy(rids.sm2, 'related_tx'); await complete('fin1', related.id);
    const realT = (await tasksOf(rids.sm2)).find(t => t.id === related.id) || {};
    check('SM-02', '本部门判断不误标代理', realT.proxy === false && realT.done_role === '财务BP');
    const dispatch = (await raw(T.fin1, '/api/tasks?scope=mine')).data.dispatch || {}, dispRow = (dispatch.rows || []).find(r => r.review_id === rids.nt);
    check('NT-01', '站内待办聚合对应本部门四项指标', Array.isArray(dispatch.rows) && dispatch.count === dispatch.rows.length && dispRow?.payload?.pending_count === 4 && Array.isArray(dispRow?.payload?.indicators));
    const out = (await raw(T.admin, '/api/admin/robot/outbox?event=task_dispatch&limit=200')).data;
    const outRow = (out.rows || []).find(r => r.idempotency_key === `task_dispatch:${rids.nt}:1:财务BP`);
    check('PIN NT-01', '任务分发自然入本地 preview 箱', outRow?.status === 'preview');
    check('NT-01', '待办真源是同一 outbox 行', !!dispRow && !!outRow && dispRow.id === outRow.id);
    for (const t of (await tasksOf(rids.nt)).filter(t => t.dept === '财务BP')) await complete('fin1', t.id);
    const afterDispatch = (await raw(T.fin1, '/api/tasks?scope=mine')).data.dispatch || {};
    check('NT-01', '打完本部门后待办聚合移除本单', Array.isArray(afterDispatch.rows) && !afterDispatch.rows.some(r => r.review_id === rids.nt));
    const previewRows = (await raw(T.admin, '/api/admin/robot/outbox?status=preview&limit=200')).data.rows || [];
    const readyRows = (await raw(T.admin, '/api/admin/robot/outbox?status=ready&limit=200')).data.rows || [];
    const sum = previewRows.length + readyRows.length;
    check('NT-02', '全量未投递积压不受分页截断', typeof out.backlog === 'number' && (previewRows.length < 200 && readyRows.length < 200 ? out.backlog === sum : out.backlog >= sum));
    const wb = (await raw(T.sales1, '/api/robot/workbench?opp_code=' + o1.code)).data;
    check('PIN NT-02', 'provider.active=false 且 provider_send=false', wb.provider?.active === false && wb.capabilities?.provider_send === false);
    check('NT-02b', '能力措辞明确待发送草稿和本地预演', /待发送草稿/.test(wb.provider?.message || '') && /本地预演/.test(wb.provider?.message || ''));
  } catch (e) {
    check('CRASH', '专项执行异常', false, e.stack || e.message);
  } finally {
    const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
    console.log('\n' + summary);
    const arg = process.argv.find(a => a.startsWith('--log='));
    if (arg) fs.writeFileSync(path.resolve(arg.slice(6)), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  }
  process.exit(fail === 0 ? 0 : 1);
})();
