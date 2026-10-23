// 阶段 2 技能①预算编制 Agent(任务 2.5) + 阶段 3 技能②③评审表编制 Agent(任务 3.3)
// LLM 只做口语→字段翻译, 白名单是唯一入口
// 铁律(§4.5): 判灯/算账/代确认永不进 LLM
//   - 白名单外 key 一律丢弃(LLM 无法注入 status/budget_id/code 等结构字段)
//   - 口头"确认锁定"不锁定: LLM 无法把"确认"映射为锁定动作, 锁定只走 POST /:id/lock 按钮(人确认门)
//   - LLM 调用失败(30s 超时/网络/解析)不重试直接降级: degraded=true, 跳过 merge, HTTP 仍 200
const { spawn } = require('child_process');
const { num, MISSING_BUDGET } = require('./finance.js');

// 提示词 SYSTEM 段全文冻结(§4.5, 迭代须跑 A 系列桩回归)
const SYSTEM_PROMPT = `你是项目预算表的字段抽取器。唯一职责：把用户口语转换为 JSON 字段。
规则：
1. 只输出 JSON：{"fields":{…}}，不输出任何其他文字/解释/markdown。
2. 只允许字段（白名单）：contract, sub_cost, sw_outsource, flex_labor,
   dev_dept, dev_pd, prod_pd, rd_outsource, del_travel, pm_cost, del_other,
   sales_labor, sales_travel, sales_entertain, sales_marketing,
   incentive_factor, project_name, customer。
3. 单位：金额类字段均为元；用户说"240 万"则 contract=2400000。
   dev_pd/prod_pd 为人天。incentive_factor 为数字（默认 1.0）。
4. dev_dept 只能是：交付处/行业拓展部/公共服务部/公共服务业务处-交付运营/公共服务业务处-市场方案/
   行业售前部/企业产品研发部/数据产品部/智能地图部/公共组件部/
   研发外包/研发外包(企业服务)/生产外包 之一。
5. 用户未提及的字段不输出。禁止：计算数值、给建议、判断灯态、修改未提及字段。`;

// 白名单与类型表(18 字段): num×15 / enum×1 / str×2
const BUDGET_WHITELIST = {
  contract: 'num', sub_cost: 'num', sw_outsource: 'num', flex_labor: 'num',
  dev_dept: 'enum:交付处|行业拓展部|公共服务部|公共服务业务处-交付运营|公共服务业务处-市场方案|行业售前部|企业产品研发部|数据产品部|智能地图部|公共组件部|研发外包|研发外包(企业服务)|生产外包',
  dev_pd: 'num', prod_pd: 'num', rd_outsource: 'num', del_travel: 'num',
  pm_cost: 'num', del_other: 'num', sales_labor: 'num', sales_travel: 'num',
  sales_entertain: 'num', sales_marketing: 'num', incentive_factor: 'num',
  project_name: 'str', customer: 'str',
  opp_code: 'str' // O2 商机代码贯穿: 预算单白名单允许(业务主键, 非必填)
};

// 必填缺失清单(与 finance.js 同源): 0 允许但必须明确出现
const MISSING_LABELS = { contract: '合同金额', sub_cost: '分包成本', dev_dept: '交付部门', dev_pd: '正编人天', del_travel: '交付差旅' };

// ========== 阶段 3 · 技能②评审表编制(任务 3.3, §5.3) ==========
// 提示词同 §4.5 结构冻结; 与技能①差异: 单位万元、无部门枚举(规则4删)、白名单换评审表字段
const BID_SYSTEM_PROMPT = `你是投标评审表的字段抽取器。唯一职责：把用户口语转换为 JSON 字段。
规则：
1. 只输出 JSON：{"fields":{…}}，不输出任何其他文字/解释/markdown。
2. 只允许字段（白名单）：contract_amount, sub_amount, designated_sub_amount,
   survey_sub_amount, gross_margin, cost_happened, ops_years, promo_amount,
   presale_invest, presale_period, old_contract_amount, old_gross_margin,
   new_contract_amount, new_gross_margin, old_sub_amount, new_sub_amount,
   old_delivery_cost, new_delivery_cost, old_sales_cost, new_sales_cost,
   sub_core, survey, jiadao, secret, promo_target, promo_outside, guarantee,
   non_compete, sub_limit, sub_early_flag, over_pay, data_review,
   opp_code, opp_stage, region, customer, biz_line, sales, pm, sign_date,
   sign_path, province, settle_method, payback_time, b2b_scene, revenue_confirm,
   payment_terms, product_type, proj_code, proj_stage, change_type,
   data_plan, data_content, data_compliance, summary。
3. 单位：金额类字段均为万元；用户说"24 万"则 contract_amount=24。
   gross_margin 为百分比数字（如 15.08）；人年类字段为整数。
4. 是/否类字段只能输出"是"或"否"；promo_target 只能是：无/内部/外部/均包含。
5. 用户未提及的字段不输出。禁止：计算数值、给建议、判断灯态、修改未提及字段。`;

