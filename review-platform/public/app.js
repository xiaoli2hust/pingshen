// 项目评审平台 MVP - 前端 SPA
const $ = s => document.querySelector(s);
const app = $('#app');
let ME = null, META = null, FIXTURE_RE = null;

async function loadMeta() {
  META = await api('/api/meta/fields');
  FIXTURE_RE = new RegExp(META.fixtureCodePattern);
}
function visibleRows(rows) {
  return localStorage.incFixture === '1' ? rows : rows.filter(r => !FIXTURE_RE.test(String(r.opp_code || '')));
}
function evidenceDepts() {
  return [...new Set(Object.values(META.indEvidence).flat().map(i => i.dept))];
}
function toggleFixtures(on) {
  localStorage.incFixture = on ? '1' : '0';
  render();
}

const TYPE_NAMES = { presale: '售前立项评审', bid: '投标决策评审', change: '项目关键事项决策' };
const STATUS = {
  draft: ['草稿', 'p-gray'], reviewing: ['前置评审中', 'p-blue'], returned: ['退回修改', 'p-yellow'],
  judged: ['已研判', 'p-purple'], archived: ['已归档', 'p-green']
};
const LIGHT = { green: ['绿灯', 'p-green'], yellow: ['黄灯', 'p-yellow'], red: ['红灯', 'p-red'], none: ['历史未评', 'p-purple'] };

