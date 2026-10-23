// T1 表单「关联预算单即回填」测试: HTTP 等价性 + 浏览器回填行为
// 等价性: 同一预算单, 对话路径(技能② B-xxxx 建评审单)与表单路径(前端回填同款映射 POST)创建的草稿 form_json 4 字段完全一致
// 浏览器: 选 #f_budget 后 4 字段被填 + toast + 不覆盖已填值(旧代码无回填 -> 本部分 FAIL = 红基线)
// 用法: node tests/test_form_prefill.js [--log=tests/red|green_t1.txt] --skip-ui 可只跑 HTTP 部分
const B = 'http://127.0.0.1:8600';
const path = require('path');
const fs = require('fs');

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

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const eq4 = (a, b) => ['customer', 'contract_amount', 'sub_amount', 'summary'].every(k => String(a[k] ?? '') === String(b[k] ?? ''));

// 约定映射(与 app.js T1 前端实现 + server 技能②逐字一致)
const mapFields = f => ({
  customer: f.customer ?? '',
  contract_amount: f.contract != null ? Math.round(f.contract / 100) / 100 : '',
  sub_amount: f.sub_cost != null ? Math.round(f.sub_cost / 100) / 100 : '',
  summary: f.project_name ?? ''
});

(async () => {
  const sales = await login('sales1');
  // 预置锁定预算单(含 4 映射字段值)
  const FIELDS = { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, project_name: 'T1 等价预算项目', customer: 'T1 等价客户' };
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: 'T1 等价预算项目' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: FIELDS });
  await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'T1 明细', pm_pd: 1, own_pd: 1, prod_pd: 1 }] });
  await api(sales, `/api/budget/${bg}/lock`, 'POST');
  const bd = await api(sales, '/api/budget/' + bg);
  const code = bd.budget.code;

  // ---- HTTP 等价性: 对话路径(技能②) vs 表单路径(约定映射模拟前端回填) ----
  {
    // 对话路径: 用 B-xxxx 建投标评审单(LLM 不参与——服务端确定性路由)
    const r1 = await api(sales, '/api/agent/chat', 'POST', { skill: 'review', message: `用 ${code} 建投标评审单` });
    const ridA = r1.review_id;
    const draftA = (await api(sales, '/api/reviews/' + ridA)).review;
    const formA = JSON.parse(draftA.form_json || '{}');
    check('T1-EQ', '对话路径创建草稿成功', typeof ridA === 'number' && ridA > 0);

    // 表单路径: 前端回填同款映射(约定)后 POST
    const mapped = mapFields(FIELDS);
    const ridB = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]T1 表单路径草稿', form: mapped, submit: false, budget_id: bg })).id;
    const formB = JSON.parse((await api(sales, '/api/reviews/' + ridB)).review.form_json || '{}');
    check('T1-EQ', '两路径 form_json 4 映射字段完全一致(等价性锁定)', eq4(formA, formB),
      JSON.stringify({ A: { c: formA.customer, ca: formA.contract_amount, sa: formA.sub_amount, s: formA.summary }, B: { c: formB.customer, ca: formB.contract_amount, sa: formB.sub_amount, s: formB.summary } }));
    check('T1-EQ', '元→万元换算正确(2400000→240)', formA.contract_amount === 240 && formA.sub_amount === 100);
  }

  // ---- 浏览器回填行为(旧代码无回填 -> FAIL=红基线) ----
  if (!process.argv.includes('--skip-ui')) {
    const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
    const { chromium } = playwright;
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
    await page.goto(B + '/');
    await page.fill('#lu', 'sales1');
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell', { timeout: 5000 });
    await page.goto(B + '/#/new/bid');
    await page.waitForSelector('#f_budget', { timeout: 5000 });
    await page.waitForTimeout(400);
    // 先填一个"用户已填"字段(验证不覆盖): customer 手填
    await page.fill('[data-k="customer"]', '我已手填的客户');
    // 选中预算单
    await page.selectOption('#f_budget', String(bg));
    await page.waitForTimeout(800); // 等回填请求
    const v = {
      customer: await page.inputValue('[data-k="customer"]'),
      contract: await page.inputValue('[data-k="contract_amount"]'),
      sub: await page.inputValue('[data-k="sub_amount"]'),
      summary: await page.inputValue('[data-k="summary"]')
    };
    check('T1-UI', '回填合同额 240(元→万元)', String(v.contract) === '240', 'contract=' + v.contract);
    check('T1-UI', '回填分包额 100', String(v.sub) === '100', 'sub=' + v.sub);
    check('T1-UI', '回填项目名到摘要', v.summary === 'T1 等价预算项目', 'summary=' + v.summary);
    check('T1-UI', '不覆盖用户已填(customer 保留手填)', v.customer === '我已手填的客户', 'customer=' + v.customer);
    // 注: 落库一致性已由 HTTP EQ 段锁定(表单必填校验会拦未填完的表单, UI 层不再重复提交验证)
    await browser.close();
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
