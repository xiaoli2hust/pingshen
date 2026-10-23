// V4.0-T4 必填注册表合一对账用例(RQ-01~10)
// 用法: node tests/test_required.js [--log=tests/red_required.txt]
// 红基线: 旧代码无 GET /api/meta/fields(404)、/submit 无必填门 -> RQ-01~04/06/08前半 FAIL; RQ-05/07/08后半本就 200 属预期 PASS
// D-31: 提交类用例一律用「无挂靠预算单」夹具(POST /api/budget 不带 opp_code), 使 /submit 的 G3 三步链天然跳过, 判别力全落在必填门上
const fs = require('fs');
const path = require('path');
const { BID_REQUIRED } = require('../agent.js'); // 只取对话追问清单作 RQ-05 的「该缺哪些键」依据, 不参与任何门禁判定
const B = 'http://127.0.0.1:8600';

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

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

// ---------- §2.1 FE FIELDS 文本解析口径: 只用 fs + 正则(大括号/方括号计数配对), 禁 JSON.parse、禁 require app.js ----------
function sliceBalanced(src, startIdx, open, close) {
  let depth = 0, q = null;
  for (let i = startIdx; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { i++; continue; } if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { const nl = src.indexOf('\n', i); i = (nl < 0 ? src.length : nl) - 1; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return src.slice(startIdx, i + 1); }
  }
  return null;
}
function parseFeFields(file) {
  const src = fs.readFileSync(file, 'utf8');
  const head = src.indexOf('const FIELDS');
  if (head < 0) return null;
  const block = sliceBalanced(src, src.indexOf('{', head), '{', '}');
  if (!block) return null;
  const out = {};
  for (const t of ['presale', 'bid', 'change']) {
    const m = new RegExp('\\b' + t + '\\s*:\\s*\\[').exec(block);
    if (!m) { out[t] = null; continue; }
    const arr = sliceBalanced(block, block.indexOf('[', m.index), '[', ']');
    if (!arr) { out[t] = null; continue; }
    const items = [];
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== '{') continue;
      const obj = sliceBalanced(arr, i, '{', '}');
      if (!obj) break;
      const mk = /\bk\s*:\s*'([^']*)'/.exec(obj);
      const ml = /\bl\s*:\s*'([^']*)'/.exec(obj);
      items.push({ k: mk ? mk[1] : '', l: ml ? ml[1] : '', req: /\breq\s*:\s*1\b/.test(obj) });
      i += obj.length - 1;
    }
    out[t] = items;
  }
  return out;
}

// D-31 夹具: 无挂靠预算单(与 tests/data_feasibility_check.js:57-60 同构) —— budgets.opp_code 为空 ⇒ G3 的 if (codeChain) 跳过
async function lockBudgetNoOpp(token, name) {
  const bg = (await api(token, '/api/budget', 'POST', { project_name: name })).id;
  await api(token, `/api/budget/${bg}`, 'PUT', { fields: { contract: 1000000, sub_cost: 100000, dev_dept: '交付处', dev_pd: 100, del_travel: 5000 } });
  await api(token, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'RQ 底稿行(附3)', pm_pd: 1, own_pd: 1, prod_pd: 2 }] });
  await api(token, `/api/budget/${bg}/lock`, 'POST');
  const oppCode = String((((await api(token, `/api/budget/${bg}`)).budget) || {}).opp_code ?? '');
  return { id: bg, oppCode };
}
const attach = (token, rid, fn) => api(token, `/api/reviews/${rid}/attachments`, 'POST',
  { field: '项目预算表', filename: fn, data: Buffer.from('rq').toString('base64') });

const BID_FULL = { // FIELDS.bid 的 req 集 14 键(§5.2 A 表), 不含任何非 req 键
  customer: 'RQ 对账客户', biz_line: 'G1', contract_amount: '100', gross_margin: '20',
  ops_years: '2', sign_path: 'A公司→丰图科技（深圳）有限公司', survey: '否', secret: '否',
  settle_method: '银行转账', guarantee: '否', non_compete: '否', payment_terms: '预付 30%，终验后 70%',
  summary: 'RQ 提交必填门用例', data_review: '否'
};
const PRESALE_FULL = { // FIELDS.presale 的 req 集 9 键
  customer: 'RQ 售前客户', biz_line: 'G1', contract_amount: '80', sign_date: '2026-12-31',
  survey: '否', sub_early_flag: '否', presale_invest: '1', presale_period: '2', summary: 'RQ presale 用例'
};
const CHANGE_FULL = { // FIELDS.change 的 req 集 4 键
  biz_line: 'G1', proj_stage: '实施中', change_type: '项目成本变动', summary: 'RQ change 用例'
};

