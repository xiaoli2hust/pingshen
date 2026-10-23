// T4 LLM 配置管理用例: AC-01~08(admin 门禁/掩码/写回保留键/桩生效/降级)
// 红基线: 旧代码无端点 -> 全部 404(用例 FAIL)
// 用法: node tests/test_admin_config.js [--log=tests/red|green_t4.txt]
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const CFG = path.join(__dirname, '..', 'config.json');

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

(async () => {
  const sales = await login('sales1'); // 普通用户
  const admin = await login('zhichizu'); // 支持组非 admin
  // admin 账号: zhichizu role 是 '销售支持组', 非 'admin'——需用真 admin; 种子里 admin 用户?
  // 测试前查: 本系统 role==='admin' 的账号
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));
  const adminUser = db.prepare("SELECT username FROM users WHERE role='admin' LIMIT 1").get();
  const adminToken = adminUser ? await login(adminUser.username) : null;
  if (!adminToken) {
    // 种子无 admin: 用 zhichizu 充当(T4 实现把支持组也放行? 不——仅 admin; 测试需真实 admin)
    // 兼容: 种子里 zhichizu 是准 admin——本用例集跳过需要 admin 的部分并报告
    console.log('NOTE: 库内无 role=admin 用户, admin 侧用例将标 SKIP/FAIL(需种 admin 账号)');
  }
  const cfgRaw = fs.readFileSync(CFG, 'utf8');
  try {
    // AC-01: 非 admin GET 403
    const r1 = await raw(sales, '/api/admin/config');
    check('AC-01', '非 admin GET 403', r1.status === 403, 'status=' + r1.status);
    // AC-02: 支持(非 admin) GET 也 403
    const r2 = await raw(admin, '/api/admin/config');
    check('AC-02', '支持组(非 admin)GET 403', r2.status === 403, 'status=' + r2.status);
    if (!adminToken) { console.log('SKIP admin 侧用例(无 admin 账号)'); return; }
    // AC-03: GET 响应无明文 key
    const r3 = await raw(adminToken, '/api/admin/config');
    const realKey = (JSON.parse(cfgRaw).LLM_API_KEY || '');
    const bodyStr = JSON.stringify(r3.data || {});
    check('AC-03', 'GET 200 且 key 掩码(不含明文)', r3.status === 200 && !!r3.data.LLM_API_KEY_MASKED && !bodyStr.includes(realKey), (r3.data || {}).LLM_API_KEY_MASKED || '');
    // AC-04: POST 后 REPORT_SECRET 保留 + 指定键更新
    const r4 = await raw(adminToken, '/api/admin/config', 'POST', { LLM_MODEL: 'test-model-t4' });
    const after = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    const before = JSON.parse(cfgRaw);
    check('AC-04', 'POST 更新键+REPORT_SECRET 保留', r4.status === 200 && after.LLM_MODEL === 'test-model-t4' && after.REPORT_SECRET === before.REPORT_SECRET);
    // AC-05: 恢复 MODEL 后对话技能走新配置(桩: LLM_BASE_URL 指本地 9801 桩→修改→chat 降级正常)
    // 简化验证: POST 改 LLM_BASE_URL 为不可达地址→chat degraded=200; 再恢复
    const r5 = await raw(adminToken, '/api/admin/config', 'POST', { LLM_BASE_URL: 'http://127.0.0.1:9' });
    const bid = (await raw(sales, '/api/budget', 'POST', {})).data.id;
    const chat1 = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bid, message: '测试' });
    check('AC-05', '改不可达地址后 chat 降级 200(degraded)', r5.status === 200 && chat1.status === 200 && chat1.data.degraded === true);
    // AC-06: 恢复原始地址后 chat 不降级(指回桩或原值)
    const r6 = await raw(adminToken, '/api/admin/config', 'POST', { LLM_BASE_URL: before.LLM_BASE_URL, LLM_MODEL: before.LLM_MODEL });
    const chat2 = await raw(sales, '/api/agent/chat', 'POST', { budget_id: bid, message: '测试2' });
    check('AC-06', '恢复后 chat 200(真网关可能降级也可接受)', r6.status === 200 && chat2.status === 200);
    // AC-07: 空键提交 400
    const r7 = await raw(adminToken, '/api/admin/config', 'POST', {});
    check('AC-07', '空提交 400', r7.status === 400, 'status=' + r7.status);
    // AC-08: GET 无鉴权 401
    const r8 = await raw(null, '/api/admin/config');
    check('AC-08', '未登录 GET 401', r8.status === 401, 'status=' + r8.status);
  } finally {
    fs.writeFileSync(CFG, cfgRaw, 'utf8'); // 恢复原始字节
    console.log('config.json 已恢复原始字节');
  }
  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
