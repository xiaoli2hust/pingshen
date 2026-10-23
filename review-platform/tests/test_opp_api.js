// V4.0 T2 待评审商机档案 CRUD 专项: OP-01~OP-14(服务运行中)
// 用法: node tests/test_opp_api.js [--log=tests/green_opp.txt]
// 锚定: TEST_OPP 要素口径源自真实原件 PL00008572(江西省自然资源测绘与监测院 / 天地图 POI 数据服务项目, 预计合同 240 万)
//   —— 禁止自造推断值; 建档必填集与 server.js OPP_REQUIRED 同源(spec §1.1)
const B = 'http://127.0.0.1:8600';
const fs = require('fs');

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
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name;
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

const TEST_OPP = (n) => ({
  opp_code: 'PL-T2-' + n, title: 'T2测试商机-' + n, customer: '江西省自然资源测绘与监测院',
  region: '华东', province: '江西', biz_line: 'G1', contract_amount: 240,
  opp_stage: '投标决策/投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '',
  summary: '天地图 POI 数据服务项目（OP 套件建档用例）'
});

(async () => {
  const sales = await login('sales1');
  const fde = await login('fde1');
  const zhichi = await login('zhichizu');
  const S = String(Date.now()).slice(-7); // 每次运行独立码段, 保证套件可重跑
  const code = n => 'PL-T2-' + n;
  const c1 = S + '-01', c3 = S + '-03', c4 = S + '-04', c5 = S + '-05', c6 = S + '-06',
        c12 = S + '-12', c14 = S + '-14';

  // OP-01: 全要素建档
  {
    const r = await raw(sales, '/api/opp', 'POST', TEST_OPP(c1));
    const o = r.data.opp || {};
    check('OP-01', '建档 200(实 ' + r.status + ')', r.status === 200);
    check('OP-01', 'opp_code 回显一致', o.opp_code === code(c1));
    check('OP-01', 'status=pending 且 source=form', o.status === 'pending' && o.source === 'form');
    check('OP-01', 'contract_amount 为 number(240)', typeof o.contract_amount === 'number' && near(o.contract_amount, 240, 0.001));
  }

  // OP-02: 重复码 409
  {
    const r = await raw(sales, '/api/opp', 'POST', TEST_OPP(c1));
    check('OP-02', '同码重复建档 409 含「已存在」(实 ' + r.status + ' ' + (r.data.error || '') + ')',
      r.status === 409 && /已存在/.test(r.data.error || ''));
  }

  // OP-03: 缺要素 400 且列出全部缺失键
  {
    const bad = { ...TEST_OPP(c3) }; delete bad.customer; delete bad.summary;
    const r = await raw(sales, '/api/opp', 'POST', bad);
    const m = r.data.missing || [];
    check('OP-03', '缺 customer/summary → 400(实 ' + r.status + ')', r.status === 400);
    check('OP-03', 'missing 恰含这两键且不含已给键(missing=' + JSON.stringify(m) + ')',
      m.includes('customer') && m.includes('summary')
      && !m.includes('title') && !m.includes('biz_line') && !m.includes('contract_amount') && !m.includes('opp_stage') && !m.includes('sales'));
  }

  // OP-04: 非法形态码 400(T1 §4.5 脏表头码「商机阶段」)
  {
    const r = await raw(sales, '/api/opp', 'POST', { ...TEST_OPP(c4), opp_code: '商机阶段' });
    check('OP-04', '中文形态脏码 400 且提示商机代码(实 ' + r.status + ' ' + (r.data.error || '') + ')',
      r.status === 400 && /商机代码/.test(r.data.error || ''));
  }

  // OP-05: 角色门(FDE 不可建档)
  {
    const r = await raw(fde, '/api/opp', 'POST', TEST_OPP(c5));
    check('OP-05', 'FDE 建档 403(实 ' + r.status + ')', r.status === 403);
  }

  // OP-06: 支持组可建
  {
    const r = await raw(zhichi, '/api/opp', 'POST', TEST_OPP(c6));
    check('OP-06', '销售支持组建档 200(实 ' + r.status + ')', r.status === 200 && (r.data.opp || {}).opp_code === code(c6));
  }

  // OP-07: GET 回显全 18 列
  {
    const r = await raw(sales, '/api/opp/' + code(c1));
    const o = r.data.opp || {};
    check('OP-07', 'GET 200 且回显 18 列(实 keys=' + Object.keys(o).length + ')', r.status === 200 && Object.keys(o).length === 18);
    check('OP-07', '关键要素在位(title/customer/sales/opp_stage)',
      !!o.title && o.customer === '江西省自然资源测绘与监测院' && o.sales === '王超' && o.opp_stage === '投标决策/投标决策');
  }

  // OP-08: 未知码 404
  {
    const r = await raw(sales, '/api/opp/NOT-CODE-' + S);
    check('OP-08', '未知商机码 404(实 ' + r.status + ')', r.status === 404);
  }

  // OP-09: PUT 子集合并不清既有要素
  {
    const before = (await raw(sales, '/api/opp/' + code(c1))).data.opp || {};
    const r = await raw(sales, '/api/opp/' + code(c1), 'PUT', { pm: '张三' });
    const o = r.data.opp || {};
    check('OP-09', 'PUT {pm} 生效(实 ' + r.status + ')', r.status === 200 && o.pm === '张三');
    check('OP-09', '未提交要素未被清掉(customer/biz_line/summary 原样)',
      !!o.customer && o.customer === before.customer && o.biz_line === before.biz_line && o.summary === before.summary);
  }

  // OP-10: 非创建人不可改
  {
    const r = await raw(fde, '/api/opp/' + code(c1), 'PUT', { pm: '李四' });
    check('OP-10', '非建档人 PUT 403(实 ' + r.status + ')', r.status === 403);
  }

  // OP-11: 未登录 401
  {
    const r = await raw(null, '/api/opp/' + code(c1));
    check('OP-11', '未登录 GET 401(实 ' + r.status + ')', r.status === 401);
  }

  // OP-12: 建评审单隐式建档(source=form, 标题继承)
  {
    const rvTitle = 'OP12-评审标题-' + S;
    const rv = await raw(sales, '/api/reviews', 'POST', { type: 'bid', title: rvTitle, submit: false, form: { opp_code: code(c12), customer: '江西省自然资源测绘与监测院', biz_line: 'G1', contract_amount: '240', opp_stage: '投标决策', sales: '王超', summary: 'OP12 隐式建档' } });
    const o = (await raw(sales, '/api/opp/' + code(c12))).data.opp || {};
    check('OP-12', '建评审单 200(前置条件, 实 ' + rv.status + ')', rv.status === 200);
    check('OP-12', '隐式建档 source=form', o.source === 'form');
    check('OP-12', 'status=pending', o.status === 'pending');
    check('OP-12', 'title 继承评审标题(实 ' + JSON.stringify(o.title) + ')', o.title === rvTitle);
  }

  // OP-13: upsert 永不覆盖既有档案(OP-01 建档码再挂一张换标题的评审单)
  {
    const before = ((await raw(sales, '/api/opp/' + code(c1))).data.opp || {}).title;
    const newTitle = 'OP13-换掉的标题-' + S;
    await raw(sales, '/api/reviews', 'POST', { type: 'bid', title: newTitle, submit: false, form: { opp_code: code(c1) } });
    const after = ((await raw(sales, '/api/opp/' + code(c1))).data.opp || {}).title;
    check('OP-13', '既有档案 title 未被覆盖(before=' + JSON.stringify(before) + ' after=' + JSON.stringify(after) + ')',
      !!before && after === before && after !== newTitle);
  }

  // OP-14: 幂等——同码连续建评审单不重复增档(主键唯一 + upsert 早退)
  {
    const t1 = 'OP14-第一张-' + S;
    await raw(sales, '/api/reviews', 'POST', { type: 'bid', title: t1, submit: false, form: { opp_code: code(c14) } });
    await raw(sales, '/api/reviews', 'POST', { type: 'bid', title: 'OP14-第二张-' + S, submit: false, form: { opp_code: code(c14) } });
    const r = await raw(sales, '/api/opp/' + code(c14));
    check('OP-14', '重复隐式建档后 GET 仍 200 无报错(实 ' + r.status + ')', r.status === 200 && !r.data.error);
    check('OP-14', '档案仍为单份且保留首档标题(opp_code 为主键, 实 ' + JSON.stringify((r.data.opp || {}).title) + ')',
      (r.data.opp || {}).title === t1);
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
