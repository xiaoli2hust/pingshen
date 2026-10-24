// V4.0 T2 商机级交付预算 + 旧预算级端点分流 专项: DL-01~DL-23(服务运行中)
// 用法: node tests/test_delivery_opp.js [--log=tests/green_delivery_opp.txt]
// 锚定: DL-07/DL-13 用真实单价档(交付处 1696 / 研发外包 995 / 生产外包 320, finance.js DEV_DEPT_PRICE 同源);
//       DL-08 用真实原件 tests/realdata/【投标决策】PL00008572...(与 D-01 同锚: 实施 PM5+正编39+生产184 / 运维 PM2)
// 裁定 D-6: 有挂靠(opp_code)读写落 opp_delivery; 无挂靠沿用 budget_delivery 旧路径行为零变化; 读优先新表、无行回退旧表
// 裁定 D-5: 商机级计价基准取该商机最新预算单 dev_dept → 最新评审 form_json.dev_dept → none(rate 不兜底, 禁止 settings 造单价)
// 裁定 D-9: 建单端点即收 fields 且即落 budgets.opp_code 列(不存在码 400, 建预算单不得造档); DL-17~19 专项
// 裁定 D-10: 派生列单源不变量——凡写 budgets.fields 的 SQL 必须同句投影 opp_code(含 newversion 继承、技能①对话); DL-20~21 专项
// 修复轮 #1: DL-17 加「三步链」文案断言, DL-18 加「建单后不重启即分流」三断言, DL-19 加「不含 opp_code 的 PUT 不清空且行不丢」三断言
// 裁定 D-18(T3 折入): 派生列不变量改两层守护——行为面 DL-22/23(对话技能①与 /delivery/apply 在「只送顶层 body.opp_code」态下不洗列) 优先,
//   静态面 DL-21 升级为语句窗口法并自带内存反例自证非恒绿; DL-20 因 T3-G2 收紧在 lock 前补①确认(简报 §9 授权)
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const XLSX_8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');

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
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

const TEST_OPP = (n) => ({
  opp_code: 'PL-T2-' + n, title: 'T2测试商机-' + n, customer: '江西省自然资源测绘与监测院',
  region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240,
  opp_stage: '投标决策/投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '',
  summary: '天地图 POI 数据服务项目（DL 套件交付预算用例）'
});

