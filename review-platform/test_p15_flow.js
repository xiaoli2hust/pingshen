// P1.5 互补回归: 预算单关联闭环 + 退回-再提交闭环 (与 test_flow.js 的附件上传路径互补)
// 场景A: 表单粗填毛利率 20%(绿), 关联预算单实算 2.56%(黄) -> 研判必须取 budgets.calc(任务 3.2, 黄灯, reason 标注"取自关联预算单")
// 场景B: presale 单提交后 FDE 退回 -> 状态 returned -> 重新提交 round=2 -> 全部打灯 -> judged
const B = 'http://127.0.0.1:8600';
async function api(token, path, method, body) {
  const r = await fetch(B + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(path + ' -> ' + (d.error || r.status));
  return d;
}
const login = async u => (await api('', '/api/login', 'POST', { username: u, password: '123456' })).token;

(async () => {
  const sales = await login('sales1');
  const fde = await login('fde1');
  const fin = await login('fin1');
  const comp = await login('comp1');
  const pur = await login('pur1');
  let pass = 0, fail = 0;
  const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name); ok ? pass++ : fail++; };

  // ---- 场景A: 预算单关联闭环(阶段3 演进, 任务 3.1/3.2) ----
  const form = {
    customer: '预算闭环测试客户', biz_line: 'G1', contract_amount: '100',
    gross_margin: '20', ops_years: '1',
    sign_path: '丰图科技(深圳)有限公司', // 1 层 0 转包
    sub_amount: '0', designated_sub_amount: '0', survey_sub_amount: '0',
    survey: '否', secret: '否', settle_method: '银行转账',
    payment_terms: '预付30%,验收后70%', summary: '预算单关联闭环回归',
    guarantee: '否', non_compete: '否', data_review: '否'
  };
  // A0: 建锁预算单(合同100万×交付处400天×1696 -> 贡献毛利率≈2.57%, inputs 同源禁止手拍)
  const inputs = { contract: 1000000, sub_cost: 0, sw_outsource: 0, flex_labor: 0, sales_labor: '', sales_travel: 0, sales_entertain: 0, sales_marketing: 0, dev_dept: '交付处', dev_pd: 400, prod_pd: 0, rd_outsource: 0, del_travel: 0, pm_cost: 0, del_other: 0 };
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: '场景A-预算单' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: inputs });
  await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: '场景A明细(附3递进门禁)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
  await api(sales, `/api/budget/${bg}/lock`, 'POST');
  const a = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '场景A-预算单关联闭环', form, submit: false, budget_id: bg });

  // A1: 无预算表且无关联的 bid 单提交被拦(原回归点保留) + 关联落库断言
  const bare = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '场景A-无预算拦截对照', form, submit: false });
  let blocked = false;
  try { await api(sales, `/api/reviews/${bare.id}/submit`, 'POST'); } catch (e) { blocked = /预算表/.test(e.message); }
  check('A1 无预算表无关联提交被拦截', blocked);
  check('A1 建单即关联预算单(budget_id 落库)', (await api(sales, `/api/reviews/${a.id}`)).review.budget_id === bg);

  // A2: 预算单服务端实算(任务 3.2 研判取数源): margin≈2.57
  const bgd = await api(sales, `/api/budget/${bg}`);
  const m0 = ((bgd.budget || {}).calc || {}).margin;
  check('A2 预算单实算 margin≈2.57(交付处×1696, dev_dept 模型)', typeof m0 === 'number' && m0 > 2.4 && m0 < 2.7);

  // A3: 关联锁定预算单即可提交(无需附件, 任务 3.1 门禁)
  const sub = await api(sales, `/api/reviews/${a.id}/submit`, 'POST');
  check('A3 关联锁定预算单可提交(轮次=' + sub.round + ')', sub.round === 1);

  // A4: 全部门打绿
  const doAll = async (token, name) => {
    const ts = (await api(token, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === a.id);
    for (const t of ts) await api(token, `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
    return ts.length;
  };
  await doAll(pur, '采购'); await doAll(fde, 'FDE'); await doAll(fin, '财务');
  await doAll(await login('legal1'), '法务'); await doAll(comp, '合规'); await doAll(await login('data1'), '数据');

  // A5: 研判结果(任务 3.2: margin 取 budgets.calc 而非表单粗填 20%)
  const da = await api(sales, `/api/reviews/${a.id}`);
  const detailA = JSON.parse(da.review.judge_detail || '[]');
  const gmItem = detailA.find(i => i.name === '贡献利润');
  check('A5 综合灯态=黄(由预算单实算毛利率触发, 而非表单粗填20%)', da.review.light === 'yellow');
  check('A6 贡献利润判黄且标注"取自关联预算单"', !!(gmItem && gmItem.level === 'yellow' && /取自关联预算单/.test(gmItem.reason || '')));

  // ---- 场景B: 退回-再提交闭环(T3 口径: presale 也需关联锁定预算单) ----
  const formB = {
    customer: '退回闭环测试客户', biz_line: 'G1', contract_amount: '30',
    sign_date: String(new Date().getFullYear()) + '-12-31',
    survey: '否', sub_early_flag: '否', presale_invest: '1', presale_period: '2', summary: '退回闭环回归'
  };
  const bgB = (await api(sales, '/api/budget', 'POST', { project_name: '场景B-预算单' })).id;
  await api(sales, `/api/budget/${bgB}`, 'PUT', { fields: { contract: 300000, sub_cost: 0, dev_dept: '交付处', dev_pd: 30, del_travel: 0 } });
  await api(sales, `/api/budget/${bgB}/delivery`, 'PUT', { rows: [{ content: '场景B明细', pm_pd: 1, own_pd: 1, prod_pd: 1 }] });
  await api(sales, `/api/budget/${bgB}/lock`, 'POST');
  const b = await api(sales, '/api/reviews', 'POST', { type: 'presale', title: '场景B-退回再提交', form: formB, submit: false, budget_id: bgB });
  await api(sales, `/api/reviews/${b.id}/attachments`, 'POST', { field: '项目预算表', filename: 'b.xlsx', data: Buffer.from('x').toString('base64') });
  await api(sales, `/api/reviews/${b.id}/submit`, 'POST');

  // B1: FDE 退回
  const fdeTasks = (await api(fde, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === b.id);
  const ret = fdeTasks[0];
  await api(fde, `/api/tasks/${ret.id}/return`, 'POST', { opinion: '技术方案不明确, 请补充POC结论' });
  const db1 = await api(sales, `/api/reviews/${b.id}`);
  check('B1 退回后状态=returned', db1.review.status === 'returned');

  // B2: 修改后重新提交 -> round=2
  await api(sales, `/api/reviews/${b.id}`, 'PUT', { title: '场景B-退回再提交(已补充)', form: { ...formB, summary: '已补充技术方案说明' } });
  const sub2 = await api(sales, `/api/reviews/${b.id}/submit`, 'POST');
  check('B2 重新提交后轮次=2', sub2.round === 2);

  // B3: 第二轮任务全部完成 -> 自动研判
  const finish = async (token) => {
    const ts = (await api(token, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === b.id && t.round === 2);
    for (const t of ts) await api(token, `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
  };
  await finish(fde); await finish(fin); await finish(comp); await finish(pur);
  const db2 = await api(sales, `/api/reviews/${b.id}`);
  const tasksB = db2.tasks.filter(t => t.round === 1);
  check('B3 二轮完成后自动研判(judged, 绿灯)', db2.review.status === 'judged' && db2.review.light === 'green');
  check('B4 第一轮旧任务已作废留痕', tasksB.length > 0 && tasksB.every(t => ['cancelled', 'returned'].includes(t.status)));

  console.log(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
