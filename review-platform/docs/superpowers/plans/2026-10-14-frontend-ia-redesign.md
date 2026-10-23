# 商机中枢式前端 IA 重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把前端从"按系统模块摆页面"重组为"商机（opp_code）中枢式"：角色导航 4~6 项、商机 360° 七标签唯一工作目的地、新商机向导收敛四扇门、#/reviews 重定向、旧深链不死。

**Architecture:** 超集先固化再切换——新页面/新路由/服务端聚合端点先落地（每步旧 H 测试全绿、旧导航未动），最后一次性切换 renderShell/renderRoute 并同批更新旧 H 测试锚点。服务端仅新增一个聚合端点，schema/判灯/LLM 边界零改动。

**Tech Stack:** Node 22 内置模块（http/fs/node:sqlite）单文件 server.js + 原生 SPA（public/app.js 模板串 + innerHTML）+ playwright（仅测试，E:\npm-global\node_modules\playwright）。零 npm 运行时依赖。

**Spec:** `review-platform/docs/superpowers/specs/2026-10-14-frontend-ia-redesign-design.md`（本计划从 spec 立论，执行者须先读 spec）

## Global Constraints

- 工作目录：所有命令在 `f:\workbuddy\9\review-platform` 下执行（bash）。
- Node 必须用托管 22：`N="C:/Users/01386380/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"`（PATH 上的 node 是 v18，无 node:sqlite）。bash 调用：`"$N" tests/h_ia_shots.js`。
- 服务须运行在 8600：启动 `"$N" server.js`（后台）；改 server.js 后必须重启才生效。
- 零 npm 依赖红线；playwright 只从 `E:\npm-global\node_modules\playwright` 引入（`require(path.join('E:\\npm-global\\node_modules\\playwright'))`）。
- 中文一律 UTF-8；禁止 shell 读写中文；证据日志由脚本内部 `fs.writeFileSync(path, log, 'utf8')` 落盘（本计划所有 H 脚本已内置）；跨文件校验落临时 js 文件执行后删除，禁用 `node -e` 内联中文。
- innerHTML 插值一律 `esc()`；模板串内联 onclick 调用的函数保持页面全局作用域（不进闭包/模块）。
- 产品 id 与既有按钮文本不改；新增按钮文案全局唯一且避开既有测试锚点子串。
- `git add` 只加本任务明确列出的文件（并行会话共用工作区，禁 `git add -A`）；`config.json` 永不入 git。
- 判灯/算账/锁定/提交/结论确认不出 LLM 边界（本计划不触碰这些逻辑）。
- 提交信息用中文一行式（仿 `git log --oneline` 既有风格）。

---

### Task 1: 新浏览器测试套件 h_ia_shots.js + 红证据

**Files:**
- Create: `tests/h_ia_shots.js`
- Create(运行后自动落盘): `tests/red_ia.txt`

**Interfaces:**
- Produces: IA-01~14 + COMPAT 断言体系；日志落点 `tests/green_ia.txt` / `tests/red_ia.txt`；截图 `shots/H_IA_*.png`。后续任务以"重跑本套件观察对应 IA 断言转绿"为验证手段。

- [ ] **Step 1: 确认服务在线**

