// 阶段 3 规则矩阵: R-01~R-34 preview-light 批量化(任务 3.5, 秒级/条) + R-31/S-06 红灯闭环 + SEC 专项(全流程)
// 用法: 服务运行中, node tests/test_rules_e2e.js [--log=tests/green_stage3_rules.txt]
// 阶段 3 演进: 常规 34 条改 GET /api/reviews/:id/preview-light dry-run(建 draft 即测, 不提交不打灯);
//   闭环/SEC 走全流程提交, 按任务 3.1(bid 必填)先建锁预算单关联再提交
// 红绿纪律: ★red 标记的用例(R-01/04/18/19/20/31/32/34)中, 常规条在阶段 3 旧代码上必 FAIL(preview-light 404);
//   红证据留 tests/red_evidence_stage3.txt, 改造后 PASS(绿证据)
// 测试单带 [T] 前缀; preview-light 的 draft 单不出流程留库, judged 归档, 红灯 returned 留库走 R-31 闭环
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

// ---------- 三类型全绿基线 ----------
const BASES = {
  bid: {
    opp_code: 'PL-T-RM', opp_stage: '投标决策', region: '华北营销处-渠道',
    customer: '规则矩阵基线客户', biz_line: 'G1', contract_amount: '24',
    sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15',
    cost_happened: '0', ops_years: '1',
    sign_path: '客户公司→丰图科技(深圳)有限公司',
    sub_amount: '0', designated_sub_amount: '0', survey_sub_amount: '0', sub_core: '否',
    survey: '否', jiadao: '否', secret: '否', province: '江西省', product_type: '标品',
    promo_target: '无', promo_amount: '0', settle_method: '银行转账',
    payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
    payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
    summary: '规则矩阵基线', data_review: '是', data_plan: '公开POI数据',
    data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
  },
  presale: {
    customer: '售前基线客户', biz_line: 'G1', contract_amount: '100',
    sign_date: '2026-12-31', survey: '否', sub_early_flag: '否',
    presale_invest: '1', presale_period: '2', summary: '售前基线'
  },
  change: {
    proj_code: 'PRJ-T-RM', proj_stage: '实施中', change_type: '合同变更',
    old_contract_amount: '100', old_gross_margin: '15',
    new_contract_amount: '100', new_gross_margin: '15',
    old_sub_amount: '0', new_sub_amount: '0',
    old_delivery_cost: '50', new_delivery_cost: '55',
    old_sales_cost: '10', new_sales_cost: '10',
    over_pay: '否', path_change: '否', delivery_change: '否', summary: '变更基线'
  }
};
const DEPTS = {
  bid: ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'],
  presale: ['fde1', 'comp1', 'pur1', 'fin1'],
  change: ['fde1', 'pur1', 'legal1', 'fin1']
};
// 阶段 3 闭环/SEC 基线预算(18 字段白名单内, margin≈41.9 绿; 技能②带入同源)
const GREEN_BUDGET = {
  contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000,
  project_name: '规则矩阵基线预算', customer: '规则矩阵基线客户'
};
const makeLockedBudget = async (token, name) => {
  const id = (await api(token, '/api/budget', 'POST', { project_name: name })).id;
  await api(token, `/api/budget/${id}`, 'PUT', { fields: GREEN_BUDGET });
  await api(token, `/api/budget/${id}/delivery`, 'PUT', { rows: [{ content: '回归明细(附3递进门禁)', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
  await api(token, `/api/budget/${id}/lock`, 'POST');
  return id;
};

// ---------- 用例表(期望=新代码行为; red: true 的用例在旧代码上必 FAIL) ----------
const CASES = [
  // ---- bid: 分包/测绘 ----
  { id: 'R-01', red: true, patch: { contract_amount: '100', sub_amount: '75' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['分包占比'], itemReason: [['分包占比', '过单']] } },
  { id: 'R-02', patch: { contract_amount: '100', sub_amount: '50' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['分包占比'] } },
  { id: 'R-03', patch: { contract_amount: '100', sub_amount: '20' },
    expect: { light: 'green', routeIncludes: ['免上会'], noYellowNames: ['分包占比'] } },
  { id: 'R-04', red: true, patch: { contract_amount: '100', sub_amount: '0', survey_sub_amount: '50', province: '广东省' },
    expect: { light: 'red', routeIncludes: ['打回'], redNames: ['测绘类分包占比'], itemReason: [['测绘类分包占比', '广东']] } },
  { id: 'R-05', patch: { contract_amount: '100', sub_amount: '0', survey_sub_amount: '50', province: '江西省' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['测绘类分包占比'] } },
  // ---- bid: 财务/合同 ----
  { id: 'R-06', patch: { gross_margin: '-5' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['贡献利润'], itemReason: [['贡献利润', '负毛利']] } },
  { id: 'R-07', patch: { gross_margin: '5.52' },
    expect: { light: 'yellow', routeIncludes: ['部门级'], routeExcludes: ['XO'], yellowNames: ['贡献利润'] } },
  { id: 'R-08', patch: { gross_margin: '15' },
    expect: { light: 'green', routeIncludes: ['免上会'] } },
  { id: 'R-09', patch: { contract_amount: '600' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['合同金额'] } },
  { id: 'R-10', patch: { ops_years: '5' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['项目运维周期'] } },
  // ---- bid: 指定/转包/担保/竞业/结算 ----
  { id: 'R-11', patch: { designated_sub_amount: '10' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['指定供应商'] } },
  { id: 'R-12', patch: { sign_path: 'A公司→B公司→C公司→D公司→E公司→F公司→G公司' },
    expect: { light: 'red', routeIncludes: ['打回'], redNames: ['签约转包次数'] } },
  { id: 'R-13', patch: { sign_path: 'A公司→B公司→C公司→D公司' },
    expect: { light: 'yellow', routeIncludes: ['部门级'], routeExcludes: ['XO'], yellowNames: ['签约转包次数'] } },
  { id: 'R-14', patch: { guarantee: '是' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['合同担保'] } },
  { id: 'R-15', patch: { non_compete: '是' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['竞业'] } },
  { id: 'R-16', patch: { settle_method: '商业承兑汇票' },
    expect: { light: 'red', routeIncludes: ['打回'], redNames: ['结算方式'] } },
  { id: 'R-17', patch: { settle_method: '超3个月银行承兑汇票' },
    expect: { light: 'yellow', routeIncludes: ['部门级'], routeExcludes: ['XO'], yellowNames: ['结算方式'] } },
  // ---- bid: XO-10/11 推广激励(任务1.1) ----
  { id: 'R-18', red: true, patch: { contract_amount: '100', sub_amount: '0', promo_target: '外部', promo_amount: '20' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['推广激励'] } },
  { id: 'R-19', red: true, patch: { contract_amount: '1000', promo_target: '外部', promo_amount: '35' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['推广激励'] } },
  { id: 'R-20', red: true, patch: { promo_outside: '是' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['条款外激励'] } },
  { id: 'R-21', patch: { promo_target: '内部', promo_amount: '50' },
    expect: { light: 'green', routeIncludes: ['免上会'], noYellowNames: ['推广激励', '条款外激励'] } },
  // ---- presale ----
  { id: 'R-22', type: 'presale', patch: { presale_invest: '60' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['售前投入成本'] } },
  { id: 'R-23', type: 'presale', patch: { presale_invest: '6', contract_amount: '100' },
    expect: { light: 'yellow', routeIncludes: ['部门级'], routeExcludes: ['XO'], yellowNames: ['售前投入占比'] } },
  { id: 'R-24', type: 'presale', patch: { presale_period: '4' },
    expect: { light: 'yellow', yellowNames: ['售前实施周期'] } },
  { id: 'R-25', type: 'presale', patch: { sign_date: '2027-06-01' },
    expect: { light: 'yellow', yellowNames: ['预计签单时间'] } },
  // ---- change ----
  { id: 'R-26', type: 'change', patch: { old_delivery_cost: '50', new_delivery_cost: '65' },
    expect: { light: 'yellow', yellowNames: ['成本变动'] } },
  { id: 'R-27', type: 'change', patch: { new_gross_margin: '-2' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['贡献利润'] } },
  { id: 'R-28', type: 'change', patch: { new_contract_amount: '600' },
    expect: { light: 'yellow', routeIncludes: ['XO'], yellowNames: ['合同金额'] } },
  { id: 'R-29', type: 'change', patch: { over_pay: '是' },
    expect: { light: 'yellow', yellowNames: ['超进度支付'] } },
  // ---- 综合路由/删杜总/XO 直通 ----
  { id: 'R-30', patch: {},
    expect: { light: 'green', routeIncludes: ['免上会'] } },
  { id: 'R-32', red: true, patch: { gross_margin: '-5' },
    expect: { light: 'yellow', routeExcludes: ['杜总'] } },
  { id: 'R-34', red: true, patch: { designated_sub_amount: '10' },
    expect: { light: 'yellow', routeIncludes: ['直通'], routeExcludes: ['先部门级'] } }
];

let pass = 0, fail = 0, redPass = 0, redFail = 0;
const LOG = [];
const check = (c, name, ok) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + c.id + ' ' + name;
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
  if (c.red) ok ? redPass++ : redFail++;
};

(async () => {
  const sales = await login('sales1');
  const admin = await login('zhichizu');
  const tokens = {};
  for (const u of new Set([...DEPTS.bid, ...DEPTS.presale, ...DEPTS.change])) tokens[u] = await login(u);

  const finishDept = async (rid, u, round) => {
    const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks
      .filter(t => t.review_id === rid && (round ? t.round === round : true));
    for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
    return ts.length;
  };

  // ---------- R-31/S-06 专项: 红灯自动打回 -> 修改 -> 重提(轮次2) -> 复判转绿 ----------
  // 任务 3.1: bid 提交必填锁定预算单 -> 先建锁预算单关联(全流程闭环走新流程)
  {
    const c = { id: 'R-31', red: true };
    const form = { ...BASES.bid, settle_method: '商业承兑汇票' };
    const bg = await makeLockedBudget(sales, 'R31 基线预算');
    const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]R-31 红灯自动打回闭环', form, submit: false, budget_id: bg })).id;
    await api(sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'rm.xlsx', data: Buffer.from('x').toString('base64') });
    await api(sales, `/api/reviews/${rid}/submit`, 'POST');
    for (const u of DEPTS.bid) await finishDept(rid, u);
    const d1 = await api(sales, `/api/reviews/${rid}`);
    check(c, '红灯自动打回 status=returned', d1.review.status === 'returned' && d1.review.light === 'red');
    check(c, '打回路由', /打回/.test(d1.review.route || ''));
    check(c, 'auto_return 事件留痕', d1.events.some(e => e.action === 'auto_return'));
    // 修改结算方式后重提 -> round=2 -> 二轮全绿 -> judged 绿灯 -> 归档
    await api(sales, `/api/reviews/${rid}`, 'PUT', { title: '[T]R-31 红灯打回闭环(已改)', form: { ...form, settle_method: '银行转账' } });
    const sub = await api(sales, `/api/reviews/${rid}/submit`, 'POST');
    check(c, 'S-06 重提后轮次=2', sub.round === 2);
    for (const u of DEPTS.bid) await finishDept(rid, u, 2);
    const d2 = await api(sales, `/api/reviews/${rid}`);
    check(c, 'S-06 二轮复判转绿(judged)', d2.review.status === 'judged' && d2.review.light === 'green');
    check(c, 'S-06 一轮旧任务作废', d2.tasks.filter(t => t.round === 1).every(t => ['cancelled', 'done', 'returned'].includes(t.status)));
    await api(admin, `/api/reviews/${rid}/archive`, 'POST');
  }

  // ---------- SEC-03/04/05 专项: 报告 HMAC 双通道鉴权(任务1.5) ----------
  {
    const c = { id: 'SEC', red: true };
    const bg = await makeLockedBudget(sales, 'SEC 基线预算');
    const rid = (await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]SEC 报告签名专项', form: { ...BASES.bid }, submit: false, budget_id: bg })).id;
    await api(sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'rm.xlsx', data: Buffer.from('x').toString('base64') });
    await api(sales, `/api/reviews/${rid}/submit`, 'POST');
    for (const u of DEPTS.bid) await finishDept(rid, u);
    const d = await api(sales, `/api/reviews/${rid}`);
    const ready = d.review.status === 'judged' && !!d.review.report_html;
    const st = (u, opt) => fetch(B + u, opt).then(r => r.status);
    // SEC-05: 登录态放行 / 裸访问拒绝
    check(c, 'SEC-05 登录态可看报告', ready && await st(`/api/reports/${rid}.html`, { headers: { Authorization: 'Bearer ' + sales } }) === 200);
    check(c, 'SEC-05 裸访问被拒(403)', ready && (await st(`/api/reports/${rid}.html`)) === 403);
    // SEC-03: report-link 需登录; 返回 7 天有效期 token 链接; 白盒自签过期 token 被拒
    const l401 = await fetch(`${B}/api/reviews/${rid}/report-link`);
    check(c, 'SEC-03 report-link 需登录(401)', l401.status === 401);
    const lr = await fetch(`${B}/api/reviews/${rid}/report-link`, { headers: { Authorization: 'Bearer ' + sales } });
    const ld = lr.ok ? await lr.json() : null;
    check(c, 'SEC-03 签名链接可看报告', !!ld && !!ld.url && (await st(ld.url)) === 200);
    check(c, 'SEC-03 链接有效期=7天', !!ld && ld.expires_in === 7 * 86400 && /token=\d+\.\d+\./.test(ld.url || ''));
    let expired403 = false;
    try {
      const cfg = JSON.parse(require('fs').readFileSync('config.json', 'utf8'));
      const exp = Math.floor(Date.now() / 1000) - 100;
      const sig = require('crypto').createHmac('sha256', cfg.REPORT_SECRET).update(`${rid}.${exp}`).digest('hex');
      expired403 = (await st(`/api/reports/${rid}.html?token=${rid}.${exp}.${sig}`)) === 403;
    } catch (e) {}
    check(c, 'SEC-03 过期签名被拒(403)', expired403);
    // SEC-04: 篡改 exp 保留旧签名 -> 403
    const forged = ld && ld.url && ld.url.replace(/token=(\d+)\.(\d+)\./, (m, a, b) => `token=${a}.${+b + 86400}.`);
    check(c, 'SEC-04 篡改签名被拒(403)', !!forged && (await st(forged)) === 403);
    if (d.review.status === 'judged') { try { await api(admin, `/api/reviews/${rid}/archive`, 'POST'); } catch (e) {} }
  }

  // ---------- 常规用例: preview-light 批量(任务 3.5, draft 建单即测不提交) ----------
  const t0 = Date.now();
  for (const c of CASES) {
    const type = c.type || 'bid';
    const form = { ...BASES[type], ...c.patch };
    try {
      const rid = (await api(sales, '/api/reviews', 'POST', { type, title: `[T]${c.id} ${type}`, form, submit: false })).id;
      const d = await api(sales, `/api/reviews/${rid}/preview-light`); // dry-run: 不落库不改 status
      const rv = { light: d.light, route: d.route };
      const detail = d.items || [];
      const errs = [];
      const e = c.expect;
      if (e.light && rv.light !== e.light) errs.push(`灯色=${rv.light} 期望${e.light}`);
      for (const kw of e.routeIncludes || []) if (!(rv.route || '').includes(kw)) errs.push(`路由缺[${kw}](${rv.route})`);
      for (const kw of e.routeExcludes || []) if ((rv.route || '').includes(kw)) errs.push(`路由多[${kw}](${rv.route})`);
      for (const n of e.yellowNames || []) if (!detail.some(i => i.level === 'yellow' && i.name.includes(n))) errs.push(`黄项缺[${n}]`);
      for (const n of e.noYellowNames || []) if (detail.some(i => i.level !== 'green' && i.name.includes(n))) errs.push(`不应有[${n}]项`);
      for (const n of e.redNames || []) if (!detail.some(i => i.level === 'red' && i.name.includes(n))) errs.push(`红项缺[${n}]`);
      for (const [n, kw] of e.itemReason || []) {
        const it = detail.find(i => i.name.includes(n));
        if (!it || !(String(it.reason || '').replace(/\s+/g, '')).includes(kw)) errs.push(`[${n}]理由缺[${kw}]`);
      }
      check(c, errs.length ? errs.join('; ') : `(${rv.light}/${detail.filter(i => i.level !== 'green').length} 项非绿)`, errs.length === 0);
    } catch (err) {
      check(c, '流程异常:' + err.message, false);
    }
  }
  const ms = Date.now() - t0;
  console.log(`preview-light 批量 ${CASES.length} 条耗时 ${ms}ms (性能冒烟门槛 <10s, 不硬卡)`);

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  const redline = `红绿用例(★red): ${redPass} PASS / ${redFail} FAIL ${redFail === 0 ? '(绿证据: 旧代码已先行 FAIL 留档则红绿成立)' : '(红绿未闭合)'}`;
  console.log('\n' + summary); console.log(redline);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n' + redline + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
