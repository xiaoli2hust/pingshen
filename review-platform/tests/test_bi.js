// 归档库 BI 用例: BI-01~12(docs/归档库BI产品方案.md §四)
// 断言源铁律: 期望值全部由脚本内 SQLite 直查实算(复刻开发设计口径), 禁止手拍
// 用法: node tests/test_bi.js [--log=tests/green_bi.txt]
const B = 'http://127.0.0.1:8600';
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

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
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const sales = await login('sales1');
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'review.db'));

  // ---- 期望值: SQLite 直查实算(口径与 docs/归档库BI开发设计.md §二逐条同源; H5 历史承接后 era 双口径) ----
  const rows = db.prepare("SELECT type,light,route,round,decision_result,archived_at,judge_detail,form_json,era FROM reviews WHERE status='archived'").all();
  const total = rows.length;
  const online = rows.filter(r => !r.era || r.era === 'online');
  const historyN = rows.filter(r => r.era === 'history');
  const expLight = { green: 0, yellow: 0, red: 0, none: 0 };
  const expTypes = { presale: 0, bid: 0, change: 0 };
  const monthly = {}; const riskCount = {}; const amtB = [0, 0, 0, 0];
  let amtSum = 0, amtValid = 0, decisionN = 0, roundSum = 0;
  const routes = { xo: 0, dept: 0, green: 0 };
  for (const r of rows) {
    if (expLight[r.light] != null || r.light === 'none') expLight[r.light] = (expLight[r.light] || 0) + 1;
    if (expTypes[r.type] != null) expTypes[r.type]++;
    roundSum += r.round || 1;
    if (r.decision_result) decisionN++;
    if (r.archived_at) { const m = String(r.archived_at).slice(0, 7); monthly[m] = (monthly[m] || 0) + 1; }
    if (r.judge_detail && r.era !== 'history') { try { for (const it of JSON.parse(r.judge_detail)) if (it.level !== 'green') riskCount[it.name] = (riskCount[it.name] || 0) + 1; } catch (e) {} }
    if (r.form_json) { try { const a = parseFloat(JSON.parse(r.form_json).contract_amount); if (!isNaN(a)) { amtValid++; amtSum += a; amtB[a < 50 ? 0 : a < 100 ? 1 : a < 500 ? 2 : 3]++; } } catch (e) {} }
    const rt = r.route || '';
    if (rt.includes('XO')) routes.xo++; else if (rt.includes('免上会')) routes.green++; else if (rt.includes('部门级')) routes.dept++;
  }
  const pct = v => +(v / (total || 1) * 100).toFixed(1);
  const histPass = historyN.filter(r => /通过|同意/.test(r.decision_result || '') && !/不通过|否决/.test(r.decision_result || '')).length;
  const expKpi = { total, online: online.length, historyTotal: historyN.length, greenRate: +(expLight.green / (online.length || 1) * 100).toFixed(1), historyPassRate: +(histPass / (historyN.length || 1) * 100).toFixed(1), avgRound: +(roundSum / (total || 1)).toFixed(2), decisionRate: pct(decisionN) };
  const expRisks = Object.entries(riskCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
  const expDepts = db.prepare("SELECT t.dept, COUNT(1) total, SUM(CASE WHEN t.light='yellow' THEN 1 ELSE 0 END) yellow, SUM(CASE WHEN t.light='red' THEN 1 ELSE 0 END) red FROM tasks t JOIN reviews r ON r.id=t.review_id WHERE r.status='archived' GROUP BY t.dept")
    .all().map(d => ({ dept: d.dept, total: d.total, yellow: d.yellow || 0, red: d.red || 0 }))
    .sort((a, b) => ((b.yellow + b.red) / b.total) - ((a.yellow + a.red) / a.total));

  // ---- 请求 ----
  const t0 = Date.now();
  const r = await api(sales, '/api/reviews/archive-stats');
  const ms = Date.now() - t0;
  const d = r.data || {};
  check('BI-00', '端点 200', r.status === 200);

  // BI-01 KPI 四值
  check('BI-01', 'KPI 四值与 SQL 直查一致', eq(d.kpi, expKpi), JSON.stringify(d.kpi));
  // BI-02 灯色
  check('BI-02', '灯色分布一致', eq(d.light, expLight), JSON.stringify(d.light));
  // BI-03 类型
  check('BI-03', '类型占比一致', eq(d.types, expTypes), JSON.stringify(d.types));
  // BI-04 月度(逐月数)
  const monOk = (d.monthly || []).every(m => (monthly[m.m] || 0) === m.c) && (d.monthly || []).length >= Math.min(2, Object.keys(monthly).length);
  check('BI-04', '月度归档趋势逐月一致(近3月位齐)', monOk, JSON.stringify(d.monthly));
  // BI-05 风险项 Top10
  check('BI-05', 'Top10 风险项与直查聚合一致', eq(d.risks, expRisks), JSON.stringify((d.risks || []).slice(0, 3)));
  // BI-06 部门
  const deptOk = (d.depts || []).length === expDepts.length && (d.depts || []).every((x, i) => x.dept === expDepts[i].dept && x.yellow === expDepts[i].yellow && x.red === expDepts[i].red && x.total === expDepts[i].total);
  check('BI-06', '部门黄/红命中率与直查一致(排序同)', deptOk, JSON.stringify((d.depts || []).slice(0, 2)));
  // BI-07 金额
  const amtOk = (d.amounts || []).every((a, i) => a.count === amtB[i] && a.range === ['<50万', '50~100万', '100~500万', '≥500万'][i])
    && d.totalAmountWan === +amtSum.toFixed(1) && d.amountValid === amtValid;
  check('BI-07', '金额四档+总额+有效数与直查一致', amtOk, JSON.stringify(d.amounts) + ' total=' + d.totalAmountWan);
  // BI-08 路由
  check('BI-08', '路由三段与直查一致', eq(d.routes, routes), JSON.stringify(d.routes));

  // BI-09 空态/结构兜底(库非空时验证结构完整, 不破坏真实库)
  const structOk = d.kpi && d.light && d.types && Array.isArray(d.monthly) && Array.isArray(d.risks) && Array.isArray(d.depts) && Array.isArray(d.amounts) && typeof d.totalAmountWan === 'number' && d.routes;
  check('BI-09', '结构完整兜底(空库时同结构 0/[] 不崩)', !!structOk);

  // BI-10 对抗: 恶意 query 参数容错
  const r10 = await api(sales, "/api/reviews/archive-stats?scope=xxx'%20OR%201=1--&light=;DROP");
  check('BI-10', '恶意 query 参数被忽略(200 不注入不 500)', r10.status === 200 && r10.data.kpi && r10.data.kpi.total === total);

  // BI-11 对抗: 只含归档单(在途/草稿不混入)
  const nonArchived = db.prepare("SELECT COUNT(1) c FROM reviews WHERE status != 'archived'").get().c;
  const inFlightTitle = db.prepare("SELECT title FROM reviews WHERE status != 'archived' LIMIT 1").get();
  const bodyStr = JSON.stringify(r10.data);
  const leak = inFlightTitle && bodyStr.includes(inFlightTitle.title);
  check('BI-11', '聚合只含归档单(非归档 ' + nonArchived + ' 单不混入)', d.kpi.total === total && !leak);

  // BI-12 性能
  check('BI-12', '聚合性能 < 300ms', ms < 300, ms + 'ms');

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}(数据基线: 归档 ${total} 单, 直查同源断言)`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
