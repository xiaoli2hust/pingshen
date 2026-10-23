// H-Excel: 浏览器层截图证据——两入口页 + 实际 Excel 导入流程(执行后保留, 供 goal 审计)
// 产出: shots/H_EXCEL_1_new.png / H_EXCEL_2_agent.png / H_EXCEL_3_result.png
const B = 'http://127.0.0.1:8600';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : '')); ok ? pass++ : fail++; };

  await page.goto(B + '/');
  await page.fill('#lu', 'sales1');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });

  // 截图 1: 评审类型页导入入口
  await page.goto(B + '/#/new');
  await page.waitForSelector('#impFile', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/H_EXCEL_1_new.png', fullPage: true });
  check('HEX-1 评审类型页有 Excel 导入入口(文件+类型+按钮)', await page.locator('#impFile').count() === 1 && await page.locator('#impType').count() === 1);

  // 截图 2: 技能①页预算导入入口(隐藏 file input 用 attached 态等待)
  await page.goto(B + '/#/agent');
  await page.waitForSelector('#impBudgetFile', { timeout: 5000, state: 'attached' });
  await page.waitForSelector('text=上传 Excel 建预算单', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/H_EXCEL_2_agent.png', fullPage: true });
  check('HEX-2 技能①页有上传 Excel 建预算单入口', await page.locator('#impBudgetFile').count() === 1);

  // 截图 3: 实际导入流程(构造 xlsx → setInputFiles → 跳转核对页)
  const rows = [['项目名称', 'H-Excel 浏览器证据'], ['客户名称', '江西省自然资源测绘与监测院'], ['合同金额', 240000], ['分包采购成本', 0], ['软件类生产外包', 0], ['灵活用工', 0], ['销售差旅费', 5000], ['招待费', 5000], ['市场营销', 0], ['所属部门', '交付处'], ['正编人天', 39], ['生产人天', 184], ['研发外包', 0], ['交付差旅', 8000], ['项目管理费', 11872], ['验收招待及综合办公', 2000]];
  const pyCode = 'import openpyxl, json, sys\nrows = json.loads(sys.argv[1])\nwb = openpyxl.Workbook()\nws = wb.active\nws.title = "附1-预算表" if sys.argv[2] == "budget" else "x"\nfor r in rows:\n    ws.append(r)\nwb.save(sys.argv[3])';
  const tmp = path.join(__dirname, '_hex.xlsx');
  const r = spawnSync('python', ['-X', 'utf8', '-c', pyCode, JSON.stringify(rows), 'budget', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mkXlsx fail');
  await page.setInputFiles('#impBudgetFile', tmp);
  page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 150)); });
  await page.waitForTimeout(6500); // python 解析+跳转
  await page.screenshot({ path: 'shots/H_EXCEL_3_result.png', fullPage: true });
  const hash = await page.evaluate(() => location.hash);
  console.log('[HEX-3] hash=', hash);
  check('HEX-3 Excel 导入后跳转预算单核对页(#/agent?b=)', /#\/agent\?b=\d+/.test(hash), 'hash=' + hash);
  if (/b=(\d+)/.test(hash)) {
    const bid = hash.match(/b=(\d+)/)[1];
    const det = await (await fetch(B + '/api/budget/' + bid, { headers: { Authorization: 'Bearer ' + await page.evaluate(() => localStorage.getItem('token') || '') } })).json().catch(() => ({}));
    const f = (det.budget || {}).fields || {};
    check('HEX-4 浏览器导入落库(contract=240000/正编人天=39)', f.contract === 240000 && f.dev_pd === 39, JSON.stringify({ contract: f.contract, dev_pd: f.dev_pd }));
  }
  try { fs.unlinkSync(tmp); } catch (e) {}
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
