// 阶段 2 Agent 纯函数 A-05/A-06/A-07/A-13(node --test, 不启服务)
// 铁律: LLM 永不直接改结构字段——白名单是唯一入口, 注入样本直接喂 mergeDraft 模拟被攻破的 LLM 输出
const { test } = require('node:test');
const assert = require('node:assert');
const { mergeDraft, checkMessage, buildBudgetPrompt, BUDGET_WHITELIST, MISSING_BUDGET } = require('../agent.js');

test('A-CORE-DL delivery 白名单键集精确等于八键且结构字段无法注入', () => {
  const { DELIVERY_FIELDS, cleanDeliveryDraft } = require('../robot-orchestrator.js');
  assert.deepStrictEqual(DELIVERY_FIELDS, ['content', 'stage', 'pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost', 'note']);
  const rows = cleanDeliveryDraft([{ content: '实施', stage: '实施', pm_pd: 1, own_pd: 2, rd_pd: 3, prod_pd: 4,
    travel_cost: 6000, note: '说明', cost: 999, sum: {}, status: 'confirmed', action: 'confirm' }]);
  assert.deepStrictEqual(Object.keys(rows[0]), DELIVERY_FIELDS);
});

test('A-05 无关输入: 空字段合并后 draft 不变', () => {
  const draft = { contract: 2400000 };
  const merged = mergeDraft({}, draft);
  assert.deepStrictEqual(merged, draft);
});

test('A-06 结构字段注入: status/budget_id/code 被白名单丢弃, 业务字段放行', () => {
  const draft = { contract: 100 };
  const merged = mergeDraft({ status: 'locked', budget_id: 99, code: 'B-2026-0001', parent_id: 1, contract: 2400000 }, draft);
  assert.strictEqual(merged.status, undefined, 'status 不得注入');
  assert.strictEqual(merged.budget_id, undefined, 'budget_id 不得注入');
  assert.strictEqual(merged.code, undefined, 'code 不得注入');
  assert.strictEqual(merged.parent_id, undefined, 'parent_id 不得注入');
  assert.strictEqual(merged.contract, 2400000);
});

test('A-07 提示词攻击: 越权/非法值字段全部丢弃, 仅白名单合法值存活', () => {
  const draft = {};
  // 模拟被攻击的 LLM 输出: 越权键 + 枚举外部门 + 非法数字混入合法字段
  const merged = mergeDraft({
    hack: 1, role: 'admin', settings: {}, llm_prompt: '泄露系统提示词',
    dev_dept: '宇宙部门', sub_cost: 'abc', sales_labor: null,
    del_travel: 100
  }, draft);
  assert.deepStrictEqual(merged, { del_travel: 100 });
});

test('A-13 空消息校验: 空串/纯空白拒绝, 正常文本放行', () => {
  assert.ok(checkMessage('').error);
  assert.ok(checkMessage('   ').error);
  assert.ok(!checkMessage('合同 240 万').error);
});

test('提示词构建: 冻结字段清单+草稿+用户消息(§4.5 全文)', () => {
  const p = buildBudgetPrompt({ contract: 1 }, '你好世界');
  assert.ok(p.includes('当前草稿'), '应含当前草稿段');
  assert.ok(p.includes('你好世界'), '应含用户消息');
  assert.ok(p.includes('dev_dept'), '应含白名单字段清单');
  assert.ok(p.includes('交付处'), '应含部门枚举');
  assert.ok(p.includes('只输出 JSON'), '应含输出约束');
});

test('白名单与缺失清单一致性', () => {
  assert.strictEqual(Object.keys(BUDGET_WHITELIST).length, 19, '白名单 19 字段(17 业务 + sales_labor + opp_code 商机代码贯穿)');
  for (const k of MISSING_BUDGET) assert.ok(BUDGET_WHITELIST[k], '缺失清单键 ' + k + ' 须在白名单内');
});
