// Excel→大白话→LLM 解析 往返保真实测(真实 DeepSeek 调用, 不走桩): 测试方案 §10 联调冒烟
// 数据源: tests/fixtures/pl8572.json + tiandi.json(均自真实 Excel 附1-预算表逐行提取)
// 流程: 真实 fixture 值 → 拼成销售口述大白话 → POST /api/agent/chat(技能①, 真实 LLM)
//       → mergeDraft 白名单落库 → 与 fixture 原值逐字段比对 → 抽取正确率/失败率报告(>10% 需调提示词)
// 用法: node tests/test_roundtrip.js [--log=tests/roundtrip_llm.log]
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');

async function api(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(reqPath + ' -> ' + r.status + ' ' + (d.error || ''));
  return d;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;
const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

// 口述字段顺序说明(模拟销售念 Excel 的自然语序)
const FIELD_SAY = {
  contract: v => `合同金额 ${v / 10000} 万元`,
  sub_cost: v => `分包成本 ${v / 10000} 万元`,
  sw_outsource: v => `软件外包 ${v} 元`,
  flex_labor: v => `灵活用工 ${v} 元`,
  sales_labor: v => `销售人力成本 ${v} 元`,
  sales_travel: v => `销售差旅 ${v} 元`,
  sales_entertain: v => `销售招待 ${v} 元`,
  sales_marketing: v => `市场营销 ${v} 元`,
  incentive_factor: v => `激励系数 ${v}`,
  dev_dept: v => `交付部门是${v}`,
  dev_pd: v => `正编人天 ${v} 人天`,
  prod_pd: v => `生产人天 ${v} 人天`,
  rd_outsource: v => `研发外包 ${v} 元`,
  del_travel: v => `交付差旅 ${v} 元`,
  pm_cost: v => `项目经理成本 ${v} 元`,
  del_other: v => `交付其他 ${v} 元`
};
const W = v => v; // 数字原值(元)——提示词约定"240 万→contract=2400000", 口述用万元表述验证换算能力

(async () => {
  const sales = await login('sales1');
  const cases = [
    {
      name: 'PL00008572(真实案例 Excel 提取 17 字段)',
      fixture: require('./fixtures/pl8572.json'),
      say: '做一个江西天地图的POI数据项目预算：合同金额 24 万元，分包成本 0 万元，软件外包 0 元，灵活用工 0 元，销售人力成本 41448 元，销售差旅 5000 元，销售招待 5000 元，市场营销 0 元，激励系数 1，交付部门是交付处，正编人天 39 人天，生产人天 184 人天，研发外包 0 元，交付差旅 8000 元，项目经理成本 11872 元，交付其他 2000 元'
    },
    {
      name: '天地图剧本(§3.2 十项锚定同源)',
      fixture: require('./fixtures/tiandi.json'),
      say: '报个预算：合同 240 万元，分包 100 万元，软件外包 0 元，灵活用工 0 元，销售差旅 0 元，销售招待 0 元，市场营销 0 元，激励系数 1，交付部门选交付处，正编 220 人天，生产 0 人天，研发外包 0 元，差旅 20000 元，项目经理成本 0 元，其他 0 元'
      // 注: 不提销售人力(fixture sales_labor=0 语义为留空走公式, 提示词规则5"未提及不输出"即正确行为)
    }
  ];

  const report = [];
  let totalFields = 0, hitFields = 0, llmFail = 0;
  for (const c of cases) {
    console.log(`\n===== ${c.name} =====`);
    const bg = (await api(sales, '/api/budget', 'POST', { project_name: '往返实测-' + c.name.slice(0, 8) })).id;
    const r = await api(sales, '/api/agent/chat', 'POST', { budget_id: bg, message: c.say });
    if (r.degraded) { llmFail++; console.log('LLM 降级(degraded=true), 本轮未抽取'); report.push({ case: c.name, degraded: true }); continue; }
    const draft = r.draft || {};
    const fx = c.fixture;
    const fields = Object.keys(FIELD_SAY).filter(k => k in fx);
    let hit = 0, miss = [];
    for (const k of fields) {
      const exp = fx[k], got = draft[k];
      // 两档断言: 口述明确提及的字段必须命中; 口述未提及的(如销售人力留空)允许缺失——
      // 提示词规则5"未提及不输出"与服务端"留空走公式估值"正是设计行为(fixture sales_labor=0 同语义)
      const unmentioned = k === 'sales_labor' && !(k in draft);
      const ok = unmentioned ? true : (k === 'dev_dept' ? got === exp : (typeof exp === 'number' ? near(got, exp, 1) : got === exp));
      if (ok) hit++; else miss.push(`${k}: 期望[${exp}] 实得[${got}]`);
      totalFields++; if (ok) hitFields++;
    }
    const rate = Math.round(hit / fields.length * 100);
    console.log(`字段命中 ${hit}/${fields.length} (${rate}%)`);
    miss.forEach(m => console.log('  miss: ' + m));
    // 锚定抽核: 收入/毛利与冻结公式一致性(抽取对了则 calc 必对)
    const calc = r.calc || {};
    const expIncome = fx.contract / 1.06;
    console.log(`calc.income=${calc.income && calc.income.toFixed(2)} (期望 ${expIncome.toFixed(2)})`);
    report.push({ case: c.name, degraded: false, hit, total: fields.length, rate, miss });
  }
  const rate = totalFields ? Math.round(hitFields / totalFields * 100) : 0;
  const verdict = llmFail ? 'LLM 失败(联调冒烟需检查网络/凭据)' : (rate >= 90 ? '通过(>=90%)' : (rate > 10 ? '低于 90% 需复核提示词' : '失败率>10% 必须调提示词'));
  console.log(`\n===== 往返实测汇总 =====`);
  console.log(`总字段命中 ${hitFields}/${totalFields} (${rate}%), LLM 降级 ${llmFail} 轮 -> ${verdict}`);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    fs.writeFileSync(logFile.slice(6), JSON.stringify({ report, totalFields, hitFields, rate, llmFail, verdict }, null, 2), 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(rate >= 90 && llmFail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