(async () => {
  const sales = await login('sales1');
  const fde = await login('fde1');
  const pm = await login('pm1');
  const S = String(Date.now()).slice(-7);
  const code = n => 'PL-T2-' + n;
  // 建档失败不抛(保证逐用例红证据成片, 不在首个端点 404 处崩掉整套)
  const mkOpp = async (token, n) => { await raw(token, '/api/opp', 'POST', TEST_OPP(n)); return code(n); };
  // 挂靠预算单(D-9 口径): 先 POST /api/opp 建档, 再 POST /api/budget 带 fields+opp_code 即建即挂, 不依赖重启回填
  const DL_BUDGET = (name, oppCode) => {
    const f = { project_name: name, customer: '江西省自然资源测绘与监测院',
      contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000 };
    if (oppCode) f.opp_code = oppCode; // 传 null/'' 表示「不挂靠」(D-6 旧路径对照面)
    return f;
  };
  const mkBudget = async (token, name, oppCode) => {
    const r = await raw(token, '/api/budget', 'POST', { project_name: name, ...(oppCode ? { opp_code: oppCode } : {}), fields: DL_BUDGET(name, oppCode) });
    return { id: (r.data || {}).id || 0, status: r.status, data: r.data };
  };

  const cA = S + '-dl01', cD = S + '-dl04', cE = S + '-dl07', cF = S + '-dl08',
        cG = S + '-dl11', cH = S + '-dl12', cI = S + '-dl13', c18 = S + '-dl18', c19 = S + '-dl19', c20 = S + '-dl20';
  let bgH = 0, bgH2 = 0, bgI = 0, bg18 = 0;

  // DL-01: 空态
  const codeA = await mkOpp(sales, cA);
  {
    const r = await raw(sales, `/api/opp/${codeA}/delivery`);
    check('DL-01', '新建商机 GET delivery 空态 delivery===null(实 ' + r.status + ')', r.status === 200 && r.data.delivery === null);
  }

  // DL-02: 在线编制落 opp_delivery(D-5 none: 该商机暂无预算单/评审, rate 不兜底)
  {
    const rows = [
      { content: '天地图POI数据生产', stage: '实施', pm_pd: 2, own_pd: 8, prod_pd: 40, travel_cost: 600 },
      { content: '研发外包接口开发', stage: '实施', pm_pd: 1, own_pd: 2, rd_pd: 4, travel_cost: 0 },
      { content: '运维保障', stage: '运维', pm_pd: 1, own_pd: 1, prod_pd: 10, travel_cost: 400 }
    ];
    const p = await raw(sales, `/api/opp/${codeA}/delivery`, 'PUT', { rows });
    const d = p.data || {};
    check('DL-02', 'PUT 200 且回显 3 行(实 ' + p.status + ' rows=' + ((d.rows || []).length) + ')', p.status === 200 && (d.rows || []).length === 3);
    check('DL-02', 'sum.cost 含差旅且 rate=null 时外包+差旅仍计价',
      near((d.sum || {}).cost, 4 * 995 + 50 * 320 + 1000, 0.05));
    const g = (await raw(sales, `/api/opp/${codeA}/delivery`)).data;
    check('DL-02', 'GET delivery.status=draft 且落 opp_delivery(3 行)', !!g.delivery && g.delivery.status === 'draft' && (g.delivery.rows || []).length === 3);
    check('DL-02', 'rate_source=none 且 rate 不兜底(实 rate=' + JSON.stringify(g.rate) + ')', g.rate_source === 'none' && (g.rate === null || g.rate === undefined));
  }

  // DL-03: 行清洗——内容/备注不能保留无预算数字行，仅差旅行仍保留
  {
    const rows = [
      { content: 'POI 数据更新', stage: '实施', own_pd: 5, prod_pd: 20, travel_cost: 300 },
      { content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '空行' },
      { content: '仅保留建设内容', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0 },
      { content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 800 },
      { content: '运维', stage: '运维', prod_pd: 6, travel_cost: 200 }
    ];
    const p = await raw(sales, `/api/opp/${codeA}/delivery`, 'PUT', { rows });
    const rowsOut = (p.data || {}).rows || [];
    check('DL-03', '空行与内容全零行剔除，保留 3 行预算明细', rowsOut.length === 3,
      JSON.stringify(rowsOut.map(r => ({ content: r.content, travel_cost: r.travel_cost }))));
    check('DL-03', '无预算数字的「仅保留建设内容」不落明细', !rowsOut.some(r => r.content === '仅保留建设内容'));
    check('DL-03', '仅差旅行保留且 sum.travel_cost=1300',
      rowsOut.some(r => !r.content && r.travel_cost === 800) && (p.data.sum || {}).travel_cost === 1300);
  }

  // DL-04: 空行集确认被 G1 拦 400
  {
    const codeD = await mkOpp(sales, cD);
    await raw(sales, `/api/opp/${codeD}/delivery`, 'PUT', { rows: [] });
    const r = await raw(sales, `/api/opp/${codeD}/delivery/confirm`, 'POST');
    check('DL-04', '空明细 confirm 400 含「无明细行」(G1, 实 ' + r.status + ' ' + (r.data.error || '') + ')',
      r.status === 400 && /无明细行/.test(r.data.error || ''));
  }

  // DL-05 + DL-06: 确认成功 / 修订即回 draft
  {
    const c = await raw(sales, `/api/opp/${codeA}/delivery/confirm`, 'POST');
    check('DL-05', 'confirm 200 status=confirmed(实 ' + c.status + ')', c.status === 200 && (c.data || {}).status === 'confirmed');
    const g = (await raw(sales, `/api/opp/${codeA}/delivery`)).data;
    check('DL-05', 'GET 回显 confirmed', ((g || {}).delivery || {}).status === 'confirmed');
    await raw(sales, `/api/opp/${codeA}/delivery`, 'PUT', { rows: [{ content: '修订一行', stage: '实施', own_pd: 3, prod_pd: 9 }] });
    const g2 = (await raw(sales, `/api/opp/${codeA}/delivery`)).data;
    check('DL-06', '确认后修订回 draft(G1 重确认纪律, 实 ' + (((g2 || {}).delivery || {}).status) + ')', ((g2 || {}).delivery || {}).status === 'draft');
  }

  // DL-07: 计价基准取最新预算单 dev_dept(D-5 source=budget, 交付处=1696)
  {
    const codeE = await mkOpp(sales, cE);
    await raw(sales, `/api/opp/${codeE}/delivery`, 'PUT', { rows: [{ content: 'POI 采集加工', stage: '实施', pm_pd: 5, own_pd: 10, rd_pd: 4, prod_pd: 20 }] });
    const bgE = (await mkBudget(sales, 'DL-07 挂靠预算 ' + S, codeE)).id;
    const g = (await raw(sales, `/api/opp/${codeE}/delivery`)).data || {};
    const exp = (5 + 10) * 1696 + 4 * 995 + 20 * 320;
    check('DL-07', '预算单已建(前置条件, id=' + bgE + ')', bgE > 0);
    check('DL-07', 'rate_source=budget 且 rate=1696(实 rate=' + JSON.stringify(g.rate) + ' src=' + g.rate_source + ')',
      g.rate_source === 'budget' && near(g.rate, 1696, 0.001));
    check('DL-07', 'sum.cost=35820 与手算一致((pm+own)×1696+rd×995+prod×320, 实 ' + JSON.stringify(((g.delivery || {}).sum || {}).cost) + ')',
      near(((g.delivery || {}).sum || {}).cost, exp, 0.05));
  }

  // DL-08: 附3 真实原件导入(锚定 PL8572 实 PM7/正编39/生产184)
  const codeF = await mkOpp(sales, cF);
  {
    const data = fs.readFileSync(XLSX_8572).toString('base64');
    const r = await raw(sales, `/api/opp/${codeF}/delivery/import`, 'POST', { filename: 'PL00008572-附3.xlsx', data });
    const d = r.data || {};
    check('DL-08', '商机级导入 200(实 ' + r.status + ' ' + String(d.error || '').slice(0, 60) + ')', r.status === 200);
    check('DL-08', 'rows>=2 且 status=draft(实 rows=' + ((d.rows || []).length) + ')', (d.rows || []).length >= 2 && d.status === 'draft');
    const s = d.sum || {};
    check('DL-08', '解析锚定 pm_pd=7/own_pd=39/prod_pd=184(与 D-01 同源)', s.pm_pd === 7 && s.own_pd === 39 && s.prod_pd === 184);
    check('DL-08', '响应带 audit.row_sources 与 rows 等长', (((d.audit || {}).row_sources) || []).length === (d.rows || []).length && (d.rows || []).length > 0);
  }

  // DL-09: 导入→确认→再导入回 draft
  {
    const c = await raw(sales, `/api/opp/${codeF}/delivery/confirm`, 'POST');
    check('DL-09', '导入后可确认(实 ' + c.status + ')', c.status === 200 && (c.data || {}).status === 'confirmed');
    const data = fs.readFileSync(XLSX_8572).toString('base64');
    const r = await raw(sales, `/api/opp/${codeF}/delivery/import`, 'POST', { filename: 'PL00008572-附3-重导.xlsx', data });
    check('DL-09', '确认后重导回 draft(重确认纪律, 实 ' + r.status + ')', r.status === 200 && r.data.status === 'draft');
  }

  // DL-10 / DL-11: 权限
  {
    const r = await raw(fde, `/api/opp/${codeA}/delivery`, 'PUT', { rows: [{ content: '越权', own_pd: 1 }] });
    check('DL-10', 'FDE 非建档人编制 403(实 ' + r.status + ')', r.status === 403);
    const codeG = await mkOpp(pm, cG);
    const ok = await raw(pm, `/api/opp/${codeG}/delivery`, 'PUT', { rows: [{ content: 'PM 编制行', stage: '实施', pm_pd: 1, own_pd: 2, prod_pd: 3 }] });
    check('DL-11', '项目经理(建档人)编制 200(实 ' + ok.status + ')', ok.status === 200 && ((ok.data.rows || []).length === 1));
  }

  // DL-12: 旧端点分流——有挂靠的预算单写 opp_delivery, 同商机另一张预算单共用同一份明细
  {
    const codeH = await mkOpp(sales, cH);
    bgH = (await mkBudget(sales, 'DL-12 挂靠预算A ' + S, codeH)).id;
    bgH2 = (await mkBudget(sales, 'DL-12 挂靠预算B ' + S, codeH)).id;
    const col = (await raw(sales, '/api/budget/' + bgH)).data.budget || {};
    check('DL-12', '表单路径建单后 budgets.opp_code 派生列已落值(实 ' + JSON.stringify(col.opp_code) + ')', col.opp_code === codeH);
    const p = await raw(sales, `/api/budget/${bgH}/delivery`, 'PUT', { rows: [{ content: '分流写入行', stage: '实施', pm_pd: 2, own_pd: 6, prod_pd: 12 }] });
    check('DL-12', 'PUT 旧端点 200 且回显 1 行(实 ' + p.status + ')', p.status === 200 && ((p.data.rows || []).length === 1));
    const g = (await raw(sales, `/api/opp/${codeH}/delivery`)).data || {};
    check('DL-12', '商机级端点读到同一份(写入落 opp_delivery 而非仅 budget_delivery)',
      (((g.delivery || {}).rows || [])[0] || {}).content === '分流写入行' && ((g.delivery || {}).status) === 'draft');
    const g2 = (await raw(sales, `/api/budget/${bgH2}/delivery`)).data || {};
    check('DL-12', '同商机另一张预算单读到同一份(商机级共享语义)', ((g2.rows || [])[0] || {}).content === '分流写入行');
  }

  // DL-13: 无挂靠预算单沿用旧路径(D 套件对照面, 行为零变化)
  {
    bgI = (await mkBudget(sales, 'DL-13 未挂靠预算 ' + S, null)).id;
    const p = await raw(sales, `/api/budget/${bgI}/delivery`, 'PUT', { rows: [{ content: '旧路径行', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 }] });
    check('DL-13', '无挂靠单 PUT 200(实 ' + p.status + ')', p.status === 200 && ((p.data.rows || []).length === 1));
    check('DL-13', '行成本按本单 dev_dept 实算=133504((5+39)×1696+184×320, 与 D-01 同锚)',
      near(((p.data.rows || [])[0] || {}).cost, 133504, 1));
    const g = (await raw(sales, `/api/budget/${bgI}/delivery`)).data || {};
    check('DL-13', 'GET 回显同数据(1 行, sum 四科目齐)', (g.rows || []).length === 1 && !!g.sum && g.sum.own_pd === 39 && g.sum.prod_pd === 184);
    check('DL-13', 'rate 取本单 dev_dept=交付处 档 1696(旧路径口径零变化)', near(g.rate, 1696, 0.001));
  }

  // DL-14: 双读回退——无挂靠命中旧表 / 有挂靠命中新表且优先
  {
    const gNew = (await raw(sales, `/api/budget/${bgH}/delivery`)).data || {};
    const gOld = (await raw(sales, `/api/budget/${bgI}/delivery`)).data || {};
    check('DL-14', '有挂靠单读新表(非空 rows, 实 ' + ((gNew.rows || []).length) + ')', (gNew.rows || []).length >= 1);
    check('DL-14', '无挂靠单读旧表(非空 rows, 实 ' + ((gOld.rows || []).length) + ')', (gOld.rows || []).length >= 1);
    await raw(sales, `/api/opp/${code(cH)}/delivery`, 'PUT', { rows: [{ content: '商机级改写行', stage: '实施', own_pd: 4, prod_pd: 8 }] });
    const gPrior = (await raw(sales, `/api/budget/${bgH}/delivery`)).data || {};
    check('DL-14', '预算级 GET 优先新表(商机级改写即刻可见)', ((gPrior.rows || [])[0] || {}).content === '商机级改写行');
  }

  // DL-15: 存量迁移档案可读(spec §8 对账项的 HTTP 面, 不断言 status 避免跨套件耦合)
  {
    const r = await raw(sales, '/api/opp/PL00008572/delivery');
    const d = r.data || {};
    check('DL-15', 'T1 迁移落地的 PL00008572 可读 200(实 ' + r.status + ')', r.status === 200);
    check('DL-15', 'delivery!==null 且 rows>0(存量底稿承接, 实 rows=' + (((d.delivery || {}).rows || []).length) + ')',
      !!d.delivery && ((d.delivery.rows || []).length) > 0);
  }

  // DL-16: 未登录 401
  {
    const r = await raw(null, `/api/opp/${codeA}/delivery`);
    check('DL-16', '未登录 GET 商机级交付预算 401(实 ' + r.status + ')', r.status === 401);
  }

  // ---------- D-9 建单挂靠三条 ----------

  // DL-17: 不存在的商机码建单被拦(三步链因果前置, 建预算单不得造档)
  // 注: 幽灵码必须逐轮唯一——固定字面量会被上一轮「PUT 写进 fields → 重启期 server.js:141 同步入列 → migrateV40 补档」
  //     承接成真实档案(实测 D-9 红跑后 PL-NOT-EXIST-98 就变成存在档案), 断言随之失真
  {
    const ghost17 = 'PL-NOT-EXIST-' + S + '-17';
    const r = await raw(sales, '/api/budget', 'POST', { project_name: 'DL-17 幽灵码建单', opp_code: ghost17 });
    check('DL-17', '未知商机码 POST /api/budget 400 含「商机档案不存在」与「三步链」(实 ' + r.status + ' ' + String(r.data.error || '').slice(0, 60) + ')',
      r.status === 400 && /商机档案不存在/.test(r.data.error || '') && /三步链/.test(r.data.error || ''));
    const opp = await raw(sales, '/api/opp/' + ghost17);
    check('DL-17', '被拦建单未顺手造档(GET /api/opp 仍 404)', opp.status === 404, '实 ' + opp.status);
  }

  // DL-18: 建档后即建即挂, 不依赖重启回填
  {
    const code18 = await mkOpp(sales, c18);
    const mk = await mkBudget(sales, 'DL-18 即建即挂预算 ' + S, code18);
    bg18 = mk.id;
    check('DL-18', '带 fields+opp_code 建单 200(实 ' + mk.status + ' id=' + bg18 + ')', mk.status === 200 && bg18 > 0);
    const bd = (await raw(sales, '/api/budget/' + bg18)).data.budget || {};
    check('DL-18', 'budget.opp_code 即刻等于建档码(不依赖重启)', bd.opp_code === code18, JSON.stringify(bd.opp_code));
    check('DL-18', 'budget.fields.dev_dept=交付处(建单即收 fields)', ((bd.fields || {}).dev_dept) === '交付处');
    check('DL-18', '建单响应回显 opp_code 且 id 仍为 number', mk.data && mk.data.opp_code === code18 && typeof mk.data.id === 'number');
    // 修复轮 #1: 同一进程内(不重启)即验证 D-6 分流真的吃到这张单
    const pRow = [{ content: 'DL-18 分流即时行', stage: '实施', pm_pd: 2, own_pd: 5, prod_pd: 10 }];
    const pw = await raw(sales, `/api/budget/${bg18}/delivery`, 'PUT', { rows: pRow });
    const og = (await raw(sales, `/api/opp/${code18}/delivery`)).data || {};
    check('DL-18', '建单后不重启, 预算级写行即落 opp_delivery(实 ' + pw.status + ')', pw.status === 200);
    check('DL-18', '商机级 GET 与预算级写入同内容同科目',
      ((og.delivery || {}).rows || [])[0]?.content === 'DL-18 分流即时行' && ((og.delivery || {}).sum || {}).own_pd === 5 && ((og.delivery || {}).sum || {}).prod_pd === 10);
    check('DL-18', '分流后 rate 取该商机最新预算单 dev_dept(D-5 budget)', og.rate_source === 'budget' && near(og.rate, 1696, 0.001));
  }

  // DL-19: draft 单改挂到另一已建档商机, 原档案不受伤害
  {
    const code19 = await mkOpp(sales, c19);
    const p = await raw(sales, '/api/budget/' + bg18, 'PUT', { fields: { opp_code: code19 } });
    check('DL-19', 'PUT 改挂已建档码 200(实 ' + p.status + ')', p.status === 200);
    const bd = (await raw(sales, '/api/budget/' + bg18)).data.budget || {};
    check('DL-19', 'GET 回显新码且原字段未被清空', bd.opp_code === code19 && ((bd.fields || {}).dev_dept) === '交付处', JSON.stringify(bd.opp_code));
    const old = await raw(sales, '/api/opp/' + code(c18));
    check('DL-19', '原商机档案仍 200(改挂不伤档)', old.status === 200, '实 ' + old.status);
    const bad = await raw(sales, '/api/budget/' + bg18, 'PUT', { fields: { opp_code: 'PL-NOT-EXIST-' + S + '-19' } });
    check('DL-19', '改挂到不存在码被拦 400(实 ' + bad.status + ')', bad.status === 400 && /商机档案不存在/.test(bad.data.error || ''));
    const keep = (await raw(sales, '/api/budget/' + bg18)).data.budget || {};
    check('DL-19', '被拦后原值未被清空(仍为 code19)', keep.opp_code === code19);
    // 修复轮 #1(fixround DL-19 原口径): 送「不含 opp_code 的 fields」同样不得清空派生列, 且共享行不丢
    await raw(sales, `/api/budget/${bg18}/delivery`, 'PUT', { rows: [{ content: 'DL-19 保挂行', stage: '实施', pm_pd: 1, own_pd: 4, prod_pd: 7 }] });
    const pNoCode = await raw(sales, '/api/budget/' + bg18, 'PUT', { fields: { dev_dept: '交付处', contract: 2400000 } });
    const keep2 = (await raw(sales, '/api/budget/' + bg18)).data.budget || {};
    check('DL-19', 'PUT 不含 opp_code 的 fields 仍 200(实 ' + pNoCode.status + ')', pNoCode.status === 200);
    check('DL-19', '不含 opp_code 时派生列与 fields 均保持原值(不清空)',
      keep2.opp_code === code19 && ((keep2.fields || {}).opp_code) === code19);
    const dl19 = (await raw(sales, `/api/opp/${code19}/delivery`)).data || {};
    check('DL-19', 'opp_delivery 行不丢(实 rows=' + (((dl19.delivery || {}).rows || []).length) + ')',
      ((dl19.delivery || {}).rows || []).length === 1 && ((dl19.delivery || {}).rows || [])[0].content === 'DL-19 保挂行');
  }

  // ---------- D-10 派生列单源不变量两条(规格提交 7a697b1 追加, 使 DL 总数由更正 D-9 的 19 增至 21) ----------

  // DL-20: newversion 派生版本按父单继承 opp_code(不靠重启回填)
  // 注: 本例把 /lock 当前置条件调用(未改任何门禁代码); T3 重写 G2 时若锁定口径变化, 该用例应随 D/T3 断言同批调整
  {
    const code20 = await mkOpp(sales, c20);
    const bg20 = (await mkBudget(sales, 'DL-20 版本链预算 ' + S, code20)).id;
    await raw(sales, `/api/budget/${bg20}/delivery`, 'PUT', { rows: [{ content: '版本链明细', stage: '实施', pm_pd: 1, own_pd: 2, prod_pd: 3 }] });
    // T3-G2 门禁收紧的连带更新(简报 §9 授权, 非改断言凑绿): 本单带 opp_code 挂靠, 锁定现在要求①交付预算 confirmed,
    // 故在 lock 前补一行确认; 其余断言一字不动。原文: 无此行, 直接 raw(.../budget/${bg20}/lock)
    await raw(sales, `/api/opp/${code20}/delivery/confirm`, 'POST', {});
    const lk = await raw(sales, `/api/budget/${bg20}/lock`, 'POST');
    check('DL-20', '父单锁定 200(前置条件, 实 ' + lk.status + ')', lk.status === 200);
    const nv = await raw(sales, `/api/budget/${bg20}/newversion`, 'POST');
    check('DL-20', 'newversion 200 且派生列即继承父单商机码(实 ' + JSON.stringify(nv.data.opp_code) + ')',
      nv.status === 200 && nv.data.opp_code === code20);
    const v2 = (await raw(sales, '/api/budget/' + ((nv.data || {}).id || 0))).data.budget || {};
    check('DL-20', 'v2 的 opp_code 列与 fields.opp_code 一致', v2.opp_code === code20 && ((v2.fields || {}).opp_code) === code20);
  }

  // DL-21(加固, D-18): 语句窗口法(prepare 起 → 配对 .run( 末, 最多向下 8 行) + args 段判定 + 内存反例自测, 杜绝恒绿
  {
    const scan = (src) => {
      const lines = src.split('\n'), leak = [], wash = [];
      let seen = 0;
      for (let i = 0; i < lines.length; i++) {
        if (!/db\.prepare\(\s*['"`]/.test(lines[i])) continue;
        if (!/INSERT INTO budgets\b|UPDATE budgets SET\b/.test(lines[i])) continue;
        let stmt = '';
        for (let j = i; j < Math.min(i + 8, lines.length); j++) {
          stmt += (stmt ? ' ' : '') + lines[j];
          const ri = stmt.indexOf('.run(');
          if (ri < 0) continue;
          let d = 0, end = -1;
          for (let k = stmt.indexOf('(', ri); k < stmt.length; k++) {
            if (stmt[k] === '(') d++;
            else if (stmt[k] === ')') { d--; if (d === 0) { end = k; break; } }
          }
          if (end > 0) { stmt = stmt.slice(0, end + 1); break; }
        }
        if (!/\bfields\b/.test(stmt)) continue; // 不写 fields 的 budgets 语句不参与 D-10 对账
        seen++;
        const ri = stmt.indexOf('.run(');
        const sqlPart = ri < 0 ? stmt : stmt.slice(0, ri);
        const argsPart = ri < 0 ? '' : stmt.slice(ri);
        if (!/opp_code/.test(sqlPart) && !/opp_code/.test(argsPart)) { leak.push((i + 1) + ':' + lines[i].trim().slice(0, 46)); continue; }
        // 取序规则(D-15): 兜底只在该语句「有既有行」时才是义务——UPDATE 类, 或实参引用了 bd. 的派生 INSERT(newversion)。
        // Excel 导入与 POST 建单是全新行, 没有「该单既有列值」可兜, 强行要求 bd.opp_code 会让 DL-21 在真实代码上永久翻红(总线已实测踩过, 见下)
        const need = /UPDATE budgets SET/.test(sqlPart) || /\bbd\./.test(argsPart);
        if (need && !/bd\.opp_code/.test(argsPart)) wash.push((i + 1) + ':' + lines[i].trim().slice(0, 46));
      }
      return { leak, wash, seen };
    };
    const real = scan(fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'));
    check('DL-21', '对账语句数(实测 ' + real.seen + ', 期望 >=6: Excel/POST/PUT/newversion/apply/技能①)', real.seen >= 6);
    check('DL-21', '写 fields 的 budgets 语句全部同句投影 opp_code(漏点=' + (real.leak.join(' | ') || '无') + ')', real.leak.length === 0);
    check('DL-21', '投影取序含「该单既有列值」兜底(违规=' + (real.wash.join(' | ') || '无') + ')', real.wash.length === 0);
    // 反例自测(内存字符串, 不碰 server.js): 前两条必须被抓到, 后一条必须放过 —— 守「不恒绿」
    const neg1 = "const x = db.prepare('UPDATE budgets SET fields=?, calc=?, opp_code=?, updated_at=? WHERE id=?')\n      .run(JSON.stringify(m), JSON.stringify(c), null, now(), id);";
    const neg2 = "db.prepare('INSERT INTO budgets(code,project_name,applicant_id,fields,calc,\n  status,version,opp_code,parent_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')\n  .run(cd, nm, uid, f, calc, 'draft', 1, null, bd.id, t, t);";
    const pos = "db.prepare('UPDATE budgets SET fields=?, calc=?, opp_code=?, updated_at=? WHERE id=?')\n  .run(JSON.stringify(m), JSON.stringify(c), String(m.opp_code || bd.opp_code || '').trim() || null, now(), id);";
    check('DL-21', '反例自测-洗列 UPDATE 被抓(实 ' + scan(neg1).wash.length + ' 条)', scan(neg1).wash.length === 1);
    check('DL-21', '反例自测-跨行 INSERT 写死 null 被抓(实 ' + scan(neg2).wash.length + ' 条)', scan(neg2).wash.length === 1);
    check('DL-21', '反例自测-合规写法放过(实 wash=' + scan(pos).wash.length + ' leak=' + scan(pos).leak.length + ')', scan(pos).wash.length === 0 && scan(pos).leak.length === 0);
  }

  // DL-22(评审 M1 / 总线 D-18): D-15 触发态的对话路径必须动态覆盖——只送顶层 body.opp_code(fields 内无该键)建单, 对话一次后派生列不得被洗成 null
  {
    const c22 = S + '-dl22', code22 = await mkOpp(sales, c22);
    const r22 = await raw(sales, '/api/budget', 'POST', { project_name: 'DL-22 顶挂预算 ' + S, opp_code: code22, fields: DL_BUDGET('DL-22', null) });
    const bg22 = (r22.data || {}).id || 0;
    check('DL-22', '只送顶层 opp_code 建单 200(实 ' + r22.status + ')', r22.status === 200 && bg22 > 0);
    const before = (await raw(sales, '/api/budget/' + bg22)).data.budget || {};
    check('DL-22', '前置态成立: 派生列有值而 fields 内无 opp_code',
      before.opp_code === code22 && !((before.fields || {}).opp_code), JSON.stringify(before.opp_code));
    const chat = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bg22, message: '合同 240 万,分包 100 万' });
    check('DL-22', '对话技能① 200(降级亦 200)(实 ' + chat.status + ')', chat.status === 200);
    const after = (await raw(sales, '/api/budget/' + bg22)).data.budget || {};
    check('DL-22', '对话后派生列仍为原码(D-15 兜底生效, 未洗成 null)', after.opp_code === code22, JSON.stringify(after.opp_code));
    const og22 = await raw(sales, `/api/opp/${code22}/delivery`);
    check('DL-22', '对话后仍走商机级分流(GET 200 且 rate_source 有值)', og22.status === 200 && ['budget', 'review', 'none'].includes(og22.data.rate_source));
  }

  // DL-23(评审 M1 / 总线 D-18): /delivery/apply 同样只在静态守护里出现过, 补行为面
  {
    const c23 = S + '-dl23', code23 = await mkOpp(sales, c23);
    const r23 = await raw(sales, '/api/budget', 'POST', { project_name: 'DL-23 刷新预算 ' + S, opp_code: code23, fields: DL_BUDGET('DL-23', null) });
    const bg23 = (r23.data || {}).id || 0;
    await raw(sales, `/api/budget/${bg23}/delivery`, 'PUT', { rows: [{ content: 'DL-23 刷新行', stage: '实施', pm_pd: 3, own_pd: 6, prod_pd: 12 }] });
    const ap = await raw(sales, `/api/budget/${bg23}/delivery/apply`, 'POST');
    check('DL-23', 'apply 刷新交付科目 200(实 ' + ap.status + ')', ap.status === 200);
    const after23 = (await raw(sales, '/api/budget/' + bg23)).data.budget || {};
    check('DL-23', 'apply 后派生列未被洗(实 ' + JSON.stringify(after23.opp_code) + ')', after23.opp_code === code23);
    check('DL-23', 'apply 后四科目按明细刷新(dev_pd=6)', ((after23.fields || {}).dev_pd) === 6);
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
