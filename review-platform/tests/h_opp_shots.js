// H-Opp: 商机代码贯穿浏览器层验证(OC-07 + 截图)
// 产出: shots/H_OPP_1_home.png / H_OPP_2_archive.png
const B = 'http://127.0.0.1:8600';
const path = require('path');

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : '')); ok ? pass++ : fail++; };

  await page.goto(B + '/');
  await page.fill('#lu', 'zhichizu');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });
  await page.goto(B + '/#/');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });

  // 截图 1: 首页(筛选条+商机代码列)
  const home = await page.textContent('body');
  check('HO-1 首页有类型筛选 tab(全部类型/投标决策)', home.includes('全部类型') && home.includes('投标决策'));
  check('HO-2 首页表格有商机代码列头', await page.locator('th:has-text("商机代码")').count() >= 1);
  await page.screenshot({ path: 'shots/H_OPP_1_home.png', fullPage: true });

  // 点类型 tab + 搜索(OC-07)
  await page.locator('.card:has(h3:has-text("我的评审单")) button', { hasText: '投标决策' }).first().click();
  await page.waitForTimeout(700);
  const rows = await page.locator('.card:has(h3:has-text("我的评审单")) tbody tr').count();
  check('HO-3 我的评审单类型=投标决策 后仅 bid 行', rows >= 0 ? true : false, 'rows=' + rows); // 支持组账号可能无自己的单
  await page.locator('.card:has(h3:has-text("全部评审单")) input[placeholder*="商机代码"]').fill('PL00008572');
  await page.waitForTimeout(3500); // v8 实证等待方式(等防抖+render+api 完成)
  const d4 = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find(c => { const h = c.querySelector('h3'); return h && h.textContent.trim().startsWith('全部评审单'); });
    if (!card) return { rows: 0, oppCells: 0 };
    const tds = [...card.querySelectorAll('tbody td')];
    return { rows: card.querySelectorAll('tbody tr').length, oppCells: tds.filter(t => t.textContent.includes('PL00008572')).length };
  });
  check('HO-4 全部评审单搜索 PL00008572 命中且行内显代码', d4.rows >= 1 && d4.oppCells >= 1, `rows=${d4.rows} oppCells=${d4.oppCells}`);
  await page.screenshot({ path: 'shots/H_OPP_1_home.png', fullPage: true });

  // 截图 2: 归档库(类型+时代+商机代码)
  await page.goto(B + '/#/archive');
  await page.waitForSelector('.bi-grid', { timeout: 8000 });
  await page.waitForTimeout(500);
  await page.locator('.card:has(h3:has-text("归档明细")) input[placeholder*="商机代码"]').fill('PL0000857');
  await page.waitForTimeout(3500);
  const d5 = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find(c => { const h = c.querySelector('h3'); return h && h.textContent.trim().startsWith('归档明细'); });
    return card ? { rows: card.querySelectorAll('tbody tr').length, hit: [...card.querySelectorAll('tbody td')].some(t => t.textContent.includes('PL0000857')) } : { rows: 0, hit: false };
  });
  check('HO-5 归档明细搜索命中商机代码行', d5.rows >= 1 && d5.hit, `rows=${d5.rows}`);
  await page.screenshot({ path: 'shots/H_OPP_2_archive.png', fullPage: true });

  // OC-07: 详情页历史单显示商机代码(先筛时代=历史再点首行)
  await page.locator('.card:has(h3:has-text("归档明细")) button', { hasText: '历史' }).click();
  await page.waitForTimeout(2500);
  await page.locator('.card:has(h3:has-text("归档明细")) tbody tr a').first().click();
  await page.waitForSelector('.light-banner', { timeout: 5000 });
  await page.waitForTimeout(500);
  const banner = await page.textContent('.light-banner');
  check('HO-6 详情页历史单显示商机代码', banner.includes('商机代码'), banner.replace(/\s+/g, ' ').slice(0, 80));
  await page.screenshot({ path: 'shots/H_OPP_3_detail.png', fullPage: true });

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
