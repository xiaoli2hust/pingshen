// V4.0-T9 LLM 管理中心用例: LM-01~LM-14 + V4.0-T14(D-52) LM-15~LM-20(admin 门禁/掩码/单一写者四键守卫/探针/用量落库/降级/profile 回落/settings 原始串/用量窗口/fill-budget 收敛/顶层 base 写入校验)
// + V4.0-T15 LM-21(空串/缺省 base = 「不修改」语义)
// 红基线: 旧代码无 profiles/test/usage 端点、无 llm_calls 表 -> LM-01/02/05/06/10/11 必 FAIL
// 用法: node tests/test_llm_admin.js [--log=tests/_t9_post_llm.txt]  (需服务运行于 8600)
// config.json 改动一律经既有唯一写者 POST /api/admin/config; 测试侧在 finally 与顶层异常两条路径都按原始字节复位(与 AC/AV 同口径)
// 9801 桩: 记录最近请求的 model/system 提示词/max_tokens, 可调延迟; 断开即 close(真断连, 非改地址)
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const http = require('http');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const CFG = path.join(__dirname, '..', 'config.json');
const STUB_PORT = 9801;
const STUB = 'http://127.0.0.1:' + STUB_PORT;
const DOWN = 'http://127.0.0.1:9';
const FOUR = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'REPORT_SECRET'];
const K_BUD = 'sk-t9budget-0001-abcdef';
const K_REV = 'sk-t9review-0002-ghijkl';

const S = { hits: 0, delay: 0, last: null };
const ROUTES = [
  [/毛利率/, { gross_margin: 0.1508 }],
  [/合同|240\s*万/, { contract: 2400000, sub_cost: 1000000 }]
];
function mkStub() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      S.hits++;
      let j = {};
      try { j = JSON.parse(body || '{}'); } catch (e) {}
      const msgs = j.messages || [];
      const sys = (msgs.find(m => m.role === 'system') || {}).content || '';
      const said = ((msgs.filter(m => m.role === 'user').map(m => m.content).join('\n')).split('用户说：')[1] || '').trim();
      S.last = { model: j.model, max_tokens: j.max_tokens, sys };
      let fields = {};
      for (const [re, f] of ROUTES) if (re.test(said)) { fields = f; break; }
      const out = JSON.stringify({ choices: [{ message: { role: 'assistant', content: '```json\n' + JSON.stringify({ fields }) + '\n```' } }] });
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out); }, S.delay);
    });
  });
}
let stub = null;
// T15: 顶层异常(IIFE reject)原先只关桩不复位 config.json ⇒ 桩值会留给下一次运行
let cfgSnap = null;
const restoreCfg = () => {
  if (cfgSnap === null) return 'skip';
  const origin = cfgSnap;
  cfgSnap = null;
  try { fs.writeFileSync(CFG, origin, 'utf8'); } catch (e) {}
  return fs.readFileSync(CFG, 'utf8') === origin;
};
const stubUp = () => new Promise(r => { stub = mkStub(); stub.listen(STUB_PORT, '127.0.0.1', r); });
const stubDown = () => new Promise(r => { if (!stub) return r(); stub.close(() => r()); stub.closeAllConnections && stub.closeAllConnections(); stub = null; });

async function raw(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async u => (await raw(null, '/api/login', 'POST', { username: u, password: '123456' })).data.token;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const readCfgFile = () => JSON.parse(fs.readFileSync(CFG, 'utf8'));

const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
db.exec('PRAGMA busy_timeout = 5000');
const setRaw = (k, v) => db.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?)').run(k, v, new Date().toISOString(), 'test_llm_admin');
const delRaw = k => db.prepare('DELETE FROM settings WHERE key=?').run(k);
const callsOf = ref => db.prepare('SELECT ok, degraded, ms, profile FROM llm_calls WHERE ref=? ORDER BY id').all(ref);