Run: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8600/api/me`
Expected: `401`（在线；若连接失败，先 `"$N" server.js` 后台启动再验）

- [ ] **Step 2: 写测试文件 tests/h_ia_shots.js（完整内容）**

```js
// H-IA: 商机中枢式前端 IA(spec 2026-10-14): 角色导航4~6项/首页待办/商机360°七标签/向导三方式/#/reviews重定向/旧深链兼容
// 红跑兜底: 全部用 waitForTimeout 而非 waitForSelector 硬等, 保证旧代码上逐项 FAIL 而非中断
const B = 'http://127.0.0.1:8600';
const path = require('path');
const LOG = [];
const out = s => { console.log(s); LOG.push(s); };

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { const line = (ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : ''); out(line); ok ? pass++ : fail++; };

  const login = async (u) => {
    await page.goto(B + '/');
    await page.fill('#lu', u);
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell', { timeout: 5000 });
  };
  const navTexts = async () => page.locator('.sidebar nav a').allTextContents();
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---- IA-1/2: zhichizu 六项扁平导航 + 归档库文本锚(h_flicker) ----
  await login('zhichizu');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n1 = await navTexts();
  check('IA-1 zhichizu 导航六项', sameArr(n1, ['首页', '全部商机', '待办打灯', '研判台', '归档库', '解析器实验室']), '实得:' + n1.join(','));
  check('IA-2 扁平无分组div + 归档库文本保留', (await page.locator('.sidebar .nav-group').count()) === 0 && (await page.locator('nav a:has-text("归档库")').count()) === 1);
  await page.screenshot({ path: 'shots/H_IA_1_shell.png', fullPage: false });

  // ---- IA-6: 首页个人工作台(我的待办队列) ----
  const home1 = await page.textContent('#page');
  check('IA-6 首页含我的待办(支持组=待研判)', home1.includes('我的待办') && home1.includes('待研判'), '');
  await page.screenshot({ path: 'shots/H_IA_2_home.png', fullPage: false });

  // ---- IA-7~10: 商机 360° 七标签 ----
  await page.evaluate(() => { location.hash = '#/opp/PL00008572'; });
  await page.waitForTimeout(900);
  const has360 = (await page.locator('#oppPage').count()) === 1;
  const tabs = has360 ? await page.locator('#oppTabs button').allTextContents() : [];
  check('IA-7 商机360°七标签', sameArr(tabs, ['概览', '预算', '评审表', '前置灯态', '结论', '对话', '归档']), '实得:' + tabs.join(','));
  if (has360) {
    await page.click('#oppTabs button:text-is("评审表")');
    await page.waitForTimeout(500);
    check('IA-8 评审表标签行≥1', (await page.locator('#oppPage tbody tr').count()) >= 1, 'rows=' + (await page.locator('#oppPage tbody tr').count()));
    await page.click('#oppTabs button:text-is("前置灯态")');
    await page.waitForTimeout(500);
    const lightTxt = await page.textContent('#oppPage');
    check('IA-9 前置灯态含评判指标/部门列', lightTxt.includes('评判指标') && lightTxt.includes('部门'), '');
    await page.click('#oppTabs button:text-is("对话")');
    await page.waitForTimeout(500);
    const chatTxt = await page.textContent('#oppPage');
    check('IA-10 对话标签含该商机目标(预算/评审表)', chatTxt.includes('预算') && chatTxt.includes('评审表'), '');
  } else { ['IA-8', 'IA-9', 'IA-10'].forEach(k => check(k + ' 商机360°页未渲染', false)); }
  await page.screenshot({ path: 'shots/H_IA_3_opp360.png', fullPage: false });

  // ---- IA-11: 新商机向导三编制方式 ----
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForTimeout(700);
  const wiz = await page.textContent('#page');
  check('IA-11 向导三编制方式(对话式/表单式/Excel)', wiz.includes('对话式编制') && wiz.includes('表单式编制') && wiz.includes('Excel 导入'), '');
  await page.screenshot({ path: 'shots/H_IA_4_wizard.png', fullPage: false });

  // ---- IA-12/13: #/reviews 重定向 → #/opps ----
  await page.evaluate(() => { location.hash = '#/reviews'; });
  await page.waitForTimeout(800);
  check('IA-12 #/reviews 重定向 #/opps', (await page.evaluate(() => location.hash)) === '#/opps', 'hash=' + (await page.evaluate(() => location.hash)));
  await page.waitForTimeout(700);
  const oppsTxt = (await page.locator('#oppsTbl').count()) ? await page.textContent('#oppsTbl') : '';
  check('IA-13 商机列表渲染(商机代码列)', oppsTxt.includes('商机代码'), '');

  // ---- IA-14: 旧深链 #/agent?b= 仍可用 ----
  {
    const tok = await page.evaluate(() => localStorage.token);
    const bl = await (await fetch(B + '/api/budget', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const b = (bl.budgets || [])[0];
    if (b) {
      await page.goto(B + '/#/agent?b=' + b.id);
      await page.waitForTimeout(900);
      check('IA-14 旧深链 #/agent?b= 对话窗仍可用', (await page.locator('#agInput').count()) === 1);
    } else check('IA-14 旧深链 #/agent?b= 对话窗仍可用', false, '库内无预算单可测');
  }

  // ---- 兼容断言(旧代码即 PASS, 证明非破坏性) ----
  {
    const tok = await page.evaluate(() => localStorage.token);
    const rl = await (await fetch(B + '/api/reviews?scope=all', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const r = (rl.reviews || []).find(x => x.opp_code === 'PL00008572') || (rl.reviews || [])[0];
    let ok = false;
    if (r) {
      await page.goto(B + '/#/review/' + r.id);
      await page.waitForTimeout(900);
      ok = ((await page.textContent('#page')) || '').length > 10;
    }
    check('COMPAT-1 #/review/:id 详情页可用', ok, r ? 'id=' + r.id : '无评审单');
  }
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForTimeout(900);
  check('COMPAT-2 #/tasks 任务表格结构不变', (await page.locator('#taskTbl').count()) === 1 && (await page.textContent('#taskTbl')).includes('评判指标'), '');

  // ---- 角色导航矩阵: fde1 / sales1 / fin1 ----
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fde1');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n2 = await navTexts();
  check('IA-3 fde1 导航两项(首页/待办打灯)', sameArr(n2, ['首页', '待办打灯']), '实得:' + n2.join(','));
  check('IA-6b fde1 首页含我的待办', (await page.textContent('#page')).includes('我的待办'), '');
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('sales1');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n3 = await navTexts();
  check('IA-4 sales1 导航三项(首页/我的商机/新商机)', sameArr(n3, ['首页', '我的商机', '新商机']), '实得:' + n3.join(','));
  check('IA-6c sales1 首页含我的待办', (await page.textContent('#page')).includes('我的待办'), '');
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fin1');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n4 = await navTexts();
  check('IA-5 财务BP 导航四项(含待办打灯)', sameArr(n4, ['首页', '我的商机', '新商机', '待办打灯']), '实得:' + n4.join(','));

  await browser.close();
  out(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  require('fs').writeFileSync(path.join(__dirname, fail === 0 ? 'green_ia.txt' : 'red_ia.txt'), LOG.join('\n') + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); require('fs').writeFileSync(path.join(__dirname, 'red_ia.txt'), 'FAIL:' + e.message + '\n', 'utf8'); process.exit(1); });
```

- [ ] **Step 3: 在未改代码上跑出红证据**

Run: `"$N" tests/h_ia_shots.js`
Expected: 退出码 1；`tests/red_ia.txt` 生成；其中 IA-1~13 全 FAIL（旧导航/无 #oppPage/无向导文本/无重定向），IA-14 与 COMPAT-1/2 PASS（证明非破坏性）。若 COMPAT 也 FAIL，先停下排查基线（服务/数据），不得进入 Task 2。

- [ ] **Step 4: 提交红证据**

```bash
git add tests/h_ia_shots.js tests/red_ia.txt
git commit -m "IA红证据: h_ia_shots.js 新套件在旧代码上 13 项 FAIL(新导航/360°/向导/重定向缺失)+IA-14/COMPAT 兼容 PASS, 商机中枢重设计开工基线"
```

---

### Task 2: 服务端聚合端点 GET /api/opp/:code/360

**Files:**
- Modify: `server.js`（/api/reviews GET 块之后，约 1262 行 `}` 之后插入）
- Create(临时, 跑完删): `tests/_tmp_360.js`

**Interfaces:**
- Produces: `GET /api/opp/:code/360` → `{opp:{code,title}, reviews:[{id,type,title,status,round,light,era,decision_result,archived_at,updated_at}], budgets:[{id,code,version,status,project_name,updated_at}], tasks:[{...,review_id,ind_name,ind_standards?…(t.*),title,type,opp_code}], lights:{red,yellow,green,none}}`；无匹配 reviews+budgets → 404 `{error:'商机不存在'}`。Task 4 的 renderOpp360 消费此契约。

- [ ] **Step 1: 写临时契约校验（先红）**

`tests/_tmp_360.js`（完整内容）：
```js
// 临时校验(跑完删除): 商机360°聚合端点契约
const B = 'http://127.0.0.1:8600';
(async () => {
  const lg = await (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'zhichizu', password: '123456' }) })).json();
  const h = { Authorization: 'Bearer ' + lg.token };
  const r = await fetch(B + '/api/opp/PL00008572/360', { headers: h });
  let ok = false, body = {};
  if (r.status === 200) {
    body = await r.json();
    ok = ['opp', 'reviews', 'budgets', 'tasks', 'lights'].every(k => k in body) && Array.isArray(body.reviews) && Array.isArray(body.tasks) && body.opp && body.opp.code === 'PL00008572';
  }
  console.log('360 契约:', ok ? 'PASS' : 'FAIL', 'status=' + r.status, JSON.stringify(body).slice(0, 140));
  const nf = await fetch(B + '/api/opp/__NO_SUCH__/360', { headers: h });
  console.log('404 契约:', nf.status === 404 ? 'PASS' : 'FAIL', 'status=' + nf.status);
  process.exit(ok && nf.status === 404 ? 0 : 1);
})();
```

Run: `"$N" tests/_tmp_360.js`
Expected: FAIL（360 契约 status=404 或 404 路由未匹配——旧代码无此端点；404 契约行可能显示 status=404 PASS，属路由兜底命中，整体退出码 1）

- [ ] **Step 2: 实现端点**

在 server.js 中 `/api/reviews` GET 块（`return send(res, 200, { reviews: rows });` 与其收尾 `}` 之后）插入：

```js
    // 商机 360°聚合(spec 2026-10-14 §3): 单次取齐该商机的评审单/预算单/前置任务/灯色——登录即可(与 scope=all 全员只读同口径), 写操作仍由各端点自鉴权
    const mOpp = p.match(/^\/api\/opp\/([^/?]+)\/360$/);
    if (mOpp && req.method === 'GET') {
      const code = decodeURIComponent(mOpp[1]);
      const reviews = db.prepare('SELECT id,type,title,status,round,light,era,decision_result,archived_at,updated_at FROM reviews WHERE opp_code=? ORDER BY updated_at DESC').all(code);
      const budgets = db.prepare('SELECT id,code,version,status,project_name,updated_at FROM budgets WHERE opp_code=? ORDER BY updated_at DESC').all(code);
      if (!reviews.length && !budgets.length) return send(res, 404, { error: '商机不存在' });
      const tasks = db.prepare('SELECT t.*, r.title, r.type, r.opp_code FROM tasks t JOIN reviews r ON r.id=t.review_id WHERE r.opp_code=? ORDER BY t.round DESC, t.id').all(code);
      const lights = { red: 0, yellow: 0, green: 0, none: 0 };
      for (const r of reviews) lights[r.light || 'none'] = (lights[r.light || 'none'] || 0) + 1;
      return send(res, 200, { opp: { code, title: (reviews[0] || {}).title || (budgets[0] || {}).project_name || '' }, reviews, budgets, tasks, lights });
    }
```

- [ ] **Step 3: 重启服务并跑绿**

重启：先 `netstat -ano | grep :8600` 找 PID → `taskkill //PID <pid> //F` → `"$N" server.js`（后台）→ `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8600/api/me` 确认 401。
Run: `"$N" tests/_tmp_360.js`
Expected: 两行 PASS，退出码 0

- [ ] **Step 4: 语法检查 + 既有商机套件防回归**

Run: `"$N" --check server.js && "$N" tests/test_opp_thread.js`
Expected: 无语法错误；OC-01~06 全 PASS

- [ ] **Step 5: 删临时文件并提交**

```bash
rm tests/_tmp_360.js
git add server.js
git commit -m "商机360°聚合端点: GET /api/opp/:code/360 一次取齐该商机评审单/预算单/前置任务/灯色(参数全绑定, 空商机404), 服务端唯一新增(spec §3)"
```

---

### Task 3: 智能体对话组件容器参数化（超集固化第 1 步）

**Files:**
- Modify: `public/app.js` — renderAgent(851-893)、renderAgentReview(1063-1098)

**Interfaces:**
- Produces: `mountAgentChat(bId, mountSel)`（技能①对话窗挂任意容器；`renderAgent()` 路由包装后行为不变）；`mountAgentReviewChat(rId, mountSel)`（技能②同构）。Task 4 的 360° 对话标签（oppChatBudget/oppChatReview）消费这两个挂载函数。

- [ ] **Step 1: 拆出 mountAgentChat**

把 renderAgent 中 `if (!bId) return renderAgentPick();` 之后的整个 try 块抽为新函数（`const page = $('#page')` 改为 `const box = $(mountSel)`，守卫与 catch 相应调整），renderAgent 变薄：

