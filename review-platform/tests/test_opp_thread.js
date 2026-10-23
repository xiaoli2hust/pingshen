// 商机代码贯穿用例: OC-01~06(计划 O5)
// 红基线: 旧代码无 opp_code 列与筛选 -> FAIL
// 用法: node tests/test_opp_thread.js [--log=tests/red|green_oc.txt]
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');

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

(async () => {
  const zhichi = await login('zhichizu');
  const sales = await login('sales1');

  // OC-01: Excel 预算导入(真实 pl8572) → budgets.opp_code
  const f8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');
  const r1 = await api(zhichi, '/api/budget/import', 'POST', { filename: 'PL8572oc.xlsx', data: fs.readFileSync(f8572).toString('base64') });
  const d1 = r1.data || {};
  check('OC-01', 'Excel 预算导入 opp_code 落列=PL00008572', r1.status === 200 && d1.fields && d1.fields.opp_code === 'PL00008572', JSON.stringify(d1.fields && d1.fields.opp_code));
  if (r1.status === 200) {
    const bd = await api(zhichi, '/api/budget/' + d1.id);
    check('OC-01b', 'budgets.opp_code 列=DB 值', (bd.data.budget || {}).opp_code === 'PL00008572', (bd.data.budget || {}).opp_code);
  }

  // OC-02: Excel 评审导入(在线草稿, 真实表) → reviews.opp_code
  const fc02 = path.join(__dirname, 'realdata', '【投标决策】PL00008068-260921-昆山市消防要素可视化分析平台 (1).xlsx');
  const r2 = await api(sales, '/api/reviews/import', 'POST', { filename: 'C02oc.xlsx', type: 'presale', data: fs.readFileSync(fc02).toString('base64') });
  const d2 = r2.data || {};
  check('OC-02', 'Excel 评审导入(在线) opp_code 落列=PL00008068', r2.status === 200 && (d2.form || {}).opp_code === 'PL00008068', (d2.form || {}).opp_code);
  if (r2.status === 200) {
    const rv = (await api(sales, '/api/reviews/' + d2.id)).data.review || {};
    check('OC-02b', 'reviews.opp_code 列=DB 值', rv.opp_code === 'PL00008068', rv.opp_code);
  }

  // OC-02c: history 模式同样落列
  const r2c = await api(zhichi, '/api/reviews/import', 'POST', { filename: 'PL8572hist.xlsx', type: 'bid', mode: 'history', data: fs.readFileSync(f8572).toString('base64') });
  const rv2c = r2c.status === 200 ? ((await api(zhichi, '/api/reviews/' + r2c.data.id)).data.review || {}) : {};
  check('OC-02c', 'history 导入 opp_code 落列', r2c.status === 200 && rv2c.opp_code === 'PL00008572', rv2c.opp_code);

  // OC-03: 表单路径提交 → 落列
  const r3 = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[OC]表单路径商机代码', form: { opp_code: 'PL-OC-0001', customer: '测试客户', biz_line: 'G1', contract_amount: '100', summary: 'OC' }, submit: false });
  const rv3 = r3.status === 200 ? ((await api(sales, '/api/reviews/' + r3.data.id)).data.review || {}) : {};
  check('OC-03', '表单路径 opp_code 落列=PL-OC-0001', r3.status === 200 && rv3.opp_code === 'PL-OC-0001', rv3.opp_code);

  // OC-04: 存量回填(库内已有 form_json.opp_code 的老单列值非空)
  const mineAll = (await api(sales, '/api/reviews?scope=all')).data.reviews || [];
  const withOppForm = mineAll.filter(r => { try { return JSON.parse(r.form_json || '{}').opp_code; } catch (e) { return false; } });
  const backfilled = withOppForm.every(r => r.opp_code === JSON.parse(r.form_json).opp_code);
  check('OC-04', '存量回填(form_json 有 opp_code 的单列值一致)', withOppForm.length >= 1 && backfilled, `n=${withOppForm.length} all=${backfilled}`);

  // OC-05: 列表筛选
  const r5 = await api(sales, '/api/reviews?type=bid&q=PL-OC-0001');
  const d5 = (r5.data.reviews || []);
  check('OC-05a', 'type=bid 筛选只回 bid', r5.status === 200 && d5.length >= 1 && d5.every(x => x.type === 'bid'), 'rows=' + d5.length);
  check('OC-05b', 'q=商机代码模糊命中', d5.some(x => x.opp_code === 'PL-OC-0001'), 'hit=' + d5.some(x => x.opp_code === 'PL-OC-0001'));
  // LIKE 注入安全(% 通配不应全表)
  const r5c = await api(sales, '/api/reviews?q=%25');
  check('OC-05c', 'q=% 被转义为字面量不全表', (r5c.data.reviews || []).length === 0, 'rows=' + (r5c.data.reviews || []).length);

  // OC-06: 预算列表 q 搜索
  const r6 = await api(zhichi, '/api/budget?q=PL00008572');
  check('OC-06', '预算列表 q=PL00008572 命中 opp_code', r6.status === 200 && (r6.data.budgets || []).some(b => b.opp_code === 'PL00008572'), 'rows=' + (r6.data.budgets || []).length);

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
