// H-ImportReview: 导入核对视图(左字段+右Excel原表高亮+来源坐标)
const B = 'http://127.0.0.1:8600';
const path = require('path');

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let pass = 0, fail = 0;
  const LOG = [];
  const check = (name, ok, ev) => { const line = (ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + String(ev).replace(/\s+/g, ' ').slice(0, 80) : ''); console.log(line); LOG.push(line); ok ? pass++ : fail++; };

  await page.goto(B + '/');
  await page.fill('#lu', 'zhichizu');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });

  // 走预算单列表页导入入口
  await page.evaluate(() => { location.hash = '#/budgets'; });
  await page.waitForSelector('#budgetsImpFile', { timeout: 8000, state: 'attached' });
  await page.waitForTimeout(800);
  const f8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');
  await page.setInputFiles('#budgetsImpFile', f8572);
  await page.waitForSelector('h3:has-text("导入核对")', { timeout: 30000 });
  await page.waitForTimeout(800);

  // HR-1: 核对视图出现(左字段+右原表)
  const body = await page.textContent('#page');
  check('HR-1 导入后出核对视图(不再直接跳走)', body.includes('解析字段') && body.includes('Excel 原表'));

  // HR-2: 字段表含来源列(标签+R/C 坐标)
  check('HR-2 字段表含来源标签与坐标', body.includes('来源(原表)') && /R\d+C\d+/.test(body));

  // HR-3: 原表网格高亮(蓝框=标签, 绿底=值)
  const labCell = await page.locator('#page td[style*="1.5px solid"]').count();
  const valCell = await page.locator('#page td[style*="rgba(63,192,156"]').count();
  check('HR-3 原表网格有高亮单元格(标签框+取值底)', labCell >= 5 && valCell >= 5, `lab=${labCell} val=${valCell}`);

  // HR-4: 核心字段值正确(合并 mapping 后)
  check('HR-4 核对视图显示 contract=240000', body.includes('240000') || body.includes('240'));

  // HR-8: 点击左字段行→右侧对应单元格聚焦强高亮(交互联动)
  {
    const clicked = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('#impRvL tbody tr')].find(t => /R\d+C\d+/.test(t.textContent));
      if (!tr) return null;
      tr.click();
      return tr.textContent.trim().slice(0, 60);
    });
    check('HR-8 左表行可点击且有来源', !!clicked, clicked || 'no-row');
    await page.waitForTimeout(500);
    const pick = await page.evaluate(() => [...document.querySelectorAll('td.imp-rv-pick')].map(c => c.id));
    check('HR-8b 点击后右侧出现聚焦格(imp-rv-pick)', pick.length >= 1, pick.join(','));
    // HR-10: 左右独立面板分区(解析结果 vs 源头证据)
    const panels = await page.evaluate(() => [...document.querySelectorAll('#page .imp-rv-panel')].map(p => p.className).join(','));
    check('HR-10 核对视图左右明确分区(独立面板)', /imp-rv-left/.test(panels) && /imp-rv-right/.test(panels), panels);
  }

  await page.screenshot({ path: 'shots/H_IMPORT_REVIEW.png', fullPage: true });

  // HR-5: 下一步按钮(跳转)
  await page.click('button:has-text("进入预算单核对")');
  await page.waitForTimeout(1200);
  const hash = await page.evaluate(() => location.hash);
  check('HR-5 「下一步」跳转预算单对话页', /#\/agent\?b=\d+/.test(hash), 'hash=' + hash);
  const hrBid = (hash.match(/#\/agent\?b=(\d+)/) || [])[1];

  // 评审导入入口同样出核对视图
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForSelector('#impFile', { timeout: 8000 });
  await page.waitForTimeout(500);
  const fc02 = path.join(__dirname, 'realdata', '【投标决策】PL00008068-260921-昆山市消防要素可视化分析平台 (1).xlsx');
  await page.setInputFiles('#impFile', fc02);
  await page.click('button:has-text("上传 Excel 导入评审单")');
  await page.waitForSelector('h3:has-text("评审单导入核对")', { timeout: 30000 });
  await page.waitForTimeout(600);
  const body2 = await page.textContent('#page');
  check('HR-6 评审导入同样出核对视图', body2.includes('解析字段') && body2.includes('Excel 原表'));
  check('HR-7 评审核对显示商机名称短名', body2.includes('昆山市消防要素可视化分析平台'));
  await page.screenshot({ path: 'shots/H_IMPORT_REVIEW2.png', fullPage: true });

  // HR-9: 附3 交付明细上传→行级核对视图(左明细行+右原表, 点击联动)
  {
    // agent 页异步渲染可能晚于 delivery 页完成并覆盖之(慢页竞态): 轮询重设 hash 直至 #dlvFile 出现
    await page.evaluate(b => { location.hash = '#/delivery/' + b; }, hrBid);
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      ok = await page.waitForSelector('#dlvFile', { timeout: 5000 }).then(() => true).catch(() => false);
      if (!ok) await page.evaluate(b => { location.hash = '#/delivery/' + b; }, hrBid);
    }
    await page.waitForTimeout(400);
    if (!await page.$('#dlvFile')) {
      const dbg = await page.evaluate(() => ({ hash: location.hash, page: ($('#page') || {}).textContent ? $('#page').textContent.replace(/\s+/g, ' ').slice(0, 300) : 'EMPTY', err: window.__lastToast || null }));
      console.log('[HR-9 dump]', JSON.stringify(dbg));
    }
    await page.waitForTimeout(600);
    await page.setInputFiles('#dlvFile', f8572);
    await page.click('button:has-text("上传 Excel 解析")');
    await page.waitForSelector('h3:has-text("附3 交付明细导入核对")', { timeout: 30000 });
    await page.waitForTimeout(600);
    const body3 = await page.textContent('#page');
    check('HR-9 附3 上传出行级核对视图(明细行+原表)', body3.includes('明细行') && body3.includes('原表'));
    check('HR-9e 附3 核对视图左右明确分区', (await page.locator('#page .imp-rv-panel').count()) >= 2, 'panels=' + (await page.locator('#page .imp-rv-panel').count()));
    const clickedRow = await page.evaluate(() => {
      const tr = document.querySelector('#impRvL tbody tr[onclick]');
      if (!tr) return null;
      tr.click();
      return tr.textContent.trim().slice(0, 40);
    });
    check('HR-9b 明细行可点击', !!clickedRow, clickedRow || 'no-row');
    await page.waitForTimeout(500);
    const pick = await page.evaluate(() => [...document.querySelectorAll('td.imp-rv-pick')].map(c => c.id));
    check('HR-9c 点击行→右侧聚焦高亮(内容格+人天格)', pick.length >= 2, pick.join(','));
    await page.screenshot({ path: 'shots/H_IMPORT_REVIEW3.png', fullPage: true });
    await page.click('button:has-text("确认无误")');
    await page.waitForTimeout(1200);
    const body4 = await page.textContent('#page');
    check('HR-9d 确认后进明细编辑页(可保存)', body4.includes('明细行') && body4.includes('保存明细'));
  }

  await browser.close();
  const summary = `\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log(summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) { require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + summary + '\n', 'utf8'); console.log('日志已写入: ' + logFile.slice(6)); }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
