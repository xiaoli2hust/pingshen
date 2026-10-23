// 阶段 2 财务引擎(任务 2.1): 预算测算纯函数, 公式自 public/app.js computeBudget(原 L449-482)逐字迁移, 冻结口径
// 输入模型演进(§4.3 六步法前置):
//   - contract 为 fields 字段(元); dev 单价不再手填 dev_rate, 走 rateFor(dev_dept) 部门映射(11 档单价归 settings)
//   - sales_labor 语义(公式原文 i.sales_labor !== ''): 键缺失/空走公式估值, 数字(含 0)走手填
//   - 激励系数 incentive_factor 为 fields 可选字段(缺省 1, 计提基数乘数)
//   - margin = net>0 ? contribution/net*100 : 0, 输出 +toFixed(4)(与前端同位)
// 铁律: 判灯/算账永不进 LLM——本模块纯代码; LLM(agent.js)只做口语→字段翻译, 白名单是唯一入口
// 锚定: tests/fixtures/tiandi.json(§3.2 十项)/pl8572.json(§3.1 六组), 见 tests/test_finance.js F-01/F-12

// 17 键: 4 项系数 + 13 档单价(十二部门 + ES 备档)
// 2026-10-09 按 26 年标准成本表核对: 十档与价目表一致; 公共服务拆交付运营/市场方案两档, 研发外包 ES 档入部门枚举
const DEFAULT_SETTINGS = {
  vat_rate: 1.06,              // 增值税换算: income = contract / vat_rate
  tax_rate: 0.01,              // 税金: income × tax_rate
  sales_labor_rate: 1727,      // 销售人力估值: round(max(净签单万-分包万, 0) × 1727)
  incentive_base: 0.077,       // 激励计提: max(考核利润, 0) × incentive_base
  price_delivery: 1696,          // 交付处(泛政业务一部)
  price_expand: 2303,            // 行业拓展部(泛政业务一部)
  price_public_service: 2204,   // 公共服务部(旧单档, 26 年表已拆两档, 留存兑底历史草稿)
  price_public_delivery: 1664,  // 公共服务业务处-交付运营(企业服务发展部, 26 年拆分档)
  price_public_market: 2862,    // 公共服务业务处-市场方案(企业服务发展部, 26 年拆分档)
  price_presale: 2350,           // 行业售前部
  price_ent_prod: 3001,          // 企业产品研发部
  price_data_prod: 1720,         // 数据产品部
  price_intel_map: 1752,         // 智能地图部
  price_common_comp: 1374,       // 公共组件部
  price_rd_outsource: 995,       // 研发外包(泛政业务一部)
  price_rd_outsource_es: 1022,   // 研发外包(企业服务发展部)
  price_prod_outsource: 320      // 生产外包
};

// 必填缺失清单(锁定门槛): 0 允许但必须明确出现
const MISSING_BUDGET = ['contract', 'sub_cost', 'dev_dept', 'dev_pd', 'del_travel'];

// 部门 -> settings 单价键(26 年拆分: 公共服务业务处两档 + 研发外包 ES 档入枚举; 旧"公共服务部"留兑底)
const DEV_DEPT_PRICE = {
  '交付处': 'price_delivery',
  '行业拓展部': 'price_expand',
  '公共服务部': 'price_public_service',
  '公共服务业务处-交付运营': 'price_public_delivery',
  '公共服务业务处-市场方案': 'price_public_market',
  '行业售前部': 'price_presale',
  '企业产品研发部': 'price_ent_prod',
  '数据产品部': 'price_data_prod',
  '智能地图部': 'price_intel_map',
  '公共组件部': 'price_common_comp',
  '研发外包': 'price_rd_outsource',
  '研发外包(企业服务)': 'price_rd_outsource_es',
  '生产外包': 'price_prod_outsource'
};

// 宽松数字解析(F-15 防御): 'abc'/null/undefined -> null; '240万' -> 240; 公式内 null 按 0 计
function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// 部门 -> 人天单价(元/天); 未识别部门返回 null(调用方出 warning)
function rateFor(dev_dept, settings) {
  const key = DEV_DEPT_PRICE[dev_dept];
  if (!key) return null;
  return num((settings || DEFAULT_SETTINGS)[key]);
}

// 缺项计算: 键未出现/空才缺(0 是明确出现, 不缺)
function missingOf(fields) {
  const i = fields || {};
  return MISSING_BUDGET.filter(k => i[k] === undefined || i[k] === null || i[k] === '');
}

// 预算测算纯函数: fields(元) + settings(可传 settings_snapshot) -> calc; 公式逐字迁移自 app.js L449-482
function computeBudget(fields, settings) {
  const i = fields || {};
  const S = settings || DEFAULT_SETTINGS;
  const warnings = [];
  const contract = num(i.contract) ?? 0;                                  // 元
  const contractWan = contract / 10000;
  const income = contract / S.vat_rate;
  const net = income - (num(i.sub_cost) ?? 0) - (num(i.sw_outsource) ?? 0) - (num(i.flex_labor) ?? 0);
  const subWan = (num(i.sub_cost) ?? 0) / 10000;
  // sales_labor 手填优先(公式原文 i.sales_labor !== '' 语义), 否则 round(max(净签单万−分包万,0)×sales_labor_rate)
  const hasManual = i.sales_labor !== undefined && i.sales_labor !== null && i.sales_labor !== '';
  const salesLabor = hasManual ? (num(i.sales_labor) ?? 0) : Math.round(Math.max(contractWan - subWan, 0) * S.sales_labor_rate);
  const tax = income * S.tax_rate;
  const salesCost = salesLabor + (num(i.sales_travel) ?? 0) + (num(i.sales_entertain) ?? 0) + (num(i.sales_marketing) ?? 0) + tax;
  const assessProfit = net - salesCost;
  const factor = num(i.incentive_factor) ?? 1;
  const incentive = Math.max(assessProfit, 0) * S.incentive_base * factor;
  // 交付成本: 正编人天×部门单价(不再收 dev_rate) + 生产外包人天×单价 + 研发外包 + 差旅 + PM + 其他
  const devRate = rateFor(i.dev_dept, S);
  if (i.dev_dept !== undefined && i.dev_dept !== null && i.dev_dept !== '' && devRate === null)
    warnings.push(`部门未识别:${i.dev_dept},交付正编人天未计价`);
  const delivery = (num(i.dev_pd) ?? 0) * (devRate ?? 0) + (num(i.prod_pd) ?? 0) * (num(S.price_prod_outsource) ?? 0)
    + (num(i.rd_outsource) ?? 0) + (num(i.del_travel) ?? 0) + (num(i.pm_cost) ?? 0) + (num(i.del_other) ?? 0);
  const contribution = net - salesCost - delivery - incentive;
  const margin = net > 0 ? contribution / net * 100 : 0;
  if (margin < 10)
    warnings.push(margin < 0
      ? `贡献毛利率为负(${margin.toFixed(2)}%),低于 10% 黄灯水位`
      : `贡献毛利率 ${margin.toFixed(2)}% 低于 10% 黄灯水位`);
  return { contract, income, net, salesLabor, tax, salesCost, assessProfit, incentive, delivery, contribution, margin: +margin.toFixed(4), warnings };
}

module.exports = { computeBudget, rateFor, missingOf, num, DEFAULT_SETTINGS, MISSING_BUDGET, DEV_DEPT_PRICE };
