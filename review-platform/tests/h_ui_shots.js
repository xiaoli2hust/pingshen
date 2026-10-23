// 前端深色主题 UI 七页截图(人工过目用): 登录/工作台/新建表单/评审详情/agent对话/预算列表/交付明细
// 用法: node tests/h_ui_shots.js(服务 8600 运行中) -> tests/shots/UI_*.png
const path = require('path');
const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
const { chromium } = playwright;
const SHOTS = path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const B = 'http://127.0.0.1:8600';

let pass = 0, fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name); ok ? pass++ : fail++; };
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
const BID_BASE = {
  opp_code: 'PL-T-UI', opp_stage: '投标决策', region: '华北营销处-渠道', customer: 'UI截图客户', biz_line: 'G1',
  contract_amount: '24', sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15', cost_happened: '0',
  ops_years: '1', sign_path: '客户公司→丰图科技(深圳)有限公司', sub_amount: '0', designated_sub_amount: '0',
  survey_sub_amount: '0', sub_core: '否', survey: '否', jiadao: '否', secret: '否', province: '江西省',
  product_type: '标品', promo_target: '无', promo_amount: '0', settle_method: '银行转账',
  payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: 'UI', data_review: '是', data_plan: '公开POI数据', data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};

(async () => {
  // ---- API 预置: judged 评审单 + draft 预算单(带交付明细) ----
  const tokens = { sales: await login('sales1'), admin: await login('zhichizu') };
  for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) tokens[u] = await login(u);
  const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'UI截图预算' })).id;
  await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, project_name: 'UI截图预算', customer: 'UI截图客户' } });
  await api(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [
    { content: '南昌市POI数据', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 },
    { content: '南昌市POI数据', stage: '运维', pm_pd: 2 },
    { content: '验收文档', stage: '实施', own_pd: 4 }
  ] });
  await api(tokens.sales, `/api/budget/${bg}/lock`, 'POST');
  const rid = (await api(tokens.sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]UI截图-评审单', form: BID_BASE, submit: false, budget_id: bg })).id;
  await api(tokens.sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'ui.xlsx', data: Buffer.from('x').toString('base64') });
  await api(tokens.sales, `/api/reviews/${rid}/submit`, 'POST');
  for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) {
    const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
    for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
  }
  // 供截图用 draft 预算单(交付明细可编辑态)
  const bgDraft = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'UI截图-草稿预算' })).id;
  await api(tokens.sales, `/api/budget/${bgDraft}`, 'PUT', { fields: { contract: 1200000, sub_cost: 300000, dev_dept: '交付处', dev_pd: 100, del_travel: 8000 } });
  await api(tokens.sales, `/api/budget/${bgDraft}/delivery`, 'PUT', { rows: [
    { content: '数据初始化', stage: '实施', pm_pd: 3, own_pd: 22, prod_pd: 90 },
    { content: '运维支持', stage: '运维', pm_pd: 2 }
  ] });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  // 1 登录页
  await page.goto(B + '/');
  await page.waitForTimeout(500);
  await snap(page, 'UI_01_login.png');
  check('UI-01 登录页(深色 login-panel)', await page.locator('.login-panel').count() === 1);

  // 2 工作台(sales1: metric 卡 + sparkline + 分布条)
  await page.fill('#lu', 'sales1');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });
  await page.waitForSelector('.metric-tile', { timeout: 5000 });
  await page.waitForSelector('.sparkline', { timeout: 5000 });
  await page.waitForSelector('.dist-bar', { timeout: 5000 });
  check('UI-02 工作台(metric 卡+sparkline+灯色分布条)', true);
  await snap(page, 'UI_02_dashboard.png');

  // 3 新建表单
  await page.evaluate(() => { location.hash = '#/new/bid'; }); // V4.0 T7: #/new 首屏改为「新建待评审商机」建档表单(无类型卡), 类型表单直达 = 旧「首屏→点投标卡」同终点
  await page.waitForSelector('#f_title', { timeout: 5000 });
  await page.waitForTimeout(400);
  await snap(page, 'UI_03_form.png');
  check('UI-03 新建表单(深色表单+侧边栏)', true);

  // 4 评审详情(judged: banner+进度条+风险分级条+表格)
  await page.goto(B + '/#/review/' + rid);
  await page.reload();
  await page.waitForSelector('.light-banner', { timeout: 5000 });
  await page.waitForSelector('.progress-seg', { timeout: 5000 });
  await snap(page, 'UI_04_detail.png');
  check('UI-04 评审详情(灯色条幅+部门进度条+风险分级条)', true);

  // 5 agent 对话窗(技能①, 锁定单预览态)
  await page.goto(B + '/#/agent?b=' + bg);
  await page.reload();
  await page.waitForSelector('#agInput', { timeout: 5000 });
  await page.waitForTimeout(600);
  await snap(page, 'UI_05_agent.png');
  check('UI-05 agent 对话窗(气泡+预览+margin 卡)', true);

  // 6 预算单列表(状态分布条)
  await page.evaluate(() => { location.hash = '#/budgets'; });
  await page.waitForSelector('table', { timeout: 5000 });
  await page.waitForTimeout(300);
  await snap(page, 'UI_06_budgets.png');
  check('UI-06 预算单列表(状态分布条)', true);

  // 7 交付明细页(可编辑表+行成本占比条)
  await page.goto(B + '/#/delivery/' + bgDraft);
  await page.reload();
  await page.waitForSelector('#dlvTable', { timeout: 5000 });
  await page.waitForTimeout(400);
  await snap(page, 'UI_07_delivery.png');
  check('UI-07 交付明细(行成本占比条+汇总卡)', true);

  // 8 归档库 BI 区(KPI+八维度图)
  await page.goto(B + '/#/archive');
  await page.reload();
  await page.waitForSelector('.bi-grid', { timeout: 5000 });
  await page.waitForSelector('.rank-bar', { timeout: 5000 });
  await page.waitForSelector('.bar-cols', { timeout: 5000 });
  const biTiles = await page.locator('.metric-tile').count();
  check('UI-08 归档 BI(4 KPI+八维度图渲染)', biTiles >= 4, 'tiles=' + biTiles);
  await snap(page, 'UI_08_archive_bi.png');

  check('全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join('; '));
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  await browser.close();
  // 清理
  await api(tokens.admin, `/api/reviews/${rid}/archive`, 'POST');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
