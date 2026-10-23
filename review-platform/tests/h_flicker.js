// H-Flicker: 闪烁修复验证(执行后留作回归资产)——断言点击筛选/导航后侧边栏 DOM 节点复用不重建
const B = 'http://127.0.0.1:8600';
const path = require('path');

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : '')); ok ? pass++ : fail++; };

  await page.goto(B + '/');
  await page.fill('#lu', 'zhichizu');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });
  await page.waitForSelector('.metric-grid', { timeout: 8000 });

  // 核心: 点击前后 sidebar 同一 DOM 节点(引用复用)
  const sidebarBefore = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    el.setAttribute('data-flicker-probe', 'P1');
    return el.getAttribute('data-flicker-probe');
  });
  await page.evaluate(() => { location.hash = '#/opps'; });
  await page.waitForSelector('#oppsTbl', { timeout: 10000 });
  await page.fill('#oppsQ', 'PL00008572');
  await page.waitForTimeout(700);
  const probeAfter = await page.evaluate(() => {
    const el = document.querySelector('.sidebar');
    return el ? el.getAttribute('data-flicker-probe') : null;
  });
  check('HF-1 点击筛选后侧边栏 DOM 复用(探针属性仍在)', probeAfter === 'P1', 'probe=' + probeAfter);

  // 导航切换也复用
  await page.evaluate(() => { document.querySelector('.sidebar').setAttribute('data-flicker-probe', 'P2'); });
  await page.goto(B + '/#/archive');
  await page.waitForSelector('.bi-grid', { timeout: 8000 });
  const probeNav = await page.evaluate(() => document.querySelector('.sidebar').getAttribute('data-flicker-probe'));
  check('HF-2 切换导航后侧边栏 DOM 复用', probeNav === 'P2', 'probe=' + probeNav);

  // 导航高亮正确刷新
  const on = await page.evaluate(() => document.querySelector('.sidebar nav a.on') ? document.querySelector('.sidebar nav a.on').textContent : null);
  check('HF-3 导航高亮随路由刷新(归档库 on)', on === '归档库', 'on=' + on);

  // 登出/登录循环后 shell 正确重建
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await page.fill('#lu', 'zhichizu');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });
  check('HF-4 登出→登录后 shell 正确重建', await page.locator('.app-shell').count() === 1);

  await page.screenshot({ path: 'shots/H_FLICKER_archive.png', fullPage: false });
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