```js
async function renderAgent() {
  const qs = new URLSearchParams((location.hash.split('?')[1] || ''));
  const bId = qs.get('b');
  const rId = qs.get('r');
  if (rId === 'pick') return renderAgentReviewPick();
  if (rId) return renderAgentReview(rId);
  if (!bId) return renderAgentPick();
  return mountAgentChat(bId, '#page');
}
async function mountAgentChat(bId, mountSel) { // 技能①对话窗: 可挂 #/agent 独立页或商机360°对话标签
  const box = $(mountSel);
  if (!box) return;
  showLoading(box);
  const h0 = location.hash; // 慢页竞态守卫
  try {
    const [bd, msgs] = await Promise.all([api('/api/budget/' + bId), api('/api/budget/' + bId + '/messages')]);
    if (location.hash !== h0) return;
    const b = bd.budget;
    AG = { budgetId: b.id, code: b.code, version: b.version, status: b.status, draft: b.fields || {}, calc: b.calc || null, changed: [], missing: [] };
    box.innerHTML = `
    <div class="card agent-top"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span id="agTop"></span>
      <span style="font-size:12.5px;color:var(--text-3)">${esc(b.project_name || '')}</span>
      <a href="#/agent" style="margin-left:auto;font-size:13px">切换预算单</a>
    </div></div>
    <div class="agent-wrap">
      <div class="card agent-chat">
        <div class="ag-msgs" id="agMsgs">
          ${(msgs.messages || []).map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.content).replace(/\n/g, '<br>')}</div>`).join('')}
          ${!(msgs.messages || []).length ? '<div class="empty">描述预算信息开始对话,例如:"合同 240 万,分包 100 万"</div>' : ''}
        </div>
        <div id="agWidget"></div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea id="agInput" placeholder="描述预算信息,Enter 发送(Shift+Enter 换行)" style="flex:1;min-height:56px"></textarea>
          <button class="btn pri" id="agSend" onclick="sendAgentMsg()">发送</button>
        </div>
      </div>
      <div class="card agent-prev" id="agPrev"></div>
    </div>`;
    refreshAgentTop(); renderAgentPreview();
    $('#agInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMsg(); }
    });
    const mBox = $('#agMsgs'); mBox.scrollTop = mBox.scrollHeight;
  } catch (e) { toast(e.message, 1); if (mountSel === '#page') location.hash = '#/agent'; }
}
```

注意：① 原 `#/agent` 独立页模板里的 `<select id="agSkill">` 技能切换保留在**独立页模板**中——即独立页需要在 mountAgentChat 渲染前于 `#page` 顶部先注入技能切换行。为最小改动，把技能切换行留在 renderAgent 包装内：`renderAgent()` 在调用 `mountAgentChat(bId, '#page')` 前 `page.insertAdjacentHTML` 或直接把 select 行并入独立模式模板。**实现口径**：mountAgentChat 模板不再含 agSkill；renderAgent 独立模式在 mountAgentChat 完成后于 `#page` 顶部 prepend `<div class="card agent-top">…技能select…</div>` 行（innerHTML 一次性拼装亦可）。agSkill 的 onchange 逻辑（切技能②→`#/agent?r=pick`）原样保留。
② `AG`/`AG_MISSING*`/`sendAgentMsg`/`appendAssistant`/`refreshAgentTop`/`renderAgentPreview` 全部不动（它们按 id 寻址，与容器无关）。

- [ ] **Step 2: 同构拆出 mountAgentReviewChat**

renderAgentReview 改为薄包装（保留 catch 重定向语义），主体抽为：

```js
async function renderAgentReview(rId) { return mountAgentReviewChat(rId, '#page'); }
async function mountAgentReviewChat(rId, mountSel) { // 技能②对话窗: 可挂 #/agent?r= 独立页或商机360°对话标签
  const box = $(mountSel);
  if (!box) return;
  showLoading(box);
  const h0 = location.hash;
  try {
    const [dd, msgs] = await Promise.all([api('/api/reviews/' + rId), api('/api/reviews/' + rId + '/messages')]);
    if (location.hash !== h0) return;
    const r = dd.review;
    if (r.applicant_id !== ME.id && ME.role !== '销售支持组' && ME.role !== 'admin') {
      toast('仅申请人可对话编制', 1);
      box.innerHTML = '<div class="empty">仅申请人可对话编制该草稿</div>';
      return;
    }
    AGV = { reviewId: r.id, id: r.id, type: r.type, status: r.status, draft: JSON.parse(r.form_json || '{}'), missing: [], preview: null };
    AGV.missing = BID_REQUIRED_FE.filter(k => AGV.draft[k] === undefined || AGV.draft[k] === null || AGV.draft[k] === '');
    box.innerHTML = `
    <div class="agent-wrap">
      <div class="card agent-chat">
        <div class="ag-msgs" id="agMsgs">
          ${(msgs.messages || []).map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'assistant'}">${esc(m.content).replace(/\n/g, '<br>')}</div>`).join('')}
          ${!(msgs.messages || []).length ? '<div class="empty">发"用 B-xxxx 建投标评审单"带入预算字段开始(先在技能①锁定预算单)</div>' : ''}
        </div>
        <div id="agWidget"></div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <textarea id="agInput" placeholder="口述评审表字段(如:客户…合同 24 万)或发'预判一下灯',Enter 发送" style="flex:1;min-height:56px"></textarea>
          <button class="btn pri" id="agSend" onclick="sendAgentReviewMsg()">发送</button>
        </div>
      </div>
      <div class="card agent-prev" id="agPrev"></div>
    </div>`;
    renderAgentReviewPreview();
    $('#agInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentReviewMsg(); }
    });
    const mBox = $('#agMsgs'); mBox.scrollTop = mBox.scrollHeight;
  } catch (e) { toast(e.message, 1); if (mountSel === '#page') location.hash = '#/agent?r=pick'; }
}
```

独立页顶栏（agSkill select + `#agTop` 单号行 + 切换草稿链接）由 renderAgentReview 包装在 mount 前后注入 `#page` 顶部（口径同 Step 1：独立模式 prepend 顶栏行；`#agTop` 的内容 `<b>#id 状态</b>` 移到该顶栏行内）。`AGV`/`sendAgentReviewMsg`/`renderAgentReviewPreview` 不动。

- [ ] **Step 3: 验证（旧路径行为不变）**

Run: `"$N" --check public/app.js && "$N" tests/h_ia_shots.js`
Expected: 语法过；IA-14 PASS（#/agent?b= 深链仍渲染 #agInput）；其余 IA 仍 FAIL（未到切换任务，属预期）。
再跑: `"$N" tests/h_manual_check.js`
Expected: 全 PASS（H-01~H-06 全链路走 #/agent 独立页——此重构不许改变其任何断言）

- [ ] **Step 4: 提交**

```bash
git add public/app.js
git commit -m "智能体对话组件容器参数化: renderAgent/renderAgentReview 拆出 mountAgentChat/mountAgentReviewChat(默认挂#page, 独立页行为不变), 为商机360°对话标签内嵌铺路"
```

---

### Task 4: 商机 360° 页 renderOpp360 + #/opp/ 路由（超集固化第 2 步）

**Files:**
- Modify: `public/app.js` — oppExpandHtml 之后插入新函数群；renderRoute 增分支；navHighlight 扩展

**Interfaces:**
- Consumes: Task 2 的 `GET /api/opp/:code/360`；Task 3 的 `mountAgentChat/mountAgentReviewChat`。
- Produces: `#/opp/:code?t=<tab>` 路由（tab ∈ overview|budget|review|light|judge|chat|archive）；全局函数 `oppChatBudget(bId)`、`oppChatReview(rId)`；容器 `#oppPage`/`#oppTabs`/`#oppChatBox`（h_ia_shots IA-7~10 断言锚）。

- [ ] **Step 1: 插入 renderOpp360 函数群（完整代码）**

在 `oppExpandHtml` 函数结束后插入：

