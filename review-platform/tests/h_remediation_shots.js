'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('E:/npm-global/node_modules/playwright');
const B = 'http://127.0.0.1:8600';
const logPath = process.argv.find(a => a.startsWith('--log='))?.slice(6) || 'tests/green_remediation_shots.txt';
const LOG = [], errors = [], tokens = {};
let pass = 0, fail = 0, browser, context, page;
const check = (id, ok, detail = '') => { const s = `${ok ? 'PASS' : 'FAIL'} - ${id}${detail ? ' | ' + detail : ''}`; LOG.push(s); console.log(s); ok ? pass++ : fail++; };
async function probe(id, fn) { try { check(id, await fn()); } catch (e) { check(id, false, String(e.message).split('\n')[0].slice(0, 160)); } }
async function api(u, url, method = 'GET', body) {
  const r = await fetch(B + url, { method, headers: { 'Content-Type': 'application/json', ...(tokens[u] ? { Authorization: 'Bearer ' + tokens[u] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(url + ': ' + r.status + ' ' + (d.error || ''));
  return d;
}
const S = String(Date.now()).slice(-7), code = n => 'PL-RM-UI-' + S + '-' + n;
const opp = n => ({ opp_code: code(n), title: 'RM界面商机' + n, customer: 'RM界面客户', biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策', sales: '王超', summary: '界面验收业务概述', region: '华东' });
const bidForm = c => ({ opp_code: c, customer: 'RM界面客户', biz_line: 'G1', contract_amount: '24', gross_margin: '15', ops_years: '1', sign_path: '客户→丰图科技(深圳)有限公司', sub_amount: '5', designated_sub_amount: '0', survey_sub_amount: '0', sub_core: '否', survey: '否', secret: '否', settle_method: '银行转账', payment_terms: '预付30%,验收70%', guarantee: '否', non_compete: '否', summary: '界面验收业务概述', data_review: '否', promo_target: '无', promo_outside: '否' });
async function budget(c, suffix) {
  const d = await api('sales1', '/api/budget', 'POST', { project_name: 'RM界面预算' + suffix, opp_code: c, fields: { project_name: 'RM界面预算' + suffix, customer: 'RM界面客户', contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, opp_code: c } });
  await api('sales1', '/api/budget/' + d.id + '/lock', 'POST');
  return d.id;
}
async function review(c, b, suffix, submit = false, omit = []) {
  const form = bidForm(c); for (const k of omit) delete form[k];
  const d = await api('sales1', '/api/reviews', 'POST', { type: 'bid', title: 'RM界面评审' + suffix, budget_id: b, form, submit: false });
  if (submit) await api('sales1', '/api/reviews/' + d.id + '/submit', 'POST');
  return d.id;
}
async function login(u, includeFixtures = false) {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (includeFixtures) await context.addInitScript(() => { localStorage.incFixture = '1'; });
  await context.route('**/*', route => { const host = new URL(route.request().url()).hostname; if (['127.0.0.1', 'localhost'].includes(host)) return route.continue(); errors.push('blocked external request: ' + host); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5000);
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  await page.goto(B); await page.fill('#lu', u); await page.fill('#lp', '123456'); await page.click('button:has-text("登 录")'); await page.waitForSelector('.metric-grid');
}
async function go(hash, selector) {
  await page.evaluate(h => new Promise(resolve => {
    if (location.hash === h) return resolve();
    const observer = new MutationObserver(() => { observer.disconnect(); resolve(); });
    observer.observe(document.querySelector('#page'), { childList: true });
    location.hash = h;
  }), hash);
  await page.waitForSelector(selector, { state: 'attached' });
  await page.waitForFunction(h => location.hash === h, hash);
}
const text = sel => page.locator(sel).innerText();
async function fixtures() {
  for (const u of ['sales1', 'zhichizu', 'admin', 'fin1', 'pur1', 'fde1', 'legal1', 'comp1', 'data1', 'pm1']) tokens[u] = (await api('', '/api/login', 'POST', { username: u, password: '123456' })).token;
  await api('sales1', '/api/opp', 'POST', opp(1)); await api('sales1', '/api/opp', 'POST', opp(2));
  await api('sales1', '/api/opp/' + code(1) + '/delivery', 'PUT', { rows: [{ content: '实施', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 }, { content: '运维', stage: '运维', pm_pd: 2 }] });
  await api('sales1', '/api/opp/' + code(1) + '/delivery/confirm', 'POST', {});
  const b1 = await budget(code(1), '一'), b2 = await budget(code(1), '二');
  const draft = await review(code(1), b1, '草稿'), live = await review(code(1), b1, '待办', true), missing = await review(code(1), b1, '缺覆盖', true, ['sub_amount']);
  const returned = await review(code(1), b1, '退回', true);
  let ts = (await api('zhichizu', '/api/reviews/' + returned)).tasks;
  await api('zhichizu', '/api/tasks/' + ts.find(t => t.ind_key === 'credit').id + '/complete', 'POST', { light: 'green', opinion: '' });
  await api('fin1', '/api/tasks/' + ts.find(t => t.ind_key === 'arrears').id + '/return', 'POST', { opinion: '请补材料' });
  for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) {
    ts = (await api(u, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === missing);
    for (const t of ts) await api(u, '/api/tasks/' + t.id + '/complete', 'POST', { light: 'green', opinion: '' });
  }
  const nulls = [];
  for (let i = 0; i < 2; i++) nulls.push((await api('sales1', '/api/reviews', 'POST', { type: 'presale', title: 'RM未挂靠单' + i, form: { customer: '未挂靠客户', biz_line: 'G1' }, submit: false })).id);
  const unlinked = await review(code(1), null, '未关联预算');
  await api('sales1', '/api/budget', 'POST', { project_name: 'RM未挂靠预算', fields: { project_name: 'RM未挂靠预算' } });
  const openBudget = (await api('sales1', '/api/budget', 'POST', { project_name: 'RM未锁定预算', opp_code: code(1), fields: { project_name: 'RM未锁定预算', opp_code: code(1) } })).id;
  const openLinked = await review(code(1), openBudget, '当前未锁定关联');
  await api('sales1', '/api/opp/' + code(2), 'PUT', { sign_date: '2026年Q4', survey: '是（外业）', biz_line: 'G1 ' });
  await api('sales1', '/api/opp', 'POST', opp(3));
  await api('sales1', '/api/opp/' + code(3) + '/delivery', 'PUT', { rows: [{ content: '归档链路', stage: '实施', own_pd: 10 }] });
  await api('sales1', '/api/opp/' + code(3) + '/delivery/confirm', 'POST', {});
  const b3 = await budget(code(3), '归档'), closed = await review(code(3), b3, '归档', true);
  for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) {
    const tasks = (await api(u, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === closed);
    for (const t of tasks) await api(u, '/api/tasks/' + t.id + '/complete', 'POST', { light: 'green', opinion: '' });
  }
  await api('zhichizu', '/api/reviews/' + closed + '/decision', 'POST', { decision_result: '同意', decision_note: 'RM真实部门评审后归档' });
  await api('zhichizu', '/api/reviews/' + closed + '/archive', 'POST', {});
  return { b1, b2, draft, live, missing, returned, nulls, unlinked, openBudget, openLinked, closed };
}
(async () => {
  try {
    const f = await fixtures(); check('PRE 全HTTP建档/确认/锁定/提交/真实部门打灯/退回成功', !!f.live && !!f.missing);
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await login('fin1', true);
    await probe('NT-01 首页站内草稿待办横幅', async () => (await text('#page')).includes('你所在部门有') && (await page.locator('a[href="#/tasks?review_id=' + f.live + '"]').count()) > 0);
    await go('#/tasks?review_id=' + f.live, '#taskTbl');
    await probe('NT-01 深链仅显示指定单待办', async () => { const links = await page.locator('#taskTbl a[href^="#/review/"]').evaluateAll(a => a.map(x => x.getAttribute('href'))); return links.length === 4 && links.every(h => h === '#/review/' + f.live); });
    await probe('IA-48 任务中心全单进度0/10', async () => (await text('#taskTbl')).includes('本单进度') && (await text('#taskTbl')).includes('0/10'));
    await page.locator('#taskTbl button:has-text("打灯")').first().click();
    await probe('EV-05 A/B/C三区标题与真实查询锚点', async () => { await page.waitForSelector('#evBox'); await page.waitForFunction(() => document.querySelector('#evBox')?.textContent.includes('RM界面客户')); const t = await text('#mask'); return ['A 类·系统已算', 'B 类·表单已采', 'C 类·部门自有系统', 'RM界面客户', code(1)].every(s => t.includes(s)); });
    await probe('EV-05 完整评审深链新标签与灯按钮保留', async () => (await page.locator('#mask a[target="_blank"][href="#/review/' + f.live + '"]').count()) === 1 && (await page.locator('#pk-g,#pk-y,#pk-r,#taskOp').count()) === 4);
    await page.screenshot({ path: path.resolve('shots/RM_evidence_' + path.basename(logPath, '.txt') + '.png') });
    await page.locator('#mask button:has-text("取消")').click();
    await page.route('**/api/tasks/*/evidence', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"证据服务不可用"}' }));
    await page.locator('#taskTbl button:has-text("打灯")').first().click();
    await probe('EV-05 证据失败显式披露且保留打灯入口', async () => { await page.waitForFunction(() => document.querySelector('#evBox')?.textContent.includes('证据服务不可用')); return await page.locator('#pk-g').isEnabled(); });
    await page.locator('#mask button:has-text("取消")').click(); await page.unroute('**/api/tasks/*/evidence');
    errors.splice(0, errors.length, ...errors.filter(s => !s.includes('503 (Service Unavailable)')));
    await page.route('**/api/reviews/' + f.live, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"详情暂不可用"}' }));
    await probe('IA-48 单张详情失败仍展示任务并明确进度未知', async () => { await page.evaluate(() => { window._pgCache = {}; rerenderPage(); }); await page.waitForFunction(() => document.querySelector('#taskTbl')?.textContent.includes('—/—')); return (await page.locator('#taskTbl button:has-text("打灯")').count()) === 4; });
    await page.unroute('**/api/reviews/' + f.live);
    errors.splice(0, errors.length, ...errors.filter(s => !s.includes('503 (Service Unavailable)')));
    for (const u of ['legal1', 'comp1', 'data1', 'pur1', 'fde1']) {
      await login(u);
      await probe('IA-44 ' + u + '相关商机导航及本部门单', async () => { if (!(await page.locator('.sidebar a[href="#/opps"]').count())) return false; await page.locator('.sidebar a[href="#/opps"]').click(); await page.waitForSelector('#oppsQ'); if (await page.locator('#fxToggle').count()) await page.locator('#fxToggle').check(); else await page.evaluate(() => { localStorage.incFixture = '1'; render(); }); await page.waitForFunction(c => document.querySelector('#oppsTbl')?.textContent.includes(c), code(1)); return (await text('.sidebar nav')).includes('相关商机') && (await text('#oppsTbl')).includes(code(1)); });
    }
    for (const u of ['pm1', 'sales1', 'zhichizu', 'admin']) {
      await login(u);
      await probe('IA-45 ' + u + '预算单导航可达', async () => { const a = page.locator('.sidebar a[href="#/budgets"]'); if (!(await a.count())) return false; await a.click(); await page.waitForFunction(() => document.querySelector('#page')?.textContent.includes('预算单(')); return true; });
    }
    await login('pm1', true);
    let foreignBudgetReads = 0;
    const watchForeignBudget = r => { if (new URL(r.url()).pathname === '/api/budget/' + f.b1) foreignBudgetReads++; };
    page.on('request', watchForeignBudget);
    await go('#/new/bid?opp=' + code(1) + '&budget=' + f.b1, '#f_title');
    await probe('BP-01 列表外预算不默认关联、不读取详情、不可下一步', async () => (await page.locator('#f_budget').inputValue()) === '' && await page.locator('#nextBtn').isDisabled() && foreignBudgetReads === 0 && (await text('#budgetGate')).includes('该预算单不在你的已锁定列表') && !(await text('#f_budget')).includes('当前关联'));
    page.off('request', watchForeignBudget);
    await go('#/new/bid?opp=' + code(1) + '&budget=' + f.openBudget, '#f_title');
    await probe('BP-05 未锁定深链也不自动关联', async () => (await page.locator('#f_budget').inputValue()) === '' && await page.locator('#nextBtn').isDisabled());
    await login('admin');
    await go('#/budgets', '#budgetsImpFile');
    await probe('IA-45 admin预算标题全部', async () => (await text('#page')).includes('预算单(全部)'));
    await page.locator('#fxToggle').check();
    await page.waitForFunction(c => document.querySelector('#page')?.textContent.includes(c), code(1));
    await probe('IA-45 admin全部预算包含其他建档人预算', async () => (await text('#page')).includes('RM界面预算一'));
    await probe('IA-45 版本链colspan实际7列', async () => { const b = page.locator('button:has-text("版本链")').first(); if (!(await b.count())) return false; await b.click(); await page.waitForSelector('tr[id^="bv-"] td'); return (await page.locator('tr[id^="bv-"] td').first().getAttribute('colspan')) === '7'; });
    await page.locator('#fxToggle').uncheck();
    await page.waitForFunction(c => !document.querySelector('#page')?.textContent.includes(c), code(1));
    let requests = 0; page.on('request', r => { if (new URL(r.url()).pathname === '/api/budget') requests++; });
    await go('#/', '.metric-grid'); await go('#/budgets', '#budgetsImpFile');
    await probe('PL-02 二次进入预算列表零网络请求', async () => requests === 0);
    await go('#/opp/' + code(2), '#oppLaunch');
    await probe('RD-01 未就绪三卡列缺口且真实跳转', async () => { const t = await text('#oppLaunch'); return t.includes('未就绪') && t.includes('去确认交付预算') && t.includes('草稿可填') && (await page.locator('#oppLaunch [data-launch]').count()) === 3; });
    await probe('RD-01 缺口跳转滚动交付卡', async () => { const a = page.locator('#oppLaunch a:has-text("去确认交付预算")').first(); if (!(await a.count())) return false; await a.click(); return await page.locator('#oppDlv').evaluate(el => el.getBoundingClientRect().top < 300); });
    await go('#/opp/' + code(1), '#oppLaunch');
    await probe('RD-01 ①②完成显示就绪', async () => (await text('#oppLaunch')).includes('就绪') && !(await text('#oppLaunch')).includes('未就绪'));
    await probe('RD-04 已有提交仍有下一步指引', async () => (await text('#oppChain')).includes('下一步'));
    await probe('IA-46 预算新建只一次并逐行关联', async () => (await page.locator('#oppBudgets button:has-text("新建项目预算")').count()) === 1 && (await text('#oppBudgets')).includes('已被 #' + f.live) && (await text('#oppBudgets')).includes('未关联'));
    await go('#/opp/' + code(3), '#oppChain');
    await probe('RD-04 全部在线单已归档指引查看归档', async () => (await text('#oppNextStep')).includes('已归档') && !/下一步[：:]\s*下一步/.test(await text('#oppNextStep')));
    await page.waitForSelector('#opdlvTable [data-ok="content"]');
    await page.locator('#opdlvTable [data-ok="content"]').first().fill('归档后修订交付明细');
    await page.locator('button:has-text("保存明细")').click();
    await probe('FS-01 已归档后交付回草稿的下一步仍优先确认', async () => { await page.waitForFunction(() => document.querySelector('#oppNextStep')?.textContent.includes('在「① 交付预算」编制明细并确认')); return !(await text('#oppNextStep')).includes('在线评审已归档') && (await text('#oppLaunch')).includes('去确认交付预算'); });
    await go('#/opp/' + code(2), '#oppProfileCard');
    await probe('IA-47 修改区域保留非标准日期和下拉原值', async () => { await page.locator('#oppProfileCard button:has-text("编辑档案")').click(); await page.locator('#oppProfileEdit [data-pk="region"]').fill('华南'); await page.locator('#oppProfileEdit button:has-text("保存")').click(); await page.waitForFunction(() => !document.querySelector('#oppProfileEdit [data-pk]')); const d = (await api('sales1', '/api/opp/' + code(2))).opp; return d.region === '华南' && d.sign_date === '2026年Q4' && d.survey === '是（外业）' && d.biz_line === 'G1 '; });
    await go('#/opp/' + code(1), '#oppProfileCard');
    await probe('IA-47 档案授权入口并留痕', async () => { const b = page.locator('#oppProfileCard button:has-text("编辑档案")'); if (!(await b.count())) return false; await b.click(); await page.locator('#oppProfileEdit [data-pk="region"]').fill('华南'); await page.locator('#oppProfileEdit button:has-text("保存")').click(); await page.waitForFunction(() => document.querySelector('#oppProfileCard')?.textContent.includes('字段 营销区域 由 华东 改为 华南')); return (await text('#oppProfileCard')).includes('档案人工修正'); });
    await probe('IA-50 灯色时间线与结论对比无内部阶段编号', async () => { const t = await text('#page'); return (await page.locator('#oppAnalysis [data-point]').count()) >= 1 && (await text('#oppAnalysis')).includes('结论对比') && !/P0 阶段|P2/.test(t); });
    await go('#/opp/' + code(1) + '/r/' + f.returned, '#instTabs');
    await page.locator('#instTabs [data-tab="pre"]').click();
    await probe('SM-02 本次前置展示代打角色与作废状态', async () => { const t = await text('#instBody'); return t.includes('由 销售支持组 代 财务BP 打灯') && t.includes('已作废'); });
    await probe('SM-01 作废任务不计已打灯', async () => (await text('#instProgress')).includes('已打灯 1') && !(await text('#instProgress')).includes('已打灯 9'));
    await probe('EV-05 L2已处理任务仍可只读查看三类依据', async () => { const b = page.locator('#instBody button:has-text("查看依据")').first(); if (!(await b.count())) return false; await b.click(); await page.waitForFunction(() => document.querySelector('#evBox')?.textContent.includes('RM界面客户')); const t = await text('#evBox'); return ['A 类·系统已算', 'B 类·表单已采', 'C 类·部门自有系统'].every(s => t.includes(s)) && (await page.locator('#pk-g,#pk-y,#pk-r,#taskOp').count()) === 0; });
    await probe('FS-05 已处理依据明确当前数据而非打灯快照', async () => (await text('#evBox')).includes('以下为当前数据，不是打灯时的快照'));
    if (await page.locator('#mask').count()) await page.locator('#mask button:has-text("关闭")').click();
    await page.route('**/api/tasks/*/evidence', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"只读证据暂不可用"}' }));
    await page.locator('#instBody button:has-text("查看依据")').first().click();
    await probe('FS-07 只读依据失败不提示去打灯且无写入口', async () => { await page.waitForFunction(() => document.querySelector('#evBox')?.textContent.includes('只读证据暂不可用')); return !(await text('#evBox')).includes('打灯') && (await page.locator('#pk-g,#pk-y,#pk-r,#taskOp').count()) === 0; });
    await page.locator('#mask button:has-text("关闭")').click(); await page.unroute('**/api/tasks/*/evidence');
    errors.splice(0, errors.length, ...errors.filter(s => !s.includes('503 (Service Unavailable)')));
    await probe('IA 返回上一步与面包屑归商机', async () => { const a = page.locator('.crumb-bar > a'); await a.click(); await page.waitForSelector('#oppProfileCard'); return await page.evaluate(c => location.hash === '#/opp/' + c, code(1)); });
    await go('#/opp/' + code(1) + '/r/' + f.missing, '#instTabs');
    await probe('EV-06 结论披露缺分包覆盖但不参与灯色', async () => { const t = await text('#instBody'); return t.includes('因数据缺失未参与判定') && t.includes('分包占比') && t.includes('仅披露，不参与灯色'); });
    await go('#/', '.metric-grid');
    await probe('SM-03 首页两状态计数与HTTP同源', async () => { const rs = (await api('admin', '/api/reviews?scope=all')).reviews.filter(r => !(r.opp_code || '').startsWith('PL-')); const ts = await page.locator('.metric-tile').evaluateAll(a => a.map(el => ({ label: el.querySelector('.m-label')?.textContent, n: el.querySelector('.m-value')?.textContent }))); return ['reviewing', 'judged'].every((s, i) => ts.some(t => t.label === ['前置收集中', '待录结论'][i] && Number(t.n) === rs.filter(r => r.status === s).length)); });
    await page.locator('#fxToggle').check();
    await probe('SM-03 首页待录结论行灯色与实际研判一致', async () => { const r = (await api('admin', '/api/reviews/' + f.missing)).review; await page.waitForSelector('a[href="#/review/' + f.missing + '"]'); const row = page.locator('tr').filter({ has: page.locator('a[href="#/review/' + f.missing + '"]') }).first(); return r.light !== 'yellow' && (await row.innerText()).includes(({ red: '红灯', green: '绿灯' })[r.light]); });
    await page.locator('#fxToggle').uncheck();
    const homeTotal = async () => Number(((await text('.dist-legend')).match(/共\s*(\d+)\s*单/) || [])[1]);
    const legendNum = async label => Number(((await text('.dist-legend')).match(new RegExp(label + '\\s*(\\d+)')) || [])[1]);
    const revSplit = async () => { const rs = (await api('admin', '/api/reviews?scope=all')).reviews; const isFx = r => (r.opp_code || '').startsWith('PL-'); return { real: rs.filter(r => !isFx(r)), fx: rs.filter(isFx).length }; };
    await probe('DG-04 首页灯色合计=非夹具真实单且红黄绿待研判逐档一致', async () => {
      const { real } = await revSplit(); const n = t => real.filter(r => (r.light || 'none') === t).length;
      const total = await homeTotal();
      return total === real.length && (await legendNum('红灯')) === n('red') && (await legendNum('黄灯')) === n('yellow') &&
        (await legendNum('绿灯')) === n('green') && (await legendNum('待研判')) === total - n('red') - n('yellow') - n('green');
    });
    await probe('DG-04 夹具开关前后首页合计差恰为夹具单数且关闭后复原', async () => {
      const before = await homeTotal(); const { fx } = await revSplit();
      if (!(fx > 0)) return false; // 夹具为 0 时差值断言会退化成恒真, 响亮失败而非空转通过
      await page.evaluate(() => { localStorage.incFixture = '1'; render(); });
      const shown = await homeTotal();
      await page.evaluate(() => { localStorage.incFixture = '0'; render(); });
      return shown - before === fx && (await homeTotal()) === before;
    });
    await probe('DG-05 测试开关默认隐藏→开启可见→关闭归零', async () => { if (!(await page.locator('#fxToggle').count())) return false; await page.locator('#fxToggle').check(); await go('#/opps', '#oppsTbl'); await page.waitForFunction(c => document.querySelector('#oppsTbl')?.textContent.includes(c), code(1)); const shown = (await text('#oppsTbl')).includes(code(1)); await page.locator('#fxToggle').uncheck(); await page.waitForFunction(c => !document.querySelector('#oppsTbl')?.textContent.includes(c), code(1)); return shown; });
    await probe('SM-04 空商机码评审独立成行且不居首', async () => { const t = await text('#oppsTbl'); const rr = page.locator('#oppsTbl > tbody > tr'); return t.includes('RM未挂靠单0') && t.includes('RM未挂靠单1') && (await rr.filter({ hasText: '未挂靠商机' }).count()) >= 2 && !(await rr.nth(1).innerText()).includes('未挂靠商机'); });
    await go('#/judge', '#judgePage');
    await probe('IA-48 三灯队列真实定位且无点击/错队列变异必失败', async () => {
      const aligned = key => {
        const el = document.getElementById('queue-' + key), root = document.scrollingElement;
        const r = el.getBoundingClientRect(), heading = el.querySelector('h3').getBoundingClientRect();
        const target = Math.min(Math.max(0, r.top + root.scrollTop), root.scrollHeight - root.clientHeight);
        return window.__rmQueueCalls.length === 1 && window.__rmQueueCalls[0] === 'queue-' + key &&
          Math.abs(root.scrollTop - target) <= 1 && heading.top >= 0 && heading.bottom <= innerHeight;
      };
      await page.evaluate(() => {
        window.__rmQueueCalls = [];
        window.__rmQueueScroll = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function(...args) {
          window.__rmQueueCalls.push(this.id);
          return window.__rmQueueScroll.apply(this, args);
        };
      });
      try {
        for (const [label, key] of [['待上会 · 待结论', 'meet'], ['绿灯待归档', 'green'], ['红灯已打回', 'red']]) {
          const a = page.locator('#judgePage .metric-tile').filter({ hasText: label });
          const handler = await a.getAttribute('onclick');
          if (!handler) return false;
          await page.evaluate(() => { window.__rmQueueCalls = []; window.scrollTo(0, 0); });
          await page.waitForFunction(() => document.scrollingElement.scrollTop === 0);
          await a.evaluate(el => el.removeAttribute('onclick'));
          try {
            await a.click();
            if (await page.evaluate(aligned, key) || await page.evaluate(() => window.__rmQueueCalls.length !== 0)) return false;
          } finally { await a.evaluate((el, value) => el.setAttribute('onclick', value), handler); }
          const wrong = key === 'meet' ? 'green' : 'meet';
          await a.evaluate((el, value) => el.setAttribute('onclick', value), handler.replace('queue-' + key, 'queue-' + wrong));
          try {
            await a.click();
            if (await page.evaluate(aligned, key) || !(await page.evaluate(k => window.__rmQueueCalls.at(-1) === 'queue-' + k, wrong))) return false;
          } finally { await a.evaluate((el, value) => el.setAttribute('onclick', value), handler); }
          await page.evaluate(() => { window.__rmQueueCalls = []; window.scrollTo(0, 0); });
          await page.waitForFunction(() => document.scrollingElement.scrollTop === 0);
          await a.click();
          await page.waitForFunction(aligned, key);
        }
        return true;
      } finally {
        await page.evaluate(() => { Element.prototype.scrollIntoView = window.__rmQueueScroll; delete window.__rmQueueScroll; delete window.__rmQueueCalls; });
      }
    });
    await go('#/archive', '#histFile');
    await probe('IA-49 历史入口明确直接入库', async () => (await text('#page')).includes('直接入库，不走流程'));
    await go('#/admin/robot', '#robotBusinessAdmin');
    await probe('NT-02 机器人本地预演积压与诚实能力文案', async () => { const t = await text('#page'); return t.includes('待投递') && t.includes('待发送草稿') && t.includes('本地预演'); });
    await page.evaluate(() => { localStorage.incFixture = '1'; window._taskS = { tab: 'all', collapse: true }; });
    await go('#/tasks', '#taskTbl');
    await probe('IA-48 按单折叠可展开同单所有已加载指标', async () => { const b = page.locator('#taskTbl button:has-text("展开本单")').first(); if (!(await b.count())) return false; const rid = await b.getAttribute('data-task-review'); const all = (await api('admin', '/api/tasks?scope=all')).tasks.filter(t => String(t.review_id) === rid); await b.click(); await page.waitForFunction(r => document.querySelectorAll('#taskTbl tr[data-task-review="' + r + '"]').length > 1, rid); return await page.locator('#taskTbl tr[data-task-review="' + rid + '"]').count() === all.length; });
    await login('fde1'); await go('#/opp/' + code(1), '#oppProfileCard');
    await probe('IA-47 FDE无档案编辑入口', async () => (await page.locator('#oppProfileCard button:has-text("编辑档案")').count()) === 0);
    await login('sales1', true);
    const myCount = Number(await page.locator('.metric-tile').filter({ hasText: '我的商机' }).locator('.m-value').innerText());
    await go('#/opps', '#oppsTbl');
    await probe('SM-03 我的商机计数与落地页含未挂靠预算逐行一致', async () => myCount === await page.locator('#oppsTbl tr[onclick]').count() && (await text('#oppsTbl')).includes('RM未挂靠预算'));
    await go('#/opp/' + code(1), '#opdlvTable');
    await page.waitForSelector('#opdlvTable [data-ok="content"]');
    await page.locator('#opdlvTable [data-ok="content"]').first().fill('实时链路修订');
    await page.evaluate(() => { window.rmEditor = document.querySelector('#opdlvTable'); });
    await page.locator('button:has-text("保存明细")').click();
    await probe('RD-LIVE 保存回草稿立即刷新链态和就绪卡且保留编辑器', async () => {
      await page.waitForFunction(() => document.querySelector('#opdlvPill')?.textContent.includes('草稿') && !document.querySelector('#oppChain .chain-dot')?.classList.contains('on') && document.querySelector('#oppLaunch')?.textContent.includes('去确认交付预算'));
      return await page.evaluate(() => window.rmEditor === document.querySelector('#opdlvTable')) && (await page.locator('#opdlvTable [data-ok="content"]').first().inputValue()) === '实时链路修订';
    });
    await go('#/', '.metric-grid'); await go('#/opp/' + code(1), '#opdlvTable');
    await page.waitForSelector('#opdlvTable [data-ok="content"]');
    await page.evaluate(() => { window.rmEditor = document.querySelector('#opdlvTable'); });
    await probe('RD-01 change不适用时不预带预算且按钮说明一致', async () => { const card = page.locator('#oppLaunch [data-launch="change"]'), link = card.locator('a.btn'); return (await card.innerText()).includes('不适用') && (await link.innerText()) === '发起评审（不关联预算）' && !(await link.getAttribute('href')).includes('budget='); });
    await page.locator('#opdlvConfirmBtn').click();
    await probe('RD-LIVE 确认后立即就绪且页面不重载', async () => {
      await page.waitForFunction(() => document.querySelector('#opdlvPill')?.textContent.includes('已确认') && document.querySelector('#oppChain .chain-dot')?.classList.contains('on') && !document.querySelector('#oppLaunch')?.textContent.includes('未就绪'));
      return await page.evaluate(() => window.rmEditor === document.querySelector('#opdlvTable'));
    });
    await page.route('**/api/opp/' + code(1) + '/360', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"链路读取暂不可用"}' }));
    await page.locator('button:has-text("保存明细")').click();
    await probe('FS-09 写成功刷新失败明确已保存且实际草稿已写', async () => { await page.locator('.toast.err').filter({ hasText: '已保存，链路状态刷新失败' }).waitFor(); return (await api('sales1', '/api/opp/' + code(1) + '/delivery')).delivery.status === 'draft'; });
    await page.locator('#opdlvConfirmBtn').click();
    await probe('FS-10 确认成功刷新失败明确已确认且实际状态正确', async () => { await page.locator('.toast.err').filter({ hasText: '已确认，链路状态刷新失败' }).waitFor(); return (await api('sales1', '/api/opp/' + code(1) + '/delivery')).delivery.status === 'confirmed'; });
    await page.unroute('**/api/opp/' + code(1) + '/360');
    errors.splice(0, errors.length, ...errors.filter(s => !s.includes('503 (Service Unavailable)')));
    await go('#/new', '#impType');
    await probe('CH-01 change无Excel模板不可选', async () => (await page.locator('#impType option[value="change"]:not([disabled])').count()) === 0 && (await text('#page')).includes('变更决策无 Excel 模板，请在线填写'));
    await probe('IA-49 向导标记导入为草稿', async () => (await text('#page')).includes('导入为草稿'));
    await go('#/review/' + f.unlinked + '/edit', '#f_title');
    await probe('RD-03 未关联预算草稿仍可保存基础信息', async () => { await page.fill('#f_title', 'RM未关联正常保存'); await page.locator('#nextBtn').click(); await page.waitForFunction(() => location.hash.startsWith('#/budget/')); const r = (await api('sales1', '/api/reviews/' + f.unlinked)).review; return r.title === 'RM未关联正常保存' && r.budget_id === null; });
    await go('#/review/' + f.openLinked + '/edit', '#f_title');
    await probe('RD-03 不在已锁列表的当前预算仍准确显示', async () => (await page.locator('#f_budget').inputValue()) === String(f.openBudget));
    await probe('RD-03 未变更关联时保存不重校验或追加关联事件', async () => { const before = (await api('sales1', '/api/reviews/' + f.openLinked)).events.filter(e => e.action === '关联预算单').length; await page.fill('#f_title', 'RM保留当前关联'); await page.locator('#nextBtn').click(); await page.waitForFunction(() => location.hash.startsWith('#/budget/')); const d = await api('sales1', '/api/reviews/' + f.openLinked); return d.review.title === 'RM保留当前关联' && d.review.budget_id === f.openBudget && d.events.filter(e => e.action === '关联预算单').length === before; });
    await go('#/review/' + f.draft + '/edit', '#f_title');
    await probe('RD-03 编辑关联预算存在且原值准确', async () => (await page.locator('#f_budget').count()) === 1 && (await page.locator('#f_budget').inputValue()) === String(f.b1));
    await probe('RD-03 UI修改关联预算真实PUT', async () => { if (!(await page.locator('#f_budget').count())) return false; await page.selectOption('#f_budget', String(f.b2)); await page.locator('#nextBtn').click(); await page.waitForFunction(() => location.hash.startsWith('#/budget/')); return (await api('sales1', '/api/reviews/' + f.draft)).review.budget_id === f.b2; });
    await go('#/new/bid?opp=' + code(1) + '&budget=' + f.b1, '#f_title');
    await probe('BP-03 本人已锁预算仍正常预选', async () => (await page.locator('#f_budget').inputValue()) === String(f.b1));
    await probe('RD-02 必填未满显示N/M', async () => (await page.locator('#readyBar').count()) === 1 && /必填\s*\d+\/\d+/.test(await text('#readyBar')));
    await probe('RD-02 填满后实时变绿不刷新', async () => { const before = await page.evaluate(() => performance.timeOrigin); const meta = await api('sales1', '/api/meta/fields'); await page.fill('#f_title', 'RM实时就绪'); for (const x of meta.bid.filter(x => x.req)) { const el = page.locator('[data-k="' + x.k + '"]'); if (!(await el.count())) continue; if (await el.evaluate(e => e.tagName === 'SELECT')) await el.selectOption({ index: 0 }); else await el.fill(await el.getAttribute('type') === 'number' ? '1' : await el.getAttribute('type') === 'date' ? '2026-12-31' : 'RM就绪值'); } await page.selectOption('#f_budget', String(f.b1)); await page.waitForFunction(() => document.querySelector('#readyBar')?.dataset.ready === 'true'); return before === await page.evaluate(() => performance.timeOrigin); });
    await probe('PL-01 部门文案随META变异无需改前端', async () => { await page.evaluate(() => { if (typeof META === 'undefined' || !META?.indEvidence) return; META.indEvidence.bid[0].dept = '变异部门'; }); await go('#/tasks', '#taskTbl'); return (await text('#page')).includes('变异部门'); });
    await page.screenshot({ path: path.resolve('shots/RM_ready_' + path.basename(logPath, '.txt') + '.png') });
    const work = await api('admin', '/api/robot/workbench?opp_code=' + code(1)); check('PIN NT-02 仍无外部投递能力', work.provider.active === false && work.capabilities.provider_send === false);
    check('PIN 浏览器console/pageerror无非预期错误', errors.length === 0, errors.join('; ').slice(0, 1500));
  } catch (e) { check('CRASH', false, e.stack); }
  finally { if (browser) await browser.close(); LOG.push(`\n${pass} passed, ${fail} failed -> ${fail ? 'SOME FAIL' : 'ALL PASS'}`); fs.writeFileSync(path.resolve(logPath), LOG.join('\n') + '\n', 'utf8'); }
  process.exit(fail ? 1 : 0);
})();
