const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const LOG = [];
const out = s => { console.log(s); LOG.push(s); };
const LOGARG = process.argv.find(a => a.startsWith('--log='));
const writeLog = fail => fs.writeFileSync(LOGARG ? path.resolve(LOGARG.slice(6)) : path.join(__dirname, fail === 0 ? 'green_robot_workbench_ui.txt' : 'red_robot_workbench_ui.txt'), LOG.join('\n') + '\n', 'utf8');
const S = Date.now();
const code = 'PL-AW-' + S;
const xssCode = code + '-XSS'; // AW-07 专用注入夹具, 与主夹具同轮清理
let pass = 0, fail = 0;
let browser;

async function raw(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function api(token, reqPath, method, body) {
  const r = await raw(token, reqPath, method, body);
  if (r.status >= 400) throw new Error(reqPath + ' -> ' + r.status + ' ' + (r.data.error || ''));
  return r.data;
}
const login = async username => (await api(null, '/api/login', 'POST', { username, password: '123456' })).token;

(async () => {
  const { chromium } = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const check = (id, name, ok, evidence) => {
    const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
    out(line); ok ? pass++ : fail++;
  };
  const pm = await login('pm1');
  await api(pm, '/api/opp', 'POST', {
    opp_code: code, title: 'AW 统一工作台 ' + S, customer: 'AW 客户', region: '华东', province: '江西',
    biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策', sign_date: '2026-12-31',
    sales: '王超', pm: '项目经理- demo', survey: '否', summary: 'AW 浏览器永久用例'
  });
  await api(pm, '/api/opp/' + encodeURIComponent(code) + '/delivery', 'PUT', {
    rows: [{ content: 'AW 初始交付草稿', stage: '实施', pm_pd: 1, own_pd: 2, rd_pd: 0, prod_pd: 3, travel_cost: 600, note: '浏览器夹具' }]
  });
  const budget = await api(pm, '/api/budget', 'POST', {
    project_name: 'AW 项目预算', opp_code: code,
    fields: { opp_code: code, project_name: 'AW 项目预算', customer: 'AW 客户', contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000 }
  });
  const review = await api(pm, '/api/reviews', 'POST', { type: 'bid', title: 'AW 项目评审', form: { opp_code: code }, submit: false, budget_id: budget.id });

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const consoleErrs = [], pageErrs = [], uploadRequests = [];
  const importPaths = ['/api/opp/' + encodeURIComponent(code) + '/delivery/import', '/api/budget/import', '/api/reviews/import'];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 180)); });
  page.on('pageerror', e => pageErrs.push(String(e && e.message || e).slice(0, 180)));
  page.on('request', r => {
    const p = new URL(r.url()).pathname;
    if (r.method() === 'POST' && (/^\/api\/opp\/[^/]+\/delivery\/import$/.test(p) || p === '/api/budget/import' || p === '/api/reviews/import')) uploadRequests.push(p);
  });
  await page.route('**/api/agent/chat', async route => {
    const body = route.request().postDataJSON();
    const skill = body.skill || 'budget';
    if (skill === 'delivery') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        reply: '已生成 1 行交付草稿，请检查后点保存；口头确认不生效。',
        draft: { rows: [{ content: '数据实施', stage: '实施', pm_pd: 2, own_pd: 3, rd_pd: 1, prod_pd: 4, travel_cost: 6000, note: '文字生成' }] },
        missing: [], actions: [{ type: 'save_delivery_draft', label: '保存交付草稿', method: 'PUT', endpoint: '/api/opp/' + encodeURIComponent(code) + '/delivery' }], degraded: false
      }) });
    }
    if (skill === 'budget' || skill === 'review') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        reply: '(本地桩) 已收到口头确认, 但确认/锁定/提交需手动点击', draft: {}, missing: [], actions: []
      }) });
    }
    return route.abort('blockedbyclient');
  });

  await page.goto(B + '/');
  await page.fill('#lu', 'pm1');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell');
  const goWorkbench = async () => {
    await page.evaluate(c => { location.hash = '#/agent?opp=' + encodeURIComponent(c); }, code);
    await page.waitForTimeout(1500);
  };
  await goWorkbench();

  const text = await page.locator('body').innerText();
  check('AW-01', '#/agent?opp=<code> 显示统一工作台和本地预演状态',
    (await page.locator('#robotMode').count()) === 1 && text.includes('生成待发送草稿（本地预演）') && text.includes(code),
    'robotMode=' + await page.locator('#robotMode').count() + ' hash=' + await page.evaluate(() => location.hash));
  const fallback = await page.evaluate(() => {
    const original = RWB.provider.message;
    try {
      RWB.provider.message = '';
      renderRobotWb();
      return { count: document.querySelectorAll('#robotMode').length, text: document.querySelector('#robotMode').textContent };
    } finally {
      RWB.provider.message = original;
      renderRobotWb();
    }
  });
  check('AW-01b', '缺省状态文案仍为生成待发送草稿（本地预演）',
    fallback.count === 1 && fallback.text.startsWith('生成待发送草稿（本地预演）;'), JSON.stringify(fallback));

  const template = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');
  const workbook = require('node:child_process').spawnSync('python', ['-X', 'utf8', '-c',
    "import io,re,sys,openpyxl; w=openpyxl.load_workbook(sys.argv[1]); [(setattr(c,'value',re.sub(r'PL[0-9]+',sys.argv[2],c.value))) for s in w for row in s for c in row if isinstance(c.value,str)]; b=io.BytesIO(); w.save(b); sys.stdout.buffer.write(b.getvalue())", template, code]);
  const uploadFixture = workbook.status === 0 && workbook.stdout && workbook.stdout.length ? workbook.stdout : null;
  if (!uploadFixture) {
    check('AW-02', '附三上传控件 accept=.xlsx 与真实模板内存副本就绪', false, 'python/openpyxl/模板 不可用');
  } else {
    const files = ['#rwdFile', '#rwbFile', '#rwrFile'];
    const fileCounts = [], accepts = [];
    for (let i = 0; i < files.length; i++) {
      const tab = page.locator('#robotWorkbenchTabs [data-rwt="' + ['delivery', 'budget', 'review'][i] + '"]');
      if (await tab.count()) { await tab.click(); await page.waitForTimeout(150); }
      const input = page.locator(files[i]);
      fileCounts.push(await input.count());
      accepts.push(await input.count() ? await input.getAttribute('accept') : null);
      if (await input.count()) {
        const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === importPaths[i], { timeout: 6000 }).catch(() => null);
        await input.setInputFiles({ name: 'aw-upload-' + S + '.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: uploadFixture });
        await response;
      }
    }
    const uploadCounts = importPaths.map(p => uploadRequests.filter(x => x === p).length);
    check('AW-02', '三上传控件 accept=.xlsx 且各 POST 命中既有导入端点恰一次',
      fileCounts.every(n => n === 1) && accepts.every(v => v === '.xlsx') && uploadCounts.every(n => n === 1),
      JSON.stringify({ fileCounts, accepts, uploadCounts }));
  }
  await goWorkbench();
  const deliveryTab = page.locator('#robotWorkbenchTabs [data-rwt="delivery"]');
  if (await deliveryTab.count()) { await deliveryTab.click(); await page.waitForTimeout(150); }

  let generated = false;
  if (await page.locator('#rwdText').count() && await page.locator('#rwdGenerate').count()) {
    await page.fill('#rwdText', '交付明细：数据实施，差旅六千；确认交付预算');
    await page.click('#rwdGenerate');
    await page.waitForTimeout(500);
    generated = (await page.locator('#robotDeliveryDraft tbody tr').count()) === 1;
  }
  const dlAfter = await api(pm, '/api/opp/' + encodeURIComponent(code) + '/delivery');
  check('AW-03', '文字生成后只出现草稿行与人工保存/确认按钮，不自动确认',
    generated && (await page.locator('#rwdSave').count()) === 1 && (await page.locator('#rwdConfirm').count()) === 1 &&
      dlAfter.delivery && dlAfter.delivery.status === 'draft',
    'generated=' + generated + ' save=' + await page.locator('#rwdSave').count() + ' confirm=' + await page.locator('#rwdConfirm').count() + ' status=' + ((dlAfter.delivery || {}).status));

  const tabCounts = {};
  const links = { budget: 0, review: 0 };
  const oral = { budget: 0, review: 0 };
  for (const kind of ['budget', 'review']) {
    const tab = page.locator('#robotWorkbenchTabs [data-rwt="' + kind + '"]');
    tabCounts[kind] = await tab.count();
    if (tabCounts[kind]) { await tab.click(); await page.waitForTimeout(150); }
    const id = kind === 'budget' ? budget.id : review.id;
    const href = '#/agent?' + (kind === 'budget' ? 'b=' : 'r=') + id;
    const link = page.locator('a[href="' + href + '"]');
    links[kind] = await link.count();
    if (links[kind] === 1) {
      await link.click();
      await page.waitForSelector('#agInput');
      await page.fill('#agInput', kind === 'budget' ? '确认锁定' : '提交评审');
      const response = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/agent/chat' &&
        (kind === 'budget' ? r.request().postDataJSON().budget_id === budget.id : r.request().postDataJSON().review_id === review.id));
      await page.click('#agSend');
      oral[kind] = (await response).status();
      await page.waitForFunction(() => !document.querySelector('#agSend').disabled);
      await goWorkbench();
    }
  }
  const budgetStatus = (await api(pm, '/api/budget/' + budget.id)).budget.status;
  const reviewStatus = (await api(pm, '/api/reviews/' + review.id)).review.status;
  check('AW-04', '预算/评审真对话入口各发送确认锁定/提交评审，HTTP 200 且仍 draft',
    tabCounts.budget === 1 && tabCounts.review === 1 && links.budget === 1 && links.review === 1 &&
      oral.budget === 200 && oral.review === 200 && budgetStatus === 'draft' && reviewStatus === 'draft',
    JSON.stringify({ tabCounts, links, oral, budgetStatus, reviewStatus }));

  const body = await page.locator('body').innerText();
  check('AW-05', '页面显示交付/预算/评审真实状态及下一步深链',
    body.includes('交付预算') && body.includes('项目预算') && body.includes('项目评审') && /草稿/.test(body) &&
      links.budget === 1 && links.review === 1,
    'delivery=' + body.includes('交付预算') + ' budget=' + body.includes('项目预算') + ' review=' + body.includes('项目评审'));

  // ---- AW-07: 工作台 XSS 永久载体(仿 AD-14) ----
  // 逐个把注入串放进工作台真正渲染的用户可控字段: 商机标题(页头 h3)、交付行 content/note(表格单元格)、评审标题(评审页签表格)。
  // 三处都必须以转义文本呈现; 若任一原样拼进 innerHTML, img 元素会存在且 onerror 置位, 本条即红。
  const xssMark = '<img data-awxss src=x onerror="window.__wbXss=1">';
  const xssTitle = xssMark + 'AW 工作台 XSS 夹具';
  await api(pm, '/api/opp', 'POST', {
    opp_code: xssCode, title: xssTitle, customer: 'AW 客户', region: '华东', province: '江西',
    biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策', sign_date: '2026-12-31',
    sales: '王超', pm: '项目经理- demo', survey: '否', summary: 'AW-07 XSS 注入夹具'
  });
  await api(pm, '/api/opp/' + encodeURIComponent(xssCode) + '/delivery', 'PUT', {
    rows: [{ content: xssMark + '注入内容', stage: '实施', pm_pd: 1, own_pd: 1, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: xssMark + '注入备注' }]
  });
  await api(pm, '/api/reviews', 'POST', { type: 'bid', title: xssTitle, form: { opp_code: xssCode }, submit: false });
  await page.evaluate(c => { location.hash = '#/agent?opp=' + encodeURIComponent(c); }, xssCode);
  await page.waitForTimeout(1500);
  // 每个页签只在自己的面板里出现的控件, 用来证明「真的换到了另一个 pane」而不是三连点卡在同一个页签上
  const RWB_TAB_MARK = { delivery: '#rwdGenerate', budget: '#rwbFile', review: '#rwrGenerate' };
  const perTab = { literal: [], imgs: [], escaped: [], active: [], mark: [] };
  for (const tab of ['delivery', 'budget', 'review']) {
    const t = page.locator('#robotWorkbenchTabs [data-rwt="' + tab + '"]');
    // 切不动不再静默跳过: 按钮不在就什么都不做, 下面 active/mark 会记成 ''/0, 等值判定直接把本条判 FAIL
    if (await t.count()) { await t.click(); await page.waitForTimeout(300); }
    perTab.active.push(await page.evaluate(() => {
      const b = document.querySelector('#robotWorkbenchTabs .pri');
      return b ? String(b.dataset.rwt || '') : '';
    }));
    perTab.mark.push(await page.locator(RWB_TAB_MARK[tab]).count());
    const txt = await page.locator('#page').innerText();
    const html = await page.locator('#page').innerHTML();
    perTab.literal.push(txt.includes(xssMark));
    perTab.escaped.push(html.includes('&lt;img data-awxss'));
    perTab.imgs.push(await page.locator('img[data-awxss]').count());
  }
  const xssRan = await page.evaluate(() => window.__wbXss === 1);
  // 探测器自证: 先塞一个真的 img[data-awxss] 进 DOM, 数得到(=1)才说明上面的 imgs=0 是真判定而不是选择器空转。
  // 故意不带 src, 免得资源加载失败被 AW-06 的 console 零错误判定收成红。用完即摘, 不进截图。
  await page.evaluate(() => {
    const box = document.createElement('div'); box.id = 'aw07-detector-selftest';
    const img = document.createElement('img'); img.setAttribute('data-awxss', '');
    box.appendChild(img); document.body.appendChild(box);
  });
  const armed = await page.locator('img[data-awxss]').count();
  await page.evaluate(() => { const box = document.getElementById('aw07-detector-selftest'); if (box) box.remove(); });
  // active 三值必须按序等于被点的三个 key(既互异也证明确实切过去了), mark 必须各命中恰一次(证明是三个不同 pane)
  const tabsMoved = perTab.active.join(',') === 'delivery,budget,review' && new Set(perTab.active).size === 3;
  const panesDistinct = perTab.mark.every(n => n === 1);
  check('AW-07', '三个页签(逐个自证确实切过去)内商机标题/交付 content·note/评审标题的注入 HTML 一律转义呈现，img 元素为零且 onerror 未执行',
    tabsMoved && panesDistinct && perTab.literal.every(Boolean) && perTab.escaped.every(Boolean) &&
      perTab.imgs.every(n => n === 0) && !xssRan && armed === 1,
    'active=' + perTab.active.join('/') + ' pane标记命中=' + perTab.mark.join('/') + ' literal=' + perTab.literal.join('/') +
      ' escaped=' + perTab.escaped.join('/') + ' imgs=' + perTab.imgs.join('/') + ' ran=' + xssRan + ' 自证可数到注入元素=' + armed);
  await goWorkbench();

  const redMode = !!(LOGARG && /red_robot_workbench_ui\.txt$/.test(LOGARG));
  const shotPath = path.join(__dirname, 'shots', 'H_AW_robot_workbench.png');
  const shot = redMode ? await page.screenshot({ fullPage: false }) : await page.screenshot({ path: shotPath, fullPage: false });
  const persisted = redMode || (fs.existsSync(shotPath) && fs.statSync(shotPath).size > 10000);
  check('AW-06', '工作台 console.error/pageerror 为零并捕获截图，非 RED 必须落盘',
    consoleErrs.length === 0 && pageErrs.length === 0 && shot.length > 10000 && persisted,
    'console=' + consoleErrs.length + ' pageerror=' + pageErrs.length + ' shot=' + shot.length + 'B' + (redMode ? '(内存)' : '(文件)'));
})().catch(e => {
  out('FAIL: ' + (e.stack || e.message)); fail++;
}).finally(async () => {
  try {
    if (browser) await browser.close();
    const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
    const table = name => !!db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name=?").get(name);
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    try {
      for (const c of [code, xssCode]) {
        if (table('tasks') && table('reviews')) db.prepare('DELETE FROM tasks WHERE review_id IN (SELECT id FROM reviews WHERE opp_code=?)').run(c);
        if (table('events') && table('reviews')) db.prepare('DELETE FROM events WHERE review_id IN (SELECT id FROM reviews WHERE opp_code=?)').run(c);
        if (table('attachments') && table('reviews')) db.prepare('DELETE FROM attachments WHERE review_id IN (SELECT id FROM reviews WHERE opp_code=?)').run(c);
        if (table('agent_messages') && table('reviews')) db.prepare('DELETE FROM agent_messages WHERE review_id IN (SELECT id FROM reviews WHERE opp_code=?)').run(c);
        if (table('agent_messages') && table('budgets')) db.prepare('DELETE FROM agent_messages WHERE budget_id IN (SELECT id FROM budgets WHERE opp_code=?)').run(c);
        if (table('budget_delivery') && table('budgets')) db.prepare('DELETE FROM budget_delivery WHERE budget_id IN (SELECT id FROM budgets WHERE opp_code=?)').run(c);
        if (table('reviews')) db.prepare('DELETE FROM reviews WHERE opp_code=?').run(c);
        if (table('budgets')) db.prepare('DELETE FROM budgets WHERE opp_code=?').run(c);
        if (table('opp_delivery')) db.prepare('DELETE FROM opp_delivery WHERE opp_code=?').run(c);
        if (table('opps')) db.prepare('DELETE FROM opps WHERE opp_code=?').run(c);
      }
      db.exec('COMMIT');
      const codes = [code, xssCode];
      const remaining = codes.map(c => ['opps', 'budgets', 'reviews'].map(t => table(t) ? db.prepare('SELECT COUNT(*) c FROM ' + t + ' WHERE opp_code=?').get(c).c : null));
      if (remaining.some(r => r.some(n => n !== null && n !== 0))) throw new Error('本轮 AW 业务夹具残留');
      out('CLEANUP - ' + codes.join(' + ') + ' opps/budgets/reviews=' + remaining.map(r => r.map(n => n === null ? 'missing' : n).join('/')).join(' | '));
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    } finally { db.close(); }
  } catch (e) { out('CLEANUP FAIL: ' + e.message); fail++; }
  out(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  writeLog(fail);
  process.exitCode = fail === 0 ? 0 : 1;
});