// 评审表白名单与类型表(以 server.js FIELD_LABELS 为准): num×20 / enum×12 / str×21
const BID_WHITELIST = {
  opp_code: 'str', opp_name: 'str', // 商机代码/商机名称(真项目名, title 首选)
  // num(万元/百分比/数量)
  contract_amount: 'num', sub_amount: 'num', designated_sub_amount: 'num', survey_sub_amount: 'num',
  gross_margin: 'num', cost_happened: 'num', ops_years: 'num', promo_amount: 'num',
  presale_invest: 'num', presale_period: 'num',
  old_contract_amount: 'num', old_gross_margin: 'num', new_contract_amount: 'num', new_gross_margin: 'num',
  old_sub_amount: 'num', new_sub_amount: 'num', old_delivery_cost: 'num', new_delivery_cost: 'num',
  old_sales_cost: 'num', new_sales_cost: 'num',
  // enum(是/否 与枚举集)
  sub_core: 'enum:是|否', survey: 'enum:是|否', jiadao: 'enum:是|否', secret: 'enum:是|否',
  promo_target: 'enum:无|内部|外部|均包含', promo_outside: 'enum:是|否', guarantee: 'enum:是|否',
  non_compete: 'enum:是|否', sub_limit: 'enum:是|否', sub_early_flag: 'enum:是|否', over_pay: 'enum:是|否',
  data_review: 'enum:是|否',
  // str(开放文本)
  opp_code: 'str', opp_stage: 'str', region: 'str', customer: 'str', biz_line: 'str', sales: 'str', pm: 'str',
  sign_date: 'str', sign_path: 'str', province: 'str', settle_method: 'str', payback_time: 'str',
  b2b_scene: 'str', revenue_confirm: 'str', payment_terms: 'str', product_type: 'str',
  proj_code: 'str', proj_stage: 'str', change_type: 'str',
  data_plan: 'str', data_content: 'str', data_compliance: 'str', summary: 'str'
};

// 评审必填集(§5.3 核心列举, "以 FIELDS 为准"): 技能②缺失清单 = BID_REQUIRED 未填项
const BID_REQUIRED = ['customer', 'contract_amount', 'sub_amount', 'province', 'secret', 'jiadao',
  'settle_method', 'sign_path', 'product_type', 'b2b_scene', 'revenue_confirm',
  'promo_target', 'promo_amount', 'promo_outside', 'guarantee', 'non_compete', 'sub_limit'];

// 技能②回复模板(纯代码, 不进 LLM): 变更摘要 + 缺失清单; preview 有值时为技能③预判摘要
function buildBidReply(changed, missing, preview) {
  if (preview) { // 技能③预判(A-17): 灯色+路径+主要风险项
    const zh = { red: '红灯', yellow: '黄灯', green: '绿灯' }[preview.light] || preview.light;
    const risks = (preview.items || []).filter(i => i.level !== 'green');
    return `[预判] 灯色:${zh}\n路径:${preview.route}\n` +
      (risks.length ? `主要风险项(${risks.length} 项):\n` + risks.map(i => `- ${i.name}:${i.reason}`).join('\n')
        : '全部指标均为绿灯,无关键风险点。') +
      '\n(预判为 dry-run,不改单据状态;正式研判以提交后为准)';
  }
  const lines = [];
  const chg = Object.keys(changed || {});
  if (chg.length) lines.push('本轮更新:' + chg.join(', '));
  if ((missing || []).length) lines.push(`评审必填还缺 ${missing.length} 项:` + missing.join('/'));
  else lines.push('必填项已齐,可提交评审(或发"预判一下灯"查看预判)。');
  return lines.join('\n');
}

// ========== V4.0 P1 · 技能④对话式建档(待评审商机档案) ==========
// 只产档案草稿: 建档落库走 server.js 与 POST /api/opp 同一裁判(形态门/缺项/409), 不碰评审单与提交门
const OPP_SYSTEM_PROMPT = `你是待评审商机档案的字段抽取器。唯一职责：把用户口语转换为 JSON 字段。
规则：
1. 只输出 JSON：{"fields":{…}}，不输出任何其他文字/解释/markdown。
2. 只允许字段（白名单）：title, customer, region, province, biz_line,
   contract_amount, opp_stage, sales, pm, survey, summary。
3. 单位：contract_amount 为预计合同金额，单位万元；用户说"240 万"则 contract_amount=240。
4. biz_line 只能是：G1/B2/G2 之一；survey 只能输出"是"或"否"。
5. 用户未提及的字段不输出。禁止：输出商机代码与状态、计算数值、给建议、判断灯态、修改未提及字段。`;