```js
// ---- 商机 360°(#/opp/:code, spec §2.3): 七标签一页到底, 唯一工作目的地 ----
const OPP_TABS = [['overview', '概览'], ['budget', '预算'], ['review', '评审表'], ['light', '前置灯态'], ['judge', '结论'], ['chat', '对话'], ['archive', '归档']];
async function renderOpp360(rawCode) {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash; // 竞态守卫: await 期间切走则弃写
  const code = decodeURIComponent(String(rawCode || ''));
  const qsTab = new URLSearchParams((location.hash.split('?')[1] || '')).get('t');
  const t = OPP_TABS.some(([k]) => k === qsTab) ? qsTab : 'overview';
  let d;
  try { d = await api('/api/opp/' + encodeURIComponent(code) + '/360'); }
  catch (e) {
    if (location.hash !== h0) return;
    page.innerHTML = `<div class="card"><h3>商机 360°</h3>
      <div class="empty">商机 ${esc(code)} 不存在或已被清理</div>
      <div style="margin-top:10px;display:flex;gap:10px">
        ${['销售经理', '项目经理', '财务BP'].includes(ME.role) ? `<button class="btn pri" onclick="location.hash='#/new'">新商机向导 →</button>` : ''}
        <button class="btn" onclick="location.hash='#/opps'">返回商机列表</button>
      </div></div>`;
    return;
  }
  if (location.hash !== h0) return;
  const rs = d.reviews || [], bs = d.budgets || [], ts = d.tasks || [];
  const taskSt = x => x.status === 'pending' ? pill('待打灯', 'p-yellow') : x.status === 'returned' ? pill('已退回', 'p-red') : (lightPill(x.light) || pill('已处理', 'p-gray'));
  const canLight = x => ME.role === '销售支持组' || ME.role === 'admin' || x.dept === ME.role;
  const tabBtns = OPP_TABS.map(([k, l]) => `<button class="btn sm${t === k ? ' pri' : ''}" onclick="location.hash='#/opp/${encodeURIComponent(code)}?t=${k}'">${l}</button>`).join(' ');
  let body = '';
  if (t === 'overview') {
    const st = s => rs.filter(r => r.status === s).length;
    body = `
    <div class="metric-grid">
      <div class="metric-tile"><span class="m-label">评审单</span><span class="m-value">${rs.length}</span><span class="m-foot">草稿 ${st('draft')} · 评审中 ${st('reviewing')} · 已研判 ${st('judged')}</span></div>
      <div class="metric-tile"><span class="m-label">预算单</span><span class="m-value">${bs.length}</span><span class="m-foot">已锁定 ${bs.filter(b => b.status === 'locked').length} 张</span></div>
      <div class="metric-tile"><span class="m-label">前置任务</span><span class="m-value tone-yellow">${ts.filter(x => x.status === 'pending').length}</span><span class="m-foot">待打灯</span></div>
      <div class="metric-tile"><span class="m-label">灯色 红/黄/绿</span><span class="m-value">${(d.lights || {}).red || 0} / ${(d.lights || {}).yellow || 0} / ${(d.lights || {}).green || 0}</span><span class="m-foot">全商机评审单</span></div>
    </div>
    <div class="card"><h3>灯色分布(该商机全部评审单)</h3>${lightDistBar(rs)}</div>`;
  } else if (t === 'budget') {
    body = `<div class="card"><h3>预算(${bs.length})</h3>${bs.length === 0 ? '<div class="empty">该商机暂无预算单</div>' : `<div class="card-table-wrap"><table>
      <tr><th>单号</th><th>版本</th><th>状态</th><th>更新时间</th><th class="ops">操作</th></tr>
      ${bs.map(b => `<tr><td><b>${esc(b.code)}</b></td><td>v${b.version}</td>
        <td>${b.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td><td>${fmtT(b.updated_at)}</td>
        <td class="ops"><a href="#/agent?b=${b.id}">对话编制</a></td></tr>`).join('')}</table></div>`}
      <div class="hint">完整列表与版本链在预算单工作台(#/budgets)。</div></div>`;
  } else if (t === 'review') {
    body = `<div class="card"><h3>评审表(${rs.length}) <a href="#/new" style="float:right;font-size:13px">+ 新建</a></h3>${rs.length === 0 ? '<div class="empty">该商机暂无评审单</div>' : `<div class="card-table-wrap"><table>
      <tr><th>项目</th><th>类型</th><th>状态</th><th>灯态</th><th class="num">轮次</th><th>更新时间</th><th class="ops">操作</th></tr>
      ${rs.map(r => `<tr><td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td>${statusPill(r.status)}</td><td>${lightPill(r.light)}</td><td class="num">${r.round}</td><td>${fmtT(r.updated_at)}</td>
        <td class="ops"><a href="#/review/${r.id}">查看详情</a></td></tr>`).join('')}</table></div>`}</div>`;
  } else if (t === 'light') {
    body = `<div class="card"><h3>前置灯态(${ts.length})</h3>${ts.length === 0 ? '<div class="empty">暂无前置任务</div>' : `<div class="card-table-wrap"><table>
      <tr><th>项目</th><th>评判指标</th><th>部门</th><th class="num">轮次</th><th>状态</th><th class="ops">操作</th></tr>
      ${ts.map(x => `<tr><td><a href="#/review/${x.review_id}">${esc(x.title)}</a></td><td><b>${esc(x.ind_name)}</b></td>
        <td>${esc(x.dept)}</td><td class="num">${x.round}</td><td>${taskSt(x)}</td>
        <td class="ops">${x.status === 'pending' && canLight(x) ? `<button class="btn sm pri" onclick="openTask(${x.id},'${esc(x.ind_name)}',\`${esc(x.standards)}\`)">打灯</button>` : `<a href="#/review/${x.review_id}">查看</a>`}</td></tr>`).join('')}</table></div>`}
      <div class="hint">打灯弹窗内嵌判定标准原文; 全部收齐后系统自动研判(判灯永不经大模型)。</div></div>`;
  } else if (t === 'judge') {
    const jd = rs.filter(r => ['judged', 'archived'].includes(r.status));
    body = `<div class="card"><h3>结论(${jd.length}) <span style="font-weight:400;font-size:12px;color:var(--text-4)">研判触发与结论录入在评审单详情页(仅支持组/admin)</span></h3>${jd.length === 0 ? '<div class="empty">暂无结论</div>' : `<div class="card-table-wrap"><table>
      <tr><th>项目</th><th>灯态</th><th>结论</th><th>更新时间</th><th class="ops">操作</th></tr>
      ${jd.map(r => `<tr><td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${lightPill(r.light)}</td>
        <td>${esc(r.decision_result || '未录入')}</td><td>${fmtT(r.updated_at)}</td>
        <td class="ops"><a href="#/review/${r.id}">进入详情</a></td></tr>`).join('')}</table></div>`}</div>`;
  } else if (t === 'chat') {
    body = `<div class="card"><h3>对话 <span style="font-weight:400;font-size:12px;color:var(--text-4)">上下文锁定该商机 · 技能①预算 / 技能②评审表</span></h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" id="oppChatPick">
        ${bs.map(b => `<button class="btn sm" onclick="oppChatBudget(${b.id})">预算 ${esc(b.code)} v${b.version}</button>`).join('')}
        ${rs.filter(r => r.status === 'draft').map(r => `<button class="btn sm" onclick="oppChatReview(${r.id})">评审表 ${esc(r.title)}</button>`).join('')}
      </div>
      <div id="oppChatBox"><div class="empty">${bs.length || rs.length ? '选择上方目标开始对话' : '该商机暂无可对话单据'}</div></div></div>`;
  } else if (t === 'archive') {
    const ar = rs.filter(r => r.status === 'archived' || r.era === 'history');
    body = `<div class="card"><h3>归档(${ar.length}) <a href="#/archive" style="float:right;font-size:13px">归档库分析 →</a></h3>${ar.length === 0 ? '<div class="empty">暂无归档单</div>' : `<div class="card-table-wrap"><table>
      <tr><th>项目</th><th>类型</th><th>灯态</th><th>结论</th><th>归档时间</th></tr>
      ${ar.map(r => `<tr><td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td>${lightPill(r.light)}</td><td>${esc(r.decision_result || '—')}</td><td>${fmtT(r.archived_at || r.updated_at)}</td></tr>`).join('')}</table></div>`}</div>`;
  }
  page.innerHTML = `<div id="oppPage">
  <div class="card"><h3>商机 360° <span style="font-family:monospace;font-size:14px">${esc(code)}</span>
    <span style="font-weight:400;font-size:12.5px;color:var(--text-3)">${esc(d.opp.title || '')}</span>
    <a href="#/opps" style="float:right;font-size:13px">返回商机列表</a></h3>
    <div id="oppTabs" style="display:flex;gap:6px;flex-wrap:wrap">${tabBtns}</div>
  </div>
  ${body}
  </div>`;
}
async function oppChatBudget(bId) { // 360°对话标签: 内嵌技能①(挂载后隐藏目标选择器)
  const pick = $('#oppChatPick'); if (pick) pick.style.display = 'none';
  await mountAgentChat(bId, '#oppChatBox');
}
async function oppChatReview(rId) { // 360°对话标签: 内嵌技能②
  const pick = $('#oppChatPick'); if (pick) pick.style.display = 'none';
  await mountAgentReviewChat(rId, '#oppChatBox');
}
```

- [ ] **Step 2: renderRoute 增分支（'#/opps' 行之后）**

```js
  else if (h.startsWith('#/opp/')) renderOpp360(h.split('?')[0].split('/')[2]);
