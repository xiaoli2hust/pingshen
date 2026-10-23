// V4.0 T11 对话式建档(技能④) + 打灯矩阵聚合视图: OD-01~OD-10(服务运行中)
// 用法: node tests/test_opp_dialog.js [--log=tests/_t11_post_dialog.txt]
// 桩: 9831 应答桩(按 STUB.fields 返回 {"fields":…}) / 9832 断开桩(连接即毁);
//   config.json 的 LLM_BASE_URL 临时改写, try/finally 恢复原始字节(与 AV/A 系列同一手法)
// 要素口径源自真实原件 PL00008572(江西省自然资源测绘与监测院 / 天地图 POI 数据服务项目, 预计合同 240 万), 与 OP 套件同源
// 2026-10-21 SQL 夹具替换: OD-08/OD-09 原用 node:sqlite 直连 INSERT 任意 era 草稿 + UPDATE 改 era + DELETE 清理, 现改走带 token 的真实 HTTP:
//   OD-08 = C7 上 OD-07 的真实在线草稿 + 支持组 POST /api/reviews/import mode=history(openpyxl 两列「附1-预算表」); OD-09 = 两个 fresh code 配对对照;
//   新夹具不做 SQL 清理, 只靠父级守护恢复演示库与 uploads; 本文件唯一保留的直连 DB 是 OD-10 的 llm_calls 只读 SELECT 观测
//   披露: literal same-record era flip(同一行 history→online)无 HTTP 接口, 不保留, 由配对码对照替代
//   运行时打印 NOT EXECUTABLE OD-08-inflight / OD-09-flip(不可计为PASS), summary 行携带缺口数与文案
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const CFG_PATH = path.join(ROOT, 'config.json');
const DB_PATH = path.join(ROOT, 'data', 'review.db');

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
const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const guard = async (id, name, fn) => { try { await fn(); } catch (e) { check(id, name, false, 'EX:' + String(e.message).slice(0, 160)); } };

let cfgRaw = null;
const setCfg = kv => {
  if (cfgRaw === null) cfgRaw = fs.readFileSync(CFG_PATH, 'utf8');
  const cfg = JSON.parse(cfgRaw);
  delete cfg.LLM_PROFILES; // resolveLlm 中 profile/default 覆盖优先于顶层, 桩期间剥离保证打到桩端口; 原字节在 restoreCfg 还原
  Object.assign(cfg, kv);
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
};
const restoreCfg = () => { if (cfgRaw !== null) { fs.writeFileSync(CFG_PATH, cfgRaw, 'utf8'); cfgRaw = null; } };

