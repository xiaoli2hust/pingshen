// 对抗性测试·浏览器层: XSS 渲染不执行(整改#3) + 登录页演示提示受 DEMO_HINT 控制(整改#13)
// 用法: node tests/h_adv_check.js(服务 8600 运行中)  截图 tests/shots/ADV*.png
const path = require('path');
const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
const { chromium } = playwright;
const SHOTS = path.join(__dirname, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const CFG_PATH = path.join(__dirname, '..', 'config.json');

let pass = 0, fail = 0;
const check = (id, name, ok, evidence) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' - [' + id + '] ' + name + (evidence ? ' | ' + evidence : ''));
  ok ? pass++ : fail++;
};
const snap = (page, file) => page.screenshot({ path: path.join(SHOTS, file), fullPage: true });

async function api(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(reqPath + ' -> ' + (d.error || r.status));
  return d;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;
const GREEN_BUDGET_FIELDS = { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000 };
const BID_BASE_FIELDS = {
  customer: 'ADV客户', biz_line: 'G1', contract_amount: '24', sign_path: '客户公司→丰图科技',
  sub_amount: '0', secret: '否', province: '江西省', settle_method: '银行转账', summary: 'ADV'
};

(async () => {
  const sales = await login('sales1');
  // 预置: 带恶意 payload 的预算单(修复#3 前会被执行, 修复后仅转义文本)
  const payload = '"><img src=x onerror="window.__xss=1">';
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: 'ADV-XSS预算' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: {
    contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000,
    project_name: 'ADV-XSS预算', customer: payload
  } });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  // ---- ADV-03: XSS 渲染不执行(右列预算草稿预览 customer 字段) ----
  await page.goto(B + '/');
  await page.fill('#lu', 'sales1');
  await page.fill('#lp', '123456');
  await page.click('button:has-text("登 录")');
  await page.waitForSelector('.app-shell', { timeout: 5000 });
  await page.goto(B + '/#/agent?b=' + bg);
  await page.reload();
  await page.waitForSelector('#agPrev', { timeout: 5000 });
  await page.waitForTimeout(600);
  const xss = await page.evaluate(() => window.__xss);
  check('ADV-03', 'XSS payload 未执行(window.__xss undefined)', xss === undefined, 'xss=' + String(xss));
  const prevTxt = await page.textContent('#agPrev');
  check('ADV-03', '字段以转义文本呈现(img 标签可见为文字)', /img src=x/.test(prevTxt));
  const inp = await page.locator('#agPrev td:has-text("img src=x")').count();
  check('ADV-03', 'payload 完整落格未截断', inp >= 1, 'hits=' + inp);
  await snap(page, 'ADV03_xss.png');

  // ---- ADV-11: 登录页演示提示由 DEMO_HINT 控制 ----
  const cfgRaw = fs.readFileSync(CFG_PATH, 'utf8');
  try {
    // 默认 true: hint 可见(清登录态回到登录页)
    await page.evaluate(() => localStorage.clear());
    await page.goto(B + '/');
    await page.reload();
    await page.waitForSelector('#demoHint', { timeout: 5000 });
    await page.waitForTimeout(400);
    let visible = await page.isVisible('#demoHint');
    check('ADV-11', 'DEMO_HINT=true 登录页演示提示可见', visible);
    await snap(page, 'ADV11_hint_on.png');
    // 置 false: hint 隐藏(public-config 每请求读 config 即时生效)
    const cfg = JSON.parse(cfgRaw);
    cfg.DEMO_HINT = false;
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    await page.reload();
    await page.waitForTimeout(800);
    visible = await page.isVisible('#demoHint');
    check('ADV-11', 'DEMO_HINT=false 演示提示隐藏', !visible);
    await snap(page, 'ADV11_hint_off.png');
  } finally {
    fs.writeFileSync(CFG_PATH, cfgRaw, 'utf8');
  }
  // ---- ADV-XSS2: 全组件 XSS 回归(第二轮对抗): payload 塞满入口 → 逐页渲染不执行 ----
  {
    const payload = '"><img src=x onerror="window.__xss=1">';
    const bg2 = (await api(sales, '/api/budget', 'POST', { project_name: 'ADVXSS2-' + payload })).id;
    await api(sales, `/api/budget/${bg2}`, 'PUT', { fields: { ...GREEN_BUDGET_FIELDS, customer: payload, project_name: 'ADVXSS2-' + payload } });
    await api(sales, `/api/budget/${bg2}/delivery`, 'PUT', { rows: [
      { content: payload, note: payload, stage: '实施', own_pd: 1, prod_pd: 1 }
    ] });
    const rd = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]ADVXSS2-' + payload, form: { ...BID_BASE_FIELDS, customer: payload }, submit: false, budget_id: bg2 })).id;
    // 逐页打开
    const pages = [
      ['#/budgets', 'UI 预算列表'],
      ['#/delivery/' + bg2, '交付明细页'],
      ['#/review/' + rd, '评审详情页'],
      ['#/agent?b=' + bg2, 'agent 预览']
    ];
    let allClean = true, hits = 0;
    for (const [h, name] of pages) {
      await page.goto(B + '/#' + h.replace(/^#/, ''));
      await page.reload();
      await page.waitForTimeout(700);
      const x = await page.evaluate(() => window.__xss);
      const ok = x === undefined;
      if (!ok) { allClean = false; hits++; }
      console.log((ok ? 'PASS' : 'FAIL') + ' - [ADV-XSS2] ' + name + ' 渲染不执行(window.__xss=' + String(x) + ')');
      ok ? pass++ : fail++;
    }
    check('ADV-XSS2', 'payload 全入口四页均不执行', allClean, 'hits=' + hits);
    await page.goto(B + '/#/');
    await page.waitForTimeout(400);
  }

  // ---- ADV-08: hash 路由注入(第二轮对抗): #/review/"><script> 不执行 ----
  {
    await page.goto(B + '/#/review/' + encodeURIComponent('"><img src=x onerror=window.__xss=1>'));
    await page.waitForTimeout(700);
    const x = await page.evaluate(() => window.__xss);
    check('ADV-08', 'hash 路由注入不执行', x === undefined, 'xss=' + String(x));
    await page.goto(B + '/#/');
  }

  check('PAGE', '全程无 JS 报错', errors.length === 0, errors.slice(0, 2).join('; '));

  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