```

注意：`'#/opp/X'.startsWith('#/opps')` 为 false，与既有 `#/opps` 分支无冲突；`h.split('?')[0]` 先剥掉 `?t=` 查询串再取段。

- [ ] **Step 3: navHighlight 扩展（opps 项覆盖辐条页）**

把 navHighlight 中 `(n === 'opps' && h.startsWith('#/opps'))` 改为：
```js
(n === 'opps' && (h.startsWith('#/opps') || h.startsWith('#/opp/') || h.startsWith('#/review/') || h.startsWith('#/budget/') || h.startsWith('#/delivery/')))
```
（过渡期旧导航 `商机总览` data-n="opps" 同样受益；切换后指向 我的商机/全部商机。）

- [ ] **Step 4: 验证（IA-7~10 转绿，其余仍红属预期）**

Run: `"$N" --check public/app.js && "$N" tests/h_ia_shots.js`
Expected: IA-7/8/9/10 PASS；red 日志中 FAIL 数下降 4；IA-1~6/11~13 仍 FAIL。
再跑: `"$N" tests/h_nav_shots.js`
Expected: 全 PASS（旧导航与 #/opps 旧页面未动）

- [ ] **Step 5: 提交**

```bash
git add public/app.js
git commit -m "商机360°页落地: #/opp/:code 七标签(概览/预算/评审表/前置灯态/结论/对话/归档)+对话标签内嵌mountAgentChat, navHighlight辐条页归属商机入口"
```

---

### Task 5: 首页 renderHome 替换 renderDashboard（超集固化第 3 步）

**Files:**
- Modify: `public/app.js` — 删除 renderDashboard(301-365)，新写 renderHome；renderRoute 末分支改指向

**Interfaces:**
- Produces: `renderHome()`（#/ 渲染器）；DOM 锚：`.metric-grid`（所有 H 脚本 login 后的 waitForSelector 锚，**必须保留**）、`我的待办` 卡片标题、支持组 `待研判` 指标文案（IA-6 断言锚）。

- [ ] **Step 1: 用 renderHome 替换 renderDashboard（完整代码）**

删除 `async function renderDashboard() { … }` 整个函数（含其上 `// ---- 工作台 ----` 注释块保留改名为 `// ---- 首页(spec §2.4): 我的待办一条队列 + 指标卡, 替代双评审列表工作台 ----`），原位置写入：

```js
async function renderHome() {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash;
  const isSales = ['销售经理', '项目经理', '财务BP'].includes(ME.role);
  const isReviewer = ['FDE', '财务BP', '采购BP', '法务', '合规BP', '数据BP'].includes(ME.role);
  const isSupport = ME.role === '销售支持组' || ME.role === 'admin';
  const [mine, tasks, all] = await Promise.all([
    apiCached('/api/reviews?scope=mine'),
    apiCached('/api/tasks?scope=mine'),
    apiCached('/api/reviews?scope=all')
  ]);
  if ((location.hash || '#/') !== '#/') return; // 竞态守卫
  const myReviews = mine.reviews || [];
  const myTasks = (tasks.tasks || []);
  const allR = (all.reviews || []);
  const waitJudge = allR.filter(r => r.status === 'reviewing');
  const yellowMeet = allR.filter(r => r.status === 'judged' && r.light === 'yellow');
  const salesTodo = myReviews.filter(r => ['draft', 'returned'].includes(r.status));
  const oppLink = c => c ? '#/opp/' + encodeURIComponent(c) : '';
  page.innerHTML = `
  <div class="metric-grid">
    ${isReviewer ? `<div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/tasks'"><span class="m-label">待我评审</span><span class="m-value tone-yellow">${myTasks.length}</span><span class="m-foot">前置评审待办</span></div>` : ''}
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/opps'"><span class="m-label">${isSales ? '我的商机' : '我的评审单'}</span><span class="m-value">${myReviews.length}</span><span class="m-foot">点击进入商机列表</span></div>
    ${isSales ? `<div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/new'"><span class="m-label">发起新商机</span><span class="m-value tone-brand">→</span><span class="m-foot">向导式: 对话/表单/Excel</span></div>` : ''}
    ${isSupport ? `<div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/judge'"><span class="m-label">待研判</span><span class="m-value tone-yellow">${waitJudge.length}</span><span class="m-foot">前置收集中</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/judge'"><span class="m-label">黄灯待上会</span><span class="m-value">${yellowMeet.length}</span><span class="m-foot">周二部门级/周五XO级</span></div>` : ''}
  </div>
  <div class="card"><h3>我的待办 <span style="font-weight:400;font-size:12px;color:var(--text-4)">按角色聚合: 申请人补齐修改 · 部门打灯 · 支持组研判</span></h3>
  ${(() => {
    const rows = [];
    if (isSales) for (const r of salesTodo.slice(0, 20)) rows.push(`<tr>
      <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
      <td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td>
      <td>${statusPill(r.status)}</td>
      <td class="ops">${oppLink(r.opp_code) ? `<a href="${oppLink(r.opp_code)}">进入商机</a>` : `<a href="#/review/${r.id}">去补齐</a>`}</td></tr>`);
    if (isReviewer) for (const t of myTasks.slice(0, 20)) rows.push(`<tr>
      <td><a href="#/review/${t.review_id}">${esc(t.title)}</a> · <b>${esc(t.ind_name)}</b></td><td>前置打灯</td>
      <td style="font-family:monospace;font-size:12px">${esc(t.opp_code || '—')}</td>
      <td>${pill('待打灯', 'p-yellow')}</td>
      <td class="ops"><button class="btn sm pri" onclick="openTask(${t.id},'${esc(t.ind_name)}',\`${esc(t.standards)}\`)">打灯</button></td></tr>`);
    if (isSupport) {
      for (const r of waitJudge.slice(0, 15)) rows.push(`<tr>
        <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td>
        <td>${statusPill(r.status)}</td>
        <td class="ops">${oppLink(r.opp_code) ? `<a href="${oppLink(r.opp_code)}">进入商机</a>` : `<a href="#/review/${r.id}">详情</a>`}</td></tr>`);
      for (const r of yellowMeet.slice(0, 10)) rows.push(`<tr>
        <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td>
        <td>${pill('黄灯', 'p-yellow')}</td>
        <td class="ops"><a href="#/review/${r.id}">录入结论</a></td></tr>`);
    }
    return rows.length ? `<div class="card-table-wrap"><table>
      <tr><th>事项</th><th>类型</th><th>商机代码</th><th>状态</th><th class="ops">操作</th></tr>${rows.join('')}</table></div>`
      : '<div class="empty">暂无待办</div>';
  })()}
  </div>
  <div class="row">
    <div class="card" style="flex:3"><h3>灯色分布(全部评审单 · 只读)</h3>${lightDistBar(allR)}</div>
    <div class="card" style="flex:2"><h3>近 8 周建单量趋势</h3>
      ${sparklineSVG(weeklyCounts(allR))}
      <div style="font-size:11.5px;color:var(--text-4);margin-top:4px">每周新建评审单数 · 末点为本周</div>
    </div>
  </div>`;
}
```

（`weeklyCounts`/`sparklineSVG`/`lightDistBar` 为 renderDashboard 之上已定义的共享组件，保留不动。）

- [ ] **Step 2: renderRoute 末分支切换**

`else renderDashboard();` → `else renderHome();`

- [ ] **Step 3: 验证（IA-6 转绿 + 旧 H 套件全绿）**

Run: `"$N" --check public/app.js && "$N" tests/h_ia_shots.js`
Expected: IA-6/6b/6c PASS（'我的待办' 各角色呈现）。
再跑: `"$N" tests/h_nav_shots.js && "$N" tests/h_ui_shots.js && "$N" tests/h_flicker.js`
Expected: 全 PASS（login 的 .metric-grid 等待被 renderHome 保留；NAV 断言不涉及工作台内容；截图套件仅断言无 JS 报错）

- [ ] **Step 4: 提交**

```bash
git add public/app.js
git commit -m "首页renderHome替换工作台renderDashboard: 我的待办一条队列按角色聚合(销售补齐/BP打灯/支持组待研判+黄灯)+指标卡, 删除重复的双评审列表"
```