// ---- V4.0 T7 待评审商机要素 FE 注册表(spec §4.2) ----
// 键集与服务端同源: server.js OPP_FIELDS(12 可写列) + 商机代码 = 本表 13 项; req:1 共 8 项 = server.js OPP_REQUIRED(7 键) + opp_code。
// opp_code 的 req 标记只服务建档首屏拦截: POST /api/opp 的形态正则先于 missing 扫描, 商机代码走另一条 400 文案、永不进 missing[](D-33)
const OPP_F = [
  { k: 'opp_code', l: '商机代码', req: 1, ph: '如 PL00008572', full: 1 },
  { k: 'title', l: '项目名称', req: 1, full: 1 },
  { k: 'customer', l: '客户名称', req: 1 },
  { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
  { k: 'contract_amount', l: '预计合同金额(万元)', t: 'number', req: 1 },
  { k: 'opp_stage', l: '商机阶段', req: 1 },
  { k: 'sales', l: '销售经理', req: 1 },
  { k: 'region', l: '营销区域' },
  { k: 'province', l: '省份' },
  { k: 'sign_date', l: '预计签单时间', t: 'date' },
  { k: 'pm', l: '项目经理' },
  { k: 'survey', l: '是否涉及测绘(外业采集或地图)', t: 'select', o: ['否', '是'] },
  { k: 'summary', l: '项目概述', t: 'textarea', full: 1, req: 1 },
];

// ---- 表单字段配置(源自评审规则 Excel Part A) ----
const FIELDS = {
  presale: [
    { k: 'opp_code', l: '商机代码' }, { k: 'customer', l: '客户名称', req: 1 },
    { k: 'opp_stage', l: '商机阶段' }, { k: 'region', l: '营销区域' },
    { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
    { k: 'contract_amount', l: '预计合同金额(万元)', t: 'number', req: 1 },
    { k: 'sign_date', l: '预计签单时间', t: 'date', req: 1 },
    { k: 'sales', l: '销售经理' }, { k: 'pm', l: '项目经理' },
    { k: 'survey', l: '是否涉及测绘(外业采集或地图)', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'sub_early_flag', l: '是否涉及分包提前进场', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'presale_invest', l: '预计售前投入成本(万元)', t: 'number', req: 1 },
    { k: 'presale_period', l: '预计售前实施周期(月)', t: 'number', req: 1 },
    { k: 'summary', l: '项目概述', t: 'textarea', full: 1, req: 1 }
  ],
  bid: [
    { k: 'opp_code', l: '商机代码' }, { k: 'opp_stage', l: '商机阶段' },
    { k: 'region', l: '营销区域' }, { k: 'customer', l: '最终客户名称', req: 1 },
    { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
    { k: 'contract_amount', l: '预计合同金额(万元)', t: 'number', req: 1 },
    { k: 'sales', l: '销售经理' }, { k: 'pm', l: '项目经理' },
    { k: 'sign_date', l: '预计签单时间', t: 'date' },
    { k: 'gross_margin', l: '预计贡献毛利率(%)', t: 'number', req: 1 },
    { k: 'cost_happened', l: '项目已发生成本(万元)', t: 'number' },
    { k: 'ops_years', l: '项目运维周期(年)', t: 'number', req: 1 },
    { k: 'sign_path', l: '签约路径', full: 1, ph: '示例:A公司→B公司→丰图科技(深圳)有限公司', req: 1 },
    { k: 'sub_amount', l: '分包总金额(万元)', t: 'number' },
    { k: 'designated_sub_amount', l: '指定类分包金额(万元)', t: 'number' },
    { k: 'survey_sub_amount', l: '测绘类分包金额(万元)', t: 'number' },
    { k: 'sub_core', l: '分包是否涉及公司核心能力', t: 'select', o: ['否', '是'] },
    { k: 'survey', l: '是否涉及测绘', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'jiadao', l: '是否涉及甲导资质', t: 'select', o: ['否', '是'] },
    { k: 'secret', l: '是否涉密项目', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'province', l: '项目所在地省份', ph: '如:江西省' },
    { k: 'product_type', l: '产品售卖类型', t: 'select', o: ['非标品', '标品'] },
    { k: 'promo_target', l: '项目推广激励面向对象', t: 'select', o: ['无', '内部', '外部', '均包含'] },
    { k: 'promo_amount', l: '项目推广激励金额(万元)', t: 'number' },
    { k: 'promo_outside', l: '是否存在SF体系外条款激励', t: 'select', o: ['否', '是'] },
    { k: 'settle_method', l: '结算方式', ph: '如:银行转账 / 电汇 / 3个月内银行承兑汇票', req: 1 },
    { k: 'payback_time', l: '预计回款时间', ph: '如:预计26年Q4回款40%,27年Q2回款60%' },
    { k: 'b2b_scene', l: '合同背靠背场景', ph: '如:回款+验收=全部背靠背' },
    { k: 'revenue_confirm', l: '确收方式及预估确收时间', ph: '如:一次性确收,预计27年Q1' },
    { k: 'guarantee', l: '合同是否存在担保', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'non_compete', l: '合同是否存在竞业条款', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'sub_limit', l: '合同是否有转包限制', t: 'select', o: ['否', '是'] },
    { k: 'payment_terms', l: '付款条件(写明合同条款)', t: 'textarea', full: 1, req: 1 },
    { k: 'summary', l: '项目概述', t: 'textarea', full: 1, req: 1 },
    { k: 'data_review', l: '是否涉及数据评审', t: 'select', o: ['否', '是'], req: 1 },
    { k: 'data_plan', l: '预期实现方式(涉及数据评审时填)', t: 'textarea', full: 1 },
    { k: 'data_content', l: '数据交付字段/内容(涉及数据评审时填)', t: 'textarea', full: 1 },
    { k: 'data_compliance', l: '数据合规性审查内容(涉及数据评审时填)', t: 'textarea', full: 1 }
  ],
  change: [
    { k: 'proj_code', l: '项目代码' }, { k: 'sales', l: '销售经理' },
    { k: 'pm', l: '项目经理' }, { k: 'customer', l: '最终客户' },
    { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
    { k: 'region', l: '营销区域' },
    { k: 'proj_stage', l: '项目阶段', t: 'select', o: ['实施中', '运维中'], req: 1 },
    { k: 'change_type', l: '决策事项类型', t: 'select', o: ['签单与投标决策差异', '项目成本变动', '验收单异常', '分包变化', '项目核减', '坏账', '项目非正常终止', '其他'], req: 1 },
    { k: 'old_contract_amount', l: '原合同金额(万元)', t: 'number' },
    { k: 'old_gross_margin', l: '原贡献毛利率(%)', t: 'number' },
    { k: 'new_contract_amount', l: '变更后合同金额(万元)', t: 'number' },
    { k: 'new_gross_margin', l: '变更后贡献毛利率(%)', t: 'number' },
    { k: 'old_sub_amount', l: '原分包金额(万元)', t: 'number' },
    { k: 'new_sub_amount', l: '变更后分包金额(万元)', t: 'number' },
    { k: 'old_delivery_cost', l: '原交付成本(万元)', t: 'number' },
    { k: 'new_delivery_cost', l: '变更后交付成本(万元)', t: 'number' },
    { k: 'old_sales_cost', l: '原销售成本(万元)', t: 'number' },
    { k: 'new_sales_cost', l: '变更后销售成本(万元)', t: 'number' },
    { k: 'over_pay', l: '是否涉及分包合同超进度支付', t: 'select', o: ['否', '是'] },
    { k: 'path_change', l: '是否涉及签约路径变化', t: 'select', o: ['否', '是'] },
    { k: 'delivery_change', l: '是否涉及交付内容变化', t: 'select', o: ['否', '是'] },
    { k: 'summary', l: '决策事项概述', t: 'textarea', full: 1, req: 1 }
  ]
};

// ---- API ----
function invalidateApiCache() {
  if (!window._pgCache) return;
  Object.keys(window._pgCache).forEach(k => {
    if (/^\/api\/(opp\/|reviews(?:\/|\?|$)|budget(?:\/|\?|$)|tasks(?:\/|\?|$)|robot\/outbox)/.test(k)) delete window._pgCache[k];
  });
}
async function api(path, method, body) {
  const r = await fetch(path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (localStorage.token || '') },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || '请求失败');
  if ((method || 'GET').toUpperCase() !== 'GET') invalidateApiCache();
  return d;
}

// ---- 公共组件 ----
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pill = (txt, cls) => `<span class="pill ${cls}">${txt}</span>`;
const statusPill = s => { const [t, c] = STATUS[s] || [s, 'p-gray']; return pill(t, c); };
const lightPill = l => l ? pill(...(LIGHT[l] || [l, 'p-gray'])) : '';
// 站内导航栈(用户验收 2026-10-20「返回上一步」): 记录真实渲染路由; 旧重定向源不记; 同页面变体(?t= 收敛 / #/agent?opp=)替换栈顶不累加
function navRecord() {
  const h = location.hash || '#/';
  if (h === '#/reviews' || h.startsWith('#/reviews?') || h.startsWith('#/settings')) return;
  const st = window._navStack = window._navStack || [];
  if (st[st.length - 1] === h) return;
  const base = s => s.split('?')[0];
  if (st.length && base(st[st.length - 1]) === base(h)) { st[st.length - 1] = h; return; }
  st.push(h);
  if (st.length > 40) st.shift();
}
// 返回上一步: 栈里有来路回来路, 无来路(书签直达/刷新)落调用方给定的固定父级
function goBack(fallback) {
  const st = window._navStack || [];
  if (st.length >= 2) { st.pop(); location.hash = st[st.length - 1]; }
  else location.hash = fallback;
}
function goBackEl(ev, el) { ev.preventDefault(); goBack(el.getAttribute('href')); }
function crumbBar(href, parent, current) {
  return `<nav class="crumb-bar" aria-label="页面路径">
    <a class="btn sm" href="${href}" onclick="goBackEl(event,this)">← ${esc(parent)}</a>
    <span><a href="${href}">${esc(parent)}</a> › <b>${esc(current || '')}</b></span>
  </nav>`;
}
const fmtT = t => t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '';
function toast(msg, err) {
  const d = document.createElement('div');
  d.className = 'toast' + (err ? ' err' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
function render() {
  const h = location.hash || '#/';
  if (!ME) return renderLogin();
  // 闪烁修复: shell(侧边栏)只建一次, 后续仅刷新内容区与导航高亮——
  // 整页 innerHTML 重建会在深色主题下闪黑(点击筛选/搜索时尤其明显)
  if (!$('#app .app-shell')) renderShell(); else navHighlight();
  renderRoute(h);
}
// 路由分发(render 与筛选原地重渲染共用)
function renderRoute(h) {
  navRecord();
  if (h === '#/reviews' || h.startsWith('#/reviews?')) { location.hash = '#/opps'; return; } // 旧评审单列表并入商机列表(spec §4)
  if (h.startsWith('#/opps')) renderOppsList();
  else if (/^#\/opp\/([^/]+)\/r\/(\d+)$/.test(h)) { const m = h.match(/^#\/opp\/([^/]+)\/r\/(\d+)$/); renderDetail(m[2], decodeURIComponent(m[1])); } // L2 实例视图(spec 2026-10-19 §7), 须先于 #/opp/ 判定
  else if (h.startsWith('#/opp/')) renderOpp360(h.split('?')[0].split('/')[2]);
  else if (h.startsWith('#/tasks')) renderTasksCenter();
  else if (h.startsWith('#/judge')) renderJudgeBoard();
  else if (h.startsWith('#/new')) { const q = new URLSearchParams(h.split('?')[1] || ''); renderForm(h.split('?')[0].split('/')[2], null, q.get('opp') || '', q.get('budget') || ''); }
  else if (h.startsWith('#/agent')) renderAgent();
  else if (h.startsWith('#/budgets')) renderBudgets();
  else if (h.startsWith('#/budget-detail/')) renderBudgetDetail(h.split('/')[2]);
  else if (h.startsWith('#/delivery/')) renderDeliveryPage(h.split('/')[2]);
    else if (h.startsWith('#/settings')) { location.hash = '#/admin/llm'; return; } // T4 旧入口并入 LLM 管理中心
    else if (h.startsWith('#/admin/llm')) renderLlmAdmin();
    else if (h.startsWith('#/admin/robot')) renderRobotAdmin();
    else if (h.startsWith('#/parser-lab')) renderParserLab();
  else if (h.startsWith('#/budget/')) renderBudget(h.split('/')[2]);
  else if (/^#\/review\/(\d+)\/edit$/.test(h)) { const eid = h.match(/^#\/review\/(\d+)\/edit$/)[1]; api('/api/reviews/' + eid).then(d => renderForm(d.review.type, Number(eid))).catch(e => toast(e.message, 1)); }
  else if (h.startsWith('#/review/')) renderDetail(h.split('/')[2], null);
  else if (h.startsWith('#/archive')) renderArchive();
  else renderHome();
}
function renderShell() {
  // Executive 风侧边栏壳(nav 标签与链接结构保留, H 脚本选择器兼容)
  app.innerHTML = `
  <div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">评</div>
      <div class="brand-copy"><b>项目评审平台</b><span>REVIEW CONSOLE</span></div>
    </div>
    <nav>
      <a href="#/" data-n="home">首页</a>
      <a href="#/opps" data-n="opps">${['销售支持组', 'admin'].includes(ME.role) ? '全部商机' : ['销售经理', '项目经理', '财务BP'].includes(ME.role) ? '我的商机' : '相关商机'}</a>
      ${['销售经理', '项目经理', '销售支持组', 'admin'].includes(ME.role) ? `<a href="#/budgets" data-n="budgets">${['销售支持组', 'admin'].includes(ME.role) ? '全部预算单' : '我的预算单'}</a>` : ''}
      ${['销售经理', '项目经理', '财务BP'].includes(ME.role) ? '<a href="#/new" data-n="new">新建待评审商机</a>' : ''}
      ${!['销售经理', '项目经理'].includes(ME.role) ? '<a href="#/tasks" data-n="tasks">待办打灯</a>' : ''}
      ${(ME.role === '销售支持组' || ME.role === 'admin') ? `
      <a href="#/judge" data-n="judge">研判台</a>
      <a href="#/archive" data-n="arc">归档库</a>
      <a href="#/parser-lab" data-n="lab">解析器实验室</a>
      ${ME.role === 'admin' ? '<a href="#/admin/llm" data-n="set">LLM 管理中心</a><a href="#/admin/robot" data-n="robot">机器人管理</a>' : ''}` : ''}
    </nav>
    <div class="who"><b>${esc(ME.name)}</b> · ${esc(ME.role)}<br><a href="javascript:logout()">退出登录</a>
      ${['销售支持组', 'admin'].includes(ME.role) ? `<label style="display:block;margin-top:10px"><input id="fxToggle" type="checkbox" ${localStorage.incFixture === '1' ? 'checked' : ''} onchange="toggleFixtures(this.checked)"> 含测试数据</label>` : ''}
    </div>
  </aside>
  <div class="wrap" id="page"></div>
  </div>`;
  navHighlight();
}
// 导航高亮(shell 复用时仅刷 on 状态, 不重建 DOM)
function navHighlight() {
  const h = location.hash || '#/';
  document.querySelectorAll('.sidebar nav a').forEach(a => {
    const n = a.dataset.n;
    a.classList.remove('on');
    if ((n === 'home' && (h === '#/' || h === '')) || (n === 'new' && h.startsWith('#/new'))
      || (n === 'arc' && h.startsWith('#/archive')) || (n === 'set' && h.startsWith('#/admin/llm')) || (n === 'robot' && h.startsWith('#/admin/robot'))
      || (n === 'tasks' && h.startsWith('#/tasks')) || (n === 'judge' && h.startsWith('#/judge')) || (n === 'lab' && h.startsWith('#/parser-lab'))
      || (n === 'budgets' && h.startsWith('#/budgets'))
      || (n === 'opps' && (h.startsWith('#/opps') || h.startsWith('#/opp/') || h.startsWith('#/review/') || h.startsWith('#/budget/') || h.startsWith('#/budget-detail/') || h.startsWith('#/delivery/')))) a.classList.add('on');
  });
}
function logout() { localStorage.clear(); ME = META = FIXTURE_RE = null; window._pgCache = {}; window._navStack = []; window._taskRows = []; window._taskS = null; window._oppF = null; window._budF = null; window._arcF = null; window._queueExpand = null; RBA = null; location.hash = '#/'; render(); }

// ---- O4: 列表筛选条(类型 tab + 商机代码/项目搜索, 客户端过滤; 归档含时代 tab) ----
function arcFilterBar(key, rows, withEra) {
  const st = window['_' + key] || (window['_' + key] = { type: '', q: '', era: '' });
  const tp = [['', '全部类型'], ['bid', TYPE_NAMES.bid], ['presale', TYPE_NAMES.presale], ['change', TYPE_NAMES.change]];
  const er = [['', '全部时代'], ['online', '在线'], ['history', '历史']];
  return `<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center">
    ${tp.map(([k, l]) => `<button class="btn sm${st.type === k ? ' pri' : ''}" onclick="setFlt('${key}','type','${k}')">${l}</button>`).join('')}
    ${withEra ? er.map(([k, l]) => `<button class="btn sm${st.era === k ? ' pri' : ''}" onclick="setFlt('${key}','era','${k}')">${l}</button>`).join('') : ''}
    <input placeholder="商机代码/项目名搜索" value="${esc(st.q)}" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:6px 10px;font-size:12.5px;background:var(--control-bg);color:var(--text-1);width:190px" oninput="setFltQ('${key}',this.value)">
  </div>`;
}
function setFlt(key, field, val) { window['_' + key] = { ...(window['_' + key] || {}), [field]: val }; rerenderPage(); }
function setFltQ(key, q) {
  const st = window['_' + key] || (window['_' + key] = {});
  st.q = q;
  clearTimeout(window['_' + key + 't']);
  window['_' + key + 't'] = setTimeout(rerenderPage, 300);
}
// 筛选/搜索原地重渲染: 不重建 shell、不清内容区——数据走 30s 缓存, innerHTML 一次性替换(无加载中闪)
function rerenderPage() {
  if (!ME) return;
  renderRoute(location.hash || '#/');
}
function fltHit(r, st) {
  if (st.type && r.type !== st.type) return false;
  if (st.era && (r.era || 'online') !== st.era) return false;
  if (st.q) { const q = st.q.trim().toUpperCase(); if (!((r.opp_code || '').toUpperCase().includes(q) || (r.title || '').toUpperCase().includes(q))) return false; }
  return true;
}

// ---- 登录 ----
function renderLogin() {
  app.innerHTML = `
  <div class="login-wrap"><div class="login-panel">
    <div class="login-brand">
      <div class="brand-mark" style="width:52px;height:52px;font-size:22px;border-radius:14px">评</div>
      <h1>项目评审平台</h1>
      <div class="sub">信息收集 · 前置评审 · 红黄绿灯研判 · 归档</div>
    </div>
    <div class="f-item"><label>用户名</label><input id="lu" value=""></div>
    <div class="f-item"><label>密码</label><input id="lp" type="password" value=""></div>
    <button class="btn pri" style="width:100%" onclick="doLogin()">登 录</button>
    <div class="err" id="lerr"></div>
    <div class="hint" id="demoHint" style="display:none">演示账号(密码均 123456):<br>
    sales1 销售经理 | pm1 项目经理 | zhichizu 销售支持组<br>
    fde1 FDE | fin1 财务BP | pur1 采购BP | legal1 法务 | comp1 合规BP</div>
  </div></div>`;
  $('#lp').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  // 审查整改#13: 演示提示由服务端 DEMO_HINT 控制(生产部署置 false 隐藏)
  fetch('/api/public-config').then(r => r.json()).then(d => { if (d.demo_hint) { const h = $('#demoHint'); if (h) h.style.display = ''; } }).catch(() => {});
}
async function doLogin() {
  try {
    const d = await api('/api/login', 'POST', { username: $('#lu').value.trim(), password: $('#lp').value });
    localStorage.token = d.token;
    window._pgCache = {}; window._navStack = [];
    await loadMeta();
    ME = d.user; location.hash = '#/'; render();
  } catch (e) { $('#lerr').textContent = e.message; }
}

// ---- 首页(spec §2.4): 我的待办一条队列 + 指标卡, 替代双评审列表工作台 ----
// 零依赖可视化基元: sparkline(近 N 周建单量, 内联 SVG) + 灯色分布条(纯 CSS)
function sparklineSVG(vals, w = 200, h = 34) {
  if (!vals.length) return '';
  const max = Math.max(...vals, 1);
  const step = vals.length > 1 ? (w - 12) / (vals.length - 1) : 0;
  const y = v => h - 7 - (v / max) * (h - 14);
  const pts = vals.map((v, i) => `${6 + i * step},${y(v).toFixed(1)}`);
  const last = pts[pts.length - 1].split(',');
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polygon points="${pts.join(' ')} 6,${h - 2} ${w - 6},${h - 2}"/>
    <polyline points="${pts.join(' ')}"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.6"/></svg>`;
}
function weeklyCounts(reviews, weeks = 8) { // 近 N 周每周建单量(含当前周)
  const now = Date.now();
  const wk = 7 * 86400000;
  const buckets = new Array(weeks).fill(0);
  for (const r of reviews) {
    if (!r.created_at) continue;
    const diff = now - new Date(r.created_at).getTime();
    if (diff < 0 || diff >= weeks * wk) continue;
    buckets[weeks - 1 - Math.floor(diff / wk)]++;
  }
  return buckets;
}
function lightDistBar(reviews) { // 红黄绿/未研判分布条 + 图例
  const n = t => reviews.filter(r => r.light === t).length;
  const g = n('green'), y = n('yellow'), r = n('red'), u = reviews.length - g - y - r;
  const pct = reviews.length ? (v => (v / reviews.length * 100).toFixed(1) + '%') : (v => '0%');
  return `<div class="dist-bar">
    <i class="seg-green" style="width:${pct(g)}"></i><i class="seg-yellow" style="width:${pct(y)}"></i>
    <i class="seg-red" style="width:${pct(r)}"></i><i class="seg-gray" style="width:${pct(u)}"></i>
  </div>
  <div class="dist-legend">
    <span class="lg lg-green">绿灯 <b>${g}</b></span><span class="lg lg-yellow">黄灯 <b>${y}</b></span>
    <span class="lg lg-red">红灯 <b>${r}</b></span><span class="lg lg-gray">待研判 <b>${u}</b></span>
    <span style="margin-left:auto">共 <b>${reviews.length}</b> 单</span>
  </div>`;
}
// 30s 只读缓存(GET): 筛选原地重渲染用——命中时同步返回, 无网络无加载中闪
function peekCached(path) {
  const c = (window._pgCache || {})[path];
  if (c && Date.now() - c.t < 30000) return JSON.parse(JSON.stringify(c.d));
  return null;
}
async function apiCached(path) {
  window._pgCache = window._pgCache || {};
  const c = window._pgCache[path];
  if (c && Date.now() - c.t < 30000) return JSON.parse(JSON.stringify(c.d));
  const d = await api(path);
  window._pgCache[path] = { t: Date.now(), d: JSON.parse(JSON.stringify(d)) };
  return d;
}
// 加载中只写空页(重渲染保留旧内容直到新 innerHTML 一次性替换——消除中间态闪)
function showLoading(page) {
  if (!page.children.length || page.querySelector('.empty')) page.innerHTML = '<div class="empty">加载中…</div>';
}
async function renderHome() {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash;
  const isSales = ['销售经理', '项目经理', '财务BP'].includes(ME.role);
  const isReviewer = ['FDE', '财务BP', '采购BP', '法务', '合规BP', '数据BP'].includes(ME.role);
  const isSupport = ME.role === '销售支持组' || ME.role === 'admin';
  const [mine, tasks, all, budgetList] = await Promise.all([
    apiCached('/api/reviews?scope=mine'),
    apiCached('/api/tasks?scope=mine'),
    apiCached('/api/reviews?scope=all'),
    isSales ? apiCached('/api/budget') : {}
  ]);
  if ((location.hash || '#/') !== '#/') return; // 竞态守卫
  const myReviews = visibleRows(mine.reviews || []);
  const myTasks = visibleRows(tasks.tasks || []);
  window._taskRows = myTasks;
  const allR = visibleRows(all.reviews || []);
  const waitJudge = allR.filter(r => r.status === 'reviewing');
  const yellowMeet = allR.filter(r => r.status === 'judged');
  const myOppCount = new Set(myReviews.map(r => r.opp_code || 'review:' + r.id)).size + visibleRows(budgetList.budgets || []).filter(b => !b.opp_code).length;
  const dispatch = visibleRows(tasks.dispatch?.rows || []);
  const salesTodo = myReviews.filter(r => ['draft', 'returned'].includes(r.status));
  const oppLink = c => c ? '#/opp/' + encodeURIComponent(c) : '';
  page.innerHTML = `
  <div class="metric-grid">
    ${isReviewer ? `<div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/tasks'"><span class="m-label">待我评审</span><span class="m-value tone-yellow">${myTasks.length}</span><span class="m-foot">前置评审待办</span></div>` : ''}
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/opps'"><span class="m-label">${isSales ? '我的商机' : '我的评审单'}</span><span class="m-value">${isSales ? myOppCount : myReviews.length}</span><span class="m-foot">点击进入商机列表</span></div>
    ${isSales ? `<div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/new'"><span class="m-label">新建待评审商机</span><span class="m-value tone-brand">→</span><span class="m-foot">向导式: 对话/表单/Excel</span></div>` : ''}
    ${isSupport ? `<div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/judge'"><span class="m-label">前置收集中</span><span class="m-value tone-yellow">${waitJudge.length}</span><span class="m-foot">部门打灯尚未结束</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/judge'"><span class="m-label">待录结论</span><span class="m-value">${yellowMeet.length}</span><span class="m-foot">已研判，待结论与归档</span></div>` : ''}
  </div>
  ${isReviewer && dispatch.length ? `<div class="std-box" id="dispatchBanner"><b>你所在部门有 ${dispatch.reduce((n, r) => n + r.payload.pending_count, 0)} 项待打灯（${dispatch.length} 张评审单）</b> · 本地待办，未向外部发送
    ${dispatch.map(r => `<div><a href="#/tasks?review_id=${r.review_id}">评审单 #${r.review_id} · ${esc(r.opp_code || '')} →</a></div>`).join('')}</div>` : ''}
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
      <td class="ops"><button class="btn sm pri" onclick="openTask(${t.id})">打灯</button></td></tr>`);
    if (isSupport) {
      for (const r of waitJudge.slice(0, 15)) rows.push(`<tr>
        <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td>
        <td>${statusPill(r.status)}</td>
        <td class="ops">${oppLink(r.opp_code) ? `<a href="${oppLink(r.opp_code)}">进入商机</a>` : `<a href="#/review/${r.id}">详情</a>`}</td></tr>`);
      for (const r of yellowMeet.slice(0, 10)) rows.push(`<tr>
        <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td>
        <td>${lightPill(r.light) || statusPill(r.status)}</td>
        <td class="ops"><a href="#/review/${r.id}">${r.light === 'red' ? '查看退回结论' : '录入结论'}</a></td></tr>`);
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

// ---- 新建/编辑表单 ----
let EDIT_ID = null;
function prefillHint(pf) { // spec §6.3: N=非空键数=X+Y, X=评审来源, Y=档案来源, Z=空值键数
  const f = (pf && pf.fields) || {}, srcs = Object.values((pf && pf.sources) || {});
  const x = srcs.filter(s => s && s.source === 'review').length, y = srcs.filter(s => s && s.source === 'archive').length;
  const z = Object.keys(f).filter(k => f[k] === null || f[k] === undefined || String(f[k]).trim() === '').length;
  return `已带入 ${x + y} 项：评审 ${x} 项 / 档案 ${y} 项 / 待补 ${z} 项`;
}
async function renderForm(type, editId, oppQ, budgetQ) {
  const page = $('#page');
  let ctxCode = String(oppQ || '').trim(); // ?opp= 上下文: 同商机再次评审 / 建档成功后的续接
  // 建档首屏(V4.0 spec §4.2): 新建待评审商机要素齐了才进评审流程; 带上下文则直接进类型选择
  if (!type) {
    if (ctxCode) { page.innerHTML = oppPickTypeHtml(ctxCode, null); return; }
    window._oppDraft = window._oppDraft || {};
    page.innerHTML = `
    <div class="card"><h3>新建待评审商机 <span style="font-weight:400;font-size:12.5px;color:var(--text-3)">要素齐全才能进入评审流程 · 三步链: ① 交付预算 → ② 项目预算 → ③ 项目评审单</span></h3>
      <div class="row" style="margin-bottom:10px">
        <div class="stat" style="cursor:pointer;flex:1" onclick="oppDialogToggle()">
          <div class="n" style="font-size:16px">① 对话式建档</div>
          <div class="t">向智能体口述, 自动翻译要素填入下方表单并补问缺项; 建档仍需点【确认建档】</div>
        </div>
        <div class="stat" style="cursor:pointer;flex:1" onclick="document.getElementById('impFile').click()">
          <div class="n" style="font-size:16px">③ Excel 导入</div>
          <div class="t">上传信息收集表，导入为草稿；预算与交付明细分别导入</div>
        </div>
      </div>
      <div id="oppDialog" style="display:none;margin-bottom:12px;padding:10px;border:1px solid var(--line, #ddd);border-radius:8px">
        <div id="oppDlgLog" style="max-height:220px;overflow:auto;font-size:13px;line-height:1.7;margin-bottom:8px"><div style="color:var(--text-3)">智能体: 请口述商机要素(客户/项目名称/预计合同金额万元/业务线/商机阶段/销售/概述), 识别结果会填入下方表单, 你可随时手改。</div></div>
        <div style="display:flex;gap:8px">
          <input id="oppDlgMsg" style="flex:1" placeholder="例: 江西省自然资源测绘与监测院的天地图 POI 数据服务, 预计 240 万, G1, 销售王超" onkeydown="if(event.key==='Enter')oppDialogSend()">
          <button class="btn" onclick="oppDialogSend()">发送</button>
          <button class="btn pri" onclick="oppDialogCreate()">确认建档</button>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text-4);margin:6px 0 8px">② 表单式建档 · 待评审商机要素(带 <b>*</b> 为必填):</div>
      <form onsubmit="return false"><div class="grid">
        ${OPP_F.map(f => `
        <div class="f-item ${f.full ? 'full' : ''}">
          <label>${f.l} ${f.req ? '<b>*</b>' : ''}</label>
          ${f.k === 'opp_code' ? `<input id="newOppCode" placeholder="${f.ph || ''}">`
          : f.t === 'select' ? `<select data-ok="${f.k}">${f.o.map(o => `<option>${o}</option>`).join('')}</select>`
          : f.t === 'textarea' ? `<textarea data-ok="${f.k}"></textarea>`
          : `<input data-ok="${f.k}" type="${f.t || 'text'}" ${f.t === 'number' ? 'step="any"' : ''}>`}
        </div>`).join('')}
      </div></form>
      <div style="margin-top:16px;display:flex;gap:10px;align-items:center">
        <button class="btn pri" onclick="createOppProfile()">建档案并进入下一步 →</button>
        <button class="btn" onclick="location.hash='#/opps'">取消</button>
        <span id="oppProfileErr" style="font-size:12.5px;color:#A32D2D"></span>
      </div>
      <div class="hint">档案建好后, 该商机的交付预算/项目预算/评审单都在「商机 360° · 信息收集」页签办理; 同一商机可多次发起不同类型评审。</div>
      <div style="font-size:12px;color:var(--text-4);margin:10px 0 4px">或直接从 Excel 建单:</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <input type="file" id="impFile" accept=".xlsx" style="font-size:12.5px">
        <select id="impType" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:7px 10px;font-size:13px;background:var(--control-bg);color:var(--text-1)">
          <option value="bid">投标决策评审</option><option value="presale">售前立项评审</option>        </select>
        <button class="btn sm pri" onclick="importReviewExcel()">上传 Excel 导入评审单</button>
        <span style="font-size:12px;color:var(--text-4)">导入为草稿，核对补充后提交；变更决策无 Excel 模板，请在线填写</span>
      </div></div>`;
    window.importReviewExcel = importReviewExcel; // 旧入口保留(建档首屏底部 Excel)
    return;
  }
  EDIT_ID = editId || null;
  let form = {}, title = '', selectedBudgetId = budgetQ || '';
  if (editId) {
    const d = await api('/api/reviews/' + editId);
    form = JSON.parse(d.review.form_json || '{}'); title = d.review.title; type = d.review.type;
    selectedBudgetId = d.review.budget_id || ''; ctxCode = d.review.opp_code || form.opp_code || '';
  }
  const fields = FIELDS[type];
  let pf = null;
  if (!editId && ctxCode) { // spec 2026-10-19 §6: 建单预填改走服务端 prefill(五级级联), 仅填空不覆盖
    try {
      pf = await api('/api/opp/' + encodeURIComponent(ctxCode) + '/prefill?type=' + encodeURIComponent(type));
      if (!title) title = pf.title || '';
      for (const k of Object.keys(pf.fields || {})) { if (form[k] === undefined || form[k] === null || form[k] === '') form[k] = pf.fields[k]; }
      form.opp_code = ctxCode;
    } catch (e) { pf = null; }
  }
  const reqBudget = ['bid', 'presale'].includes(type); // T2: 预算先行强制类型
  const budgetOpts = ((await apiCached('/api/budget')).budgets || []).filter(b => b.status === 'locked');
  const unavailableBudget = !editId && !!selectedBudgetId && !budgetOpts.some(b => String(b.id) === String(selectedBudgetId));
  if (unavailableBudget) selectedBudgetId = '';
  const currentBudgetOption = editId && selectedBudgetId && !budgetOpts.some(b => String(b.id) === String(selectedBudgetId)) ? `<option value="${esc(selectedBudgetId)}" selected>#${esc(selectedBudgetId)}（当前关联，尚未锁定或不在当前列表）</option>` : '';
  page.innerHTML = `
  <div class="card">
    <h3>${editId ? '修改' : '新建'}${TYPE_NAMES[type]}单 ${editId ? `<span class="pill p-yellow">第 ${'' + (window._round || '')} 轮</span>` : ''}</h3>
    ${!editId && ctxCode ? `<div class="hint" id="pfHint" style="margin:-6px 0 10px">商机上下文: <b style="font-family:monospace">${esc(ctxCode)}</b>${pf ? ' · ' + prefillHint(pf) : ''}</div>` : ''}
    <div id="readyBar" class="std-box" aria-live="polite">正在读取三步就绪状态…</div>
    ${reqBudget ? `
    <div style="background:var(--surface-2);border:1px solid var(--brand-border);border-radius:var(--r-p);padding:14px 16px;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px"><span class="pill p-blue">第 1 步</span> 关联预算单 <span style="font-weight:400;font-size:12px;color:var(--text-3)">（先算账→再报价→后提报）</span></div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end">
        <div class="f-item" style="flex:3;min-width:260px;margin:0"><label>选择已锁定预算单 <b>*</b></label>
          <select id="f_budget" data-orig="${esc(selectedBudgetId)}"><option value="">— 请选择 —</option>${currentBudgetOption}${budgetOpts.map(b => `<option value="${b.id}" ${String(selectedBudgetId) === String(b.id) ? 'selected' : ''}>${esc(b.code)} v${b.version}${b.project_name ? ' · ' + esc(b.project_name) : ''}</option>`).join('')}</select>
          <div style="font-size:12px;color:var(--text-4);margin-top:4px;line-height:1.7">选中后自动带入：客户/合同额/分包额/项目名；判灯毛利率自动取预算单实算</div></div>
        <div style="flex:1;min-width:190px"><button class="btn" style="width:100%" onclick="location.hash='#/agent'">去智能体新建预算单 →</button>
          <div style="font-size:11.5px;color:var(--text-4);margin-top:4px">技能①口述编制→锁定→回本页关联</div></div>
      </div>
      <div id="budgetGate" style="font-size:12.5px;color:#e0a54a;margin-top:8px">${unavailableBudget ? '该预算单不在你的已锁定列表，请由所有者发起，或选择本人预算单' : budgetOpts.length ? '未选择预算单前无法进入下一步' : '暂无已锁定预算单——先去智能体新建并锁定'}</div>
    </div>` : ''}

    <form onsubmit="return false"><div class="grid">
      <div class="f-item full"><label>项目名称 <b>*</b></label><input id="f_title" value="${esc(title)}"></div>
      ${fields.map(f => `
      <div class="f-item ${f.full ? 'full' : ''}">
        <label>${f.l} ${f.req ? '<b>*</b>' : ''}</label>
        ${f.t === 'select' ? `<select data-k="${f.k}">${f.o.map(o => `<option ${form[f.k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : f.t === 'textarea' ? `<textarea data-k="${f.k}" placeholder="${f.ph || ''}">${esc(form[f.k] || '')}</textarea>`
        : `<input data-k="${f.k}" type="${f.t || 'text'}" ${f.t === 'number' ? 'step="any"' : ''} placeholder="${f.ph || ''}" value="${esc(form[f.k] ?? '')}">`}
      </div>`).join('')}
    </div></form>
    ${!reqBudget ? `<div class="f-item full" style="margin-top:12px"><label>关联预算单(可选,仅列已锁定)</label>
      <select id="f_budget" data-orig="${esc(selectedBudgetId)}"><option value="">不关联</option>${currentBudgetOption}${budgetOpts.map(b => `<option value="${b.id}" ${String(selectedBudgetId) === String(b.id) ? 'selected' : ''}>${esc(b.code)} v${b.version}${b.project_name ? ' · ' + esc(b.project_name) : ''}</option>`).join('')}</select>
      <div style="font-size:12px;color:var(--text-4);margin-top:4px;line-height:1.7">关联后自动带入：客户/合同额/分包额/项目名；判灯毛利率自动取预算单实算（先预算后报价）</div></div>` : ''}
    <div style="margin-top:18px;display:flex;gap:10px">
      <button class="btn pri" id="nextBtn" onclick="submitReview('${type}',false)" ${!editId && reqBudget ? 'disabled' : '' }>下一步:填写项目预算表 →</button>
      <button class="btn" onclick="goBack('#/opps')">取消</button>
    </div>
    <div class="hint">${reqBudget ? '流程:第 1 步 关联预算单(自动带数) → 第 2 步 补充项目信息 → 第 3 步 项目预算表核对(关联预算单时可只读确认) → 提交。' : '流程:第 1 步 基础信息 → 第 2 步 项目预算表(在线填/AI 辅助,或上传 Excel)→ 提交评审。预算表是提交的前置条件。'}</div>
  </div>`;
  const sel = $('#f_budget'), nextBtn = $('#nextBtn'), bar = $('#readyBar');
  let selectedBudget = null, chainCode = null, chain = null, chainError = '';
  const required = META[type].filter(f => f.req);
  const updateReady = async () => {
    if (!bar.isConnected) return;
    const code = ctxCode || document.querySelector('[data-k="opp_code"]')?.value.trim() || '';
    const filled = Number(!!$('#f_title').value.trim()) + required.filter(f => document.querySelector(`[data-k="${f.k}"]`)?.value.trim()).length;
    const total = required.length + 1;
    const linked = !!selectedBudget && selectedBudget.status === 'locked' && String(selectedBudget.opp_code || '') === code;
    const needsDelivery = reqBudget || !!sel.value;
    const deliveryReady = !needsDelivery || (chainCode === code && !!chain?.delivery_confirmed);
    const budgetReady = !reqBudget || linked;
    const ready = filled === total && budgetReady && deliveryReady && (!sel.value || linked);
    bar.dataset.ready = String(ready);
    bar.innerHTML = `${pill('① 交付预算 ' + (!needsDelivery ? '不适用' : deliveryReady ? '已确认' : '待确认'), deliveryReady ? 'p-green' : 'p-yellow')} ${pill('② 关联预算 ' + (linked ? selectedBudget.code + ' 已锁定' : reqBudget ? '待关联' : '不强制'), budgetReady ? 'p-green' : 'p-yellow')} ${pill('③ 必填 ' + filled + '/' + total, filled === total ? 'p-green' : 'p-yellow')} <b>${ready ? '就绪' : '未就绪'}</b>${chainError ? `<div>${esc(chainError)}</div>` : ''}<div class="hint">可保存草稿；提交仍由服务端校验。</div>`;
    if (code && chainCode !== code) {
      chainCode = code; chain = null; chainError = '';
      try {
        const d = await apiCached('/api/opp/' + encodeURIComponent(code) + '/360');
        if (!bar.isConnected || chainCode !== code) return;
        chain = d.chain;
      } catch (e) {
        if (!bar.isConnected || chainCode !== code) return;
        chainError = '无法读取交付状态：' + e.message;
      }
      updateReady();
    }
  };
  const loadBudget = async () => {
    const id = sel.value;
    selectedBudget = null;
    nextBtn.disabled = reqBudget && !id;
    const gate = $('#budgetGate');
    if (!id) {
      if (gate) gate.textContent = '未选择预算单前无法进入下一步';
      updateReady(); return;
    }
    try {
      const d = await apiCached('/api/budget/' + id);
      if (!sel.isConnected || sel.value !== id) return;
      selectedBudget = d.budget;
      const f = selectedBudget.fields;
      let n = 0;
      const fill = (k, v) => {
        if (v === undefined || v === null || v === '') return;
        const el = document.querySelector(`[data-k="${k}"]`);
        if (el && !el.value.trim()) { el.value = v; n++; }
      };
      fill('customer', f.customer);
      fill('contract_amount', f.contract != null ? Math.round(f.contract / 100) / 100 : undefined);
      fill('sub_amount', f.sub_cost != null ? Math.round(f.sub_cost / 100) / 100 : undefined);
      fill('summary', f.project_name);
      fill('opp_code', selectedBudget.opp_code || f.opp_code);
      if (!$('#f_title').value.trim()) $('#f_title').value = selectedBudget.project_name || f.project_name || '';
      const formCode = ctxCode || document.querySelector('[data-k="opp_code"]')?.value.trim() || '';
      if (selectedBudget.opp_code && formCode && selectedBudget.opp_code !== formCode) toast('商机代码不一致，请选择同商机预算单', 1);
      if (n) toast('已从 ' + selectedBudget.code + ' 带入 ' + n + ' 个字段');
      if (gate) gate.textContent = '已关联 ' + selectedBudget.code + ' · 判灯毛利率取该单实算';
      updateReady();
    } catch (e) {
      if (sel.isConnected) { toast(e.message, 1); updateReady(); }
    }
  };
  sel.addEventListener('change', loadBudget);
  page.querySelectorAll('#f_title,[data-k]').forEach(el => {
    el.addEventListener('input', updateReady); el.addEventListener('change', updateReady);
  });
  updateReady();
  if (sel.value) await loadBudget();
}
// ---- V4.0 T7 待评审商机: 选首个评审类型卡 + 建档 ----
function oppPickTypeHtml(code, opp) {
  const chainHint = `<div class="hint">商机 <b style="font-family:monospace">${esc(code)}</b>${opp ? ' · ' + esc(opp.title || '') : ''} 的下一步: 选评审类型 → 在「信息收集」页签按 ① 交付预算 → ② 项目预算 → ③ 提交评审单 顺序办理。投标决策三类必填由服务端门禁裁决, 缺环会被 400/409 拦下并指明缺哪一环。</div>`;
  return `
  <div class="card" id="oppPickType"><h3>选择首个评审类型 <span style="font-weight:400;font-size:12.5px;color:var(--text-3)">一个商机可多次评审(售前投入 / 投标决策 / 事项变更)</span></h3>
    <div class="row">
      ${Object.entries(TYPE_NAMES).map(([k, v]) => `
        <div class="stat" style="cursor:pointer" onclick="location.hash='#/new/${k}?opp=${encodeURIComponent(code)}'">
          <div class="n" style="font-size:17px">${v}</div>
          <div class="t">${{ presale: '销售经理发起 · 售前投入前', bid: '销售经理发起 · 投标前', change: '项目经理发起 · 执行中重大变更' }[k]}</div>
        </div>`).join('')}
    </div>${chainHint}
    <div style="margin-top:12px;display:flex;gap:10px">
      <button class="btn" onclick="location.hash='#/opp/${encodeURIComponent(code)}'">直接去信息收集(先编交付预算) →</button>
      <button class="btn" onclick="goBack('#/opps')">返回商机列表</button>
    </div></div>`;
}
// ---- V4.0 P1 打灯矩阵聚合(只展示, 不新增判定): 部门×灯色取 (评审单×部门×指标) 最新轮次计数 ----
// D-25: 「当前在途」只认 chain(在线单), 「历史累计」用 lights(全量含历史单), 两列分列不得混算; 不读 opp.status
function oppLightAgg(d) {
  const ts = (d && d.tasks) || [], ch = (d && d.chain) || {}, L = (d && d.lights) || {};
  const latest = {};
  for (const x of ts) {
    const k = x.review_id + '|' + x.dept + '|' + x.ind_name;
    if (!latest[k] || x.round > latest[k].round) latest[k] = x;
  }
  const byDept = {};
  for (const x of Object.values(latest)) {
    const r = byDept[x.dept] || (byDept[x.dept] = { dept: x.dept, red: 0, yellow: 0, green: 0, pending: 0, returned: 0, other: 0 });
    const c = x.status === 'pending' ? 'pending' : x.status === 'returned' ? 'returned' : ['red', 'yellow', 'green'].includes(x.light) ? x.light : 'other';
    r[c]++;
  }
  return { depts: Object.values(byDept), lights: L,
    inflight: (Number(ch.reviews_total) || 0) - (Number(ch.reviews_submitted) || 0),
    history_total: Object.values(L).reduce((s, v) => s + (Number(v) || 0), 0) };
}
function oppLightAggHtml(a) {
  const L = a.lights || {};
  const cols = [['red', '红'], ['yellow', '黄'], ['green', '绿'], ['pending', '待打灯'], ['returned', '已退回'], ['other', '已处理(无灯)']];
  return `
    <div class="card"><h3>部门 × 灯色聚合 <span style="font-weight:400;font-size:12.5px;color:var(--text-3)">只展示不判定 · 格内按(评审单×部门×指标)最新轮次计数</span></h3>
      <div class="row" style="margin-bottom:10px">
        <div class="stat"><div class="n" data-agg="inflight">${a.inflight}</div><div class="t">当前在途 · 在线单未提交数(chain 总数 − 已提交)</div></div>
        <div class="stat"><div class="n" data-agg="history">${a.history_total}</div><div class="t">历史累计 · 全部评审单含历史承接(${esc(`红 ${L.red || 0} · 黄 ${L.yellow || 0} · 绿 ${L.green || 0} · 未评 ${L.none || 0}`)})</div></div>
      </div>
      ${a.depts.length === 0 ? '<div class="empty">暂无前置任务</div>' : `<div class="card-table-wrap"><table>
        <tr><th>部门</th>${cols.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr>
        ${a.depts.map(r => `<tr><td><b>${esc(r.dept)}</b></td>${cols.map(([k]) => `<td class="num">${r[k]}</td>`).join('')}</tr>`).join('')}
      </table></div>`}
      <div class="hint">两列口径不同不得相加: 在途只计在线单(D-25), 历史累计含历史承接单; 灯态全部来自部门打灯与系统研判, 本卡不做任何判定。</div></div>`;
}
async function createOppProfile() {
  const body = { opp_code: ($('#newOppCode') || {}).value ? $('#newOppCode').value.trim() : '' };
  document.querySelectorAll('[data-ok]').forEach(el => { body[el.dataset.ok] = el.value; });
  const err = $('#oppProfileErr');
  const miss = OPP_F.filter(f => f.req && !String(body[f.k] ?? '').trim());
  if (miss.length) { if (err) err.textContent = '必填未填: ' + miss.map(f => f.l).join('、'); return; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-]{1,39}$/.test(body.opp_code)) { if (err) err.textContent = '商机代码需 2-40 位, 字母数字开头, 仅可含 . _ -'; return; }
  if (err) err.textContent = '';
  try {
    const d = await api('/api/opp', 'POST', body);
    oppAfterCreate(d.opp, body);
  } catch (e) { if (err) err.textContent = e.message || '建档失败'; }
}
function oppAfterCreate(opp, body) {
  window._oppDraft = opp || body;
  const code = (opp && opp.opp_code) || body.opp_code;
  location.hash = '#/opp/' + encodeURIComponent(code); // IA-22: 建档成功落 360 L1, 类型选择走 #oppLaunch 三卡
}
// ---- V4.0 P1 技能④对话式建档: 口述 → 白名单字段填回表单; 建档与表单同一服务端裁判(不在前端预判代码/必填) ----
function oppDialogToggle() {
  const el = $('#oppDialog');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
  if (el.style.display === '') $('#oppDlgMsg').focus();
}
function oppDlgLog(who, text) {
  const box = $('#oppDlgLog');
  if (!box) return;
  box.insertAdjacentHTML('beforeend', `<div style="white-space:pre-wrap"><b>${esc(who)}:</b> ${esc(text)}</div>`);
  box.scrollTop = box.scrollHeight;
}
function oppFormDraft() {
  const dr = {};
  document.querySelectorAll('[data-ok]').forEach(el => { dr[el.dataset.ok] = el.value; });
  return dr;
}
async function oppDialogSend() {
  const inp = $('#oppDlgMsg');
  const msg = inp.value.trim();
  if (!msg) return;
  oppDlgLog('我', msg);
  inp.value = '';
  try {
    const d = await api('/api/agent/chat', 'POST', { skill: 'opp', message: msg, draft: oppFormDraft(), opp_code: ($('#newOppCode') || {}).value || '' });
    document.querySelectorAll('[data-ok]').forEach(el => {
      const v = (d.draft || {})[el.dataset.ok];
      if (v !== undefined && v !== null && String(v) !== '') el.value = v;
    });
    oppDlgLog('智能体', d.reply);
  } catch (e) { oppDlgLog('系统', e.message || '对话失败'); }
}
async function oppDialogCreate() {
  const err = $('#oppProfileErr');
  const code = ($('#newOppCode') || {}).value ? $('#newOppCode').value.trim() : '';
  try {
    const d = await api('/api/agent/chat', 'POST', { skill: 'opp', action: 'create', message: '确认建档', draft: oppFormDraft(), opp_code: code });
    oppAfterCreate(d.opp, { opp_code: code });
  } catch (e) {
    if (err) err.textContent = e.message || '建档失败';
    oppDlgLog('系统', e.message || '建档失败');
  }
}
async function submitReview(type, isSubmit) {
  const title = $('#f_title').value.trim();
  if (!title) return toast('请填写项目名称', 1);
  const form = {};
  document.querySelectorAll('[data-k]').forEach(el => form[el.dataset.k] = el.value);
  const mOpp = (location.hash.split('?')[1] || '').match(/opp=([^&]+)/); // 上下文商机码为权威值, 防手改(裁决仍在服务端)
  if (mOpp) form.opp_code = decodeURIComponent(mOpp[1]);
  for (const f of FIELDS[type]) if (f.req && !String(form[f.k] ?? '').trim()) return toast(`请填写:${f.l}`, 1);
  try {
    if (EDIT_ID) {
      const sel = $('#f_budget');
      if (sel.dataset.orig && !sel.value) return toast('当前预算关联不可解除，请保留原关联或选择另一预算单', 1);
      const body = { title, form };
      if (sel.value && sel.value !== sel.dataset.orig) body.budget_id = Number(sel.value);
      await api('/api/reviews/' + EDIT_ID, 'PUT', body);
      toast('基础信息已保存,请完成第 2 步:项目预算表');
      location.hash = '#/budget/' + EDIT_ID;
    } else {
      const bs = $('#f_budget'); // H-06: 携带关联预算单(仅新建)
      const budget_id = bs && bs.value ? Number(bs.value) : null;
      const d = await api('/api/reviews', 'POST', { type, title, form, submit: false, budget_id });
      toast('基础信息已保存,请完成第 2 步:项目预算表');
      location.hash = '#/budget/' + d.id;
    }
  } catch (e) { toast(e.message, 1); }
}

// ---- 单据详情 L2(spec 2026-10-19 §7): 评审实例视图, 商机下钻一实例一视图 ----
let INST = { ctxCode: null, review: null, siblings: [], tasks: [], events: [], attachments: [], budget: null, tab: 'form', round: 1 };
const INST_TABS = [['form', '本次信息收集'], ['pre', '本次前置评审'], ['result', '本次结论与归档'], ['chat', '本次对话']];
const instDefaultTab = r => (r.era === 'history' || ['judged', 'archived'].includes(r.status)) ? 'result' : r.status === 'reviewing' ? 'pre' : 'form';
async function renderDetail(id, ctxCode, keepTab) {
  const page = $('#page');
  const path = '/api/reviews/' + id;
  const d0 = peekCached(path);
  const d = d0 || await apiCached(path);
  const r = d.review;
  if (ctxCode && ctxCode !== r.opp_code) { // 规范化只针对深链入口(spec §8.7)
    history.replaceState(null, '', r.opp_code ? '#/opp/' + encodeURIComponent(r.opp_code) + '/r/' + id : '#/review/' + id);
  }
  Object.assign(INST, { ctxCode, review: r, siblings: d.siblings || [], tasks: d.tasks || [], events: d.events || [], attachments: d.attachments || [], budget: d.budget || null, coverage: d.coverage });
  if (!keepTab) INST.tab = instDefaultTab(r);
  INST.round = Math.max(r.round || 1, ...INST.tasks.map(t => t.round || 1));
  window._round = r.round;
  const tab = INST.tab;
  const sibAll = [{ id: r.id, type: r.type, title: r.title, status: r.status, updated_at: r.updated_at }, ...INST.siblings];
  const isOwner = r.applicant_id === ME.id;
  const isSupport = ME.role === '销售支持组' || ME.role === 'admin';
  const switcher = sibAll.length > 1 ? `<div id="instSwitcher" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">${sibAll.map(s =>
    `<a class="btn sm${s.id === r.id ? ' pri' : ''}" href="${r.opp_code ? '#/opp/' + encodeURIComponent(r.opp_code) + '/r/' + s.id : '#/review/' + s.id}">${esc(TYPE_NAMES[s.type] || s.type)} · ${esc((s.title || '').slice(0, 18))} ${statusPill(s.status)}</a>`).join('')}</div>` : '';
  const maxRound = Math.max(r.round || 1, ...INST.tasks.map(t => t.round || 1));
  const roundSel = maxRound > 1 ? `<select id="instRoundSel" onchange="renderInstRound(this.value)" style="margin-left:8px">${Array.from({ length: maxRound }, (_, i) => `<option value="${i + 1}" ${INST.round === i + 1 ? 'selected' : ''}>第 ${i + 1} 轮</option>`).join('')}</select>` : '';

  const banner = r.era === 'history'
    ? `<div class="light-banner lb-none" style="background:var(--surface-2);border:1px solid var(--border-default)"><span class="dot" style="background:#8b7fd4"></span><div>历史单据${r.opp_code ? ` · 商机代码 <b>${esc(r.opp_code)}</b>` : ''}<div class="sub">${fmtT(r.archived_at)} 评审 · 无前置评审过程(当年无此流程) · 灯态规则 2026 年启用 · 结论:${esc(r.decision_result || '未录入')}</div></div></div>`
    : r.status === 'judged' || r.status === 'archived'
    ? `<div class="light-banner lb-${r.light}"><span class="dot"></span><div>${LIGHT[r.light][0]}<div class="sub">${esc(r.route || '')}</div></div></div>`
    : r.status === 'returned'
    ? `<div class="light-banner lb-yellow"><span class="dot"></span><div>退回修改<div class="sub">前置评审有意见,请修改材料后重新提交</div></div></div>`
    : `<div class="light-banner lb-gray"><span class="dot"></span><div>${STATUS[r.status][0]}<div class="sub">第 ${r.round} 轮</div></div></div>`;

  page.innerHTML = `
  ${crumbBar(r.opp_code ? '#/opp/' + encodeURIComponent(r.opp_code) : '#/opps', r.opp_code ? '商机概览' : '全部商机', r.title)}
  <div id="reviewInstancePage">
    <div id="instHead" class="card">
      ${banner}
      <h3>${esc(r.title || '')} ${statusPill(r.status)} ${pill(TYPE_NAMES[r.type] || r.type, 'p-blue')} ${esc(r.applicant_name || '')} ${pill('第 ' + r.round + ' 轮', 'p-gray')}</h3>
      ${switcher}
      ${roundSel}
      <div id="instProgress">${instProgressHtml()}</div>
      <div id="instTabs" style="margin-top:8px;display:flex;gap:6px">${INST_TABS.map(([k, l]) => `<button class="btn sm${tab === k ? ' pri' : ''}" data-tab="${k}" onclick="renderInstTab('${k}')">${l}</button>`).join('')}</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        ${isOwner && ['draft', 'returned'].includes(r.status) ? `<button class="btn pri" onclick="location.hash='#/review/${r.id}/edit'">修改材料</button>` : ''}
        ${isOwner && ['draft', 'returned'].includes(r.status) ? `<button class="btn pri" onclick="${r.status === 'returned' ? `resubmit(${r.id})` : `location.hash='#/review/${r.id}/edit'`}">提交评审</button>` : ''}
        ${isOwner && r.status === 'judged' && r.light === 'red' ? `<button class="btn pri" onclick="location.hash='#/review/${r.id}/edit'">红灯打回:修改后重新提交</button>` : ''}
        ${isSupport && r.status === 'reviewing' ? `<button class="btn" onclick="rejudge(${r.id})">重新研判</button>` : ''}
        ${isSupport && r.status === 'judged' ? `<button class="btn pri" onclick="archive(${r.id})">归档存储</button>` : ''}
      </div></div>
    <div id="instBody"></div>
  </div>`;
  renderInstTab(tab);
}

function taskActor(t) { return t.proxy ? '由 ' + t.done_role + ' 代 ' + t.dept + ' 打灯' : t.done_by || ''; }
function instProgressHtml() { // 始终渲染 .progress-seg(IA-36), 按选中轮次过滤; 无任务=零宽分段+全零图例
  const ts = INST.tasks.filter(t => t.round === INST.round);
  const cnt = Object.fromEntries(['done', 'pending', 'returned', 'cancelled'].map(s => [s, ts.filter(t => t.status === s).length]));
  const total = ts.length || 1;
  return `<div class="progress-seg" style="height:10px;border-radius:5px;overflow:hidden;display:flex">
    <span style="width:${cnt.done / total * 100}%;background:var(--ok,#4a8)"></span>
    <span style="width:${cnt.pending / total * 100}%;background:#e0a54a"></span>
    <span style="width:${cnt.returned / total * 100}%;background:#A32D2D"></span>
    <span style="width:${cnt.cancelled / total * 100}%;background:var(--text-4)"></span></div>
    <div style="font-size:12px;color:var(--text-4);margin-top:4px">第 ${INST.round} 轮 · 已打灯 ${cnt.done} · 待打灯 ${cnt.pending} · 已退回 ${cnt.returned} · 已作废 ${cnt.cancelled}${ts.length ? '' : '（本轮暂无任务）'}</div>`;
}
function renderInstRound(rd) { INST.round = Number(rd) || 1; $('#instProgress').innerHTML = instProgressHtml(); if (INST.tab === 'pre') renderInstBody('pre'); }
function renderInstTab(k) { INST.tab = k; document.querySelectorAll('#instTabs button[data-tab]').forEach(b => b.classList.toggle('pri', b.dataset.tab === k)); renderInstBody(k); }
function renderInstBody(k) { // 四页签全部取 INST 现成数据, 切页签零网络请求(IA-37)
  const r = INST.review, body = $('#instBody');
  const form = JSON.parse(r.form_json || '{}');
  const ts = INST.tasks.filter(t => t.round === INST.round);
  const isSupport = ME.role === '销售支持组' || ME.role === 'admin';
  if (k === 'form') body.innerHTML = `
    <div class="card"><h3>表单字段</h3>
      <table>${FIELDS[r.type].filter(f => form[f.k] !== undefined && form[f.k] !== '').map(f =>
        `<tr><th style="width:210px;background:var(--surface-2)">${f.l}</th><td>${esc(form[f.k])}</td></tr>`).join('')}</table></div>
    <div class="card"><h3>附件</h3>
      ${INST.attachments.length ? `<ul class="attach-list">${INST.attachments.map(a =>
        `<li><a href="/uploads/${String(a.filepath).split('/').map(encodeURIComponent).join('/')}">${esc(a.filename)}</a> <span style="color:var(--text-4);font-size:12px">${esc(a.field)} · ${fmtT(a.uploaded_at)}</span></li>`).join('')}</ul>` : '<div class="empty">暂无附件</div>'}
      <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select id="attField" style="border:1px solid #d8d9de;border-radius:8px;padding:7px 10px;font-size:13px">
          <option>项目预算表</option><option>项目变更申请表</option><option>其他材料</option>
        </select>
        <input type="file" id="attFile" style="font-size:12.5px">
        <button class="btn sm" onclick="uploadAtt(${r.id})">上传附件</button>
        <span style="font-size:12px;color:#ef7b84">* 《项目贡献毛利率及成本预算表》为提交必传,可上传附件或在线填写</span>
      </div>
      ${r.budget_id ? `<div style="margin-top:6px">关联预算单: <a href="#/budget-detail/${r.budget_id}">#${r.budget_id}</a>${INST.review.budget_code ? '（' + esc(INST.review.budget_code) + '）' : ''}</div>` : ''}</div>
    ${r.status === 'draft' || !r.budget_id ? `<div class="card"><h3>项目预算表</h3><a class="btn" href="#/budget/${r.id}">在线填写项目预算表 →</a></div>` : ''}`;
  if (k === 'pre') {
    const myTasks = r.status === 'reviewing' ? ts.filter(t => t.dept === ME.role && t.status === 'pending') : [];
    const seg = ts.length ? (() => { // 可视化: 本轮任务完成度分布条(纯 CSS)
      const c = t => ts.filter(x => x.status === t).length;
      const dn = c('done'), pd = c('pending'), rt = c('returned'), cl = c('cancelled');
      const tot = ts.length || 1;
      const pc = v => (v / tot * 100).toFixed(1) + '%';
      return `<div class="progress-seg"><i class="seg-done" style="width:${pc(dn)}"></i><i class="seg-returned" style="width:${pc(rt)}"></i><i class="seg-cancelled" style="width:${pc(cl)}"></i><i class="seg-pending" style="width:${pc(pd)}"></i></div>
      <div class="dist-legend" style="margin-bottom:10px"><span class="lg lg-green">已完成 <b>${dn}</b></span><span class="lg lg-yellow">已退回 <b>${rt}</b></span><span class="lg lg-gray">待评审 <b>${pd}</b></span>${cl ? `<span class="lg lg-gray">已作废 <b>${cl}</b></span>` : ''}</div>`;
    })() : '';
    const trace = ts.filter(t => t.status === 'done' || t.status === 'returned');
    body.innerHTML = `
    <div class="card"><h3>待我评审</h3>
      ${myTasks.length ? myTasks.map(t => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f1f4">
        <b style="flex:1">${esc(t.ind_name)}</b>
        <button class="btn sm pri" onclick="openTask(${t.id})">打灯评审</button>
      </div>`).join('') : '<div class="empty">本轮暂无待你评审的任务</div>'}</div>
    <div class="card"><h3>前置评审打灯矩阵（第 ${INST.round} 轮）</h3>
      ${seg}
      <div class="card-table-wrap"><table>
        <tr><th>评判指标</th><th>责任部门</th><th>状态</th><th>灯态</th><th>前置评审意见</th><th>评审人</th><th>判定依据</th></tr>
        ${ts.map(t => `<tr>
          <td><b>${esc(t.ind_name)}</b></td><td>${esc(t.dept)}</td>
          <td>${t.status === 'done' ? pill('已完成', 'p-green') : t.status === 'returned' ? pill('已退回', 'p-yellow') : t.status === 'cancelled' ? pill('已作废', 'p-gray') : pill('待评审', 'p-blue')}</td>
          <td>${lightPill(t.light)}</td><td>${esc(t.opinion || '')}</td><td>${esc(taskActor(t))}</td>
          <td><button class="btn sm" onclick="openTask(${t.id},true)">查看依据</button></td>
        </tr>`).join('') || '<tr><td colspan="7" style="color:var(--text-4)">本轮暂无任务(尚未提交或该轮未开始)</td></tr>'}</table></div></div>
    <div class="card"><h3>轮次留痕</h3>
      <div class="hint">第 ${INST.round} 轮的打灯与退回留痕; 用上方轮次选择器切换轮次查看。</div>
      ${trace.length ? trace.map(t => `<div class="ev"><b>${t.status === 'done' ? '打灯' : '退回'}</b> · ${esc(t.dept)} · ${esc(t.ind_name)}${t.light && LIGHT[t.light] ? ' · ' + LIGHT[t.light][0] : ''}${t.done_by ? ' · ' + esc(taskActor(t)) : ''}${t.opinion ? ' — ' + esc(t.opinion) : ''}</div>`).join('') : '<div class="empty">本轮暂无留痕</div>'}</div>`;
  }
  if (k === 'result') body.innerHTML = `
    ${INST.coverage ? `<div class="card"><h3>本次判定覆盖</h3><div class="hint">仅披露，不参与灯色、路由或结论。</div>
      <b>因数据缺失未参与判定</b>${INST.coverage.skipped.length ? `<ul>${INST.coverage.skipped.map(i => `<li>${esc(i.name)}：${esc(i.reason)}</li>`).join('')}</ul>` : '<div class="hint">无缺失项</div>'}
      <b>未触发</b>${INST.coverage.notTriggered.length ? `<ul>${INST.coverage.notTriggered.map(i => `<li>${esc(i.name)}：${esc(i.reason)}</li>`).join('')}</ul>` : '<div class="hint">无未触发项</div>'}</div>` : ''}
    ${r.report ? `<div class="card"><h3>AI 研判报告 <a href="#" onclick="openReport(${r.id});return false" style="float:right;font-size:13px">打开正式报告(HTML) ↗</a></h3>${(() => { // 可视化: 风险项分级计数条
      try {
        const det = JSON.parse(r.judge_detail || '[]');
        const y = det.filter(i => i.level === 'yellow').length, rd = det.filter(i => i.level === 'red').length;
        const tot = det.length || 1;
        if (!det.length) return '';
        const pc = v => (v / tot * 100).toFixed(1) + '%';
        const gr = det.length - y - rd;
        return `<div class="dist-bar" style="margin-bottom:8px"><i class="seg-red" style="width:${pc(rd)}"></i><i class="seg-yellow" style="width:${pc(y)}"></i><i class="seg-green" style="width:${pc(gr)}"></i></div>
        <div class="dist-legend" style="margin-bottom:10px"><span class="lg lg-red">红项 <b>${rd}</b></span><span class="lg lg-yellow">黄项 <b>${y}</b></span><span class="lg lg-green">绿项 <b>${gr}</b></span><span style="margin-left:auto">指标共 <b>${det.length}</b> 项</span></div>`;
      } catch (e) { return ''; }
    })()}<div class="report-box">${esc(r.report)}</div></div>` : ''}
    ${isSupport && r.status === 'judged' && !r.decision_result ? `
    <div class="card" id="decisionCard"><h3>后台 · 会后结论录入 <span class="pill p-blue">销售支持组</span></h3>
      <div class="f-item"><label>评审结论</label>
        <label style="margin-right:18px"><input type="radio" name="decR" value="同意"> 同意</label>
        <label><input type="radio" name="decR" value="不同意"> 不同意</label>
      </div>
      <div class="f-item"><label>结论说明</label><textarea id="decNote" rows="3" placeholder="会后结论说明(可填上会时间/决议要点)"></textarea></div>
      <div class="f-item" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="decConflict" style="width:auto">
        <label style="margin:0">部门意见不一致(勾选后路由升级 XO 级评审会,灯色不变)</label></div>
      <button class="btn pri" onclick="submitDecision(${r.id})">提交结论</button>
    </div>` : ''}
    ${r.decision_result ? `
    <div class="card"><h3>后台 · 已录结论</h3>
      <div style="font-size:14px">结论:<b class="pill ${r.decision_result === '同意' ? 'p-green' : 'p-red'}" style="font-size:13px">${esc(r.decision_result)}</b>
        · 录入人:${esc(r.decision_by)} · ${fmtT(r.decision_at)}</div>
      ${r.decision_note ? `<div style="font-size:13px;color:var(--text-2);margin-top:6px">说明:${esc(r.decision_note)}</div>` : ''}
    </div>` : ''}
    ${(r.status === 'archived' || r.era === 'history') ? `
    <div class="card"><h3>归档信息</h3>
      <div style="font-size:13px;color:var(--text-2)">归档时间: ${fmtT(r.archived_at)} · 灯态: ${lightPill(r.light)} · 结论: ${esc(r.decision_result || '未录入')}</div></div>` : ''}
    <div class="card" id="instTimeline"><h3>时间线（全部轮次）</h3><div class="timeline">
      ${INST.events.slice().reverse().map(e => { // 可视化: 时间线节点按事件类型着色(批次3 接线)
        const evCls = /auto_return|退回|红灯/.test(e.action) ? ' ev-danger' : /研判|完成/.test(e.action) ? ' ev-brand' : /归档/.test(e.action) ? ' ev-success' : /重提|第 . 轮/.test(e.action) ? ' ev-warning' : '';
        return `<div class="ev${evCls}"><b>${esc(e.action)}</b> · ${esc(e.actor)} ${e.detail ? '— ' + esc(e.detail) : ''}<div class="t">${fmtT(e.created_at)}</div></div>`;
      }).join('')}
    </div></div>`;
  if (k === 'chat') { // 执行裁定⑫: 只渲染目标按钮不自动挂载, 点选才拉消息(spec §9.4 页签切换零请求)
    body.innerHTML = `<div class="card"><h3>本次对话</h3><div style="font-size:12px;color:var(--text-4);margin-bottom:8px">对话目标限本实例评审表${r.budget_id ? '及其关联预算单' : ''}</div><div id="oppChatPick" style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm pri" onclick="oppChatReview(${r.id})">评审表 ${esc(r.title || '')}</button>${r.budget_id ? `<button class="btn sm" onclick="oppChatBudget(${r.budget_id})">预算 ${(INST.budget || {}).code ? esc(INST.budget.code) : '#' + r.budget_id}</button>` : ''}</div><div id="oppChatBox"><div class="hint">选择上方目标开始对话。</div></div></div>`;
  }
}
// 打开正式报告(任务1.5): 报告页已收紧鉴权, 需先取带 HMAC 签名的临时链接再开新窗口
async function openReport(id) {
  try { const d = await api(`/api/reviews/${id}/report-link`); window.open(d.url, '_blank'); }
  catch (e) { toast(e.message, 1); }
}
async function resubmit(id) {
  try { await api(`/api/reviews/${id}/submit`, 'POST'); toast('已提交,前置评审任务已重新分发'); renderDetail(id, INST.ctxCode); }
  catch (e) { toast(e.message, 1); }
}
// 阶段3(任务 3.7/H-07): 会后结论录入(支持组)——同意/不同意 + 说明 + 意见不一致勾选(R-33)
async function submitDecision(id) {
  const v = document.querySelector('input[name="decR"]:checked');
  if (!v) return toast('请选择评审结论', 1);
  try {
    await api(`/api/reviews/${id}/decision`, 'POST', {
      decision_result: v.value,
      decision_note: ($('#decNote') || {}).value || '',
      opinion_conflict: !!($('#decConflict') || {}).checked
    });
    toast('结论已录入' + (($('#decConflict') || {}).checked ? ',路由已升级 XO 级' : ''));
    renderDetail(id, INST.ctxCode);
  } catch (e) { toast(e.message, 1); }
}
async function rejudge(id) {
  try { await api(`/api/reviews/${id}/judge`, 'POST'); toast('研判完成'); renderDetail(id, INST.ctxCode); }
  catch (e) { toast(e.message, 1); }
}
async function archive(id) {
  try { await api(`/api/reviews/${id}/archive`, 'POST'); toast('已归档'); renderDetail(id, INST.ctxCode); }
  catch (e) { toast(e.message, 1); }
}
async function uploadAtt(id) {
  const f = $('#attFile').files[0];
  if (!f) return toast('请先选择文件', 1);
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  const buf = await f.arrayBuffer();
  let bin = ''; const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  try {
    await api(`/api/reviews/${id}/attachments`, 'POST', { field: $('#attField') ? $('#attField').value : '其他材料', filename: f.name, data: btoa(bin) });
    toast('附件已上传'); renderDetail(id, INST.ctxCode, true);
  } catch (e) { toast(e.message, 1); }
}
// ---- 评审任务弹窗 ----
let TASK_ID = null, TASK_LIGHT = null;
async function openTask(id, readOnly = false) {
  TASK_ID = id; TASK_LIGHT = null;
  const task = [...(window._taskRows || []), ...INST.tasks].find(t => t.id === id);
  const mask = document.createElement('div');
  mask.className = 'modal-mask'; mask.id = 'mask';
  mask.innerHTML = `
  <div class="modal evidence-modal">
    <h3>前置评审 · ${esc(task?.ind_name || '')}</h3>
    <div class="std-box"><b>判定标准</b><br><span id="evStandards">${esc(task?.standards || '')}</span></div>
    <div id="evBox" aria-live="polite">正在加载本单证据…</div>
    ${readOnly ? '<button class="btn" onclick="document.querySelector(\'#mask\').remove()">关闭</button>' : `
    <div style="font-size:13px;color:var(--text-2);margin-bottom:4px">风险等级(打灯)</div>
    <div class="light-pick">
      <button id="pk-g" onclick="pickLight('green')">绿灯</button>
      <button id="pk-y" onclick="pickLight('yellow')">黄灯</button>
      <button id="pk-r" onclick="pickLight('red')">红灯</button>
    </div>
    <div class="f-item"><label>前置评审意见(黄灯/红灯必填)</label><textarea id="taskOp"></textarea></div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn pri" onclick="completeTask()">提交评审结论</button>
      <button class="btn dan" onclick="returnTask()">退回申请人修改</button>
      <button class="btn" onclick="document.querySelector('#mask').remove()">取消</button>
    </div>`}
  </div>`;
  document.body.appendChild(mask);
  try {
    const e = await api('/api/tasks/' + id + '/evidence');
    if (!mask.isConnected || TASK_ID !== id) return;
    mask.querySelector('h3').textContent = '前置评审 · ' + e.task.ind_name;
    mask.querySelector('#evStandards').textContent = e.task.standards;
    const facts = rows => rows.length ? `<table>${rows.map(f => `<tr><th>${esc(f.label)}</th><td>${esc(f.value === '' ? '未填' : f.value)}</td></tr>`).join('')}</table>` : '<div class="hint">本指标无对应表单字段</div>';
    mask.querySelector('#evBox').innerHTML = `
      ${readOnly && (e.task.round !== e.review.round || e.task.status !== 'pending') ? '<div class="hint">以下为当前数据，不是打灯时的快照。</div>' : ''}
      <section><h4>A 类·系统已算</h4>
        ${e.computed.length ? `<ul>${e.computed.map(i => `<li${i.focus ? ' class="ev-focus"' : ''}>${esc(i.name)} ${lightPill(i.level)} — ${esc(i.reason)}</li>`).join('')}</ul>` : '<div class="hint">暂无系统定量结果</div>'}
        ${e.skipped.length ? `<div class="hint">因数据缺失未参与判定：${e.skipped.map(i => esc(i.name + '（' + i.reason + '）')).join('；')}</div>` : ''}
        ${e.notTriggered.length ? `<div class="hint">未触发：${e.notTriggered.map(i => esc(i.name + '（' + i.reason + '）')).join('；')}</div>` : ''}
      </section>
      <section><h4>B 类·表单已采</h4><div class="hint">申请人填报，仅供参考，不替代部门判断。</div>${facts(e.formFacts)}</section>
      <section><h4>C 类·部门自有系统</h4><div class="hint">${esc(e.external.required ? e.external.hint : '本指标无需查询部门自有系统。')}</div><b>本单查询锚点</b>${facts(e.anchors)}</section>
      <a href="#/review/${e.review.id}" target="_blank" rel="noopener">查看完整评审表 ↗</a>`;
  } catch (e) {
    if (mask.isConnected && TASK_ID === id) mask.querySelector('#evBox').textContent = '证据加载失败：' + e.message + (readOnly ? '。' : '。请在部门系统核实后打灯。');
  }
}
function pickLight(l) {
  TASK_LIGHT = l;
  $('#pk-g').className = l === 'green' ? 'sel-g' : '';
  $('#pk-y').className = l === 'yellow' ? 'sel-y' : '';
  $('#pk-r').className = l === 'red' ? 'sel-r' : '';
}
async function completeTask() {
  if (!TASK_LIGHT) return toast('请先选择灯态', 1);
  const opinion = $('#taskOp').value.trim();
  try {
    const d = await api(`/api/tasks/${TASK_ID}/complete`, 'POST', { light: TASK_LIGHT, opinion });
    document.querySelector('#mask').remove();
    toast(d.autoJudged ? '前置评审全部完成,AI 已自动研判' : '评审结论已提交');
    render();
  } catch (e) { toast(e.message, 1); }
}
async function returnTask() {
  const opinion = $('#taskOp').value.trim();
  if (!opinion) return toast('退回必须填写意见', 1);
  try {
    await api(`/api/tasks/${TASK_ID}/return`, 'POST', { opinion });
    document.querySelector('#mask').remove();
    toast('已退回申请人修改'); render();
  } catch (e) { toast(e.message, 1); }
}

// ---- 在线预算表(任务2.8: dev_dept 输入模型 + 服务端实算, 删前端本地 computeBudget) ----
// 输入模型与技能①白名单同源(18 字段): 单价归财务参数按部门自动取, 不再手填 dev_rate/prod_rate
const DEV_DEPTS = ['交付处', '行业拓展部', '公共服务部', '公共服务业务处-交付运营', '公共服务业务处-市场方案', '行业售前部', '企业产品研发部', '数据产品部', '智能地图部', '公共组件部', '研发外包', '研发外包(企业服务)', '生产外包'];
const BUDGET_GROUPS = [
  { g: '基本信息(元)', items: [
    { k: 'contract', l: '合同金额', hint: '留空自动取评审表单预计合同金额' },
    { k: 'project_name', l: '项目名称', t: 'text' }, { k: 'customer', l: '客户名称', t: 'text' } ] },
  { g: '采购与外包(元)', items: [
    { k: 'sub_cost', l: '分包采购成本' }, { k: 'sw_outsource', l: '软件类生产外包' }, { k: 'flex_labor', l: '灵活用工' } ] },
  { g: '销售成本(元)', items: [
    { k: 'sales_labor', l: '销售人力成本', hint: '留空自动=净签单(万)×1727' },
    { k: 'sales_travel', l: '差旅费' }, { k: 'sales_entertain', l: '招待费' }, { k: 'sales_marketing', l: '市场营销费' } ] },
  { g: '交付成本(元)', items: [
    { k: 'dev_dept', l: '交付部门', t: 'select', o: DEV_DEPTS, hint: '单价归财务参数,按部门自动取' },
    { k: 'dev_pd', l: '正编人天(天)' }, { k: 'prod_pd', l: '生产外包人天(天)' },
    { k: 'rd_outsource', l: '研发外包费用' }, { k: 'del_travel', l: '交付差旅招待' },
    { k: 'pm_cost', l: '项目管理费', hint: '含项目经理人力/差旅/招待' },
    { k: 'del_other', l: '其他交付费用', hint: '验收/综合办公/专业服务' } ] },
  { g: '激励', items: [ { k: 'incentive_factor', l: '激励系数', hint: '默认 1.0' } ] }
];
let B_REVIEW = null, B_FORM = {}, B_TIMER = null;

function collectBudgetInputs() { // 收集表单值(字符串原样, 服务端白名单过滤+数字解析)
  const i = {};
  document.querySelectorAll('[data-b]').forEach(el => i[el.dataset.b] = el.value);
  B_FORM = i;
  return i;
}
function budgetPreview() { // 防抖 500ms 调 POST /api/budget/preview(服务端 finance.computeBudget 同口径)
  clearTimeout(B_TIMER);
  B_TIMER = setTimeout(async () => {
    const fields = collectBudgetInputs();
    try {
      const d = await api('/api/budget/preview', 'POST', { fields });
      renderBudgetCalc(d.calc);
    } catch (e) { /* 输入中途的预览失败不打扰, 保存时再报错 */ }
  }, 500);
}
function renderBudgetCalc(c) {
  c = c || {};
  const fmt = n => (typeof n === 'number' && isFinite(n)) ? Math.round(n).toLocaleString('zh-CN') : '—';
  const margin = typeof c.margin === 'number' ? c.margin : null;
  const low = margin !== null && margin < 10;
  $('#bComputed').innerHTML = `
    <table>
      <tr><th>测算项</th><th>金额(元)</th><th>公式口径</th></tr>
      <tr><td>合同金额</td><td>${fmt(c.contract)}</td><td>评审表单/预算表填报(元)</td></tr>
      <tr><td>项目收入</td><td>${fmt(c.income)}</td><td>合同金额 ÷ 1.06(税后)</td></tr>
      <tr><td>项目净收入</td><td>${fmt(c.net)}</td><td>收入 − 分包 − 软件外包 − 灵活用工</td></tr>
      <tr><td>销售成本(含税金,不含激励)</td><td>${fmt(c.salesCost)}</td><td>人力 ${fmt(c.salesLabor)} + 差旅招待市场 + 税金 ${fmt(c.tax)}(税后收入×1%)</td></tr>
      <tr><td>销售考核利润</td><td>${fmt(c.assessProfit)}</td><td>净收入 − 销售成本</td></tr>
      <tr><td>销售及售前激励</td><td>${fmt(c.incentive)}</td><td>销售考核利润 × 7.7% × 系数</td></tr>
      <tr><td>交付成本</td><td>${fmt(c.delivery)}</td><td>正编人天×部门单价${B_FORM.dev_dept ? '(' + esc(B_FORM.dev_dept) + ')' : ''} + 生产外包人天×单价 + 其他</td></tr>
      <tr style="background:#EEEDFE"><td><b>贡献毛利</b></td><td><b>${fmt(c.contribution)}</b></td><td>净收入 − 销售成本 − 交付成本 − 激励</td></tr>
      <tr style="background:#EEEDFE"><td><b>贡献毛利率</b></td><td><b style="color:${low ? '#A32D2D' : '#27500A'}">${margin !== null ? margin.toFixed(2) + '%' : '—'}</b></td><td>${low ? '低于 10%,将判黄灯' : '达到 10% 免上会线'}</td></tr>
    </table>`;
}
async function renderBudgetDetail(id) {
  const page = $('#page');
  showLoading(page);
  try {
    const d = await api('/api/budget/' + id);
    const b = d.budget;
    const href = b.opp_code ? '#/opp/' + encodeURIComponent(b.opp_code) : '#/budgets';
    const parent = b.opp_code ? '所属商机' : '预算工作台';
    const fields = b.fields || {};
    B_FORM = fields;
    page.innerHTML = `
    ${crumbBar(href, parent, b.project_name || b.code)}
    <div class="card"><h3>项目预算单 ${esc(b.code)} ${pill('v' + b.version + ' · ' + (b.status === 'locked' ? '已锁定' : '草稿'), b.status === 'locked' ? 'p-green' : 'p-gray')}</h3>
      <div class="hint">${esc(b.project_name || '')} · 更新于 ${fmtT(b.updated_at)} · 版本链 ${(d.versions || []).length} 张</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn sm pri" href="#/agent?b=${b.id}">对话编制</a><a class="btn sm" href="#/delivery/${b.id}">附3 交付明细</a></div>
    </div>
    <div class="card"><h3>预算字段</h3>
      ${BUDGET_GROUPS.map(g => `<div style="font-size:13px;font-weight:600;color:var(--brand-hover);margin:12px 0 6px">${g.g}</div>
        <div class="card-table-wrap"><table>${g.items.map(f => `<tr><th style="width:240px">${esc(f.l)}</th><td>${esc(fields[f.k] ?? '—')}</td></tr>`).join('')}</table></div>`).join('')}
    </div>
    <div class="card"><h3>自动测算</h3><div id="bComputed"></div></div>`;
    renderBudgetCalc(b.calc || {});
  } catch (e) { toast(e.message, 1); location.hash = '#/budgets'; }
}
async function renderBudget(id) {
  const page = $('#page');
  const d = await api('/api/reviews/' + id);
  B_REVIEW = d.review;
  const b = d.budget || {};
  const inp = b.inputs || {};
  const canEdit = B_REVIEW.applicant_id === ME.id || ME.role === '销售支持组';
  // 任务2.8: contract 从评审表单 contract_amount 注入(万元→元)
  if (inp.contract === undefined || inp.contract === null || inp.contract === '') {
    const ca = parseFloat(JSON.parse(B_REVIEW.form_json || '{}').contract_amount);
    if (!isNaN(ca)) inp.contract = ca * 10000;
  }
  const parentHref = B_REVIEW.opp_code ? '#/opp/' + encodeURIComponent(B_REVIEW.opp_code) : '#/budgets';
  const parentName = B_REVIEW.opp_code ? '所属商机' : '预算工作台';
  page.innerHTML = `
  ${crumbBar(parentHref, parentName, B_REVIEW.title)}
  <div class="card"><h3>第 2 步 · 项目预算表 <span style="font-weight:400;font-size:12.5px;color:var(--text-3)">${esc(B_REVIEW.title)}</span></h3>
    <div class="std-box">在线填写替代 Excel 附件:填成本项即可,收入/税金/激励/贡献毛利全部按财务口径由服务端统一实算(正编单价按交付部门自动取财务参数)。也可以把项目经理发来的文字粘贴到下方,用 AI 自动识别填充,或到 <a href="#/agent">智能体·技能①预算编制</a> 对话填报。</div>
    <div style="display:flex;gap:10px;align-items:flex-start">
      <textarea id="aiText" placeholder='粘贴文字,例如:"项目合同24万,无分包。交付预计交付处正编39人天、生产外包184人天,差旅3000。"' style="flex:1;min-height:70px"></textarea>
      <div style="display:flex;flex-direction:column;gap:8px">
        <select id="aiModel" style="border:1px solid #d8d9de;border-radius:8px;padding:7px 10px;font-size:13px">
          <option value="deepseek-chat">Flash 快速版</option>
          <option value="deepseek-reasoner">Pro 增强版</option>
        </select>
        <button class="btn pri" id="aiBtn" onclick="aiFillBudget()">AI 识别填充</button>
      </div>
    </div>
    <div id="aiNote" style="font-size:12.5px;color:#854F0B;margin-top:6px"></div>
  </div>
  <div class="card"><h3>成本录入</h3>
    ${BUDGET_GROUPS.map(g => `
      <div style="font-size:13px;font-weight:600;color:var(--brand-hover);margin:12px 0 6px">${g.g}</div>
      <div class="grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px 14px">
        ${g.items.map(f => `<div class="f-item"><label>${f.l}</label>
          ${f.t === 'select' ? `<select data-b="${f.k}" ${canEdit ? '' : 'disabled'} onchange="budgetPreview()"><option value="">未选择</option>${(f.o || []).map(o => `<option ${inp[f.k] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
          : `<input data-b="${f.k}" type="${f.t === 'text' ? 'text' : 'number'}" ${f.t === 'number' ? 'step="any"' : ''} value="${esc(inp[f.k] ?? '')}" ${canEdit ? '' : 'disabled'} placeholder="${f.hint || ''}" oninput="budgetPreview()">`}
          ${f.hint ? `<div style="font-size:11px;color:var(--text-4);margin-top:2px">${f.hint}</div>` : ''}</div>`).join('')}
      </div>`).join('')}
  </div>
  <div class="card"><h3>自动测算(服务端实算,与预算表公式同口径)</h3><div id="bComputed"></div>
    ${canEdit ? `<div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn" onclick="saveBudget(${id},false)">保存预算表</button>
      ${['draft','returned'].includes(B_REVIEW.status) ? `<button class="btn pri" onclick="saveBudget(${id},true)">保存并提交评审</button>` : ''}
      <span style="font-size:12px;color:var(--text-4)">不想在线填?也可返回单据页上传 Excel 预算表附件后提交</span>
    </div>` : ''}
  </div>`;
  budgetPreview();
}
async function aiFillBudget() {
  const text = $('#aiText').value.trim();
  if (!text) return toast('请先粘贴文字', 1);
  const model = $('#aiModel').value;
  $('#aiBtn').disabled = true; $('#aiBtn').textContent = '识别中…';
  try {
    const d = await api('/api/llm/fill-budget', 'POST', { text, model });
    let n = 0;
    for (const [k, v] of Object.entries(d.fields || {})) {
      const el = document.querySelector(`[data-b="${k}"]`);
      if (el && (typeof v === 'number' || typeof v === 'string')) { el.value = v; n++; } // 任务2.8: 兼容 dev_dept 下拉/文本字段
    }
    const mName = d.model === 'deepseek-reasoner' ? 'Pro' : 'Flash';
    if (d.fields && d.fields.note) $('#aiNote').textContent = `AI 备注(${mName}):` + d.fields.note;
    budgetPreview();
    toast(n > 0 ? `${mName} 已填充 ${n} 个字段,请核对后保存` : 'AI 未识别出可用字段,请手动填写');
  } catch (e) { toast(e.message, 1); }
  finally { $('#aiBtn').disabled = false; $('#aiBtn').textContent = 'AI 识别填充'; }
}
async function saveBudget(id, andSubmit) {
  const inputs = collectBudgetInputs();
  try {
    await api(`/api/reviews/${id}/budget`, 'PUT', { inputs }); // 任务2.8: 服务端实算, 删前端本地计算
    if (andSubmit) {
      await api(`/api/reviews/${id}/submit`, 'POST');
      toast('已提交,前置评审任务已分发');
    } else {
      toast('预算表已保存(服务端实算),可作为提交材料');
    }
    location.hash = (B_REVIEW && B_REVIEW.opp_code) ? '#/opp/' + encodeURIComponent(B_REVIEW.opp_code) : '#/review/' + id;
  } catch (e) { toast(e.message, 1); }
}

// ---- #/agent 智能体·技能①预算编制(任务2.7, §4.6 组件树): 左列 55% chat + 右列 45% preview ----
let AG = null; // { budgetId, code, version, status, draft, calc, changed, missing }
const AG_MISSING = ['contract', 'sub_cost', 'dev_dept', 'dev_pd', 'del_travel'];
const AG_MISSING_LABELS = { contract: '合同金额(元)', sub_cost: '分包成本(元)', dev_dept: '交付部门', dev_pd: '正编人天(天)', del_travel: '交付差旅(元)' };
async function renderAgent() {
  const qs = new URLSearchParams((location.hash.split('?')[1] || ''));
  const oppCode = qs.get('opp');
  if (oppCode) return renderRobotWorkbench(oppCode); // 机器人统一工作台; 无 opp 时下面分支一行不改
  const bId = qs.get('b');
  const rId = qs.get('r');
  if (rId === 'pick') return renderAgentReviewPick();
  if (rId) return renderAgentReview(rId);
  if (!bId) return renderAgentPick();
  await mountAgentChat(bId, '#page');
  // 注①: 技能切换行只属于 #/agent 独立页, mountAgentChat 模板不含 agSkill(商机360°内嵌时不注入)
  if (AG && AG.budgetId == bId) $('#page').insertAdjacentHTML('afterbegin', `
    <div class="card agent-top"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <select id="agSkill" title="技能切换" onchange="location.hash=this.value==='review'?'#/agent?r=pick':'#/agent'"><option value="budget">技能① 预算编制</option><option value="review">技能② 评审表编制</option></select>
    </div></div>`);
}

// ---- 机器人统一工作台(#/agent?opp=<code>): 一条商机的交付预算/项目预算/项目评审三段聚合 ----
// 铁律2: 机器人只产草稿——确认、锁定、提交只能由人点按钮走原有端点; 行集、状态、能力位一律取服务端返回, 前端不复制门禁判据。
let RWB = null; // { code, opp, delivery, budgets, reviews, capabilities, provider, tab, dlText, deliveryDraft }
const RWB_TABS = [['delivery', '交付预算'], ['budget', '项目预算'], ['review', '项目评审']];
const RWB_COLS = [['content', '建设内容'], ['stage', '阶段'], ['pm_pd', 'PM人天'], ['own_pd', '正编人天'],
  ['rd_pd', '产研外包人天'], ['prod_pd', '生产外包人天'], ['travel_cost', '差旅招待(元)'], ['note', '备注']];
const rwbDlStatusText = s => s === 'confirmed' ? '状态: 已确认(G1 已过)' : s === 'draft' ? '状态: 草稿' : '状态: 未编制';
const rwbCanEdit = () => !!(RWB && RWB.capabilities && RWB.capabilities.can_edit_delivery);
function rwbSetDlText(v) { if (RWB) RWB.dlText = v; }
async function renderRobotWorkbench(code) {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash; // 慢页竞态守卫
  let d;
  try {
    d = await api('/api/robot/workbench?opp_code=' + encodeURIComponent(code));
  } catch (e) {
    if (location.hash !== h0) return;
    page.innerHTML = `<div class="card"><h3>机器人工作台</h3><div class="empty">${esc(e.message)}</div>
      <div style="margin-top:10px"><button class="btn" onclick="goBack('#/opps')">返回商机列表</button></div></div>`;
    return;
  }
  if (location.hash !== h0) return;
  RWB = {
    code: (d.opp && d.opp.opp_code) || code, opp: d.opp || {}, delivery: d.delivery || { status: 'none', rows: [] },
    budgets: d.budgets || [], reviews: d.reviews || [], capabilities: d.capabilities || {}, provider: d.provider || {},
    tab: 'delivery', dlText: '', deliveryDraft: null
  };
  renderRobotWb();
}
// 状态刷新后保持当前页签; 只读聚合端点, 任何写动作之后重取一次即与服务端一致
async function robotWbReload() {
  if (!RWB) return;
  const code = RWB.code;
  try {
    const d = await api('/api/robot/workbench?opp_code=' + encodeURIComponent(code));
    if (!RWB || RWB.code !== code) return;
    RWB.delivery = d.delivery || { status: 'none', rows: [] };
    RWB.budgets = d.budgets || [];
    RWB.reviews = d.reviews || [];
    RWB.capabilities = d.capabilities || {};
    RWB.provider = d.provider || {};
    RWB.deliveryDraft = null;
    renderRobotWb();
  } catch (e) { toast(e.message, 1); }
}
function renderRobotWb() {
  const page = $('#page');
  if (!RWB) return;
  const p = RWB.provider || {};
  const dl = RWB.delivery || {};
  const lockedB = RWB.budgets.filter(b => b.status === 'locked').length;
  page.innerHTML = `
  <div class="card"><h3>机器人工作台 · ${esc(RWB.opp.title || RWB.code)}
    <a class="btn sm" href="#/agent" onclick="goBack('#/agent');return false" style="float:right;margin-right:10px">← 返回</a><a href="#/opp/${encodeURIComponent(RWB.code)}" style="float:right;font-size:13px">商机 360° →</a></h3>
    <div class="dlv-sum-row"><span>商机代码 <b style="font-family:monospace">${esc(RWB.code)}</b></span>
      <span>客户 <b>${esc(RWB.opp.customer || '—')}</b></span>
      <span>① 交付预算 <b>${dl.status === 'confirmed' ? '已确认' : dl.status === 'draft' ? '草稿' : '未编制'}</b></span>
      <span>② 项目预算 <b>${RWB.budgets.length}</b> 张(已锁定 ${lockedB})</span>
      <span>③ 项目评审 <b>${RWB.reviews.length}</b> 张(草稿 ${RWB.reviews.filter(r => r.status === 'draft').length})</span></div>
    <div class="std-box" id="robotMode">${esc(p.message || '生成待发送草稿（本地预演）')};机器人只生成草稿,确认、锁定和提交必须由你点击。</div>
    <nav class="tabbar" id="robotWorkbenchTabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      ${RWB_TABS.map(([k, l]) => `<button class="btn sm${RWB.tab === k ? ' pri' : ''}" data-rwt="${k}" onclick="setRobotWbTab('${k}')">${l}</button>`).join('')}
    </nav>
    <div id="robotWbPanel"></div>
  </div>`;
  renderRobotWbPanel();
}
function setRobotWbTab(k) {
  if (!RWB) return;
  RWB.tab = k;
  document.querySelectorAll('#robotWorkbenchTabs [data-rwt]').forEach(b => b.classList.toggle('pri', b.dataset.rwt === k));
  renderRobotWbPanel();
}
function renderRobotWbPanel() {
  const box = $('#robotWbPanel');
  if (!box || !RWB) return;
  box.innerHTML = RWB.tab === 'budget' ? rwbBudgetPanel() : RWB.tab === 'review' ? rwbReviewPanel() : rwbDeliveryPanel();
}
function rwbDraftTableHtml() {
  const rows = RWB.deliveryDraft || (RWB.delivery && RWB.delivery.rows) || [];
  if (!rows.length) return `<div class="empty">${RWB.deliveryDraft ? '本轮未生成任何行,请补充描述后重新生成。' : '尚无交付预算明细:可口述生成草稿、上传附3 Excel,或在商机 360° 在线建行。'}</div>`;
  return `<div class="card-table-wrap"><table><thead><tr>${RWB_COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${RWB_COLS.map(([k]) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function rwbDeliveryPanel() {
  const dl = RWB.delivery || {};
  const fromDraft = !!RWB.deliveryDraft;
  const sum = dl.sum || null;
  const edit = rwbCanEdit();
  return `
  <div class="std-box" style="margin-top:12px">口述交付明细 → 机器人生成八列草稿行(只在下方表格内, 不写库)。点【保存交付草稿】才落到商机交付预算(草稿态), 再点【确认交付预算】才完成 G1;口头说「确认」不生效。</div>
  <div style="display:flex;gap:8px;align-items:flex-end;margin:10px 0">
    <textarea id="rwdText" placeholder="如:交付明细 数据实施,PM 2 人天、正编 3 人天、产研外包 1 人天、生产外包 4 人天,差旅 6000"
      style="flex:1;min-height:56px" oninput="rwbSetDlText(this.value)">${esc(RWB.dlText || '')}</textarea>
    <button class="btn pri" id="rwdGenerate" onclick="robotDeliveryGenerate()" ${edit ? '' : 'disabled'}>生成草稿</button>
  </div>
  <div id="robotDeliveryDraft">${rwbDraftTableHtml()}</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
    <input type="file" id="rwdFile" accept=".xlsx" style="font-size:12.5px" onchange="robotDeliveryImport(this)">
    <button class="btn sm pri" id="rwdSave" onclick="robotDeliverySave()" ${edit ? '' : 'disabled'}>保存交付草稿</button>
    <button class="btn sm pri" id="rwdConfirm" onclick="robotDeliveryConfirm()" ${edit ? '' : 'disabled'}>确认交付预算</button>
    <span style="font-size:12.5px;color:var(--text-4)">${rwbDlStatusText(dl.status)}${fromDraft ? ' · 当前表内为机器人生成的草稿,尚未保存' : ''}${edit ? '' : ' · 当前账号只读(服务端能力位)'}</span>
  </div>
  ${!fromDraft && sum ? `<div class="dlv-sum-row" style="margin-top:10px"><span>PM人天 <b>${sum.pm_pd}</b></span><span>正编人天 <b>${sum.own_pd}</b></span>
    <span>产研外包 <b>${sum.rd_pd}</b></span><span>生产外包 <b>${sum.prod_pd}</b></span><span>差旅招待 <b>${Number(sum.travel_cost || 0).toLocaleString('zh-CN')}</b> 元</span>
    <span>交付成本合计 <b>${Number(sum.cost || 0).toLocaleString('zh-CN')}</b> 元</span><span>正编单价 <b>${dl.rate ?? '—'}</b> 元/天</span></div>` : ''}
  ${dl.source_file ? `<div style="font-size:12px;color:var(--text-4);margin-top:6px">源文件 ${esc(dl.source_file)}</div>` : ''}`;
}
async function robotDeliveryGenerate() {
  if (!RWB) return;
  const msg = String(($('#rwdText') || {}).value || '').trim();
  if (!msg) return toast('请先口述交付明细', 1);
  const btn = $('#rwdGenerate'); btn.disabled = true; btn.textContent = '生成中…';
  try {
    const d = await api('/api/agent/chat', 'POST', { skill: 'delivery', opp_code: RWB.code, message: msg });
    RWB.deliveryDraft = ((d.draft || {}).rows) || [];
    const box = $('#robotWbPanel'); if (box) box.innerHTML = rwbDeliveryPanel();
    toast(d.degraded ? '大模型暂不可用,本轮未生成草稿,请手工补齐或上传附3' : `已生成 ${RWB.deliveryDraft.length} 行草稿(未写库),请核对后点保存`);
  } catch (e) { toast(e.message, 1); }
  finally { const b = $('#rwdGenerate'); if (b) { b.disabled = false; b.textContent = '生成草稿'; } }
}
async function robotDeliverySave() {
  if (!RWB) return;
  if (!RWB.deliveryDraft) return toast('当前表内没有待保存的草稿行:请先口述生成或上传附3', 1); // 空输入守卫(无内容可发), 非业务门禁
  try {
    const d = await api('/api/opp/' + encodeURIComponent(RWB.code) + '/delivery', 'PUT', { rows: RWB.deliveryDraft });
    toast(`交付预算草稿已保存(${(d.rows || []).length} 行,合计 ${Number((d.sum || {}).cost || 0).toLocaleString('zh-CN')} 元),尚未确认`);
    await robotWbReload();
  } catch (e) { toast(e.message, 1); }
}
async function robotDeliveryConfirm() {
  if (!RWB) return;
  if (RWB.deliveryDraft) return toast('请先保存交付草稿再确认', 1); // 未落库的内存草稿无法确认; 行集空/已确认/非自有一律由后端裁决
  try {
    await api('/api/opp/' + encodeURIComponent(RWB.code) + '/delivery/confirm', 'POST', {});
    toast('交付预算已确认 → 下一步可锁定项目预算(②)');
    await robotWbReload();
  } catch (e) { toast(e.message, 1); }
}
async function rwbUploadXlsx(input, path, body) {
  const f = input.files[0];
  if (!f) return null;
  if (f.size > 10 * 1024 * 1024) { toast('文件不能超过 10MB', 1); input.value = ''; return null; }
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return await api(path, 'POST', Object.assign({ filename: f.name, data: btoa(bin) }, body || {}));
  } catch (e) { toast(e.message, 1); return null; }
  finally { input.value = ''; }
}
async function robotDeliveryImport(input) {
  if (!RWB) return;
  const d = await rwbUploadXlsx(input, '/api/opp/' + encodeURIComponent(RWB.code) + '/delivery/import');
  if (!d) return;
  toast(`附3 已解析 ${((d.rows || []).length)} 行入草稿(合计 ${Number((d.sum || {}).cost || 0).toLocaleString('zh-CN')} 元)——请核对后确认`);
  await robotWbReload();
}
function rwbBudgetPanel() {
  const edit = rwbCanEdit();
  return `
  <div class="std-box" style="margin-top:12px">机器人只列清单与深链,不在本页编制。进入 <b>#/agent?b=单号</b> 用技能①对话编制,确认锁定仍须你点击。</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0">
    <button class="btn sm pri" data-obc="${esc(RWB.code)}" onclick="oppBudgetCreate(this.dataset.obc)">＋ 新建项目预算(挂靠本商机)</button>
    <input type="file" id="rwbFile" accept=".xlsx" style="font-size:12.5px" onchange="robotBudgetImport(this)">
    <span style="font-size:12.5px;color:var(--text-4)">上传附1 预算表建单${edit ? '' : ' · 当前账号只读(服务端能力位)'}</span>
  </div>
  ${RWB.budgets.length ? `<div class="card-table-wrap"><table>
    <tr><th>单号</th><th>版本</th><th>状态</th><th>项目名称</th><th>更新时间</th><th class="ops">操作</th></tr>
    ${RWB.budgets.map(b => `<tr><td><b>${esc(b.code)}</b></td><td>v${b.version}</td>
      <td>${b.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td>
      <td>${esc(b.project_name || '')}</td><td>${fmtT(b.updated_at)}</td>
      <td class="ops"><a href="#/agent?b=${b.id}">进入对话编制</a> · <a href="#/budget-detail/${b.id}">详情</a></td></tr>`).join('')}
  </table></div>` : '<div class="empty">该商机还没有项目预算单(②)。新建或上传附1 后,在此进入技能①对话编制。</div>'}`;
}
async function robotBudgetImport(input) {
  if (!RWB) return;
  const d = await rwbUploadXlsx(input, '/api/budget/import');
  if (!d) return;
  const m = d.meta || {};
  toast(`Excel 导入建预算单 #${d.id}(${Object.keys(d.fields || {}).length} 字段,命中 ${m.matched ?? '?'}/${m.pairs_total ?? '?'})——请进入对话核对后锁定`);
  await robotWbReload();
}
function rwbReviewPanel() {
  const edit = rwbCanEdit();
  const target = RWB.reviews[0] || null; // 只作"本轮口述打到哪张"的显示提示(列表已按 updated_at DESC); 不参与禁用, 存在性/状态/所有权由后端裁决
  return `
  <div class="std-box" style="margin-top:12px">机器人只列清单与深链,不在本页提交。进入 <b>#/agent?r=单号</b> 用技能②编制与预判,提交评审仍须你点击;判灯由系统规则,不经大模型。</div>
  <div style="display:flex;gap:8px;align-items:flex-end;margin:10px 0">
    <textarea id="rwrText" placeholder="口述评审表字段(如:客户××,合同 24 万),或发「预判一下灯」;说"用 B-xxxx 建投标评审单"可先建草稿" style="flex:1;min-height:56px"></textarea>
    <button class="btn pri" id="rwrGenerate" onclick="robotReviewGenerate()" ${edit ? '' : 'disabled'}>生成草稿</button>
  </div>
  <div id="rwrReply" style="font-size:12.5px;color:var(--text-3);margin-bottom:8px">${target ? `本轮口述打到: 评审 #${target.id}(${statusPill(target.status)},最近一张)· 若这不是你要编的那张,请点下方列表的「进入对话编制」` : '该商机暂无评审单:可口述"用 B-xxxx 建投标评审单"建草稿,或上传信息收集表,也可在技能②建单。'}</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
    <select id="rwrType"><option value="bid">投标决策评审</option><option value="presale">售前立项评审</option></select><span class="hint">变更决策无 Excel 模板，请在线填写</span>
    <input type="file" id="rwrFile" accept=".xlsx" style="font-size:12.5px" onchange="robotReviewImport(this)">
    <span style="font-size:12.5px;color:var(--text-4)">上传评审表建草稿${edit ? '' : ' · 当前账号只读(服务端能力位)'}</span>
  </div>
  ${RWB.reviews.length ? `<div class="card-table-wrap"><table>
    <tr><th>项目</th><th>类型</th><th>状态</th><th>灯色</th><th>更新时间</th><th class="ops">操作</th></tr>
    ${RWB.reviews.map(r => `<tr><td><b>${esc(r.title)}</b></td><td>${TYPE_NAMES[r.type] || esc(r.type)}</td>
      <td>${statusPill(r.status)}</td><td>${lightPill(r.light)}</td><td>${fmtT(r.updated_at)}</td>
      <td class="ops"><a href="#/agent?r=${r.id}">进入对话编制</a> · <a href="#/review/${r.id}">详情</a> · <a href="#/tasks?review_id=${r.id}">打灯任务</a></td></tr>`).join('')}
  </table></div>` : '<div class="empty">该商机还没有项目评审单(③)。</div>'}`;
}
async function robotReviewGenerate() {
  if (!RWB) return;
  const msg = String(($('#rwrText') || {}).value || '').trim();
  if (!msg) return toast('请先口述评审表信息', 1);
  const target = RWB.reviews[0] || null; // 目标单只取"最近一张"作路由, 不按 status 预判; 无单时不带 review_id, 由后端 400「未选择评审单」或建单路由裁决
  const btn = $('#rwrGenerate'); btn.disabled = true; btn.textContent = '思考中…';
  try {
    const d = await api('/api/agent/chat', 'POST', target ? { skill: 'review', review_id: target.id, message: msg } : { skill: 'review', message: msg });
    await robotWbReload(); // 建单路由会新落一张草稿: 先重载列表, 再把本轮回复写进新屏的 #rwrReply
    const el = $('#rwrReply');
    if (el) el.innerHTML = esc(d.reply || '').replace(/\n/g, '<br>') + (d.degraded ? '<br><span style="color:#ef7b84">(大模型暂不可用,已降级为点选问答)</span>' : '') + '<br><span style="color:var(--text-4)">(只更新草稿,未提交;提交与判灯由服务端裁决)</span>';
    toast('本轮口述已回写(未提交)');
  } catch (e) { toast(e.message, 1); } // 400/403 一律透传后端文案, 前端不预判
  finally { const b = $('#rwrGenerate'); if (b) { b.disabled = rwbCanEdit() ? false : true; b.textContent = '生成草稿'; } }
}
async function robotReviewImport(input) {
  if (!RWB) return;
  const type = ($('#rwrType') || {}).value || 'bid';
  if (type === 'change') return toast('变更决策无 Excel 模板，请在线填写', 1);
  const d = await rwbUploadXlsx(input, '/api/reviews/import', { type });
  if (!d) return;
  const m = d.meta || {};
  toast(`Excel 导入评审草稿 #${d.id}(${Object.keys(d.form || {}).length} 字段,命中 ${m.matched ?? '?'}/${m.pairs_total ?? '?'})——请核对后提交`);
  await robotWbReload();
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
async function renderAgentPick() { // 进页先选/建预算单(§4.6)
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash; // 慢页竞态守卫
  const d = await api('/api/budget');
  if (location.hash !== h0) return;
  page.innerHTML = `
  <div class="card"><h3>智能体 · 技能① 预算编制 <a href="#/agent?r=pick" style="float:right;font-size:13px">切换技能② 评审表编制 →</a>
    <button class="btn pri sm" style="float:right;margin-right:14px" onclick="agentNewBudget()">新建预算单</button>
    <button class="btn sm" style="float:right;margin-right:8px" onclick="$('#impBudgetFile').click()">上传 Excel 建预算单</button>
    <input type="file" id="impBudgetFile" accept=".xlsx" style="display:none" onchange="importBudgetExcel(this)">
  </h3>
    <div class="std-box">口述预算(如"合同 240 万,分包 100 万"),智能体自动翻译为预算表字段并实时精算;必填齐后点【确认锁定】(口头确认不生效)。</div>
    ${d.budgets.length === 0 ? '<div class="empty">还没有预算单,点击右上角新建</div>' : `<table>
      <tr><th>单号</th><th>版本</th><th>状态</th><th>项目名称</th><th>更新时间</th><th>操作</th></tr>
      ${d.budgets.map(b => `<tr>
        <td><b>${esc(b.code)}</b></td><td>v${b.version}</td>
        <td>${b.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td>
        <td>${esc(b.project_name || '')}</td><td>${fmtT(b.updated_at)}</td>
        <td><button class="btn sm pri" onclick="location.hash='#/agent?b=${b.id}'">进入对话</button></td>
      </tr>`).join('')}</table>`}
  </div>`;
}
async function agentNewBudget() {
  const name = (window.prompt('预算单项目名称(可留空)') || '').trim();
  try {
    const d = await api('/api/budget', 'POST', { project_name: name });
    location.hash = '#/agent?b=' + d.id;
  } catch (e) { toast(e.message, 1); }
}
// Excel 导入建预算单(含附1-预算表的评审表模板)——导入后出核对视图(左字段+右原表高亮)
async function importBudgetExcel(input) {
  const f = input.files[0];
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const d = await api('/api/budget/import', 'POST', { filename: f.name, data: btoa(bin) });
    toast(`Excel 导入成功(${Object.keys(d.fields || {}).length} 字段)——请核对下方字段与原表来源`);
    renderImportReview(d, { title: '预算单导入核对', fields: d.fields || {}, nextLabel: '进入预算单核对/锁定', onNext: () => { location.hash = '#/agent?b=' + d.id; } });
  } catch (e) { toast(e.message, 1); }
  input.value = '';
}
// 评审单 Excel 导入(类型选择页)——导入后出核对视图
async function importReviewExcel() {
  const f = $('#impFile').files[0];
  if (!f) return toast('请先选择评审表 Excel 文件', 1);
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  const type = $('#impType').value;
  if (type === 'change') return toast('变更决策无 Excel 模板，请在线填写', 1);
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const d = await api('/api/reviews/import', 'POST', { filename: f.name, type, data: btoa(bin) });
    toast(`Excel 导入成功(${Object.keys(d.form || {}).length} 字段)——请核对下方字段与原表来源`);
    renderImportReview(d, { title: '评审单导入核对', fields: d.form || {}, nextLabel: '进入草稿编辑(补齐后提交)', onNext: () => { location.hash = '#/new/' + type; setTimeout(() => renderForm(type, d.id), 60); } });
  } catch (e) { toast(e.message, 1); }
}
// 导入核对视图: 左字段表(含来源坐标) + 右 Excel 原表网格(命中单元格高亮)
function impRvGridHtml(grid, labSet, valSet) {
  if (!grid.length) return '<div class="empty">无网格数据</div>';
  const maxC = grid.reduce((m, row) => Math.max(m, ...(row || []).map(c => c.c)), 0) + 1;
  return `<table style="font-size:11.5px">${grid.map(row => `<tr>${Array.from({ length: maxC }, (_, c) => {
    const cell = (row || []).find(x => x.c === c);
    if (!cell) return '<td style="border:none"></td>';
    const isLab = labSet[cell.r + ',' + cell.c];
    const isVal = valSet[cell.r + ',' + cell.c];
    const style = isVal ? 'background:rgba(63,192,156,.18);border:1px solid rgba(63,192,156,.5)' : (isLab ? 'border:1.5px solid var(--brand);color:var(--brand)' : 'border:1px solid var(--border-default)');
    return `<td id="impRvC_${cell.r}_${cell.c}" style="${style};padding:3px 6px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(cell.v)}">${esc(cell.v)}</td>`;
  }).join('')}</tr>`).join('')}</table>`;
}
// 点击左栏行→右栏对应单元格聚焦(强高亮+滚动定位)
function impRvPickCells(posArr) {
  document.querySelectorAll('.imp-rv-pick').forEach(c => c.classList.remove('imp-rv-pick'));
  let first = null;
  (posArr || []).forEach(p => {
    if (!p) return;
    const cell = document.getElementById(`impRvC_${p[0]}_${p[1]}`);
    if (!cell) return;
    cell.classList.add('imp-rv-pick');
    if (!first) first = cell;
  });
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return (posArr || []).filter(Boolean).length;
}
function renderImportReview(d, opts) {
  const page = $('#page');
  window._impRv = { d, opts };
  const fields = opts.fields || {};
  const sources = (d.audit || {}).sources || {};
  const grid = (d.audit || {}).grid || [];
  // 高亮坐标集: 标签=蓝框, 值=绿底
  const labSet = {}, valSet = {};
  for (const [k, s] of Object.entries(sources)) {
    if (fields[k] === undefined) continue;
    if (s.lab_pos) labSet[s.lab_pos[0] + ',' + s.lab_pos[1]] = k;
    if (s.val_pos) valSet[s.val_pos[0] + ',' + s.val_pos[1]] = k;
    (s.val_positions || []).forEach(p => { if (Array.isArray(p)) valSet[p[0] + ',' + p[1]] = k; });
  }
  const keys = Object.keys(fields);
  window._impRv.keys = keys;
  page.innerHTML = `
  <div class="card"><h3>${esc(opts.title)} <span class="pill p-green">已导入 #${d.id}</span>
    <span style="font-size:12px;color:var(--text-4);font-weight:400">左:解析字段(点击行→右侧聚焦来源) · 右:Excel 原表(蓝色=标签格 · 绿色=取值格)</span></h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch">
      <div class="imp-rv-panel imp-rv-left" style="flex:1;min-width:340px">
        <div class="imp-rv-ph">解析结果 · 正式字段(${keys.length}) <span style="font-weight:400;font-size:11px;color:var(--text-4)">点击任一行, 右侧原表对应单元格将高亮定位</span></div>
        <div class="imp-rv-pb">
          <div class="card-table-wrap"><table id="impRvL">
            <tr><th>字段</th><th>解析值</th><th>来源(原表)</th><th>位置</th></tr>
            ${keys.map((k, i) => {
              const s = sources[k];
              return `<tr${s ? ` onclick="impRvFocus(${i})"` : ''}>
                <td style="font-family:monospace;font-size:12px">${esc(k)}</td>
                <td>${esc(String(fields[k] ?? '').slice(0, 40))}</td>
                <td>${s ? esc(s.label) : '<span style="color:var(--text-4)">—</span>'}</td>
                <td style="font-size:11px;font-family:monospace">${s && s.val_pos ? 'R' + s.val_pos[0] + 'C' + s.val_pos[1] : (s && s.lab_pos ? 'R' + s.lab_pos[0] + 'C' + s.lab_pos[1] : '')}</td>
              </tr>`;
            }).join('')}
          </table></div>
          ${(d.warnings || []).length ? `<div style="font-size:12px;color:var(--text-4);margin-top:6px">未匹配标签: ${(d.warnings || []).slice(0, 6).map(esc).join(' | ')}</div>` : ''}
        </div>
      </div>
      <div class="imp-rv-panel imp-rv-right" style="flex:1.2;min-width:380px">
        <div class="imp-rv-ph">源头证据 · Excel 原表 <span style="font-weight:400;font-size:11px;color:var(--text-4)">sheet: ${esc((d.meta || {}).sheet || '')} · 前 ${grid.length} 行 · 蓝框=标签格 · 绿底=取值格</span></div>
        <div class="imp-rv-pb" style="max-height:520px;overflow:auto">${impRvGridHtml(grid, labSet, valSet)}</div>
      </div>
    </div>
    <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
      <button class="btn pri" onclick="impRvNext()">${esc(opts.nextLabel)} →</button>
      <button class="btn" onclick="goBack('#/opps')">返回</button>
      <span style="font-size:12px;color:var(--text-4)">${fields.contract != null && d.calc ? '实算毛利率 ' + (d.calc.margin ?? d.calc.margin_percent ?? '') + '%' : ''}</span>
    </div>
  </div>`;
}
function impRvFocus(i) {
  const s = window._impRv; if (!s) return;
  const k = s.keys[i];
  const tr = document.querySelectorAll('#impRvL tr')[i + 1];
  document.querySelectorAll('#impRvL tr.imp-rv-sel').forEach(t => t.classList.remove('imp-rv-sel'));
  if (tr) tr.classList.add('imp-rv-sel');
  const sp = ((s.d.audit || {}).sources || {})[k];
  const n = impRvPickCells(sp ? [sp.lab_pos, sp.val_pos].concat(sp.val_positions || []) : []);
  if (!n) toast('该字段无原表来源(来自默认值或回退链)', 1);
}
function impRvNext() { const s = window._impRv; if (s && s.opts.onNext) s.opts.onNext(); }

// ---- 技能② 评审表编制 + 技能③ 预判(阶段3, 任务 3.3/3.7): #/agent?r=pick / #/agent?r=N ----
let AGV = null; // { reviewId, id, type, status, draft, missing, preview }
const BID_REQUIRED_FE = ['customer', 'contract_amount', 'sub_amount', 'province', 'secret', 'jiadao', 'settle_method', 'sign_path',
  'product_type', 'b2b_scene', 'revenue_confirm', 'promo_target', 'promo_amount', 'promo_outside', 'guarantee', 'non_compete', 'sub_limit'];
async function renderAgentReviewPick() { // 技能②选单: 列我的评审草稿 + 建单引导
  const page = $('#page');
  showLoading(page);
  const d = await api('/api/reviews');
  const drafts = (d.reviews || []).filter(r => r.status === 'draft');
  page.innerHTML = `
  <div class="card"><h3>智能体 · 技能② 评审表编制 <a class="btn sm" href="#/agent" onclick="goBack('#/agent');return false" style="float:right;margin-right:10px">← 返回</a><a href="#/agent" style="float:right;font-size:13px">切换技能① 预算编制 →</a></h3>
    <div class="std-box">对话式编制评审表：先发"用 B-xxxx 建投标评审单"把预算单字段带入，再口述补充(如"客户江西省自然资源测绘与监测院，合同 24 万")；必填齐后发"预判一下灯"查看灯色预判。判灯/预判为系统规则，不经大模型。</div>
    ${drafts.length === 0 ? '<div class="empty">还没有评审草稿。发"用 B-xxxx 建投标评审单"开始,或在"新建评审单"页创建。</div>' : `<table>
      <tr><th>项目</th><th>类型</th><th>状态</th><th>更新时间</th><th>操作</th></tr>
      ${drafts.map(r => `<tr>
        <td><a href="#/agent?r=${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type]}</td>
        <td>${statusPill(r.status)}</td><td>${fmtT(r.updated_at)}</td>
        <td><button class="btn sm pri" onclick="location.hash='#/agent?r=${r.id}'">进入对话</button></td>
      </tr>`).join('')}</table>`}
  </div>`;
}
async function renderAgentReview(rId) { // 技能②独立页薄包装: mount 后注入顶栏(技能切换+单号+切换草稿), 内嵌360°不注入
  await mountAgentReviewChat(rId, '#page');
  if (AGV && AGV.id == rId) $('#page').insertAdjacentHTML('afterbegin', `
    <div class="card agent-top"><div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <select id="agSkill" title="技能切换" onchange="location.hash=this.value==='review'?'#/agent?r=pick':'#/agent'"><option value="budget">技能① 预算编制</option><option value="review" selected>技能② 评审表编制</option></select>
      <span id="agTop"><b>#${AGV.id} <span class="pill p-gray">${statusPill(AGV.status).replace(/<[^>]+>/g, '')}</span></b></span>
      <a href="#/agent?r=pick" style="margin-left:auto;font-size:13px">切换评审草稿</a>
    </div></div>`);
}
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
async function sendAgentReviewMsg() { // 技能②发送: skill='review' → 建单/预判/字段抽取三路由
  if (!AGV) return;
  const ta = $('#agInput'); const msg = ta.value.trim();
  if (!msg) return;
  const box = $('#agMsgs');
  box.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(msg).replace(/\n/g, '<br>')}</div>`);
  ta.value = '';
  box.scrollTop = box.scrollHeight;
  const btn = $('#agSend'); btn.disabled = true; btn.textContent = '思考中…';
  try {
    const d = await api('/api/agent/chat', 'POST', { skill: 'review', review_id: AGV.reviewId, message: msg });
    AGV.draft = d.draft || AGV.draft;
    AGV.missing = d.missing || [];
    AGV.preview = d.preview || null;
    AGV.reviewId = d.review_id || AGV.reviewId;
    box.insertAdjacentHTML('beforeend', `<div class="msg assistant">${esc(d.reply || '').replace(/\n/g, '<br>')}${d.degraded ? '<br><span style="color:#ef7b84;font-size:12px">(大模型暂不可用,已降级)</span>' : ''}</div>`);
    if (AGV.missing.length === 0 && AGV.status === 'draft' && !AGV.preview)
      $('#agWidget').innerHTML = `<div style="font-size:13px;color:#3fc09c;margin-bottom:8px">必填项已齐,可提交评审或发"预判一下灯"。</div>`;
    else $('#agWidget').innerHTML = '';
    renderAgentReviewPreview();
  } catch (e) { toast(e.message, 1); }
  finally { btn.disabled = false; btn.textContent = '发送'; box.scrollTop = box.scrollHeight; }
}
function renderAgentReviewPreview() { // 技能②右列: 评审草稿字段只读(必填缺失高亮) + 预判卡(A-17)
  const el = $('#agPrev'); if (!el || !AGV) return;
  const fields = FIELDS[AGV.type] || [];
  const zh = AGV.preview ? ({ red: '红灯', yellow: '黄灯', green: '绿灯' }[AGV.preview.light] || AGV.preview.light) : null;
  el.innerHTML = `
  <h3>评审草稿(只读,缺项高亮)</h3>
  ${AGV.missing.length ? `<div style="font-size:13px;color:#ef7b84;margin-bottom:8px">必填还缺 ${AGV.missing.length} 项:${AGV.missing.map(k => fields.find(f => f.k === k)?.l || k).join('/')}</div>` : '<div style="font-size:13px;color:#3fc09c;margin-bottom:8px">必填项已齐。</div>'}
  <table>${fields.map(f => `<tr${AGV.missing.includes(f.k) ? ' style="background:var(--danger-soft)"' : ''}><th style="width:46%">${f.l}</th><td>${esc(AGV.draft[f.k] ?? '')}</td></tr>`).join('')}</table>
  ${AGV.preview ? `
  <div class="margin-card${AGV.preview.light === 'yellow' || AGV.preview.light === 'red' ? ' warn' : ''}">
    <div class="mc-l">预判灯色(dry-run)</div>
    <div class="mc-v">${zh}</div>
    <div style="font-size:12px;color:var(--text-3);margin-top:4px">${esc(AGV.preview.route || '')}</div>
  </div>
  ${(AGV.preview.items || []).filter(i => i.level !== 'green').length ? `<table style="margin-top:8px">${(AGV.preview.items || []).filter(i => i.level !== 'green').map(i => `<tr><th>${esc(i.name)}</th><td>${esc(i.reason)}</td></tr>`).join('')}</table>` : '<div style="font-size:13px;color:var(--text-3);margin-top:8px">无风险项。</div>'}` : ''}`;
}
async function sendAgentMsg() {
  if (!AG) return;
  const ta = $('#agInput'); const msg = ta.value.trim();
  if (!msg) return;
  const box = $('#agMsgs');
  box.insertAdjacentHTML('beforeend', `<div class="msg user">${esc(msg).replace(/\n/g, '<br>')}</div>`);
  ta.value = '';
  box.scrollTop = box.scrollHeight;
  const btn = $('#agSend'); btn.disabled = true; btn.textContent = '思考中…';
  try {
    const d = await api('/api/agent/chat', 'POST', { budget_id: AG.budgetId, message: msg });
    const prev = AG.draft;
    AG.draft = d.draft || {}; AG.calc = d.calc || null; AG.missing = d.missing || [];
    AG.changed = Object.keys(AG.draft).filter(k => !(k in prev) || String(prev[k]) !== String(AG.draft[k])); // 本轮变更字段(高亮 3s)
    appendAssistant(d);
    renderAgentPreview();
  } catch (e) { toast(e.message, 1); }
  finally { btn.disabled = false; btn.textContent = '发送'; box.scrollTop = box.scrollHeight; }
}
function appendAssistant(d) { // assistant 气泡 + 点选补齐(H-02) + actions 确认锁定(H-03, 人确认门)
  const box = $('#agMsgs');
  box.insertAdjacentHTML('beforeend', `<div class="msg assistant">${esc(d.reply || '').replace(/\n/g, '<br>')}</div>`);
  box.scrollTop = box.scrollHeight;
  let w = '';
  if (d.degraded && (d.missing || []).length) { // 降级态: missing 逐项输入框"点选补齐"(dev_dept 为枚举下拉)
    w += `<div class="ag-fill"><b>点选补齐(大模型暂不可用)</b>
      ${d.missing.map(k => `<div class="f-item"><label>${AG_MISSING_LABELS[k] || k}</label>${k === 'dev_dept'
        ? `<select data-fill="dev_dept"><option value="">未选择</option>${DEV_DEPTS.map(o => `<option>${o}</option>`).join('')}</select>`
        : `<input data-fill="${k}" type="number" step="any">`}</div>`).join('')}
      <button class="btn sm pri" onclick="agentFillSubmit()">补齐提交</button></div>`;
  }
  const lock = (d.actions || []).find(a => a.type === 'confirm_lock');
  if (lock && AG.status === 'draft') w += `<button class="btn pri" onclick="agentLock()">${esc(lock.label)}</button>`;
  $('#agWidget').innerHTML = w;
}
async function agentFillSubmit() { // H-02: 逐项点选补齐, 走 PUT 白名单写入
  const fields = {};
  document.querySelectorAll('[data-fill]').forEach(el => { if (String(el.value).trim() !== '') fields[el.dataset.fill] = el.value; });
  if (!Object.keys(fields).length) return toast('请至少填写一项', 1);
  try {
    await api('/api/budget/' + AG.budgetId, 'PUT', { fields });
    const bd = await api('/api/budget/' + AG.budgetId);
    AG.draft = bd.budget.fields || {}; AG.calc = bd.budget.calc || null; AG.status = bd.budget.status;
    AG.missing = AG_MISSING.filter(k => AG.draft[k] === undefined || AG.draft[k] === null || AG.draft[k] === '');
    renderAgentPreview();
    $('#agWidget').innerHTML = AG.missing.length === 0
      ? `<div style="font-size:13px;color:#3fc09c;margin-bottom:8px">必填项已齐,可锁定。</div>${AG.status === 'draft' ? `<button class="btn pri" onclick="agentLock()">确认锁定 v${AG.version}</button>` : ''}`
      : `<div style="font-size:13px;color:var(--text-3)">还缺 ${AG.missing.length} 项(${AG.missing.map(k => AG_MISSING_LABELS[k] || k).join('/')}),可继续对话或点选补齐。</div>`;
    toast('已补齐写入预算单');
  } catch (e) { toast(e.message, 1); }
}
async function agentLock() { // H-03: 人确认门——只有按钮能锁定, 口头确认不生效
  try {
    await api('/api/budget/' + AG.budgetId + '/lock', 'POST');
    AG.status = 'locked';
    refreshAgentTop();
    $('#agWidget').innerHTML = `<div style="font-size:13px;color:#3fc09c;margin-bottom:8px">已锁定 v${AG.version}。如需修改,请新建新版本。</div><button class="btn" onclick="agentNewVersion()">新建新版本 v${AG.version + 1}</button>`;
    toast('已锁定 v' + AG.version + ',可在新建评审单时关联');
  } catch (e) { toast(e.message, 1); }
}
async function agentNewVersion() {
  try {
    const d = await api('/api/budget/' + AG.budgetId + '/newversion', 'POST');
    location.hash = '#/agent?b=' + d.id;
  } catch (e) { toast(e.message, 1); }
}
function renderAgentPreview() { // 右列 45%: 分组只读 + 本轮变更高亮 3s + 精算卡(margin 大字, <10% 黄条)
  const el = $('#agPrev'); if (!el || !AG) return;
  const c = AG.calc || {};
  const fmt = n => (typeof n === 'number' && isFinite(n)) ? Math.round(n).toLocaleString('zh-CN') : '—';
  const margin = typeof c.margin === 'number' ? c.margin : null;
  const low = margin !== null && margin < 10;
  el.innerHTML = `
  <a href="#/delivery/${AG.budgetId}" class="card" style="display:block;margin-bottom:10px;padding:10px 14px;text-decoration:none">
    <b>交付成本评估明细(附3)</b> <span style="float:right;color:#6ea6e8;font-size:13px">上传/编制 →</span>
    <div style="font-size:12px;color:var(--text-3);margin-top:4px">锁定预算单前须编制交付明细(递进附件)</div>
  </a>
  <h3>预算草稿(只读,本轮变更高亮)</h3>
  ${BUDGET_GROUPS.map(g => `
    <div class="ag-g">${g.g}</div>
    <table>${g.items.map(f => `<tr${AG.changed.includes(f.k) ? ' class="hl-flash"' : ''}><th style="width:46%">${f.l}</th><td>${esc(AG.draft[f.k] ?? '')}</td></tr>`).join('')}</table>`).join('')}
  <div class="margin-card${low ? ' warn' : ''}">
    <div class="mc-l">贡献毛利率</div>
    <div class="mc-v">${margin !== null ? margin.toFixed(2) + '%' : '—'}</div>
    ${low ? '<div class="mc-w">低于 10%,提交评审将判黄灯</div>' : ''}
  </div>
  <table style="margin-top:10px">
    <tr><th>项目收入</th><td>${fmt(c.income)}</td></tr>
    <tr><th>净收入</th><td>${fmt(c.net)}</td></tr>
    <tr><th>销售成本</th><td>${fmt(c.salesCost)}</td></tr>
    <tr><th>交付成本</th><td>${fmt(c.delivery)}</td></tr>
    <tr><th>激励</th><td>${fmt(c.incentive)}</td></tr>
    <tr><th>贡献毛利</th><td>${fmt(c.contribution)}</td></tr>
  </table>`;
}
function refreshAgentTop() {
  const el = $('#agTop'); if (!el || !AG) return;
  el.innerHTML = `<b>${esc(AG.code)} <span class="pill ${AG.status === 'locked' ? 'p-green' : 'p-gray'}">v${AG.version} · ${AG.status === 'locked' ? '已锁定' : '草稿'}</span></b>`;
}

// ---- 附3交付成本评估明细(上传解析+在线编辑, 递进挂靠预算单): #/delivery/:budgetId ----
let DLV = null; // {budgetId, code, status, devDept, rate, rows[], source_file}
async function renderDeliveryPage(bid) {
  const page = $('#page');
  showLoading(page);
  try {
    const [bd, dd] = await Promise.all([api('/api/budget/' + bid), api('/api/budget/' + bid + '/delivery')]);
    const b = bd.budget;
    if (b.owner_id !== ME.id && ME.role !== '销售支持组' && ME.role !== 'admin') { toast('仅预算单所有者可编辑交付明细', 1); return location.hash = '#/agent'; }
    DLV = { budgetId: b.id, code: b.code, status: b.status, devDept: b.fields.dev_dept || '', rate: dd.rate, rd_price: dd.rd_price, prod_price: dd.prod_price, rows: dd.rows || [], source_file: dd.source_file };
    const parentHref = b.opp_code ? '#/opp/' + encodeURIComponent(b.opp_code) : '#/budgets';
    const parentName = b.opp_code ? '所属商机 · 信息收集' : '预算工作台';
    page.innerHTML = `
    ${crumbBar(parentHref, parentName, b.project_name || b.code)}
    <div class="card"><h3>交付成本评估明细(附3) <span class="pill ${b.status === 'locked' ? 'p-green' : 'p-gray'}">${b.code} v${b.version} · ${b.status === 'locked' ? '已锁定' : '草稿'}</span></h3>
      <div class="std-box">上传附3 Excel 自动解析为可编辑底稿(建设内容/人天/差旅招待), 也可直接在线建行; 行成本按交付部门单价(${b.fields.dev_dept || '未设置'} × ${dd.rate ?? '—'} 元/天)、外包单价与差旅招待实算。
      <b>递进门禁:锁定预算单前必须编制交付明细表</b>; 点【按明细刷新预算交付科目】把汇总回写到预算表(人确认,不自动覆盖)。</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <input type="file" id="dlvFile" accept=".xlsx" style="font-size:12.5px">
        <button class="btn sm pri" onclick="deliveryImport(${b.id})" ${b.status !== 'draft' ? 'disabled' : ''}>上传 Excel 解析</button>
        ${DLV.source_file ? `<span style="font-size:12px;color:var(--text-3)">源文件:${esc(DLV.source_file)}</span>` : ''}
      </div>
    </div>
    <div class="card"><h3>明细行(${(DLV.rows).length}) <button class="btn sm" style="float:right" onclick="deliveryAddRow()" ${b.status !== 'draft' ? 'disabled' : ''}>+ 加行</button>
      <button class="btn sm pri" style="float:right;margin-right:10px" onclick="deliverySave(${b.id})" ${b.status !== 'draft' ? 'disabled' : ''}>保存明细</button>
      <button class="btn sm" style="float:right;margin-right:10px" onclick="deliveryApply(${b.id})" ${b.status !== 'draft' ? 'disabled' : ''}>按明细刷新预算交付科目</button></h3>
      <div id="dlvTable"></div>
    </div>
    <div class="card" id="dlvSum"></div>`;
    deliveryRender();
  } catch (e) { toast(e.message, 1); location.hash = '#/agent'; }
}
function deliveryRender() {
  if (!DLV) return;
  const locked = DLV.status !== 'draft';
  const t = $('#dlvTable');
  if (!t) return;
  const totCost = deliveryCalcSum().cost || 1;
  t.innerHTML = DLV.rows.length ? `<div class="card-table-wrap"><table>
    <tr><th style="width:30%">建设内容</th><th>阶段</th><th>PM人天</th><th>正编人天</th><th>外包人天</th><th>生产人天</th><th>差旅招待</th><th class="num">行成本(元)</th><th>备注</th><th></th></tr>
    ${DLV.rows.map((r, i) => `<tr>
      <td><input data-di="${i}" data-dk="content" value="${esc(r.content)}" style="width:96%" ${locked ? 'disabled' : ''}></td>
      <td><select data-di="${i}" data-dk="stage" ${locked ? 'disabled' : ''}><option${r.stage === '实施' ? ' selected' : ''}>实施</option><option${r.stage === '运维' ? ' selected' : ''}>运维</option></select></td>
      ${['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'].map(k => `<td><input data-di="${i}" data-dk="${k}" type="number" min="0" step="any" value="${r[k]}" style="width:72px" oninput="deliveryRowCost(${i})" ${locked ? 'disabled' : ''}></td>`).join('')}
      <td class="num" id="dlvCost${i}">${(r.cost != null ? r.cost : deliveryCalcRow(i)).toLocaleString('zh-CN')}<span class="ratio-bar" title="占合计 ${(deliveryCalcRow(i) / totCost * 100).toFixed(1)}%"><i style="width:${Math.min(deliveryCalcRow(i) / totCost * 100, 100).toFixed(0)}%"></i></span></td>
      <td><input data-di="${i}" data-dk="note" value="${esc(r.note || '')}" style="width:90px" ${locked ? 'disabled' : ''}></td>
      <td>${locked ? '' : `<button class="btn sm" onclick="deliveryDelRow(${i})">删</button>`}</td>
    </tr>`).join('')}</table></div>` : '<div class="empty">无明细行。上传附3 Excel 或点"加行"手动编制。</div>';
  const s = deliveryCalcSum();
  const el = $('#dlvSum');
  if (el) el.innerHTML = `<h3>汇总</h3>
  <div class="dlv-sum-row">
    <span>PM人天 <b>${s.pm_pd}</b></span><span>正编人天 <b>${s.own_pd}</b></span><span>产研外包 <b>${s.rd_pd}</b></span><span>生产外包 <b>${s.prod_pd}</b></span><span>差旅招待 <b>${s.travel_cost.toLocaleString('zh-CN')}</b> 元</span>
    <span>交付成本合计 <b>${s.cost.toLocaleString('zh-CN')}</b> 元</span><span>正编单价 <b>${DLV.rate ?? '—'}</b> 元/天(${esc(DLV.devDept || '未设置')})</span>
  </div>
  <div style="font-size:12.5px;color:var(--text-4);margin-top:8px">注: 行成本 = (PM+正编)×交付部门单价 + 产研外包×研发外包单价 + 生产外包×生产外包单价 + 差旅招待; 【刷新交付科目】将把 正编人天→dev_pd / PM人天×单价→pm_cost / 外包人天×单价→rd_outsource / 生产人天→prod_pd / 差旅招待→del_travel 回写预算表。</div>`;
}
function deliveryCalcRow(i) {
  const r = DLV.rows[i] || {};
  return Math.round(((+r.pm_pd || 0) + (+r.own_pd || 0)) * (DLV.rate ?? 0)
    + (+r.rd_pd || 0) * (DLV.rd_price || 995)
    + (+r.prod_pd || 0) * (DLV.prod_price || 320)
    + (+r.travel_cost || 0)); // 审查整改#14: 单价收服务端下发(财务调价即生效)
}
function deliveryRowCost(i) { // 行内输入实时算
  const inp = document.querySelectorAll(`[data-di="${i}"]`);
  const r = DLV.rows[i];
  inp.forEach(el => { const k = el.dataset.dk; if (k) r[k] = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value; });
  const c = $('#dlvCost' + i);
  if (c) c.textContent = deliveryCalcRow(i).toLocaleString('zh-CN');
  const s = deliveryCalcSum();
  const el = $('#dlvSum');
}
function deliveryCalcSum() {
  const s = { pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, cost: 0 };
  (DLV ? DLV.rows : []).forEach((r, i) => {
    s.pm_pd += +r.pm_pd || 0; s.own_pd += +r.own_pd || 0; s.rd_pd += +r.rd_pd || 0; s.prod_pd += +r.prod_pd || 0;
    s.travel_cost += +r.travel_cost || 0; s.cost += deliveryCalcRow(i);
  });
  ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost', 'cost'].forEach(k => s[k] = +s[k].toFixed(2));
  return s;
}
function deliveryAddRow() { DLV.rows.push({ content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '' }); deliveryRender(); }
function deliveryDelRow(i) { DLV.rows.splice(i, 1); deliveryRender(); }
async function deliveryImport(bid) {
  const f = $('#dlvFile').files[0];
  if (!f) return toast('请先选择附3 Excel 文件', 1);
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const d = await api(`/api/budget/${bid}/delivery/import`, 'POST', { filename: f.name, data: btoa(bin) });
    toast(`解析 ${d.rows.length} 行(正编${d.sum.own_pd}+PM${d.sum.pm_pd}+生产${d.sum.prod_pd}人天)——请核对明细与原表来源`);
    renderDeliveryReview(bid, d);
  } catch (e) { toast(e.message, 1); }
}
// 附3 导入核对视图: 左=明细行表(点击聚焦) + 右=附3 原表网格(行溯源高亮) + 合计对照
function renderDeliveryReview(bid, d) {
  const page = $('#page');
  window._dlvRv = { bid, d };
  const rows = d.rows || [];
  const rs = ((d.audit || {}).row_sources) || [];
  const grid = (d.audit || {}).grid || [];
  window._dlvRv.rs = rs;
  const labSet = {}, valSet = {};
  rs.forEach((s, i) => {
    if (s.content_pos) labSet[s.content_pos[0] + ',' + s.content_pos[1]] = i;
    Object.values(s.cols || {}).forEach(p => { if (Array.isArray(p)) valSet[p[0] + ',' + p[1]] = i; });
    (s.travel_parts || []).forEach(p => { if (Array.isArray(p)) valSet[p[0] + ',' + p[1]] = i; });
  });
  const sum = d.sum || {}, tr = d.total_row || {};
  const aggBy = st => { const o = { pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0 }; rows.filter(r => r.stage === st).forEach(r => ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'].forEach(k => o[k] += +r[k] || 0)); return o; };
  const sumI = aggBy('实施'), sumO = aggBy('运维');
  const cmp = (a, b) => (a != null && b != null && Math.abs(a - b) < 0.01);
  const trow = (name, got, want) => `<tr><td>${esc(name)}</td><td class="num"><b>${got ?? '—'}</b></td><td class="num" style="color:${cmp(got, want) ? 'var(--ok,#3fc09c)' : 'var(--text-2)'}">${want != null ? want : '—'}</td><td>${cmp(got, want) ? '一致' : (want != null ? '<span class="pill p-yellow">有差异</span>' : '原表无此列')}</td></tr>`;
  page.innerHTML = `
  <div class="card"><h3>附3 交付明细导入核对 <span class="pill p-green">解析 ${rows.length} 行</span>
    <span style="font-size:12px;color:var(--text-4);font-weight:400">源文件:${esc(d.source_file || '')} · 左:明细行(点击行→右侧聚焦) · 右:附3 原表</span></h3>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch">
      <div class="imp-rv-panel imp-rv-left" style="flex:1.2;min-width:420px">
        <div class="imp-rv-ph">解析结果 · 明细行(${rows.length}) <span style="font-weight:400;font-size:11px;color:var(--text-4)">点击任一行, 右侧原表对应内容格与人天/差旅格将高亮定位</span></div>
        <div class="imp-rv-pb" style="max-height:420px;overflow:auto">
          <table id="impRvL">
            <tr><th>#</th><th>阶段</th><th style="width:34%">建设内容</th><th class="num">PM人天</th><th class="num">正编</th><th class="num">外包</th><th class="num">生产</th><th class="num">差旅招待</th><th class="num">行成本(元)</th></tr>
            ${rows.map((r, i) => `<tr onclick="dlvRvFocus(${i})">
              <td style="font-family:monospace;font-size:12px">${i + 1}</td>
              <td><span class="pill ${r.stage === '实施' ? 'p-blue' : 'p-gray'}">${esc(r.stage)}</span></td>
              <td>${esc(String(r.content || '').slice(0, 30))}</td>
              <td class="num">${r.pm_pd || 0}</td><td class="num">${r.own_pd || 0}</td><td class="num">${r.rd_pd || 0}</td><td class="num">${r.prod_pd || 0}</td><td class="num">${r.travel_cost || 0}</td>
              <td class="num"><b>${(r.cost ?? 0).toLocaleString('zh-CN')}</b></td>
            </tr>`).join('')}
            <tr style="font-weight:700"><td colspan="3">合计</td><td class="num">${sum.pm_pd ?? ''}</td><td class="num">${sum.own_pd ?? ''}</td><td class="num">${sum.rd_pd ?? ''}</td><td class="num">${sum.prod_pd ?? ''}</td><td class="num">${sum.travel_cost ?? ''}</td><td class="num">${(sum.cost ?? 0).toLocaleString('zh-CN')}</td></tr>
          </table>
        </div>
      </div>
      <div class="imp-rv-panel imp-rv-right" style="flex:1;min-width:360px">
        <div class="imp-rv-ph">源头证据 · 附3 原表 <span style="font-weight:400;font-size:11px;color:var(--text-4)">sheet: ${esc(((d.audit || {}).meta || {}).sheet || '')} · 前 ${grid.length} 行 · 蓝框=内容格 · 绿底=人天/差旅格</span></div>
        <div class="imp-rv-pb" style="max-height:420px;overflow:auto">${impRvGridHtml(grid, labSet, valSet)}</div>
      </div>
    </div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;align-items:flex-start">
      <div style="flex:1;min-width:300px">
        <div style="font-size:13px;font-weight:700;margin-bottom:4px">与附3 原件合计行对照</div>
        <div class="card-table-wrap"><table style="font-size:12px">
          <tr><th>口径</th><th>解析合计</th><th>原件合计行</th><th>核对</th></tr>
          ${trow('实施 PM 人天', sumI.pm_pd, tr.impl_pm)}
          ${trow('实施 正编人天', sumI.own_pd, tr.impl_own)}
          ${trow('实施 外包人天', sumI.rd_pd, tr.impl_rd)}
          ${trow('实施 生产人天', sumI.prod_pd, tr.impl_prod)}
          ${trow('实施 差旅招待', sumI.travel_cost, tr.impl_travel)}
          ${trow('运维 PM 人天', sumO.pm_pd, tr.ops_pm)}
          ${trow('运维 正编人天', sumO.own_pd, tr.ops_own)}
          ${trow('运维 差旅招待', sumO.travel_cost, tr.ops_travel)}
        </table></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;justify-content:center">
        <button class="btn pri" onclick="dlvRvConfirm()">确认无误, 进入明细编辑 →</button>
        <button class="btn" onclick="renderDeliveryPage(${bid})">重新上传 / 返回编辑页</button>
      </div>
    </div>
  </div>`;
}
function dlvRvFocus(i) {
  const s = window._dlvRv; if (!s) return;
  document.querySelectorAll('#impRvL tr.imp-rv-sel').forEach(t => t.classList.remove('imp-rv-sel'));
  const tr = document.querySelectorAll('#impRvL tr')[i + 1];
  if (tr) tr.classList.add('imp-rv-sel');
  const sp = (s.rs || [])[i] || {};
  const n = impRvPickCells([sp.content_pos].concat(Object.values(sp.cols || {}), sp.travel_parts || []));
  if (!n) toast('该行无原表坐标(可能为手编行)', 1);
}
function dlvRvConfirm() {
  const s = window._dlvRv; if (!s) return;
  DLV.rows = s.d.rows; DLV.source_file = s.d.source_file; DLV.rate = s.d.rate;
  renderDeliveryPage(s.bid);
}
async function deliverySave(bid) {
  // 收集输入框当前值
  document.querySelectorAll('[data-di]').forEach(el => {
    const r = DLV.rows[+el.dataset.di]; if (!r) return;
    const k = el.dataset.dk; if (k) r[k] = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
  });
  try {
    const d = await api(`/api/budget/${bid}/delivery`, 'PUT', { rows: DLV.rows });
    DLV.rows = d.rows; DLV.rate = d.rate;
    toast('交付明细已保存(' + d.rows.length + ' 行)');
    deliveryRender();
  } catch (e) { toast(e.message, 1); }
}
async function deliveryApply(bid) {
  try {
    const d = await api(`/api/budget/${bid}/delivery/apply`, 'POST', {});
    toast('预算交付科目已按明细刷新(dev_pd=' + d.fields.dev_pd + ', pm_cost=' + d.fields.pm_cost + ')');
  } catch (e) { toast(e.message, 1); }
}
async function renderBudgets() {
  const page = $('#page');
  showLoading(page);
  const d = { ...await apiCached('/api/budget') };
  d.budgets = visibleRows(d.budgets);
  const locked = d.budgets.filter(b => b.status === 'locked').length;
  // 异步渲染竞态守卫: 预算列表 await 期间切走则弃写
  if (!(location.hash || '').startsWith('#/budgets')) return;
  page.innerHTML = `
  <div class="card"><h3>预算单(${['销售支持组', 'admin'].includes(ME.role) ? '全部' : '我的'})
    <button class="btn pri sm" style="float:right;margin-left:8px" onclick="$('#budgetsImpFile').click()">上传 Excel 导入</button>
    <a href="#/agent" style="float:right;font-size:13px;margin-top:5px">+ 新建/对话</a>
    <input type="file" id="budgetsImpFile" accept=".xlsx" style="display:none" onchange="importBudgetExcel(this)">
    <div style="clear:both;font-size:12px;color:var(--text-4);line-height:1.7">上传含附1-预算表的评审表 Excel → 自动解析字段并实时精算 → 核对后编交付明细锁定（也可在智能体页上传）</div>
    <div style="clear:both"></div>
    <input placeholder="商机代码/项目名/单号搜索" value="${esc((window._budF || {}).q || '')}" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:6px 10px;font-size:12.5px;background:var(--control-bg);color:var(--text-1);width:220px;margin:8px 0" oninput="window._budF={q:this.value};clearTimeout(window._budFt);window._budFt=setTimeout(render,300)">
  </h3>
  ${(() => { const rows = (window._budF && window._budF.q) ? d.budgets.filter(b => ((b.opp_code || '') + (b.project_name || '') + (b.code || '')).toUpperCase().includes(window._budF.q.trim().toUpperCase())) : d.budgets; return rows.length === 0 ? '<div class="empty">没有符合条件的预算单</div>' : `<div class="card-table-wrap"><table>
    <tr><th>单号</th><th>商机代码</th><th>版本</th><th>状态</th><th>项目名称</th><th>更新时间</th><th class="ops">操作</th></tr>
    ${rows.map(b => `<tr>
      <td><b>${esc(b.code)}</b></td><td style="font-family:monospace;font-size:12px">${esc(b.opp_code || '—')}</td><td>v${b.version}</td>
      <td>${b.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td>
      <td>${esc(b.project_name || '')}</td><td>${fmtT(b.updated_at)}</td>
      <td class="ops">
        <button class="btn sm pri" onclick="location.hash='#/agent?b=${b.id}'">对话</button>
        <button class="btn sm" onclick="toggleVersions(${b.id})">版本链</button>
      </td>
    </tr><tr id="bv-${b.id}" style="display:none"></tr>`).join('')}</table></div>`; })()}
  <div style="margin-top:12px"><div class="dist-bar">
    <i class="seg-green" style="width:${d.budgets.length ? (locked / d.budgets.length * 100).toFixed(1) : 0}%"></i>
    <i class="seg-gray" style="width:${d.budgets.length ? ((d.budgets.length - locked) / d.budgets.length * 100).toFixed(1) : 0}%"></i>
  </div>
  <div class="dist-legend"><span class="lg lg-green">已锁定 <b>${locked}</b></span><span class="lg lg-gray">草稿 <b>${d.budgets.length - locked}</b></span>
  <span style="margin-left:auto">共 <b>${d.budgets.length}</b> 张</span></div></div>
  </div>`;
}
async function toggleVersions(id) {
  const tr = document.querySelector('#bv-' + id);
  if (tr.style.display !== 'none') { tr.style.display = 'none'; return; }
  try {
    const d = await api('/api/budget/' + id + '/versions');
    tr.innerHTML = `<td colspan="7" style="background:var(--surface-2)"><table>
      ${d.versions.map(v => `<tr><td>${esc(v.code)}</td><td>v${v.version}</td><td>${v.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td><td colspan="3">${fmtT(v.updated_at)}</td></tr>`).join('')}
    </table></td>`;
    tr.style.display = '';
  } catch (e) { toast(e.message, 1); }
}

// ---- P0 业务办理逻辑导航(产品方案 V3.0 §6.1): 五模块四个新聚合页 ----
// 模块一·商机总览(#/opps): opp_code 主键聚合全部评审单+预算单, 行展开即"一码一商机"单据链
async function renderOppsList() {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash; // 竞态守卫: await 期间切走则弃写
  const isMine = ['销售经理', '项目经理', '财务BP'].includes(ME.role); // 我的商机; 支持组/admin=全部商机(spec §2.2 取数口径)
  const related = !isMine && !['销售支持组', 'admin'].includes(ME.role);
  const [rv, bd, pending, done] = await Promise.all([
    apiCached('/api/reviews?scope=' + (isMine ? 'mine' : 'all')), apiCached('/api/budget'),
    related ? apiCached('/api/tasks?scope=mine') : {}, related ? apiCached('/api/tasks?scope=done') : {}
  ]);
  if ((location.hash || '') !== h0) return;
  const relatedTasks = [...(pending.tasks || []), ...(done.tasks || [])];
  const relatedIds = new Set(relatedTasks.map(t => t.review_id));
  const relatedCodes = new Set(relatedTasks.map(t => t.opp_code).filter(Boolean));
  const reviews = visibleRows(rv.reviews || []).filter(r => !related || relatedIds.has(r.id));
  const st = window._oppF || (window._oppF = { q: '', open: {} });
  const map = new Map();
  const grp = (c, independentKey) => {
    const code = String(c || '');
    const key = code ? code.replace(/[^A-Za-z0-9_-]/g, '_') : independentKey;
    if (!map.has(key)) map.set(key, { code, key, title: '', reviews: [], budgets: [] });
    return map.get(key);
  };
  for (const r of reviews) { const g = grp(r.opp_code, 'review_' + r.id); g.reviews.push(r); if (!g.title) g.title = r.title; }
  const myCodes = new Set(reviews.map(r => String(r.opp_code || '')));
  for (const b of visibleRows(bd.budgets || [])) {
    if (related && !relatedCodes.has(b.opp_code)) continue;
    if (isMine && b.opp_code && !myCodes.has(b.opp_code)) continue;
    const g = grp(b.opp_code, 'budget_' + b.id); g.budgets.push(b); if (!g.title) g.title = b.project_name || '';
  }
  let rows = [...map.values()];
  if (st.q) { const q = st.q.trim().toUpperCase(); rows = rows.filter(g => g.code.toUpperCase().includes(q) || (g.title || '').toUpperCase().includes(q)); }
  rows.sort((a, b) => Number(!a.code) - Number(!b.code) || (b.reviews.length + b.budgets.length) - (a.reviews.length + a.budgets.length));
  const latestLight = g => { for (const r of g.reviews) if (r.light) return r.light; return ''; };
  page.innerHTML = `
  <div class="card"><h3>${related ? '相关商机' : isMine ? '我的商机' : '全部商机'} <span class="pill p-purple">${related ? '按近期任务派生（待办 + 最近50条已处理）' : '按商机代码聚合；未挂靠单据独立显示'}</span>
    <a href="#/new" style="float:right;font-size:13px">+ 新建待评审商机</a>
    <input id="oppsQ" placeholder="商机代码/项目名搜索" value="${esc(st.q)}" style="float:right;border:1px solid var(--border-default);border-radius:var(--r-m);padding:6px 10px;font-size:12.5px;background:var(--control-bg);color:var(--text-1);width:200px;margin-right:10px" oninput="oppQ(this.value)">
    <div style="clear:both;font-size:12px;color:var(--text-4);line-height:1.7">按商机代码聚合${isMine ? '我的' : '全部'}评审单与预算单。点击「进入 360°」一页办完该商机; 点击行展开单据链。</div>
  </h3>
  ${rows.length === 0 ? '<div class="empty">没有符合条件的商机</div>' : `<div class="card-table-wrap"><table id="oppsTbl">
    <tr><th>商机代码</th><th>项目(取首个单据名)</th><th class="num">预算单</th><th class="num">评审单</th><th>链路进度</th><th>最新灯态</th><th class="ops">操作</th></tr>
    ${rows.map(g => {
      const open = !!st.open[g.key];
      return `<tr onclick="oppToggle('${g.key}')" style="cursor:pointer">
        <td style="font-family:monospace;font-size:12px">${g.code ? esc(g.code) : '<span style="color:var(--text-4)">未挂靠商机</span>'}</td>
        <td>${esc(g.title || '—')}</td>
        <td class="num">${g.budgets.length}</td><td class="num">${g.reviews.length}</td>
        <td>${oppChainMini(g)}</td>
        <td>${lightPill(latestLight(g))}</td>
        <td class="ops">${g.code ? `<button class="btn sm pri" onclick="event.stopPropagation();location.hash='#/opp/${encodeURIComponent(g.code)}'">进入 360°</button>` : ''} ${open ? '收起 ▲' : '展开 ▼'}</td>
      </tr>${open ? oppExpandHtml(g) : ''}`;
    }).join('')}</table></div>`}
  </div>`;
}
function oppQ(q) {
  const st = window._oppF || (window._oppF = { q: '', open: {} });
  st.q = q;
  clearTimeout(window._oppFt);
  window._oppFt = setTimeout(rerenderPage, 300);
}
function oppToggle(key) {
  const st = window._oppF || (window._oppF = { q: '', open: {} });
  st.open[key] = !st.open[key];
  rerenderPage();
}
function oppChainMini(g) { // ① 交付预算须进 360° 才可知(列表端点无 chain), 故①恒灰
  const hasB = g.budgets.length > 0, locked = g.budgets.some(b => b.status === 'locked'), hasR = g.reviews.length > 0;
  const d = (n, on, tip) => `<span class="cm${on ? ' on' : ''}" title="${tip}">${n}</span>`;
  return `<span class="chain-mini">${d('①', false, '交付预算状态请进 360° 查看')}${d('②', locked, locked ? '项目预算已锁定' : hasB ? '项目预算未锁定' : '无项目预算')}${d('③', hasR && g.reviews.some(r => r.status !== 'draft'), '评审单已提交(非草稿)')}</span>`;
}
function oppExpandHtml(g) {
  const rCap = g.reviews.length > 30, bCap = g.budgets.length > 30;
  return `<tr><td colspan="7" style="background:var(--surface-2);padding:8px 14px">
    <div style="font-size:12.5px;font-weight:700;color:var(--brand-hover);margin-bottom:6px">商机 ${esc(g.code || '(未标识)')} · 单据链(预算 ${g.budgets.length} + 评审 ${g.reviews.length})</div>
    ${g.reviews.length ? `<div class="card-table-wrap"><table>
      <tr><th>评审单</th><th>类型</th><th>状态</th><th>灯态</th><th class="num">轮次</th><th>更新时间</th></tr>
      ${g.reviews.slice(0, 30).map(r => `<tr>
        <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td>${TYPE_NAMES[r.type] || ''}</td>
        <td>${statusPill(r.status)}</td><td>${lightPill(r.light)}</td><td class="num">${r.round}</td><td>${fmtT(r.updated_at)}</td>
      </tr>`).join('')}${rCap ? `<tr><td colspan="6" style="color:var(--text-4)">…共 ${g.reviews.length} 张, 用上方搜索缩小范围</td></tr>` : ''}
    </table></div>` : '<div class="empty">该商机暂无评审单</div>'}
    ${g.budgets.length ? `<div class="card-table-wrap" style="margin-top:${g.reviews.length ? 8 : 0}px"><table>
      <tr><th>预算单</th><th>版本</th><th>状态</th><th>更新时间</th><th class="ops">操作</th></tr>
      ${g.budgets.slice(0, 30).map(b => `<tr>
        <td><b>${esc(b.code)}</b></td><td>v${b.version}</td>
        <td>${b.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td>
        <td>${fmtT(b.updated_at)}</td>
        <td class="ops"><a href="#/budget-detail/${b.id}">详情</a> · <a href="#/agent?b=${b.id}">对话</a></td>
      </tr>`).join('')}${bCap ? `<tr><td colspan="5" style="color:var(--text-4)">…共 ${g.budgets.length} 张</td></tr>` : ''}
    </table></div>` : '<div class="empty">该商机暂无预算单</div>'}
  </td></tr>`;
}

// ---- 商机 360° L1(#/opp/:code, spec 2026-10-19 §7): 无页签七分区一页到底, 评审单下沉为实例(详情走 L2) ----
const NEXT_ACTION_TEXT = {
  confirm_delivery: '在「① 交付预算」编制明细并确认',
  lock_budget: '在「② 项目预算」锁定预算单',
  submit_review: '提交评审单完成前置评审'
};
// L1 档案卡字段(键序与 server.js 12 可写列同源)
const OPP_FIELDS = ['title', 'customer', 'region', 'province', 'biz_line', 'contract_amount', 'opp_stage', 'sign_date', 'sales', 'pm', 'survey', 'summary'];
const OPP_FIELD_NAMES = { title: '项目名称', customer: '客户名称', biz_line: '业务线', region: '区域', province: '省份', sales: '销售', pm: '项目经理', contract_amount: '合同金额(万元)', opp_stage: '商机阶段', sign_date: '预计签约日期', summary: '项目概述', survey: '勘察设计' };
// 旧 ?t= 深链收敛映射: 值为 L1 分区 focus 标记(IA-18/19 断言 data-focus)
const OPP_T_FOCUS = { budget: 'collect', collect: 'collect', review: 'pre', pre: 'pre', light: 'pre', judge: 'pre', archive: 'pre', analysis: 'analysis', chat: 'agent' };
function oppLaunchHtml(code, d) {
  const budget = d.budgets.find(b => b.status === 'locked');
  return `<h3>发起评审</h3><div class="row">${['presale', 'bid', 'change'].map(t => {
    const launch = d.launch[t];
    return `<section data-launch="${t}" class="launch-card"><b>${TYPE_NAMES[t]}</b> ${pill(({ ready: '就绪', blocked: '未就绪', na: '不适用' })[launch.state], launch.state === 'ready' ? 'p-green' : 'p-yellow')}
      ${launch.gaps.map(g => `<div><a href="${esc(g.href)}" data-anchor="${esc(g.anchor)}" onclick="scrollOppGap(event,this)">${g.key === 'delivery' ? '去确认交付预算' : '去锁定项目预算'} →</a> · ${esc(g.label)}</div>`).join('')}
      ${launch.note ? `<div class="hint">${esc(launch.note)}</div>` : ''}
      <a class="btn sm${launch.state === 'ready' ? ' pri' : ''}" href="#/new/${t}?opp=${encodeURIComponent(code)}${budget && (t !== 'change' || launch.state === 'ready') ? '&budget=' + budget.id : ''}">${launch.state === 'ready' ? '发起评审' : launch.state === 'na' ? '发起评审（不关联预算）' : '草稿可填，提交需先完成①②'}</a></section>`;
  }).join('')}</div><div class="hint">每张评审单独立流转，提交门由服务端裁决。</div>`;
}
function scrollOppGap(event, el) {
  event.preventDefault();
  document.getElementById(el.dataset.anchor === 'delivery' ? 'oppDlv' : 'oppBudgets').scrollIntoView();
}
function oppChainHtml(d) {
  const ch = d.chain || {};
  const submitted = ch.reviews_submitted || 0, inflight = (ch.reviews_total || 0) - submitted;
  const online = (d.reviews || []).filter(r => r.era !== 'history');
  const archived = online.length > 0 && online.every(r => r.status === 'archived');
  const next = ch.next_action === 'judged' && archived ? '在线评审已归档，可在下方查看归档实例；也可发起新评审' : NEXT_ACTION_TEXT[ch.next_action] || ({ reviewing: '等待部门打灯，可在任务中心查看进度', returned: '修改退回材料后重新提交', judged: '查看或录入结论，完成后归档；也可发起新评审' })[ch.next_action] || '';
  return `<h3>三步链 <span style="font-weight:400;font-size:12px;color:var(--text-4)">三步硬门禁: ① 交付预算确认 → ② 项目预算锁定 → ③ 评审单提交(服务端裁决, 前端只渲染不重算)</span></h3>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span class="chain-dot ${ch.delivery_confirmed ? 'on' : 'lack'}">① 交付预算${ch.delivery_confirmed ? ' ✓' : ''}</span>
      <span class="chain-dot ${ch.budget_locked ? 'on' : 'lack'}">② 项目预算${ch.budget_locked ? ' ✓' : ''}</span>
      <span class="chain-dot" style="cursor:pointer" onclick="document.getElementById('oppInstances').scrollIntoView({behavior:'smooth'})">③ 评审 进行中 ${inflight} · 已提交 ${submitted}</span>
    </div><div id="oppNextStep" style="font-size:12px;color:var(--text-4);margin-top:6px">下一步：${next}</div>`;
}
function oppProfileEdit() {
  const d = window._opp360;
  if (!d.profile_can_edit) return;
  $('#oppProfileEdit').innerHTML = `<div class="grid">${OPP_FIELDS.map(k => {
    const f = OPP_F.find(f => f.k === k);
    const value = String(d.opp[k] ?? '');
    const type = f?.t === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value) ? 'text' : f?.t || 'text';
    return `<div class="f-item${f?.full ? ' full' : ''}"><label>${esc(OPP_FIELD_NAMES[k])}</label>${f?.t === 'select' ? `<select data-pk="${k}" data-orig="${esc(value)}"><option value=""></option>${value && !f.o.includes(value) ? `<option value="${esc(value)}" selected>${esc(value)}（原值）</option>` : ''}${f.o.map(o => `<option ${value === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f?.t === 'textarea' ? `<textarea data-pk="${k}" data-orig="${esc(value)}">${esc(value)}</textarea>` : `<input data-pk="${k}" data-orig="${esc(value)}" type="${type}" value="${esc(value)}">`}</div>`;
  }).join('')}</div><button class="btn pri sm" onclick="oppProfileSave()">保存档案</button> <button class="btn sm" onclick="$('#oppProfileEdit').innerHTML=''">取消</button><div class="hint">编辑的是原始档案，不会覆盖评审单填报值。</div>`;
  document.querySelectorAll('#oppProfileEdit [data-pk]').forEach(el => {
    if (el.type === 'date' && el.value !== el.dataset.orig) { el.type = 'text'; el.value = el.dataset.orig; }
    el.dataset.orig = el.value;
  });
}
async function oppProfileSave() {
  const code = window._opp360.opp.opp_code;
  const fields = Object.fromEntries([...document.querySelectorAll('#oppProfileEdit [data-pk]')].filter(el => el.value !== el.dataset.orig).map(el => [el.dataset.pk, el.value.trim()]));
  if (!Object.keys(fields).length) { $('#oppProfileEdit').innerHTML = ''; return; }
  try {
    await api('/api/opp/' + encodeURIComponent(code), 'PUT', fields);
    toast('档案已保存'); await renderOpp360(code);
  } catch (e) { toast(e.message, 1); }
}
async function renderOpp360(rawCode) {
  const page = $('#page');
  const code = decodeURIComponent(String(rawCode || ''));
  const legacyT = (location.hash.split('?')[1] || '').split('=')[1] || ''; // 三个旧值同归前置分区，非遗漏；缓存命中也收敛。
  const d0 = peekCached('/api/opp/' + encodeURIComponent(code) + '/360');
  if (d0) { opp360Paint(code, d0, legacyT); return; }
  showLoading(page);
  const h0 = location.hash;
  let d;
  try { d = await apiCached('/api/opp/' + encodeURIComponent(code) + '/360'); }
  catch (e) {
    if (location.hash !== h0) return;
    page.innerHTML = `<div class="card"><h3>商机 360°</h3>
      <div class="empty">商机 ${esc(code)} 不存在或已被清理</div>
      <div style="margin-top:10px;display:flex;gap:10px">
        ${['销售经理', '项目经理', '财务BP'].includes(ME.role) ? `<button class="btn pri" onclick="location.hash='#/new'">新建待评审商机 →</button>` : ''}
        <button class="btn" onclick="goBack('#/opps')">返回商机列表</button>
      </div></div>`;
    return;
  }
  if (location.hash !== h0) return;
  opp360Paint(code, d, legacyT);
}
function opp360Paint(code, d, legacyT) {
  const page = $('#page');
  window._opp360 = d;
  // D-73: 旧 ?t= 收敛——replaceState 去 query 并映射到分区 focus(data-focus)
  const focus = OPP_T_FOCUS[legacyT] || '';
  if (legacyT) history.replaceState(null, '', location.pathname + location.search + '#/opp/' + encodeURIComponent(code));
  const lightAggHtml = oppLightAggHtml(oppLightAgg(d));
  const rs = d.reviews || [], bs = d.budgets || [];
  const dlvSt = (d.delivery || {}).status || 'none';
  const pf = d.profile || { fields: {}, sources: {}, missing: [] };
  const srcTag = k => { const s = (pf.sources || {})[k]; if (!s) return ''; const m = { review: '评审', archive: '档案' }; return `<span style="font-size:11px;color:var(--text-4);margin-left:4px">${m[s.source] || s.source || ''}${s.scope === 'cross' ? '·跨型' : ''}</span>`; };
  const miss = k => (pf.missing || []).includes(k) ? `<span data-missing style="font-size:11px;color:#e0a54a">待补</span>` : '';
  const pfRows = OPP_FIELDS.map(k => `<tr><td>${OPP_FIELD_NAMES[k] || k}</td><td>${esc((pf.fields || {})[k] ?? '')}${srcTag(k)} ${miss(k)}</td></tr>`).join('');
  // D-21: 360 的 d.delivery 是**摘要**(rows 为计数), 行集明细由 opdlvMount 二次拉取; 先回填 OPDLV 再渲染
  const dl = d.delivery || null;
  const cw = !!(dl && dl.can_write);                 // 能力位由服务端告知, FE 不得自行拼角色判断
  OPDLV.code = code; OPDLV.rows = []; OPDLV.sum = null;
  OPDLV.status = (dl && dl.status) || 'none';
  OPDLV.rate = dl && dl.rate != null ? dl.rate : null;
  OPDLV.rate_source = (dl && dl.rate_source) || 'none';
  OPDLV.rd_price = null; OPDLV.prod_price = null; OPDLV.source_file = null;
  OPDLV.dev_dept = (dl && dl.dev_dept) || ''; OPDLV.locked = OPDLV.status === 'confirmed';
  OPDLV.can_write = cw;
  page.innerHTML = `
  <div id="oppPage">
  ${crumbBar('#/opps', '全部商机', d.opp.title || code)}
    <div class="card" id="oppProfileCard"><h3>商机档案 <span style="font-family:monospace;font-size:13px;color:var(--text-3)">${esc(code)}</span>${d.profile_can_edit ? '<button class="btn sm" style="float:right" onclick="oppProfileEdit()">编辑档案</button>' : ''}</h3>
      <div style="font-size:12px;color:var(--text-4);line-height:1.7;margin-bottom:8px">本卡为只读档案 + 各字段来源（评审单优先，档案兜底）；「待补」= 进入评审流程还缺的必填。字段值不被改写，原始档案仍以服务端 opp 18 列为准。</div>
      <table style="width:100%"><tbody>${pfRows}</tbody></table>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        ${(pf.missing || []).length ? (pf.missing || []).map(k => `<span data-missing class="pill p-yellow">缺: ${({ customer:'客户名称', project_name:'项目名称', biz_line:'业务线', region:'区域', province:'省份', sales:'销售', pm:'项目经理', contract_amount:'合同金额(万元)', opp_stage:'商机阶段', sign_date:'预计签约日期', summary:'项目概述', survey:'勘察设计' })[k] || k}</span>`).join('') : '<span class="pill p-green">必填齐全</span>'}
        <button class="btn sm" onclick="location.hash='#/new?opp=${encodeURIComponent(code)}'">发起评审 →</button>
      </div>
      <div id="oppProfileEdit"></div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-4)">档案不会自动覆盖；授权角色可人工修正原始档案，最新填报值见上方来源标注。</div>
      ${(d.profile_events || []).map(e => `<div class="ev"><b>${esc(e.action)}</b> · ${esc(e.actor)} · ${fmtT(e.created_at)}<div>${esc(e.detail)}</div></div>`).join('')}</div>
    <div class="card" id="oppChain">${oppChainHtml(d)}</div>
    <div id="oppShared" ${focus === 'collect' ? 'data-focus="collect"' : ''}>
      <div class="card" id="oppDlv"><h3>① 交付预算(商机级) <span id="opdlvPill">${dlvSt === 'confirmed' ? pill('已确认', 'p-green') : dlvSt === 'draft' ? pill('草稿', 'p-yellow') : pill('未编制', 'p-yellow')}</span>
        <span id="opdlvHint" style="font-weight:400;font-size:12px;color:var(--text-4)">商机级交付预算 · 建档人/项目经理/支持组可编辑 · 三种编制方式: 在线建行 / 附3 Excel 导入 / 由项目预算递进带入 · 确认后才能锁定项目预算(G1)</span></h3>
      ${cw ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <input type="file" id="opdlvFile" accept=".xlsx" style="font-size:12.5px">
        <button class="btn sm pri" onclick="opdlvImport()">上传附3 解析</button>
        <button class="btn sm" onclick="opdlvAddRow()">+ 加行</button>
        <button class="btn sm pri" onclick="opdlvSave()">保存明细</button>
        <button class="btn sm pri" id="opdlvConfirmBtn" onclick="opdlvConfirm()" ${OPDLV.locked ? 'disabled' : ''}>确认交付预算</button>
        ${OPDLV.locked ? '<span class="pill p-green">已确认</span><span style="font-size:12.5px;color:var(--text-4)">改行并保存即自动回草稿, 须重新确认(G1 从严)</span>' : ''}
        <span style="font-size:12.5px;color:var(--text-4)">正编单价 ${OPDLV.rate ?? '—'} 元/天${OPDLV.rate == null ? ' · ' + (OPDLV.rate_source === 'none' ? '无部门口径, 正编不计价' : '单价载入中') : ''}<span id="opdlvSrc"></span></span>
      </div>
      <div id="opdlvTable"><div class="empty">交付预算明细载入中…</div></div><div class="card" id="opdlvSum" style="box-shadow:none;border:1px solid var(--border-default)"></div>`
        : `<div class="dlv-sum-row"><span>交付成本合计 <b>${(dl && dl.total_cost) || 0}</b> 元</span><span>正编单价 <b>${OPDLV.rate ?? '—'}</b> 元/天</span><span>${(dl && dl.rows) || 0} 行明细已隐去</span></div>
      <div class="hint">行集明细与行单价仅对商机建档人 / 项目经理 / 销售支持组开放(服务端裁决)。如需编制或修订，请由上述角色操作。</div>`}</div>
      <div class="card" id="oppBudgets"><h3>② 项目预算(${bs.length}) <a href="#/budgets" style="float:right;font-size:13px">预算工作台 →</a></h3><button class="btn sm pri" data-obc="${esc(code)}" onclick="oppBudgetCreate(this.dataset.obc)">＋ 新建项目预算(挂靠本商机)</button>${bs.length === 0 ? '<div class="empty">该商机暂无预算单</div>' : `<div class="card-table-wrap"><table>
      <tr><th>单号</th><th>版本</th><th>状态</th><th>更新时间</th><th class="ops">操作</th></tr>
      ${bs.map(b => `<tr><td><b>${esc(b.code)}</b></td><td>v${b.version}</td>
        <td>${b.status === 'locked' ? pill('已锁定', 'p-green') : pill('草稿', 'p-gray')}</td><td>${fmtT(b.updated_at)}</td>
        <td class="ops"><a href="#/budget-detail/${b.id}">详情</a> · <a href="#/delivery/${b.id}">附3</a> · <a href="#/agent?b=${b.id}">对话编制</a> · ${rs.some(r => r.budget_id === b.id) ? rs.filter(r => r.budget_id === b.id).map(r => `<a href="#/opp/${encodeURIComponent(code)}/r/${r.id}">已被 #${r.id} ${esc(TYPE_NAMES[r.type])}关联</a>`).join(' · ') : `未关联${b.status === 'locked' ? ` · <a href="#/new/bid?opp=${encodeURIComponent(code)}&budget=${b.id}">发起评审</a>` : ''}`}</td></tr>`).join('')}</table></div>`}
      <div class="hint">锁定门禁(G2): 该商机交付预算须为「已确认」+ 缺项清单为空。完整版本链在预算工作台(#/budgets)。</div></div>
      <div class="card" id="oppLaunch">${oppLaunchHtml(code, d)}</div></div>
    <div class="card" id="oppInstances" ${focus === 'pre' ? 'data-focus="pre"' : ''}>
      <h3>评审实例</h3>
      <div class="inst-group" data-group="inflight"><div style="font-size:12.5px;font-weight:700;margin:4px 0">进行中</div>${instCards(rs, code, 'inflight') || '<div style="color:var(--text-4);font-size:12.5px;padding:6px 0">暂无进行中评审</div>'}</div>
      <div class="inst-group" data-group="ended"><div style="font-size:12.5px;font-weight:700;margin:4px 0">已结束</div>${instCards(rs, code, 'ended') || '<div style="color:var(--text-4);font-size:12.5px;padding:6px 0">暂无已结束评审</div>'}</div></div>
    <div class="card" id="oppLightAgg"><h3>灯色汇总</h3>
      <div class="dlv-sum-row"><span>红 <b>${(d.lights || {}).red || 0}</b></span><span>黄 <b>${(d.lights || {}).yellow || 0}</b></span><span>绿 <b>${(d.lights || {}).green || 0}</b></span></div>
      ${lightDistBar(rs)}
      ${lightAggHtml}
      <div class="hint">跨全部实例，只展示不判定。</div></div>
    <div class="card" id="oppAnalysis" ${focus === 'analysis' ? 'data-focus="analysis"' : ''}><h3>灯色时间线</h3>
      ${rs.filter(r => r.light).sort((a,b) => String(a.updated_at).localeCompare(String(b.updated_at))).map(r => `<div class="ev" data-point="${r.id}">${fmtT(r.archived_at || r.updated_at)} · ${esc(TYPE_NAMES[r.type])} · ${lightPill(r.light)} · <a href="#/opp/${encodeURIComponent(code)}/r/${r.id}">评审单 #${r.id}</a></div>`).join('') || '<div class="empty">暂无已判定的评审</div>'}
      <h3>结论对比</h3><table><tr><th>评审单</th><th>类型</th><th>灯态</th><th>结论</th><th>时间</th></tr>${rs.map(r => `<tr><td>#${r.id}</td><td>${esc(TYPE_NAMES[r.type])}</td><td>${lightPill(r.light) || '未判定'}</td><td>${esc(r.decision_result || '未录入')}</td><td>${fmtT(r.archived_at || r.updated_at)}</td></tr>`).join('')}</table><div class="hint">只展示已有单据记录；历史未评不补判，不推断成本偏差。</div></div>
    <div class="card" id="oppAgent" ${focus === 'agent' ? 'data-focus="agent"' : ''}><h3>对话 <span style="font-weight:400;font-size:12px;color:var(--text-4)">上下文锁定该商机 · 技能①预算 / 技能②评审表</span></h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px" id="oppChatPick">
        ${bs.map(b => `<button class="btn sm" onclick="oppChatBudget(${b.id})">预算 ${esc(b.code)} v${b.version}</button>`).join('')}
        ${rs.filter(r => r.status === 'draft').map(r => `<button class="btn sm" onclick="oppChatReview(${r.id})">评审表 ${esc(r.title)}</button>`).join('')}
      </div>
      <div id="oppChatBox"><div class="empty">${bs.length || rs.length ? '选择上方目标开始对话' : '该商机暂无可对话单据'}</div></div></div>
  </div>`;
  opdlvMount(); // D-21: innerHTML 落地后再拉行集(只读态直接短路返回, 不发请求)
}
function instCards(rs, code, group) {
  // spec §7.4: inflight = era!=='history' 且 status∈{draft,reviewing,returned}; ended = 其余(history 恒 ended)
  const inflight = r => r.era !== 'history' && ['draft', 'reviewing', 'returned'].includes(r.status);
  return rs.filter(r => group === 'inflight' ? inflight(r) : !inflight(r))
    .map(r => `<a class="inst-card" data-rid="${r.id}" href="#/opp/${encodeURIComponent(code)}/r/${r.id}" style="display:block;border:1px solid var(--border-default);border-radius:8px;padding:8px 10px;margin:6px 0;text-decoration:none">
      <div><b>${esc(r.title || '')}</b> ${statusPill(r.status)} ${lightPill(r.light)} ${r.era === 'history' ? pill('历史', 'p-gray') : ''}</div>
      <div style="font-size:12px;color:var(--text-4);margin-top:2px">${TYPE_NAMES[r.type] || r.type} · 第 ${r.round} 轮 · 申请人: ${esc(r.applicant_name || '—')} · 关联预算单: ${r.budget_code ? `<a href="#/budget-detail/${r.budget_id}">${esc(r.budget_code)}</a>` : '—'} · ${fmtT(r.updated_at)}</div>
      <div style="font-size:12.5px;margin-top:2px">进入本次评审 →</div></a>`).join('');
}
// ---- 商机级交付预算内嵌编辑器(V4.0 §4.1 信息收集页签): 与预算级 deliveryRender 同构, 属性名用 data-oi 避免与 data-di 全局选择器撞车 ----
const OPDLV = { code: '', rows: [], status: 'none', rate: null, rd_price: null, prod_price: null, dev_dept: '', locked: false, can_write: false, sum: null, source_file: null };
// D-21: 360 只回摘要, 行集明细二次拉取; 只读态(非 canWriteOpp 四项)不发明细请求, 免得自吃 403 toast
async function opdlvMount() {
  if (!OPDLV.can_write) return;                       // 只读卡由 §3d 的模板直接渲染, 无需填充 #opdlvTable
  try {
    const f = await api(`/api/opp/${encodeURIComponent(OPDLV.code)}/delivery`);
    const dd = f.delivery || null;
    OPDLV.rows = ((dd && dd.rows) || []).map(r => ({ ...r }));
    OPDLV.sum = (dd && dd.sum) || null;
    OPDLV.rd_price = f.rd_price ?? null; OPDLV.prod_price = f.prod_price ?? null;
    OPDLV.source_file = (dd && dd.source_file) || null;
    if (dd) { OPDLV.status = dd.status; OPDLV.locked = OPDLV.status === 'confirmed'; }
    if (f.rate != null) OPDLV.rate = f.rate;          // 与 360 同源(T5 C2-06/C2-07 已对账), 以明细端点为准
    if (f.rate_source) OPDLV.rate_source = f.rate_source;
    opdlvRender();
    const fs = $('#opdlvSrc'); if (fs) fs.textContent = OPDLV.source_file ? ' · 源文件 ' + OPDLV.source_file : '';
  } catch (e) { toast(e.message || '交付预算明细读取失败', 1); }
}
function opdlvCalcRow(i) {
  const r = OPDLV.rows[i] || {};
  return Math.round(((+r.pm_pd || 0) + (+r.own_pd || 0)) * (OPDLV.rate ?? 0)
    + (+r.rd_pd || 0) * (OPDLV.rd_price || 995)
    + (+r.prod_pd || 0) * (OPDLV.prod_price || 320)
    + (+r.travel_cost || 0));
}
function opdlvCalcSum() {
  const s = { pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, cost: 0 };
  OPDLV.rows.forEach((r, i) => {
    s.pm_pd += +r.pm_pd || 0; s.own_pd += +r.own_pd || 0; s.rd_pd += +r.rd_pd || 0; s.prod_pd += +r.prod_pd || 0;
    s.travel_cost += +r.travel_cost || 0; s.cost += opdlvCalcRow(i);
  });
  ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost', 'cost'].forEach(k => s[k] = +s[k].toFixed(2));
  return s;
}
function opdlvRender() {
  const el = $('#opdlvTable'); if (!el) return;
  const tot = opdlvCalcSum().cost || 1;
  // D-47: 编辑器只在 can_write(服务端能力位)为真时渲染(只读态走 §3d 摘要卡, 不输出 #opdlvTable), 故此处一律不锁;
  // OPDLV.locked 只裁决「确认交付预算」按钮与回 draft 提示, 不参与写权限(D-32: confirmed ≠ 只读)
  el.innerHTML = OPDLV.rows.length ? `<div class="card-table-wrap"><table>
    <tr><th style="width:30%">建设内容</th><th>阶段</th><th>PM人天</th><th>正编人天</th><th>外包人天</th><th>生产人天</th><th>差旅招待</th><th class="num">行成本(元)</th><th>备注</th><th></th></tr>
    ${OPDLV.rows.map((r, i) => `<tr>
      <td><input data-oi="${i}" data-ok="content" value="${esc(r.content)}" style="width:96%" oninput="opdlvRowCost(${i})"></td>
      <td><select data-oi="${i}" data-ok="stage" onchange="opdlvRowCost(${i})"><option${r.stage === '实施' ? ' selected' : ''}>实施</option><option${r.stage === '运维' ? ' selected' : ''}>运维</option></select></td>
      ${['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'].map(k => `<td><input data-oi="${i}" data-ok="${k}" type="number" min="0" step="any" value="${r[k]}" style="width:72px" oninput="opdlvRowCost(${i})"></td>`).join('')}
      <td class="num" id="opdlvCost${i}">${(r.cost != null ? r.cost : opdlvCalcRow(i)).toLocaleString('zh-CN')}<span class="ratio-bar" title="占合计 ${(opdlvCalcRow(i) / tot * 100).toFixed(1)}%"><i style="width:${Math.min(opdlvCalcRow(i) / tot * 100, 100).toFixed(0)}%"></i></span></td>
      <td><input data-oi="${i}" data-ok="note" value="${esc(r.note || '')}" style="width:90px" oninput="opdlvRowCost(${i})"></td>
      <td><button class="btn sm" onclick="opdlvDelRow(${i})">删</button></td>
    </tr>`).join('')}</table></div>` : '<div class="empty">无明细行。上传附3 Excel 或点「+ 加行」手动编制。</div>';
  const s = opdlvCalcSum();
  const su = $('#opdlvSum');
  if (su) su.innerHTML = `<h3>汇总</h3><div class="dlv-sum-row">
    <span>PM人天 <b>${s.pm_pd}</b></span><span>正编人天 <b>${s.own_pd}</b></span><span>产研外包 <b>${s.rd_pd}</b></span><span>生产外包 <b>${s.prod_pd}</b></span><span>差旅招待 <b>${s.travel_cost.toLocaleString('zh-CN')}</b> 元</span>
    <span>交付成本合计 <b>${s.cost.toLocaleString('zh-CN')}</b> 元</span><span>正编单价 <b>${OPDLV.rate ?? '—'}</b> 元/天</span>
  </div><div style="font-size:12.5px;color:var(--text-4);margin-top:8px">注: 行成本 = (PM+正编)×交付部门单价 + 产研外包×研发外包单价 + 生产外包×生产外包单价 + 差旅招待; 单价与合计由服务端实算下发, 保存/确认后以服务端为准。已确认后如需修订: 改行再保存即自动回到草稿态, 须重新确认。</div>`;
}
function opdlvRowCost(i) {
  const r = OPDLV.rows[i]; if (!r) return;
  document.querySelectorAll(`[data-oi="${i}"]`).forEach(el => {
    const k = el.dataset.ok; if (!k) return;
    r[k] = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
  });
  const c = $('#opdlvCost' + i); if (c) c.textContent = opdlvCalcRow(i).toLocaleString('zh-CN');
}
function opdlvAddRow() { OPDLV.rows.push({ content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '' }); OPDLV.locked = false; opdlvRender(); }
function opdlvDelRow(i) { OPDLV.rows.splice(i, 1); opdlvRender(); }
async function refreshOppChain(code, hash) {
  const d = await apiCached('/api/opp/' + encodeURIComponent(code) + '/360');
  if (location.hash !== hash || OPDLV.code !== code || !$('#oppChain')) return;
  window._opp360 = d;
  $('#oppChain').innerHTML = oppChainHtml(d);
  $('#oppLaunch').innerHTML = oppLaunchHtml(code, d);
}
async function opdlvSave() {
  if (!OPDLV.code) return;
  const code = OPDLV.code, hash = location.hash, editor = $('#opdlvTable');
  try {
    const d = await api(`/api/opp/${encodeURIComponent(code)}/delivery`, 'PUT', { rows: OPDLV.rows });
    if (location.hash !== hash || OPDLV.code !== code || !editor?.isConnected) return;
    OPDLV.rows = d.rows || []; OPDLV.status = 'draft'; OPDLV.locked = false;
    if (d.rate != null) OPDLV.rate = d.rate;
    toast(`已保存 ${OPDLV.rows.length} 行, 合计 ${d.sum.cost.toLocaleString('zh-CN')} 元(草稿态, 需确认后方②可锁定)`);
    opdlvRender();
    const p = $('#opdlvPill'); if (p) p.outerHTML = pill('草稿', 'p-yellow').replace('<span ', '<span id="opdlvPill" ');
    const cb = $('#opdlvConfirmBtn'); if (cb) cb.disabled = false;
    await refreshOppChain(code, hash).catch(e => { if (location.hash === hash && editor.isConnected) toast('已保存，链路状态刷新失败，请刷新页面：' + e.message, 1); });
  } catch (e) { toast(e.message || '保存失败', 1); }
}
async function opdlvConfirm() {
  if (!OPDLV.code) return;
  const code = OPDLV.code, hash = location.hash, editor = $('#opdlvTable');
  try {
    await api(`/api/opp/${encodeURIComponent(code)}/delivery/confirm`, 'POST', {});
    if (location.hash !== hash || OPDLV.code !== code || !editor?.isConnected) return;
    OPDLV.status = 'confirmed'; OPDLV.locked = true;
    toast('交付预算已确认 → 可锁定项目预算(②)');
    const p = $('#opdlvPill'); if (p) p.outerHTML = pill('已确认', 'p-green').replace('<span ', '<span id="opdlvPill" ');
    const cb = $('#opdlvConfirmBtn'); if (cb) cb.disabled = true;
    await refreshOppChain(code, hash).catch(e => { if (location.hash === hash && editor.isConnected) toast('已确认，链路状态刷新失败，请刷新页面：' + e.message, 1); });
  } catch (e) { toast(e.message || '确认失败', 1); }
}
async function opdlvImport() {
  const f = $('#opdlvFile').files[0];
  if (!f) return toast('请先选择附3 Excel 文件', 1);
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const d = await api(`/api/opp/${encodeURIComponent(OPDLV.code)}/delivery/import`, 'POST', { filename: f.name, data: btoa(bin) });
    toast(`解析 ${d.rows.length} 行(正编${d.sum.own_pd}+PM${d.sum.pm_pd}+生产${d.sum.prod_pd}人天)——已入草稿, 请核对后确认`);
    renderOpp360(OPDLV.code);
  } catch (e) { toast(e.message || '上传解析失败', 1); }
}
// D-16: 从商机上下文建预算单必须带 opp_code(D-9 建单端点即收即落派生列), 否则该单永远进不了三步链
async function oppBudgetCreate(code) {
  const name = (window.prompt('为商机 ' + code + ' 新建项目预算(名称可留空)') || '').trim();
  try {
    const d = await api('/api/budget', 'POST', { project_name: name, opp_code: code });
    toast('已建 ' + d.code + ',已挂靠 ' + d.opp_code + ' → 编制完成后锁定(②)');
    location.hash = '#/agent?b=' + d.id; // 复用既有编制入口, 不在 360 内重复造编制 UI
  } catch (e) { toast(e.message, 1); }
}
async function oppChatBudget(bId) { // 360°对话标签: 内嵌技能①(挂载后隐藏目标选择器)
  const pick = $('#oppChatPick'); if (pick) pick.style.display = 'none';
  await mountAgentChat(bId, '#oppChatBox');
}
async function oppChatReview(rId) { // 360°对话标签: 内嵌技能②
  const pick = $('#oppChatPick'); if (pick) pick.style.display = 'none';
  await mountAgentReviewChat(rId, '#oppChatBox');
}

// 模块二·前置评审任务中心(#/tasks): 六部门 BP 打灯待办/已处理/支持组全监控
async function renderTasksCenter() {
  const page = $('#page');
  showLoading(page);
  const canAll = ME.role === '销售支持组' || ME.role === 'admin';
  const st = window._taskS || (window._taskS = { tab: 'mine' });
  const onlyReview = new URLSearchParams((location.hash.split('?')[1] || '')).get('review_id') || ''; // 机器人提醒深链: 只在浏览器端过滤, 服务端 scope/部门鉴权一行不动
  const h0 = location.hash; // 竞态守卫
  const d = await apiCached('/api/tasks?scope=' + st.tab);
  if (!(location.hash || '').startsWith('#/tasks')) return;
  let rows = visibleRows(d.tasks || []).filter(t => (!onlyReview || String(t.review_id) === String(onlyReview)) && (!st.dept || t.dept === st.dept) && (!st.type || t.type === st.type));
  window._taskRows = rows;
  const totalRows = rows.length;
  if (st.collapse) rows = rows.filter((t, i, a) => st.expanded?.[t.review_id] || a.findIndex(x => x.review_id === t.review_id) === i);
  const totalPages = Math.max(1, Math.ceil(rows.length / 50));
  const pageNo = Math.min(st.page || 1, totalPages);
  rows = rows.slice((pageNo - 1) * 50, pageNo * 50);
  const ids = [...new Set(rows.map(t => t.review_id))];
  const details = await Promise.allSettled(ids.map(id => apiCached('/api/reviews/' + id)));
  if (location.hash !== h0) return;
  const progress = new Map(details.filter(x => x.status === 'fulfilled').map(({ value: x }) => {
    const ts = x.tasks.filter(t => t.round === x.review.round);
    return [x.review.id, { done: ts.filter(t => t.status === 'done').length, total: ts.length }];
  }));
  const stats = (localStorage.incFixture === '1' ? d.stats_all : d.stats) || null;
  const taskSt = t => t.status === 'cancelled' ? pill('已作废', 'p-gray') : t.status === 'pending' ? pill('待打灯', 'p-yellow') : t.status === 'returned' ? pill('已退回', 'p-red') : (lightPill(t.light) || pill('已处理', 'p-gray'));
  page.innerHTML = `
  <div class="card"><h3>前置评审任务中心
    ${[['mine', '待打灯'], ['done', '已处理'], ...(canAll ? [['all', '全部监控']] : [])].map(([k, l]) => `<button class="btn sm${st.tab === k ? ' pri' : ''}" style="float:right;margin-left:6px" onclick="setTaskTab('${k}')">${l}</button>`).join('')}
    <div style="clear:both;font-size:12px;color:var(--text-4);line-height:1.7">${evidenceDepts().map(esc).join('、')}对各自指标打灯；全部收齐后系统自动研判。</div>
  </h3>
  ${st.tab === 'all' ? `<div class="row" style="margin-bottom:10px">
    <select aria-label="部门筛选" onchange="setTaskFilter('dept',this.value)"><option value="">全部部门</option>${evidenceDepts().map(dp => `<option ${st.dept === dp ? 'selected' : ''}>${esc(dp)}</option>`).join('')}</select>
    <select aria-label="类型筛选" onchange="setTaskFilter('type',this.value)"><option value="">全部类型</option>${Object.entries(TYPE_NAMES).map(([k,l]) => `<option value="${k}" ${st.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
    <label><input type="checkbox" ${st.collapse ? 'checked' : ''} onchange="setTaskFilter('collapse',this.checked)"> 按评审折叠</label></div>
    ${stats ? `<div class="hint">全库统计：已处理 ${stats.handled} · 代打占比 ${stats.handled ? (stats.proxy / stats.handled * 100).toFixed(1) : '0.0'}%（${stats.proxy}/${stats.handled}） · 僵尸 ${stats.zombie} · 已作废 ${stats.cancelled}。列表仅最近200条，筛选后已加载 ${totalRows} 条，不代表全库。</div>` : ''}` : ''}
  ${onlyReview ? `<div class="std-box">来自机器人提醒: 当前只显示评审单 #${esc(onlyReview)} 的打灯任务(${rows.length} 条)。若该单暂无你的待办, 说明尚未分发到你所在部门。<a href="#/tasks" style="margin-left:8px">清除筛选,查看全部任务 →</a></div>` : ''}
  ${`<div class="card-table-wrap"><table id="taskTbl">
    <tr><th>项目</th><th>商机代码</th><th>评审类型</th><th>评判指标</th><th>部门</th><th class="num">轮次</th><th>状态</th><th>本单进度</th><th>评审人</th><th class="ops">操作</th></tr>
    ${rows.length ? rows.map((t, i) => `<tr data-task-review="${t.review_id}">
      <td><a href="#/review/${t.review_id}">${esc(t.title)}</a>${st.collapse && rows.findIndex(x => x.review_id === t.review_id) === i ? ` <button class="btn sm" data-task-review="${t.review_id}" onclick="toggleTaskReview(${t.review_id})">${st.expanded?.[t.review_id] ? '收起本单' : '展开本单'}</button>` : ''}</td>
      <td style="font-family:monospace;font-size:12px">${esc(t.opp_code || '—')}</td>
      <td>${TYPE_NAMES[t.type] || ''}</td>
      <td><b>${esc(t.ind_name)}</b></td>
      <td>${esc(t.dept)}</td>
      <td class="num">${t.round}</td>
      <td>${taskSt(t)}</td><td>${progress.has(t.review_id) ? progress.get(t.review_id).done + '/' + progress.get(t.review_id).total : '—/—'}</td><td>${esc(taskActor(t))}</td>
      <td class="ops">${st.tab === 'mine' ? `<button class="btn sm pri" onclick="openTask(${t.id})">打灯</button>` : `<a href="#/review/${t.review_id}">查看</a>`}</td>
    </tr>`).join('') : '<tr><td colspan="10" style="color:var(--text-4);text-align:center;padding:14px">暂无任务</td></tr>'}
  </table></div>`}
  ${totalPages > 1 ? `<div style="margin-top:10px"><button class="btn sm" ${pageNo === 1 ? 'disabled' : ''} onclick="setTaskFilter('page',${pageNo - 1})">上一页</button> 第 ${pageNo}/${totalPages} 页 <button class="btn sm" ${pageNo === totalPages ? 'disabled' : ''} onclick="setTaskFilter('page',${pageNo + 1})">下一页</button></div>` : ''}
  </div>`;
}
function setTaskTab(k) { window._taskS = { tab: k }; rerenderPage(); }
function setTaskFilter(k, v) { window._taskS[k] = v; if (k !== 'page') window._taskS.page = 1; rerenderPage(); }
function toggleTaskReview(id) {
  const st = window._taskS;
  st.expanded ||= {};
  st.expanded[id] = !st.expanded[id]; st.page = 1;
  rerenderPage();
}

// 模块三·研判与结论(#/judge): 红绿灯队列(前置收集中/待上会/绿灯待归档/红灯打回)+灯色分布
async function renderJudgeBoard() {
  const page = $('#page');
  showLoading(page);
  const h0 = location.hash; // 竞态守卫
  const d = await apiCached('/api/reviews?scope=all');
  if (!(location.hash || '').startsWith('#/judge')) return;
  const rs = visibleRows(d.reviews || []);
  const qs = {
    reviewing: rs.filter(r => r.status === 'reviewing'),
    meet: rs.filter(r => r.status === 'judged' && r.light === 'yellow'),
    green: rs.filter(r => r.status === 'judged' && r.light === 'green'),
    red: rs.filter(r => r.status === 'judged' && r.light === 'red'),
    arc: rs.filter(r => r.status === 'archived'),
    noLight: rs.filter(r => r.status === 'judged' && !r.light),
    draft: rs.filter(r => ['draft', 'returned'].includes(r.status))
  };
  const qRow = r => `<tr>
    <td><a href="#/review/${r.id}">${esc(r.title)}</a></td>
    <td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td>
    <td>${TYPE_NAMES[r.type]}</td><td>${esc(r.applicant_name)}</td>
    <td>${lightPill(r.light) || statusPill(r.status)}</td><td>${fmtT(r.updated_at)}</td>
    <td class="ops"><a href="#/review/${r.id}">进入详情</a></td>
  </tr>`;
  const qTable = (list, key) => list.length === 0 ? '<div class="empty">暂无</div>' : `<div class="card-table-wrap"><table>
    <tr><th>项目</th><th>商机代码</th><th>类型</th><th>申请人</th><th>灯态/状态</th><th>更新时间</th><th class="ops">操作</th></tr>
    ${list.slice(0, window._queueExpand?.[key] ? list.length : 10).map(qRow).join('')}
  </table>${list.length > 10 ? `<button class="btn sm" onclick="toggleQueue('${key}')">${window._queueExpand?.[key] ? '收起' : '展开全部'}（${list.length} 张）</button>` : ''}</div>`;
  page.innerHTML = `
  <div id="judgePage">
  <div class="metric-grid">
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/opps'"><span class="m-label">编制中(草稿/退回)</span><span class="m-value">${qs.draft.length}</span><span class="m-foot">去评审单列表</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/tasks'"><span class="m-label">前置收集中</span><span class="m-value tone-brand">${qs.reviewing.length}</span><span class="m-foot">催办去任务中心</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="document.getElementById('queue-meet').scrollIntoView()"><span class="m-label">待上会 · 待结论</span><span class="m-value tone-yellow">${qs.meet.length}</span><span class="m-foot">黄灯: 周二部门级/周五XO级</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="document.getElementById('queue-green').scrollIntoView()"><span class="m-label">绿灯待归档</span><span class="m-value tone-green">${qs.green.length}</span><span class="m-foot">发布结论后归档</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="document.getElementById('queue-red').scrollIntoView()"><span class="m-label">红灯已打回</span><span class="m-value tone-red">${qs.red.length}</span><span class="m-foot">等申请人修改重提</span></div>
    <div class="metric-tile" style="cursor:pointer" onclick="location.hash='#/archive'"><span class="m-label">已归档</span><span class="m-value">${qs.arc.length}</span><span class="m-foot">去归档库 BI</span></div>
  </div>
  <div class="card"><h3>灯色分布(全部在线评审单)</h3>${lightDistBar(rs)}</div>
  <div class="card"><h3>前置收集中(${qs.reviewing.length}) <a href="#/tasks" style="float:right;font-size:13px">任务中心催办 →</a></h3>${qTable(qs.reviewing, 'reviewing')}</div>
  <div class="card" id="queue-meet"><h3>待上会 · 待结论(${qs.meet.length}) <span style="font-size:12px;color:var(--text-4);font-weight:400">黄灯上会, 会后由销售支持组在详情页录入结论</span></h3>${qTable(qs.meet, 'meet')}</div>
  <div class="card" id="queue-green"><h3>绿灯待归档(${qs.green.length}) <span style="font-size:12px;color:var(--text-4);font-weight:400">免上会, 发布结论后归档</span></h3>${qTable(qs.green, 'green')}</div>
  <div class="card" id="queue-red"><h3>红灯已打回(${qs.red.length}) <span style="font-size:12px;color:var(--text-4);font-weight:400">红线不可豁免, 修改后重新提交进新轮次</span></h3>${qTable(qs.red, 'red')}</div>
  ${qs.noLight.length ? `<div class="card"><h3>历史已研判无灯态(${qs.noLight.length}) <span style="font-size:12px;color:var(--text-4);font-weight:400">存量数据, 不进入队列</span></h3><div class="empty">仅计数提示</div></div>` : ''}
  </div>`;
}

function toggleQueue(k) {
  window._queueExpand = window._queueExpand || {};
  window._queueExpand[k] = !window._queueExpand[k];
  renderJudgeBoard().then(() => document.getElementById('queue-' + k)?.scrollIntoView());
}

// ---- V4.0 T9: LLM 管理中心(#/admin/llm, admin 限定; 顶层配置 + profile + 探针 + 降级 + 提示词版本 + 用量) ----
const LLM_PROF_LABEL = { default: '默认', budget: '技能① 预算', review: '技能② 评审表', parser: '解析器' };
const LLM_SRC_LABEL = { profile: 'profile', default: '回退 default', env: '环境变量', config: '顶层配置', builtin: '内置默认', none: '未配置' };
async function renderLlmAdmin() {
  const page = $('#page');
  if (ME.role !== 'admin') { toast('仅 admin 可访问', 1); return location.hash = '#/'; }
  showLoading(page);
  try {
    const [cfg, pf, us] = await Promise.all([api('/api/admin/config'), api('/api/admin/llm/profiles'), api('/api/admin/llm/usage?days=7')]);
    const pm = cfg.LLM_PROFILES_MASKED || {};
    const src = s => esc(LLM_SRC_LABEL[s] || s || '');
    const dg = pf.degrade || {};
    const profRows = pf.profiles.map(r => `<tr>
      <td><b>${esc(LLM_PROF_LABEL[r.name] || r.name)}</b><br><span style="font-size:11px;color:var(--text-4)">${esc(r.name)}</span></td>
      <td>${esc(r.base || '—')}<br><span style="font-size:11px;color:var(--text-4)">${src(r.base_src)}</span></td>
      <td>${esc(r.model || '—')}<br><span style="font-size:11px;color:var(--text-4)">${src(r.model_src)}</span></td>
      <td>${esc(r.key_masked || '未设')}<br><span style="font-size:11px;color:var(--text-4)">${src(r.key_src)}</span></td>
      <td><button class="btn" onclick="probeLlm('${r.name}')">连通性探针</button><div id="probe_${r.name}" style="font-size:12px;margin-top:4px"></div></td></tr>`).join('');
    const profForms = ['default', 'budget', 'review', 'parser'].map(n => {
      const o = pm[n] || {};
      return `<div class="f-item full" style="border-top:1px solid var(--line, #eee);padding-top:8px"><label><b>${esc(LLM_PROF_LABEL[n])}</b>（${n}）覆盖项，留空表示沿用回退链</label>
        <div class="f-grid">
          <div class="f-item"><label>base</label><input id="pf_${n}_base" value="${esc(o.base || '')}" placeholder="http(s)://…"></div>
          <div class="f-item"><label>model</label><input id="pf_${n}_model" value="${esc(o.model || '')}"></div>
          <div class="f-item"><label>key（当前 ${esc(o.key || '未设')}，留空不改）</label><input id="pf_${n}_key" type="password" placeholder="留空表示不修改"></div>
          <div class="f-item"><label>&nbsp;</label><button class="btn" onclick="clearLlmProfile('${n}')">清空本 profile 覆盖</button></div>
        </div></div>`;
    }).join('');
    const promptList = s => {
      const vs = (pf.prompts || {})[s] || [];
      return vs.length ? vs.map((r, i) => `v${r.v} · ${r.chars} 字 · ${esc(r.updated_by || '')} · ${esc((r.updated_at || '').slice(0, 16).replace('T', ' '))}${i === 0 ? ' <span class="pill p-green">生效</span>' : ''}`).join('<br>') : '未覆盖（使用冻结默认）';
    };
    const usageRows = (us.rows || []).map(r => `<tr><td>${esc(r.profile)}</td><td>${r.n}</td><td>${r.ok_n || 0}</td><td>${r.n - (r.ok_n || 0)}</td><td>${r.deg_n || 0}</td><td>${r.avg_ms || 0} ms</td><td>${r.tokens_est || 0}</td></tr>`).join('');
    page.innerHTML = `
    <div class="card"><h3>LLM 管理中心 <span class="pill p-purple">admin</span></h3>
      <div class="std-box">LLM 只做「口语 → 结构化字段」与「缺项 → 追问」；判灯、算账、锁定、提交、结论确认不读 LLM 输出。调用失败自动降级为点选问答。修改即时生效，密钥永不回显明文。</div>
      <table><thead><tr><th>profile</th><th>base（来源）</th><th>model（来源）</th><th>key（来源）</th><th>诊断</th></tr></thead><tbody>${profRows}</tbody></table>
    </div>
    <div class="card"><h3>顶层配置（所有 profile 的最终回退）</h3>
      <div class="f-grid">
        <div class="f-item"><label>LLM_BASE_URL（网关地址）</label><input id="cfg_base" value="${esc(cfg.LLM_BASE_URL || '')}"></div>
        <div class="f-item"><label>LLM_MODEL（模型名）</label><input id="cfg_model" value="${esc(cfg.LLM_MODEL || '')}"></div>
        <div class="f-item full"><label>LLM_API_KEY（密钥，当前 ${esc(cfg.LLM_API_KEY_MASKED || '未设')}，留空不修改）</label><input id="cfg_key" type="password" placeholder="留空表示不修改"></div>
      </div>
      <button class="btn pri" onclick="saveLlmConfig()">保存顶层配置</button>
    </div>
    <div class="card"><h3>Profile 覆盖 <span style="font-size:12px;color:var(--text-4);font-weight:400">优先级：profile → default → 环境变量 → 顶层配置 → 内置默认</span></h3>
      <div class="f-grid">${profForms}</div>
      <button class="btn pri" onclick="saveLlmProfiles()">保存 profile</button>
    </div>
    <div class="card"><h3>降级参数</h3>
      <div class="f-grid">
        <div class="f-item"><label>超时 timeout_ms（1000~60000，缺省技能 30000 / 探针 8000）</label><input id="dg_timeout" type="number" value="${dg.timeout_ms != null ? esc(String(dg.timeout_ms)) : ''}"></div>
        <div class="f-item"><label>重试次数 retries（0~2，缺省 0）</label><input id="dg_retries" type="number" value="${dg.retries != null ? esc(String(dg.retries)) : ''}"></div>
        <div class="f-item"><label>启用 LLM（关闭则技能直接走点选问答）</label><select id="dg_enabled"><option value="1"${dg.enabled === false ? '' : ' selected'}>启用</option><option value="0"${dg.enabled === false ? ' selected' : ''}>关闭</option></select></div>
      </div>
      <button class="btn pri" onclick="saveLlmDegrade()">保存降级参数</button>
    </div>
    <div class="card"><h3>提示词版本 <span style="font-size:12px;color:var(--text-4);font-weight:400">只追加新版本，最高版本生效；无版本时使用冻结默认</span></h3>
      <div class="f-grid">
        <div class="f-item"><label>技能① 预算（budget）</label><div style="font-size:12px">${promptList('budget')}</div></div>
        <div class="f-item"><label>技能② 评审表（review）</label><div style="font-size:12px">${promptList('review')}</div></div>
        <div class="f-item"><label>目标技能</label><select id="pr_skill"><option value="budget">技能① 预算</option><option value="review">技能② 评审表</option></select></div>
        <div class="f-item full"><label>新版本全文（≤8000 字）</label><textarea id="pr_text" rows="5"></textarea></div>
      </div>
      <button class="btn pri" onclick="saveLlmPrompt()">发布新版本</button>
    </div>
    <div class="card"><h3>近 ${us.days} 日用量</h3>
      ${usageRows ? `<table><thead><tr><th>profile</th><th>调用</th><th>成功</th><th>失败</th><th>降级</th><th>平均延迟</th><th>估算 tokens</th></tr></thead><tbody>${usageRows}</tbody></table>` : '<div class="empty">近期无调用记录</div>'}
    </div>`;
  } catch (e) { toast(e.message, 1); }
}
async function saveLlmConfig() {
  const body = {};
  if ($('#cfg_base').value.trim()) body.LLM_BASE_URL = $('#cfg_base').value.trim();
  if ($('#cfg_model').value.trim()) body.LLM_MODEL = $('#cfg_model').value.trim();
  if ($('#cfg_key').value.trim()) body.LLM_API_KEY = $('#cfg_key').value.trim();
  if (!Object.keys(body).length) return toast('未填写任何要修改的键', 1);
  try {
    const d = await api('/api/admin/config', 'POST', body);
    toast('已生效（无需重启），更新 ' + d.updated + ' 键，密钥 ' + d.LLM_API_KEY_MASKED);
    renderLlmAdmin();
  } catch (e) { toast(e.message, 1); }
}
async function saveLlmProfiles() {
  const P = {};
  for (const n of ['default', 'budget', 'review', 'parser']) {
    const v = {};
    for (const f of ['base', 'model', 'key']) { const x = $('#pf_' + n + '_' + f).value.trim(); if (x) v[f] = x; }
    if (Object.keys(v).length) P[n] = v;
  }
  if (!Object.keys(P).length) return toast('未填写任何 profile 覆盖', 1);
  try { const d = await api('/api/admin/config', 'POST', { LLM_PROFILES: P }); toast('profile 已生效，更新 ' + d.updated + ' 项'); renderLlmAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function clearLlmProfile(n) {
  if (!confirm('清空 ' + n + ' 的 base/model/key 覆盖？清空后按回退链取值。')) return;
  try { await api('/api/admin/config', 'POST', { LLM_PROFILES: { [n]: { base: null, model: null, key: null } } }); toast(n + ' 覆盖已清空'); renderLlmAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function probeLlm(n) {
  const el = $('#probe_' + n);
  el.textContent = '探测中…';
  try {
    const d = await api('/api/admin/llm/test', 'POST', { profile: n });
    el.innerHTML = d.ok ? `<span class="pill p-green">连通</span> ${d.ms} ms` : `<span class="pill p-red">失败</span> ${d.ms} ms<br>${esc(d.error || '')}`;
  } catch (e) { el.textContent = e.message; }
}
async function saveLlmDegrade() {
  const degrade = { enabled: $('#dg_enabled').value === '1' };
  if ($('#dg_timeout').value.trim()) degrade.timeout_ms = Number($('#dg_timeout').value);
  if ($('#dg_retries').value.trim()) degrade.retries = Number($('#dg_retries').value);
  try { await api('/api/admin/llm/settings', 'POST', { degrade }); toast('降级参数已生效'); renderLlmAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function saveLlmPrompt() {
  const text = $('#pr_text').value.trim();
  if (!text) return toast('提示词不能为空', 1);
  try { const d = await api('/api/admin/llm/settings', 'POST', { prompt: { skill: $('#pr_skill').value, text } }); toast('已发布 ' + d.prompt.skill + ' v' + d.prompt.v); renderLlmAdmin(); }
  catch (e) { toast(e.message, 1); }
}

// ---- V4.0 T10: 机器人管理中心(#/admin/robot, admin 限定; 实例 + 通知矩阵 + 机器人白名单) ----
const ROBOT_CH_LABEL = { notify: '通知群', committee: '评审委员会群' };
const ROBOT_TARGET_LABEL = { sales_group: '销售支持群', applicant: '申请人', committee: '评审委员会', dept: '前置评审部门' };
// T7: 业务接入三页签。绑定/群目标状态取自服务端 BINDING_STATUS/TARGET_STATUS 口径; 外发箱状态取自 robot_outbox.status 值域
const RBA_TABS = [['bindings', '员工绑定'], ['targets', '群目标'], ['outbox', '外发箱']];
const RBA_LINK_STATUS = { unbound: ['未绑定', 'p-gray'], active: ['已绑定', 'p-green'], disabled: ['已停用', 'p-gray'] };
const RBA_OUTBOX_STATUS = { preview: ['仅预演', 'p-blue'], ready: ['待发送', 'p-yellow'], sent: ['已发送', 'p-green'], failed: ['发送失败', 'p-red'], cancelled: ['已取消', 'p-gray'] };
// 群目标默认候选: 每个前置评审部门一行(与 server INDICATORS 的 dept 值域同集合); 库里已有的其它键由 I1 并集补进来, 不靠这张表穷举
const ROBOT_DEPT_TARGETS = ['FDE', '财务BP', '采购BP', '法务', '合规BP', '数据BP'];
const RBA_PATH = { bindings: '/api/admin/robot/bindings', targets: '/api/admin/robot/targets', outbox: '/api/admin/robot/outbox', users: '/api/users' };
let RBA = null;
const rbaPill = (map, s) => { const p = map[s]; return p ? pill(p[0], p[1]) : pill(esc(String(s == null ? '' : s)), 'p-gray'); };
const rbaFail = names => `<div class="empty" style="margin-top:12px">${names.map(n => RBA_PATH[n]).join('、')} 加载失败，请刷新本页重试。</div>`;
async function renderRobotAdmin() {
  const page = $('#page');
  if (ME.role !== 'admin') { toast('仅 admin 可访问', 1); return location.hash = '#/'; }
  showLoading(page);
  try {
    // 新四路各自兜底: 它们只喂第六张卡, 任何一路 5xx 都不该把既有五区一起白屏掉
    const [ins, mx, wl, bindR, tgtR, outR, usersR] = await Promise.all([
      api('/api/admin/robot/instances'), api('/api/admin/robot/matrix'), api('/api/admin/robot/whitelist'),
      api('/api/admin/robot/bindings').catch(() => null), api('/api/admin/robot/targets').catch(() => null),
      api('/api/admin/robot/outbox?limit=100').catch(() => null), api('/api/users').catch(() => null)
    ]);
    // 四路数据随页取齐(而非切页时现取): 点页签只做同步渲染, 不让一次网络往返挡在点击和出画面之间
    const targetKeys = ['committee', 'sales_group'].concat(ROBOT_DEPT_TARGETS.map(d => 'dept:' + d));
    // I1: 库里已有但不在默认候选里的 target_key 一并列出——不可见即不可编, 且那是别人写进去的真数据
    (tgtR ? tgtR.targets || [] : []).forEach(t => { if (t.target_key && targetKeys.indexOf(t.target_key) < 0) targetKeys.push(t.target_key); });
    RBA = { tab: (RBA && RBA.tab) || 'bindings', bindings: bindR ? bindR.bindings || [] : [], targets: tgtR ? tgtR.targets || [] : [],
      outbox: outR ? outR.rows || [] : [], backlog: outR ? outR.backlog : null, users: usersR ? usersR.users || [] : [], targetKeys: targetKeys,
      bad: { bindings: !bindR, targets: !tgtR, outbox: !outR, users: !usersR } };

    const act = ch => {
      const a = (ins.active || {})[ch] || {};
      if (a.source === 'db') return `<span class="pill p-green">DB 实例</span> ${esc(a.name || '')}`;
      return a.configured ? `<span class="pill p-yellow">config 回落</span> ${esc(a.name || '')}` : '<span class="pill">未配置(静默跳过)</span>';
    };
    const insRows = (ins.instances || []).map(r => `<tr>
      <td><b>${esc(r.name)}</b><br><span style="font-size:11px;color:var(--text-4)">#${r.id} · ${esc(r.env || '')}</span></td>
      <td>${esc(ROBOT_CH_LABEL[r.channel] || r.channel)}</td>
      <td style="word-break:break-all;font-size:12px">${esc(r.webhook)}</td>
      <td>${r.has_secret ? esc(r.secret_masked) : '未加签'}</td>
      <td>${r.enabled ? '<span class="pill p-green">启用</span>' : '<span class="pill">停用</span>'}</td>
      <td><button class="btn" onclick="robotToggle(${r.id},${r.enabled ? 0 : 1})">${r.enabled ? '停用' : '启用'}</button>
        <button class="btn" onclick="robotTest(${r.id})">测试</button>
        <button class="btn" onclick="robotDel(${r.id})">删除</button>
        <div id="rbt_${r.id}" style="font-size:12px;margin-top:4px"></div></td></tr>`).join('');
    const mxRows = (mx.events || []).map(e => `<tr>
      <td><b>${esc(e.label || e.event)}</b><br><span style="font-size:11px;color:var(--text-4)">${esc(e.event)}</span></td>
      <td>${esc(ROBOT_TARGET_LABEL[e.target] || e.target)}</td>
      <td>${esc(ROBOT_CH_LABEL[e.channel] || e.channel)}</td>
      <td><label><input type="checkbox" ${e.enabled ? 'checked' : ''} onchange="robotMatrix('${e.event}', this.checked)"> 发送</label>
        ${e.configured ? '' : '<span style="font-size:11px;color:var(--text-4)">(未配置, 默认放行)</span>'}</td></tr>`).join('');
    const wlRows = (wl.whitelist || []).map(w => `<tr><td>${esc(w.kind === 'user_id' ? '用户 ID' : '手机号')}</td><td>${esc(w.ident)}${w.user_name ? ' · ' + esc(w.user_name) : ''}</td>
      <td>${w.scope === 'create' ? '建档/提交 + 查询' : '仅查询'}</td><td><button class="btn" onclick="robotWlDel(${w.id})">移除</button></td></tr>`).join('');
    const cfg = ins.config || {};
    page.innerHTML = `
    <div class="card"><h3>机器人管理 <span class="pill p-purple">admin</span></h3>
      <div class="std-box">发送目标以「已启用的 DB 实例」为唯一真源（按群通道各取一个），无启用实例时回落 config.json 两键；同一事件只发一次。未配置任何目标时静默跳过，通知失败永不阻断评审流程。secret 只写不回显。</div>
      <div class="f-grid">
        <div class="f-item"><label>通知群当前目标</label><div>${act('notify')}</div></div>
        <div class="f-item"><label>评审委员会群当前目标</label><div>${act('committee')}</div></div>
      </div>
      ${insRows ? `<table><thead><tr><th>实例</th><th>群通道</th><th>webhook（查询参数已掩码）</th><th>加签 secret</th><th>状态</th><th>操作</th></tr></thead><tbody>${insRows}</tbody></table>` : '<div class="empty">暂无机器人实例</div>'}
    </div>
    <div class="card"><h3>新增机器人实例</h3>
      <div class="f-grid">
        <div class="f-item"><label>名称</label><input id="rb_name" maxlength="64"></div>
        <div class="f-item"><label>群通道</label><select id="rb_channel"><option value="notify">通知群</option><option value="committee">评审委员会群</option></select></div>
        <div class="f-item full"><label>webhook（仅 http/https）</label><input id="rb_webhook" placeholder="https://oapi.dingtalk.com/robot/send?access_token=…"></div>
        <div class="f-item"><label>加签 secret（可选，保存后不再显示）</label><input id="rb_secret" type="password"></div>
        <div class="f-item"><label>环境</label><select id="rb_env"><option value="prod">prod</option><option value="sit">sit</option></select></div>
        <div class="f-item"><label>启用</label><select id="rb_enabled"><option value="0">先停用（测试通过后再启用）</option><option value="1">立即启用</option></select></div>
      </div>
      <button class="btn pri" onclick="robotAdd()">保存实例</button>
    </div>
    <div class="card"><h3>config.json 回落键（只读）</h3>
      <div class="f-grid">
        <div class="f-item"><label>NOTIFY_WEBHOOK_URL</label><div style="word-break:break-all;font-size:12px">${esc(cfg.NOTIFY_WEBHOOK_URL || '未配置')}</div></div>
        <div class="f-item"><label>COMMITTEE_WEBHOOK_URL</label><div style="word-break:break-all;font-size:12px">${esc(cfg.COMMITTEE_WEBHOOK_URL || '未配置')}</div></div>
      </div>
      <button class="btn" onclick="robotImport()">导入为停用实例</button>
    </div>
    <div class="card"><h3>通知矩阵 <span style="font-size:12px;color:var(--text-4);font-weight:400">勾掉即该事件不再出站；矩阵读取异常时放行发送</span></h3>
      <table><thead><tr><th>事件</th><th>接收对象</th><th>群通道</th><th>开关</th></tr></thead><tbody>${mxRows}</tbody></table>
    </div>
    <div class="card"><h3>机器人白名单 <span style="font-size:12px;color:var(--text-4);font-weight:400">只决定能否经机器人入口办事，不豁免任何业务门禁</span></h3>
      ${wlRows ? `<table><thead><tr><th>类型</th><th>身份</th><th>范围</th><th>操作</th></tr></thead><tbody>${wlRows}</tbody></table>` : '<div class="empty">白名单为空：机器人入口一律拒绝</div>'}
      <div class="f-grid">
        <div class="f-item"><label>类型</label><select id="wl_kind"><option value="user_id">用户 ID</option><option value="phone">手机号</option></select></div>
        <div class="f-item"><label>身份</label><input id="wl_ident"></div>
        <div class="f-item"><label>范围</label><select id="wl_scope"><option value="query">仅查询</option><option value="create">建档/提交</option></select></div>
      </div>
      <button class="btn pri" onclick="robotWlAdd()">加入白名单</button>
    </div>
    <div class="card" id="robotBusinessAdmin">
      <h3>业务机器人接入 <span class="pill p-yellow">生成待发送草稿（本地预演）</span></h3><div>本地预演 · ${RBA.backlog == null ? '待投递积压读取失败' : RBA.backlog + ' 条待投递'}（全库统计，不受列表条数限制）</div>
      <div class="std-box">状态口径：未绑定＝外部身份或群引用还没人工填写；仅预演＝消息已入箱、未交给钉钉；发送失败＝交给钉钉后被拒(本轮未连接钉钉, 不会自动产生)；已取消＝人工取消后不再发送。外部身份只用于路由，不授予平台权限。</div>
      <div class="tabbar" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${RBA_TABS.map(([k, l]) => `<button class="btn sm" data-rba="${k}" onclick="setRobotBusinessTab('${k}')">${l}</button>`).join('')}
      </div>
      <div id="robotBusinessPane"></div>
    </div>`;
    syncRobotBusinessTabs();
  } catch (e) { toast(e.message, 1); }
}
async function robotAdd() {
  const body = { name: $('#rb_name').value.trim(), webhook: $('#rb_webhook').value.trim(), channel: $('#rb_channel').value, env: $('#rb_env').value, enabled: $('#rb_enabled').value === '1' };
  if ($('#rb_secret').value) body.secret = $('#rb_secret').value;
  try { await api('/api/admin/robot/instances', 'POST', body); toast('实例已保存'); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function robotToggle(id, enabled) {
  try { await api('/api/admin/robot/instances/' + id, 'PUT', { enabled: !!enabled }); toast(enabled ? '已启用' : '已停用'); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function robotDel(id) {
  if (!confirm('删除该机器人实例？')) return;
  try { await api('/api/admin/robot/instances/' + id, 'DELETE'); toast('已删除'); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function robotTest(id) {
  const el = $('#rbt_' + id);
  el.textContent = '发送中…';
  try {
    const d = await api('/api/admin/robot/test', 'POST', { id });
    el.innerHTML = d.ok ? `<span class="pill p-green">已送达</span> ${d.ms} ms` : `<span class="pill p-red">失败</span> ${d.ms} ms<br>${esc(d.error || '')}`;
  } catch (e) { el.textContent = e.message; }
}
async function robotImport() {
  try { const d = await api('/api/admin/robot/import-config', 'POST', {}); toast('新导入 ' + d.inserted + ' 个停用实例'); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function robotMatrix(event, on) {
  try { await api('/api/admin/robot/matrix', 'PUT', { event, enabled: on }); toast((on ? '已开启 ' : '已关闭 ') + event); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); renderRobotAdmin(); }
}
async function robotWlAdd() {
  try { await api('/api/admin/robot/whitelist', 'POST', { kind: $('#wl_kind').value, ident: $('#wl_ident').value.trim(), scope: $('#wl_scope').value }); toast('已加入白名单'); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); }
}
async function robotWlDel(id) {
  try { await api('/api/admin/robot/whitelist/' + id, 'DELETE'); toast('已移除'); renderRobotAdmin(); }
  catch (e) { toast(e.message, 1); }
}

// ---- T7: 业务机器人接入三页签(员工绑定 / 群目标 / 外发箱)——只读写 T3 已有的 admin 端点, 不新增第二套后端 ----
function setRobotBusinessTab(k) {
  if (!RBA) return;
  RBA.tab = k;
  document.querySelectorAll('#robotBusinessAdmin [data-rba]').forEach(b => {
    const on = b.dataset.rba === k;
    b.classList.toggle('active', on);
    b.classList.toggle('pri', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const box = $('#robotBusinessPane');
  if (box) box.innerHTML = k === 'targets' ? rbaTargetsPane() : k === 'outbox' ? rbaOutboxPane() : rbaBindingsPane();
}
function syncRobotBusinessTabs() { setRobotBusinessTab(RBA.tab); }
function rbaBindingsPane() {
  if (RBA.bad.users || RBA.bad.bindings) return rbaFail(['users', 'bindings']);
  const byUser = {};
  RBA.bindings.forEach(b => { if (b.provider === 'dingtalk') byUser[b.user_id] = b; });
  const rows = RBA.users.map(u => {
    const b = byUser[u.id] || {};
    const st = b.status || 'unbound';
    return `<tr>
      <td><b>${esc(u.name)}</b><br><span style="font-size:11px;color:var(--text-4)">${esc(u.username)}</span></td>
      <td>${esc(u.role)}</td><td>${esc(u.dept || '—')}</td>
      <td><input id="rbbExt_${u.id}" maxlength="128" value="${esc(b.external_user_id || '')}"></td>
      <td><input id="rbbPhone_${u.id}" maxlength="32" value="${esc(b.phone || '')}"></td>
      <td>${rbaPill(RBA_LINK_STATUS, st)}
        <select id="rbbStatus_${u.id}" style="margin-top:4px">${['unbound', 'active', 'disabled'].map(s => `<option value="${s}"${s === st ? ' selected' : ''}>${RBA_LINK_STATUS[s][0]}</option>`).join('')}</select></td>
      <td><button class="btn sm" onclick="robotBindingSave(${u.id})">保存</button>
        <div style="font-size:11px;color:var(--text-4);margin-top:3px">${b.updated_at ? esc(String(b.updated_at).slice(0, 19)) + ' · ' + esc(b.updated_by || '') : '尚未登记'}</div></td></tr>`;
  }).join('');
  return `<div class="std-box" style="margin-top:12px">外部身份只用于路由，不授予平台权限：这里填的钉钉身份与手机号只决定消息发给谁，能不能建档、打灯、锁定仍由平台角色和门禁判定。没有外部身份的行标「未绑定」。</div>
    <table><thead><tr><th>员工</th><th>角色</th><th>部门</th><th>外部用户 ID</th><th>手机号</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function rbaTargetsPane() {
  if (RBA.bad.targets) return rbaFail(['targets']);
  const byKey = {};
  RBA.targets.forEach(t => { byKey[t.target_key] = t; });
  const rows = RBA.targetKeys.map((k, i) => {
    const t = byKey[k] || {};
    const st = t.status || 'unbound';
    const label = k.indexOf('dept:') === 0 ? ROBOT_TARGET_LABEL.dept + '·' + k.slice(5) : (ROBOT_TARGET_LABEL[k] || k);
    return `<tr>
      <td><b>${esc(label)}</b><br><span style="font-size:11px;color:var(--text-4)">${esc(k)} · ${esc(t.target_type || 'group')}</span></td>
      <td><input id="rbtRef_${i}" maxlength="512" value="${esc(t.external_ref || '')}"></td>
      <td>${rbaPill(RBA_LINK_STATUS, st)}
        <select id="rbtStatus_${i}" style="margin-top:4px">${['unbound', 'active', 'disabled'].map(s => `<option value="${s}"${s === st ? ' selected' : ''}>${RBA_LINK_STATUS[s][0]}</option>`).join('')}</select></td>
      <td style="font-size:12px">${t.updated_at ? esc(String(t.updated_at).slice(0, 19)) + ' · ' + esc(t.updated_by || '') : '尚未登记'}</td>
      <td><button class="btn sm" onclick="robotTargetSave(${i})">保存</button></td></tr>`;
  }).join('');
  return `<div class="std-box" style="margin-top:12px">群引用要人工从钉钉侧抄过来，未填的行一律按「未绑定」提交，系统不会生成或猜测群 ID。dept:&lt;部门&gt; 按前置评审部门各一行。</div>
    <table><thead><tr><th>目标</th><th>外部群引用</th><th>状态</th><th>最后更新</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function rbaOutboxPane() {
  if (RBA.bad.outbox) return rbaFail(['outbox']);
  const bindByUser = {};
  RBA.bindings.forEach(b => { if (b.provider === 'dingtalk') bindByUser[b.user_id] = b; });
  const tgtByKey = {};
  RBA.targets.forEach(t => { tgtByKey[t.target_key] = t; });
  // 绑定/群目标没取到时不假装「未绑定」——那是查过才知道的结论，取不到只能显未知
  const linkKnown = !RBA.bad.bindings && !RBA.bad.targets;
  const rows = RBA.outbox.map(r => {
    const pl = r.payload || {};
    const mUser = /^user:(\d+)$/.exec(String(r.target_key));
    const linked = mUser ? bindByUser[Number(mUser[1])] : tgtByKey[r.target_key];
    const ref = [esc(r.opp_code || '—'), r.review_id ? '评审 #' + r.review_id : '', r.task_id ? '任务 #' + r.task_id : ''].filter(Boolean).join(' · ');
    return `<tr>
      <td>${esc(pl.title || r.event)}<br><span style="font-size:11px;color:var(--text-4)">${esc(r.event)}</span></td>
      <td>${ref}<div style="font-size:12px;margin-top:3px">${esc(pl.text || pl.project || '')}</div>
        ${pl.deadline_hint ? `<div style="font-size:11px;color:var(--text-4)">${esc(pl.deadline_hint)}</div>` : ''}
        ${pl.link ? `<div style="font-size:11px;color:var(--text-4);word-break:break-all">${esc(pl.link)}</div>` : ''}</td>
      <td>${esc(r.target_key)}<br>${linkKnown ? rbaPill(RBA_LINK_STATUS, (linked || {}).status || 'unbound') : pill('未知', 'p-gray')}</td>
      <td>${rbaPill(RBA_OUTBOX_STATUS, r.status)}</td>
      <td style="font-size:12px">${esc(String(r.created_at || '').slice(0, 19).replace('T', ' '))}</td>
      <td>${esc(r.attempts)}</td>
      <td style="font-size:12px;word-break:break-all">${esc(r.last_error || '—')}</td>
      <td>${r.status === 'preview' || r.status === 'ready' ? `<button class="btn sm" onclick="robotOutboxCancel(${r.id})">取消</button>` : '—'}</td></tr>`;
  }).join('');
  const th = t => `<th style="position:sticky;top:0;z-index:1">${t}</th>`;
  return `<div class="std-box" style="margin-top:12px">生成待发送草稿（本地预演）：${RBA.backlog == null ? '待投递积压读取失败' : RBA.backlog + ' 条待投递'}，本页加载最近 ${RBA.outbox.length} 条。正文与链接按转义文本显示；「取消」只把状态改成已取消。本轮没有外部投递能力。</div>
    ${rows ? `<div style="max-height:420px;overflow:auto"><table><thead><tr>${['事件', '商机 / 评审', '目标', '状态', '创建时间', '尝试次数', '最后错误', '操作'].map(th).join('')}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">外发箱为空</div>'}`;
}
async function robotBindingSave(userId) {
  try {
    // 取值也在 try 内: 面板刚被重渲染过时格子的引用可能已失效, 失效要走 toast 而不是抛未捕获 rejection
    const ext = $('#rbbExt_' + userId).value.trim();
    const phone = $('#rbbPhone_' + userId).value.trim();
    // 空外部身份一律按 unbound 提交: 「已绑定」不许靠一个没填的格子亮起来(与 server 对群目标的强制同口径)
    const status = ext ? $('#rbbStatus_' + userId).value : 'unbound';
    await api('/api/admin/robot/bindings/' + userId, 'PUT', { provider: 'dingtalk', external_user_id: ext, phone: phone, status: status });
    toast('已保存外部身份');
    RBA.bindings = (await api('/api/admin/robot/bindings')).bindings || [];
    const box = $('#robotBusinessPane');
    if (box && RBA.tab === 'bindings') box.innerHTML = rbaBindingsPane();
  } catch (e) { toast(e.message, 1); }
}
async function robotTargetSave(i) {
  try {
    const key = RBA.targetKeys[i];
    const ref = $('#rbtRef_' + i).value.trim();
    const status = ref ? $('#rbtStatus_' + i).value : 'unbound';
    // target_type 沿用库里既有值(并集里可能有非 group 的历史行), 新行才默认 group——保存不能把别人的类型悄悄改掉
    const cur = RBA.targets.filter(t => t.target_key === key)[0] || {};
    await api('/api/admin/robot/targets/' + encodeURIComponent(key), 'PUT', { provider: 'dingtalk', target_type: cur.target_type || 'group', external_ref: ref, status: status });
    toast('已保存 ' + key);
    RBA.targets = (await api('/api/admin/robot/targets')).targets || [];
    const box = $('#robotBusinessPane');
    if (box && RBA.tab === 'targets') box.innerHTML = rbaTargetsPane();
  } catch (e) { toast(e.message, 1); }
}
async function robotOutboxCancel(id) {
  try {
    await api('/api/admin/robot/outbox/' + id + '/cancel', 'POST', {});
    toast('已取消，该行不再发送');
    const d = await api('/api/admin/robot/outbox?limit=100');
    RBA.outbox = d.rows || []; RBA.backlog = d.backlog;
    const box = $('#robotBusinessPane');
    if (box && RBA.tab === 'outbox') box.innerHTML = rbaOutboxPane();
  } catch (e) { toast(e.message, 1); }
}

// ---- Admin 解析器实验室(上传实测+原表对账+映射调优, #/parser-lab) ----
async function renderParserLab() {
  const page = $('#page');
  if (ME.role !== 'admin' && ME.role !== '销售支持组') { toast('仅 admin/支持组可访问', 1); return location.hash = '#/'; }
  showLoading(page);
  window._lab = window._lab || {};
  // 并行拉: 内置默认映射 + 已保存调优
  const [def, ov] = await Promise.all([api('/api/admin/parser-defaults'), api('/api/admin/parser-map')]);
  // 竞态守卫: await 期间路由切走则弃写
  if (!(location.hash || '').startsWith('#/parser-lab')) return;
  window._lab.def = def.defaults || {};
  window._lab.ov = ov.overrides || {};
  window._lab.dirty = false;
  const lab = window._lab;
  page.innerHTML = `
  <div class="card"><h3>解析器实验室 <span class="pill p-purple">admin</span> <span style="font-size:12px;color:var(--text-4);font-weight:400">上传 Excel 实测解析 + 原表逐字段对账 + 关键词调优闭环</span></h3>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
      <input type="file" id="labFile" accept=".xlsx" style="font-size:12.5px">
      <select id="labType" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:7px 10px;font-size:13px;background:var(--control-bg);color:var(--text-1)">
        <option value="review">评审表(信息收集)</option><option value="budget">预算表(附1)</option>
      </select>
      <input id="labSheet" placeholder="sheet 关键词(如: 投标决策, 可空)" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:7px 10px;font-size:13px;background:var(--control-bg);color:var(--text-1);width:200px">
      <label style="font-size:12.5px;display:flex;gap:4px;align-items:center"><input type="checkbox" id="labOv" ${lab.useOverride ? 'checked' : ''}>应用调优映射</label>
      <button class="btn pri sm" onclick="labRun()">解析并对照</button>
      <span style="font-size:12px;color:var(--text-4)">不落库——只解析与对账, 不创建任何单据</span>
    </div>
    <div id="labOut" style="margin-top:10px">${lab.last ? labRenderResult(lab.last) : '<div class="empty">上传评审表/预算表 Excel 后点「解析并对照」</div>'}</div>
  </div>
  <div class="card"><h3>关键词调优 <span class="pill ${lab.dirty ? 'p-yellow' : 'p-gray'}" id="labDirty">${lab.dirty ? '未保存' : '已同步'}</span>
    <span style="font-size:12px;color:var(--text-4);font-weight:400">点击关键词删除 · 输入回车添加 · 未匹配标签可一键关联字段</span></h3>
    <div id="labTune">${labRenderTune()}</div>
    <div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn pri sm" onclick="labSaveMap2()" ${lab.dirty ? '' : 'disabled'}>保存调优</button>
      <button class="btn sm" onclick="labRevert()">放弃未保存修改</button>
      <button class="btn sm" onclick="labClearMap()" style="color:#e06c75">全部恢复内置</button>
      <span id="labMapMsg" style="font-size:12px;color:var(--text-3)"></span>
    </div>
  </div>`;
  const oc = $('#labOv'); if (oc) oc.onchange = () => { window._lab.useOverride = oc.checked; };
}
// 调优表格: 三段(当前类型优先展示) × 字段行 × 关键词 chips
function labRenderTune() {
  const lab = window._lab;
  const type = (lab.last && lab.last.meta) ? 'BUDGET' : 'REVIEW';
  const def = lab.def || {};
  const ov = lab.ov || {};
  const order = ['REVIEW', 'BUDGET', 'FALLBACK'];
  const sections = order.filter(sec => def[sec] && Object.keys(def[sec]).length);
  return sections.map(sec => {
    const fields = def[sec] || {};
    const secOv = ov[sec] || {};
    const keys = Object.keys(fields).concat(Object.keys(secOv).filter(k => !fields[k]));
    return `<div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;color:var(--text-1)">${({ REVIEW: '评审字段映射', BUDGET: '预算字段映射', FALLBACK: '老模板兑底映射' })[sec] || sec} <span style="font-weight:400;font-size:11px;color:var(--text-4)">(${keys.length} 字段)</span></div>
      <div class="card-table-wrap"><table>
        <tr><th style="width:170px">字段</th><th>关键词(命中任一即采集该字段)</th><th style="width:90px">状态</th></tr>
        ${keys.map(k => {
          const kws = secOv[k] !== undefined ? secOv[k] : (fields[k] || []);
          const tuned = secOv[k] !== undefined;
          const defKws = fields[k] || [];
          return `<tr>
            <td style="font-family:monospace;font-size:12px">${esc(k)}</td>
            <td>
              <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
                ${kws.map((kw, i) => `<span class="pill ${tuned ? 'p-purple' : 'p-gray'}" style="cursor:pointer" title="点击删除该关键词" onclick="labDelKw('${sec}','${esc(k)}',${i})">${esc(kw)} ×</span>`).join('')}
                <input placeholder="+ 关键词回车添加" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:4px 8px;font-size:12px;background:var(--control-bg);color:var(--text-1);width:130px" onkeydown="if(event.key==='Enter'&&this.value.trim()){labAddKw('${sec}','${esc(k)}',this.value.trim());this.value=''}">
              </div>
            </td>
            <td>${tuned ? '<span class="pill p-purple">已调优</span><div style="font-size:11px;color:var(--text-4);margin-top:2px;cursor:pointer" onclick="labResetField(\'' + '${sec}' + '\',\'' + '${esc(k)}' + '\')">恢复默认</div>' : '<span class="pill p-gray">内置</span>'}</td>
          </tr>`;
        }).join('')}
      </table></div>
    </div>`;
  }).join('');
}
function labMarkDirty() { window._lab.dirty = true; const d = $('#labDirty'); if (d) { d.textContent = '未保存'; d.className = 'pill p-yellow'; } const sv = document.querySelector('button[onclick^="labSaveMap2"]'); if (sv) sv.disabled = false; }
function labAddKw(sec, k, kw) {
  const lab = window._lab;
  const cur = (lab.ov[sec] || {})[k] !== undefined ? lab.ov[sec][k] : ((lab.def[sec] || {})[k] || []);
  if (cur.includes(kw)) return toast('关键词已存在', 1);
  lab.ov[sec] = lab.ov[sec] || {};
  lab.ov[sec][k] = cur.concat([kw]);
  labMarkDirty();
  $('#labTune').innerHTML = labRenderTune();
}
function labDelKw(sec, k, i) {
  const lab = window._lab;
  const cur = (lab.ov[sec] || {})[k] !== undefined ? lab.ov[sec][k].slice() : ((lab.def[sec] || {})[k] || []).slice();
  if (cur.length <= 1) return toast('至少保留一个关键词(可改词)', 1);
  cur.splice(i, 1);
  lab.ov[sec] = lab.ov[sec] || {};
  lab.ov[sec][k] = cur;
  labMarkDirty();
  $('#labTune').innerHTML = labRenderTune();
}
function labResetField(sec, k) {
  const lab = window._lab;
  if (lab.ov[sec]) { delete lab.ov[sec][k]; if (!Object.keys(lab.ov[sec]).length) delete lab.ov[sec]; }
  labMarkDirty();
  $('#labTune').innerHTML = labRenderTune();
}
async function labSaveMap2() {
  const lab = window._lab;
  try {
    await api('/api/admin/parser-map', 'POST', { overrides: lab.ov });
    lab.dirty = false;
    const d = $('#labDirty'); if (d) { d.textContent = '已同步'; d.className = 'pill p-gray'; }
    const sv = document.querySelector('button[onclick^="labSaveMap2"]'); if (sv) sv.disabled = true;
    labMapMsg('已保存——勾选「应用调优映射」后点「解析并对照」验证');
    if (lab.last) { const oc = $('#labOv'); if (oc) { oc.checked = true; lab.useOverride = true; } }
  } catch (e) { labMapMsg(e.message, 1); }
}
function labRevert() {
  api('/api/admin/parser-map').then(r => { window._lab.ov = r.overrides || {}; window._lab.dirty = false; renderParserLab(); }).catch(e => toast(e.message, 1));
}
async function labRun() {
  const f = $('#labFile').files[0];
  if (!f) return toast('请先选择 Excel 文件', 1);
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  const out = $('#labOut');
  out.innerHTML = '<div class="empty">解析中…(python/openpyxl)</div>';
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const d = await api('/api/admin/parser-lab', 'POST', { filename: f.name, type: $('#labType').value, sheet: $('#labSheet').value.trim(), use_override: $('#labOv').checked, data: btoa(bin) });
    window._lab.last = d;
    out.innerHTML = labRenderResult(d);
  } catch (e) { out.innerHTML = `<div class="empty" style="color:#e06c75">${esc(e.message)}</div>`; }
}
function labRenderResult(d) {
  const audit = d.audit || [];
  const sources = d.sources || {};
  const grid = d.grid || [];
  window._lab.audit = audit;
  window._lab.sources = sources;
  const known = audit.filter(x => x.key);
  const bad = known.filter(x => !x.ok);
  const unk = audit.filter(x => !x.key);
  // 静态高亮: 对账行标签格=蓝框, 命中字段取值格=绿底
  const labSet = {}, valSet = {};
  audit.forEach(x => { if (x.pos) labSet[x.pos[0] + ',' + x.pos[1]] = x.label; });
  for (const [k, s] of Object.entries(sources)) {
    if (k in (d.fields || {}) && s && s.val_pos) valSet[s.val_pos[0] + ',' + s.val_pos[1]] = k;
  }
  return `
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
    <span class="pill ${bad.length ? 'p-yellow' : 'p-green'}">对账 ${known.length - bad.length}/${known.length} 一致</span>
    <span class="pill p-gray">解析字段 ${Object.keys(d.fields || {}).length}</span>
    <span class="pill ${unk.length ? 'p-yellow' : 'p-gray'}">未匹配标签 ${unk.length}</span>
    ${d.use_override ? '<span class="pill p-purple">调优映射已应用</span>' : ''}
    <span style="font-size:12px;color:var(--text-4)">sheet: ${esc((d.meta || {}).sheet || '')} · 点击左侧行, 右侧原表对应格子高亮定位</span>
  </div>
  <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:stretch">
    <div class="imp-rv-panel imp-rv-left" style="flex:1.15;min-width:420px">
      <div class="imp-rv-ph">解析结果 · 对账表(${known.length - bad.length}/${known.length} 一致)</div>
      <div class="imp-rv-pb" style="max-height:540px;overflow:auto">
        <table id="impRvL">
          <tr><th>原表标签</th><th>命中字段</th><th>位置</th><th>原表值</th><th>解析值</th><th>对账</th><th style="width:150px">一键调优</th></tr>
          ${audit.map((x, i) => {
            const canTune = !x.key && x.label && String(x.label).trim().length >= 2 && String(x.label).length <= 20;
            const valPos = x.key && sources[x.key] && sources[x.key].val_pos;
            return `<tr${(x.pos || valPos) ? ` onclick="labRvFocus(${i})"` : ''}>
            <td>${esc(x.label || '')}</td>
            <td style="font-family:monospace;font-size:12px">${x.key ? esc(x.key) : '<span style="color:var(--text-4)">未匹配</span>'}</td>
            <td style="font-family:monospace;font-size:11px">${x.pos ? 'R' + x.pos[0] + 'C' + x.pos[1] : (valPos ? 'R' + valPos[0] + 'C' + valPos[1] : '')}</td>
            <td style="max-width:200px">${esc(x.raw || '')}</td>
            <td style="max-width:200px">${x.key ? esc(x.parsed == null ? '未采集' : String(x.parsed)) : '<span style="color:var(--text-4)">—</span>'}</td>
            <td>${x.key ? (x.ok ? '<span style="color:#3fc09c">✓</span>' : '<span style="color:#e06c75">✗</span>') : ''}</td>
            <td>${canTune ? `<select id="tune-${esc(x.label).replace(/[^\w]/g, '_')}" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:4px 6px;font-size:12px;background:var(--control-bg);color:var(--text-1)">
              <option value="">选字段…</option>
              ${labFieldOptions().map(o => `<option value="${o.sec}|${o.k}">${o.label}</option>`).join('')}
            </select>
            <button class="btn sm" style="padding:3px 8px" onclick="labTuneFromRow('${esc(x.label)}', this.previousElementSibling.value)">关联</button>` : ''}</td>
          </tr>`;
          }).join('')}
        </table>
      </div>
    </div>
    <div class="imp-rv-panel imp-rv-right" style="flex:1;min-width:360px">
      <div class="imp-rv-ph">源头证据 · Excel 原表 <span style="font-weight:400;font-size:11px;color:var(--text-4)">(前 ${grid.length} 行 · 蓝框=标签格 · 绿底=取值格)</span></div>
      <div class="imp-rv-pb" style="max-height:540px;overflow:auto">${impRvGridHtml(grid, labSet, valSet)}</div>
    </div>
  </div>
  <div style="font-size:12px;color:var(--text-4);margin-top:6px">未匹配标签可选字段后点「关联」——自动把该标签加为该字段关键词(需保存后生效)</div>`;
}
// 实验室对账行点击 → 原表标签格+取值格聚焦
function labRvFocus(i) {
  const lab = window._lab || {};
  const row = (lab.audit || [])[i]; if (!row) return;
  document.querySelectorAll('#impRvL tr.imp-rv-sel').forEach(t => t.classList.remove('imp-rv-sel'));
  const tr = document.querySelectorAll('#impRvL tr')[i + 1];
  if (tr) tr.classList.add('imp-rv-sel');
  const sp = row.key && (lab.sources || {})[row.key];
  const n = impRvPickCells([row.pos, sp ? sp.val_pos : null]);
  if (!n) toast('该行无原表坐标', 1);
}
// 一键调优: 未匹配标签 → 加为某字段关键词
function labFieldOptions() {
  const lab = window._lab;
  const def = lab.def || {};
  const out = [];
  for (const sec of ['REVIEW', 'BUDGET', 'FALLBACK']) {
    for (const k of Object.keys(def[sec] || {})) {
      out.push({ sec, k, label: (sec === 'REVIEW' ? '' : '[' + sec + '] ') + k });
    }
  }
  return out;
}
function labTuneFromRow(label, val) {
  if (!val) return toast('请先选择目标字段', 1);
  const [sec, k] = val.split('|');
  labAddKw(sec, k, String(label).trim());
  labMapMsg('已把「' + label + '」加为 ' + k + ' 关键词(未保存)——点「保存调优」后重新解析验证');
}
async function labClearMap() {
  if (!confirm('全部恢复内置映射? 未保存修改将丢失')) return;
  try {
    await api('/api/admin/parser-map', 'POST', { overrides: {} });
    window._lab.ov = {};
    renderParserLab();
  } catch (e) { labMapMsg(e.message, 1); }
}
function labMapMsg(msg, err) { const el = $('#labMapMsg'); if (el) { el.textContent = msg; el.style.color = err ? '#e06c75' : 'var(--text-3)'; } }

// ---- 归档库(顶部 BI 分析区 + 明细列表, docs/归档库BI产品方案.md) ----
async function renderArchive() {
  const page = $('#page');
  showLoading(page);
  const [d, st] = await Promise.all([apiCached('/api/reviews?scope=archived'), apiCached('/api/reviews/archive-stats')]);
  const s = st;
  // 异步渲染竞态守卫: 归档页 await 期间切走则弃写
  if (!(location.hash || '').startsWith('#/archive')) return;
  const pct = v => +(v / (s.kpi.total || 1) * 100).toFixed(1); // 留作后续视角扩展
  const distSegs = (o, total) => {
    const entries = Object.entries(o);
    return `<div class="dist-bar">${entries.map(([k, v]) => `<i class="seg-${segCls(k)}" style="width:${total ? (v / total * 100).toFixed(1) : 0}%"></i>`).join('')}</div>
    <div class="dist-legend">${entries.map(([k, v]) => `<span class="lg lg-${segCls(k)}">${segLabel(k)} <b>${v}</b></span>`).join('')}<span style="margin-left:auto">共 <b>${total}</b></span></div>`;
  };
  const segCls = k => ({ green: 'green', yellow: 'yellow', red: 'red', none: 'purple', presale: 'blue', bid: 'gray', change: 'green', xo: 'red', dept: 'yellow' }[k] || 'gray');
  const segLabel = k => ({ green: '绿灯', yellow: '黄灯', red: '红灯', none: '历史未评', presale: '售前立项', bid: '投标决策', change: '关键事项', xo: 'XO 级', dept: '部门级' }[k] || k);
  const rankList = (items, fmt) => items.map((it, i) => `<div class="rank-bar" title="${esc(fmt(it).replace(/<[^>]+>/g, ''))}">
    <span class="rb-idx">${i + 1}</span><span class="rb-label">${esc(it.name)}</span>
    <span class="rb-track"><i style="width:${it.pct}"></i></span><span class="rb-num">${it.numText}</span></div>`).join('');
  const maxRisk = (s.risks[0] || {}).count || 1;
  const maxDept = Math.max(...s.depts.map(x => x.yellow + x.red), 1);
  const maxAmt = Math.max(...s.amounts.map(x => x.count), 1);
  const maxMon = Math.max(...s.monthly.map(x => x.c), 1);
  page.innerHTML = `
  <div class="metric-grid">
    <div class="metric-tile"><span class="m-label">归档总数</span><span class="m-value">${s.kpi.total}</span><span class="m-foot">在线 ${s.kpi.online} + 历史补录 ${s.kpi.historyTotal}</span></div>
    <div class="metric-tile"><span class="m-label">在线绿灯率</span><span class="m-value tone-green">${s.kpi.greenRate}%</span><span class="m-foot">在线单 ${s.kpi.online} 中免上会占比</span></div>
    ${s.kpi.historyTotal ? `<div class="metric-tile"><span class="m-label">历史结论通过率</span><span class="m-value tone-blue">${s.kpi.historyPassRate}%</span><span class="m-foot">历史补录 ${s.kpi.historyTotal} 单(无灯态,按人工结论)</span></div>` : ''}
    <div class="metric-tile"><span class="m-label">平均轮次</span><span class="m-value">${s.kpi.avgRound}</span><span class="m-foot">多轮单为重提/红灯打回</span></div>
    <div class="metric-tile"><span class="m-label">结论录入率</span><span class="m-value tone-yellow">${s.kpi.decisionRate}%</span><span class="m-foot">会后结论已录 ${Math.round(s.kpi.decisionRate * s.kpi.total / 100)}/${s.kpi.total}</span></div>
  </div>
  ${(ME.role === '销售支持组' || ME.role === 'admin') ? `
  <div class="card" style="padding:12px 16px;margin-bottom:14px"><h3 style="margin:0 0 8px">补录历史已归档评审（直接入库，不走流程）</h3>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <input type="file" id="histFile" accept=".xlsx" style="font-size:12.5px">
      <select id="histType" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:7px 10px;font-size:13px;background:var(--control-bg);color:var(--text-1)"><option value="bid">投标决策</option><option value="presale">售前立项</option><option value="change">关键事项</option></select>
      <input type="date" id="histDate" title="历史评审日期(缺省取文件名年份)" style="border:1px solid var(--border-default);border-radius:var(--r-m);padding:6px 10px;font-size:13px;background:var(--control-bg);color:var(--text-1)">
      <button class="btn pri sm" onclick="importHistoryExcel()">导入历史归档</button>
      <span style="font-size:12px;color:var(--text-4)">免流程直入归档;无灯态不补判,业务时间取评审日期;仅归档库可见</span>
    </div></div>` : ''}
  <div class="bi-grid">
    <div class="card"><h3>灯色分布</h3>${distSegs(s.light, s.kpi.total)}</div>
    <div class="card"><h3>评审路径分布</h3>${distSegs(s.routes, s.routes.xo + s.routes.dept + s.routes.green)}<div style="font-size:11.5px;color:var(--text-4);margin-top:4px">红灯打回单不入三段(另行打回重提)</div></div>
    <div class="card"><h3>评审类型占比</h3>${rankList(['bid', 'presale', 'change'].map(k => ({ name: segLabel(k), count: s.types[k] || 0 })).map(x => ({ ...x, pct: (x.count / (s.kpi.total || 1) * 100).toFixed(1) + '%', numText: x.count + ' 单' })), it => `${it.name}: ${it.count}`)}</div>
    <div class="card"><h3>金额分布(万元)</h3>
      <div class="bar-cols">${s.amounts.map(a => `<div class="bar-col" title="${esc(a.range)}: ${a.count} 单"><i style="height:${(a.count / maxAmt * 100).toFixed(0)}%"></i><span class="bc-label">${esc(a.range)}</span><span class="bc-num">${a.count}</span></div>`).join('')}</div>
      <div style="font-size:12.5px;color:var(--text-2);margin-top:8px">总额 <b>${s.totalAmountWan.toLocaleString('zh-CN')}</b> 万(含金额字段 ${s.amountValid}/${s.kpi.total} 单)</div>
    </div>
    <div class="card"><h3>年度分布</h3>
      ${s.years && s.years.length ? `<div class="bar-cols">${s.years.map(y => `<div class="bar-col" title="${y.y}年: ${y.c} 单"><i style="height:${(y.c / Math.max(...s.years.map(x => x.c)) * 100).toFixed(0)}%"></i><span class="bc-label">${y.y}</span><span class="bc-num">${y.c}</span></div>`).join('')}</div>` : '<div class="empty">暂无数据</div>'}
    </div>
    <div class="card"><h3>月度归档趋势</h3>
      <div class="bar-cols">${s.monthly.map(m => `<div class="bar-col" title="${m.m}: ${m.c} 单"><i style="height:${(m.c / maxMon * 100).toFixed(0)}%"></i><span class="bc-label">${m.m.slice(2)}</span><span class="bc-num">${m.c}</span></div>`).join('')}</div>
    </div>
    <div class="card"><h3>Top 10 风险项(黄+红)</h3>
      ${s.risks.length ? rankList(s.risks.map(r => ({ ...r, pct: (r.count / maxRisk * 100).toFixed(0) + '%', numText: r.count + ' 次' })), it => `${it.name}: ${it.count} 次`) : '<div class="empty">暂无风险项数据</div>'}
    </div>
    <div class="card"><h3>部门黄/红命中率(全轮次)</h3>
      ${rankList(s.depts.map(x => ({ name: x.dept, count: x.yellow + x.red, pct: (x.count / maxDept * 100).toFixed(0) + '%', numText: `${x.yellow}黄${x.red ? '/' + x.red + '红' : ''} / ${x.total}任务` })), it => `${it.name}: 黄${it.count}`)}
    </div>
  </div>
  <div class="bi-note">周期维(建单→归档天数)待真实流转出值后随看板启用, 当前不展示不造数据。历史补录单只在归档库展现(我的评审/全员列表不含)。商机代码贯穿: 筛选/搜索支持代码/项目名。</div>
  <div class="card"><h3>归档明细</h3>
    ${arcFilterBar('arcF', d.reviews, true)}
  ${(window._arcF ? d.reviews.filter(r => fltHit(r, window._arcF)) : d.reviews).length === 0 ? '<div class="empty">没有符合条件的归档记录</div>' : `<div class="card-table-wrap"><table>
    <tr><th>项目</th><th>商机代码</th><th>类型</th><th>申请人</th><th>灯态</th><th>评审路径</th><th>归档时间</th><th>时代</th></tr>
    ${(window._arcF ? d.reviews.filter(r => fltHit(r, window._arcF)) : d.reviews).map(r => `<tr>
      <td><a href="#/review/${r.id}">${esc(r.title)}</a></td><td style="font-family:monospace;font-size:12px">${esc(r.opp_code || '—')}</td><td>${TYPE_NAMES[r.type]}</td>
      <td>${esc(r.applicant_name)}</td><td>${lightPill(r.light)}</td>
      <td style="max-width:280px">${esc(r.route || '')}</td><td>${fmtT(r.archived_at)}</td>
      <td>${r.era === 'history' ? '<span class="pill p-purple">历史</span>' : ''}</td>
    </tr>`).join('')}</table></div>`}</div>`;
}
// 补录历史评审(docs/历史数据承接方案.md): mode=history 免门禁直入归档
async function importHistoryExcel() {
  const f = $('#histFile').files[0];
  if (!f) return toast('请先选择历史评审表 Excel 文件', 1);
  if (f.size > 10 * 1024 * 1024) return toast('文件不能超过 10MB', 1);
  if (!confirm('将直接补录为历史已归档评审，不走部门打灯流程，不补判灯色。确认导入？')) return;
  try {
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const d = await api('/api/reviews/import', 'POST', { filename: f.name, type: $('#histType').value, mode: 'history', review_date: $('#histDate').value || '', data: btoa(bin) });
    toast(`历史评审已导入归档(结论:${d.decision} · 评审日期 ${d.archived_at})`);
    renderArchive();
  } catch (e) { toast(e.message, 1); }
}

// ---- 启动 ----
(async () => {
  if (localStorage.token) {
    try {
      const user = (await api('/api/me')).user;
      await loadMeta(); ME = user;
    } catch (e) { localStorage.clear(); ME = null; }
  }
  render();
})();
window.addEventListener('hashchange', render);