(async () => {
  const admin = await login('zhichizu');
  const sales = await login('sales1');
  const FE = parseFeFields(path.join(__dirname, '..', 'public', 'app.js'));
  const feReq = t => (FE && FE[t] ? FE[t].filter(f => f.req) : []);
  const beReq = t => ((metaCache[t] || []).filter(f => f.req));

  // ---------- RQ-01 meta 端点可用 ----------
  const metaRes = await raw(admin, '/api/meta/fields', 'GET');
  check('RQ-01', 'GET /api/meta/fields 200', metaRes.status === 200, 'status=' + metaRes.status + ' ' + (metaRes.data.error || ''));
  const metaCache = metaRes.status === 200 ? metaRes.data : {};
  const FIVE = ['presale', 'bid', 'change', 'opp', 'budget'];
  check('RQ-01', '含 presale/bid/change/opp/budget 五键且每项为数组',
    FIVE.every(k => Array.isArray(metaCache[k])),
    FIVE.map(k => k + '=' + (Array.isArray(metaCache[k]) ? metaCache[k].length + '项' : typeof metaCache[k])).join(', '));

  // ---------- RQ-02 评审三集 ≡ FE FIELDS 的 req 集(核心对账, 有序) ----------
  check('RQ-02', 'FE FIELDS 文本解析成功(不 require 浏览器文件)', !!FE && !!FE.bid && FE.bid.length > 0,
    FE ? 'presale ' + FE.presale.length + ' 项 / bid ' + FE.bid.length + ' 项 / change ' + FE.change.length + ' 项' : '解析失败');
  for (const t of ['presale', 'bid', 'change']) {
    const f = feReq(t).map(x => x.k), b = beReq(t).map(x => x.k);
    check('RQ-02', t + ' req 集 FE≡BE(含顺序)', f.length > 0 && JSON.stringify(f) === JSON.stringify(b),
      'FE(' + f.length + ')=' + f.join(',') + ' | BE(' + b.length + ')=' + b.join(','));
  }

  // ---------- RQ-03 标签同源 ----------
  for (const t of ['presale', 'bid', 'change']) {
    const f = feReq(t).map(x => x.l), b = beReq(t).map(x => x.l);
    check('RQ-03', t + ' req 项中文标签逐项全等', f.length > 0 && JSON.stringify(f) === JSON.stringify(b),
      'FE=' + f.join('/') + ' | BE=' + b.join('/'));
  }

  // ---------- RQ-04 opp 要素集同源(meta 侧) ----------
  const oppKeys = metaCache.opp || [];
  check('RQ-04', 'meta.opp 为键名数组(与 OPP_REQUIRED 同序)', oppKeys.length > 0 && oppKeys.every(k => typeof k === 'string'),
    JSON.stringify(oppKeys));
  {
    const r = await raw(sales, '/api/opp', 'POST', { opp_code: 'RQ-META-PROBE' }); // 只给合法形态码, 七要素全缺
    const m = r.data.missing || [];
    check('RQ-04', 'POST /api/opp 全缺 400 且 missing ≡ meta.opp(含顺序)',
      r.status === 400 && oppKeys.length > 0 && JSON.stringify(m) === JSON.stringify(oppKeys),
      'status=' + r.status + ' missing=' + JSON.stringify(m) + ' meta.opp=' + JSON.stringify(oppKeys));
  }

  const bg1 = await lockBudgetNoOpp(sales, '[T]RQ-无挂靠预算-1');
  check('RQ-05', '夹具预算单无挂靠(G3 天然跳过, 判别力落在必填门)', bg1.oppCode === '',
    'GET /api/budget/' + bg1.id + ' 实测 opp_code=' + JSON.stringify(bg1.oppCode));

  // ---------- RQ-05 D-1 边界: BID_REQUIRED 独有键不参与提交门 ----------
  {
    const reqSet = new Set(feReq('bid').map(x => x.k));
    const excl = BID_REQUIRED.filter(k => !reqSet.has(k)); // 对话追问集独有键(如 jiadao/province)
    const overlap = BID_REQUIRED.filter(k => reqSet.has(k));
    check('RQ-05', '对话追问独有键求集非空且全部不在提交 req 集', excl.length > 0 && excl.every(k => !reqSet.has(k)),
      'BID_REQUIRED ' + BID_REQUIRED.length + ' 键: 交叠 ' + overlap.length + '(' + overlap.join(',') + ') / 独有 ' + excl.length + '(' + excl.join(',') + ')');
    const payload = { ...BID_FULL };
    excl.forEach(k => delete payload[k]);
    check('RQ-05', '载荷含 req 集全 14 键且不含任何对话追问独有键',
      [...reqSet].every(k => String(payload[k] ?? '').trim() !== '') && excl.every(k => payload[k] === undefined),
      'req 键数=' + [...reqSet].length);
    const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]RQ-05-req齐对话键缺', form: payload, submit: false, budget_id: bg1.id })).id;
    const r = await raw(sales, `/api/reviews/${rid}/submit`, 'POST');
    check('RQ-05', 'req 集全齐但缺 BID_REQUIRED 独有键 → 提交 200(D-1: 提交门只认注册表 req 集)', r.status === 200,
      'status=' + r.status + ' ' + (r.data.error || ''));
  }

  // ---------- RQ-06 提交必填门生效 ----------
  {
    const payload = { ...BID_FULL }; delete payload.sign_path;
    const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]RQ-06-缺签约路径', form: payload, submit: false, budget_id: bg1.id })).id;
    const r = await raw(sales, `/api/reviews/${rid}/submit`, 'POST');
    const m = r.data.missing || [];
    check('RQ-06', '缺 req 键 sign_path 提交被拦 400', r.status === 400, 'status=' + r.status + ' ' + (r.data.error || ''));
    check('RQ-06', 'error 以「必填缺失」开头且 missing 含 sign_path(防测到 G3 的 400)',
      /^必填缺失/.test(String(r.data.error || '')) && m.includes('sign_path'),
      'error=' + JSON.stringify(r.data.error || '') + ' missing=' + JSON.stringify(m));
    check('RQ-06', 'error 含中文标签「签约路径」', String(r.data.error || '').includes('签约路径'), 'error=' + JSON.stringify(r.data.error || ''));
  }

  // ---------- RQ-07 草稿不受门 ----------
  {
    const payload = { ...BID_FULL }; delete payload.sign_path;
    const r = await raw(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]RQ-07-残缺草稿', form: payload, submit: false, budget_id: bg1.id });
    check('RQ-07', '同残缺载荷 submit:false 建草稿 200(门只作用于提交动作)', r.status === 200 && !!r.data.id,
      'status=' + r.status + ' id=' + (r.data.id || '') + ' ' + (r.data.error || ''));
  }

  // ---------- RQ-08 presale/change 各自独立集 ----------
  {
    const payload = { ...PRESALE_FULL }; delete payload.presale_invest;
    const bg = await lockBudgetNoOpp(sales, '[T]RQ-无挂靠预算-2');
    const rid = (await api(sales, '/api/reviews', 'POST', { type: 'presale', title: '[T]RQ-08-缺售前投入', form: payload, submit: false, budget_id: bg.id })).id;
    const r = await raw(sales, `/api/reviews/${rid}/submit`, 'POST');
    const m = r.data.missing || [];
    check('RQ-08', 'presale 缺 presale_invest 提交 400(取 presale 集)',
      r.status === 400 && /^必填缺失/.test(String(r.data.error || '')) && m.includes('presale_invest'),
      'status=' + r.status + ' error=' + JSON.stringify(r.data.error || '') + ' missing=' + JSON.stringify(m));
    const rid2 = (await api(sales, '/api/reviews', 'POST', { type: 'change', title: '[T]RQ-08-变更单', form: { ...CHANGE_FULL }, submit: false })).id;
    await attach(sales, rid2, 'rq-change.xlsx');
    const r2 = await raw(sales, `/api/reviews/${rid2}/submit`, 'POST');
    check('RQ-08', 'change 只带 change req 集提交 200(按 review.type 取集, 不串台)', r2.status === 200,
      'status=' + r2.status + ' ' + (r2.data.error || '') + ' | change req 集=' + feReq('change').map(x => x.k).join(','));
  }

  // ---------- RQ-09 一行回退开关的作用域与门序(静态源级守护; 手工翻转两轮的实测输出见 task-4-report) ----------
  {
    const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const def = /const SUBMIT_REQUIRED_GATE\s*=\s*(true|false);/.exec(SRC);
    check('RQ-09', 'SUBMIT_REQUIRED_GATE 常量存在(一行回退点)', !!def, def ? '当前值=' + def[1] : '未找到');
    const gi = SRC.indexOf('if (SUBMIT_REQUIRED_GATE)');
    check('RQ-09', '必填门块在 /submit 处理器内', gi > 0 && SRC.lastIndexOf("sub === '/submit'", gi) > 0, 'gate 偏移=' + gi);
    if (gi > 0) {
      const block = sliceBalanced(SRC, SRC.indexOf('{', gi), '{', '}');
      const submitStart = SRC.lastIndexOf("sub === '/submit'", gi);
      const submitBody = sliceBalanced(SRC, SRC.indexOf('{', submitStart), '{', '}') || '';
      const iBudget = submitBody.indexOf('BUDGET_REQUIRED_TYPES.includes(review.type)');
      const iG3 = submitBody.indexOf('三步链未闭合');
      const iGate = block ? submitBody.indexOf(block) : -1;
      check('RQ-09', '块内含 reqKeys(review.type) 必填校验', !!block && /reqKeys\(review\.type\)/.test(block), block ? '块 ' + block.length + ' 字符' : '配对失败');
      check('RQ-09', 'D-31 门序: 预算必带门 → G3 三步链 → 必填门', iBudget >= 0 && iG3 >= 0 && iGate > iG3 && iGate > iBudget,
        'budget=' + iBudget + ' g3=' + iG3 + ' gate=' + iGate);
      check('RQ-09', '开关只关必填校验(块内不含预算必带门/G3/opp_delivery)', !!block && !/BUDGET_REQUIRED_TYPES|DELIVERY_REQUIRED_TYPES|opp_delivery/.test(block),
        block ? '块内命中禁用关键词=' + JSON.stringify(['BUDGET_REQUIRED_TYPES', 'DELIVERY_REQUIRED_TYPES', 'opp_delivery'].filter(x => block.includes(x))) : '配对失败');
      const postStart = SRC.indexOf("p === '/api/reviews' && req.method === 'POST'");
      const postBody = postStart > 0 ? sliceBalanced(SRC, SRC.indexOf('{', postStart), '{', '}') || '' : '';
      check('RQ-09', 'POST /api/reviews 未重复加门(§C: submit:true 已被现网硬拦)', postBody.length > 0 && !/SUBMIT_REQUIRED_GATE/.test(postBody),
        'POST 块 ' + postBody.length + ' 字符, 含开关=' + /SUBMIT_REQUIRED_GATE/.test(postBody));
    }
  }

  // ---------- RQ-10 零 npm 依赖铁律 ----------
  {
    const self = fs.readFileSync(__filename, 'utf8');
    const mods = [...self.matchAll(/require\((['"])([^'"]+)\1\)/g)].map(m => m[2]);
    const third = mods.filter(m => m !== 'fs' && m !== 'path' && !m.startsWith('.'));
    check('RQ-10', '解析仅用 fs + 正则(无第三方模块、不 require app.js)',
      third.length === 0 && !mods.some(m => m.includes('app.js')), 'require 集=' + JSON.stringify([...new Set(mods)]));
    check('RQ-10', 'meta 响应为可 JSON 解析的纯数据(无函数/无 DOM)',
      metaRes.status === 200 && JSON.parse(JSON.stringify(metaCache)).bid.length > 0,
      'bid 项数=' + ((metaCache.bid || []).length));
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