// 键集必须 ⊆ server.js OPP_FIELDS(可写列); sign_date 不经口语写入, opp_code/status 永不入白名单
const OPP_WHITELIST = {
  title: 'str', customer: 'str', region: 'str', province: 'str',
  biz_line: 'enum:G1|B2|G2', contract_amount: 'num', opp_stage: 'str',
  sales: 'str', pm: 'str', survey: 'enum:是|否', summary: 'str'
};
const OPP_LABELS = { title: '商机名称', customer: '客户名称', region: '大区', province: '省份', biz_line: '业务线',
  contract_amount: '预计合同金额(万元)', opp_stage: '商机阶段', sales: '销售', pm: '项目经理', survey: '是否测绘', summary: '项目概述' };

// 追问集 = 服务端缺项中可经口语补齐者(OPP_REQUIRED ⊆ 白名单时即为全集)
const oppAskMissing = missing => (missing || []).filter(k => k in OPP_WHITELIST);

function buildOppReply(changed, missing, opts) {
  const o = opts || {};
  const ask = oppAskMissing(missing).map(k => OPP_LABELS[k] || k);
  const lines = [];
  const chg = Object.keys(changed || {});
  if (o.degraded) lines.push('大模型暂不可用,本轮未改动已填字段,请在下方表单点选/填写。');
  else lines.push(chg.length ? '本轮更新:' + chg.map(k => (OPP_LABELS[k] || k) + '=' + changed[k]).join(', ') : '未识别到新字段。');
  if (ask.length) lines.push(`建档还缺 ${ask.length} 项:` + ask.join('/'));
  else lines.push('必填要素已齐,填写商机代码后点【确认建档】按钮落库(口头确认不生效)。');
  return lines.join('\n');
}

// 完整提示词(system+user 拼接, 测试/留档用)
function buildBudgetPrompt(draft, message) {
  return SYSTEM_PROMPT + '\n\n当前草稿：' + JSON.stringify(draft || {}) + '\n用户说：' + message;
}

// 消息校验(A-13): 空串/纯空白拒绝
function checkMessage(message) {
  const s = message === null || message === undefined ? '' : String(message).trim();
  if (!s) return { error: '消息不能为空' };
  if (s.length > 2000) return { error: '消息过长(限 2000 字)' };
  return {};
}

// 白名单合并: 返回 {...draft, ...存活字段}; 逐 key 校验(A-05/06/07)
//   - num 解析失败丢弃(不 throw); enum 不在枚举内丢弃; str 非字符串丢弃
//   - 白名单外 key 一律丢弃(结构字段 status/budget_id/code/parent_id 无法注入)
//   - 阶段3 泛化(任务 3.3): opts.whitelist 换技能②评审表白名单; opts.normalizePct 启用毛利率归一化
function mergeDraft(llmFields, draft, opts) {
  const o = opts || {};
  const whitelist = o.whitelist || BUDGET_WHITELIST;
  const src = (llmFields && typeof llmFields === 'object' && !Array.isArray(llmFields)) ? llmFields : {};
  const out = { ...(draft || {}) };
  for (const [k, spec] of Object.entries(whitelist)) {
    if (!(k in src)) continue;
    const v = src[k];
    if (v === null || v === undefined) continue;
    if (spec === 'str') {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    } else if (spec.startsWith('enum:')) {
      if (spec.slice(5).split('|').includes(v)) out[k] = v;
    } else { // num
      let n = null;
      if (typeof v === 'number' && Number.isFinite(v)) n = v;
      else if (typeof v === 'string' && v.trim() !== '') n = num(v);
      if (n !== null) {
        // A-18 归一化防线(§2.6 发现#2): gross_margin 值∈(0,1) 视为小数格式自动×100, >1 直用
        //   防 15.08% 被误判为 0.15%(真实判例小数格式实测)
        if (o.normalizePct && k === 'gross_margin' && n > 0 && n < 1) out[k] = Math.round(n * 10000) / 100;
        else out[k] = n;
      }
    }
  }
  return out;
}