---

### Task 6: 商机列表 renderOppsList 重建（超集固化第 4 步）

**Files:**
- Modify: `public/app.js` — renderOpps(1475-1513) 重建为 renderOppsList；renderRoute '#/opps' 分支改调用

**Interfaces:**
- Consumes: `window._oppF`/`oppQ`/`oppToggle`/`oppExpandHtml`（原样保留——NAV-4/5 断言锚）。
- Produces: `renderOppsList()`；表 id `#oppsTbl` 不变；新增行内按钮 `进入 360°`（文案全局唯一）。

- [ ] **Step 1: 重建函数（完整代码）**

`async function renderOpps() { … }` 整体替换为（oppQ/oppToggle/oppExpandHtml 三个辅助不动）：

```js
async function renderOppsList() {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash; // 竞态守卫: await 期间切走则弃写
  const isMine = ['销售经理', '项目经理', '财务BP'].includes(ME.role); // 我的商机; 支持组/admin=全部商机(spec §2.2 取数口径)
  const [rv, bd] = await Promise.all([apiCached('/api/reviews?scope=' + (isMine ? 'mine' : 'all')), apiCached('/api/budget')]);
  if ((location.hash || '') !== h0) return;
  const st = window._oppF || (window._oppF = { q: '', open: {} });
  const map = new Map();
  const grp = c => {
    const code = String(c || '');
    const key = code.replace(/[^A-Za-z0-9_-]/g, '_'); // onclick 参数安全化(展示用原码, 状态键用安全码)
    if (!map.has(key)) map.set(key, { code, key, title: '', reviews: [], budgets: [] });
    return map.get(key);
  };
  for (const r of (rv.reviews || [])) { const g = grp(r.opp_code); g.reviews.push(r); if (!g.title) g.title = r.title; }
  const myCodes = new Set((rv.reviews || []).map(r => String(r.opp_code || '')));
  for (const b of (bd.budgets || [])) {
    if (isMine && !myCodes.has(String(b.opp_code || ''))) continue; // 我的商机: 只追加自己商机挂靠的预算单(只读)
    const g = grp(b.opp_code); g.budgets.push(b); if (!g.title) g.title = b.project_name || '';
  }
  let rows = [...map.values()];
  if (st.q) { const q = st.q.trim().toUpperCase(); rows = rows.filter(g => g.code.toUpperCase().includes(q) || (g.title || '').toUpperCase().includes(q)); }
  rows.sort((a, b) => (b.reviews.length + b.budgets.length) - (a.reviews.length + a.budgets.length));
  const latestLight = g => { for (const r of g.reviews) if (r.light) return r.light; return ''; };
  page.innerHTML = `
  <div class="card"><h3>${isMine ? '我的商机' : '全部商机'} <span class="pill p-purple">opp_code 主键</span>
    <a href="#/new" style="float:right;font-size:13px">+ 新商机</a>
    <input id="oppsQ" placeholder="商机代码/项目名搜索" value="${esc(st.q)}" style="float:right;border:1px solid var(--border-default);border-radius:var(--r-m);padding:6px 10px;font-size:12.5px;background:var(--control-bg);color:var(--text-1);width:200px;margin-right:10px" oninput="oppQ(this.value)">
    <div style="clear:both;font-size:12px;color:var(--text-4);line-height:1.7">按商机代码聚合${isMine ? '我的' : '全部'}评审单与预算单。点击「进入 360°」一页办完该商机; 点击行展开单据链。</div>
  </h3>
  ${rows.length === 0 ? '<div class="empty">没有符合条件的商机</div>' : `<div class="card-table-wrap"><table id="oppsTbl">
    <tr><th>商机代码</th><th>项目(取首个单据名)</th><th class="num">预算单</th><th class="num">评审单</th><th>最新灯态</th><th class="ops">操作</th></tr>
    ${rows.map(g => {
      const open = !!st.open[g.key];
      return `<tr onclick="oppToggle('${g.key}')" style="cursor:pointer">
        <td style="font-family:monospace;font-size:12px">${g.code ? esc(g.code) : '<span style="color:var(--text-4)">未标识商机</span>'}</td>
        <td>${esc(g.title || '—')}</td>
        <td class="num">${g.budgets.length}</td><td class="num">${g.reviews.length}</td>
        <td>${lightPill(latestLight(g))}</td>
        <td class="ops">${g.code ? `<button class="btn sm pri" onclick="event.stopPropagation();location.hash='#/opp/${encodeURIComponent(g.code)}'">进入 360°</button>` : ''} ${open ? '收起 ▲' : '展开 ▼'}</td>
      </tr>${open ? oppExpandHtml(g) : ''}`;
    }).join('')}</table></div>`}
  </div>`;
}
```

- [ ] **Step 2: renderRoute '#/opps' 分支改调用**

`if (h.startsWith('#/opps')) renderOpps();` → `if (h.startsWith('#/opps')) renderOppsList();`

- [ ] **Step 3: 验证（NAV 旧套件仍绿 + IA-13 绿）**

Run: `"$N" --check public/app.js && "$N" tests/h_nav_shots.js && "$N" tests/h_ia_shots.js`
Expected: NAV 全 PASS（#oppsTbl/搜索/展开锚保留）；IA-13 PASS（oppsTbl 商机代码列）。注意 NAV-4 的 `tr[onclick]` 计数与 NAV-5 的展开链接正则均由本实现保留。

- [ ] **Step 4: 提交**

```bash
git add public/app.js
git commit -m "商机列表重建renderOppsList: 我的商机(销售按创建人+商机挂靠预算)/全部商机(支持组), 行内进入360°按钮(event.stopPropagation防行展开误触), 保留搜索/展开单据链锚"
```

---

### Task 7: 新商机向导改版 + 提交成功跳 360°（超集固化第 5 步）

**Files:**
- Modify: `public/app.js` — renderForm 类型选择块(372-390)；saveBudget(833-845)

**Interfaces:**
- Produces: `#/new` 向导首页三编制方式文案（IA-11 锚：`对话式编制`/`表单式编制`/`Excel 导入`）；`.stat` 类型卡与 `#impFile/#impType/importReviewExcel` 全部原样保留（h_manual H-06 断言锚）。

- [ ] **Step 1: 改版类型选择页**

把 renderForm 内 `if (!type) { page.innerHTML = … return; }` 块替换为（保留原有 `.stat` 三卡与 Excel 导入行不动，仅在上方加向导头）：

```js
  if (!type) {
    page.innerHTML = `
    <div class="card"><h3>新商机向导 <span style="font-weight:400;font-size:12.5px;color:var(--text-3)">一个商机, 选类型 · 选编制方式 · 完成后进入商机 360°</span></h3>
      <div class="row" style="margin-bottom:6px">
        <div class="stat" style="cursor:pointer;flex:1" onclick="location.hash='#/agent'">
          <div class="n" style="font-size:16px">① 对话式编制</div>
          <div class="t">向智能体口述, 自动翻译字段+实时精算(技能①预算/技能②评审表)</div>
        </div>
        <div class="stat" style="cursor:pointer;flex:1" onclick="document.getElementById('impFile').click()">
          <div class="n" style="font-size:16px">③ Excel 导入</div>
          <div class="t">上传含信息收集表的评审表模板, 核对后补齐提交</div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-4);margin:10px 0 4px">② 表单式编制 · 选择评审类型:</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
        <input type="file" id="impFile" accept=".xlsx" style="font-size:12.5px">
        <select id="impType" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:7px 10px;font-size:13px;background:var(--control-bg);color:var(--text-1)">
          <option value="bid">投标决策评审</option><option value="presale">售前立项评审</option><option value="change">关键事项决策</option>
        </select>
        <button class="btn sm pri" onclick="importReviewExcel()">上传 Excel 导入评审单</button>
        <span style="font-size:12px;color:var(--text-4)">含信息收集表的评审表模板；导入后核对补充再提交</span>
      </div><div class="row">
      ${Object.entries(TYPE_NAMES).map(([k, v]) => `
        <div class="stat" style="cursor:pointer" onclick="location.hash='#/new/${k}'">
          <div class="n" style="font-size:17px">${v}</div>
          <div class="t">${{ presale: '销售经理发起 · 售前投入前', bid: '销售经理发起 · 投标前', change: '项目经理发起 · 执行中重大变更' }[k]}</div>
        </div>`).join('')}
    </div></div>`;
    return;
  }
```

