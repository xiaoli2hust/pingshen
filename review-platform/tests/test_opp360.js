// V4.0 T5 360 聚合契约 v2 永久套件: C2-01~C2-11 含 C2-04b/C2-04c/C2-07b(25 条断言, 服务运行中)
// 用法: node tests/test_opp360.js [--log=tests/green_opp360.txt]
// 载体由来(总线 D-39 ②): 这 22 条最初写在临时脚本 tests/_tmp_360v2.js、按「临时脚本用完即删」被删, 只剩两份日志
//   ⇒ D-19 的 403 边界、D-17 的 delivery 八键/chain 五键冻结、D-22 的 rate 分支同构、D-25 的 era 在线单口径
//   在回归体系里无可注册载体。本文件把 22 条语义**一字不改**地固化(零新语义、不改 server.js), T8 的 D-26 注册表由 OP/DL/CH/RQ 四套扩为五套(+C2)
// 第 23 条 C2-07b(总线 19:38 补件令追加, 既有 22 条未动): 补 D-22 `od ? odCalc.rate` 分支的执行覆盖——锚定码 PL00008572 实测 rate_source='none'
//   使 C2-07 的 budget 子句从未开火、该分支在全量回归里从未被执行(理由与判别力见 C2-07b 块头注释)
// 第 24 条 C2-04b(总线 D-41 补件令, T12 落地; 既有 23 条一字不动): 补 ④'reviewing' 支的执行覆盖——夹具是同码两张真实在线单(先 Finish 一张→archived, 另一张仍 reviewing),
//   使 some=true 而 every=false, some→every 误写必红; 反证(再 Finish 剩余一张, 两张皆 archived 后翻 judged)写在同一条内, 排除空转(理由与判别力见 C2-04b 块头注释)
// 第 25 条 C2-04c: 红灯退回单必须进入 returned 引导, 禁止落入 judged 后提示可归档。
//   红证据 tests/_t12_pre_c2.txt 是**变异红**: server.js:1737 该支自 T5(76edbf3)起即正确, 无代码可致红, 故红取自「把期望改成 every 误写的产物」
// 红基线(已入档 tests/red_360v2.txt): 旧契约 opp 只有 {code,title}、无 delivery/chain 两键、无档案时 404、商机级 delivery GET 登录即可读
//   预期红 C2-02~C2-11; 预期绿(不破坏旧契约) C2-01
// 身份口径(D-19 连带): C2-01~C2-07 统一 zhichizu(销售支持组)——PL00008572 是回填档案, created_by 不可依赖, 支持组是四项里唯一与建档人无关的稳定入口;
//   C2-08/C2-09 才引入第二身份 fde1(前置部门, 非 canWriteOpp 四项); C2-10 三身份行为对账守护 can_write 与路由内 canWriteOpp 的同源性。
//   拿 403 时先怀疑登录身份选错, 不要把 403 当 delivery.total_cost 的期望值写进断言。
// 2026-10-21 SQL 夹具替换: C2-04b/C2-11 原用 node:sqlite 直连 INSERT/UPDATE/DELETE 造在线单/历史单/改 era, 现全部改走带 token 的真实 HTTP 链路:
//   H=支持组 POST /api/reviews/import mode=history(openpyxl 两列「附1-预算表」) / O=建档→交付预算 PUT→confirm→预算 POST→lock→评审 POST(submit:false)→申请人 submit /
//   Finish=六个真实部门账号只完成本单当前轮 pending(绿)→自动研判 judged 绿/黄→支持组 /decision 同意→/archive; 新夹具不做 SQL 清理, 只靠父级守护恢复演示库与 uploads
//   C2-11 披露: 同一行 era 翻转(history→online)无 HTTP 产地, 原「同单改回 era=online」反证已删除——unsupported identity coverage replaced by paired-code business comparison
//   运行时打印 NOT EXECUTABLE C2-11-identity same-row era flip identity coverage gap(不可计为PASS), summary 行携带缺口数与文案
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

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
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const keyset = (o, keys) => !!o && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

// ---------- 契约形状(spec §2.3 + D-17/D-19/D-25; delivery 八键即 C2-02 的「恰好相等」口径) ----------
const DELIVERY_KEYS = ['status', 'rows', 'total_cost', 'dev_dept', 'rate', 'rate_source', 'updated_at', 'can_write'];
const CHAIN_KEYS = ['delivery_confirmed', 'budget_locked', 'reviews_total', 'reviews_submitted', 'next_action'];
const NEXT_ACTIONS = ['confirm_delivery', 'lock_budget', 'submit_review', 'reviewing', 'returned', 'judged'];
// opps 整行 18 列(server.js:153 CREATE TABLE opps), C2-05 断言「18 要素键 + code」
const OPP_COLS = ['opp_code', 'title', 'customer', 'region', 'province', 'biz_line', 'contract_amount', 'opp_stage',
  'sign_date', 'sales', 'pm', 'survey', 'summary', 'source', 'status', 'created_by', 'created_at', 'updated_at'];

// 短 collision-resistant run id: 36 进制毫秒尾 6 位 + 2 字节随机 hex(共 10 位), 重跑/并发不撞既有档案
const S = Date.now().toString(36).slice(-6) + crypto.randomBytes(2).toString('hex');
const TEST_OPP = n => ({ opp_code: 'PL-T5-' + n, title: 'T5契约商机-' + n, customer: '江西省自然资源测绘与监测院',
  region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策',
  sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: '天地图 POI 数据服务项目（T5 360 契约用例）' });
const BF = code => ({ project_name: 'T5 契约预算', customer: '江西省自然资源测绘与监测院', contract: 2400000,
  sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, opp_code: code });
const ROWS = () => [{ content: '实施', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 }, { content: '运维', stage: '运维', pm_pd: 2 }];
const mkOpp = async (t, n) => { await raw(t, '/api/opp', 'POST', TEST_OPP(n)); return 'PL-T5-' + n; };
const mkBudget = async (t, code) => (await raw(t, '/api/budget', 'POST',
  { project_name: 'T5 契约预算', opp_code: code, fields: BF(code) })).data.id || 0;
const dlvPut = (t, code) => raw(t, `/api/opp/${encodeURIComponent(code)}/delivery`, 'PUT', { rows: ROWS() });
const dlvConfirm = (t, code) => raw(t, `/api/opp/${encodeURIComponent(code)}/delivery/confirm`, 'POST', {});

