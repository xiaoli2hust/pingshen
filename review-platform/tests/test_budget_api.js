// 阶段 2 预算 API 契约 + 状态机/版本链: API-01~15 + API-20 + S-01~S-06(服务运行中)
// 用法: node tests/test_budget_api.js [--log=tests/green_stage2_api.txt]
// 红绿纪律: 全部用例在旧代码上必 FAIL(/api/budget* 一律 404 '接口不存在'), 红证据留 tests/red_evidence_stage2.txt
// 锚定数字只取自《测试方案》§3.2(API-07 要求 calc 与 §3.2 结构一致), 禁止手拍
// 测试单带 [T] 前缀; judged 可归档, 其余留库待人工清理
const B = 'http://127.0.0.1:8600';
const tiandi = require('./fixtures/tiandi.json');
// fields: 剔 _meta 与 sales_labor 占位(销售人力走 1727 公式估值, §3.2 口径)
const FIELDS = (() => { const c = { ...tiandi }; delete c._meta; delete c.sales_labor; return c; })();

async function raw(token, path, method, body) {
  const r = await fetch(B + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function api(token, path, method, body) {
  const r = await raw(token, path, method, body);
  if (r.status >= 400) throw new Error(path + ' -> ' + r.status + ' ' + (r.data.error || ''));
  return r.data;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name;
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

// bid 全绿基线(与 test_rules_e2e 同源) —— S-04/S-05/S-06 评审单关联用
const BASE_BID = {
  opp_code: 'PL-T-BU', opp_stage: '投标决策', region: '华北营销处-渠道',
  customer: '预算API基线客户', biz_line: 'G1', contract_amount: '24',
  sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15',
  cost_happened: '0', ops_years: '1',
  sign_path: '客户公司→丰图科技(深圳)有限公司',
  sub_amount: '0', designated_sub_amount: '0', survey_sub_amount: '0', sub_core: '否',
  survey: '否', jiadao: '否', secret: '否', province: '江西省', product_type: '标品',
  promo_target: '无', promo_amount: '0', settle_method: '银行转账',
  payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: '预算API基线', data_review: '是', data_plan: '公开POI数据',
  data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};
const DEPT_USERS = ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'];

(async () => {
  const sales = await login('sales1');
  const fin = await login('fin1');
  const admin = await login('zhichizu');
  const deptTokens = {};
  for (const u of DEPT_USERS) deptTokens[u] = await login(u);
  let M1 = 0, V2 = 0; // 主单(走完整生命周期) / 新版本

  const STEPS = [
    ['API-02/01', async () => {
      const no = await raw(null, '/api/budget', 'POST', {});
      check('API-02', '未登录建单 401', no.status === 401);
      const c = await raw(sales, '/api/budget', 'POST', {});
      check('API-01', '建单 200 返回 id/code', c.status === 200 && !!c.data.id && /^B-\d{4}-\d{4}$/.test(c.data.code || ''));
      M1 = (c.data || {}).id || 0;
      const g = await raw(sales, '/api/budget/' + M1);
      check('API-01', '初始 status=draft', g.status === 200 && (g.data.budget || {}).status === 'draft');
    }],

    ['API-15', async () => {
      const g = await raw(sales, '/api/budget/999999');
      check('API-15', '不存在 id 404', g.status === 404);
    }],

    ['API-07/08', async () => {
      const p = await raw(sales, '/api/budget/preview', 'POST', { fields: FIELDS });
      const c = (p.data || {}).calc || {};
      check('API-07', 'preview 200 返回 §3.2 结构 calc',
        p.status === 200 && near(c.income, 2264150.94, 0.01) && near(c.margin, 41.9, 0.1) && near(c.contribution, 529630.27, 1));
      const p2 = await raw(sales, '/api/budget/preview', 'POST', { fields: { contract: 2400000, hack: 1 } });
      check('API-08', '未知字段静默丢弃(200 且 calc 不受污染)',
        p2.status === 200 && near(((p2.data || {}).calc || {}).income, 2264150.94, 0.01));
    }],

    ['API-03/04/05', async () => {
      const u = await raw(sales, '/api/budget/' + M1, 'PUT', { fields: FIELDS });
      const c = (u.data || {}).calc || {};
      check('API-03', 'owner PUT 白名单字段 200 且 calc 同步',
        u.status === 200 && near(c.income, 2264150.94, 0.01) && near(c.salesLabor, 241780, 0.01));
      const inj = await raw(sales, '/api/budget/' + M1, 'PUT', { fields: { status: 'locked', budget_id: 99, code: 'B-2026-9999', sub_cost: 800000 } });
      const g = await raw(sales, '/api/budget/' + M1);
      const bd = (g.data || {}).budget || {};
      const f = bd.fields || {};
      check('API-04', '结构字段注入被白名单丢弃(status 不变)', inj.status === 200 && bd.status === 'draft');
      check('API-04', '注入单业务字段放行 sub_cost=800000', f.sub_cost === 800000 && f.budget_id === undefined && f.code === undefined);
      const f403 = await raw(fin, '/api/budget/' + M1, 'PUT', { fields: { sub_cost: 1 } });
      check('API-05', '非 owner 非 admin 403', f403.status === 403);
      await api(sales, '/api/budget/' + M1, 'PUT', { fields: { sub_cost: 1000000 } }); // 恢复 tiandi 口径供锁定
    }],

    ['S-01/API-09/10/11', async () => {
      // 空单先测缺失项全列
      const e = await raw(sales, '/api/budget', 'POST', {});
      const lk = await raw(sales, '/api/budget/' + (e.data || {}).id + '/lock', 'POST', {});
      const err = (lk.data || {}).error || '';
      check('API-10', '缺必填 400 且列出全部缺失项(不只第一个)',
        lk.status === 400 && ['contract', 'sub_cost', 'dev_dept', 'dev_pd', 'del_travel'].every(k => err.includes(k)));
      // 附3 递进门禁: 无交付明细锁定 400
      const noDlv = await raw(sales, '/api/budget/' + M1 + '/lock', 'POST', {});
      check('DLV', '无交付明细锁定被拦截(递进门禁)', noDlv.status === 400 && /交付明细/.test(noDlv.data.error || ''));
      await api(sales, `/api/budget/${M1}/delivery`, 'PUT', { rows: [{ content: 'API 回归明细', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
      const l = await raw(sales, '/api/budget/' + M1 + '/lock', 'POST', {});
      const g = await raw(sales, '/api/budget/' + M1);
      const bd = (g.data || {}).budget || {};
      check('API-09', 'lock 200 status=locked', l.status === 200 && bd.status === 'locked');
      check('S-01', 'calc/settings_snapshot 快照落库',
        near((bd.calc || {}).income, 2264150.94, 0.01) && bd.settings_snapshot && Object.keys(bd.settings_snapshot).length === 17); // 26 年拆档后 15→17 键
      const dup = await raw(sales, '/api/budget/' + M1 + '/lock', 'POST', {});
      check('API-11', '重复锁定 409', dup.status === 409);
    }],

    ['S-02/API-06', async () => {
      const u = await raw(sales, '/api/budget/' + M1, 'PUT', { fields: { sub_cost: 1 } });
      check('S-02/API-06', 'locked 后 PUT 400 含已锁定', u.status === 400 && /已锁定/.test(u.data.error || ''));
    }],

    ['API-12/13/14/S-03', async () => {
      const nv = await raw(sales, '/api/budget/' + M1 + '/newversion', 'POST', {});
      const b2 = nv.data || {};
      check('API-12', 'newversion 200 v2 draft', nv.status === 200 && b2.version === 2 && b2.status === 'draft');
      check('S-03', 'v2 parent_id 指向 v1 且拷贝 fields',
        b2.parent_id === M1 && ((b2.fields || {}).sub_cost === 1000000));
      V2 = b2.id || 0;
      const g1 = await raw(sales, '/api/budget/' + M1);
      check('S-03', 'v1 保持 locked 不动', ((g1.data || {}).budget || {}).status === 'locked');
      const bad = await raw(sales, '/api/budget/' + V2 + '/newversion', 'POST', {});
      check('API-13', '无锁定版 newversion 409', bad.status === 409);
      const vs = await raw(sales, '/api/budget/' + M1 + '/versions');
      check('API-14', 'versions 长度 2', vs.status === 200 && ((vs.data || {}).versions || []).length === 2);
    }],

    ['S-04', async () => {
      for (const i of [1, 2]) { // 一锁多评: 同一 locked 预算关联两张评审单
        const r = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]S-04 一锁多评-' + i, form: { ...BASE_BID }, budget_id: M1, submit: false });
        await api(sales, '/api/reviews/' + r.id + '/attachments', 'POST', { field: '项目预算表', filename: 's4.xlsx', data: Buffer.from('x').toString('base64') });
        const sub = await api(sales, '/api/reviews/' + r.id + '/submit', 'POST');
        check('S-04', '第' + i + '张评审单关联同一 locked 预算合法', sub.round === 1);
      }
    }],

    ['S-05/API-20', async () => {
      const r = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]S-05 draft预算拦截', form: { ...BASE_BID }, budget_id: V2, submit: false });
      await api(sales, '/api/reviews/' + r.id + '/attachments', 'POST', { field: '项目预算表', filename: 's5.xlsx', data: Buffer.from('x').toString('base64') });
      const sub = await raw(sales, '/api/reviews/' + r.id + '/submit', 'POST');
      check('S-05/API-20', '提交关联 draft 单 400 拦截', sub.status === 400 && /必须关联已锁定的预算单/.test(sub.data.error || ''));
    }],

    ['S-06', async () => {
      // 红灯打回 -> 修改 -> 重提 round=2 -> 二轮转绿 -> 归档(与 R-31 专项同构, 此处独立自包含)
      // 阶段3 演进(任务 3.1): bid 提交必填锁定预算单 -> 关联 M1(一锁多评语义, S-04 先行验证)
      const form = { ...BASE_BID, settle_method: '商业承兑汇票' };
      const r = await api(sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]S-06 红灯打回重提', form, submit: false, budget_id: M1 });
      const rid = r.id;
      await api(sales, '/api/reviews/' + rid + '/attachments', 'POST', { field: '项目预算表', filename: 's6.xlsx', data: Buffer.from('x').toString('base64') });
      await api(sales, '/api/reviews/' + rid + '/submit', 'POST');
      const finishAll = async round => {
        for (const u of DEPT_USERS) {
          const ts = (await api(deptTokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid && (round ? t.round === round : true));
          for (const t of ts) await api(deptTokens[u], '/api/tasks/' + t.id + '/complete', 'POST', { light: 'green', opinion: '' });
        }
      };
      await finishAll(1);
      const d1 = await api(sales, '/api/reviews/' + rid);
      check('S-06', '红灯自动打回 returned', d1.review.status === 'returned' && d1.review.light === 'red');
      await api(sales, '/api/reviews/' + rid, 'PUT', { title: '[T]S-06 红灯打回重提(已改)', form: { ...form, settle_method: '银行转账' } });
      const sub = await api(sales, '/api/reviews/' + rid + '/submit', 'POST');
      check('S-06', '重提 round=2', sub.round === 2);
      const d2 = await api(sales, '/api/reviews/' + rid);
      check('S-06', '一轮旧任务作废留痕', d2.tasks.filter(t => t.round === 1).every(t => ['cancelled', 'done', 'returned'].includes(t.status)));
      check('S-06', '二轮任务重新分发(bid 10 项指标)', d2.tasks.filter(t => t.round === 2 && t.status === 'pending').length === 10);
      await finishAll(2);
      const d3 = await api(sales, '/api/reviews/' + rid);
      check('S-06', '二轮复判转绿 judged', d3.review.status === 'judged' && d3.review.light === 'green');
      await api(admin, '/api/reviews/' + rid + '/archive', 'POST');
    }]
  ];

  for (const [id, fn] of STEPS) {
    try { await fn(); } catch (e) { check(id, '流程异常:' + e.message, false); }
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