// 服务端常量实测全集(按内容锚解析源码, 不抄数字)
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const constArr = name => {
  const m = SERVER_SRC.match(new RegExp('const ' + name + ' = (\\[[^\\]]*\\])'));
  return m ? JSON.parse(m[1].replace(/'/g, '"')) : null;
};
const OPP_FIELDS = constArr('OPP_FIELDS');
const OPP_REQUIRED = constArr('OPP_REQUIRED');

// FE 纯函数抽取: app.js 是浏览器脚本, 按「function 名(」起、首个行首 } 止截取后在沙箱求值
const APP_SRC = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const feFn = name => {
  const i = APP_SRC.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const j = APP_SRC.indexOf('\n}\n', i);
  if (j < 0) return null;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return vm.runInNewContext(APP_SRC.slice(i, j + 2) + ';' + name, { esc });
};

const STUB = { fields: {} };
// 短 collision-resistant run id: 36 进制毫秒尾 6 位 + 2 字节随机 hex(共 10 位), 重跑/并发不撞既有档案
const S = Date.now().toString(36).slice(-6) + crypto.randomBytes(2).toString('hex');
const CODE = n => 'PL-T11-' + S + '-' + n;
const FULL = { title: 'T11对话建档商机', customer: '江西省自然资源测绘与监测院', region: '华东', province: '江西',
  biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策/投标决策', sales: '王超', pm: '冯金华', survey: '否',
  summary: '天地图 POI 数据服务项目（OD 套件对话建档用例）' };
const chat = (t, body) => raw(t, '/api/agent/chat', 'POST', { skill: 'opp', ...body });

const llmCalls = () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_PATH);
  try {
    const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='llm_calls'").get();
    if (!has) return null;
    return db.prepare('SELECT * FROM llm_calls ORDER BY id DESC LIMIT 1').get() || null;
  } finally { db.close(); }
};
// ---------- 真实 HTTP 夹具(2026-10-21 替换直连 DB 造数): 产物 ID 逐个登记; 不做 SQL 清理, 只靠父级守护恢复演示库与 uploads ----------
const OWNED = { codes: [], reviews: [] };
// 无已授权 HTTP 产地的不可变 era/历史态: 原位打印 NOT EXECUTABLE 并进 summary 尾行, 不可计为 PASS
const GAPS = [];
const gap = (id, short, detail) => {
  const line = 'NOT EXECUTABLE ' + id + ' ' + short + (detail ? ' | ' + detail : '');
  console.log(line); LOG.push(line); GAPS.push(id + ' ' + short);
};
// H: 支持组历史补录。openpyxl 生成两列老模板(仅「附1-预算表」sheet), review_date 显式给定
let hfxSeq = 0;
const HFX_PY = 'import openpyxl, json, sys\nrows = json.loads(sys.argv[1])\nwb = openpyxl.Workbook()\nws = wb.active\nws.title = \'附1-预算表\'\nfor r in rows:\n    ws.append(r)\nwb.save(sys.argv[2])\n';
const importHistory = async (sup, code, tag) => {
  const name = '夹具历史补录单-' + S + '-' + tag;
  const rows = [['商机代码', code], ['商机名称', name], ['客户名称', '夹具历史客户'], ['评审结论', '同意通过'], ['评审日期', '2024-05-12']];
  const tmp = path.join(__dirname, '_hfxod_' + S + '_' + (++hfxSeq) + '.xlsx');
  let data;
  try {
    const py = spawnSync('python', ['-X', 'utf8', '-c', HFX_PY, JSON.stringify(rows), tmp], { encoding: 'utf8' });
    if (py.status !== 0) throw new Error('openpyxl 生成历史补录 xlsx 失败: ' + String(py.stderr || py.error || '').slice(0, 200));
    data = fs.readFileSync(tmp).toString('base64');
  } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
  const r = await raw(sup, '/api/reviews/import', 'POST', { filename: '夹具历史补录.xlsx', type: 'bid', mode: 'history', review_date: '2024-05-12', data });
  const d = r.data || {};
  const id = Number(d.id) || 0;
  if (id) OWNED.reviews.push(id);
  const respOk = r.status === 200 && id > 0 && d.era === 'history' && d.status === 'archived' && d.light === 'none' &&
    d.archived_at === '2024-05-12' && (d.form || {}).opp_code === code;
  const det = id ? await raw(sup, '/api/reviews/' + id) : { status: 0, data: {} };
  const rv = det.data.review || {};
  const atts = det.data.attachments || [], evs = det.data.events || [], tks = det.data.tasks;
  const detOk = det.status === 200 && Number(rv.id) === id && rv.era === 'history' && rv.status === 'archived' && rv.light === 'none' &&
    rv.opp_code === code && rv.archived_at === '2024-05-12' && atts.some(a => a.field === '历史评审表原件') &&
    evs.some(e => e.action === '历史数据导入') && Array.isArray(tks) && tks.length === 0;
  return { id, ok: respOk && detOk, review: rv,
    ev: 'import=' + r.status + ' id=' + id + ' era=' + JSON.stringify(d.era) + ' status=' + JSON.stringify(d.status) +
      ' light=' + JSON.stringify(d.light) + ' archived_at=' + JSON.stringify(d.archived_at) + ' decision=' + JSON.stringify(d.decision) +
      ' form.opp_code=' + JSON.stringify((d.form || {}).opp_code) + (d.error ? ' error=' + JSON.stringify(d.error) : '') +
      ' | detail=' + det.status + ' title=' + JSON.stringify(rv.title) + ' 附件=' + JSON.stringify(atts.map(a => a.field)) +
      ' 事件=' + JSON.stringify(evs.map(e => e.action)) + ' tasks=' + (Array.isArray(tks) ? tks.length : 'n/a') };
};

