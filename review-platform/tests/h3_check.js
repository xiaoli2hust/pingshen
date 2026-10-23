// 阶段 3 H-07/H-08 人工验收自动化(playwright + 系统 Chrome): #/review/:id 后台区结论录入
// H-07: 结论录入(同意/不同意+说明)表单可用, 提交后只读卡+事件留痕
// H-08: 勾选意见不一致后路由变 XO 级(意见冲突重路由), reroute_xo 事件可见, 灯色不变
// 前置: 服务 8600 运行中; 两张 judged 单由脚本内 API 预备(绿灯单+黄灯单)
const path = require('path');
const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
const { chromium } = playwright;
const SHOTS = path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const B = 'http://127.0.0.1:8600';

let pass = 0, fail = 0;
const check = (id, name, ok, evidence) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' - [' + id + '] ' + name + (evidence ? ' | ' + evidence : ''));
  ok ? pass++ : fail++;
};
const snap = (page, file) => page.screenshot({ path: path.join(SHOTS, file), fullPage: true });

async function api(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(reqPath + ' -> ' + (d.error || r.status));
  return d;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;
const GREEN_BUDGET = { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, project_name: 'H验收绿灯预算', customer: 'H验收客户' };
const LOW_BUDGET = { contract: 1000000, sub_cost: 600000, dev_dept: '交付处', dev_pd: 300, del_travel: 50000, project_name: 'H验收黄灯预算', customer: 'H验收客户' };
const BID_BASE = {
  opp_code: 'PL-T-H', opp_stage: '投标决策', region: '华北营销处-渠道', customer: 'H验收客户', biz_line: 'G1',
  contract_amount: '24', sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15', cost_happened: '0',
  ops_years: '1', sign_path: '客户公司→丰图科技(深圳)有限公司', sub_amount: '0', designated_sub_amount: '0',
  survey_sub_amount: '0', sub_core: '否', survey: '否', jiadao: '否', secret: '否', province: '江西省',
  product_type: '标品', promo_target: '无', promo_amount: '0', settle_method: '银行转账',
  payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: 'H验收', data_review: '是', data_plan: '公开POI数据', data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};
// 预备一张 judged 单(绿灯/黄灯)
async function makeJudged(tokens, budgetFields, title) {
  const sales = tokens.sales;
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: title + '-预算' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: budgetFields });
  await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'H验收明细(附3递进门禁)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
  await api(sales, `/api/budget/${bg}/lock`, 'POST');
  const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]' + title, form: BID_BASE, submit: false, budget_id: bg })).id;
  await api(sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'h.xlsx', data: Buffer.from('x').toString('base64') });
  await api(sales, `/api/reviews/${rid}/submit`, 'POST');
  for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) {
    const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
    for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
  }
  return rid;
}

(async () => {
  // ---- API 预备 ----
  const tokens = { sales: await login('sales1'), admin: await login('zhichizu') };
  for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) tokens[u] = await login(u);
  const greenRid = await makeJudged(tokens, GREEN_BUDGET, 'H07-结论录入验收');
  const yellowRid = await makeJudged(tokens, LOW_BUDGET, 'H08-意见冲突重路由验收');
  const gv = (await api(tokens.sales, '/api/reviews/' + greenRid)).review;
  const yv = (await api(tokens.sales, '/api/reviews/' + yellowRid)).review;
  check('PRE', '验收单就绪(绿灯+黄灯 judged)', gv.light === 'green' && gv.status === 'judged' && yv.light === 'yellow' && yv.status === 'judged', `green=${gv.light} yellow=${yv.light}`);

  // ---- 浏览器 ----
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(B + '/');
  await page.fill('#lu', 'zhichizu');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });

  // ---- H-07: 结论录入表单(绿灯单, 正常录"同意") ----
  await page.goto(B + '/#/review/' + greenRid);
  await page.reload();
  await page.waitForSelector('#decisionCard', { timeout: 5000 });
  check('H-07', '后台区结论录入表单可见(支持组+judged+未录)', true);
  await page.check('input[name="decR"][value="同意"]');
  await page.fill('#decNote', '绿灯免上会,同意推进(H-07 验收)');
  await page.click('button:has-text("提交结论")');
  await page.waitForSelector('text=后台 · 已录结论', { timeout: 5000 });
  const card = await page.textContent('#page');
  check('H-07', '提交后只读结论卡(同意+说明+录入人)', /已录结论/.test(card) && /同意/.test(card) && /绿灯免上会,同意推进/.test(card));
  check('H-07', '流转记录含"录入结论"事件', /录入结论/.test(card));
  await snap(page, 'H07.png');

  // ---- H-08: 意见不一致勾选(黄灯单) → 路由升级 XO + reroute_xo 留痕 ----
  await page.goto(B + '/#/review/' + yellowRid);
  await page.reload();
  await page.waitForSelector('#decisionCard', { timeout: 5000 });
  const before = (await page.textContent('#page'));
  const lightBefore = /黄灯/.test(before);
  await page.check('input[name="decR"][value="同意"]');
  await page.fill('#decNote', '部门意见冲突上会(H-08 验收)');
  await page.check('#decConflict');
  await page.click('button:has-text("提交结论")');
  await page.waitForSelector('text=后台 · 已录结论', { timeout: 5000 });
  await page.waitForFunction(() => /意见冲突重路由/.test(document.querySelector('#page').textContent), { timeout: 5000 });
  const after = await page.textContent('#page');
  check('H-08', '勾选后路由升级 XO 级(意见冲突重路由)', /XO级评审会\(意见冲突重路由\)|意见冲突重路由/.test(after));
  check('H-08', '灯色不变(仍黄灯)', lightBefore && /黄灯/.test(after));
  check('H-08', 'reroute_xo 事件留痕可见', /reroute_xo/.test(after));
  await snap(page, 'H08.png');

  check('PAGE', '全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join('; '));
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  await browser.close();
  // 清理: 归档
  for (const rid of [greenRid, yellowRid]) { try { await api(tokens.admin, `/api/reviews/${rid}/archive`, 'POST'); } catch (e) {} }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
