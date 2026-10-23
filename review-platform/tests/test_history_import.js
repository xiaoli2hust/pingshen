// 历史数据承接用例: HI-01~06(docs/历史数据承接方案.md §四 + 实施计划 H6)
// 红基线: 旧代码无 mode 参数 -> history 行为缺失 FAIL
// 用法: node tests/test_history_import.js [--log=tests/red|green_hi.txt]
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

// 构造 2024 老模板 xlsx: 只有附1-预算表 sheet(无信息收集) + 键值对 + 评审结论/日期
const mkXlsx = rows => {
  const pyCode = `
import openpyxl, json, sys
rows = json.loads(sys.argv[1])
wb = openpyxl.Workbook()
ws = wb.active
ws.title = '附1-预算表'
for r in rows:
    ws.append(r)
wb.save(sys.argv[2])
`;
  const tmp = path.join(__dirname, '_hi' + Date.now() + '.xlsx');
  const r = spawnSync('python', ['-X', 'utf8', '-c', pyCode, JSON.stringify(rows), tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mkXlsx fail: ' + r.stderr);
  return tmp;
};

(async () => {
  const zhichi = await login('zhichizu'); // 支持组
  const sales = await login('sales1'); // 普通销售

  const rows = [
    ['项目名称', '2024 年天地图历史项目'], ['客户名称', '江西省自然资源测绘与监测院'],
    ['合同金额', 240000], ['分包采购成本', 0], ['所属部门', '交付处'],
    ['评审结论', '同意通过'], ['评审日期', '2024-05-12'],
  ];
  const f = mkXlsx(rows);
  const data = fs.readFileSync(f).toString('base64');

  // HI-01: 支持组 history 导入 → 200 直入归档
  const r1 = await api(zhichi, '/api/reviews/import', 'POST', { filename: '2024年历史项目评审表.xlsx', type: 'bid', mode: 'history', data });
  const d1 = r1.data || {};
  check('HI-01', '支持组历史导入 200 + era=history + status=archived', r1.status === 200 && d1.era === 'history' && d1.status === 'archived', JSON.stringify({ status: r1.status, era: d1.era, st: d1.status }));

  // HI-02: 逐字段落位(light/decision/archived_at)
  check('HI-02a', 'light=none(不补判)', d1.light === 'none', 'light=' + d1.light);
  check('HI-02b', 'decision=通过(解析评审结论)', d1.decision === '通过', 'decision=' + d1.decision);
  check('HI-02c', 'archived_at=2024-05-12(业务时间=评审日期)', d1.archived_at === '2024-05-12', 'archived_at=' + d1.archived_at);

  // 落库验证
  const det = await api(zhichi, '/api/reviews/' + d1.id);
  const rv = det.data.review || {};
  check('HI-02d', '落库 era/light/judge_detail 元数据', rv.era === 'history' && rv.light === 'none' && /历史单据/.test(JSON.stringify(rv.judge_detail)));
  check('HI-02e', '原件自动挂附件(历史评审表原件)', (det.data.attachments || []).some(a => a.field === '历史评审表原件'));
  check('HI-02f', 'events 首条=历史数据导入', (det.data.events || []).some(e => e.action === '历史数据导入'));

  // HI-03: 普通销售 403
  const r3 = await api(sales, '/api/reviews/import', 'POST', { filename: 'x.xlsx', type: 'bid', mode: 'history', data });
  check('HI-03', '普通销售补录历史 403', r3.status === 403, 'status=' + r3.status);

  // HI-04: 过程界面排除(mine/all 不含历史, archived 含)
  const mine = (await api(sales, '/api/reviews?scope=mine')).data.reviews || [];
  const all = (await api(zhichi, '/api/reviews?scope=all')).data.reviews || [];
  const arch = (await api(zhichi, '/api/reviews?scope=archived')).data.reviews || [];
  check('HI-04a', 'scope=mine 不含历史单', !mine.some(r => r.era === 'history'));
  check('HI-04b', 'scope=all 不含历史单', !all.some(r => r.era === 'history'));
  check('HI-04c', 'scope=archived 含历史单', arch.some(r => r.era === 'history' && r.id === d1.id));

  // HI-05: BI 四档+双口径
  const st = (await api(zhichi, '/api/reviews/archive-stats')).data;
  const s = st || {};
  check('HI-05a', 'light 分布有 none 档(历史未评)', (s.light || {}).none >= 1, 'none=' + ((s.light || {}).none));
  check('HI-05b', 'kpi.historyTotal>=1 + historyPassRate 命中', (s.kpi || {}).historyTotal >= 1 && (s.kpi || {}).historyPassRate > 0, 'historyTotal=' + ((s.kpi || {}).historyTotal) + ' passRate=' + ((s.kpi || {}).historyPassRate));
  check('HI-05c', 'kpi.greenRate 分母=在线单(不被历史污染)', (s.kpi || {}).online === ((s.kpi || {}).total || 0) - ((s.kpi || {}).historyTotal || 0));
  check('HI-05d', 'years 年度分布含 2024', (s.years || []).some(y => y.y === '2024'), JSON.stringify(s.years || []));

  // HI-06: 真实老模板对照(realdata 三表之一, history 模式不炸)
  const realFile = path.join(__dirname, 'realdata', '【投标决策】PL00008111-坪山区三维数据更新2026项目评审（20260810).xlsx');
  const r6 = await api(zhichi, '/api/reviews/import', 'POST', { filename: 'PL00008111历史.xlsx', type: 'bid', mode: 'history', data: fs.readFileSync(realFile).toString('base64') });
  check('HI-06', '真实表 history 模式导入不炸(200+archived)', r6.status === 200 && (r6.data || {}).era === 'history', 'status=' + r6.status + ' matched=' + (((r6.data || {}).meta || {}).matched));

  try { fs.unlinkSync(f); } catch (e) {}

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
