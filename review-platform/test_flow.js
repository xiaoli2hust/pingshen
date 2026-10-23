// 端到端冒烟(真实案例复刻): 江西省天地图POI数据服务项目
// 期望: 毛利率5.52%黄 + 转包3次黄, 其余绿 -> 综合黄灯-部门级(不触发XO), 与真实评审结论一致
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
async function login(u) { return (await api('', '/api/login', 'POST', { username: u, password: '123456' })).token; }

(async () => {
  const sales = await login('sales1');
  const fin = await login('fin1');
  const legal = await login('legal1');
  const fde = await login('fde1');
  const pur = await login('pur1');
  const comp = await login('comp1');
  const data = await login('data1');
  const admin = await login('zhichizu');

  // 0) 阶段3 演进(任务 3.1): bid 提交必填锁定预算单——按 PL00008572 真实预算 fixture 建锁预算单再关联
  //    (margin 5.52 与表单 gross_margin 同源, 判灯断言不变; inputs 全部来自真实原件逐行提取, 禁止手拍)
  const pl8572 = require('./tests/fixtures/pl8572.json');
  const { _meta, ...plBudgetFields } = pl8572;
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: '江西省天地图POI数据服务项目-预算' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: plBudgetFields });
  // 附3 递进门禁: 附1 同源明细(实施 PM5+正磑39+生产184, 运维 PM2)
  await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [
    { content: '南昌市POI数据', stage: '实施', pm_pd: 5, own_pd: 39, prod_pd: 184 },
    { content: '南昌市POI数据', stage: '运维', pm_pd: 2 }
  ] });
  await api(sales, `/api/budget/${bg}/lock`, 'POST');
  console.log('0) 已建锁预算单 id=' + bg + '(PL00008572 真实预算 fixture)');

  // 1) 存草稿(真实案例数据, 关联锁定预算单)
  const form = {
    opp_code: 'PL00008572', opp_stage: '投标决策', region: '华北营销处-渠道',
    customer: '江西省自然资源测绘与监测院', biz_line: 'G1', contract_amount: '24',
    sales: '王超', pm: '冯金华', sign_date: '2026-10-30', gross_margin: '5.52',
    cost_happened: '0', ops_years: '1',
    sign_path: '江西省自然资源测绘与监测院→易智瑞信息技术有限公司→航天云际时空信息技术(重庆)有限公司→丰图科技(深圳)有限公司',
    sub_amount: '0', designated_sub_amount: '0', survey_sub_amount: '0', sub_core: '否',
    survey: '否', jiadao: '否', secret: '否', province: '江西省', product_type: '非标品',
    promo_target: '无', promo_amount: '0', settle_method: '银行转账',
    payback_time: '预计26年Q4回款40%,27年Q2回款60%', b2b_scene: '回款+验收=全部背靠背',
    revenue_confirm: '一次性确收,预计27年Q1确收',
    payment_terms: '首付款40%,数据交付验收后付60%',
    guarantee: '否', non_compete: '否', sub_limit: '否',
    summary: '提供江西省全省范围POI原始数据,覆盖11个市100个县区,数据量不低于220万。',
    data_review: '是', data_plan: '提供江西全省POI数据,4个地市按12大类映射,7个地市按6大类映射,不涉及运单数据或敏感数据。',
    data_content: 'POI数据:唯一ID、名称、坐标、地址、大类、中类、小类、类型编号',
    data_compliance: '只提供POI名称、地址、坐标、分类,不涉及原始数据或涉密数据'
  };
  const created = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '江西省天地图POI数据服务项目', form, submit: false, budget_id: bg });
  const rid = created.id;
  console.log('1) 草稿已建 id=' + rid + '(关联预算单 ' + bg + ')');

  // 2) 对照: 无附件无在线预算且无关联的 bid 单提交被拦(原回归点); 本单已关联锁定预算单可直接提交
  //    阶段3 演进(任务 3.1 门禁): 关联锁定预算单亦视为预算已提供
  const bare = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '对照-无预算拦截', form, submit: false });
  let blocked = false;
  try { await api(sales, `/api/reviews/${bare.id}/submit`, 'POST'); } catch (e) { blocked = /预算表/.test(e.message); }
  console.log('2) 无预算无关联提交被拦截: ' + (blocked ? 'PASS' : 'FAIL'));

  // 3) 上传预算表附件 -> 提交
  await api(sales, `/api/reviews/${rid}/attachments`, 'POST', {
    field: '项目预算表', filename: '项目贡献毛利率及成本预算表.xlsx',
    data: Buffer.from('demo budget file').toString('base64')
  });
  await api(sales, `/api/reviews/${rid}/submit`, 'POST');
  console.log('3) 上传预算表后提交成功,任务已分发');

  // 4) 各部门前置评审(按真实案例: 全部绿灯+意见; 法务含风险提示意见但判绿)
  const doAll = async (token, name, opinions) => {
    const ts = (await api(token, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
    for (const t of ts) await api(token, `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: (opinions && opinions[t.ind_key]) || '' });
    console.log('4) ' + name + ' 完成 ' + ts.length + ' 项');
  };
  await doAll(pur, '采购BP', { sub_reason: '项目无分包' });
  await doAll(fde, 'FDE', { tech: '同意' });
  await doAll(fin, '财务BP', { arrears: '客户无欠款', payment: '贡毛>0%,首付款40%验收后60%,回款风险较低' });
  await doAll(legal, '法务', { upstream: '总集易智瑞近期有被执行记录(2026-08-02,111.28万),客情较好总体可控,注意把控回款', subcontract_limit: '数据直接交付至最终客户' });
  await doAll(comp, '合规BP', { compliance: '不涉及保密资质,坐标降低精度提供,数据加密直传最终客户' });
  const dataTasks = (await api(data, '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
  for (const t of dataTasks) await api(data, `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '后续出货需邮件抄送上级、业务部门数据对接人、数据部门及CTO报备' });
  console.log('4) 数据BP 完成 ' + dataTasks.length + ' 项(应触发自动研判)');

  // 5) 校验研判结果 == 真实结论(黄灯-部门级,不触发XO)
  //    阶段3: margin 改自 budgets.calc(任务 3.2 三级优先), 5.52 同源不变
  const d = await api(sales, `/api/reviews/${rid}`);
  const rv = d.review;
  const detail = JSON.parse(rv.judge_detail || '[]');
  const yellows = detail.filter(i => i.level === 'yellow').map(i => i.name);
  console.log('5) 状态=' + rv.status + ' 灯态=' + rv.light);
  console.log('   黄灯指标: ' + yellows.join('、'));
  console.log('   路径: ' + rv.route);
  const ok = rv.light === 'yellow' && yellows.length === 2 && !rv.route.includes('XO') && !rv.route.includes('杜总');
  console.log('   与真实评审结论一致(黄灯-部门级,2项黄灯,无XO): ' + (ok ? 'PASS' : 'FAIL'));

  // 6) 报告 HTML 可访问且含关键区块(任务1.5 收紧鉴权后需登录态)
  const html = await (await fetch(`${B}/api/reports/${rid}.html`, { headers: { Authorization: 'Bearer ' + sales } })).text();
  const htmlOk = html.includes('丰图科技 · 项目风险评估报告') && html.includes('会议准备') && html.includes('前置评审意见汇总') && html.includes('汇报准备') && html.includes('签约转包次数');
  console.log('6) 正式报告 HTML 生成: ' + (htmlOk ? 'PASS' : 'FAIL'));

  // 7) 归档
  await api(admin, `/api/reviews/${rid}/archive`, 'POST');
  console.log('7) 归档: PASS');
  console.log(ok && blocked && htmlOk ? 'ALL PASS' : 'SOME FAIL');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
