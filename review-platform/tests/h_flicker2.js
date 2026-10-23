// H-Flicker2: 闪烁根治实证——筛选点击全程无"加载中"中间态 + DOM 保持
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
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  await page.waitForTimeout(2500);

  // 观察: 点击筛选后 #page 是否出现"加载中"(中间态)——用 MutationObserver 捕捉全程
  await page.evaluate(() => {
    window.__sawLoading = false;
    const obs = new MutationObserver(() => {
      const page = document.querySelector('#page');
      if (page && page.querySelector('.empty') && page.textContent.includes('加载中')) window.__sawLoading = true;
    });
    obs.observe(document.querySelector('#page'), { childList: true, subtree: true });
  });
  await page.locator('.card:has(h3:has-text("我的评审单")) button', { hasText: '投标决策' }).first().click();
  await page.waitForTimeout(1500);
  const sawLoading = await page.evaluate(() => window.__sawLoading);
  check('HF2-1 点筛选全程无加载中中间态', sawLoading === false, 'sawLoading=' + sawLoading);

  // 搜索: 输入后重渲染也无中间态
  await page.evaluate(() => { window.__sawLoading = false; });
  await page.locator('.card:has(h3:has-text("全部评审单")) input[placeholder*="商机代码"]').fill('PL00008572');
  await page.waitForTimeout(2000);
  const sawLoading2 = await page.evaluate(() => window.__sawLoading);
  check('HF2-2 搜索重渲染全程无加载中中间态', sawLoading2 === false, 'sawLoading=' + sawLoading2);

  // 结果仍正确(筛选没被优化破坏)
  const d4 = await page.evaluate(() => {
    const card = [...document.querySelectorAll('.card')].find(c => { const h = c.querySelector('h3'); return h && h.textContent.trim().startsWith('全部评审单'); });
    return card ? { rows: card.querySelectorAll('tbody tr').length } : { rows: 0 };
  });
  check('HF2-3 搜索结果正确(命中行)', d4.rows >= 1, 'rows=' + d4.rows);

  // 归档库筛选同样验证
  await page.goto(B + '/#/archive');
  await page.waitForSelector('.bi-grid', { timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.__sawLoading = false;
    const obs = new MutationObserver(() => {
      const page = document.querySelector('#page');
      if (page && page.querySelector('.empty') && page.textContent.includes('加载中')) window.__sawLoading = true;
    });
    obs.observe(document.querySelector('#page'), { childList: true, subtree: true });
  });
  await page.locator('.card:has(h3:has-text("归档明细")) button', { hasText: '历史' }).click();
  await page.waitForTimeout(1500);
  const sawLoading3 = await page.evaluate(() => window.__sawLoading);
  check('HF2-4 归档时代筛选全程无加载中', sawLoading3 === false, 'sawLoading=' + sawLoading3);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