// ---------- 真实 HTTP 夹具(2026-10-21 替换直连 DB 造数): 新夹具产物 ID 逐个登记; 不做 SQL 清理, 只靠父级守护恢复演示库与 uploads ----------
const OWNED = { codes: [], reviews: [], budgets: [] };
// 无已授权 HTTP 产地的不可变 era/历史态: 原位打印 NOT EXECUTABLE 并进 summary 尾行, 不可计为 PASS
const GAPS = [];
const gap = (id, short, detail) => {
  const line = 'NOT EXECUTABLE ' + id + ' ' + short + (detail ? ' | ' + detail : '');
  console.log(line); LOG.push(line); GAPS.push(id + ' ' + short);
};
const FIN_DEPTS = ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'];
const FIN_T = {};
// O 链路 bid 表单: 与 C3 BID_FORM 同值(仅 summary 不同), 含 bid req 全集 14 键; 1 跳签约路径+银行转账+无测绘分包 ⇒ 研判不会红灯打回
const O_BID_FORM = { customer: '江西省自然资源测绘与监测院', biz_line: 'G1', contract_amount: 240, gross_margin: 30, ops_years: 1, sign_path: '示例:A公司→丰图科技(深圳)有限公司', survey: '否', secret: '否', settle_method: '银行转账', guarantee: '否', non_compete: '否', payment_terms: '验收后30天付款', summary: 'C2 夹具投标概述', data_review: '否' };
// H: 支持组历史补录。openpyxl 生成两列老模板(仅「附1-预算表」sheet), review_date 显式给定
let hfxSeq = 0;
const HFX_PY = 'import openpyxl, json, sys\nrows = json.loads(sys.argv[1])\nwb = openpyxl.Workbook()\nws = wb.active\nws.title = \'附1-预算表\'\nfor r in rows:\n    ws.append(r)\nwb.save(sys.argv[2])\n';
const importHistory = async (sup, code, tag) => {
  const name = '夹具历史补录单-' + S + '-' + tag;
  const rows = [['商机代码', code], ['商机名称', name], ['客户名称', '夹具历史客户'], ['评审结论', '同意通过'], ['评审日期', '2024-05-12']];
  const tmp = path.join(__dirname, '_hfx360_' + S + '_' + (++hfxSeq) + '.xlsx');
  let data;
  try {
    const py = cp.spawnSync('python', ['-X', 'utf8', '-c', HFX_PY, JSON.stringify(rows), tmp], { encoding: 'utf8' });
    if (py.status !== 0) throw new Error('openpyxl 生成历史补录 xlsx 失败: ' + String(py.stderr || py.error || '').slice(0, 200));
    data = fs.readFileSync(tmp).toString('base64');
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  const r = await raw(sup, '/api/reviews/import', 'POST', { filename: '夹具历史补录.xlsx', type: 'bid', mode: 'history', review_date: '2024-05-12', data });
  const d = r.data || {};
  const id = Number(d.id) || 0;
  if (id) OWNED.reviews.push(id);
  const respOk = r.status === 200 && id > 0 && d.era === 'history' && d.status === 'archived' && d.light === 'none' &&
    d.archived_at === '2024-05-12' && (d.form || {}).opp_code === code;
  const det = id ? await raw(sup, '/api/reviews/' + id) : { status: 0, data: {} };
  const rv = det.data.review || {};
  const atts = det.data.attachments || [], evs = det.data.events || [], tks = det.data.tasks;
  const detOk = det.status === 200 && Number(rv.id) === id && rv.era === 'history' && rv.status === 'archived' && rv.light === 'none' &&
    rv.opp_code === code && rv.archived_at === '2024-05-12' && atts.some(a => a.field === '历史评审表原件') &&
    evs.some(e => e.action === '历史数据导入') && Array.isArray(tks) && tks.length === 0;
  return { id, ok: respOk && detOk, review: rv,
    ev: 'import=' + r.status + ' id=' + id + ' era=' + JSON.stringify(d.era) + ' status=' + JSON.stringify(d.status) +
      ' light=' + JSON.stringify(d.light) + ' archived_at=' + JSON.stringify(d.archived_at) + ' decision=' + JSON.stringify(d.decision) +
      ' form.opp_code=' + JSON.stringify((d.form || {}).opp_code) + (d.error ? ' error=' + JSON.stringify(d.error) : '') +
      ' | detail=' + det.status + ' title=' + JSON.stringify(rv.title) + ' 附件=' + JSON.stringify(atts.map(a => a.field)) +
      ' 事件=' + JSON.stringify(evs.map(e => e.action)) + ' tasks=' + (Array.isArray(tks) ? tks.length : 'n/a') };
};
// ①②前置(一码一次): 商机级交付预算 PUT→confirm, 预算单 POST(BF 全量)→lock; 同码后续在线单只复用该 budgetId, 绝不再 PUT 交付预算(PUT 即回 draft)
const prepCode = async (sal, code) => {
  const put = await dlvPut(sal, code);
  const cf = await dlvConfirm(sal, code);
  const budgetId = Number(await mkBudget(sal, code)) || 0;
  if (budgetId) OWNED.budgets.push(budgetId);
  const lk = budgetId ? await raw(sal, `/api/budget/${budgetId}/lock`, 'POST') : { status: 0, data: {} };
  return { ok: put.status === 200 && cf.status === 200 && budgetId > 0 && lk.status === 200, budgetId,
    ev: 'put=' + put.status + ' confirm=' + cf.status + ' budget=' + budgetId + ' lock=' + lk.status + ((lk.data || {}).error ? '(' + lk.data.error + ')' : '') };
};
// O: 申请人评审 POST(submit:false, 挂锁定预算 budget_id)→申请人 submit; 回读须 online/reviewing/opp_code/budget_id 一致且当前轮有 pending 任务
const onlineReview = async (sal, code, budgetId, tag) => {
  const c = await raw(sal, '/api/reviews', 'POST', { type: 'bid', title: '[T]C2-' + tag + ' 夹具在线单-' + S, form: { ...O_BID_FORM, opp_code: code }, budget_id: budgetId, submit: false });
  const id = Number((c.data || {}).id) || 0;
  if (id) OWNED.reviews.push(id);
  const s = id ? await raw(sal, `/api/reviews/${id}/submit`, 'POST', {}) : { status: 0, data: {} };
  const det = id ? await raw(sal, '/api/reviews/' + id) : { status: 0, data: {} };
  const rv = det.data.review || {};
  const pend = (det.data.tasks || []).filter(t => t.round === rv.round && t.status === 'pending').length;
  const ok = c.status === 200 && id > 0 && s.status === 200 && det.status === 200 && Number(rv.id) === id &&
    (!rv.era || rv.era === 'online') && rv.status === 'reviewing' && rv.opp_code === code && Number(rv.budget_id) === Number(budgetId) && pend > 0;
  return { id, ok,
    ev: 'create=' + c.status + ((c.data || {}).error ? '(' + c.data.error + ')' : '') + ' id=' + id +
      ' submit=' + s.status + ((s.data || {}).error ? '(' + s.data.error + ')' : '') + ' detail=' + det.status +
      ' era=' + JSON.stringify(rv.era) + ' status=' + JSON.stringify(rv.status) + ' opp_code=' + JSON.stringify(rv.opp_code) +
      ' budget_id=' + JSON.stringify(rv.budget_id) + ' round=' + JSON.stringify(rv.round) + ' 当前轮pending=' + pend };
};
// Finish: 六个真实部门账号只完成「本单 + 当前轮 + pending」任务(绿, 意见空) → 自动研判须 judged 且绿/黄 → 支持组录入结论「同意」→ 归档 → archived
const finishReview = async (sup, rid) => {
  const get = async () => (await raw(sup, '/api/reviews/' + rid)).data || {};
  const d0 = await get(), rv0 = d0.review || {};
  const want = new Set((d0.tasks || []).filter(t => t.round === rv0.round && t.status === 'pending').map(t => t.id));
  let done = 0;
  const bad = [];
  for (const u of FIN_DEPTS) {
    const ts = ((await raw(FIN_T[u], '/api/tasks?scope=mine')).data.tasks || [])
      .filter(t => Number(t.review_id) === Number(rid) && t.round === rv0.round && t.status === 'pending' && want.has(t.id));
    for (const t of ts) {
      const c = await raw(FIN_T[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
      if (c.status === 200) done++; else bad.push(u + '#' + t.id + ':' + c.status + ' ' + (c.data.error || ''));
    }
  }
  const rv1 = (await get()).review || {};
  const dc = await raw(sup, `/api/reviews/${rid}/decision`, 'POST', { decision_result: '同意', decision_note: '夹具结论' });
  const ar = await raw(sup, `/api/reviews/${rid}/archive`, 'POST');
  const rv2 = (await get()).review || {};
  const ok = rv0.status === 'reviewing' && (!rv0.era || rv0.era === 'online') && want.size > 0 && done === want.size && !bad.length &&
    rv1.status === 'judged' && ['green', 'yellow'].includes(rv1.light) && dc.status === 200 && ar.status === 200 &&
    rv2.status === 'archived' && rv2.decision_result === '同意';
  return { ok, archive: ar.status,
    ev: 'rid=' + rid + ' 前态=' + JSON.stringify(rv0.status) + ' era=' + JSON.stringify(rv0.era) + ' round=' + rv0.round + ' 当前轮pending=' + want.size + ' 完成=' + done +
      (bad.length ? ' 失败=' + JSON.stringify(bad) : '') + ' 研判后=' + JSON.stringify(rv1.status) + '/' + JSON.stringify(rv1.light) +
      ' decision=' + dc.status + (dc.data.error ? '(' + dc.data.error + ')' : '') + ' archive=' + ar.status + (ar.data.error ? '(' + ar.data.error + ')' : '') +
      ' 终态=' + JSON.stringify(rv2.status) + ' 结论=' + JSON.stringify(rv2.decision_result) };
};

(async () => {
  const zhichizu = await login('zhichizu');   // C2-01~C2-07 主身份
  const sales = await login('sales1');        // 建档人
  const fde = await login('fde1');            // 非四项角色
  for (const u of FIN_DEPTS) FIN_T[u] = await login(u);   // Finish 夹具: 六个真实部门账号(登录只插 sessions, 不使既有 fde 令牌失效)
  const ANCHOR = 'PL00008572';
  const RED_ANCHOR = 'PL00007297';

  // ---------- C2-01 旧键全在(纯追加, 旧契约不破坏 → 旧代码必须 PASS) ----------
  {
    const r = await raw(zhichizu, `/api/opp/${ANCHOR}/360`);
    const d = r.data || {};
    const okOld = r.status === 200 && Array.isArray(d.reviews) && Array.isArray(d.budgets) && Array.isArray(d.tasks)
      && d.lights && typeof d.lights === 'object' && (d.opp || {}).code === ANCHOR && typeof (d.opp || {}).title === 'string';
    check('C2-01', '旧键全在 reviews/budgets/tasks/lights/opp.code/opp.title', okOld,
      'status=' + r.status + ' reviews=' + ((d.reviews || []).length) + ' budgets=' + ((d.budgets || []).length) +
      ' tasks=' + ((d.tasks || []).length) + ' opp.code=' + JSON.stringify((d.opp || {}).code));
  }

  // ---------- C2-02 delivery 存在且键集恰好等于八项 ----------
  {
    const d = (await raw(zhichizu, `/api/opp/${ANCHOR}/360`)).data || {};
    const dl = d.delivery;
    check('C2-02', 'delivery 键集恰好等于 ' + DELIVERY_KEYS.join('/'), keyset(dl, DELIVERY_KEYS),
      dl ? '实键=' + Object.keys(dl).join('/') : 'delivery 缺失(实键=' + JSON.stringify(Object.keys(d)) + ')');
    check('C2-02', 'status ∈ draft/confirmed 且 rows 为数字>=0',
      !!dl && ['draft', 'confirmed'].includes(dl.status) && typeof dl.rows === 'number' && dl.rows >= 0,
      dl ? 'status=' + dl.status + ' rows=' + JSON.stringify(dl.rows) : 'delivery 缺失');
  }

  // ---------- C2-03 chain 存在且键集恰好等于五项, next_action ∈ 枚举 ----------
  {
    const d = (await raw(zhichizu, `/api/opp/${ANCHOR}/360`)).data || {};
    const ch = d.chain;
    check('C2-03', 'chain 键集恰好等于 ' + CHAIN_KEYS.join('/'), keyset(ch, CHAIN_KEYS),
      ch ? '实键=' + Object.keys(ch).join('/') : 'chain 缺失(实键=' + JSON.stringify(Object.keys(d)) + ')');
    check('C2-03', 'typeof next_action==string 且 ∈ 枚举',
      !!ch && typeof ch.next_action === 'string' && NEXT_ACTIONS.includes(ch.next_action),
      ch ? 'next_action=' + JSON.stringify(ch.next_action) : 'chain 缺失');
  }

  // ---------- C2-04 全链顺序自洽(三条蕴含式同时成立) ----------
  {
    const d = (await raw(zhichizu, `/api/opp/${ANCHOR}/360`)).data || {};
    const ch = d.chain || {}, na = ch.next_action;
    const r1 = ch.delivery_confirmed === false ? na === 'confirm_delivery' : true;
    const r2 = (ch.delivery_confirmed === true && ch.budget_locked === false) ? na === 'lock_budget' : true;
    const r3 = (ch.delivery_confirmed === true && ch.budget_locked === true && ch.reviews_submitted === 0) ? na === 'submit_review' : true;
    check('C2-04', '链序自洽 ①未确认→confirm_delivery / ②未锁定→lock_budget / ③未提交→submit_review',
      !!d.chain && r1 && r2 && r3,
      'delivery_confirmed=' + JSON.stringify(ch.delivery_confirmed) + ' budget_locked=' + JSON.stringify(ch.budget_locked) +
      ' submitted=' + JSON.stringify(ch.reviews_submitted) + ' next_action=' + JSON.stringify(na) + ' 命中规则=' +
      (!ch.delivery_confirmed ? '①' : !ch.budget_locked ? '②' : ch.reviews_submitted === 0 ? '③' : '④/⑤'));
  }

  // ---------- C2-04b(总线 D-41 补件令): 钉住 server.js:1737 `onlineReviews.some(r => r.status === 'reviewing')` 这一支 ----------
  // 旧 23 条为何照不出: C2-04 的三条蕴含式跑在同一 ANCHOR 夹具上实测只命中②(lock_budget), ④'reviewing'/⑤'judged' 两支从无断言 ⇒ 把 some 误写成 every 全件仍绿。
  // 判别力靠夹具: 同码两张**真实在线单**(O 链路, 复用同一份 confirmed 交付预算与同一张 locked 预算单), 先 Finish 其一→archived、另一张仍 reviewing,
  //   使 some=true 而 every=false —— 两种写法在观测值上分道(reviewing / judged), 误写必红。
  // 反证写在同一条内: 再 Finish 剩余一张(两张皆 archived)后 next_action 必须翻 judged, 排除 `cond ? 比对 : true` 式空转(D-41 规范)。
  //   (1737 是 T12 落地时行号; 该支现为 server.js 360 路由 `else if (onlineReviews.some(r => r.status === 'reviewing'))`)
  const c04b = await mkOpp(sales, S + '-c04b');
  OWNED.codes.push(c04b);
  {
    try {
      const pc = await prepCode(sales, c04b);
      if (!pc.ok) throw new Error('前置 ①confirmed/②locked 未就绪 ' + pc.ev);
      const oOpen = await onlineReview(sales, c04b, pc.budgetId, '04b-open');
      const oDone = await onlineReview(sales, c04b, pc.budgetId, '04b-done');
      if (!oOpen.ok || !oDone.ok) throw new Error('O 链路在线单未就绪 open: ' + oOpen.ev + ' || done: ' + oDone.ev);
      const finDone = await finishReview(zhichizu, oDone.id);
      const read = async () => (await raw(zhichizu, `/api/opp/${encodeURIComponent(c04b)}/360`)).data || {};
      const d1 = await read(), ch1 = d1.chain || {};
      const rows1 = d1.reviews || [];
      const ol1 = rows1.filter(r => !r.era || r.era === 'online');
      const st1 = id => (ol1.find(r => Number(r.id) === Number(id)) || {}).status;
      const someNow = ol1.some(r => r.status === 'reviewing');
      const everyNow = ol1.length > 0 && ol1.every(r => r.status === 'reviewing');
      const mid = rows1.length === 2 && ol1.length === 2 && st1(oOpen.id) === 'reviewing' && st1(oDone.id) === 'archived' &&
        someNow && !everyNow && ch1.delivery_confirmed === true && ch1.budget_locked === true &&
        ch1.reviews_total === 2 && ch1.reviews_submitted === 2 && ch1.next_action === 'reviewing';
      const finOpen = await finishReview(zhichizu, oOpen.id);
      const d2 = await read(), ch2 = d2.chain || {};
      const rows2 = d2.reviews || [];
      const ol2 = rows2.filter(r => !r.era || r.era === 'online');
      const end = rows2.length === 2 && ol2.length === 2 && ol2.every(r => r.status === 'archived') &&
        [oOpen.id, oDone.id].every(id => ol2.some(r => Number(r.id) === Number(id))) &&
        ch2.reviews_total === 2 && ch2.reviews_submitted === 2 && ch2.next_action === 'judged';
      check('C2-04b', '在线单一张 reviewing 时 next_action==reviewing, 转入结论态后翻 judged(server.js:1737 some 分支实执行, some→every 误写在此夹具必红; 真实 HTTP: 同码两张在线单先 Finish 一张、再 Finish 另一张)',
        finDone.ok && mid && finOpen.ok && end,
        '前置 confirmed=' + JSON.stringify(ch1.delivery_confirmed) + ' locked=' + JSON.stringify(ch1.budget_locked) +
        ' submitted=' + JSON.stringify(ch1.reviews_submitted) + '/' + JSON.stringify(ch1.reviews_total) +
        ' online状态=' + JSON.stringify(ol1.map(r => r.status)) + ' some=' + someNow + ' every=' + everyNow +
        ' | 在途=' + JSON.stringify(ch1.next_action) + ' 反证(转结论态后)=' + JSON.stringify(ch2.next_action) +
        ' | ids open=' + oOpen.id + ' done=' + oDone.id + ' budget=' + pc.budgetId +
        ' 中态行=' + JSON.stringify(rows1.map(r => [r.id, r.era, r.status])) + ' 终态行=' + JSON.stringify(rows2.map(r => [r.id, r.era, r.status])) +
        ' 终态 submitted=' + JSON.stringify(ch2.reviews_submitted) + '/' + JSON.stringify(ch2.reviews_total) +
        ' | finDone: ' + finDone.ev + ' | finOpen: ' + finOpen.ev);
    } catch (e) {
      check('C2-04b', '执行异常(真实 HTTP 夹具未就绪)', false, e.message);
    }
  }

  // ---------- C2-04c 七月真实红灯单由部门账号链路产生，不用 SQL 伪造状态 ----------
  {
    const d = (await raw(zhichizu, `/api/opp/${RED_ANCHOR}/360`)).data || {};
    const redReturned = (d.reviews || []).some(r => r.status === 'returned' && r.light === 'red');
    check('C2-04c', '真实红灯退回单 next_action==returned, 不得误提示可归档',
      redReturned && (d.chain || {}).next_action === 'returned',
      'returned/red=' + redReturned + ' next_action=' + JSON.stringify((d.chain || {}).next_action));
  }

  // ---------- C2-05 新建档无单商机可进 360(旧代码此处 404 = 红证据) ----------
  const c05 = await mkOpp(sales, S + '-c05');
  {
    const r = await raw(zhichizu, `/api/opp/${encodeURIComponent(c05)}/360`);
    const d = r.data || {};
    check('C2-05', '建档无单 360 返回 200(旧代码 404)', r.status === 200,
      'status=' + r.status + ' error=' + JSON.stringify(d.error || ''));
    check('C2-05', 'opp 含 18 要素键 + code',
      r.status === 200 && OPP_COLS.every(k => (d.opp || {})[k] !== undefined) && (d.opp || {}).code === c05,
      '缺=' + OPP_COLS.filter(k => !d.opp || d.opp[k] === undefined).join(',') + ' code=' + JSON.stringify((d.opp || {}).code));
    check('C2-05', 'chain.next_action==confirm_delivery',
      ((d.chain || {}).next_action) === 'confirm_delivery', '实=' + JSON.stringify((d.chain || {}).next_action));
  }

  // ---------- C2-06 锚定值不漂移: 360 摘要 total_cost ≡ 明细端点 sum.cost ----------
  {
    const agg = (await raw(zhichizu, `/api/opp/${ANCHOR}/360`)).data || {};
    const det = (await raw(zhichizu, `/api/opp/${ANCHOR}/delivery`)).data || {};
    const a = ((agg.delivery || {}).total_cost);
    const b = (((det.delivery || {}).sum || {}).cost);
    check('C2-06', 'PL00008572 两端 total_cost 对账(容差 0.01)', near(a, b, 0.01),
      '360.delivery.total_cost=' + JSON.stringify(a) + ' /delivery sum.cost=' + JSON.stringify(b) +
      ' 差=' + (typeof a === 'number' && typeof b === 'number' ? (a - b).toFixed(4) : 'n/a'));
  }

  // ---------- C2-07 计价基准三件套两端同源 ----------
  {
    const agg = (await raw(zhichizu, `/api/opp/${ANCHOR}/360`)).data || {};
    const det = (await raw(zhichizu, `/api/opp/${ANCHOR}/delivery`)).data || {};
    const dl = agg.delivery || {};
    const inSet = ['budget', 'review', 'none'].includes(dl.rate_source);
    const eq = dl.rate_source === 'budget' ? near(dl.rate, det.rate, 0.001) : true;
    check('C2-07', 'rate_source ∈ budget/review/none 且 budget 分支两端 rate 同值(容差 0.001)', inSet && eq,
      'rate_source=' + JSON.stringify(dl.rate_source) + ' dev_dept=' + JSON.stringify(dl.dev_dept) +
      ' 360.rate=' + JSON.stringify(dl.rate) + ' /delivery rate=' + JSON.stringify(det.rate));
    // 全分支同构实测记录(非断言, 只供总线看数): 两端 rate 取法逐分支同构, 任一分支下都应相等
    LOG.push('  C2-07 全分支对账(非断言): rate_source=' + JSON.stringify(dl.rate_source) +
      ' 360.rate=' + JSON.stringify(dl.rate) + ' detail.rate=' + JSON.stringify(det.rate) +
      ' 相等=' + (dl.rate === det.rate || near(dl.rate, det.rate, 0.001)));
  }

  // ---------- C2-07b(总线 19:38 补件令): 让 D-22 的 `od ? odCalc.rate` 分支在回归里真的被执行一次 ----------
  // 旧套件看不见它: 唯一取 rate 的锚定码 PL00008572 实测 rate_source='none'(最新预算单与最新评审都不带 dev_dept), 两端 rate 恒 null,
  //   于是 D-22 推翻的首发写法 `rp.rate === undefined ? null : rp.rate` 同样产出 null、同样 PASS —— 该分支在全量回归里从未被执行(空转的绿)。
  //   本例用自建码走 PUT /api/opp/:code/delivery 造「有明细 + dev_dept 命中预算档(交付处→1696)」, 强制走 odCalc.rate 这一支并与明细端点两端对拍。
  //   D-5 红线: 不写任何 `|| 默认值`——near() 要求两侧都是 number, 任一为 null 即红。
  const c07b = await mkOpp(sales, S + '-c07b');
  {
    await dlvPut(sales, c07b);      // 有明细: 使 360 的 rate 取 odCalc.rate 分支(无明细才走 rateFor 现算分支)
    await mkBudget(sales, c07b);    // fields.dev_dept=交付处 → oppRateOf 命中 budget 档(source='budget')
    const agg = (await raw(zhichizu, `/api/opp/${encodeURIComponent(c07b)}/360`)).data || {};
    const det = (await raw(zhichizu, `/api/opp/${encodeURIComponent(c07b)}/delivery`)).data || {};
    const dl = agg.delivery || {};
    check('C2-07b', '有明细且 dev_dept 命中预算档: rate_source==budget 且两端 rate 同值(容差 0.001, D-22 分支实执行)',
      dl.rate_source === 'budget' && near(dl.rate, det.rate, 0.001),
      'rate_source=' + JSON.stringify(dl.rate_source) + ' dev_dept=' + JSON.stringify(dl.dev_dept) +
      ' 360.rate=' + JSON.stringify(dl.rate) + ' detail.rate=' + JSON.stringify(det.rate) +
      ' 360.total_cost=' + JSON.stringify(dl.total_cost) + ' detail.sum.cost=' + JSON.stringify(((det.delivery || {}).sum || {}).cost));
  }

  // ---------- C2-08 明细读取收紧, 360 不受伤(链路引导起点仍登录可读) ----------
  const c08 = await mkOpp(sales, S + '-c08');
  {
    await dlvPut(sales, c08);          // 先有行集, 才能证明旧代码的 GET 是 200 而非 404
    await mkBudget(sales, c08);        // 挂靠: 旧代码 360 也返回 200, 使本例只红在「读取门」这一处
    const det = await raw(fde, `/api/opp/${encodeURIComponent(c08)}/delivery`);
    check('C2-08', '非四项角色 fde1 读明细 403(旧代码 200)', det.status === 403,
      'status=' + det.status + ' error=' + JSON.stringify(det.data.error || ''));
    check('C2-08', '403 文案含「交付预算明细」', det.status === 403 && /交付预算明细/.test(String(det.data.error || '')),
      'error=' + JSON.stringify(det.data.error || ''));
    const agg = await raw(fde, `/api/opp/${encodeURIComponent(c08)}/360`);
    check('C2-08', '同角色 fde1 读 360 仍 200(只收明细面, 不伤链路引导)', agg.status === 200,
      'status=' + agg.status + ' error=' + JSON.stringify((agg.data || {}).error || ''));
  }

  // ---------- C2-09 can_write 随身份翻转, 摘要键值不受影响 ----------
  {
    const a = ((await raw(fde, `/api/opp/${encodeURIComponent(c08)}/360`)).data || {}).delivery || {};
    const b = ((await raw(sales, `/api/opp/${encodeURIComponent(c08)}/360`)).data || {}).delivery || {};
    check('C2-09', 'can_write fde1=false / sales=true',
      a.can_write === false && b.can_write === true, 'fde1=' + JSON.stringify(a.can_write) + ' sales=' + JSON.stringify(b.can_write));
    const strip = o => { const c = { ...o }; delete c.can_write; return JSON.stringify(c); };
    check('C2-09', '其余 delivery 键两次逐值相同(能力位不影响摘要)', strip(a) === strip(b),
      'fde1=' + strip(a) + ' sales=' + strip(b));
    // 补充实测(非断言, 不改 C2-07 的授权口径): c08 的 rate_source=budget, 用于观察 D-22 分支在 budget 档的两端同值性
    const det08 = (await raw(zhichizu, `/api/opp/${encodeURIComponent(c08)}/delivery`)).data || {};
    LOG.push('  C2-07 budget 分支补充实测(非断言): code=' + c08 + ' rate_source=' + JSON.stringify(b.rate_source) +
      ' 360.rate=' + JSON.stringify(b.rate) + ' detail.rate=' + JSON.stringify(det08.rate) +
      ' 同值=' + (b.rate === det08.rate || near(b.rate, det08.rate, 0.001)));
  }

  // ---------- C2-10 能力位 ≡ 服务端裁决(三身份行为对账, 守护 can_write 与路由内 canWriteOpp 同源性) ----------
  // 作用域边界(D-34): can_write===false ⇔ 明细 403 只在该 code 有 opps 档案时成立; 无档案在权限求值前就 404, 语义不同, 本例不加 404 分支断言。
  {
    const rows = [];
    for (const [label, tok] of [['建档 sales1', sales], ['支持组 zhichizu', zhichizu], ['非四项 fde1', fde]]) {
      const dl = ((await raw(tok, `/api/opp/${encodeURIComponent(c08)}/360`)).data || {}).delivery || {};
      const det = await raw(tok, `/api/opp/${encodeURIComponent(c08)}/delivery`);
      rows.push({ label, can_write: dl.can_write, http: det.status });
      check('C2-10', label + ' can_write=' + JSON.stringify(dl.can_write) + ' ⇔ 明细 ' + det.status,
        dl.can_write === true ? det.status === 200 : dl.can_write === false && det.status === 403,
        'detail_error=' + JSON.stringify(det.data.error || ''));
    }
    LOG.push('  C2-10 三身份对账表: ' + JSON.stringify(rows));
  }

  // ---------- C2-11 链态只数在线单(D-25), 历史单仍留在 reviews 列表 ----------
  // 夹具(2026-10-21 改真实 HTTP): 配对 fresh code 各自 ①confirmed+②locked(prepCode); H 码只做支持组历史补录(era=history/archived/none),
  //   O 码走 O 链路 + Finish(era 空/online, archived)。360 链态只读 era/status(server.js 360 路由 onlineReviews 过滤), 两码 ①② 同就绪、单据同为 archived, 唯一差异是 era。
  // era 过滤变异见证保留: 去掉 `!r.era || r.era === 'online'` 过滤 ⇒ H 码实得 reviews_total=1/submitted=1/judged, 第 2 条必红; O 码第 3 条是同态 archived 在线单的正对照。
  // 披露: 原第 3 条「同单改回 era=online」靠 SQL UPDATE 改 era, 同一行 era 翻转无 HTTP 产地, 已删除, 本块不声称同一行变 era——
  //   unsupported identity coverage replaced by paired-code business comparison
  {
    const c11h = await mkOpp(sales, S + '-c11h');
    const c11o = await mkOpp(sales, S + '-c11o');
    OWNED.codes.push(c11h, c11o);
    try {
      const ph = await prepCode(sales, c11h);
      const po = await prepCode(sales, c11o);
      check('C2-11', '前置 两码各自 ①confirmed+②locked 就绪(配对 fresh code)', ph.ok && po.ok,
        'H码 ' + c11h + ': ' + ph.ev + ' | O码 ' + c11o + ': ' + po.ev);
      const h = await importHistory(zhichizu, c11h, 'c11h');
      const dh = (await raw(zhichizu, `/api/opp/${encodeURIComponent(c11h)}/360`)).data || {};
      const chH = dh.chain || {}, lgH = dh.lights || {}, rowsH = dh.reviews || [];
      const sumH = Object.values(lgH).reduce((a, b) => a + (Number(b) || 0), 0);
      check('C2-11', 'H 码只有真实历史导入单: reviews 列表恰 1 行(=导入 id, history/archived/none)且 lights 合计 1, 但 chain 计数为 0/0 且 next_action=submit_review',
        h.ok && rowsH.length === 1 && Number(rowsH[0].id) === h.id && rowsH[0].era === 'history' && rowsH[0].status === 'archived' &&
        rowsH[0].light === 'none' && lgH.none === 1 && sumH === 1 && chH.delivery_confirmed === true && chH.budget_locked === true &&
        chH.reviews_total === 0 && chH.reviews_submitted === 0 && chH.next_action === 'submit_review',
        'import: ' + h.ev + ' | 360 行=' + JSON.stringify(rowsH.map(r => [r.id, r.era, r.status, r.light])) + ' lights=' + JSON.stringify(lgH) +
        ' delivery.status=' + JSON.stringify((dh.delivery || {}).status) + ' budget_locked=' + JSON.stringify(chH.budget_locked) +
        ' reviews_total=' + JSON.stringify(chH.reviews_total) + ' reviews_submitted=' + JSON.stringify(chH.reviews_submitted) +
        ' next_action=' + JSON.stringify(chH.next_action));
      const o = await onlineReview(sales, c11o, po.budgetId, 'c11o');
      const fin = o.ok ? await finishReview(zhichizu, o.id) : { ok: false, ev: '在线单未就绪, 未执行 Finish' };
      const dO = (await raw(zhichizu, `/api/opp/${encodeURIComponent(c11o)}/360`)).data || {};
      const chO = dO.chain || {}, rowsO = dO.reviews || [];
      check('C2-11', 'O 码真实在线单全链(提交→六部门→研判→同意→归档): reviews 恰 1 行(=该 id, online/archived), chain 1/1 且 next_action=judged(配对码业务对照, 非同一行改 era)',
        o.ok && fin.ok && rowsO.length === 1 && Number(rowsO[0].id) === o.id && (!rowsO[0].era || rowsO[0].era === 'online') &&
        rowsO[0].status === 'archived' && chO.delivery_confirmed === true && chO.budget_locked === true &&
        chO.reviews_total === 1 && chO.reviews_submitted === 1 && chO.next_action === 'judged',
        'online: ' + o.ev + ' | finish: ' + fin.ev + ' | 360 行=' + JSON.stringify(rowsO.map(r => [r.id, r.era, r.status, r.light])) +
        ' reviews_total=' + JSON.stringify(chO.reviews_total) + ' reviews_submitted=' + JSON.stringify(chO.reviews_submitted) +
        ' next_action=' + JSON.stringify(chO.next_action));
      LOG.push('  C2-11 era 过滤配对对照(非断言): H码 ' + c11h + ' ' + JSON.stringify(rowsH.map(r => [r.id, r.era, r.status])) + ' → ' +
        JSON.stringify([chH.reviews_total, chH.reviews_submitted, chH.next_action]) + ' vs O码 ' + c11o + ' ' + JSON.stringify(rowsO.map(r => [r.id, r.era, r.status])) +
        ' → ' + JSON.stringify([chO.reviews_total, chO.reviews_submitted, chO.next_action]) +
        ' | DISCLOSURE: unsupported identity coverage replaced by paired-code business comparison');
    } catch (e) {
      check('C2-11', '执行异常(真实 HTTP 夹具未就绪)', false, e.message);
    }
  }
  gap('C2-11-identity', 'same-row era flip identity coverage gap(不可计为PASS)', 'unsupported identity coverage replaced by paired-code business comparison; 同一行 history→online 改 era 无已授权 HTTP 产地(历史导入恒 era=history/archived, 无改 era 端点), 原 SQL UPDATE 已删除; 配对码只钉 era 过滤, 不证同一行身份/来源转换');

  // ================= C3: 商机要素 profile/prefill + 实例 siblings + 兼容冻结(spec 2026-10-19 §11.1, 夹具全走带鉴权 HTTP) =================
  {
    const { spawnSync } = require('child_process');
    const DEPTS = ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']; // 与 tests/test_budget_api.js:50 同源
    const deptT = {};
    for (const u of DEPTS) deptT[u] = await login(u);
    const zhichi = await login('zhichizu');
    const C = 'PL-C3-' + S; // 每轮唯一: upsertOpp 只补档永不覆盖
    const OPP_FIELDS = ['title', 'customer', 'region', 'province', 'biz_line', 'contract_amount', 'opp_stage', 'sign_date', 'sales', 'pm', 'survey', 'summary'];
    const OPP_REQUIRED = ['title', 'customer', 'biz_line', 'contract_amount', 'opp_stage', 'sales', 'summary'];
    const LIGHT_KEYS = ['red', 'yellow', 'green', 'none'];
    const mkOppC = async code => { const r = await raw(zhichi, '/api/opp', 'POST', { ...TEST_OPP('X'), opp_code: code, summary: 'C3 夹具商机' }); if (r.status >= 400) throw new Error('opp ' + r.status + ' ' + JSON.stringify(r.data)); };
    const BID_FORM = { customer: '江西省自然资源测绘与监测院', biz_line: 'G1', contract_amount: 240, gross_margin: 30, ops_years: 1, sign_path: '示例:A公司→丰图科技(深圳)有限公司', survey: '否', secret: '否', settle_method: '银行转账', guarantee: '否', non_compete: '否', payment_terms: '验收后30天付款', summary: 'C3 投标概述', data_review: '否' };
    const PSALE_FORM = { customer: '江西省自然资源测绘与监测院', biz_line: 'G1', contract_amount: 240, sign_date: '2026-12-31', survey: '否', sub_early_flag: '否', presale_invest: 10, presale_period: 2, summary: 'C3 售前概述' };
    const CHG_FORM = { biz_line: 'G1', proj_stage: '实施中', change_type: '项目成本变动', summary: 'C3 变更概述' };
    // 非草稿在线单(spec §11.1 链, 顺序不可颠倒): dlvPut→dlvConfirm→budget→lock→reviews(submit:false)→submit
    // 通用预算证据门(server :2074): 任何类型提交都须 附件'项目预算表'/budget_json/budget_id 至少其一; change 免预算单故走附件(与 tests/test_budget_api.js:146 同机制)
    const mkOnline = async (type, code, form, title) => {
      let bid = null;
      if (type !== 'change') {
        const p1 = await dlvPut(zhichi, code); if (p1.status >= 400) throw new Error('dlv ' + p1.status + ' ' + JSON.stringify(p1.data));
        const p2 = await dlvConfirm(zhichi, code); if (p2.status >= 400) throw new Error('dlvConfirm ' + p2.status + ' ' + JSON.stringify(p2.data));
        bid = await mkBudget(zhichi, code);
        const p3 = await raw(zhichi, '/api/budget/' + bid + '/lock', 'POST', {}); if (p3.status >= 400) throw new Error('lock ' + p3.status + ' ' + JSON.stringify(p3.data));
      }
      const p4 = await raw(zhichi, '/api/reviews', 'POST', { type, title, form: { ...form, opp_code: code }, ...(bid ? { budget_id: bid } : {}), submit: false });
      if (p4.status >= 400) throw new Error('review ' + p4.status + ' ' + JSON.stringify(p4.data));
      const id = p4.data.id;
      if (!bid) {
        const pa = await raw(zhichi, '/api/reviews/' + id + '/attachments', 'POST', { field: '项目预算表', filename: 'c3chg.xlsx', data: Buffer.from('c3budget').toString('base64') });
        if (pa.status >= 400) throw new Error('att ' + pa.status + ' ' + JSON.stringify(pa.data));
      }
      const p5 = await raw(zhichi, '/api/reviews/' + id + '/submit', 'POST', {});
      if (p5.status >= 400) throw new Error('submit ' + p5.status + ' ' + JSON.stringify(p5.data));
      return id;
    };
    const mkDraft = async (type, code, form, title) => {
      const r = await raw(zhichi, '/api/reviews', 'POST', { type, title, form: { ...form, opp_code: code }, submit: false });
      if (r.status >= 400) throw new Error('draft ' + r.status + ' ' + JSON.stringify(r.data));
      return r.data.id;
    };
    // 夹具卫生(spec §11): 经 submit 进入 reviewing 的夹具, 断言后把当前轮 pending 逐条 complete 打到 0(部门账号)
    const drain = async reviewId => {
      for (const u of DEPTS) {
        const d = await api(deptT[u], '/api/tasks?scope=mine');
        for (const t of (d.tasks || [])) if (String(t.review_id) === String(reviewId) && t.status === 'pending')
          await api(deptT[u], '/api/tasks/' + t.id + '/complete', 'POST', { light: 'green', opinion: '' });
      }
    };
    // 历史单走真实 import mode=history(与 tests/test_history_import.js:28 同机制: python openpyxl 生成最小 xlsx)
    const mkHistXlsx = rows => {
      const py = 'import openpyxl, json, sys\nrows = json.loads(sys.argv[1])\nwb = openpyxl.Workbook()\nws = wb.active\nws.title = \'附1-预算表\'\nfor r in rows:\n    ws.append(r)\nwb.save(sys.argv[2])\n';
      const tmp = path.join(__dirname, '_c3hi' + Date.now() + '.xlsx');
      const r = spawnSync('python', ['-X', 'utf8', '-c', py, JSON.stringify(rows), tmp], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('mkHistXlsx fail: ' + r.stderr);
      return tmp;
    };
    const histImport = async (code, type, name, customer) => {
      const rows = [['商机代码', code], ['项目名称', name], ['客户名称', customer], ['合同金额', 240000], ['分包采购成本', 0], ['所属部门', '交付处'], ['评审结论', '同意通过'], ['评审日期', '2024-05-12']];
      const f = mkHistXlsx(rows);
      const r = await raw(zhichi, '/api/reviews/import', 'POST', { filename: '历史.xlsx', type, mode: 'history', data: fs.readFileSync(f).toString('base64') });
      if (r.status >= 400) throw new Error('histImport ' + r.status + ' ' + JSON.stringify(r.data));
      return r.data.id;
    };
    const g360 = async code => api(zhichi, '/api/opp/' + encodeURIComponent(code) + '/360');
    const gPf = async (code, type) => api(zhichi, '/api/opp/' + encodeURIComponent(code) + '/prefill?type=' + type);

    // ---- C3-01: 360 顶层 profile(12 键 + missing ⊆ OPP_REQUIRED) + 旧键仍全在 ----
    try {
      const c1 = C + '01';
      await mkOppC(c1);
      const rid1 = await mkOnline('bid', c1, BID_FORM, '[T]C3-01 投标单');
      await drain(rid1);
      const d = await g360(c1);
      check('C3-01', '360 顶层 profile: fields/sources 恰 12 键 + missing⊆OPP_REQUIRED + 旧键全在',
        !!d.profile && keyset(d.profile.fields, OPP_FIELDS) && keyset(d.profile.sources, OPP_FIELDS)
        && (d.profile.missing || []).every(k => OPP_REQUIRED.includes(k))
        && ['opp', 'reviews', 'budgets', 'tasks', 'lights', 'delivery', 'chain'].every(k => k in d),
        'profile 键=' + (d.profile ? Object.keys(d.profile).join(',') : '无') + ' missing=' + JSON.stringify(d.profile && d.profile.missing));
      // ---- C3-02: reviews[] 三新键(挂预算) + 无预算单为 null ----
      const rv = (d.reviews || [])[0] || {};
      const bg = (d.budgets || [])[0] || {};
      check('C3-02', 'reviews[] 含 budget_id/budget_code/applicant_name 且 budget_code=预算码',
        'budget_id' in rv && 'budget_code' in rv && 'applicant_name' in rv && rv.budget_code === bg.code && rv.budget_id === bg.id,
        'rv.budget_id=' + rv.budget_id + ' budget_code=' + rv.budget_code + ' 预算码=' + bg.code);
      const c2 = C + '02';
      await mkOppC(c2);
      const rid2 = await mkOnline('change', c2, CHG_FORM, '[T]C3-02 变更单(无预算)');
      await drain(rid2);
      const d2 = await g360(c2);
      const rv2 = (d2.reviews || [])[0] || {};
      check('C3-02', '无预算单 reviews[].budget_id/budget_code 为 null', rv2.budget_id === null && rv2.budget_code === null, JSON.stringify({ budget_id: rv2.budget_id, budget_code: rv2.budget_code }));
      // ---- C3-03: 同码两张单 reviews.length===2 且 updated_at DESC, id DESC; chain 五键与 lights 四档不变 ----
      const c3 = C + '03';
      await mkOppC(c3);
      const rA = await mkOnline('presale', c3, PSALE_FORM, '[T]C3-03 售前单');
      await drain(rA);
      const rB = await mkOnline('bid', c3, BID_FORM, '[T]C3-03 投标单');
      await drain(rB);
      const d3 = await g360(c3);
      check('C3-03', '同码两张单: length===2 且排序 updated_at DESC,id DESC; chain 五键/lights 四档不变',
        (d3.reviews || []).length === 2 && d3.reviews[0].id === rB && d3.reviews[1].id === rA
        && keyset(d3.chain || {}, CHAIN_KEYS) && keyset(d3.lights || {}, LIGHT_KEYS),
        'ids=' + JSON.stringify((d3.reviews || []).map(r => r.id)) + ' 期望=[' + rB + ',' + rA + ']');
    } catch (e) { check('C3-01', 'profile/reviews 三键/同码排序(块内异常)', false, 'EX:' + String(e.message).slice(0, 200)); check('C3-02', '(块内异常)', false, ''); check('C3-03', '(块内异常)', false, ''); }

    // ---- C3-04: prefill 同类型优先, 草稿不入选 ----
    try {
      const c4 = C + '04';
      await mkOppC(c4);
      const r1 = await mkOnline('presale', c4, { ...PSALE_FORM, customer: 'C3同型客户', region: '同型区' }, '[T]C3-04 售前旧单');
      await drain(r1);
      const r2 = await mkOnline('bid', c4, { ...BID_FORM, customer: 'C3跨型客户' }, '[T]C3-04 投标新单');
      await drain(r2);
      await mkDraft('presale', c4, { ...PSALE_FORM, customer: 'C3草稿客户' }, '[T]C3-04 售前草稿');
      const pf = await gPf(c4, 'presale');
      check('C3-04', 'prefill presale: 同类型旧值胜过跨类型新值, 草稿不入选',
        pf.fields.customer === 'C3同型客户' && (pf.sources.customer || {}).source === 'review' && (pf.sources.customer || {}).scope === 'same',
        'customer=' + JSON.stringify(pf.fields.customer) + ' src=' + JSON.stringify(pf.sources.customer));
    } catch (e) { check('C3-04', 'prefill 同类型优先(旧码无 prefill 应红)', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-05: 跨类型只走 CROSS_TYPE_KEYS; summary 不跨类; change.summary 不取档案 ----
    try {
      const c5 = C + '05';
      await mkOppC(c5);
      await raw(zhichi, '/api/opp/' + encodeURIComponent(c5), 'PUT', { summary: 'C5档案概述', customer: 'C5档案客' });
      const r1 = await mkOnline('presale', c5, { ...PSALE_FORM, region: 'C5华东跨型', summary: 'C5售前概述' }, '[T]C3-05 售前单');
      await drain(r1);
      const pfB = await gPf(c5, 'bid');
      check('C3-05', '跨类型 CROSS 键可取(bid.region ← presale)', pfB.fields.region === 'C5华东跨型' && (pfB.sources.region || {}).scope === 'cross', 'region=' + JSON.stringify(pfB.fields.region));
      const pfC = await gPf(c5, 'change');
      check('C3-05', 'change.summary 不跨类且不取档案 → null', pfC.fields.summary === null && pfC.sources.summary === null, 'summary=' + JSON.stringify(pfC.fields.summary));
      const pfP = await gPf(c5, 'presale');
      check('C3-05', 'presale.summary 只取同类型(不取档案/跨类)', pfP.fields.summary === 'C5售前概述' && (pfP.sources.summary || {}).source === 'review', 'summary=' + JSON.stringify(pfP.fields.summary));
    } catch (e) { check('C3-05', '跨类型/summary 隔离(旧码无 prefill 应红)', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-06: 0 原样返回且非空; ''/缺省视为空 ----
    try {
      const c6 = C + '06';
      await mkOppC(c6);
      await raw(zhichi, '/api/opp/' + encodeURIComponent(c6), 'PUT', { sales: '' }); // 档案 sales 也清空, 否则级联兜底出非 null 干扰本条断言
      const r1 = await mkOnline('presale', c6, { ...PSALE_FORM, contract_amount: 0, sales: '' }, '[T]C3-06 零值单');
      await drain(r1);
      const pf = await gPf(c6, 'presale');
      check('C3-06', '0 原样返回且来源为评审; 空串字段为 null',
        pf.fields.contract_amount === 0 && (pf.sources.contract_amount || {}).source === 'review' && pf.fields.sales === null && pf.sources.sales === null,
        'contract_amount=' + JSON.stringify(pf.fields.contract_amount) + ' sales=' + JSON.stringify(pf.fields.sales));
    } catch (e) { check('C3-06', '0/空串语义(旧码无 prefill 应红)', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-07: 无评审时档案兜底; missing 随合法 PUT 变化; 404/400/401 ----
    try {
      const c7 = C + '07';
      await mkOppC(c7);
      await raw(zhichi, '/api/opp/' + encodeURIComponent(c7), 'PUT', { sales: '王超' });
      let pf = await gPf(c7, 'presale');
      const d7 = await g360(c7);
      check('C3-07', '无评审: fields 由档案兜底 + sources.source=archive + missing=[]',
        pf.fields.customer === '江西省自然资源测绘与监测院' && (pf.sources.customer || {}).source === 'archive'
        && (pf.fields.sales === '王超' || pf.fields.sales === null) && JSON.stringify(d7.profile.missing) === '[]',
        'customer=' + JSON.stringify(pf.fields.customer) + ' src=' + JSON.stringify(pf.sources.customer) + ' missing=' + JSON.stringify(d7.profile.missing));
      await raw(zhichi, '/api/opp/' + encodeURIComponent(c7), 'PUT', { sales: '' });
      const d7b = await g360(c7);
      check('C3-07', '合法 HTTP PUT 清空必填后 missing=[sales]', JSON.stringify(d7b.profile.missing) === '["sales"]', 'missing=' + JSON.stringify(d7b.profile.missing));
      await raw(zhichi, '/api/opp/' + encodeURIComponent(c7), 'PUT', { sales: '王超' }); // 卫生: 还原
      const p404 = await raw(zhichi, '/api/opp/' + encodeURIComponent(C + 'NOPE') + '/prefill?type=bid', 'GET');
      const p400 = await raw(zhichi, '/api/opp/' + encodeURIComponent(c7) + '/prefill?type=nope', 'GET');
      const p401 = await raw(null, '/api/opp/' + encodeURIComponent(c7) + '/prefill?type=bid', 'GET');
      check('C3-07', '未知码 404 / 非法 type 400 / 未登录 401',
        p404.status === 404 && p400.status === 400 && p401.status === 401,
        '404=' + p404.status + ' 400=' + p400.status + ' 401=' + p401.status);
    } catch (e) { check('C3-07', '档案兜底/missing/404-400-401(旧码无 prefill 应红)', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-08: 五级来源优先级(每码逐级去掉更高层, 观测胜者) ----
    try {
      const cA = C + '08a', cB = C + '08b', cC = C + '08c', cD = C + '08d', cE = C + '08e';
      for (const c of [cA, cB, cC, cD, cE]) await mkOppC(c);
      for (const c of [cA, cB, cC, cD, cE]) await raw(zhichi, '/api/opp/' + encodeURIComponent(c), 'PUT', { customer: '档' + c.slice(-3) });
      const r1 = await mkOnline('presale', cA, { ...PSALE_FORM, customer: '同型在A' }, '[T]C3-08 售前A'); await drain(r1);
      const r2 = await mkOnline('bid', cA, { ...BID_FORM, customer: '跨型在A' }, '[T]C3-08 投标A'); await drain(r2);
      await histImport(cA, 'presale', '历史同A', '历史同A客');
      await histImport(cA, 'change', '历史跨A', '历史跨A客');
      const pfA = await gPf(cA, 'presale');
      check('C3-08', 'L1 在线同型 > 其余四级', pfA.fields.customer === '同型在A', 'customer=' + JSON.stringify(pfA.fields.customer));
      const r3 = await mkOnline('bid', cB, { ...BID_FORM, customer: '跨型在B' }, '[T]C3-08 投标B'); await drain(r3);
      await histImport(cB, 'presale', '历史同B', '历史同B客');
      const pfB = await gPf(cB, 'presale');
      check('C3-08', 'L2 在线跨型 > L3/L4/L5', pfB.fields.customer === '跨型在B', 'customer=' + JSON.stringify(pfB.fields.customer));
      await histImport(cC, 'presale', '历史同C', '历史同C客');
      await histImport(cC, 'change', '历史跨C', '历史跨C客');
      const pfC = await gPf(cC, 'presale');
      check('C3-08', 'L3 历史同型 > L4/L5', pfC.fields.customer === '历史同C客', 'customer=' + JSON.stringify(pfC.fields.customer));
      await histImport(cD, 'change', '历史跨D', '历史跨D客');
      const pfD = await gPf(cD, 'presale');
      check('C3-08', 'L4 历史跨型 > L5 档案', pfD.fields.customer === '历史跨D客', 'customer=' + JSON.stringify(pfD.fields.customer));
      const pfE = await gPf(cE, 'presale');
      check('C3-08', 'L5 档案兜底(kind=archive,scope=archive)', pfE.fields.customer === '档' + cE.slice(-3) && (pfE.sources.customer || {}).source === 'archive' && (pfE.sources.customer || {}).scope === 'archive', 'customer=' + JSON.stringify(pfE.fields.customer));
    } catch (e) { check('C3-08', '五级来源优先级(旧码无 prefill 应红)', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-09: siblings 不含自身/只含同商机/按更新时间倒序 ----
    try {
      const c9 = C + '09', c9x = C + '09x';
      await mkOppC(c9); await mkOppC(c9x);
      const draftId = await mkDraft('bid', c9, BID_FORM, '[T]C3-09 草稿单');
      const onId = await mkOnline('presale', c9, PSALE_FORM, '[T]C3-09 在线单');
      await drain(onId);
      const otherId = await mkDraft('bid', c9x, BID_FORM, '[T]C3-09 异码单');
      const sOn = (await api(zhichi, '/api/reviews/' + onId)).siblings || [];
      const sDr = (await api(zhichi, '/api/reviews/' + draftId)).siblings || [];
      check('C3-09', 'siblings 排除自身+只含同码+倒序(在线单视角只见草稿)',
        sOn.length === 1 && sOn[0].id === draftId && !sOn.some(x => x.id === onId) && !sOn.some(x => x.id === otherId),
        'siblings=' + JSON.stringify(sOn.map(x => x.id)));
      check('C3-09', '异码单不在 siblings', sDr.length === 1 && sDr[0].id === onId, 'draft 视角=' + JSON.stringify(sDr.map(x => x.id)));
    } catch (e) { check('C3-09', 'siblings 语义(旧码无该键应红)', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-10: 两实例 tasks/events/attachments 互不串 ----
    // B 用 change 型(无预算门, 可直接 submit); bid 草稿无 budget_id 永远过不了 G3(reviews.budget_id 零 UPDATE, spec 缺口A), 不能走「draft→submit」
    try {
      const c10 = C + '10';
      await mkOppC(c10);
      const idA = await mkDraft('bid', c10, BID_FORM, '[T]C3-10 实例A');
      const idB = await mkOnline('change', c10, CHG_FORM, '[T]C3-10 实例B');
      const att = { field: '项目预算表', filename: 'c3.xlsx', data: Buffer.from('c3att').toString('base64') };
      await api(zhichi, '/api/reviews/' + idA + '/attachments', 'POST', att);
      const dA = await api(zhichi, '/api/reviews/' + idA);
      const dB0 = await api(zhichi, '/api/reviews/' + idB);
      check('C3-10', '附件归属: A 有 c3.xlsx, B 无',
        (dA.attachments || []).some(a => a.filename === 'c3.xlsx') && !(dB0.attachments || []).some(a => a.filename === 'c3.xlsx'),
        'A附件=' + JSON.stringify((dA.attachments || []).map(a => a.filename)));
      const dB = await api(zhichi, '/api/reviews/' + idB);
      check('C3-10', '提交产生的 tasks/events 只归 B: B 有任务且 review_id 全=B, A 无任务',
        (dB.tasks || []).length >= 1 && (dB.tasks || []).every(t => String(t.review_id) === String(idB))
        && (dA.tasks || []).length === 0
        && (dB.events || []).some(e => /提交|分发/.test(e.action || '')) && !(dA.events || []).some(e => /提交|分发/.test(e.action || '')),
        'B.tasks=' + (dB.tasks || []).length + ' A.tasks=' + (dA.tasks || []).length);
      await drain(idB); // 卫生: pending 清零
    } catch (e) { check('C3-10', '两实例隔离', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-11: 提交→部门退回→owner 重提: 仍 1 条 + round=2 + tasks 覆盖两轮 ----
    try {
      const c11 = C + '11';
      await mkOppC(c11);
      const rid = await mkOnline('bid', c11, BID_FORM, '[T]C3-11 退回重提单');
      const mine = await api(deptT.fde1, '/api/tasks?scope=mine');
      const t1 = (mine.tasks || []).find(t => String(t.review_id) === String(rid) && t.status === 'pending');
      if (!t1) throw new Error('fde1 无该单 pending 任务');
      const ret = await raw(deptT.fde1, '/api/tasks/' + t1.id + '/return', 'POST', { opinion: 'C3 退回验证' });
      if (ret.status >= 400) throw new Error('return ' + ret.status + ' ' + JSON.stringify(ret.data));
      const d1 = await api(zhichi, '/api/reviews/' + rid);
      check('C3-11', '部门退回后 status=returned 且未判灯(light=null; server :2649 只改状态, red 仅来自研判红灯自动打回)', d1.review.status === 'returned' && (d1.review.light ?? null) === null, 'st=' + d1.review.status + '/' + d1.review.light);
      const sub = await raw(zhichi, '/api/reviews/' + rid + '/submit', 'POST', {});
      if (sub.status >= 400) throw new Error('resubmit ' + sub.status + ' ' + JSON.stringify(sub.data));
      const d2 = await api(zhichi, '/api/reviews/' + rid);
      const d360 = await g360(c11);
      check('C3-11', '重提后仍 1 条 + round=2 + 两轮 tasks 并存',
        (d360.reviews || []).length === 1 && d2.review.round === 2
        && (d2.tasks || []).some(t => t.round === 1) && (d2.tasks || []).some(t => t.round === 2 && t.status === 'pending'),
        'round=' + d2.review.round + ' rounds=' + JSON.stringify([...new Set((d2.tasks || []).map(t => t.round))]));
      await drain(rid); // 卫生: 二轮 pending 清零(触发的自动研判属服务端正常流程)
    } catch (e) { check('C3-11', '退回重提轮次语义', false, 'EX:' + String(e.message).slice(0, 200)); }

    // ---- C3-12: 兼容冻结: delivery 恰 8 键 / chain 恰 5 键 / opp 18 列 / lights 四档 ----
    try {
      const c12 = C + '12';
      await mkOppC(c12);
      const d = await g360(c12);
      check('C3-12', 'delivery 8 键 + chain 5 键 + opp 18 列(+code) + lights 四档(旧码即绿)',
        keyset(d.delivery || {}, DELIVERY_KEYS) && keyset(d.chain || {}, CHAIN_KEYS)
        && OPP_COLS.every(k => (d.opp || {})[k] !== undefined) && (d.opp || {}).code === c12
        && keyset(d.lights || {}, LIGHT_KEYS),
        'delivery=' + Object.keys(d.delivery || {}).sort().join(',') + ' chain=' + Object.keys(d.chain || {}).sort().join(','));
    } catch (e) { check('C3-12', '兼容冻结', false, 'EX:' + String(e.message).slice(0, 200)); }
  }

  const owned = 'OWNED(新 HTTP 夹具) run=' + S + ' codes=' + JSON.stringify(OWNED.codes) + ' reviews=' + JSON.stringify(OWNED.reviews) +
    ' budgets=' + JSON.stringify(OWNED.budgets) + ' | 本轮自建码前缀 PL-T5-' + S + '-* / PL-C3-' + S + '* | 清理: 仅靠父级守护恢复演示库与 uploads, 本套无 SQL 清理';
  console.log(owned); LOG.push(owned);
  for (const g of GAPS) console.log('NOT EXECUTABLE ' + g);
  // 有缺口时不得输出 ALL PASS: 缺口数与文案进 summary 行(run_all 每套只截尾 6 行)
  const verdict = fail ? 'HAS FAIL' : (GAPS.length ? 'EXECUTED PASS + ' + GAPS.length + ' COVERAGE GAP(不可计为全绿)' : 'ALL PASS');
  LOG.push('');
  LOG.push(`${pass} passed, ${fail} failed, ${GAPS.length} NOT EXECUTABLE -> ${verdict}` + (GAPS.length ? ' [' + GAPS.join('; ') + ']' : '') +
    ' [DISCLOSURE: C2-11 unsupported identity coverage replaced by paired-code business comparison]');
  console.log('\n' + LOG[LOG.length - 1]);
  const arg = process.argv.find(a => a.startsWith('--log='));
  if (arg) fs.writeFileSync(path.resolve(arg.slice(6)), LOG.join('\n') + '\n', 'utf8');
  process.exitCode = fail === 0 ? 0 : 1;
})().catch(e => { console.log('FATAL ' + e.message); LOG.push('FATAL ' + e.message); process.exitCode = 2; });
