// H-Lab v2: 解析器实验室浏览器层(上传实测+对账表+结构化调优+一键关联)
const B = 'http://127.0.0.1:8600';
const path = require('path');

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : '')); ok ? pass++ : fail++; };

  await page.goto(B + '/');
  await page.fill('#lu', 'zhichizu');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });

  await page.evaluate(() => { location.hash = '#/parser-lab'; });
  await page.waitForSelector('#labOut', { timeout: 10000 });
  await page.waitForTimeout(1200); // defaults 端点(python dump)较慢

  // HL-1: 页面加载(上传区+结构化调优表)
  check('HL-1 实验室页(上传区+调优表格)', (await page.locator('#labFile').count()) === 1 && (await page.locator('#labTune table').count()) >= 1);

  // HL-2: 调优表有字段行和关键词 chips(内置映射展示)
  const tuneText = await page.textContent('#labTune');
  check('HL-2 调优表展示字段与关键词(含 contract_amount)', tuneText.includes('contract_amount') && tuneText.includes('合同金额'));

  // 上传真实表实测
  const f8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');
  await page.fill('#labSheet', '投标决策');
  await page.setInputFiles('#labFile', f8572);
  await page.click('button:has-text("解析并对照")');
  await page.waitForSelector('#labOut table', { timeout: 30000 });
  await page.waitForTimeout(600);
  const body = await page.textContent('#labOut');
  check('HL-3 对账表渲染+一键调优列', body.includes('一键调优') && body.includes('一致'));
  await page.screenshot({ path: 'shots/H_LAB_1_result.png', fullPage: true });

  // HL-4: 一键关联——未匹配标签行有"选字段…"下拉
  const selects = await page.locator('#labOut select').count();
  check('HL-4 未匹配标签行有字段下拉(可一键关联)', selects >= 1, 'selects=' + selects);

  // HL-7: 左右分区(独立面板) + 右栏原表证据网格
  const panels = await page.locator('#labOut .imp-rv-panel').count();
  const gridCells = await page.locator('#labOut td[id^="impRvC_"]').count();
  check('HL-7 实验室左右分区+原表证据网格', panels >= 2 && gridCells >= 30, `panels=${panels} cells=${gridCells}`);

  // HL-8: 点击对账行→右侧原表对应单元格聚焦(琥珀)
  const clickedLab = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('#labOut tr[onclick]')].find(t => /R\d+C\d+/.test(t.textContent));
    if (!tr) return null;
    tr.click();
    return tr.textContent.trim().slice(0, 40);
  });
  await page.waitForTimeout(400);
  const labPick = await page.evaluate(() => [...document.querySelectorAll('#labOut td.imp-rv-pick')].map(c => c.id));
  check('HL-8 点击对账行→原表格子聚焦', !!clickedLab && labPick.length >= 1, (clickedLab || 'no-row') + ' | pick=' + labPick.join(','));
  await page.screenshot({ path: 'shots/H_LAB_3_grid.png', fullPage: true });

  // HL-5: 添加关键词(chips 交互)——随机词避免撞前次运行保存的调优
  const rnd = '调优验证' + (Date.now() % 10000);
  await page.locator('#labTune input[placeholder*="关键词回车"]').first().fill(rnd);
  await page.locator('#labTune input[placeholder*="关键词回车"]').first().press('Enter');
  await page.waitForTimeout(400);
  const tuneText2 = await page.textContent('#labTune');
  check('HL-5 添加关键词生效(chips 新词+未保存标记)', tuneText2.includes(rnd) && (await page.textContent('#labDirty')).includes('未保存'));

  // HL-6: 保存调优
  await page.click('button:has-text("保存调优")');
  await page.waitForTimeout(800);
  const msg = await page.textContent('#labMapMsg');
  check('HL-6 保存调优反馈', msg.includes('已保存'), msg.slice(0, 40));
  await page.screenshot({ path: 'shots/H_LAB_2_tune.png', fullPage: true });

  // HL-9: 恢复内置(丢弃调优残留, 供下轮干净跑)
  await page.evaluate(() => { window._lab.ov = {}; });
  await page.click('button:has-text("保存调优")').catch(() => {});
  await page.waitForTimeout(600);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
