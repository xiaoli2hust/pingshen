// V4.0 三步链硬门禁 G2/G3/G4 用例 CH-01~CH-16b(服务运行中)
// 用法: node tests/test_chain.js [--log=tests/red_chain_v4.txt]
// 红基线: 旧代码 G2 只看 budget_delivery 有无行(有挂靠商机也一样放行, 不判 confirmed)、G3 提交无二次核验、G4 归档不翻转 opps.status
//   预期红: CH-01/02/05/06/07后半/09/11a/14/16b(11b 已移除, 见下)   预期绿(不破坏现网): CH-03/04/08/10/13/15/16
// CH-11(2026-10-21 SQL 夹具替换): 11a 的已归档历史单改由支持组真实历史导入(POST /api/reviews/import mode=history)产生, 在线单走真实提交→六部门完成→自动研判→结论→归档;
//   11b 需要「未归档的 era=history 行」, 已授权 HTTP 无此产地(历史导入恒 archived; submit/judge 不接 archived; 无改 era 端点), 直连 DB 造假已删除,
//   运行时打印 NOT EXECUTABLE CH-11b legacy-state G4 mutation coverage gap(不可计为PASS), summary 行携带缺口数与文案
// CH-16/16b 由总线 D-23 追加(提交 3384181): G3 商机码只认 budgets.opp_code, 禁止兜底取 reviews.opp_code——
//   CH-16 钉住「无挂靠锁定单+表单带码仍可提交」, CH-16b 钉住「同商机经挂靠路径仍拦」, 互为反事实
//   注: CH-16b 的红证据等价于已留档 tests/red_chain_v4.txt 中的 CH-06/CH-09(旧代码无 G3, 同构造返回 200)
// CH-12 是回退开关规程(临时改 DELIVERY_REQUIRED_TYPES 常量后重跑本套), 不是本文件里的用例行
// 载荷口径(task-4-brief §5.2): 所有走 submit 的 form 内含该类型 req 全集(bid 14 / presale 9 / change 4),
//   期待 400 的用例同样齐全——否则 400 文案会变成「必填缺失」而测不到真正的三步链门
// 建链一律走 T2 商机级端点(PUT /api/opp/:code/delivery + /confirm), 无挂靠对照面走 PUT /api/budget/:id/delivery
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

// ---------- 统一建链工具(商机级交付预算走 T2 新端点) ----------
// 码带短运行 id(36 进制毫秒尾 6 位 + 2 字节随机 hex, 共 10 位): 重跑/并发不撞既有档案(CH-01 的「尚无明细行」前置态必须每轮干净)
const S = Date.now().toString(36).slice(-6) + crypto.randomBytes(2).toString('hex');
const OPP = n => ({ opp_code: 'PL-T3-' + n, title: 'T3链商机-' + n, customer: '江西省自然资源测绘与监测院',
  region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策',
  sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: '三步链门禁用例' });
const BF = (code) => ({ project_name: 'T3 链预算', customer: '江西省自然资源测绘与监测院', contract: 2400000,
  sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, opp_code: code });
const mkRows = () => [{ content: '实施', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 },
  { content: '运维', stage: '运维', pm_pd: 2 }];
// 建档失败不抛(保证逐用例红证据成片, 不在首个端点崩掉整套)
const mkOpp = async (t, n) => { await raw(t, '/api/opp', 'POST', OPP(n)); return 'PL-T3-' + n; };
const mkBudget = async (t, code) => (await raw(t, '/api/budget', 'POST', { project_name: 'T3 链预算', opp_code: code, fields: BF(code) })).data.id || 0;
const dlvPut = (t, code) => raw(t, `/api/opp/${encodeURIComponent(code)}/delivery`, 'PUT', { rows: mkRows() });
const dlvConfirm = (t, code) => raw(t, `/api/opp/${encodeURIComponent(code)}/delivery/confirm`, 'POST', {});
const oppStatus = async (t, code) => String(((await raw(t, `/api/opp/${encodeURIComponent(code)}`)).data.opp || {}).status || '');