（对话式/Excel 两卡加 ①③ 序号、表单式区域标 ②——三方式齐现且不新增测试歧义文案；`.stat` 结构复用既有样式与 h_manual 的 `div.stat:has-text("投标决策评审")` 点击锚。）

- [ ] **Step 2: 提交成功跳 360°**

saveBudget 中 `location.hash = '#/review/' + id;` 改为：

```js
    location.hash = (B_REVIEW && B_REVIEW.opp_code) ? '#/opp/' + encodeURIComponent(B_REVIEW.opp_code) : '#/review/' + id;
```

（B_REVIEW 在 renderBudget 里已赋值为完整 review 行，含 opp_code；未挂靠商机的单回退详情页。）

- [ ] **Step 3: 验证（IA-11 绿 + h_manual 全链路仍绿）**

Run: `"$N" --check public/app.js && "$N" tests/h_ia_shots.js && "$N" tests/h_manual_check.js`
Expected: IA-11 PASS；h_manual 全 PASS（H-06 走 `div.stat:has-text("投标决策评审")` 锚不受影响）

- [ ] **Step 4: 提交**

```bash
git add public/app.js
git commit -m "新商机向导: 类型选择页升格为三编制方式(对话式/表单式/Excel导入)四扇门收敛一扇, 提交成功跳商机360°(未挂靠回退详情页)"
```

---

### Task 8: 一次切换——新导航 + 路由收编 + 旧 H 测试同批更新 + 全回归

**Files:**
- Modify: `public/app.js` — renderShell/navHighlight/renderRoute；renderDetail/renderBudget 页头面包屑；研判台 metric 链接；删除 renderReviewsList/setRevScope
- Rewrite: `tests/h_nav_shots.js`
- Modify: `tests/h_manual_check.js`（3 处 nav click）、`tests/h_ui_shots.js`（2 处 nav click）
- Modify: `tests/run_all.js`（NAV 行描述 + 新增 IA 行 → 20 套）

**Interfaces:**
- Consumes: Task 4~7 全部超集件。
- Produces: 最终 IA（spec §2.1 导航矩阵、§4 路由表）；20 套回归。

- [ ] **Step 1: renderShell 换新导航（完整 nav 块）**

renderShell 内 `<nav> … </nav>` 整块替换为：

```js
    <nav>
      <a href="#/" data-n="home">首页</a>
      ${(ME.role === '销售支持组' || ME.role === 'admin') ? '<a href="#/opps" data-n="opps">全部商机</a>' : (['销售经理', '项目经理', '财务BP'].includes(ME.role) ? '<a href="#/opps" data-n="opps">我的商机</a>' : '')}
      ${['销售经理', '项目经理', '财务BP'].includes(ME.role) ? '<a href="#/new" data-n="new">新商机</a>' : ''}
      ${!['销售经理', '项目经理'].includes(ME.role) ? '<a href="#/tasks" data-n="tasks">待办打灯</a>' : ''}
      ${(ME.role === '销售支持组' || ME.role === 'admin') ? `
      <a href="#/judge" data-n="judge">研判台</a>
      <a href="#/archive" data-n="arc">归档库</a>
      <a href="#/parser-lab" data-n="lab">解析器实验室</a>
      ${ME.role === 'admin' ? '<a href="#/settings" data-n="set">LLM 设置</a>' : ''}` : ''}
    </nav>
```

角色核对：sales1/pm1=首页·我的商机·新商机(3)；fin1=+待办打灯(4)；fde1/pur1/legal1/comp1/data1=首页·待办打灯(2)；zhichizu=6；admin=7。

- [ ] **Step 2: navHighlight 重写**

```js
function navHighlight() {
  const h = location.hash || '#/';
  document.querySelectorAll('.sidebar nav a').forEach(a => {
    const n = a.dataset.n;
    a.classList.remove('on');
    if ((n === 'home' && (h === '#/' || h === '')) || (n === 'new' && h.startsWith('#/new'))
      || (n === 'arc' && h.startsWith('#/archive')) || (n === 'set' && h.startsWith('#/settings'))
      || (n === 'tasks' && h.startsWith('#/tasks')) || (n === 'judge' && h.startsWith('#/judge')) || (n === 'lab' && h.startsWith('#/parser-lab'))
      || (n === 'opps' && (h.startsWith('#/opps') || h.startsWith('#/opp/') || h.startsWith('#/review/') || h.startsWith('#/budget/') || h.startsWith('#/delivery/')))) a.classList.add('on');
  });
}
```

- [ ] **Step 3: renderRoute 收编（#/reviews 重定向 + 撤 renderReviewsList）**

renderRoute 整函数替换为：

```js
function renderRoute(h) {
  if (h === '#/reviews' || h.startsWith('#/reviews?')) { location.hash = '#/opps'; return; } // 旧评审单列表并入商机列表(spec §4)
  if (h.startsWith('#/opps')) renderOppsList();
  else if (h.startsWith('#/opp/')) renderOpp360(h.split('?')[0].split('/')[2]);
  else if (h.startsWith('#/tasks')) renderTasksCenter();
  else if (h.startsWith('#/judge')) renderJudgeBoard();
  else if (h.startsWith('#/new')) renderForm(h.split('/')[2]);
  else if (h.startsWith('#/agent')) renderAgent();
  else if (h.startsWith('#/budgets')) renderBudgets();
  else if (h.startsWith('#/delivery/')) renderDeliveryPage(h.split('/')[2]);
  else if (h.startsWith('#/settings')) renderSettings();
  else if (h.startsWith('#/parser-lab')) renderParserLab();
  else if (h.startsWith('#/budget/')) renderBudget(h.split('/')[2]);
  else if (h.startsWith('#/review/')) renderDetail(h.split('/')[2]);
  else if (h.startsWith('#/archive')) renderArchive();
  else renderHome();
}
```

并整体删除 `renderReviewsList()` 与 `setRevScope()` 两函数（无消费者）。

- [ ] **Step 4: 研判台 metric 链接 rehome + 辐条页面包屑**

- renderJudgeBoard 中 `onclick="location.hash='#/reviews'"`（"编制中(草稿/退回)"瓦片）→ `onclick="location.hash='#/opps'"`
- renderDetail 页头 `<h3>${esc(r.title)} …` 前追加面包屑（banner 之下、第一张卡之前）：
```js
  ${r.opp_code ? `<div style="font-size:12.5px;margin-bottom:8px"><a href="#/opp/${encodeURIComponent(r.opp_code)}" style="color:var(--brand)">所属商机 ${esc(r.opp_code)} → 360°</a></div>` : ''}
```
（插入点：`page.innerHTML = \`` 模板串内 `${banner}` 之后第一行。）
- renderBudget 页头同样追加（用 B_REVIEW.opp_code）：
```js
  ${(B_REVIEW.opp_code) ? `<div style="font-size:12.5px;margin-bottom:8px"><a href="#/opp/${encodeURIComponent(B_REVIEW.opp_code)}" style="color:var(--brand)">所属商机 ${esc(B_REVIEW.opp_code)} → 360°</a></div>` : ''}
```

- [ ] **Step 5: 重写 tests/h_nav_shots.js（新 IA 断言，完整代码）**

