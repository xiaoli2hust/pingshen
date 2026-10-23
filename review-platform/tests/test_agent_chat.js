// 阶段 2 技能①预算编制对话剧本(桩): A-01~04 / A-08~12 / A-14 + API-16~19(服务运行中)
// 阶段 3 扩展: A-15~A-18 技能②评审表编制 + 技能③预判(POST /api/agent/chat 加 skill='review')
// 用法: node tests/test_agent_chat.js [--log=tests/green_stage3_agent.txt]
// 红绿纪律: 全部用例在旧代码上必 FAIL(POST /api/agent/chat 404 '接口不存在'), 红证据留 tests/red_evidence_stage2.txt
// 桩方案(测试方案 §8.4):
//   - 固定应答桩: 本地 9801 起 HTTP 应答器, 按 user 消息关键字路由返回固定 {"fields":{...}}(带 ```json 围栏, 顺带验证剥围栏)
//   - 拒绝桩: http://127.0.0.1:9 测 A-08 降级(LLM 失败跳过 merge, HTTP 仍 200)
//   - 桩地址只改 config.json 的 LLM_BASE_URL(服务每请求读取即时生效), try/finally 必恢复,
//     REPORT_SECRET/LLM_API_KEY/LLM_MODEL 既有键原样保留
// 锚定数字只取自《测试方案》§3.2(tiandi 十项)与 A-04 剧本(68.2 万/46.6%), 禁止手拍
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const http = require('http');
const path = require('path');
const CFG_PATH = path.join(__dirname, '..', 'config.json');

// ---------- 桩应答器: 9801, 按 user 消息关键字路由(确定性测试工具) ----------
// A-02 剧本"交付处,10 个人月,差旅 2 万" -> dev_pd=220(10 人月×22 工作日, 剧本即 §3.2 的 tiandi 全套)
const STUB_ROUTES = [
  // ---- 机器人工作台 delivery 独立八键路由(优先, 含越权字段验证净化) ----
  [/交付明细|差旅六千/, { rows: [{ content: '数据实施', stage: '实施', pm_pd: 2,
    own_pd: 3, rd_pd: 1, prod_pd: 4, travel_cost: 6000, note: '文字生成',
    cost: 999999, status: 'confirmed', action: 'confirm' }] }],
  // ---- 技能②评审字段路由(优先, 关键字不与技能①消息重叠) ----
  [/毛利率|0\.1508/, { gross_margin: 0.1508 }], // A-18: 小数格式, 验证归一化防线×100
  [/江西省|自然资源/, { customer: '江西省自然资源测绘与监测院', contract_amount: 24, sub_amount: 40, // A-16: 一轮补齐评审必填集
    province: '江西省', secret: '否', jiadao: '否', settle_method: '银行转账', sign_path: '客户→丰图科技',
    product_type: '标品', b2b_scene: '无', revenue_confirm: '一次性确收', promo_target: '无',
    promo_amount: 0, promo_outside: '否', guarantee: '否', non_compete: '否', sub_limit: '否' }],
  // ---- 技能①预算字段路由 ----
  [/合同|240\s*万/, { contract: 2400000, sub_cost: 1000000 }],
  [/交付处|人月|差旅/, { dev_dept: '交付处', dev_pd: 220, del_travel: 20000 }],
  [/80\s*万/, { sub_cost: 800000 }]
];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let said = '';
    try {
      const userMsg = (JSON.parse(body || '{}').messages || []).filter(m => m.role === 'user').map(m => m.content).join('\n');
      // 只路由"用户说："之后文本, 避免草稿 JSON 里的数字/部门名干扰路由
      said = (userMsg.split('用户说：')[1] || userMsg).trim();
    } catch (e) {}
    let fields = {};
    for (const [re, f] of STUB_ROUTES) if (re.test(said)) { fields = f; break; }
    const content = '```json\n' + JSON.stringify({ fields }) + '\n```'; // 带围栏, 验证 extractFields 剥围栏
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});

// ---------- config.json LLM_BASE_URL 临时改写(整体读写, finally 恢复原始字节) ----------
let cfgRaw = null;
const setLLMBase = url => {
  if (cfgRaw === null) cfgRaw = fs.readFileSync(CFG_PATH, 'utf8');
  const cfg = JSON.parse(cfgRaw);
  cfg.LLM_BASE_URL = url;
  // T15: 服务端回落序为 profile > default > env > 顶层 config ⇒ 残留或已配的 profile base 会盖掉本套件指定的顶层地址,
  // 使 A-08「顶层指拒连必降级」变成打到自己桩上的成功轮; 本套件不使用 profile 层, 故写入前摘掉各 profile 的 base(restoreLLM 仍按原始字节复位)
  for (const prof of Object.values(cfg.LLM_PROFILES || {})) if (prof && typeof prof === 'object') delete prof.base;
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
};
const restoreLLM = () => { if (cfgRaw !== null) { fs.writeFileSync(CFG_PATH, cfgRaw, 'utf8'); cfgRaw = null; } };

