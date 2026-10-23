// T3 门禁口径扩展用例: presale 无 budget_id 提交 -> 400; 带 locked budget_id -> 200
// 用法: node tests/test_gate_presale.js [--log=tests/red|green_t3.txt]
// 红基线: 旧代码(BUDGET_REQUIRED_TYPES=['bid'])对 presale 放行 -> 本用例 FAIL
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

(async () => {
  const sales = await login('sales1');
  const FORM = {
    customer: '门禁口径客户', biz_line: 'G1', contract_amount: '100',
    sign_date: '2026-12-31', survey: '否', sub_early_flag: '否',
    presale_invest: '1', presale_period: '2', summary: 'T3 口径用例'
  };
  // 建锁预算单(附3 递进门禁: 先 PUT delivery)
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: 'T3 口径预算' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: { contract: 1000000, sub_cost: 100000, dev_dept: '交付处', dev_pd: 100, del_travel: 5000 } });
  await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'T3 明细', pm_pd: 1, own_pd: 1, prod_pd: 2 }] });
  await api(sales, `/api/budget/${bg}/lock`, 'POST');

  // 用例 1: presale 无 budget_id 提交 -> 应 400(新口径)
  const r1 = (await api(sales, '/api/reviews', 'POST', { type: 'presale', title: '[T]T3-无预算售前', form: FORM, submit: false })).id;
  await api(sales, `/api/reviews/${r1}/attachments`, 'POST', { field: '项目预算表', filename: 't3.xlsx', data: Buffer.from('x').toString('base64') });
  const s1 = await raw(sales, `/api/reviews/${r1}/submit`, 'POST');
  check('T3-01', 'presale 无 budget_id 提交被拦 400', s1.status === 400 && /必须关联已锁定的预算单/.test(s1.data.error || ''), 'status=' + s1.status);

  // 用例 2: presale 带 locked budget_id -> 200
  const r2 = (await api(sales, '/api/reviews', 'POST', { type: 'presale', title: '[T]T3-带预算售前', form: FORM, submit: false, budget_id: bg })).id;
  await api(sales, `/api/reviews/${r2}/attachments`, 'POST', { field: '项目预算表', filename: 't3b.xlsx', data: Buffer.from('x').toString('base64') });
  const s2 = await raw(sales, `/api/reviews/${r2}/submit`, 'POST');
  check('T3-02', 'presale 带 locked budget_id 提交 200', s2.status === 200, 'status=' + s2.status);

  // 用例 3: change 可选关联不受影响(无 budget_id 提交 200)
  const r3 = (await api(sales, '/api/reviews', 'POST', { type: 'change', title: '[T]T3-变更单', form: { proj_code: 'PRJ-T3', biz_line: 'G1' /* V4.0-T4 D-1: change 提交 req 集含 biz_line, 原合成载荷缺该键被必填门 400; 只补字段不改本用例断言(验的是 change 可选关联预算), 回退=删本键 */, proj_stage: '实施中', change_type: '合同变更', old_contract_amount: '100', old_gross_margin: '15', new_contract_amount: '100', new_gross_margin: '15', old_sub_amount: '0', new_sub_amount: '0', old_delivery_cost: '50', new_delivery_cost: '55', old_sales_cost: '10', new_sales_cost: '10', over_pay: '否', path_change: '否', delivery_change: '否', summary: 'T3' }, submit: false })).id;
  await api(sales, `/api/reviews/${r3}/attachments`, 'POST', { field: '项目预算表', filename: 't3c.xlsx', data: Buffer.from('x').toString('base64') });
  const s3 = await raw(sales, `/api/reviews/${r3}/submit`, 'POST');
  check('T3-03', 'change 无关联提交不受影响(200)', s3.status === 200, 'status=' + s3.status);

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