// ①交付预算 confirmed 的完整前置(链①就绪)
const chain1 = async (code) => { await dlvPut(sales, code); await dlvConfirm(sales, code); };

// ---------- §10 载荷基线(req 全集, 逐键实测见 PRE) ----------
// bid 14/14: 整段复制 tests/test_adversarial.js:44-53 BID_BASE
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
// presale 9/9: 整段复制 tests/test_security_notify.js:148
const CH_PRESALE_BASE = { customer: '售前通知客户', biz_line: 'G1', contract_amount: '100', sign_date: '2026-12-31',
  survey: '否', sub_early_flag: '否', presale_invest: '1', presale_period: '2', summary: 'CH 链用例' };
// change 4/4: tests/test_gate_presale.js:55 那份缺 biz_line(task-4-brief §5.2 change req 集含 biz_line), 此处补齐
const CH_CHANGE_BASE = { proj_code: 'PRJ-CH', biz_line: 'G1', proj_stage: '实施中', change_type: '项目成本变动',
  old_contract_amount: '100', old_gross_margin: '15', new_contract_amount: '100', new_gross_margin: '15',
  old_sub_amount: '0', new_sub_amount: '0', old_delivery_cost: '50', new_delivery_cost: '55',
  old_sales_cost: '10', new_sales_cost: '10', over_pay: '否', path_change: '否', delivery_change: '否', summary: 'CH 链用例' };
const REQ_BID = ['customer', 'biz_line', 'contract_amount', 'gross_margin', 'ops_years', 'sign_path', 'survey', 'secret', 'settle_method', 'guarantee', 'non_compete', 'payment_terms', 'summary', 'data_review'];
const REQ_PRESALE = ['customer', 'biz_line', 'contract_amount', 'sign_date', 'survey', 'sub_early_flag', 'presale_invest', 'presale_period', 'summary'];
const REQ_CHANGE = ['biz_line', 'proj_stage', 'change_type', 'summary'];

const mkReview = async (type, code, budgetId) => {
  const base = type === 'bid' ? CH_BID_BASE : (type === 'presale' ? CH_PRESALE_BASE : CH_CHANGE_BASE);
  const form = code ? { ...base, opp_code: code } : { ...base };
  const body = { type, title: `[T]CH-${type}-${S}`, form, submit: false };
  if (budgetId) body.budget_id = budgetId;
  return (await raw(sales, '/api/reviews', 'POST', body)).data.id || 0;
};
const withBudgetAttach = async rid => raw(sales, `/api/reviews/${rid}/attachments`, 'POST',
  { field: '项目预算表', filename: 'ch.xlsx', data: Buffer.from('x').toString('base64') });