async function raw(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function api(token, reqPath, method, body) {
  const r = await raw(token, reqPath, method, body);
  if (r.status >= 400) throw new Error(reqPath + ' -> ' + r.status + ' ' + (r.data.error || ''));
  return r.data;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;
const chat = (token, budgetId, message) => raw(token, '/api/agent/chat', 'POST', { budget_id: budgetId, message });
const chatReview = (token, message, reviewId) => raw(token, '/api/agent/chat', 'POST', { skill: 'review', message, ...(reviewId ? { review_id: reviewId } : {}) });
const chatDelivery = (token, oppCode, message) => raw(token, '/api/agent/chat', 'POST', { skill: 'delivery', opp_code: oppCode, message });
// 技能②带入预算(与规则矩阵 GREEN_BUDGET 同源, margin≈41.9 绿)
const REVIEW_BUDGET = {
  contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000,
  project_name: '技能②带入预算', customer: '评审带入客户'
};

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name;
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

(async () => {
  await new Promise(r => stub.listen(9801, '127.0.0.1', r));
  try {
    const sales = await login('sales1');
    const fin = await login('fin1');
    setLLMBase('http://127.0.0.1:9801'); // 指向固定应答桩(§8.4)
    let M = 0;
    let RV = 0; // 技能②评审草稿 id(A-15 建单后供 A-16~18 续用)
    const getBudget = async id => ((await raw(sales, '/api/budget/' + id)).data || {}).budget || {};

    const STEPS = [
      ['A-01', async () => {
        const c = await raw(sales, '/api/budget', 'POST', {});
        M = (c.data || {}).id || 0;
        const r = await chat(sales, M, '合同 240 万，分包 100 万');
        const d = r.data || {};
        check('A-01', '首轮 200', r.status === 200);
        check('API-16', '响应六键结构(reply/draft/calc/missing/actions/degraded)',
          ['reply', 'draft', 'calc', 'missing', 'actions', 'degraded'].every(k => k in d));
        check('A-01', '未降级', d.degraded === false);
        check('A-01', 'reply 含不含税收入 226.4 万', /226\.4/.test(d.reply || ''));
        check('A-01', '缺 3 项清单(交付部门/人天/差旅)',
          JSON.stringify(d.missing || []) === JSON.stringify(['dev_dept', 'dev_pd', 'del_travel']));
        check('A-01', 'draft 更新 contract/sub_cost',
          (d.draft || {}).contract === 2400000 && (d.draft || {}).sub_cost === 1000000);
        check('A-01', 'calc.income 锚定', near((d.calc || {}).income, 2264150.94, 0.01));
      }],

      ['A-02', async () => {
        const r = await chat(sales, M, '交付处，10 个人月，差旅 2 万');
        const d = r.data || {};
        check('A-02', 'missing 清零', (d.missing || []).length === 0);
        const acts = d.actions || [];
        check('A-02', 'actions=[confirm_lock]', acts.length === 1 && acts[0].type === 'confirm_lock');
        const c = d.calc || {};
        check('A-02', 'calc 与 §3.2 一致(十项抽核)',
          near(c.income, 2264150.94, 0.01) && near(c.salesLabor, 241780, 0.01) && near(c.incentive, 76979.17, 1) &&
          near(c.delivery, 393120, 1) && near(c.contribution, 529630.27, 1) && near(c.margin, 41.9, 0.1));
      }],

      ['A-04', async () => { // 多轮修正(draft 未锁定可直接改)
        const r = await chat(sales, M, '把分包改成 80 万');
        const d = r.data || {};
        check('A-04', 'reply 含 68.2 万/46.6%', /68\.2/.test(d.reply || '') && /46\.6/.test(d.reply || ''));
        check('A-04', 'draft.sub_cost=800000', (d.draft || {}).sub_cost === 800000);
        check('A-04', 'calc 重算 contribution/margin', // 锚定=公式实算(A-02 十项已过, sub_cost=800000 变体): 682349.85/46.6038
          near((d.calc || {}).contribution, 682349.85, 1) && near((d.calc || {}).margin, 46.60, 0.05));
      }],

      ['A-09', async () => { // 确认门: 口头"确认锁定"不锁定(LLM 无法映射"确认"到锁定)
        const r = await chat(sales, M, '确认锁定');
        const d = r.data || {};
        check('A-09', '口头确认 200 且不降级', r.status === 200 && d.degraded === false);
        const bd = await getBudget(M);
        check('A-09', '状态仍 draft(人确认门)', bd.status === 'draft');
        check('A-09', 'reply 引导点按钮', /按钮|确认锁定/.test(d.reply || ''));
      }],

      ['A-03', async () => { // 走 actions 里的 lock 端点(按钮)
        const r2 = await chat(sales, M, '交付处，10 个人月，差旅 2 万'); // 重新取 actions(幂等)
        const act = ((r2.data || {}).actions || []).find(a => a.type === 'confirm_lock');
        if (!act || !act.endpoint) { check('A-03', '缺 confirm_lock action', false); return; }
        await api(sales, `/api/budget/${M}/delivery`, 'PUT', { rows: [{ content: 'A-03 回归明细(附3递进门禁)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
        const l = await raw(sales, act.endpoint, 'POST', {});
        const bd = await getBudget(M);
        check('A-03', '调 lock 端点 200 且 locked', l.status === 200 && bd.status === 'locked');
        const ms = ((await raw(sales, '/api/budget/' + M + '/messages')).data || {}).messages || [];
        check('A-03', 'agent_messages 有确认轮记录', ms.some(m => /锁定/.test(m.content || '')));
      }],

      ['A-10', async () => { // 锁定后对话: 提示走 newversion, fields 不变
        const r = await chat(sales, M, '再改改分包价格');
        const d = r.data || {};
        check('A-10', '提示走 newversion', r.status === 200 && /新版本|newversion/.test(d.reply || ''));
        const bd = await getBudget(M);
        check('A-10', 'fields 不变', ((bd.fields || {}).sub_cost === 800000) && bd.status === 'locked');
      }],

      ['A-12', async () => { // 留痕回放: 每轮 user+assistant 成对
        const ms = ((await raw(sales, '/api/budget/' + M + '/messages')).data || {}).messages || [];
        const users = ms.filter(m => m.role === 'user').length;
        const assistants = ms.filter(m => m.role === 'assistant').length;
        check('A-12', '每轮 user+assistant 成对可按序回放',
          users >= 5 && assistants >= 5 && ms[0] && ms[0].role === 'user');
      }],

      ['A-14', async () => { // 会话续接: 重新打开同单, draft+calc 回显不丢上下文
        const bd = await getBudget(M);
        check('A-14', '回显 draft+calc', ((bd.fields || {}).sub_cost === 800000) && near((bd.calc || {}).margin, 46.59, 0.05));
        const ms = ((await raw(sales, '/api/budget/' + M + '/messages')).data || {}).messages || [];
        check('A-14', '历史消息回显', ms.some(m => /合同 240 万/.test(m.content || '')));
      }],

      ['A-11/API-19', async () => {
        const r = await chat(fin, M, '合同 240 万');
        check('A-11/API-19', '非该单 owner chat 403', r.status === 403);
      }],

      ['API-18', async () => {
        const r = await chat(sales, 999999, '你好');
        check('API-18', 'budget 不存在 404', r.status === 404);
      }],

      ['API-17/A-13', async () => {
        const r = await chat(sales, M, '');
        check('API-17/A-13', '空消息 400', r.status === 400);
      }],

      ['A-08', async () => { // 拒绝桩降级: LLM 失败跳过 merge, HTTP 仍 200
        setLLMBase('http://127.0.0.1:9');
        try {
          const e = await raw(sales, '/api/budget', 'POST', {});
          const bid = (e.data || {}).id || 0;
          const r = await chat(sales, bid, '合同 240 万，分包 100 万');
          const d = r.data || {};
          check('A-08', '降级仍 HTTP 200', r.status === 200);
          check('A-08', 'degraded=true', d.degraded === true);
          check('A-08', 'missing 数组完整(5 项)', (d.missing || []).length === 5);
          const bd = await getBudget(bid);
          check('A-08', 'LLM 失败跳过 merge(fields 不变)', Object.keys(bd.fields || {}).length === 0);
          check('A-08', 'reply 为点选补齐引导', /补齐|输入/.test(d.reply || ''));
        } finally { setLLMBase('http://127.0.0.1:9801'); }
      }],

      ['A-DL', async () => {
        const code = 'PL-A-DL-' + Date.now();
        const oc = await raw(sales, '/api/opp', 'POST', {
          opp_code: code, title: 'Agent delivery 永久用例', customer: 'A-DL 客户', region: '华东', province: '江西',
          biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策', sign_date: '2026-12-31',
          sales: '王超', pm: '', survey: '否', summary: 'A-DL 口头确认不迁移状态'
        });
        await raw(sales, `/api/opp/${encodeURIComponent(code)}/delivery`, 'PUT', { rows: [{ content: '原草稿', stage: '实施', own_pd: 1 }] });
        const r = await chatDelivery(sales, code, '交付明细：数据实施，差旅六千');
        const rows = (((r.data || {}).draft || {}).rows || []);
        const keys = rows[0] ? Object.keys(rows[0]) : [];
        check('A-DL', 'skill=delivery HTTP 200 且只回八键', oc.status === 200 && r.status === 200 && rows.length === 1 &&
          JSON.stringify(keys) === JSON.stringify(['content', 'stage', 'pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost', 'note']));
        check('A-DL', 'LLM 越权 cost/status/action 全丢弃', rows.length === 1 && rows[0].cost === undefined && rows[0].status === undefined && rows[0].action === undefined);
        const confirm = await chatDelivery(sales, code, '确认交付预算');
        const saved = (await raw(sales, `/api/opp/${encodeURIComponent(code)}/delivery`)).data.delivery || {};
        check('A-DL', '口头“确认”仍 HTTP 200 且 opp_delivery.status=draft', confirm.status === 200 && saved.status === 'draft');
      }],

      // ---- 阶段 3: 技能②评审表编制 + 技能③预判(A-15~A-18, skill='review') ----
      ['A-15', async () => { // 技能②建单: 预算字段带入 + 必填缺失清单
        const bg = (await api(sales, '/api/budget', 'POST', { project_name: '技能②带入预算' })).id;
        await api(sales, `/api/budget/${bg}`, 'PUT', { fields: REVIEW_BUDGET });
        await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'A-15 回归明细(附3递进门禁)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
        await api(sales, `/api/budget/${bg}/lock`, 'POST');
        const bd = await getBudget(bg);
        const r = await chatReview(sales, `用 ${bd.code} 建投标评审单`);
        const d = r.data || {};
        RV = d.review_id || 0;
        check('A-15', '建单轮 200 且返回 review_id', r.status === 200 && typeof RV === 'number' && RV > 0);
        check('A-15', '预算字段带入(contract 240 万/customer/sub_amount)',
          (d.draft || {}).contract_amount === 240 && (d.draft || {}).customer === '评审带入客户' && (d.draft || {}).sub_amount === 100);
        check('A-15', '返回评审必填缺失清单(含 province, ≥5 项)',
          Array.isArray(d.missing) && d.missing.includes('province') && d.missing.length >= 5);
        check('A-15', 'reply 含评审草稿与单号引导', /评审|缺失|清单/.test(d.reply || ''));
      }],

      ['A-16', async () => { // 技能②口述补充: 一轮补齐必填集
        const r = await chatReview(sales, '客户江西省自然资源测绘与监测院，合同 24 万', RV);
        const d = r.data || {};
        check('A-16', '评审字段更新(customer/contract_amount)',
          (d.draft || {}).customer === '江西省自然资源测绘与监测院' && (d.draft || {}).contract_amount === 24);
        check('A-16', '必填清单清零', Array.isArray(d.missing) && d.missing.length === 0);
      }],

      ['A-17', async () => { // 技能③预判: dry-run judge 摘要(确定性代码, 不进 LLM)
        const r = await chatReview(sales, '预判一下灯', RV);
        const d = r.data || {};
        const pv = d.preview || {};
        check('A-17', '预判返回灯色+路由+风险项', typeof pv.light === 'string' && typeof pv.route === 'string' && Array.isArray(pv.items));
        check('A-17', 'reply 含灯色与风险项摘要', /灯/.test(d.reply || '') && /分包占比/.test(d.reply || '')); // sub 40/24=166% 过单
      }],

      ['A-18', async () => { // 技能②毛利率归一化防线: 0.1508 -> 15.08(发现#2 防线)
        const r = await chatReview(sales, '毛利率 0.1508', RV);
        const d = r.data || {};
        check('A-18', '小数格式自动×100 归一化', (d.draft || {}).gross_margin === 15.08);
      }]
    ];

    for (const [id, fn] of STEPS) {
      try { await fn(); } catch (e) { check(id, '流程异常:' + e.message, false); }
    }
  } finally {
    restoreLLM(); // config.json 必恢复(含 REPORT_SECRET/LLM_* 既有键)
    stub.close();
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  console.log('config.json LLM_BASE_URL 已恢复');
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { restoreLLM(); stub.close(); console.error('FAIL:', e.message); process.exit(1); });
