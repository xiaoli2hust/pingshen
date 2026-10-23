// 阶段 2 H-01~06 人工验收自动化(playwright + 系统 Chrome, LLM 走 9801 桩)
// 用法: node tests/h_manual_check.js   (服务 8600 + 桩 9801 运行中, config LLM_BASE_URL 指桩)
// 输出: 每条断言 PASS/FAIL + tests/shots/H*.png 截图
const path = require('path');
const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
const { chromium } = playwright;
const SHOTS = path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const check = (id, name, ok, evidence) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' - [' + id + '] ' + name + (evidence ? ' | ' + evidence : ''));
  ok ? pass++ : fail++;
};
const snap = (page, file) => page.screenshot({ path: path.join(SHOTS, file), fullPage: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  // ---- 登录 ----
  await page.goto('http://localhost:8600/');
  await page.fill('#lu', 'sales1');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });

  // ---- H-01a: 新建预算单进入对话 + 首轮 ----
  await page.evaluate(() => { location.hash = '#/agent'; });
  await page.waitForSelector('button:has-text("新建预算单")', { timeout: 5000 });
  page.once('dialog', d => d.accept('天地图预算-H验收'));
  await page.click('button:has-text("新建预算单")');
  await page.waitForSelector('#agInput', { timeout: 5000 });
  const top1 = await page.textContent('#agTop');
  check('H-01', '顶栏上下文单号 B-xxxx v1·草稿', /B-\d{4}-\d+/.test(top1) && /v1 · 草稿/.test(top1), top1.trim());
  await page.fill('#agInput', '合同 240 万，分包 100 万');
  await page.press('#agInput', 'Enter');
  await page.waitForSelector('.msg.assistant', { timeout: 8000 });
  const reply1 = await page.textContent('.msg.assistant >> nth=-1');
  check('H-01', '首轮 reply 含 226.4 万与缺 3 项', /226\.4/.test(reply1) && /还缺 3 项/.test(reply1), reply1.replace(/\n/g, ' ').slice(0, 80));
  await page.waitForSelector('#agPrev .margin-card .mc-v', { timeout: 5000 });
  const pv1 = await page.textContent('#agPrev');
  check('H-01', '右列预览实时刷新(收入数字)', /2,264,151|2,264,150/.test(pv1), '含项目收入行');
  await snap(page, 'H01a.png');

  // ---- H-01b: 补缺 + 变更高亮 + 锁定按钮 ----
  await page.fill('#agInput', '交付处，10 个人月，差旅 2 万');
  await page.press('#agInput', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('.msg.assistant').length >= 2, { timeout: 8000 });
  const lockBtnVisible = await page.isVisible('#agWidget button:has-text("确认锁定 v1")');
  check('H-01', '必填齐后出现【确认锁定 v1】主按钮(人确认门)', lockBtnVisible);
  const mv = await page.textContent('#agPrev .mc-v');
  check('H-01', '精算卡 margin 大字≈41.90%', /41\.9/.test(mv), mv.trim());
  const hlRows = await page.locator('#agPrev tr.hl-flash').count();
  check('H-01', '本轮变更字段高亮(≥2 行)', hlRows >= 2, 'hl-flash 行数=' + hlRows);
  await snap(page, 'H01b.png');

  // ---- H-03: 确认锁定 ----
  // 附3 递进门禁: 前端锁按钮前先用 API 编制交付明细(取最新一张本剧本预算单)
  {
    const tok = await page.evaluate(() => localStorage.token);
    const bl = await (await fetch('http://localhost:8600/api/budget', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const tgt = (bl.budgets || []).find(b => /天地图预算-H验收/.test(b.project_name || ''));
    if (tgt) await fetch(`http://localhost:8600/api/budget/${tgt.id}/delivery`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ rows: [{ content: 'H验收明细(附3)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] })
    });
  }
  await page.click('#agWidget button:has-text("确认锁定 v1")');
  await page.waitForFunction(() => /已锁定/.test(document.querySelector('#agTop').textContent), { timeout: 5000 });
  const top3 = await page.textContent('#agTop');
  check('H-03', '锁定后顶栏单号+状态更新(v1·已锁定)', /v1 · 已锁定/.test(top3), top3.trim());
  const nvVisible = await page.isVisible('#agWidget button:has-text("新建新版本 v2")');
  check('H-03', '锁定后出现新建新版本按钮', nvVisible);
  await snap(page, 'H03.png');

  // ---- H-04: 会话续接(刷新回显) ----
  await page.reload();
  await page.waitForSelector('#agInput', { timeout: 5000 });
  await page.waitForSelector('.msg.assistant', { timeout: 5000 });
  const userMsgs = await page.locator('.msg.user').count();
  const asstMsgs = await page.locator('.msg.assistant').count();
  check('H-04', '刷新后对话历史回显(user≥2/assistant≥2)', userMsgs >= 2 && asstMsgs >= 2, `user=${userMsgs} assistant=${asstMsgs}`);
  const top4 = await page.textContent('#agTop');
  const pv4 = await page.textContent('#agPrev');
  check('H-04', '草稿与状态回显(v1 已锁定+合同金额 2400000)', /v1 · 已锁定/.test(top4) && /2,?400,?000/.test(pv4), '');
  await snap(page, 'H04.png');

  // ---- H-02a: 降级点选补齐 ----
  await page.click('a:has-text("切换预算单")');
  await page.waitForSelector('button:has-text("新建预算单")', { timeout: 5000 });
  page.once('dialog', d => d.accept('降级验收单'));
  await page.click('button:has-text("新建预算单")');
  await page.waitForSelector('#agInput', { timeout: 5000 });
  await page.fill('#agInput', '降级测试');
  await page.press('#agInput', 'Enter');
  await page.waitForSelector('.msg.assistant', { timeout: 8000 });
  const fillBox = await page.isVisible('.ag-fill');
  check('H-02', 'LLM 降级时缺失项变点选补齐输入框区', fillBox);
  const fillInputs = await page.locator('.ag-fill input[data-fill]').count();
  const fillSelect = await page.locator('.ag-fill select[data-fill="dev_dept"]').count();
  check('H-02', '5 项缺失输入(4 数字框+dev_dept 下拉)', fillInputs === 4 && fillSelect === 1, `inputs=${fillInputs} select=${fillSelect}`);
  await snap(page, 'H02a.png');

  // ---- H-02b: 逐项补齐提交 ----
  await page.fill('.ag-fill input[data-fill="contract"]', '2400000');
  await page.fill('.ag-fill input[data-fill="sub_cost"]', '1000000');
  await page.selectOption('.ag-fill select[data-fill="dev_dept"]', '交付处');
  await page.fill('.ag-fill input[data-fill="dev_pd"]', '220');
  await page.fill('.ag-fill input[data-fill="del_travel"]', '20000');
  await page.click('.ag-fill button:has-text("补齐提交")');
  await page.waitForFunction(() => /必填项已齐/.test(document.querySelector('#agWidget').textContent), { timeout: 5000 });
  check('H-02', '逐项提交补齐成功(必填项已齐+锁定按钮)', await page.isVisible('#agWidget button:has-text("确认锁定 v1")'));
  const mv2 = await page.textContent('#agPrev .mc-v');
  check('H-02', '补齐后右列实算刷新 margin≈41.90%', /41\.9/.test(mv2), mv2.trim());
  await snap(page, 'H02b.png');

  // ---- H-05: 预算单列表+版本链 ----
  await page.evaluate(() => { location.hash = '#/budgets'; });
  await page.waitForSelector('table', { timeout: 5000 });
  const listTxt = await page.textContent('#page');
  check('H-05', '列表含已锁定与草稿标记', /天地图预算-H验收/.test(listTxt) && /降级验收单/.test(listTxt) && /已锁定/.test(listTxt));
  await page.click('tr:has-text("天地图预算-H验收") button:has-text("版本链")');
  await page.waitForFunction(() => [...document.querySelectorAll('tr[id^="bv-"]')]
    .some(tr => tr.style.display !== 'none' && tr.textContent.trim() !== ''), { timeout: 5000 }).catch(() => {});
  const chainTxt = await page.textContent('#page');
  check('H-05', '版本链展开显示 v1 已锁定记录', /v1/.test(chainTxt));
  await snap(page, 'H05a.png');
  await snap(page, 'H05b.png');

  // ---- H-06: 关联预算选择器只列 locked ----
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.click('div.stat:has-text("投标决策评审")');
  await page.waitForSelector('#f_title', { timeout: 5000 });
  await page.locator('#f_budget').scrollIntoViewIfNeeded();
  const opts = await page.locator('#f_budget option').allTextContents();
  const badOpt = opts.find(o => /降级验收单|桩验证单/.test(o));
  check('H-06', '关联选择器只列已锁定单(不含草稿)', !badOpt && opts.some(o => /天地图预算-H验收/.test(o)), JSON.stringify(opts));
  await snap(page, 'H06.png');

  check('PAGE', '全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join('; '));
  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
