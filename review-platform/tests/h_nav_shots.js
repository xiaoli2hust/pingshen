// H-Nav v2: 商机中枢式导航(spec 2026-10-14 §2.1)——角色 4~6 项扁平导航 + 商机列表→360° 入口 + 任务/研判保留页
const B = 'http://127.0.0.1:8600';
const path = require('path');
const LOG = [];
const out = s => { console.log(s); LOG.push(s); };

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { const line = (ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : ''); out(line); ok ? pass++ : fail++; };
  const login = async (u) => {
    await page.goto(B + '/');
    await page.fill('#lu', u);
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell', { timeout: 5000 });
  };
  const navTexts = async () => page.locator('.sidebar nav a').allTextContents();
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---- zhichizu: 六项 + 扁平 + 归档库锚 ----
  await login('zhichizu');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n1 = await navTexts();
  check('NAV-1 zhichizu 导航七项含全部预算单', sameArr(n1, ['首页', '全部商机', '全部预算单', '待办打灯', '研判台', '归档库', '解析器实验室']), '实得:' + n1.join(','));
  check('NAV-2 扁平无分组div + 归档库文本(h_flicker 锚)', (await page.locator('.sidebar .nav-group').count()) === 0 && (await page.locator('nav a:has-text("归档库")').count()) === 1);
  await page.screenshot({ path: 'shots/H_NAV_1_shell.png', fullPage: false });

  // ---- 商机列表 → 360° ----
  await page.evaluate(() => { location.hash = '#/opps'; });
  await page.waitForSelector('#oppsTbl', { timeout: 10000 });
  await page.fill('#oppsQ', 'PL00008572');
  await page.waitForTimeout(700);
  check('NAV-3 商机列表搜索命中', (await page.locator('#oppsTbl tbody tr[onclick]').count()) >= 1, 'rows=' + (await page.locator('#oppsTbl tbody tr[onclick]').count()));
  await page.locator('#oppsTbl tbody tr[onclick]').first().click();
  await page.waitForTimeout(500);
  const oppBody = await page.textContent('#oppsTbl');
  check('NAV-4 行展开单据链(评审单+预算单)', oppBody.includes('评审单') && oppBody.includes('预算单'));
  await page.click('#oppsTbl button:has-text("进入 360°")');
  await page.waitForTimeout(900);
  check('NAV-5 进入360°(hash+#oppPage)', ((await page.evaluate(() => location.hash)).includes('#/opp/PL00008572')) && (await page.locator('#oppPage').count()) === 1, 'hash=' + (await page.evaluate(() => location.hash)));
  await page.screenshot({ path: 'shots/H_NAV_2_opp360.png', fullPage: false });

  // ---- 待办打灯(不变页) ----
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForSelector('#taskTbl', { timeout: 10000 });
  const taskTabs = await page.textContent('body');
  check('NAV-6 任务中心(待打灯/已处理/全部监控)', taskTabs.includes('待打灯') && taskTabs.includes('已处理') && taskTabs.includes('全部监控'));
  await page.click('button:text-is("全部监控")');
  await page.waitForTimeout(800);
  check('NAV-7 全部监控有任务行(指标+部门列)', (await page.locator('#taskTbl tbody tr').count()) >= 1 && (await page.textContent('#taskTbl')).includes('评判指标'));
  await page.screenshot({ path: 'shots/H_NAV_3_tasks.png', fullPage: false });

  // ---- 研判台(不变页) ----
  await page.evaluate(() => { location.hash = '#/judge'; });
  await page.waitForSelector('#judgePage', { timeout: 10000 });
  await page.waitForTimeout(600);
  const judgeBody = await page.textContent('#judgePage');
  check('NAV-8 研判台四队列+灯色分布', judgeBody.includes('前置收集中') && judgeBody.includes('待上会') && judgeBody.includes('绿灯待归档') && judgeBody.includes('红灯已打回') && (await page.locator('#judgePage .dist-bar').count()) >= 1);
  await page.screenshot({ path: 'shots/H_NAV_4_judge.png', fullPage: false });

  // ---- 角色矩阵 ----
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fde1');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n2 = await navTexts();
  check('NAV-9 fde1 三项含相关商机', sameArr(n2, ['首页', '相关商机', '待办打灯']), '实得:' + n2.join(','));
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('sales1');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n3 = await navTexts();
  check('NAV-10 sales1 四项含我的预算单', sameArr(n3, ['首页', '我的商机', '我的预算单', '新建待评审商机']), '实得:' + n3.join(','));
  check('NAV-11 sales1 不见待办打灯/研判台/归档库/解析器实验室', (await page.locator('nav a:has-text("待办打灯")').count()) === 0 && (await page.locator('nav a:has-text("研判台")').count()) === 0 && (await page.locator('nav a:has-text("归档库")').count()) === 0 && (await page.locator('nav a:has-text("解析器实验室")').count()) === 0);
  await page.screenshot({ path: 'shots/H_NAV_5_sales.png', fullPage: false });
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fin1');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n4 = await navTexts();
  check('NAV-12 财务BP 四项(含待办打灯)', sameArr(n4, ['首页', '我的商机', '新建待评审商机', '待办打灯']), '实得:' + n4.join(','));

  await browser.close();
  out(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  require('fs').writeFileSync((process.argv.find(a=>a.startsWith('--log='))?path.resolve(process.argv.find(a=>a.startsWith('--log=')).slice(6)):path.join(__dirname, fail === 0 ? 'green_nav.txt' : 'red_nav.txt')), LOG.join('\n') + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); require('fs').writeFileSync((process.argv.find(a=>a.startsWith('--log='))?path.resolve(process.argv.find(a=>a.startsWith('--log=')).slice(6)):path.join(__dirname, 'red_nav.txt')), 'FAIL:' + e.message + '\n', 'utf8'); process.exit(1); });
