// H-BudgetsImp: 预算单列表页(#/budgets)直接上传入口验证(执行后删)
// 产出: shots/H_BUDGETS_IMP.png
const B = 'http://127.0.0.1:8600';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : '')); ok ? pass++ : fail++; };

  await page.goto(B + '/');
  await page.fill('#lu', 'sales1');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });

  // budgets 页入口
  await page.goto(B + '/#/budgets');
  await page.waitForSelector('#budgetsImpFile', { timeout: 5000, state: 'attached' });
  await page.waitForSelector('text=上传 Excel 导入', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'shots/H_BUDGETS_IMP.png', fullPage: true });
  check('HB-1 预算单列表页有直接上传入口(按钮+file input)', await page.locator('#budgetsImpFile').count() === 1);

  // 实际上传
  const rows = [['项目名称', 'budgets 页直接上传'], ['客户名称', '测试客户'], ['合同金额', 240000], ['分包采购成本', 0], ['软件类生产外包', 0], ['灵活用工', 0], ['销售差旅费', 5000], ['招待费', 5000], ['市场营销', 0], ['所属部门', '交付处'], ['正编人天', 39], ['生产人天', 184], ['研发外包', 0], ['交付差旅', 8000], ['项目管理费', 11872], ['验收招待及综合办公', 2000]];
  const pyCode = 'import openpyxl, json, sys\nrows = json.loads(sys.argv[1])\nwb = openpyxl.Workbook()\nws = wb.active\nws.title = "附1-预算表"\nfor r in rows:\n    ws.append(r)\nwb.save(sys.argv[3])';
  const tmp = path.join(__dirname, '_hb.xlsx');
  const r = spawnSync('python', ['-X', 'utf8', '-c', pyCode, JSON.stringify(rows), 'budget', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mkXlsx fail');
  await page.setInputFiles('#budgetsImpFile', tmp);
  await page.waitForTimeout(6500);
  const hash = await page.evaluate(() => location.hash);
  check('HB-2 上传后跳转预算单核对页', /#\/agent\?b=\d+/.test(hash), 'hash=' + hash);
  if (/b=(\d+)/.test(hash)) {
    const bid = hash.match(/b=(\d+)/)[1];
    const tok = await page.evaluate(() => localStorage.getItem('token') || '');
    const det = await (await fetch(B + '/api/budget/' + bid, { headers: { Authorization: 'Bearer ' + tok } })).json().catch(() => ({}));
    const f = (det.budget || {}).fields || {};
    check('HB-3 落库 contract=240000/dev_pd=39', f.contract === 240000 && f.dev_pd === 39, JSON.stringify({ contract: f.contract, dev_pd: f.dev_pd }));
  }
  try { fs.unlinkSync(tmp); } catch (e) {}
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