// 打满各部门前置任务(绿)→ 自动研判 → 支持组归档
const DEPTS = ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'];
let DT = {};
const judgeAndArchive = async rid => {
  for (const u of DEPTS) {
    const ts = ((await raw(DT[u], '/api/tasks?scope=mine')).data.tasks || []).filter(t => t.review_id === rid);
    for (const t of ts) await raw(DT[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
  }
  return raw(zhichi, `/api/reviews/${rid}/archive`, 'POST');
};
// ---------- 真实 HTTP 夹具(2026-10-21 替换直连 DB 造数): 产物 ID 逐个登记, 清理只靠父级守护恢复演示库与 uploads ----------
const OWNED = { codes: [], reviews: [], budgets: [] };
const GAPS = [];
const gap = (id, short, detail) => {
  const line = 'NOT EXECUTABLE ' + id + ' ' + short + (detail ? ' | ' + detail : '');
  console.log(line); LOG.push(line); GAPS.push(id + ' ' + short);
};
// H: 支持组历史补录。openpyxl 生成两列老模板(仅「附1-预算表」sheet, 走 BUDGET_REVIEW_FALLBACK 映射), review_date 显式给定
let hfxSeq = 0;
const HFX_PY = 'import openpyxl, json, sys\nrows = json.loads(sys.argv[1])\nwb = openpyxl.Workbook()\nws = wb.active\nws.title = \'附1-预算表\'\nfor r in rows:\n    ws.append(r)\nwb.save(sys.argv[2])\n';
const importHistory = async (code, tag) => {
  const name = '夹具历史补录单-' + S + '-' + tag;
  const rows = [['商机代码', code], ['商机名称', name], ['客户名称', '夹具历史客户'], ['评审结论', '同意通过'], ['评审日期', '2024-05-12']];
  const tmp = path.join(__dirname, '_hfx_' + S + '_' + (++hfxSeq) + '.xlsx');
  let data;
  try {
    const py = spawnSync('python', ['-X', 'utf8', '-c', HFX_PY, JSON.stringify(rows), tmp], { encoding: 'utf8' });
    if (py.status !== 0) throw new Error('openpyxl 生成历史补录 xlsx 失败: ' + String(py.stderr || py.error || '').slice(0, 200));
    data = fs.readFileSync(tmp).toString('base64');
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  const r = await raw(zhichi, '/api/reviews/import', 'POST', { filename: '夹具历史补录.xlsx', type: 'bid', mode: 'history', review_date: '2024-05-12', data });
  const d = r.data || {};
  const id = Number(d.id) || 0;
  if (id) OWNED.reviews.push(id);
  const respOk = r.status === 200 && id > 0 && d.era === 'history' && d.status === 'archived' && d.light === 'none' &&
    d.archived_at === '2024-05-12' && (d.form || {}).opp_code === code;
  const det = id ? await raw(zhichi, '/api/reviews/' + id) : { status: 0, data: {} };
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
// Finish: 六个真实部门账号只完成「本单 + 当前轮 + pending」任务(绿, 意见空) → 自动研判须 judged 且绿/黄 → 支持组录入结论「同意」→ 归档 → archived
const finishReview = async rid => {
  const get = async () => (await raw(zhichi, '/api/reviews/' + rid)).data || {};
  const d0 = await get(), rv0 = d0.review || {};
  const want = new Set((d0.tasks || []).filter(t => t.round === rv0.round && t.status === 'pending').map(t => t.id));
  let done = 0;
  const bad = [];
  for (const u of DEPTS) {
    const ts = ((await raw(DT[u], '/api/tasks?scope=mine')).data.tasks || [])
      .filter(t => Number(t.review_id) === Number(rid) && t.round === rv0.round && t.status === 'pending' && want.has(t.id));
    for (const t of ts) {
      const c = await raw(DT[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
      if (c.status === 200) done++; else bad.push(u + '#' + t.id + ':' + c.status + ' ' + (c.data.error || ''));
    }
  }
  const rv1 = (await get()).review || {};
  const dc = await raw(zhichi, `/api/reviews/${rid}/decision`, 'POST', { decision_result: '同意', decision_note: '夹具结论' });
  const ar = await raw(zhichi, `/api/reviews/${rid}/archive`, 'POST');
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

let sales, zhichi;

(async () => {
  sales = await login('sales1');
  zhichi = await login('zhichizu');
  for (const u of DEPTS) DT[u] = await login(u);

  // ---------- PRE: 载荷 req 集自证(§10) ----------
  {
    const miss = (base, req) => req.filter(k => !String(base[k] ?? '').trim());
    check('PRE', 'CH_BID_BASE 含 bid req 全集 14 键(缺=' + (miss(CH_BID_BASE, REQ_BID).join(',') || '无') + ')', miss(CH_BID_BASE, REQ_BID).length === 0);
    check('PRE', 'CH_PRESALE_BASE 含 presale req 全集 9 键(缺=' + (miss(CH_PRESALE_BASE, REQ_PRESALE).join(',') || '无') + ')', miss(CH_PRESALE_BASE, REQ_PRESALE).length === 0);
    check('PRE', 'CH_CHANGE_BASE 含 change req 全集 4 键(缺=' + (miss(CH_CHANGE_BASE, REQ_CHANGE).join(',') || '无') + ')', miss(CH_CHANGE_BASE, REQ_CHANGE).length === 0);
    const pre = await raw(sales, '/api/opp', 'POST', OPP(S + '-pre'));
    check('PRE', '建档可用(三步链第一步就绪, 实 ' + pre.status + ')', pre.status === 200 || pre.status === 409, (pre.data || {}).error || '');
  }

  // ---------- CH-01 缺①: 有挂靠但 opp_delivery 无明细行 ----------
  const c01 = await mkOpp(sales, S + '-ch01');
  let bg01 = 0, lk01 = null;
  {
    bg01 = await mkBudget(sales, c01);
    lk01 = await raw(sales, `/api/budget/${bg01}/lock`, 'POST');
    check('CH-01', '缺①(商机无明细行)锁定 400(实 ' + lk01.status + ')', lk01.status === 400, 'error=' + (lk01.data.error || ''));
    check('CH-01', '400 文案指到商机级交付预算门(含「交付预算」与商机码)',
      /交付预算/.test(lk01.data.error || '') && (lk01.data.error || '').includes(c01));
    check('CH-01', '锁定未生效(状态仍 draft)', ((await raw(sales, '/api/budget/' + bg01)).data.budget || {}).status === 'draft');
  }

  // ---------- CH-02 ①draft: 写了明细行但未确认 ----------
  const c02 = await mkOpp(sales, S + '-ch02');
  let bg02 = 0, lk02 = null;
  {
    await dlvPut(sales, c02);
    bg02 = await mkBudget(sales, c02);
    lk02 = await raw(sales, `/api/budget/${bg02}/lock`, 'POST');
    check('CH-02', '①草稿态锁定 400(实 ' + lk02.status + ')', lk02.status === 400, 'error=' + (lk02.data.error || ''));
    check('CH-02', '400 文案含「草稿」或「确认」', /草稿|确认/.test(lk02.data.error || ''));
  }

  // ---------- CH-03 ①confirmed 缺②: ①满足即放行(链序正确的证据) ----------
  const c03 = await mkOpp(sales, S + '-ch03');
  let bg03 = 0, lk03 = null;
  {
    await chain1(c03);
    bg03 = await mkBudget(sales, c03);
    lk03 = await raw(sales, `/api/budget/${bg03}/lock`, 'POST');
    check('CH-03', '①confirmed 后锁定 200(实 ' + lk03.status + ')', lk03.status === 200, 'error=' + (lk03.data.error || ''));
  }

  // ---------- CH-04 ②locked 缺③ -> 提交(链①②齐) ----------
  let r04 = 0, sub04 = null;
  const c04 = c03; // 承接 CH-03 的 locked 单
  {
    r04 = await mkReview('bid', c04, bg03);
    sub04 = await raw(sales, `/api/reviews/${r04}/submit`, 'POST');
    check('CH-04', '①②齐后 bid 提交 200(实 ' + sub04.status + ')', sub04.status === 200, 'error=' + (sub04.data.error || ''));
  }

  // ---------- CH-05 链全齐 -> 归档翻转 reviewed ----------
  let ar05 = null, st05 = '';
  {
    const pre05 = await oppStatus(sales, c04);
    ar05 = await judgeAndArchive(r04);
    st05 = await oppStatus(sales, c04);
    check('CH-05', '归档 200(实 ' + ar05.status + ')', ar05.status === 200, 'error=' + (ar05.data.error || ''));
    check('CH-05', '归档前档案未翻转(实 ' + pre05 + ')', pre05 !== 'reviewed');
    check('CH-05', '在线单全部归档后档案 status=reviewed(实 ' + st05 + ')', st05 === 'reviewed');
  }

  // ---------- CH-06 历史绕过/漂移: 建单前后①漂移回 draft ----------
  {
    const c06 = await mkOpp(sales, S + '-ch06');
    await chain1(c06);
    const bg06 = await mkBudget(sales, c06);
    const lk06 = await raw(sales, `/api/budget/${bg06}/lock`, 'POST');
    check('CH-06', '前置②锁定 200(实 ' + lk06.status + ')', lk06.status === 200, 'error=' + (lk06.data.error || ''));
    await dlvPut(sales, c06); // 修订即回 draft(G1 重确认纪律)
    const r06 = await mkReview('bid', c06, bg06);
    const s06 = await raw(sales, `/api/reviews/${r06}/submit`, 'POST');
    check('CH-06', '①漂移回草稿后提交被二次核验拦下 400(实 ' + s06.status + ')', s06.status === 400, 'error=' + (s06.data.error || ''));
    check('CH-06', '400 文案含「三步链」或「交付预算未确认」(非必填文案)',
      /三步链|交付预算未确认/.test(s06.data.error || ''));
  }

  // ---------- CH-07 presale 同严 ----------
  {
    const c07 = await mkOpp(sales, S + '-ch07');
    await chain1(c07);
    const bg07 = await mkBudget(sales, c07);
    const lk07 = await raw(sales, `/api/budget/${bg07}/lock`, 'POST');
    const r07a = await mkReview('presale', c07, bg07);
    const s07a = await raw(sales, `/api/reviews/${r07a}/submit`, 'POST');
    check('CH-07', 'presale 链齐提交 200(实 锁' + lk07.status + '/提' + s07a.status + ')', lk07.status === 200 && s07a.status === 200, 'error=' + (s07a.data.error || ''));
    await dlvPut(sales, c07); // ①退回 draft
    const r07b = await mkReview('presale', c07, bg07);
    const s07b = await raw(sales, `/api/reviews/${r07b}/submit`, 'POST');
    check('CH-07', 'presale ①退草稿后新建单提交 400(实 ' + s07b.status + ')', s07b.status === 400, 'error=' + (s07b.data.error || ''));
    check('CH-07', '400 文案指到三步链(与 bid 同严)', /三步链|交付预算未确认/.test(s07b.data.error || ''));
  }

  // ---------- CH-08 change 无关联不受影响 ----------
  {
    const r08 = await mkReview('change', '', 0);
    await withBudgetAttach(r08);
    const s08 = await raw(sales, `/api/reviews/${r08}/submit`, 'POST');
    check('CH-08', 'change 不带 budget_id 提交仍 200(实 ' + s08.status + ')', s08.status === 200, 'error=' + (s08.data.error || ''));
  }

  // ---------- CH-09 change 带关联要核验 ----------
  {
    const c09 = await mkOpp(sales, S + '-ch09');
    await chain1(c09);
    const bg09 = await mkBudget(sales, c09);
    const lk09 = await raw(sales, `/api/budget/${bg09}/lock`, 'POST');
    check('CH-09', '前置②锁定 200(实 ' + lk09.status + ')', lk09.status === 200, 'error=' + (lk09.data.error || ''));
    await dlvPut(sales, c09); // ①漂移回 draft
    const r09 = await mkReview('change', c09, bg09);
    const s09 = await raw(sales, `/api/reviews/${r09}/submit`, 'POST');
    check('CH-09', 'change 关联①draft 的锁定单提交 400(实 ' + s09.status + ')', s09.status === 400, 'error=' + (s09.data.error || ''));
    check('CH-09', '400 文案指到三步链', /三步链|交付预算未确认/.test(s09.data.error || ''));
  }

  // ---------- CH-10 无挂靠预算单不受 G2 收紧影响(D 套件不变的根据) ----------
  {
    const bg10 = (await raw(sales, '/api/budget', 'POST', { project_name: 'T3 链预算(无挂靠)', fields: BF('') })).data.id || 0;
    await raw(sales, `/api/budget/${bg10}/delivery`, 'PUT', { rows: mkRows() });
    const lk10 = await raw(sales, `/api/budget/${bg10}/lock`, 'POST');
    check('CH-10', '无挂靠预算单带附3底稿锁定仍 200(实 ' + lk10.status + ')', lk10.status === 200, 'error=' + (lk10.data.error || ''));
    // D 套件锚定的现网原文: 无挂靠分支必须永远保留, 连 DELIVERY_REQUIRED_TYPES=[] 时也在(CH-12 规程同批验证)
    const bg10b = (await raw(sales, '/api/budget', 'POST', { project_name: 'T3 链预算(无挂靠无底稿)', fields: BF('') })).data.id || 0;
    const lk10b = await raw(sales, `/api/budget/${bg10b}/lock`, 'POST');
    check('CH-10', '无挂靠且无底稿锁定 400 且文案为现网原文(实 ' + lk10b.status + ')',
      lk10b.status === 400 && (lk10b.data.error || '') === '锁定前请先上传或编制交付明细表(附3-交付成本评估,递进附件)', 'error=' + (lk10b.data.error || ''));
  }

  // ---------- CH-11 历史单不污染翻转(11a: 真实历史导入的已归档历史单 + 真实在线单全链; 11b 见下方 NOT EXECUTABLE) ----------
  // 11a 只证「已归档历史单不阻断 G4 翻转」: 它先被 G4 的 status!='archived' 谓词排除, 不构成 era 谓词的变异见证(那原是 11b 的职责, 现为已披露缺口)
  {
    const c11 = await mkOpp(sales, S + '-ch11a');
    OWNED.codes.push(c11);
    try {
      await chain1(c11);
      const bg11 = await mkBudget(sales, c11);
      if (bg11) OWNED.budgets.push(bg11);
      const lk11 = await raw(sales, `/api/budget/${bg11}/lock`, 'POST');
      check('CH-11', '11a 前置②锁定 200(实 ' + lk11.status + ')', lk11.status === 200, 'error=' + (lk11.data.error || ''));
      const h11 = await importHistory(c11, 'ch11a');
      check('CH-11', '11a 前置: 支持组真实历史导入 era=history/archived/light=none/archived_at=2024-05-12/原件附件+导入事件/0 任务', h11.ok, h11.ev);
      const r11 = await mkReview('bid', c11, bg11);
      if (r11) OWNED.reviews.push(r11);
      const sub11 = await raw(sales, `/api/reviews/${r11}/submit`, 'POST');
      check('CH-11', '11a 前置提交 200(实 ' + sub11.status + ')', sub11.status === 200, 'error=' + (sub11.data.error || ''));
      const stPre = await oppStatus(sales, c11);
      const fin11 = await finishReview(r11);
      const stPost = await oppStatus(sales, c11);
      check('CH-11', '11a 在线单真实收尾: 在线 reviewing → 六部门当前轮 pending 全绿 → judged(绿/黄) → 结论同意 → 归档 archived', fin11.ok, fin11.ev);
      check('CH-11', '11a 归档前(在线单未归档)档案仍 pending(实 ' + stPre + ')', stPre === 'pending');
      check('CH-11', '11a 已归档历史单不阻断翻转: 归档在线单后 reviewed(实 ' + stPost + ', 归档 ' + fin11.archive + ')',
        fin11.archive === 200 && stPost === 'reviewed');
      const hv = h11.id ? await raw(zhichi, '/api/reviews/' + h11.id) : { status: 0, data: {} };
      const h0 = h11.review, h1 = hv.data.review || {};
      const INV = ['opp_code', 'era', 'status', 'light', 'archived_at', 'decision_result', 'round', 'updated_at'];
      const drift = INV.filter(k => h1[k] !== h0[k]);
      check('CH-11', '11a 历史单不变式: 在线单收尾归档前后历史行 ' + INV.join('/') + ' 逐字段不变且仍 0 任务',
        h11.id > 0 && hv.status === 200 && drift.length === 0 && Array.isArray(hv.data.tasks) && hv.data.tasks.length === 0,
        'hid=' + h11.id + ' detail=' + hv.status + ' 漂移=' + JSON.stringify(drift.map(k => [k, h0[k], h1[k]])) +
        ' tasks=' + (Array.isArray(hv.data.tasks) ? hv.data.tasks.length : 'n/a'));
    } catch (e) { check('CH-11', '11a 执行异常', false, e.message); }
  }
  // CH-11b(2026-10-21 移除): 原用直连 DB 造「未归档 era=history 行」证 G4 的 era 谓词非死代码; 已授权 HTTP 无此状态产地, 不以已归档历史单冒充同等覆盖
  gap('CH-11b', 'legacy-state G4 mutation coverage gap(不可计为PASS)', '未归档 era=history 行无已授权 HTTP 产地(历史导入恒 archived; submit 仅接 draft/returned/红灯 judged; /judge 仅接 reviewing/judged; 无改 era 端点), SQL 造假已删除; 去掉 G4 era 谓词的变异在本套不再可见');

  // ---------- CH-13 D-12 同商机多张预算单共享交付预算(设计意图, 非漏洞) ----------
  {
    const c13 = await mkOpp(sales, S + '-ch13');
    const bgA = await mkBudget(sales, c13);
    const bgB = await mkBudget(sales, c13);
    await raw(sales, `/api/budget/${bgA}/delivery`, 'PUT', { rows: mkRows() }); // 经 A 的预算级端点写入(D-6 分流到 opp_delivery)
    const cf13 = await dlvConfirm(sales, c13);
    check('CH-13', '前置①经 A 写行后 confirm 200(实 ' + cf13.status + ')', cf13.status === 200, 'error=' + (cf13.data.error || ''));
    const lkB = await raw(sales, `/api/budget/${bgB}/lock`, 'POST');
    // D-12: 交付预算属商机级共享, A 确认后同商机 B 亦可锁(设计意图, 非漏洞)
    check('CH-13', 'D-12 共享: 未经 B 写行, A 确认后 B 直接锁定 200(实 ' + lkB.status + ')', lkB.status === 200, 'error=' + (lkB.data.error || ''));
  }

  // ---------- CH-14 D-12 共享不放宽状态门 ----------
  {
    const c14 = await mkOpp(sales, S + '-ch14');
    const bgA = await mkBudget(sales, c14);
    const bgB = await mkBudget(sales, c14);
    await raw(sales, `/api/budget/${bgA}/delivery`, 'PUT', { rows: mkRows() }); // 写行但不 confirm → draft
    const lkA = await raw(sales, `/api/budget/${bgA}/lock`, 'POST');
    const lkB = await raw(sales, `/api/budget/${bgB}/lock`, 'POST');
    check('CH-14', '①draft 时 A 锁定 400(实 ' + lkA.status + ')', lkA.status === 400, 'error=' + (lkA.data.error || ''));
    check('CH-14', '①draft 时同商机 B 锁定亦 400(共享不放宽状态门)(实 ' + lkB.status + ')', lkB.status === 400, 'error=' + (lkB.data.error || ''));
    check('CH-14', '两条 400 均指明缺「① 交付预算确认」',
      /交付预算/.test(lkA.data.error || '') && /草稿|确认/.test(lkA.data.error || '') &&
      /交付预算/.test(lkB.data.error || '') && /草稿|确认/.test(lkB.data.error || ''));
  }

  // ---------- 收尾: 门禁生效不影响既有免门路径(纯 sanity, 不引入新口径) ----------
  {
    const c15 = await mkOpp(sales, S + '-ch15');
    await chain1(c15);
    const bg15 = await mkBudget(sales, c15);
    const lk15 = await raw(sales, `/api/budget/${bg15}/lock`, 'POST');
    const nv15 = await raw(sales, `/api/budget/${bg15}/newversion`, 'POST');
    check('CH-15', '链①②齐后 newversion 派生仍 200 且继承商机码',
      lk15.status === 200 && nv15.status === 200 && nv15.data.opp_code === c15, 'lock=' + lk15.status + ' nv=' + nv15.status);
    const od = await raw(sales, `/api/opp/${encodeURIComponent(c15)}/delivery`);
    check('CH-15', '派生新版本不改写 opp_delivery 状态(仍 confirmed)',
      od.status === 200 && ((od.data.delivery || {}).status) === 'confirmed', 'status=' + ((od.data.delivery || {}).status));
  }

  // ---------- CH-16 / CH-16b D-23 反事实锚: G3 只认 budgets.opp_code, 禁止回退 reviews.opp_code ----------
  {
    const c16 = await mkOpp(sales, S + '-ch16');
    await dlvPut(sales, c16); // 商机级交付预算停在 draft(不 confirm)
    // CH-16: 预算单走 D-6 无挂靠路径锁定(附3 底稿在 budget_delivery), 评审表单携带该 draft 商机码
    const bg16 = (await raw(sales, '/api/budget', 'POST', { project_name: 'T3 链预算(无挂靠)', fields: BF('') })).data.id || 0;
    await raw(sales, `/api/budget/${bg16}/delivery`, 'PUT', { rows: mkRows() });
    const lk16 = await raw(sales, `/api/budget/${bg16}/lock`, 'POST');
    check('CH-16', '16 前置: 无挂靠预算单凭附3底稿锁定 200(实 ' + lk16.status + ')', lk16.status === 200, 'error=' + (lk16.data.error || ''));
    const r16 = await mkReview('bid', c16, bg16);
    const s16 = await raw(sales, `/api/reviews/${r16}/submit`, 'POST');
    check('CH-16', 'D-23 反事实锚: 无挂靠锁定单 + 表单带 draft 商机码 → 提交 200(实 ' + s16.status + ')',
      s16.status === 200, 'error=' + (s16.data.error || ''));
    // 同商机改走 opp 锚定路径(预算单自己带码)必须仍拦——证明上一条不是门失效
    const cf16 = await dlvConfirm(sales, c16);
    const bg16b = await mkBudget(sales, c16);
    const lk16b = await raw(sales, `/api/budget/${bg16b}/lock`, 'POST');
    check('CH-16b', '16b 前置: confirm 后挂靠单锁定 200(实 confirm' + cf16.status + '/锁' + lk16b.status + ')',
      cf16.status === 200 && lk16b.status === 200, 'error=' + (lk16b.data.error || ''));
    await dlvPut(sales, c16); // ①漂移回 draft
    const r16b = await mkReview('bid', c16, bg16b);
    const s16b = await raw(sales, `/api/reviews/${r16b}/submit`, 'POST');
    check('CH-16b', '同商机经 opp 锚定路径仍拦 400(实 ' + s16b.status + ')', s16b.status === 400, 'error=' + (s16b.data.error || ''));
    check('CH-16b', '400 文案指到三步链', /三步链|交付预算未确认/.test(s16b.data.error || ''));
  }

  const owned = 'OWNED run=' + S + ' prefix=PL-T3-' + S + '- codes=' + JSON.stringify(OWNED.codes) + ' reviews=' + JSON.stringify(OWNED.reviews) +
    ' budgets=' + JSON.stringify(OWNED.budgets) + ' (cleanup: parent guard restore, 本套无 SQL 清理)';
  console.log(owned); LOG.push(owned);
  for (const g of GAPS) console.log('NOT EXECUTABLE ' + g);
  // 有缺口时不得输出 ALL PASS: 缺口数与文案进 summary 行(run_all 每套只截尾 6 行)
  const verdict = fail ? 'SOME FAIL' : (GAPS.length ? 'EXECUTED PASS + ' + GAPS.length + ' COVERAGE GAP(不可计为全绿)' : 'ALL PASS');
  const summary = `${pass} passed, ${fail} failed, ${GAPS.length} NOT EXECUTABLE -> ${verdict}` + (GAPS.length ? ' [' + GAPS.join('; ') + ']' : '');
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
