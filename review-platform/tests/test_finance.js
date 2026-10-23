// 阶段 2 财务引擎单元 F-01~F-15(node --test, 不启服务)
// 锚定数字只取自《测试方案》§3.1(pl8572 六组+三中间量)/§3.2(tiandi 十项), 禁止手拍
const { test } = require('node:test');
const assert = require('node:assert');
const { computeBudget, rateFor, DEFAULT_SETTINGS, MISSING_BUDGET } = require('../finance.js');
const tiandi = require('./fixtures/tiandi.json');
const pl8572 = require('./fixtures/pl8572.json');

// sales_labor 键缺失才走公式估值(fixture 的 0 是 JSON 占位); _meta 剔除
const strip = o => { const c = { ...o }; delete c._meta; delete c.sales_labor; return c; };

test('F-01 天地图全套锚定(§3.2 十项)', () => {
  const c = computeBudget(strip(tiandi), DEFAULT_SETTINGS);
  assert.ok(Math.abs(c.income - 2264150.94) <= 0.01, 'income ' + c.income);
  assert.ok(Math.abs(c.net - 1264150.94) <= 0.01, 'net ' + c.net);
  assert.strictEqual(c.salesLabor, 241780, 'salesLabor ' + c.salesLabor);
  assert.ok(Math.abs(c.tax - 22641.51) <= 0.01, 'tax ' + c.tax);
  assert.ok(Math.abs(c.salesCost - 264421.51) <= 0.01, 'salesCost ' + c.salesCost);
  assert.ok(Math.abs(c.assessProfit - 999729.43) <= 1, 'assessProfit ' + c.assessProfit);
  assert.ok(Math.abs(c.incentive - 76979.17) <= 1, 'incentive ' + c.incentive);
  assert.strictEqual(c.delivery, 393120, 'delivery ' + c.delivery);
  assert.ok(Math.abs(c.contribution - 529630.27) <= 1, 'contribution ' + c.contribution);
  assert.ok(Math.abs(c.margin - 41.9) <= 0.1, 'margin ' + c.margin);
});

test('F-02 sales_labor 手填优先于公式估值', () => {
  const c = computeBudget({ ...strip(tiandi), sales_labor: 50000 }, DEFAULT_SETTINGS);
  assert.strictEqual(c.salesLabor, 50000);
});

test('F-03 净签单为负时销售人力估值取 0 且不抛错', () => {
  const c = computeBudget({ ...strip(tiandi), contract: 100000, sub_cost: 200000 }, DEFAULT_SETTINGS);
  assert.strictEqual(c.salesLabor, 0);
});

test('F-04 部门未识别 rateFor 返回 null 并出 warning', () => {
  assert.strictEqual(rateFor('不存在部门', DEFAULT_SETTINGS), null);
  const c = computeBudget({ ...strip(tiandi), dev_dept: '不存在部门' }, DEFAULT_SETTINGS);
  assert.ok(c.warnings.some(w => /部门未识别/.test(w)), 'warnings=' + JSON.stringify(c.warnings));
});

test('F-05 十部门单价映射与 settings 一致(§2.5 十五键)', () => {
  const map = {
    '交付处': 1696, '行业拓展部': 2303, '公共服务部': 2204, '行业售前部': 2350,
    '企业产品研发部': 3001, '数据产品部': 1720, '智能地图部': 1752, '公共组件部': 1374,
    '研发外包': 995, '生产外包': 320
  };
  for (const [dept, price] of Object.entries(map))
    assert.strictEqual(rateFor(dept, DEFAULT_SETTINGS), price, dept + ' -> ' + rateFor(dept, DEFAULT_SETTINGS));
  assert.strictEqual(DEFAULT_SETTINGS.price_rd_outsource_es, 1022, 'ES 备档');
  assert.strictEqual(MISSING_BUDGET.length, 5, '必填缺失清单五项');
});

test('F-06 负毛利输出负值且含黄灯水位预警', () => {
  const c = computeBudget({ ...strip(tiandi), sub_cost: 2000000 }, DEFAULT_SETTINGS);
  assert.ok(c.margin < 0, 'margin=' + c.margin);
  assert.ok(c.warnings.some(w => /10%/.test(w)));
});