(async () => {
  const sales = await login('sales1');
  const zhichi = await login('zhichizu');   // H 夹具: 历史补录仅销售支持组/admin 可做
  const stub = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ fields: STUB.fields }) } }] }));
    });
  });
  const killer = http.createServer((req, res) => { res.socket.destroy(); });
  killer.on('connection', sock => sock.destroy());
  await new Promise(r => stub.listen(9831, '127.0.0.1', r));
  await new Promise(r => killer.listen(9832, '127.0.0.1', r));
  let agent = {};
  try { delete require.cache[require.resolve('../agent.js')]; agent = require('../agent.js'); } catch (e) {}
  const WL = agent.OPP_WHITELIST;
  try {
    // ---------- OD-01 白名单键集 ⊆ OPP_FIELDS 实测全集 ----------
    await guard('OD-01', '白名单 ⊆ OPP_FIELDS', async () => {
      const keys = WL ? Object.keys(WL) : null;
      const outside = keys ? keys.filter(k => !(OPP_FIELDS || []).includes(k)) : null;
      check('OD-01', 'OPP_FIELDS 按内容锚解析成功且为 12 项', Array.isArray(OPP_FIELDS) && OPP_FIELDS.length === 12, 'OPP_FIELDS=' + JSON.stringify(OPP_FIELDS));
      check('OD-01', 'agent.OPP_WHITELIST 存在且键集 ⊆ OPP_FIELDS(集外键=' + JSON.stringify(outside) + ')',
        !!keys && keys.length > 0 && outside.length === 0, 'keys=' + JSON.stringify(keys));
      check('OD-01', 'OPP_REQUIRED(7) ⊆ 白名单(追问集可全部经口语补齐)',
        !!keys && Array.isArray(OPP_REQUIRED) && OPP_REQUIRED.length === 7 && OPP_REQUIRED.every(k => keys.includes(k)), 'OPP_REQUIRED=' + JSON.stringify(OPP_REQUIRED));
    });

    // ---------- OD-02 status/opp_code 不在 OPP_FIELDS/白名单; LLM 注入二者被丢弃 ----------
    await guard('OD-02', 'status/opp_code 不可经对话写入', async () => {
      check('OD-02', 'status/opp_code ∉ OPP_FIELDS 且 ∉ 白名单',
        !!WL && Array.isArray(OPP_FIELDS) && !OPP_FIELDS.includes('status') && !OPP_FIELDS.includes('opp_code') && !('status' in WL) && !('opp_code' in WL));
      setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9831' });
      STUB.fields = { customer: '注入测试客户', status: 'reviewed', opp_code: 'EVIL-01', created_by: 1, source: 'agent' };
      const r = await chat(sales, { message: '客户是注入测试客户, 状态改成已评审, 商机代码 EVIL-01', draft: { title: 'OD-02', status: 'reviewed', opp_code: 'EVIL-02' } });
      restoreCfg();
      const d = r.data.draft || {};
      check('OD-02', '对话 200 且 draft 不含 status/opp_code/created_by/source(LLM 与客户端草稿两路注入均丢弃)',
        r.status === 200 && d.customer === '注入测试客户' && !('status' in d) && !('opp_code' in d) && !('created_by' in d) && !('source' in d),
        'status=' + r.status + ' draft=' + JSON.stringify(d));
    });

    // ---------- OD-03 LLM 未提及的键不被凭空写入 ----------
    await guard('OD-03', '未提及键保持原值', async () => {
      setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9831' });
      STUB.fields = { customer: '江西省测绘地理信息局' };
      const before = { ...FULL };
      const r = await chat(sales, { message: '客户换成江西省测绘地理信息局', draft: before });
      restoreCfg();
      const d = r.data.draft || {};
      const others = Object.keys(before).filter(k => k !== 'customer');
      const kept = others.every(k => String(d[k]) === String(before[k]));
      check('OD-03', '200 且 customer 更新为桩值', r.status === 200 && d.customer === '江西省测绘地理信息局' && r.data.degraded === false, 'status=' + r.status + ' customer=' + d.customer);
      check('OD-03', '其余 ' + others.length + ' 键逐一保持原值且无新增键', kept && sameArr(Object.keys(d), Object.keys(before)), 'draft=' + JSON.stringify(d));
    });

    // ---------- OD-04 桩断开 ⇒ 降级点选, HTTP 仍 200, 已填字段不被污染 ----------
    let od04 = null;
    await guard('OD-04', '断开桩降级', async () => {
      setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9832' });
      const before = { title: 'OD-04 降级', customer: '江西省自然资源测绘与监测院', contract_amount: 240 };
      const r = await chat(sales, { message: '销售是王超, 业务线 G1', draft: before });
      restoreCfg();
      od04 = r;
      const d = r.data.draft || {};
      check('OD-04', 'HTTP 200 且 degraded=true', r.status === 200 && r.data.degraded === true, 'status=' + r.status + ' degraded=' + r.data.degraded);
      check('OD-04', '已填三键原值不变且无新增键', sameArr(Object.keys(d), Object.keys(before)) && Object.keys(before).every(k => String(d[k]) === String(before[k])), 'draft=' + JSON.stringify(d));
      check('OD-04', '回复含降级点选提示且列出缺项(missing 恰为 OPP_REQUIRED 未填 4 项)',
        /点选/.test(r.data.reply || '') && sameArr(r.data.missing, ['biz_line', 'opp_stage', 'sales', 'summary']),
        'missing=' + JSON.stringify(r.data.missing) + ' reply=' + String(r.data.reply || '').replace(/\n/g, '⏎').slice(0, 120));
    });

    // ---------- OD-05 非法 opp_code 经对话提交 ⇒ 400 且文案与网页路径逐字相同 ----------
    await guard('OD-05', '非法商机代码同一裁判', async () => {
      const web = await raw(sales, '/api/opp', 'POST', { ...FULL, opp_code: '商机阶段' });
      const dlg = await chat(sales, { action: 'create', message: '确认建档', opp_code: '商机阶段', draft: FULL });
      check('OD-05', '网页 400 / 对话 400', web.status === 400 && dlg.status === 400, 'web=' + web.status + ' dlg=' + dlg.status);
      check('OD-05', 'error 逐字相同且不含 missing', !!web.data.error && dlg.data.error === web.data.error && !('missing' in dlg.data && (dlg.data.missing || []).length),
        'web=' + web.data.error + ' | dlg=' + dlg.data.error);
    });

    // ---------- OD-06 必填缺失经对话 ⇒ missing[] 与网页路径一致(恰含口径) ----------
    await guard('OD-06', 'missing 两路径一致', async () => {
      const part = { ...FULL }; delete part.customer; delete part.summary; delete part.sales;
      const web = await raw(sales, '/api/opp', 'POST', { ...part, opp_code: CODE('06w') });
      const dlg = await chat(sales, { action: 'create', message: '确认建档', opp_code: CODE('06d'), draft: part });
      setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9831' });
      STUB.fields = {};
      const turn = await chat(sales, { message: '先这样', draft: part });
      restoreCfg();
      const wm = web.data.missing, dm = dlg.data.missing;
      check('OD-06', '两路径均 400 且 error 逐字相同', web.status === 400 && dlg.status === 400 && dlg.data.error === web.data.error, 'web=' + web.data.error + ' | dlg=' + dlg.data.error);
      check('OD-06', 'missing 恰含 customer/sales/summary 且两路径集合相等', sameArr(wm, ['customer', 'sales', 'summary']) && sameArr(dm, wm), 'web=' + JSON.stringify(wm) + ' dlg=' + JSON.stringify(dm));
      check('OD-06', '对话轮(非建档) missing 与网页路径同集且不含 opp_code', turn.status === 200 && sameArr(turn.data.missing, wm) && !(turn.data.missing || []).includes('opp_code'),
        'turn=' + turn.status + ' ' + JSON.stringify(turn.data.missing));
      const g = await raw(sales, '/api/opp/' + encodeURIComponent(CODE('06d')));
      check('OD-06', '缺项建档未落库(GET 404)', g.status === 404, 'status=' + g.status);
    });

    // ---------- OD-07 对话建档不附带提交特权 ----------
    const C7 = CODE('07');
    OWNED.codes.push(C7);
    let od07Rid = 0;   // OD-08 夹具复用: C7 上 OD-07 留下的这张真实在线草稿
    await guard('OD-07', '建档后提交门照常', async () => {
      const dlg = await chat(sales, { action: 'create', message: '确认建档', opp_code: C7, draft: FULL });
      const o = dlg.data.opp || {};
      check('OD-07', '对话建档 200 且档案 status=pending', dlg.status === 200 && o.opp_code === C7 && o.status === 'pending', 'status=' + dlg.status + ' ' + (dlg.data.error || ''));
      const dup = await chat(sales, { action: 'create', message: '确认建档', opp_code: C7, draft: FULL });
      const dupW = await raw(sales, '/api/opp', 'POST', { ...FULL, opp_code: C7 });
      check('OD-07', '同码再建 409 与网页路径逐字相同', dup.status === 409 && dupW.status === 409 && dup.data.error === dupW.data.error, 'dlg=' + dup.data.error + ' | web=' + dupW.data.error);
      const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]OD-07 对话建档后提交', form: { opp_code: C7, customer: FULL.customer }, submit: false })).id;
      od07Rid = Number(rid) || 0;
      if (od07Rid) OWNED.reviews.push(od07Rid);
      const s = await raw(sales, '/api/reviews/' + rid + '/submit', 'POST');
      check('OD-07', '无预算单提交被第 1 层拦 400(预算必带)', s.status === 400 && s.data.error === '请先上传或在线填写《项目贡献毛利率及成本预算表》再提交', 'status=' + s.status + ' ' + (s.data.error || ''));
      const rv = (await api(sales, '/api/reviews/' + rid)).review;
      check('OD-07', '评审单仍为 draft', rv.status === 'draft', 'status=' + rv.status);
    });

    // ---------- OD-08 聚合视图: 当前在途 = chain 差值 / 历史累计 = lights 合计, 两列分列 ----------
    const oppLightAgg = feFn('oppLightAgg');
    const oppLightAggHtml = feFn('oppLightAggHtml');
    const aggOf = async code => {
      const d = (await raw(sales, '/api/opp/' + encodeURIComponent(code) + '/360')).data;
      return { d, a: oppLightAgg ? oppLightAgg(d) : null };
    };
    const cell = (html, k) => { const m = String(html || '').match(new RegExp('data-agg="' + k + '"[^>]*>(\\d+)<')); return m ? Number(m[1]) : null; };
    const eraOf = r => (!r.era || r.era === 'online') ? 'online' : r.era;
    // 夹具(2026-10-21 改真实 HTTP): C7 已有 OD-07 的真实在线草稿, 再由支持组对 C7 做一次历史补录(H) ⇒ 在线 1 张未提交 + 历史 1 张 archived/none,
    //   期望 chain 1/0、lights 合计 2、inflight 1、history_total 2(与原合成夹具同值)。era 过滤变异见证落在 chain 1/0: 去掉过滤 ⇒ 2/1 必红
    await guard('OD-08', '两列分列', async () => {
      check('OD-08', 'app.js 存在纯函数 oppLightAgg/oppLightAggHtml 且 L1 概览渲染调用', typeof oppLightAgg === 'function' && typeof oppLightAggHtml === 'function'
        && /function renderOpp360[\s\S]{0,3000}oppLightAggHtml\(oppLightAgg\(d\)\)/.test(APP_SRC));
      const h = await importHistory(zhichi, C7, '08');
      check('OD-08', '夹具: C7 = OD-07 真实在线草稿 + 支持组真实历史补录(history/archived/none, 原件附件/导入事件/0 任务)',
        od07Rid > 0 && h.ok, 'od07Rid=' + od07Rid + ' | ' + h.ev);
      const { d, a } = await aggOf(C7);
      const ch = d.chain || {}, L = d.lights || {};
      const sumL = Object.values(L).reduce((s, v) => s + (Number(v) || 0), 0);
      const rows = d.reviews || [];
      const rOn = rows.find(r => Number(r.id) === od07Rid) || {}, rH = rows.find(r => Number(r.id) === h.id) || {};
      check('OD-08', '夹具精确态: reviews 恰 2 行(OD-07 草稿 online/draft + H history/archived), chain 1/0, lights 合计 2, inflight 1, history_total 2',
        rows.length === 2 && od07Rid > 0 && h.id > 0 && rOn.id !== undefined && eraOf(rOn) === 'online' && rOn.status === 'draft' &&
        rH.era === 'history' && rH.status === 'archived' && ch.reviews_total === 1 && ch.reviews_submitted === 0 && sumL === 2 &&
        !!a && a.inflight === 1 && a.history_total === 2,
        'rows=' + JSON.stringify(rows.map(r => [r.id, r.era, r.status, r.light])) + ' chain=' + JSON.stringify([ch.reviews_total, ch.reviews_submitted]) +
        ' lights=' + JSON.stringify(L) + ' agg=' + JSON.stringify(a && [a.inflight, a.history_total]));
      check('OD-08', '夹具使两列不相等(chain 差值 ' + ((ch.reviews_total || 0) - (ch.reviews_submitted || 0)) + ' ≠ lights 合计 ' + sumL + ')', (ch.reviews_total - ch.reviews_submitted) !== sumL);
      check('OD-08', 'inflight = reviews_total - reviews_submitted', !!a && a.inflight === ch.reviews_total - ch.reviews_submitted, JSON.stringify(a && { inflight: a.inflight, chain: ch }));
      check('OD-08', 'history_total = lights 逐项相加', !!a && a.history_total === sumL, JSON.stringify(a && { history_total: a.history_total, lights: L }));
      const html = a ? oppLightAggHtml(a) : '';
      check('OD-08', '渲染两格分列且各显其值(不合并成单数)', cell(html, 'inflight') === a.inflight && cell(html, 'history') === a.history_total
        && cell(html, 'inflight') !== null && !new RegExp('>' + (a.inflight + a.history_total) + '<').test(html.replace(/data-agg="(inflight|history)"[^>]*>\d+</g, '')),
        'inflight=' + cell(html, 'inflight') + ' history=' + cell(html, 'history'));
    });
    gap('OD-08-inflight', 'history-draft inflight mutation witness gap(不可计为PASS)', 'era=history 且 status=draft 的行无已授权 HTTP 产地(历史导入恒 history/archived), 原 SQL INSERT 已删除; 去掉 era 过滤的变异对 inflight 不再可见(2−1 仍为 1), 仅 chain 1/0 见证保留');

    // ---------- OD-09 era 反证: 历史单只进历史列, 在线单才进在途列(配对 fresh code, 真实 HTTP) ----------
    // 原「同一合成单 history→online 改 era」靠 SQL UPDATE; literal same-record era flip 无 HTTP 接口, 不保留。
    // 现: 两个 fresh code 各 1 张合法在线草稿作基线 [1,1]; 历史侧加 H(支持组历史补录) → [1,2], 在线侧再 POST 一张草稿 → [2,2],
    //   两侧历史列同增 1、只有在线侧在途列 +1 ⇒ 在途归属由 era 决定。era 过滤变异见证落在 chain: 去掉过滤 ⇒ 历史侧 chain 2/1(≠1/0)必红;
    //   inflight 对 archived 历史单不敏感(变异下 2−1 仍为 1), 不单独作见证
    await guard('OD-09', 'era 配对对照', async () => {
      const c9h = CODE('09h'), c9o = CODE('09o');
      OWNED.codes.push(c9h, c9o);
      const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
      const byId = rs => [...rs].sort((x, y) => x[0] - y[0]);
      const snap = async code => {
        const { d, a } = await aggOf(code);
        const ch = d.chain || {};
        return { agg: a ? [a.inflight, a.history_total] : null, chain: [ch.reviews_total, ch.reviews_submitted],
          rows: byId((d.reviews || []).map(r => [Number(r.id), eraOf(r), r.status])) };
      };
      const draft = async (code, tag) => {
        const r = await raw(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]OD-09 ' + tag + '-' + S, form: { opp_code: code, customer: FULL.customer }, submit: false });
        const id = Number((r.data || {}).id) || 0;
        if (id) OWNED.reviews.push(id);
        return { id, ev: r.status + ((r.data || {}).error ? '(' + r.data.error + ')' : '') + '#' + id };
      };
      const oh = await raw(sales, '/api/opp', 'POST', { ...FULL, opp_code: c9h });
      const oo = await raw(sales, '/api/opp', 'POST', { ...FULL, opp_code: c9o });
      const dh1 = await draft(c9h, '历史侧基线草稿');
      const do1 = await draft(c9o, '在线侧基线草稿');
      const h0 = await snap(c9h), o0 = await snap(c9o);
      check('OD-09', '基线: 两 fresh code 各 1 张合法在线草稿, [inflight,cumulative] 均为 [1,1] 且 chain 均 1/0',
        oh.status === 200 && oo.status === 200 && dh1.id > 0 && do1.id > 0 && same(h0.agg, [1, 1]) && same(o0.agg, [1, 1]) &&
        same(h0.chain, [1, 0]) && same(o0.chain, [1, 0]) && same(h0.rows, [[dh1.id, 'online', 'draft']]) && same(o0.rows, [[do1.id, 'online', 'draft']]),
        'opp=' + oh.status + '/' + oo.status + ' 草稿=' + dh1.ev + '/' + do1.ev + ' 历史侧=' + JSON.stringify(h0) + ' 在线侧=' + JSON.stringify(o0));
      const h = await importHistory(zhichi, c9h, '09h');
      const do2 = await draft(c9o, '在线侧第二草稿');
      const h1 = await snap(c9h), o1 = await snap(c9o);
      check('OD-09', '历史侧加真实 H: 在途列不变 / 历史列 +1 → 精确 [1,2], chain 仍 1/0, 行=[基线草稿 online/draft, H history/archived]',
        h.ok && same(h1.agg, [1, 2]) && same(h1.chain, [1, 0]) && same(h1.rows, byId([[dh1.id, 'online', 'draft'], [h.id, 'history', 'archived']])),
        JSON.stringify({ h0: h0.agg, h1: h1.agg, chain: h1.chain, rows: h1.rows }) + ' | ' + h.ev);
      check('OD-09', '在线侧加第二张真实草稿: 在途列 +1 / 历史列 +1 → 精确 [2,2], chain 2/0, 行=两张 online/draft; 两侧历史列同为 2、在途列只差 1(配对码对照, 非同一行改 era)',
        do2.id > 0 && same(o1.agg, [2, 2]) && same(o1.chain, [2, 0]) && same(o1.rows, byId([[do1.id, 'online', 'draft'], [do2.id, 'online', 'draft']])) &&
        !!h1.agg && !!o1.agg && h1.agg[1] === o1.agg[1] && o1.agg[0] - h1.agg[0] === 1,
        JSON.stringify({ o0: o0.agg, o1: o1.agg, chain: o1.chain, rows: o1.rows, 历史侧: h1.agg }) + ' 草稿2=' + do2.ev);
    });
    gap('OD-09-flip', 'literal same-record era flip coverage gap(不可计为PASS)', 'literal same-record era flip has no HTTP interface, not retained(历史导入恒 history/archived, 无改 era 端点), 原 SQL UPDATE 已删除; 配对 fresh code 对照只钉 era 归属, 不证同一行 history→online 转换');

    // ---------- OD-10 llm_calls 观测面: profile 与 degraded 位真实 ----------
    await guard('OD-10', 'llm_calls 对账', async () => {
      setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9831' });
      STUB.fields = { pm: '冯金华' };
      const ok = await chat(sales, { message: '项目经理冯金华', draft: { title: 'OD-10' } });
      const rowOk = llmCalls();
      setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9832' });
      const bad = await chat(sales, { message: '项目经理冯金华', draft: { title: 'OD-10' } });
      const rowBad = llmCalls();
      restoreCfg();
      check('OD-10', 'llm_calls 表存在(T9 观测面)', rowOk !== null, 'row=' + JSON.stringify(rowOk));
      check('OD-10', '成功轮: profile=opp, ok=1, degraded=0 且与响应 degraded=false 一致',
        !!rowOk && rowOk.profile === 'opp' && rowOk.ok === 1 && rowOk.degraded === 0 && ok.status === 200 && ok.data.degraded === false, 'row=' + JSON.stringify(rowOk));
      check('OD-10', '断开轮: profile=opp, ok=0, degraded=1 且与响应 degraded=true 一致(新行)',
        !!rowBad && !!rowOk && rowBad.id > rowOk.id && rowBad.profile === 'opp' && rowBad.ok === 0 && rowBad.degraded === 1 && bad.status === 200 && bad.data.degraded === true, 'row=' + JSON.stringify(rowBad));
    });

    if (od04) console.log('[OD-04 降级实录] HTTP ' + od04.status + ' ' + JSON.stringify(od04.data));
  } finally {
    restoreCfg();
    stub.close(); killer.close();
  }
  const owned = 'OWNED(新 HTTP 夹具) run=' + S + ' codes=' + JSON.stringify(OWNED.codes) + ' reviews=' + JSON.stringify(OWNED.reviews) +
    ' budgets=[] | 本轮自建码前缀 PL-T11-' + S + '-* | 清理: 仅靠父级守护恢复演示库与 uploads, 本套无 SQL 清理';
  console.log(owned); LOG.push(owned);
  for (const g of GAPS) console.log('NOT EXECUTABLE ' + g);
  // 有缺口时不得输出 ALL PASS: 缺口数与文案进 summary 行(run_all 每套只截尾 6 行)
  const verdict = fail ? 'HAS FAIL' : (GAPS.length ? 'EXECUTED PASS + ' + GAPS.length + ' COVERAGE GAP(不可计为全绿)' : 'ALL PASS');
  const tail = `\n${pass} passed, ${fail} failed, ${GAPS.length} NOT EXECUTABLE -> ${verdict}` + (GAPS.length ? ' [' + GAPS.join('; ') + ']' : '') +
    ' [DISCLOSURE: OD-09 literal same-record era flip has no HTTP interface, not retained; replaced by paired-code comparison]';
  console.log(tail);
  const logArg = process.argv.find(a => a.startsWith('--log='));
  if (logArg) fs.writeFileSync(path.resolve(logArg.slice(6)), LOG.join('\n') + tail + '\n', 'utf8');
  process.exit(fail ? 1 : 0);
})().catch(e => { restoreCfg(); console.error('FATAL', e); process.exit(2); });
