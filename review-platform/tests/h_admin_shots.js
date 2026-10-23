// H-AD: V4.0-T13 两个管理中心的浏览器层验收(D-53 补救): #/admin/llm 与 #/admin/robot 首次在真实浏览器里打开
// 骨架逐字沿用 h_nav_shots.js / h_ia_shots.js: playwright 从 E:\\npm-global 引入 + channel chrome + headless + 1440x950、
// login(密码 123456)与 .app-shell 锚、PASS/FAIL 行格式、末行「N passed, M failed -> ALL PASS」、--log= 口径、
// 脚本内 fs.writeFileSync(path, log, 'utf8') 落盘(默认名 green_admin.txt / red_admin.txt)
// 简报十条 → 本套件标签: AD-01(+b/c/d) 登录门 | AD-02(+b) 明文 key 红线 | AD-03(+b/c) 掩码 | AD-04 #/settings 重定向
//                    AD-05(+b) 导航可达 | AD-06 矩阵八事件 | AD-07 空态+config 只读+导入 | AD-08 探针发请求
//                    AD-09 console/pageerror 零错误 | AD-10 截图
// 密钥明文只在内存里持有，写出前一律 scrub 擦除；日志只打印命中与否/长度/掩码计数
const B = 'http://127.0.0.1:8600';
const path = require('path');
const fs = require('fs');
const LOG = [];
const out = s => { console.log(s); LOG.push(s); };
const LOGARG = process.argv.find(a => a.startsWith('--log='));
const REDMODE = !!(LOGARG && /red_robot_admin_tabs\.txt$/.test(LOGARG));
const writeLog = fail => fs.writeFileSync(LOGARG ? path.resolve(LOGARG.slice(6)) : path.join(__dirname, fail === 0 ? 'green_admin.txt' : 'red_admin.txt'), LOG.join('\n') + '\n', 'utf8');
const xssCode = 'PL-AD-RB-' + Date.now();
let browser;
let pass = 0, fail = 0;

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  if (REDMODE) await page.route('**/api/admin/llm/test', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":false,"error":"Task 1 RED 本地拦截，不访问外网"}' }));
  page.setDefaultTimeout(6000); // 同 h_ia: 缺锚 6s 即判负, 不必等默认 30s
  const check = (name, ok, ev) => { const line = (ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : ''); out(line); ok ? pass++ : fail++; };
  const login = async (u) => {
    await page.goto(B + '/');
    await page.fill('#lu', u);
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell', { timeout: 5000 });
  };
  const relogin = async (u) => { await page.evaluate(() => logout()); await page.waitForTimeout(500); await login(u); };

  // 明文比对基准(铁律3: config.json 只读不写; 值绝不入日志)
  const plainKey = String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).LLM_API_KEY || '');
  const scrub = s => String(s).split(plainKey).join('[KEY]');

  // 阶段打标: AD-09 只判两页(llm/robot)导航渲染期, 登录/夹具阶段的 HTTP 状态由各自条目钉住
  let phase = 'boot';
  const consoleErrs = [], pageErrs = [], probeReqs = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(phase + '|' + scrub(m.text()).slice(0, 160)); });
  page.on('pageerror', e => pageErrs.push(phase + '|' + scrub(String((e && e.message) || e)).slice(0, 160)));
  page.on('request', r => { if (r.method() === 'POST' && /\/api\/admin\/llm\/test$/.test(r.url())) probeReqs.push(r.url()); });

  const go = async h => { await page.evaluate(x => { location.hash = x; }, h); };
  const waitCards = async (n, title) => page.waitForFunction(({ n, title }) =>
    document.querySelectorAll('#page .card').length === n &&
    document.querySelector('#page .card h3')?.textContent.includes(title),
  { n, title }, { timeout: 15000 });
  const cardTitles = async () => (await page.locator('#page .card h3').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
  const cardText = async i => scrub(await page.locator('#page .card').nth(i).textContent());
  const bodyText = async () => scrub(await page.evaluate(() => document.body.innerText));
  const getHash = () => page.evaluate(() => location.hash);
  const call = (p, method, body) => page.evaluate(async a => fetch(a[0], {
    method: a[1], headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.token || '') },
    body: a[2] === null ? undefined : JSON.stringify(a[2])
  }).then(async x => ({ status: x.status, data: await x.json().catch(() => ({})) })), [p, method, body === undefined ? null : body]);

  // ---- 前置: admin 用户名取自用户表(不硬编码), 非 admin 用销售经理 ----
  await login('zhichizu');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const users = (await call('/api/users')).data.users || [];
  const adminName = (users.find(u => u.role === 'admin') || {}).username;
  const salesName = (users.find(u => u.role === '销售经理') || {}).username;
  if (!adminName) throw new Error('用户表无 role=admin 账号, 管理中心浏览器层无法验收');
  if (!salesName) throw new Error('用户表无 role=销售经理 账号, 无法测非 admin 登录门');

  // ---- AD-01c/01d: 非 admin 直接跳 #/admin/llm 被挡(简报条目 1 的后半) ----
  await relogin(salesName);
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  phase = 'nonadmin';
  await go('#/admin/llm');
  await page.waitForTimeout(1200);
  const t01 = await bodyText();
  check('AD-01c 非 admin 直跳 #/admin/llm 被挡回首页且不出现 LLM 配置卡',
    (await getHash()) === '#/' && (await page.locator('#page .card h3:has-text("LLM 管理中心")').count()) === 0 && !t01.includes('顶层配置') && !t01.includes('提示词版本'),
    'hash=' + (await getHash()) + ' 含顶层配置=' + t01.includes('顶层配置') + ' 含提示词版本=' + t01.includes('提示词版本'));
  check('AD-01d 非 admin 侧栏不出现两个管理中心入口',
    (await page.locator('.sidebar nav a[data-n="set"]').count()) === 0 && (await page.locator('.sidebar nav a[data-n="robot"]').count()) === 0,
    'set=' + (await page.locator('.sidebar nav a[data-n="set"]').count()) + ' robot=' + (await page.locator('.sidebar nav a[data-n="robot"]').count()));

  // ---- AD-01/01b: admin 登录 #/admin/llm 六卡 + profile 实效表四行 ----
  await relogin(adminName);
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  phase = 'llm';
  await go('#/admin/llm');
  await waitCards(6, 'LLM 管理中心');
  const tt1 = await cardTitles();
  check('AD-01 admin 登录后 #/admin/llm 渲染六卡(实效/顶层配置/Profile 覆盖/降级参数/提示词版本/用量)',
    tt1.length === 6 && tt1[0].includes('LLM 管理中心') && tt1[1].includes('顶层配置') && tt1[2].includes('Profile 覆盖') &&
    tt1[3].includes('降级参数') && tt1[4].includes('提示词版本') && tt1[5].includes('用量'), '实得: ' + tt1.join(' | '));
  const profRows = await page.locator('#page .card').first().locator('tbody tr').count();
  check('AD-01b 实效表按 default/budget/review/parser 逐 profile 一行', profRows === 4, 'tbody tr=' + profRows);

  // ---- AD-02: 明文 key 红线(LLM 页, 简报条目 2) ----
  const t02 = await bodyText();
  const sk02 = (t02.match(/sk-[A-Za-z0-9]{6,}/g) || []).length;
  check('AD-02 #/admin/llm 全文不含 LLM_API_KEY 明文且无 sk- 开头的长密钥片段',
    plainKey.length >= 8 && !t02.includes(plainKey) && sk02 === 0,
    'keyLen=' + plainKey.length + ' 明文命中=' + t02.includes(plainKey) + ' sk-长片段=' + sk02 + ' innerText长度=' + t02.length);

  // ---- AD-03: 掩码可见(简报条目 3, 证明展示走掩码字段而非空值) ----
  const masks03 = t02.match(/[A-Za-z0-9_.:+-]*\*{4}[A-Za-z0-9_.:+-]*/g) || [];
  check('AD-03 #/admin/llm 掩码形态可见(见 **** 且掩码 token 非空值)',
    (t02.match(/\*{4}/g) || []).length >= 1 && masks03.length >= 1 && masks03.some(m => m.replace(/\*/g, '').length > 0),
    '****次数=' + (t02.match(/\*{4}/g) || []).length + ' 掩码token=' + masks03.length);

  // ---- AD-08: 探针按钮存在并发出 POST(简报条目 8; 不要求探针成功, 凭据可能无效) ----
  const probeBtn = page.locator('button[onclick="probeLlm(\'default\')"]');
  const btnC = await probeBtn.count();
  await probeBtn.click();
  let probeTxt = '';
  try {
    await page.waitForFunction(() => { const el = document.querySelector('#probe_default'); return !!el && !!el.textContent && el.textContent !== '探测中…'; }, null, { timeout: 25000 });
    probeTxt = scrub(await page.locator('#probe_default').textContent());
  } catch (e) { probeTxt = '(结果区未落地: ' + scrub(String(e.message)).split('\n')[0].slice(0, 70) + ')'; }
  check('AD-08 default profile 探针按钮发出 POST /api/admin/llm/test 且就地结果区落地不崩溃',
    btnC === 1 && probeReqs.length === 1 && probeTxt.length > 0 && (await page.locator('#page .card').count()) === 6,
    '按钮=' + btnC + ' POST次数=' + probeReqs.length + ' 六卡仍在=' + (await page.locator('#page .card').count()) + ' 结果=' + JSON.stringify(probeTxt.slice(0, 60)));

  // ---- AD-04: #/settings 旧入口重定向(简报条目 4, 不 404 不留空页) ----
  phase = 'other';
  await go('#/tasks');
  await page.waitForSelector('#taskTbl', { timeout: 10000 });
  const awayLlmCard = await page.locator('#page .card h3:has-text("LLM 管理中心")').count();
  phase = 'llm';
  await go('#/settings');
  await waitCards(6, 'LLM 管理中心');
  check('AD-04 #/settings 重定向到 #/admin/llm 且六卡完成渲染(旧入口不 404 不留空页)',
    (await getHash()) === '#/admin/llm' && (await page.locator('#page .card').count()) === 6 && awayLlmCard === 0,
    'hash=' + (await getHash()) + ' 跳转前LLM卡=' + awayLlmCard);

  // ---- AD-05/05b: 导航可达(简报条目 5, 靠点击不是手打 hash) ----
  // 红跑修正: 期望串是「LLM 管理中心」(含一个半角空格), 首跑用 replace(/\s+/g,'') 把词内空格也删了导致自我判负;
  // 只 trim 两端, 另加 href 指向与项数钉住判别力(非 admin 侧无入口已由 AD-01d 覆盖)
  const navRaw = await page.locator('.sidebar nav a').allTextContents();
  const navT = navRaw.map(t => t.trim());
  const setHref = await page.getAttribute('.sidebar nav a[data-n="set"]', 'href');
  const robotHref = await page.getAttribute('.sidebar nav a[data-n="robot"]', 'href');
  check('AD-05 admin 侧栏出现「LLM 管理中心」与「机器人管理」两项且 href 指向两页',
    (await page.locator('.sidebar nav a[data-n="set"]').count()) === 1 && (await page.locator('.sidebar nav a[data-n="robot"]').count()) === 1 &&
    navT.includes('LLM 管理中心') && navT.includes('机器人管理') && setHref === '#/admin/llm' && robotHref === '#/admin/robot',
    '实得: ' + JSON.stringify(navT) + ' set=' + setHref + ' robot=' + robotHref);
  await page.click('.sidebar nav a[data-n="robot"]');
  phase = 'robot';
  await waitCards(6, '机器人管理');
  const tt5 = await cardTitles();
  // T7 加第六张「业务机器人接入」→ card 数按实际 5→6; 前五区标题逐项断言原样保留, 第六张也钉标题(否则多出一张任意卡也算过)
  check('AD-05b 点击 data-n="robot" 进入 #/admin/robot 并渲染六区(实效+实例/新增/config 只读/矩阵/白名单/业务接入)',
    (await getHash()) === '#/admin/robot' && tt5.length === 6 && tt5[0].includes('机器人管理') && tt5[1].includes('新增机器人实例') &&
    tt5[2].includes('config.json 回落键') && tt5[3].includes('通知矩阵') && tt5[4].includes('机器人白名单') && tt5[5].includes('业务机器人接入'),
    'hash=' + (await getHash()) + ' 实得: ' + tt5.join(' | '));

  // ---- AD-02b: 明文 key 红线(机器人页, 简报条目 2) ----
  const t02b = await bodyText();
  const plainTok02b = (t02b.match(/access_token=([A-Za-z0-9]{12,})/g) || []).length;
  check('AD-02b #/admin/robot 全文不含 LLM_API_KEY 明文, 且无未掩码的 access_token/secret 明文',
    !t02b.includes(plainKey) && (t02b.match(/sk-[A-Za-z0-9]{6,}/g) || []).length === 0 && plainTok02b === 0,
    '明文命中=' + t02b.includes(plainKey) + ' sk-长片段=' + (t02b.match(/sk-[A-Za-z0-9]{6,}/g) || []).length + ' access_token明文值=' + plainTok02b);

  // ---- AD-06: 通知矩阵八事件每事件一行(简报条目 6) ----
  const EV = ['red_reject', 'judged', 'task_dispatch', 'green_publish', 'archived', 'returned', 'weekly', 'xo_push'];
  const mxTxt = await cardText(3);
  const mxRows = await page.locator('#page .card').nth(3).locator('tbody tr').count();
  const missEv = EV.filter(e => !mxTxt.includes(e));
  check('AD-06 通知矩阵八事件每事件一行且事件名逐个在 DOM 命中',
    mxRows === EV.length && missEv.length === 0, 'tr=' + mxRows + ' 期望=' + EV.length + ' 缺失=' + (missEv.join(',') || '无'));

  // ---- AD-07: 实例区空态 + config 只读区 + 导入按钮(简报条目 7) ----
  // 并发会话可能留下实例, 断言按「进入本页时的实测行数」分两支走, 不写死 0
  const insApi = await call('/api/admin/robot/instances');
  const insBefore = ((insApi.data || {}).instances || []).length;
  const insRowsDom = await page.locator('#page .card').nth(0).locator('tbody tr').count();
  const emptyC = await page.locator('#page .card').nth(0).locator('.empty').count();
  const emptyTxt = emptyC ? await cardText(0) : '';
  const cfgTxt = await cardText(2);
  const cfgVals = ['NOTIFY_WEBHOOK_URL', 'COMMITTEE_WEBHOOK_URL'].map(k => {
    const i = cfgTxt.indexOf(k);
    return k + '→' + (i < 0 ? '(缺键名)' : cfgTxt.slice(i + k.length, i + k.length + 60).replace(/\s+/g, ' ').trim());
  });
  const impBtn = await page.locator('#page button:has-text("导入为停用实例")').count();
  check('AD-07 实例区按现网行数正确呈现(0 行则空态不白屏) + config 只读区两键呈「未配置」或掩码 + 「导入为停用实例」按钮在场',
    ((insBefore === 0 && insRowsDom === 0 && emptyTxt.includes('暂无机器人实例')) || (insBefore > 0 && insRowsDom === insBefore)) &&
    (await page.locator('#page .card').count()) === 6 && t02b.length > 200 &&
    cfgVals.every(v => /未配置|\*{4}/.test(v)) && impBtn === 1,
    'API实例=' + insBefore + ' DOM行=' + insRowsDom + ' 空态=' + JSON.stringify(emptyTxt.slice(0, 24)) + ' ' + cfgVals.join(' / ') + ' 导入按钮=' + impBtn + ' 全文长度=' + t02b.length);

  // ---- AD-03b/03c: 掩码分支夹具(现网 0 实例进不到掩码支, 造一个 enabled=0 的自建实例把它跑到 —— 停用实例永不成为发送目标) ----
  const FXNAME = 'AD-T13 ' + Date.now();
  const FXW = 'https://oapi.dingtalk.com/robot/send?access_token=ADT13PLAINabc1234567890';
  const FXS = 'SEC-ADT13-plain-secret-9876';
  const PLAIN_TOK = 'ADT13PLAINabc1234567890';
  let fxId = null, fxPost = null;
  try {
    fxPost = await call('/api/admin/robot/instances', 'POST', { name: FXNAME, webhook: FXW, secret: FXS, channel: 'notify', env: 'sit', enabled: false });
    fxId = fxPost.data && fxPost.data.id;
    await go('#/');
    await page.waitForTimeout(400);
    await go('#/admin/robot');
    await waitCards(6, '机器人管理');
    const insTxt = await cardText(0);
    const rowsFx = await page.locator('#page .card').nth(0).locator('tbody tr').count();
    const maskHook = /access_token=[A-Za-z0-9_.:+-]{1,8}\*{4}[A-Za-z0-9_.:+-]{1,8}/.test(insTxt);
    const maskSecret = /[A-Za-z0-9_.:+-]{1,8}\*{4}[A-Za-z0-9_.:+-]{1,8}/.test(insTxt.replace(/access_token=[^&\s]*/g, ''));
    check('AD-03b 有实例时 webhook 查询参数值与加签 secret 只以掩码呈现, 明文一律不出现(夹具 POST=' + (fxPost && fxPost.status) + ')',
      fxPost.status === 200 && !!fxId && rowsFx === insBefore + 1 && maskHook && maskSecret && !insTxt.includes(PLAIN_TOK) && !insTxt.includes(FXS) && insTxt.includes(FXNAME.slice(0, 12)),
      '基线行=' + insBefore + ' id=' + fxId + ' 行数=' + rowsFx + ' 掩码webhook=' + maskHook + ' 掩码secret=' + maskSecret +
      ' 明文残留=' + (insTxt.includes(PLAIN_TOK) || insTxt.includes(FXS)) + ' 夹具名可见=' + insTxt.includes(FXNAME.slice(0, 12)));
  } catch (e) {
    check('AD-03b 有实例时 webhook 查询参数值与加签 secret 只以掩码呈现, 明文一律不出现(夹具)', false, 'EX:' + scrub(String(e.message)).split('\n')[0].slice(0, 140));
  } finally {
    if (fxId) {
      phase = 'fixture';
      const d = await call('/api/admin/robot/instances/' + fxId, 'DELETE');
      await go('#/');
      await page.waitForTimeout(400);
      phase = 'robot';
      await go('#/admin/robot');
      await waitCards(6, '机器人管理');
      const rowsAfter = await page.locator('#page .card').nth(0).locator('tbody tr').count();
      const afterTxt = await cardText(0);
      const backEmpty = rowsAfter === insBefore && (insBefore === 0 ? afterTxt.includes('暂无机器人实例') : !afterTxt.includes(FXNAME.slice(0, 12)));
      check('AD-03c 夹具已回收: DELETE 返回 200 且实例区回到基线(夹具残留 0)', d.status === 200 && backEmpty,
        'DELETE=' + d.status + ' 基线行=' + insBefore + ' 回收后行=' + rowsAfter + ' 夹具名仍在=' + afterTxt.includes(FXNAME.slice(0, 12)));
    } else check('AD-03c 夹具已回收: DELETE 返回 200 且实例区回到空态(库内残留 0)', false, '夹具未建成(POST=' + (fxPost && fxPost.status) + '), 无残留');
  }

  // ---- AD-11~15: 业务机器人接入三个页签 + 状态语义 + XSS ----
  phase = 'robot-business';
  const xssTitle = '<img data-rwxss src=x onerror="window.__robotXss=1">AD 外发箱';
  const pmUser = users.find(u => u.role === '项目经理');
  const oppBody = {
    opp_code: xssCode, title: xssTitle, customer: 'AD 客户', region: '华东', province: '江西', biz_line: 'G1',
    contract_amount: 240, opp_stage: '投标决策/投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '否', summary: 'AD-14 XSS 夹具'
  };
  const oppFx = await call('/api/opp', 'POST', oppBody);
  if (!pmUser) throw new Error('缺少项目经理，无法建立外发箱夹具');
  const previewFx = await call('/api/admin/robot/outbox/preview', 'POST', { event: 'review_invite', opp_code: xssCode, target_user_id: pmUser.id });
  const cancelTitle = 'AD 已取消夹具 ' + xssCode;
  const cancelOpp = await call('/api/opp', 'POST', { ...oppBody, opp_code: xssCode + '-CANCEL', title: cancelTitle });
  const cancelPreview = await call('/api/admin/robot/outbox/preview', 'POST', { event: 'review_invite', opp_code: xssCode + '-CANCEL', target_user_id: pmUser.id });
  const cancelId = cancelPreview.data.outbox_id || cancelPreview.data.id;
  const cancel1 = await call('/api/admin/robot/outbox/' + cancelId + '/cancel', 'POST', {});
  const cancel2 = await call('/api/admin/robot/outbox/' + cancelId + '/cancel', 'POST', {});
  // I-1(spec §5.4.4 前端层永久载体): 正文由生产同一个 buildTaskDispatches 生成, 再种一条 task_dispatch 进外发箱,
  // 使「预览必须真把截止提示渲染出来」成为可回归的行为断言——编排器日后丢该字段则正文随之失配, 本条转红而非空转。
  // 与 RW-15 同口径: robot_outbox 是内部发送队列(非业务终态), 本轮 provider 恒未激活且 preview 端点只收 review_invite,
  // HTTP 侧造不出该展示态。种在 go('#/admin/robot') 之前: 页签数据由 renderRobotAdmin 一次取回, 后插的行进不了同一次渲染。
  // opp_code 带本轮前缀, 由文末既有清理分支(xssCode%)删除。
  let seedHint = '';
  try {
    const { buildTaskDispatches } = require('../robot-orchestrator.js');
    const seedRow = buildTaskDispatches({ id: 0, round: 1, title: 'AD 截止提示夹具', opp_code: xssCode + '-DISPATCH' },
      [{ id: 0, dept: '财务BP', ind_name: '付款条件' }], B)[0];
    seedHint = String((seedRow.payload || {}).deadline_hint || '');
    const { DatabaseSync } = require('node:sqlite');
    const sdb = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
    try {
      sdb.exec('PRAGMA busy_timeout=5000');
      if (sdb.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='robot_outbox'").get()) {
        sdb.prepare(`INSERT INTO robot_outbox(opp_code,review_id,task_id,event,target_key,provider,payload_json,status,
          idempotency_key,created_by,created_at,attempts,last_error) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,NULL)`)
          .run(seedRow.opp_code, null, seedRow.task_id, seedRow.event, seedRow.target_key, seedRow.provider,
            JSON.stringify(seedRow.payload), 'preview', seedRow.idempotency_key + ':' + xssCode, null, new Date().toISOString());
      }
    } finally { sdb.close(); }
  } catch (e) { out('AD-16 种子失败:' + scrubSafe(e.message)); }
  await go('#/');
  await page.waitForTimeout(300);
  await go('#/admin/robot');
  await page.waitForTimeout(1000);
  const business = page.locator('#robotBusinessAdmin');
  const businessText = await business.count() ? await business.innerText() : '';
  check('AD-11 机器人管理显示“生成待发送草稿（本地预演）”',
    await business.count() === 1 && businessText.includes('生成待发送草稿（本地预演）'),
    'card=' + await business.count() + ' 文案=' + businessText.includes('生成待发送草稿（本地预演）'));

  const tabState = [];
  for (const key of ['bindings', 'targets', 'outbox']) {
    const tab = business.locator(`[data-rba="${key}"]`);
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(200);
      tabState.push({ key, active: await business.locator('[data-rba].active,[data-rba][aria-selected="true"]').count() });
    } else tabState.push({ key, active: 0 });
  }
  check('AD-12 员工绑定/群目标/外发箱三个页签可点击且各只有一个活动页签',
    tabState.length === 3 && tabState.every(x => x.active === 1), JSON.stringify(tabState));

  const stateText = await business.count() ? await business.innerText() : '';
  const cancelledRow = page.locator('#robotBusinessPane tr').filter({ hasText: cancelTitle });
  const cancelledPills = await cancelledRow.locator('.pill').filter({ hasText: /^已取消$/ }).count();
  // NOT-BEHAVIOURAL(placeholder pending provider activation): P1 failed 行须由真实发送失败产生，当前只守文案。
  check('AD-13 未绑定、preview、failed/cancelled 有明确中文且不伪装“已送达”；真实取消行显示 pill',
    stateText.includes('未绑定') && stateText.includes('仅预演') && stateText.includes('发送失败') && stateText.includes('已取消') && !stateText.includes('已送达') &&
      cancelOpp.status === 200 && cancelPreview.status === 200 && cancel1.status === 200 && cancel2.status === 200 &&
      (cancel1.data.status || (cancel1.data.row || {}).status) === 'cancelled' &&
      (cancel2.data.status || (cancel2.data.row || {}).status) === 'cancelled' && cancelledPills === 1,
    JSON.stringify({ unbound: stateText.includes('未绑定'), preview: stateText.includes('仅预演'), failed: stateText.includes('发送失败'), cancelled: stateText.includes('已取消'), delivered: stateText.includes('已送达'), cancelPreview: cancelPreview.status, cancel1: cancel1.status, cancel2: cancel2.status, cancelledPills }));

  const outboxTab = business.locator('[data-rba="outbox"]');
  if (await outboxTab.count()) { await outboxTab.click(); await page.waitForTimeout(300); }
  const pane = page.locator('#robotBusinessPane');
  const paneText = await pane.count() ? await pane.innerText() : '';
  const paneHtml = await pane.count() ? await pane.innerHTML() : '';
  const xssRan = await page.evaluate(() => window.__robotXss === 1);
  check('AD-14 外发箱 payload 以转义文本渲染，注入 HTML 不执行',
    oppFx.status === 200 && previewFx.status === 200 && paneText.includes('<img data-rwxss') && paneHtml.includes('&lt;img') &&
      await pane.locator('img[data-rwxss]').count() === 0 && !xssRan,
    'opp=' + oppFx.status + ' preview=' + previewFx.status + ' literal=' + paneText.includes('<img data-rwxss') + ' img=' + await pane.locator('img[data-rwxss]').count() + ' ran=' + xssRan);

  // 自证不是空转: seedHint 必须真取到过值(取不到说明编排器没产出该字段, 该红属生产侧)
  check('AD-16 外发箱群消息预览字面含截止提示(spec §5.4.4 前端层)',
    seedHint.length > 0 && paneText.includes(seedHint) && paneHtml.includes(seedHint.slice(0, 6)),
    'hint=' + JSON.stringify(seedHint) + ' 预览命中=' + paneText.includes(seedHint));

  // ---- AD-10: 两页各一张截图(简报条目 10; 沿用 HL/NAV/IA 的 shots/ 落点, PNG 不入 git) ----
  await go('#/admin/llm');
  await waitCards(6, 'LLM 管理中心');
  const s1 = REDMODE ? await page.screenshot({ fullPage: false }) : await page.screenshot({ path: 'shots/H_AD_1_llm_admin.png', fullPage: false });
  await go('#/admin/robot');
  await waitCards(6, '机器人管理');
  const s2 = REDMODE ? await page.screenshot({ fullPage: false }) : await page.screenshot({ path: 'shots/H_AD_2_robot_admin.png', fullPage: false });
  const sz = f => fs.existsSync(f) ? fs.statSync(f).size : 0;
  const persisted = REDMODE || (sz('shots/H_AD_1_llm_admin.png') > 10000 && sz('shots/H_AD_2_robot_admin.png') > 10000);
  check('AD-10 两页各捕获一张 PNG(H_AD_1_llm_admin / H_AD_2_robot_admin)，非 RED 必须落盘', s1.length > 10000 && s2.length > 10000 && persisted,
    'llm=' + s1.length + 'B robot=' + s2.length + 'B' + (REDMODE ? '(内存)' : '(文件)') + ' persisted=' + persisted);

  // ---- AD-09/15: 控制台零错误(挡住「接口 200 但渲染抛错」) ----
  const inPages = a => a.filter(s => /^llm\||^robot\|/.test(s));
  const ce = inPages(consoleErrs), pe = inPages(pageErrs);
  check('AD-09 两页导航渲染期 console.error 与 pageerror 均为空', ce.length === 0 && pe.length === 0,
    'console=' + ce.length + (ce.length ? ' 首条=' + JSON.stringify(ce[0].slice(0, 120)) : '') +
    ' pageerror=' + pe.length + (pe.length ? ' 首条=' + JSON.stringify(pe[0].slice(0, 120)) : ''));
  const businessCe = consoleErrs.filter(s => /^robot-business\|/.test(s));
  const businessPe = pageErrs.filter(s => /^robot-business\|/.test(s));
  check('AD-15 两页新增交互阶段 console.error/pageerror 为零', businessCe.length === 0 && businessPe.length === 0,
    'console=' + businessCe.length + ' pageerror=' + businessPe.length);
  check('AD-09b 全流程(含登录/非 admin/夹具/探针阶段)pageerror 为零', pageErrs.length === 0,
    'pageerror 总数=' + pageErrs.length + (pageErrs.length ? ' 明细=' + JSON.stringify(pageErrs.slice(0, 3)) : ''));

})().catch(e => { out('FAIL:' + scrubSafe(e.message)); fail++; }).finally(async () => {
  try {
    if (browser) await browser.close();
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
    db.exec('PRAGMA busy_timeout=5000; BEGIN');
    try {
      if (db.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='robot_outbox'").get()) {
        db.prepare('DELETE FROM robot_outbox WHERE opp_code LIKE ?').run(xssCode + '%');
      }
      db.prepare('DELETE FROM tasks WHERE review_id IN (SELECT id FROM reviews WHERE opp_code LIKE ?)').run(xssCode + '%');
      db.prepare('DELETE FROM events WHERE review_id IN (SELECT id FROM reviews WHERE opp_code LIKE ?)').run(xssCode + '%');
      db.prepare('DELETE FROM attachments WHERE review_id IN (SELECT id FROM reviews WHERE opp_code LIKE ?)').run(xssCode + '%');
      db.prepare('DELETE FROM agent_messages WHERE review_id IN (SELECT id FROM reviews WHERE opp_code LIKE ?) OR budget_id IN (SELECT id FROM budgets WHERE opp_code LIKE ?)').run(xssCode + '%', xssCode + '%');
      db.prepare('DELETE FROM budget_delivery WHERE budget_id IN (SELECT id FROM budgets WHERE opp_code LIKE ?)').run(xssCode + '%');
      db.prepare('DELETE FROM reviews WHERE opp_code LIKE ?').run(xssCode + '%');
      db.prepare('DELETE FROM budgets WHERE opp_code LIKE ?').run(xssCode + '%');
      db.prepare('DELETE FROM opp_delivery WHERE opp_code LIKE ?').run(xssCode + '%');
      db.prepare('DELETE FROM opps WHERE opp_code LIKE ?').run(xssCode + '%');
      db.exec('COMMIT');
      const remaining = ['opps', 'budgets', 'reviews'].map(t => db.prepare('SELECT COUNT(*) c FROM ' + t + ' WHERE opp_code LIKE ?').get(xssCode + '%').c);
      if (remaining.some(n => n !== 0)) throw new Error('本轮 AD 业务夹具残留');
      out('CLEANUP - ' + xssCode + ' opps/budgets/reviews=' + remaining.join('/'));
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    } finally { db.close(); }
  } catch (e) { out('CLEANUP FAIL:' + scrubSafe(e.message)); fail++; }
  out(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  writeLog(fail);
  process.exitCode = fail === 0 ? 0 : 1;
});

function scrubSafe(m) { try { return String(m).replace(/sk-[A-Za-z0-9]{6,}/g, '[KEY]'); } catch (e) { return String(m); } }
