// Admin 解析器实验室用例: PL-01~08
// 红基线: 旧代码无端点 → 404
// 用法: node tests/test_parser_lab.js [--log=tests/red|green_pl.txt]
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

async function api(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).data.token;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

// 构造含自定义标签的 xlsx(验证调优: 内置映射不认识"预估合同额"→ 调优后命中)
const mkXlsx = (rows, title) => {
  const pyCode = `
import openpyxl, json, sys
rows = json.loads(sys.argv[1])
wb = openpyxl.Workbook()
ws = wb.active
ws.title = sys.argv[2]
for r in rows:
    ws.append(r)
wb.save(sys.argv[3])
`;
  const tmp = path.join(__dirname, '_pl' + Date.now() + '.xlsx');
  const r = spawnSync('python', ['-X', 'utf8', '-c', pyCode, JSON.stringify(rows), title || 'x', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mkXlsx fail');
  return tmp;
};

(async () => {
  const admin = await login('zhichizu');
  const sales = await login('sales1');

  const f8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');

  // PL-01: 权限(普通销售 403)
  const r1 = await api(sales, '/api/admin/parser-lab', 'POST', { filename: 'x.xlsx', type: 'review', data: 'JHg=' });
  check('PL-01', '普通销售 parser-lab 403', r1.status === 403, 'status=' + r1.status);

  // PL-02: 上传真实表 → 对账返回(不落库)
  const r2 = await api(admin, '/api/admin/parser-lab', 'POST', { filename: 'pl8572.xlsx', type: 'review', sheet: '投标决策', data: fs.readFileSync(f8572).toString('base64') });
  const d2 = r2.data || {};
  const known = (d2.audit || []).filter(x => x.key);
  check('PL-02', '支持组上传实测 200+audit 对账返回', r2.status === 200 && known.length >= 10, `known=${known.length} ok=${known.filter(x => x.ok).length}`);
  check('PL-02b', '对账全一致(与 PA 同源)', known.every(x => x.ok), 'bad=' + known.filter(x => !x.ok).length);

  // PL-03: 不落库(评审单数不变)
  const before = (await api(admin, '/api/reviews?scope=all')).data.reviews.length;
  await api(admin, '/api/admin/parser-lab', 'POST', { filename: 'pl8572.xlsx', type: 'review', sheet: '投标决策', data: fs.readFileSync(f8572).toString('base64') });
  const after = (await api(admin, '/api/reviews?scope=all')).data.reviews.length;
  check('PL-03', '实验室不落库(单数不变)', before === after, `${before}→${after}`);

  // PL-04: 调优闭环——自定义标签"预估合同额"默认未采集 → 保存映射 → 应用后命中
  const rows = [['预估合同额', 24], ['客户名称', '调优测试客户']];
  const fx = mkXlsx(rows, '附1-预算表');
  const r4a = await api(admin, '/api/admin/parser-lab', 'POST', { filename: 'tune.xlsx', type: 'budget', data: fs.readFileSync(fx).toString('base64') });
  check('PL-04a', '调优前: 自定义标签未采集 contract', (r4a.data.fields || {}).contract === undefined, 'contract=' + (r4a.data.fields || {}).contract);
  // 保存映射: BUDGET.contract ← ["预估合同额"]
  const r4b = await api(admin, '/api/admin/parser-map', 'POST', { overrides: { BUDGET: { contract: ['预估合同额'] } } });
  check('PL-04b', '保存调优映射 200', r4b.status === 200);
  // 应用映射重解析
  const r4c = await api(admin, '/api/admin/parser-lab', 'POST', { filename: 'tune.xlsx', type: 'budget', use_override: true, data: fs.readFileSync(fx).toString('base64') });
  check('PL-04c', '调优后: contract=24 命中', (r4c.data.fields || {}).contract === 24, 'contract=' + (r4c.data.fields || {}).contract);
  check('PL-04d', 'use_override 标记返回', r4c.data.use_override === true);
  try { fs.unlinkSync(fx); } catch (e) {}

  // PL-05: 映射读取
  const r5 = await api(admin, '/api/admin/parser-map', 'GET');
  check('PL-05', 'GET 映射含已保存的 contract', ((r5.data.overrides || {}).BUDGET || {}).contract && r5.data.overrides.BUDGET.contract[0] === '预估合同额');

  // PL-06: 校验拒绝(非法结构)
  const r6 = await api(admin, '/api/admin/parser-map', 'POST', { overrides: { HACK: { x: ['y'] } } });
  check('PL-06', '非法段名 400', r6.status === 400, 'status=' + r6.status);

  // PL-07: 不应用映射时默认行为(调优不污染默认路径)
  const fy = mkXlsx([['预估合同额', 24], ['客户名称', 'x']], '附1-预算表');
  const r7 = await api(admin, '/api/admin/parser-lab', 'POST', { filename: 't.xlsx', type: 'budget', data: fs.readFileSync(fy).toString('base64') });
  check('PL-07', '未勾选时不应用调优(contract 仍 undefined)', (r7.data.fields || {}).contract === undefined);
  try { fs.unlinkSync(fy); } catch (e) {}

  // PL-08: 清空恢复内置
  const r8 = await api(admin, '/api/admin/parser-map', 'POST', { overrides: {} });
  check('PL-08', '清空调优 200', r8.status === 200);

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
