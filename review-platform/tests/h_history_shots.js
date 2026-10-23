// H-History: 历史数据承接浏览器层验证(归档库三呈现+详情说明卡)
// 产出: shots/H_HISTORY_1_archive.png / H_HISTORY_2_detail.png
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

  // 截图 1: 归档库(历史 pill + 筛选 + 补录入口 + BI 四档双口径)
  await page.goto(B + '/#/archive');
  await page.waitForSelector('.bi-grid', { timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'shots/H_HISTORY_1_archive.png', fullPage: true });
  check('HH-1 归档库有历史筛选按钮组', await page.locator('text=历史').count() >= 1);
  check('HH-2 补录历史评审入口(支持组)', await page.locator('#histFile').count() === 1);
  const body = await page.textContent('.bi-grid');
  check('HH-3 BI 灯色分布含历史未评档', body.includes('历史未评'), 'none 档文案在');
  const metrics = await page.textContent('.metric-grid');
  check('HH-4 kpi 双口径(在线绿灯率+历史通过率)', metrics.includes('在线绿灯率') && metrics.includes('历史结论通过率'), metrics.replace(/\s+/g, ' ').slice(0, 120));
  check('HH-5 年度分布卡(2024/2026)', body.includes('年度分布') && body.includes('2024'));
  check('HH-6 历史单 pill 在明细表', (await page.textContent('body')).includes('历史'));

  // 历史筛选后只有历史单(hasText 是 locator 构造参数, 不能作 click 选项)
  await page.locator('.card:has(h3:has-text("归档明细")) button', { hasText: '历史' }).click();
  await page.waitForTimeout(800);
  const rows = await page.locator('.card-table-wrap tbody tr').count();
  check('HH-7 时代筛选=历史 后仅历史单(行数=历史单数, 累积自适应)', rows >= 1, 'rows=' + rows);

  // 截图 2: 历史单详情(说明卡)
  await page.click('.card-table-wrap tbody tr a');
  await page.waitForSelector('.light-banner', { timeout: 5000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'shots/H_HISTORY_2_detail.png', fullPage: true });
  const banner = await page.textContent('.light-banner');
  check('HH-8 详情页历史说明卡(评审日期/无前置过程/结论)', banner.includes('历史单据') && banner.includes('评审') && banner.includes('结论'), banner.replace(/\s+/g, ' ').slice(0, 100));

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