```js
// H-Nav v2: 商机中枢式导航(spec 2026-10-14 §2.1)——角色 4~6 项扁平导航 + 商机列表→360° 入口 + 任务/研判保留页
const B = 'http://127.0.0.1:8600';
const path = require('path');
const LOG = [];
const out = s => { console.log(s); LOG.push(s); };

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { const line = (ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : ''); out(line); ok ? pass++ : fail++; };
  const login = async (u) => {
    await page.goto(B + '/');
    await page.fill('#lu', u);
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell', { timeout: 5000 });
  };
  const navTexts = async () => page.locator('.sidebar nav a').allTextContents();
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---- zhichizu: 六项 + 扁平 + 归档库锚 ----
  await login('zhichizu');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n1 = await navTexts();
  check('NAV-1 zhichizu 导航六项', sameArr(n1, ['首页', '全部商机', '待办打灯', '研判台', '归档库', '解析器实验室']), '实得:' + n1.join(','));
  check('NAV-2 扁平无分组div + 归档库文本(h_flicker 锚)', (await page.locator('.sidebar .nav-group').count()) === 0 && (await page.locator('nav a:has-text("归档库")').count()) === 1);
  await page.screenshot({ path: 'shots/H_NAV_1_shell.png', fullPage: false });

  // ---- 商机列表 → 360° ----
  await page.evaluate(() => { location.hash = '#/opps'; });
  await page.waitForSelector('#oppsTbl', { timeout: 10000 });
  await page.fill('#oppsQ', 'PL00008572');
  await page.waitForTimeout(700);
  check('NAV-3 商机列表搜索命中', (await page.locator('#oppsTbl tbody tr[onclick]').count()) >= 1, 'rows=' + (await page.locator('#oppsTbl tbody tr[onclick]').count()));
  await page.locator('#oppsTbl tbody tr[onclick]').first().click();
  await page.waitForTimeout(500);
  const oppBody = await page.textContent('#oppsTbl');
  check('NAV-4 行展开单据链(评审单+预算单)', oppBody.includes('评审单') && oppBody.includes('预算单'));
  await page.click('#oppsTbl button:has-text("进入 360°")');
  await page.waitForTimeout(900);
  check('NAV-5 进入360°(hash+#oppPage)', ((await page.evaluate(() => location.hash)).includes('#/opp/PL00008572')) && (await page.locator('#oppPage').count()) === 1, 'hash=' + (await page.evaluate(() => location.hash)));
  await page.screenshot({ path: 'shots/H_NAV_2_opp360.png', fullPage: false });

  // ---- 待办打灯(不变页) ----
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForSelector('#taskTbl', { timeout: 10000 });
  const taskTabs = await page.textContent('body');
  check('NAV-6 任务中心(待打灯/已处理/全部监控)', taskTabs.includes('待打灯') && taskTabs.includes('已处理') && taskTabs.includes('全部监控'));
  await page.click('button:text-is("全部监控")');
  await page.waitForTimeout(800);
  check('NAV-7 全部监控有任务行(指标+部门列)', (await page.locator('#taskTbl tbody tr').count()) >= 1 && (await page.textContent('#taskTbl')).includes('评判指标'));
  await page.screenshot({ path: 'shots/H_NAV_3_tasks.png', fullPage: false });

  // ---- 研判台(不变页) ----
  await page.evaluate(() => { location.hash = '#/judge'; });
  await page.waitForSelector('#judgePage', { timeout: 10000 });
  await page.waitForTimeout(600);
  const judgeBody = await page.textContent('#judgePage');
  check('NAV-8 研判台四队列+灯色分布', judgeBody.includes('前置收集中') && judgeBody.includes('待上会') && judgeBody.includes('绿灯待归档') && judgeBody.includes('红灯已打回') && (await page.locator('#judgePage .dist-bar').count()) >= 1);
  await page.screenshot({ path: 'shots/H_NAV_4_judge.png', fullPage: false });

  // ---- 角色矩阵 ----
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fde1');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n2 = await navTexts();
  check('NAV-9 fde1 两项(首页/待办打灯)', sameArr(n2, ['首页', '待办打灯']), '实得:' + n2.join(','));
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('sales1');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n3 = await navTexts();
  check('NAV-10 sales1 三项(首页/我的商机/新商机)', sameArr(n3, ['首页', '我的商机', '新商机']), '实得:' + n3.join(','));
  check('NAV-11 sales1 不见待办打灯/研判台/归档库/解析器实验室', (await page.locator('nav a:has-text("待办打灯")').count()) === 0 && (await page.locator('nav a:has-text("研判台")').count()) === 0 && (await page.locator('nav a:has-text("归档库")').count()) === 0 && (await page.locator('nav a:has-text("解析器实验室")').count()) === 0);
  await page.screenshot({ path: 'shots/H_NAV_5_sales.png', fullPage: false });
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fin1');
  await page.waitForSelector('.metric-grid', { timeout: 8000 });
  const n4 = await navTexts();
  check('NAV-12 财务BP 四项(含待办打灯)', sameArr(n4, ['首页', '我的商机', '新商机', '待办打灯']), '实得:' + n4.join(','));

  await browser.close();
  out(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  require('fs').writeFileSync(path.join(__dirname, fail === 0 ? 'green_nav.txt' : 'red_nav.txt'), LOG.join('\n') + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); require('fs').writeFileSync(path.join(__dirname, 'red_nav.txt', ), 'FAIL:' + e.message + '\n', 'utf8'); process.exit(1); });
```

- [ ] **Step 6: h_manual_check.js 三处导航点击改 hash 直达**

- 31 行 `await page.click('nav a:has-text("智能体")');` → `await page.evaluate(() => { location.hash = '#/agent'; });`
- 121 行 `await page.click('nav a:has-text("预算单")');` → `await page.evaluate(() => { location.hash = '#/budgets'; });`
- 134 行 `await page.click('nav a:has-text("新建评审单")');` → `await page.evaluate(() => { location.hash = '#/new'; });`

（#/agent 与 #/budgets 路由均保留——spec §2.2 修订；后续 waitForSelector 不变。）

- [ ] **Step 7: h_ui_shots.js 两处同改**

- 86 行 `await page.click('nav a:has-text("新建评审单")');` → `await page.evaluate(() => { location.hash = '#/new'; });`
- 110 行 `await page.click('nav a:has-text("预算单")');` → `await page.evaluate(() => { location.hash = '#/budgets'; });`

- [ ] **Step 8: run_all.js 增至 20 套**

SUITES 中 `['NAV-1~15 五模块导航重组浏览器层', …]` 行替换为：
```js
    ['NAV-* 商机中枢导航浏览器层', [NODE, ['tests/h_nav_shots.js']]],
    ['IA-1~14 商机中枢IA浏览器层', [NODE, ['tests/h_ia_shots.js']]],
```

- [ ] **Step 9: 逐套验证切换结果**

Run: `"$N" --check public/app.js && "$N" tests/h_ia_shots.js && "$N" tests/h_nav_shots.js && "$N" tests/h_manual_check.js && "$N" tests/h_ui_shots.js && "$N" tests/h_flicker.js && "$N" tests/h_adv_check.js && "$N" tests/h_lab_shots.js`
Expected: 全部退出码 0；h_ia_shots 生成 `tests/green_ia.txt`（ALL PASS）；h_nav_shots 生成 `tests/green_nav.txt`。任何一套 FAIL：停下按 systematic-debugging 排查，不得带病进全回归。

- [ ] **Step 10: 全回归 20 套（收工门）**

Run: `"$N" tests/run_all.js --log=tests/green_run_ia.txt`
Expected: 末行 `20/20 套通过 … ALL PASS`；`tests/green_run_ia.txt` 落盘

- [ ] **Step 11: 提交切换（原子提交）**

```bash
git add public/app.js tests/h_nav_shots.js tests/h_manual_check.js tests/h_ui_shots.js tests/run_all.js tests/green_ia.txt tests/green_nav.txt tests/green_run_ia.txt
git commit -m "商机中枢式IA一次切换: 角色导航4~6项扁平化(销售3/财务4/部门BP2/支持组6/admin7)+#/reviews重定向#/opps+renderReviewsList撤销, 旧H测试锚点同批更新, IA 14/0+NAV 12/0+run_all 20套全绿"
```

---

## 收尾核查（对照 spec §9 验收标准）

1. 五角色导航 4~6 项 —— NAV-1/9/10/12 + IA-1/3/4/5 已断言。
2. `#/opp/PL00008572` 七标签数据正确 —— IA-7~10 + NAV-5。
3. #/reviews 重定向 —— IA-12。
4. red_ia.txt（Task 1 落盘）+ green_ia.txt + 20/20 全绿证据齐备，全部已随对应提交入库。
5. 已知不修（记录在案）：oppExpandHtml 里 `#/budget/${b.id}` 链接指向 renderBudget 的评审预算表路由（历史错链，本次范围外，360° 预算标签未复制该链接）。

## Self-Review 记录

- Spec 覆盖：§2.1 导航矩阵→Task 8 Step 1；§2.2 映射→Task 4/5/6/7/8；§2.3 七标签→Task 4；§2.4 首页→Task 5；§2.5 向导→Task 7；§3 端点→Task 2；§4 重定向→Task 8 Step 3；§5 错误处理→Task 4 catch 分支与 Task 2 404；§6 测试→Task 1/8；§8 红线→Global Constraints；§9 验收→收尾核查。无缺口。
- 占位符扫描：无 TBD/TODO；所有代码步骤给出完整代码。
- 类型/命名一致性：`renderOppsList/renderOpp360/renderHome/mountAgentChat/mountAgentReviewChat/oppChatBudget/oppChatReview` 在 Task 3/4/6/8 间签名一致；`#oppPage/#oppTabs/#oppChatBox/#oppsTbl` DOM 锚与测试断言一致；360 端点响应键与 renderOpp360 消费键一致（reviews 含 decision_result/archived_at/era，tasks 为 t.* 联查行）。