// LLM 抽取(§4.5): 复用 spawn('curl') 通道(公司防火墙会重置 Node 原生 TLS 指纹)
//   temperature=0 / max_tokens=500 / --max-time 默认 30(llmCfg.maxTime 可覆盖, 源自 settings llm.degrade.timeout_ms; 超时失败直接降级)
//   任何失败 throw, 由调用方 catch → degraded=true 跳过 merge(HTTP 仍 200)
async function extractFields(draft, message, llmCfg) {
  const payload = JSON.stringify({
    model: llmCfg.model || 'deepseek-chat',
    temperature: 0, max_tokens: 500,
    messages: [
      { role: 'system', content: llmCfg.prompt || SYSTEM_PROMPT }, // 阶段3: 技能②传 BID_SYSTEM_PROMPT
      { role: 'user', content: `当前草稿：${JSON.stringify(draft || {})}\n用户说：${String(message).slice(0, 2000)}` }
    ]
  });
  const raw = await new Promise((resolve, reject) => {
    const cp = spawn('curl', [
      '-s', '-X', 'POST', llmCfg.base + '/v1/chat/completions',
      '-H', 'Content-Type: application/json', '-H', 'Authorization: Bearer ' + llmCfg.key,
      '--data-binary', '@-', '--max-time', String(llmCfg.maxTime || 30)
    ], { windowsHide: true });
    let out = '', err = '';
    cp.stdout.on('data', d => out += d);
    cp.stderr.on('data', d => err += d);
    cp.on('error', reject);
    cp.on('close', code => code === 0 ? resolve(out) : reject(new Error('请求失败:' + err.slice(0, 120))));
    cp.stdin.on('error', () => {}); // 审查整改#4: EPIPE 吞掉(网关快速断开时), 由 close 的 reject 兜底, 防进程级崩溃
    cp.stdin.write(payload);
    cp.stdin.end();
  });
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error('网关返回异常:' + String(raw).slice(0, 100)); }
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  // 剥 ```json 围栏: 取首个 {...} 块
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('大模型未返回有效JSON');
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { throw new Error('JSON 解析失败'); }
  const fields = parsed.fields !== undefined ? parsed.fields : parsed;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('fields 结构无效');
  return fields;
}

// 回复模板(§4.5 纯代码, 判灯/算账永不进 LLM):
//   变更摘要 + 精算行 + 缺失行 + 动作行; actions 仅在缺项清零 && status=draft 时 [confirm_lock](人确认门)
function buildReply(changed, calc, missing, opts) {
  const o = opts || {};
  const wan = n => (typeof n === 'number' && Number.isFinite(n) ? (n / 10000).toFixed(1) : '-');
  const changedKeys = Object.keys(changed || {});
  const lines = [];
  // 变更摘要
  if (changedKeys.length === 0) lines.push('未识别到新字段。');
  else lines.push('本轮更新:' + changedKeys.map(k => `${k}=${changed[k]}`).join(', ') + (o.degraded ? '(点选补齐写入)' : ''));
  // 精算行
  const c = calc || {};
  lines.push(`[精算] 项目收入 ${wan(c.income)} 万 / 净收入 ${wan(c.net)} 万 / 销售成本 ${wan(c.salesCost)} 万 / 交付成本 ${wan(c.delivery)} 万 / 激励 ${wan(c.incentive)} 万 → 贡献毛利 ${wan(c.contribution)} 万, 毛利率 ${(typeof c.margin === 'number' ? c.margin.toFixed(1) : '-')}%${(c.warnings || []).some(w => /10%/.test(w)) ? ' ⚠ 黄灯水位' : ''}`);
  // 缺失行
  if ((missing || []).length > 0) {
    const labels = missing.map(k => MISSING_LABELS[k] || k);
    lines.push(o.degraded
      ? `大模型暂不可用,请点选补齐(${missing.length} 项):` + labels.join('/')
      : `还缺 ${missing.length} 项:` + labels.join('/'));
  } else if (!o.degraded) {
    lines.push('必填项已齐。');
  }
  // 动作行(人确认门: 口头"确认锁定"不锁定, 必须点按钮)
  const actions = ((missing || []).length === 0 && o.status === 'draft')
    ? [{ type: 'confirm_lock', label: `确认锁定 v${o.version || 1}`, method: 'POST', endpoint: `/api/budget/${o.budgetId}/lock` }]
    : [];
  if (actions.length) lines.push(`必填项已齐,可点【${actions[0].label}】按钮完成锁定(口头确认不生效)。`);
  return { reply: lines.join('\n'), actions };
}

module.exports = { SYSTEM_PROMPT, BUDGET_WHITELIST, MISSING_BUDGET, MISSING_LABELS, buildBudgetPrompt, checkMessage, mergeDraft, extractFields, buildReply,
  BID_SYSTEM_PROMPT, BID_WHITELIST, BID_REQUIRED, buildBidReply, // 阶段3 技能②③(任务 3.3)
  OPP_SYSTEM_PROMPT, OPP_WHITELIST, OPP_LABELS, oppAskMissing, buildOppReply }; // V4.0 P1 技能④对话式建档