(async () => {
  const cfgRaw = fs.readFileSync(CFG, 'utf8');
  cfgSnap = cfgRaw;
  const before = JSON.parse(cfgRaw);
  const SETTING_KEYS = ['llm.degrade', 'prompt.review.v1', 'prompt.review.v2'];
  const prevSettings = {};
  for (const k of SETTING_KEYS) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); prevSettings[k] = r ? r.value : undefined; }
  const lm11Ids = [];
  await stubUp();
  try {
    const adminUser = db.prepare("SELECT username FROM users WHERE role='admin' LIMIT 1").get();
    const admin = adminUser ? await login(adminUser.username) : null;
    const zcz = await login('zhichizu');
    const fde = await login('fde1');
    const sales = await login('sales1');
    if (!admin) throw new Error('库内无 role=admin 用户');
    for (const k of SETTING_KEYS) delRaw(k);
    const cfgPost = body => raw(admin, '/api/admin/config', 'POST', body);
    const probe = prof => raw(admin, '/api/admin/llm/test', 'POST', { profile: prof });
    // 全程把顶层 LLM_BASE_URL 指向拒连地址: 杜绝真网关出站, 且让 profile 覆盖与回落都可判别
    await cfgPost({ LLM_BASE_URL: DOWN });
    // T15: 前置自清四个 profile 层——唯一写者对「与现网逐字相同」的提交判 400「未提交任何要修改的键」,
    // 上一次运行若被异常打断留下桩值, LM-03/08 会因写入变成 no-op 而恒红(与 base 校验无关); 显式 null=清除字段是既有契约
    await cfgPost({ LLM_PROFILES: {
      default: { base: null, key: null, model: null }, budget: { base: null, key: null, model: null },
      review: { base: null, key: null, model: null }, parser: { base: null, key: null, model: null }
    } });
    const preProfiles = (readCfgFile().LLM_PROFILES || {});
    check('LM-00', '前置自清后 profile 层无 base/model/key 残留(运行不依赖环境 config 现值)',
      ['default', 'budget', 'review', 'parser'].every(n => !preProfiles[n] || !preProfiles[n].base && !preProfiles[n].model && !preProfiles[n].key),
      'LLM_PROFILES=' + JSON.stringify(preProfiles));

    // LM-01: 非 admin 访问 profiles/test/usage 三端点一律 403, 文案前缀「仅 admin」
    const EP = [['GET', '/api/admin/llm/profiles'], ['POST', '/api/admin/llm/test'], ['GET', '/api/admin/llm/usage?days=7'], ['POST', '/api/admin/llm/settings']];
    for (const [m, u] of EP) {
      const rs = [await raw(zcz, u, m, m === 'POST' ? { profile: 'default' } : undefined), await raw(fde, u, m, m === 'POST' ? { profile: 'default' } : undefined)];
      check('LM-01', `非 admin ${m} ${u.split('?')[0]} 403 且文案前缀「仅 admin」`,
        rs.every(r => r.status === 403 && /^仅 admin/.test(r.data.error || '')), rs.map(r => r.status + ':' + (r.data.error || '')).join(' / '));
    }

    // LM-09: 未提交任何可改键 -> 400 既有文案(不回归)
    const r9 = await cfgPost({});
    check('LM-09', '空提交 400 且文案「未提交任何要修改的键」', r9.status === 400 && r9.data.error === '未提交任何要修改的键', r9.status + ':' + (r9.data.error || ''));

    // 写入两个 profile(经唯一写者)
    const rw = await cfgPost({ LLM_PROFILES: { budget: { base: STUB, key: K_BUD, model: 'stub-budget' }, review: { base: STUB, key: K_REV, model: 'stub-review' } } });

    // LM-03: 写 profile 后四键仍在(值不变)且文件可 parse, profile 真实落盘
    let after = {};
    let parsed = true;
    try { after = readCfgFile(); } catch (e) { parsed = false; }
    const fourOk = FOUR.every(k => k === 'LLM_BASE_URL' ? after[k] === DOWN : (k in after && after[k] === before[k]));
    check('LM-03', '写 profile 200 后 config.json 可 parse、四键在场且值未被吞', rw.status === 200 && parsed && fourOk && FOUR.every(k => k in after),
      'status=' + rw.status + ' keys=' + Object.keys(after).join(','));
    check('LM-03', 'profile 经唯一写者落盘(budget/review 三键)', ((after.LLM_PROFILES || {}).budget || {}).key === K_BUD && ((after.LLM_PROFILES || {}).review || {}).model === 'stub-review');

    // LM-02: GET 两端点响应均无明文 key(顶层真 key + 两个 profile key)
    const g1 = await raw(admin, '/api/admin/config');
    const g2 = await raw(admin, '/api/admin/llm/profiles');
    const secrets = [before.LLM_API_KEY, K_BUD, K_REV, before.REPORT_SECRET].filter(s => s && String(s).length > 7);
    const s1 = JSON.stringify(g1.data || {}), s2 = JSON.stringify(g2.data || {});
    const pm = (g1.data || {}).LLM_PROFILES_MASKED || {};
    check('LM-02', 'GET /api/admin/config 回 LLM_PROFILES_MASKED 且 key 为掩码', g1.status === 200 && /\*\*\*\*/.test((pm.budget || {}).key || '') && /\*\*\*\*/.test((pm.review || {}).key || ''),
      'budget.key=' + ((pm.budget || {}).key || '-'));
    check('LM-02', '两端点响应 JSON 不含任何明文 key/secret', g1.status === 200 && g2.status === 200 && secrets.every(s => !s1.includes(s) && !s2.includes(s)), 'profiles status=' + g2.status);

    // LM-04: 掩码回灌防御——提交带 **** 的 key 不改写原值
    const masked = (pm.review || {}).key || 'sk-****ijkl';
    const r4 = await cfgPost({ LLM_PROFILES: { review: { key: masked } } });
    const after4 = readCfgFile();
    check('LM-04', '回灌掩码 key 不改写原值', ((after4.LLM_PROFILES || {}).review || {}).key === K_REV, 'status=' + r4.status);

    // LM-05: 探针——桩在跑 ok=true 且真命中桩(model=profile 覆盖, max_tokens=1); 桩断开 HTTP 仍 200 且 ok=false+error
    S.last = null;
    const p5a = await probe('review');
    check('LM-05', '桩在跑: 200 ok=true ms 为数', p5a.status === 200 && p5a.data.ok === true && typeof p5a.data.ms === 'number', JSON.stringify(p5a.data));
    check('LM-05', '探针走 review profile 且 1-token', !!S.last && S.last.model === 'stub-review' && S.last.max_tokens === 1, JSON.stringify(S.last && { model: S.last.model, max_tokens: S.last.max_tokens }));
    await stubDown();
    const p5b = await probe('review');
    check('LM-05', '桩断开: HTTP 仍 200 且 ok=false、error 非空', p5b.status === 200 && p5b.data.ok === false && !!String(p5b.data.error || '').trim(), JSON.stringify(p5b.data));
    check('LM-05', '探针 error 不泄露明文 key', !String(p5b.data.error || '').includes(K_REV));
    await stubUp();

    // LM-06: llm_calls 随两次技能调用单调增长; 桩断开时出现 degraded=1 行; 技能①走 budget profile
    const bId = (await raw(sales, '/api/budget', 'POST', {})).data.id;
    const refB = 'budget:' + bId;
    let c0 = -1, c1 = -1, c2 = -1, rows = [];
    try { c0 = callsOf(refB).length; } catch (e) { c0 = 'ERR ' + e.message; }
    S.last = null;
    const ch1 = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bId, message: '合同 240 万，分包 100 万' });
    try { c1 = callsOf(refB).length; } catch (e) { c1 = 'ERR'; }
    check('LM-06', '技能①走 budget profile(桩收到 model=stub-budget)且未降级', ch1.status === 200 && ch1.data.degraded === false && !!S.last && S.last.model === 'stub-budget',
      'degraded=' + ch1.data.degraded + ' model=' + (S.last && S.last.model));
    await stubDown();
    const ch2 = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bId, message: '合同 300 万' });
    try { c2 = callsOf(refB).length; rows = callsOf(refB); } catch (e) { c2 = 'ERR'; }
    check('LM-06', 'llm_calls 行数 0→1→2 单调增长', c0 === 0 && c1 === 1 && c2 === 2, `c0=${c0} c1=${c1} c2=${c2}`);
    check('LM-06', '桩在跑行 ok=1/degraded=0, 桩断开行 ok=0/degraded=1, profile=budget',
      rows.length === 2 && rows[0].ok === 1 && rows[0].degraded === 0 && rows[1].ok === 0 && rows[1].degraded === 1 && rows.every(r => r.profile === 'budget'),
      JSON.stringify(rows));
    check('LM-06', '桩断开时技能① HTTP 200 且 degraded=true', ch2.status === 200 && ch2.data.degraded === true);

    // LM-07: 桩断开时技能② HTTP 200 + 降级标记 + 点选字段齐备, form_json 未被污染
    const code = ((await raw(sales, '/api/budget/' + bId)).data.budget || {}).code;
    const mk = await raw(sales, '/api/agent/chat', 'POST', { skill: 'review', message: `用 ${code} 建投标评审单` });
    const RV = (mk.data || {}).review_id || 0;
    const fj0 = RV ? (db.prepare('SELECT form_json FROM reviews WHERE id=?').get(RV) || {}).form_json : null;
    const ch7 = await raw(sales, '/api/agent/chat', 'POST', { skill: 'review', message: '客户江西省自然资源测绘与监测院，合同 24 万', review_id: RV });
    const fj1 = RV ? (db.prepare('SELECT form_json FROM reviews WHERE id=?').get(RV) || {}).form_json : null;
    const d7 = ch7.data || {};
    check('LM-07', '技能② 桩断开 HTTP 200 且 degraded=true', RV > 0 && ch7.status === 200 && d7.degraded === true, 'rv=' + RV + ' status=' + ch7.status);
    check('LM-07', '降级回复点选字段齐备(reply/draft/missing/review_id)', typeof d7.reply === 'string' && !!d7.draft && Array.isArray(d7.missing) && d7.missing.length > 0 && d7.review_id === RV);
    check('LM-07', 'form_json 未被 LLM 输出污染(前后逐字相等)', !!fj0 && fj0 === fj1);
    let rv7 = [];
    try { rv7 = callsOf('review:' + RV); } catch (e) {}
    check('LM-07', '技能② 降级同样落 llm_calls(profile=review, degraded=1)', rv7.length === 1 && rv7[0].profile === 'review' && rv7[0].degraded === 1, JSON.stringify(rv7));
    await stubUp();

    // LM-08: profile 未配置时回落 default profile -> 顶层 config(顶层 model 同时回落)
    const topModel = before.LLM_MODEL || 'deepseek-chat';
    const p8a = await probe('parser');
    check('LM-08', 'parser 未配置 + 顶层指拒连 -> ok=false(确实回落顶层)', p8a.status === 200 && p8a.data.ok === false, JSON.stringify(p8a.data).slice(0, 120));
    await cfgPost({ LLM_BASE_URL: STUB });
    S.last = null;
    const p8b = await probe('parser');
    check('LM-08', '顶层改指桩 -> parser ok=true 且 model 回落顶层 LLM_MODEL', p8b.data.ok === true && !!S.last && S.last.model === topModel, 'model=' + (S.last && S.last.model));
    await cfgPost({ LLM_BASE_URL: DOWN, LLM_PROFILES: { default: { base: STUB } } });
    S.last = null;
    const p8c = await probe('parser');
    check('LM-08', '顶层拒连 + default.base 指桩 -> parser 经 default 回落 ok=true', p8c.data.ok === true && !!S.last, JSON.stringify(p8c.data));
    const pf = ((await raw(admin, '/api/admin/llm/profiles')).data || {}).profiles || [];
    const pp = pf.find(x => x.name === 'parser') || {};
    check('LM-08', 'profiles 端点回显 parser 实效值与来源(base←default, model←顶层)', pp.base === STUB && pp.base_src === 'default' && pp.model === topModel && pp.model_src === 'config',
      JSON.stringify({ base: pp.base, base_src: pp.base_src, model: pp.model, model_src: pp.model_src }));
    await cfgPost({ LLM_PROFILES: { default: { base: null } } });
    const p8d = await probe('parser');
    check('LM-08', 'default.base 显式 null 清除后回落顶层拒连(ok=false 且文件内已删)', p8d.data.ok === false && !((readCfgFile().LLM_PROFILES || {}).default || {}).base);

    // LM-10: llm.degrade 存 JSON 字符串, 探针与技能读得到(getSettingRaw; getSettings 会忽略非数字键)
    S.delay = 3000;
    setRaw('llm.degrade', JSON.stringify({ timeout_ms: 1000 }));
    const p10a = await probe('review');
    check('LM-10', 'timeout_ms=1000 + 桩延迟 3s -> 探针 ok=false 且 ms<2500', p10a.status === 200 && p10a.data.ok === false && p10a.data.ms < 2500, 'ms=' + p10a.data.ms);
    const ch10 = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bId, message: '合同 240 万' });
    check('LM-10', '同设置下技能① 也按 1s 超时降级(HTTP 200 degraded=true)', ch10.status === 200 && ch10.data.degraded === true, 'degraded=' + ch10.data.degraded);
    setRaw('llm.degrade', JSON.stringify({ timeout_ms: 8000 }));
    const p10b = await probe('review');
    check('LM-10', 'timeout_ms=8000 -> 探针 ok=true 且 ms≥2900(确为同一桩)', p10b.data.ok === true && p10b.data.ms >= 2900, 'ms=' + p10b.data.ms);
    S.delay = 0;

    // LM-12: llm.degrade.enabled=false -> 技能直接降级且不出站; 探针不受开关影响(诊断用途)
    setRaw('llm.degrade', JSON.stringify({ enabled: false }));
    const h0 = S.hits;
    const ch12 = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bId, message: '合同 240 万' });
    check('LM-12', 'enabled=false: 技能① 200 degraded=true 且桩零命中', ch12.status === 200 && ch12.data.degraded === true && S.hits === h0, 'hits+' + (S.hits - h0));
    const p12 = await probe('review');
    check('LM-12', 'enabled=false: 探针照常 ok=true', p12.data.ok === true);
    delRaw('llm.degrade');

    // LM-13: prompt.<skill>.v<n> 取最高版本覆盖技能② 系统提示词; 删除后回落冻结默认
    setRaw('prompt.review.v1', JSON.stringify('LM13-PROMPT-V1'));
    setRaw('prompt.review.v2', JSON.stringify('LM13-PROMPT-V2'));
    S.last = null;
    const mk13 = await raw(sales, '/api/agent/chat', 'POST', { skill: 'review', message: `用 ${code} 建投标评审单` });
    const RV13 = (mk13.data || {}).review_id || 0;
    const ch13 = await raw(sales, '/api/agent/chat', 'POST', { skill: 'review', message: '毛利率 0.1508', review_id: RV13 });
    check('LM-13', 'v2 覆盖技能② 提示词(桩收到 LM13-PROMPT-V2)且字段照常归一化', !!S.last && S.last.sys === 'LM13-PROMPT-V2' && (ch13.data.draft || {}).gross_margin === 15.08,
      'sys=' + (S.last && S.last.sys.slice(0, 20)));
    delRaw('prompt.review.v1'); delRaw('prompt.review.v2');
    S.last = null;
    await raw(sales, '/api/agent/chat', 'POST', { skill: 'review', message: '毛利率 0.1508', review_id: RV13 });
    check('LM-13', '删除版本后回落冻结默认 BID 提示词', !!S.last && /^你是投标评审表的字段抽取器/.test(S.last.sys));

    // LM-14: settings 写端点——越界参数 400; 合法写入走原始串通道并记操作人; 提示词只追加新版本
    const r14a = await raw(admin, '/api/admin/llm/settings', 'POST', { degrade: { timeout_ms: 500 } });
    check('LM-14', 'timeout_ms 越界 400', r14a.status === 400, r14a.status + ':' + (r14a.data.error || ''));
    const r14b = await raw(admin, '/api/admin/llm/settings', 'POST', { degrade: { timeout_ms: 5000, retries: 1, enabled: true } });
    const row14 = db.prepare('SELECT value, updated_by FROM settings WHERE key=?').get('llm.degrade') || {};
    check('LM-14', '合法 degrade 落 settings 原始 JSON 串且记操作人', r14b.status === 200 && row14.value === JSON.stringify({ timeout_ms: 5000, retries: 1, enabled: true }) && row14.updated_by === adminUser.username,
      JSON.stringify(row14));
    const r14c = await raw(admin, '/api/admin/llm/settings', 'POST', { prompt: { skill: 'review', text: 'LM14-PROMPT' } });
    const r14d = await raw(admin, '/api/admin/llm/settings', 'POST', { prompt: { skill: 'review', text: 'LM14-PROMPT-B' } });
    const g14 = (await raw(admin, '/api/admin/llm/profiles')).data || {};
    check('LM-14', '提示词两次写入为 v1→v2 追加, profiles 回显版本与降级参数', r14c.data.prompt && r14c.data.prompt.v === 1 && r14d.data.prompt && r14d.data.prompt.v === 2 &&
      ((g14.prompts || {}).review || []).map(x => x.v).join(',') === '2,1' && (g14.degrade || {}).timeout_ms === 5000,
      JSON.stringify({ c: r14c.data, d: r14d.data, v: ((g14.prompts || {}).review || []).map(x => x.v) }));
    const r14e = await raw(admin, '/api/admin/llm/settings', 'POST', { prompt: { skill: 'judge', text: 'x' } });
    check('LM-14', '非白名单 skill 400(判灯等路径不受提示词管理)', r14e.status === 400);
    delRaw('prompt.review.v1'); delRaw('prompt.review.v2'); delRaw('llm.degrade');

    // LM-11: 用量窗口——30 天前的行不计入 ?days=7, 当前行恰增 1(防 ISO 字典序比较恒不淘汰)
    const prof11 = 'lm11-' + Date.now();
    let n11a = 'ERR', n11b = 'ERR';
    try {
      lm11Ids.push(db.prepare('INSERT INTO llm_calls(ts,profile,ok,degraded,ms,tokens_est,ref) VALUES(?,?,?,?,?,?,?)').run(new Date(Date.now() - 30 * 86400000).toISOString(), prof11, 1, 0, 10, null, 'lm11').lastInsertRowid);
      const u1 = await raw(admin, '/api/admin/llm/usage?days=7');
      n11a = ((u1.data.rows || []).find(r => r.profile === prof11) || { n: 0 }).n;
      lm11Ids.push(db.prepare('INSERT INTO llm_calls(ts,profile,ok,degraded,ms,tokens_est,ref) VALUES(?,?,?,?,?,?,?)').run(new Date().toISOString(), prof11, 1, 0, 10, null, 'lm11').lastInsertRowid);
      const u2 = await raw(admin, '/api/admin/llm/usage?days=7');
      n11b = ((u2.data.rows || []).find(r => r.profile === prof11) || { n: 0 }).n;
      check('LM-11', '30 天前行不计入 ?days=7(n=0)', u1.status === 200 && n11a === 0, 'n=' + n11a + ' since=' + u1.data.since);
    } catch (e) { check('LM-11', '30 天前行不计入 ?days=7(n=0)', false, e.message); }
    check('LM-11', '再插当前行 n 恰为 1', n11b === 1, 'n=' + n11b);
    const st = await raw(admin, '/api/admin/llm/stats?days=7');
    check('LM-11', '/stats 别名与 /usage 同口径', st.status === 200 && ((st.data.rows || []).find(r => r.profile === prof11) || {}).n === 1);

    // ---------- LM-15~LM-20 (V4.0-T14 / D-52): fill-budget 收敛进单一入口 + 顶层 LLM_BASE_URL 写入侧校验 ----------
    // 夹具: budget profile 指桩(model=stub-budget), 顶层仍指拒连 DOWN ⇒ 旧自抄解析(env>顶层)必打 DOWN 且不落库, 收敛后走 profile
    await cfgPost({ LLM_BASE_URL: DOWN, LLM_PROFILES: { budget: { base: STUB, key: K_BUD, model: 'stub-budget' } } });
    const FB_REF = 'fill-budget';
    const fbRows = () => callsOf(FB_REF);
    const budgetUsage = async () => { const u = await raw(admin, '/api/admin/llm/usage?days=7'); return ((u.data.rows || []).find(x => x.profile === 'budget') || { n: 0 }).n; };

    // LM-15: fill-budget 吃 LLM_PROFILES.budget 的 base/model(此前绕开 resolveLlm, profile 路由对该端点无效)
    S.last = null; const h15 = S.hits;
    const f15 = await raw(sales, '/api/llm/fill-budget', 'POST', { text: '合同 240 万，分包 100 万' });
    check('LM-15', 'fill-budget 经 budget profile 指桩: 200 且 degraded=false 且桩实收 model=stub-budget',
      f15.status === 200 && f15.data.degraded === false && S.hits === h15 + 1 && !!S.last && S.last.model === 'stub-budget',
      'status=' + f15.status + ' degraded=' + f15.data.degraded + ' hits+' + (S.hits - h15) + ' model=' + (S.last && S.last.model) + ' err=' + (f15.data.error || ''));

    // LM-16: 成功轮落 llm_calls 一行(profile=budget, ref=fill-budget)且管理中心用量计数 +1
    const n16 = fbRows().length, u16a = await budgetUsage();
    const f16 = await raw(sales, '/api/llm/fill-budget', 'POST', { text: '合同 240 万' });
    const r16 = fbRows(), u16b = await budgetUsage();
    check('LM-16', '成功轮落 llm_calls 恰增一行且 profile=budget/ok=1/degraded=0',
      f16.status === 200 && r16.length === n16 + 1 && !!r16[r16.length - 1] && r16[r16.length - 1].profile === 'budget' &&
      r16[r16.length - 1].ok === 1 && r16[r16.length - 1].degraded === 0,
      'rows ' + n16 + '→' + r16.length + ' last=' + JSON.stringify(r16[r16.length - 1] || null));
    check('LM-16', 'GET /api/admin/llm/usage?days=7 的 budget 计数恰 +1(管理中心用量不再少这条真实路径)',
      u16b === u16a + 1, 'n=' + u16a + '→' + u16b);

    // LM-17: 桩断开 ⇒ 降级契约(铁律2): HTTP 仍 200 且带降级标志, 绝不放宽成 includes
    await stubDown();
    const n17 = fbRows().length;
    const f17 = await raw(sales, '/api/llm/fill-budget', 'POST', { text: '合同 240 万' });
    const r17 = fbRows();
    check('LM-17', '桩断开: fill-budget HTTP 恰 200 且 degraded=true(自动降级为手填, 不 5xx 不抛错)',
      f17.status === 200 && f17.data.degraded === true, 'status=' + f17.status + ' body=' + JSON.stringify(f17.data).slice(0, 140));
    check('LM-17', '降级轮同样落一行 profile=budget/ok=0/degraded=1',
      r17.length === n17 + 1 && !!r17[r17.length - 1] && r17[r17.length - 1].profile === 'budget' &&
      r17[r17.length - 1].ok === 0 && r17[r17.length - 1].degraded === 1, 'rows ' + n17 + '→' + r17.length + ' last=' + JSON.stringify(r17[r17.length - 1] || null));
    await stubUp();

    // LM-18: 写侧拒绝非 http(s) 顶层 LLM_BASE_URL ⇒ 整请求 400 且 config.json 逐字节未变
    const b18 = fs.readFileSync(CFG, 'utf8');
    const r18 = await cfgPost({ LLM_BASE_URL: 'file:///etc/passwd' });
    check('LM-18', '写 LLM_BASE_URL=file:///etc/passwd → 400 且 config.json 逐字节未变(不写文件)',
      r18.status === 400 && fs.readFileSync(CFG, 'utf8') === b18,
      'status=' + r18.status + ' unchanged=' + (fs.readFileSync(CFG, 'utf8') === b18) + ' err=' + (r18.data.error || ''));
    check('LM-18', '拒绝文案含「不是 http(s):// 地址」(与读侧探针同口径)且响应不回显任何明文 key/secret',
      /不是 http\(s\):\/\/ 地址/.test(String(r18.data.error || '')) && secrets.every(x => !JSON.stringify(r18.data).includes(x)),
      JSON.stringify(r18.data).slice(0, 140));

    // LM-19: '-' 开头同样拒(防被 curl 当选项; http(s) 正则已排除, 此条为显式覆盖)
    const b19 = fs.readFileSync(CFG, 'utf8');
    const r19 = await cfgPost({ LLM_BASE_URL: '-X POST' });
    check('LM-19', '写 LLM_BASE_URL="-X POST"(- 开头) → 400 且 config.json 逐字节未变',
      r19.status === 400 && fs.readFileSync(CFG, 'utf8') === b19,
      'status=' + r19.status + ' unchanged=' + (fs.readFileSync(CFG, 'utf8') === b19) + ' err=' + (r19.data.error || ''));

    // LM-20: 合法值仍可写(校验不过度收紧) + 掩码契约
    const r20 = await cfgPost({ LLM_BASE_URL: STUB });
    const a20 = readCfgFile();
    check('LM-20', '合法 http://127.0.0.1:' + STUB_PORT + ' 写入 200 且真实落盘',
      r20.status === 200 && a20.LLM_BASE_URL === STUB, 'status=' + r20.status + ' base=' + a20.LLM_BASE_URL);
    check('LM-20', '响应只回 LLM_API_KEY_MASKED(掩码)且无 LLM_API_KEY 明文键/不含任何明文 key/secret',
      r20.status === 200 && /\*\*\*\*/.test(String(r20.data.LLM_API_KEY_MASKED || '')) && !('LLM_API_KEY' in r20.data) &&
      secrets.every(x => !JSON.stringify(r20.data).includes(x)), JSON.stringify(r20.data).slice(0, 140));
    await cfgPost({ LLM_BASE_URL: DOWN });

    // ---------- LM-21 (V4.0-T15): base 的「空串/缺省 = 不修改」语义 + profile 写侧非法值拒绝 ----------
    // 本组钉住 T15 排查 LM-03 时坐实的口径: 写入侧裁判 llmBaseErr 只裁显式提交的非空值;
    // 空串/缺省不得被拒(否则管理中心的「留空即不改」表单会整请求 400), 而不产生任何变更的提交仍走 LM-09 的 400 文案。
    const p21 = () => ((readCfgFile().LLM_PROFILES || {}).budget || {});
    const baseBefore21 = p21().base, keyBefore21 = p21().key, topBefore21 = readCfgFile().LLM_BASE_URL;
    check('LM-21', '夹具前置: budget.base 为桩且顶层为拒连 DOWN', baseBefore21 === STUB && topBefore21 === DOWN, 'base=' + baseBefore21 + ' top=' + topBefore21);

    const r21a = await cfgPost({ LLM_PROFILES: { budget: { base: '', model: 'stub-budget-21a' } } });
    check('LM-21', '写 profile 时 base 传空串 → 恰 200 且原 base 逐字不变(仅 model 变更)',
      r21a.status === 200 && p21().base === baseBefore21 && p21().model === 'stub-budget-21a',
      'status=' + r21a.status + ' base=' + p21().base + ' model=' + p21().model + ' err=' + (r21a.data.error || ''));

    const r21b = await cfgPost({ LLM_PROFILES: { budget: { model: 'stub-budget' } } });
    check('LM-21', '写 profile 时 base 键缺省 → 恰 200 且 base/key 均未被吞',
      r21b.status === 200 && p21().base === baseBefore21 && p21().key === keyBefore21 && p21().model === 'stub-budget',
      'status=' + r21b.status + ' base=' + p21().base + ' key_masked_present=' + !!p21().key + ' err=' + (r21b.data.error || ''));

    const r21c = await cfgPost({ LLM_BASE_URL: '', LLM_MODEL: 'stub-top-21c' });
    const topAfter21 = readCfgFile();
    check('LM-21', '写顶层时 LLM_BASE_URL 空串 → 恰 200 且顶层值不动(仅 LLM_MODEL 变更)',
      r21c.status === 200 && topAfter21.LLM_BASE_URL === topBefore21 && topAfter21.LLM_MODEL === 'stub-top-21c',
      'status=' + r21c.status + ' top=' + topAfter21.LLM_BASE_URL + ' err=' + (r21c.data.error || ''));
    await cfgPost({ LLM_MODEL: before.LLM_MODEL });

    const f21d = fs.readFileSync(CFG, 'utf8');
    const r21d = await cfgPost({ LLM_PROFILES: { budget: { base: '' } } });
    check('LM-21', '仅提交空串 base(无任何实际变更) → 400 且沿用「未提交任何要修改的键」文案且文件逐字节未变',
      r21d.status === 400 && r21d.data.error === '未提交任何要修改的键' && fs.readFileSync(CFG, 'utf8') === f21d,
      'status=' + r21d.status + ' err=' + (r21d.data.error || '') + ' unchanged=' + (fs.readFileSync(CFG, 'utf8') === f21d));

    const f21e = fs.readFileSync(CFG, 'utf8');
    const r21e = await cfgPost({ LLM_PROFILES: { budget: { base: 'file:///etc/passwd', model: 'x' } } });
    check('LM-21', '写 profile 时显式提交非 http(s) base → 400 且文案绑定 profile 名, 文件逐字节未变',
      r21e.status === 400 && /^profile budget 的 base 不是 http\(s\):\/\/ 地址$/.test(String(r21e.data.error || '')) && fs.readFileSync(CFG, 'utf8') === f21e,
      'status=' + r21e.status + ' err=' + JSON.stringify(r21e.data) + ' unchanged=' + (fs.readFileSync(CFG, 'utf8') === f21e));
  } finally {
    await stubDown();
    restoreCfg();
    for (const k of SETTING_KEYS) { if (prevSettings[k] === undefined) delRaw(k); else setRaw(k, prevSettings[k]); }
    for (const id of lm11Ids) db.prepare('DELETE FROM llm_calls WHERE id=?').run(id);
    const fin = readCfgFile();
    const line = 'config.json 已按原始字节复位; 四键在场=' + FOUR.every(k => k in fin) + ' 字节相等=' + (fs.readFileSync(CFG, 'utf8') === cfgRaw);
    console.log(line); LOG.push(line);
  }
  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { try { stub && stub.close(); } catch (x) {} console.error('FAIL:', e.message + ' | 异常路径 config.json 复位字节相等=' + restoreCfg()); process.exit(1); });