test('F-07 毛利率 9.9% 触发黄灯水位预警', () => {
  // del_travel 20000->424479 使 margin≈9.9%(§3.2 同源推算)
  const c = computeBudget({ ...strip(tiandi), del_travel: 424479 }, DEFAULT_SETTINGS);
  assert.ok(Math.abs(c.margin - 9.9) <= 0.05, 'margin=' + c.margin);
  assert.ok(c.warnings.some(w => /低于\s*10%/.test(w)), 'warnings=' + JSON.stringify(c.warnings));
});

test('F-08 激励系数为 0 时激励为 0', () => {
  const c = computeBudget({ ...strip(tiandi), incentive_factor: 0 }, DEFAULT_SETTINGS);
  assert.strictEqual(c.incentive, 0);
});

test('F-09 亏损不激励(assessProfit<0 时 incentive=0)', () => {
  // sub_cost 2300000: income 2264150.94 - 2300000 = net -35849 < salesCost(≥tax 22641.51), assessProfit 必为负
  const c = computeBudget({ ...strip(tiandi), sub_cost: 2300000 }, DEFAULT_SETTINGS);
  assert.ok(c.assessProfit < 0, 'assessProfit=' + c.assessProfit);
  assert.strictEqual(c.incentive, 0);
});

test('F-10 全零预算不抛错(net<=0 分支 margin=0)', () => {
  const c = computeBudget({ contract: 0, sub_cost: 0, dev_pd: 0, del_travel: 0 }, DEFAULT_SETTINGS);
  assert.strictEqual(c.income, 0);
  assert.strictEqual(c.margin, 0);
});

test('F-11 settings 快照隔离:单价改动随传入 settings 传导(锁定单用 snapshot)', () => {
  const c1 = computeBudget({ ...pl8572 }, DEFAULT_SETTINGS);
  const c2 = computeBudget({ ...pl8572 }, { ...DEFAULT_SETTINGS, price_delivery: 9999 });
  assert.strictEqual(c1.delivery, 146896);
  assert.notStrictEqual(c2.delivery, c1.delivery);
  assert.ok(Math.abs(c2.delivery - (146896 + 39 * (9999 - 1696))) <= 1, 'delivery=' + c2.delivery);
});

test('F-12 PL00008572 六组锚定(§3.1 财务迁移放行门)', () => {
  const c = computeBudget({ ...pl8572 }, DEFAULT_SETTINGS);
  assert.ok(Math.abs(c.income - 226415.09) <= 0.01, 'income ' + c.income);
  assert.strictEqual(c.salesLabor, 41448, 'salesLabor ' + c.salesLabor);
  assert.ok(Math.abs(c.tax - 2264.15) <= 0.01, 'tax ' + c.tax);
  assert.ok(Math.abs(c.incentive - 13298.13) <= 1, 'incentive ' + c.incentive);
  assert.ok(Math.abs(c.contribution - 12508.82) <= 1, 'contribution ' + c.contribution);
  assert.ok(Math.abs(c.margin - 5.52) <= 0.01, 'margin ' + c.margin);
  // §3.1 中间量: 销售成本 53712.15 / 考核利润 172702.94 / 交付成本 146896
  assert.ok(Math.abs(c.salesCost - 53712.15) <= 0.05, 'salesCost ' + c.salesCost);
  assert.ok(Math.abs(c.assessProfit - 172702.94) <= 1, 'assessProfit ' + c.assessProfit);
  assert.strictEqual(c.delivery, 146896, 'delivery ' + c.delivery);
});

test('F-13 小数精度两位舍入一致(与 Excel 同位)', () => {
  const c = computeBudget({ contract: 123456.78, sub_cost: 0, dev_pd: 0, del_travel: 0, sales_labor: 0 }, DEFAULT_SETTINGS);
  assert.strictEqual(c.income.toFixed(2), (123456.78 / 1.06).toFixed(2));
  assert.strictEqual(c.tax.toFixed(2), (123456.78 / 1.06 * 0.01).toFixed(2));
});

test('F-14 空对象不抛错', () => {
  const c = computeBudget({}, DEFAULT_SETTINGS);
  assert.strictEqual(c.margin, 0);
});

test('F-15 非法类型注入不抛错(num 归 null)', () => {
  const c = computeBudget({ contract: 'abc', sub_cost: 'xyz', dev_pd: 'NaN' }, DEFAULT_SETTINGS);
  assert.ok(Number.isFinite(c.margin), 'margin=' + c.margin);
});
