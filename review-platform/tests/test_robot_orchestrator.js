const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
let orchestrator;
try {
  orchestrator = require('../robot-orchestrator.js');
} catch (e) {
  if (!process.env.RO_RED_CHILD) {
    const env = { ...process.env, RO_RED_CHILD: '1' };
    // 继承 child-v8 会让 Node 将独立 runner 误判为递归调用并跳过。
    delete env.NODE_TEST_CONTEXT;
    const r = require('child_process').spawnSync(process.execPath, ['--test', '--test-reporter=tap', __filename], {
      encoding: 'utf8', env
    });
    const passed = (r.stdout.match(/^# pass (\d+)$/m) || [])[1];
    const failed = (r.stdout.match(/^# fail (\d+)$/m) || [])[1];
    if (r.status !== 1 || passed === undefined || failed === undefined) throw new Error('RO runner 无法取得预期 RED 汇总');
    fs.writeFileSync(path.join(__dirname, 'red_robot_orchestrator.txt'),
      'EXPECTED RED - robot-orchestrator.js 尚未实现\n' + r.stdout + '\n' + passed + ' passed, ' + failed + ' failed -> SOME FAIL\n', 'utf8');
  }
  throw e;
}
const {
  DELIVERY_FIELDS, DELIVERY_SYSTEM_PROMPT, cleanDeliveryDraft,
  buildReviewInvite, buildTaskDispatches,
  createLocalProvider, createDingtalkProvider
} = orchestrator;

test('RO-01 delivery 只保留八个字段并丢弃 cost/sum/status/action', () => {
  const rows = cleanDeliveryDraft([{ content: '实施', stage: '实施', pm_pd: '2', own_pd: 3,
    rd_pd: 4, prod_pd: 5, travel_cost: 6000, note: '说明', cost: 999, sum: {}, status: 'confirmed', action: 'confirm' }]);
  assert.deepStrictEqual(Object.keys(rows[0]), DELIVERY_FIELDS);
  assert.strictEqual(rows[0].cost, undefined);
  assert.strictEqual(rows[0].status, undefined);
});

test('RO-02 delivery 提示词禁止成本合计和确认动作', () => {
  assert.match(DELIVERY_SYSTEM_PROMPT, /只允许字段/);
  assert.match(DELIVERY_SYSTEM_PROMPT, /禁止.*成本.*合计.*状态.*确认/);
});

test('RO-03 部门任务按 review+round+dept 汇总并生成稳定幂等键', () => {
  const rows = buildTaskDispatches({ id: 7, round: 2, title: '项目甲', opp_code: 'PL-7' }, [
    { id: 11, dept: '财务BP', ind_name: '付款条件' },
    { id: 12, dept: '财务BP', ind_name: '信用评估' },
    { id: 13, dept: '法务', ind_name: '签约路径' }
  ], 'http://localhost:8600');
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].idempotency_key, 'task_dispatch:7:2:财务BP');
  assert.deepStrictEqual(rows[0].payload.task_ids, [11, 12]);
});

test('RO-04 local provider 永远预演，dingtalk provider 明确未激活', async () => {
  assert.deepStrictEqual(await createLocalProvider().health(), { active: false, mode: 'preview' });
  await assert.rejects(createDingtalkProvider().sendGroup({}, {}), /未激活/);
});

// Fix round 1/5 追加: provider 五方法与编排器唯一出口须各有永久断言, 不许只射一个
test('RO-05 dingtalk provider 五方法逐个抛未激活', async () => {
  const dp = createDingtalkProvider();
  assert.deepStrictEqual(Object.keys(dp).sort(),
    ['fetchFile', 'health', 'resolveActor', 'sendDirect', 'sendGroup'], 'provider 接口固定五方法');
  for (const m of ['resolveActor', 'sendDirect', 'sendGroup', 'fetchFile', 'health']) {
    assert.strictEqual(typeof dp[m], 'function', m + ' 须为函数');
    await assert.rejects(() => dp[m]({}, {}), /未激活/, m + ' 须拒绝');
  }
});

test('RO-06 local provider 五方法全为预演且无真实结果', async () => {
  const lp = createLocalProvider();
  assert.deepStrictEqual(Object.keys(lp).sort(),
    ['fetchFile', 'health', 'resolveActor', 'sendDirect', 'sendGroup'], 'provider 接口固定五方法');
  assert.deepStrictEqual(await lp.resolveActor({ external_user_id: 'x' }), { ok: false, preview: true });
  assert.deepStrictEqual(await lp.sendDirect({}, {}), { ok: false, preview: true });
  assert.deepStrictEqual(await lp.sendGroup({}, {}), { ok: false, preview: true });
  await assert.rejects(() => lp.fetchFile('file-ref'), /本地预演不下载外部文件/);
  assert.deepStrictEqual(await lp.health(), { active: false, mode: 'preview' });
});

test('RO-07 编排器唯一出口是注入的 enqueue 且必须拿到整数 outbox_id', async () => {
  const { createRobotOrchestrator } = orchestrator;
  const baseUrl = 'http://localhost:8600';
  const opp = { opp_code: 'PL-RO7', title: '编排器甲' };
  const targetUser = { id: 11 };
  const review = { id: 71, round: 1, title: '编排器甲', opp_code: 'PL-RO7' };
  const tasks = [{ id: 1, dept: '财务BP', ind_name: '付款条件' },
    { id: 2, dept: '财务BP', ind_name: '信用评估' }, { id: 3, dept: '法务', ind_name: '签约路径' }];
  const received = [];
  const enqueue = rec => { received.push(rec); return { id: 500 + received.length }; };
  const orch = createRobotOrchestrator({ enqueue, baseUrl });
  // (b) 无第二出口: 编排器只暴露两个路由方法, 且 record 未被改写、调用次数恰等
  assert.deepStrictEqual(Object.keys(orch).sort(), ['dispatchTasks', 'inviteReview']);
  // (a) 标准输出五键固定, outbox_ids 逐项取自注入 enqueue 的返回
  assert.deepStrictEqual(orch.inviteReview({ opp, targetUser }),
    { reply: '', entity_refs: {}, missing: [], actions: [], outbox_ids: [501] });
  assert.deepStrictEqual(orch.dispatchTasks(review, tasks),
    { reply: '', entity_refs: {}, missing: [], actions: [], outbox_ids: [502, 503] });
  assert.strictEqual(received.length, 3, '恰三次入箱, 无重复出口');
  assert.deepStrictEqual(received[0], buildReviewInvite({ opp, targetUser, baseUrl }), '入箱的须是标准邀请原文');
  assert.deepStrictEqual(received.slice(1), buildTaskDispatches(review, tasks, baseUrl), '入箱的须是部门汇总原文');
  // (c) 钉 I3: enqueue 没给出整数 id 必须抛错, 不得静默 push undefined 当成功
  for (const [label, ret] of [['无 id 行对象', {}], ['字符串 id', { id: '501' }], ['NaN id', { id: NaN }],
    ['null 返回', null], ['undefined 返回', undefined], ['Promise 返回', Promise.resolve(501)]]) {
    const hostile = createRobotOrchestrator({ enqueue: () => ret, baseUrl });
    await assert.rejects(() => Promise.resolve().then(() => hostile.inviteReview({ opp, targetUser })),
      /未返回整数 outbox_id/, label);
  }
  // 整数形态两兼容: 行对象 .id 与直接数字都算成功
  assert.deepStrictEqual(createRobotOrchestrator({ enqueue: () => 42, baseUrl })
    .dispatchTasks(review, [{ id: 9, dept: '法务', ind_name: '签约路径' }])
    .outbox_ids, [42]);
});

// Fix round 1/5 追加(I1+I2): 服务侧降级轮 rows = cleanDeliveryDraft(prior) 的八键预算行保真不变式,
// 必须是纯函数断言——RW-10 走真网关, 断网/换机时那条绿会假红, 净化契约不能挂在外网可达性上。
// 夹具四行全取库内真实存行形状(deliverySumFor 落库的九键形式), 无预算数字行按新口径剔除。
test('RO-08 已存四行净化为三行预算明细且剔净 cost(纯文字行不得保留)', () => {
  const stored = [
    // ① PL00008210《长沙智慧消防一张图及辅助决策信创改造》附3 首行: 人天+差旅齐, cost 为服务端算出的第九键
    { content: '长沙消防一张图信创改造', stage: '实施', pm_pd: 20, own_pd: 37, rd_pd: 10, prod_pd: 0, travel_cost: 14400, note: '', cost: 24350 },
    // ② 同单零值行: content 不能单独保留明细，功能回归测试须被剔除
    { content: '功能回归测试', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '', cost: 0 },
    // ③ PL00008572《南昌市POI数据》真实运维行: 存行根本没有 travel_cost 键(旧路径落库), 净化须补 0 而非漏键
    { content: '南昌市POI数据', stage: '运维', pm_pd: 2, own_pd: 0, rd_pd: 0, prod_pd: 0, note: '', cost: 0 },
    // ④ 只有 travel_cost 的边界行: 数字是唯一存活凭据
    { content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 1200, note: '', cost: 1200 }
  ];
  // 夹具自证: 输入必须真带第九键、且 ③ 确实缺 travel_cost, 否则下面的八键断言是空转的绿
  assert.ok(stored.every(r => Object.prototype.hasOwnProperty.call(r, 'cost')), '夹具须是 deliverySumFor 的九键落库形状');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stored[2], 'travel_cost'), false, '③ 必须保持存行缺 travel_cost 键的原状');

  const once = cleanDeliveryDraft(stored);
  const twice = cleanDeliveryDraft(once);

  // (a) 只保留三条预算数字行: 纯文字剔除，只有差旅仍保留
  assert.strictEqual(once.length, 3, '四条存行应剔除无预算数字的功能回归测试，仅留三条');
  assert.ok(!once.some(r => r.content === '功能回归测试'), '功能回归测试不得作为纯文字明细保留');
  // (b) 每行严格八键, cost/sum/status/action 一律不存在
  once.forEach((r, i) => {
    assert.deepStrictEqual(Object.keys(r), DELIVERY_FIELDS, '第' + i + '行键序须恰为八键');
    for (const leak of ['cost', 'sum', 'status', 'action']) assert.strictEqual(r[leak], undefined, '第' + i + '行泄漏 ' + leak);
  });
  // (c) 幂等: 服务侧用 cleanDeliveryDraft(prior) 不会因 filter/截断二次漂移
  assert.deepStrictEqual(twice, once);
  // 值保真: 数字与文本原样, 缺键补 0, stage 归一不把运维洗成实施
  assert.deepStrictEqual(once[0], { content: '长沙消防一张图信创改造', stage: '实施', pm_pd: 20, own_pd: 37,
    rd_pd: 10, prod_pd: 0, travel_cost: 14400, note: '' });
  assert.deepStrictEqual(once[1], { content: '南昌市POI数据', stage: '运维', pm_pd: 2, own_pd: 0,
    rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '' });
  assert.deepStrictEqual(once[2], { content: '', stage: '实施', pm_pd: 0, own_pd: 0,
    rd_pd: 0, prod_pd: 0, travel_cost: 1200, note: '' });
  // 内容或备注均不能单独保留无预算数字行
  assert.deepStrictEqual(cleanDeliveryDraft([{ content: '纯文字', note: '备注' }]), []);
  assert.deepStrictEqual(cleanDeliveryDraft([{ content: '', stage: '实施', pm_pd: 0, own_pd: 0,
    rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '只有备注', cost: 0 }]), []);
});

// I-1 修复轮(spec §5.4.4 第4句覆盖缺口): 群任务消息必须自带「截止提示」。
// tasks 表没有 due 列, 无真数据源 → 只允许诚实的 advisory 文案, 因此同一条断言还要钉住
// 「出现具体日期/星期/天数即为编造」与「不得夹带可改变状态的回调」(§5.4.4 第4句后半句)。
test('RO-09 部门任务消息含非空截止提示且不含编造日期(spec §5.4.4)', () => {
  const review = { id: 91, round: 1, title: '截止提示甲', opp_code: 'PL-RO9' };
  const tasks = [
    { id: 21, dept: '财务BP', ind_name: '付款条件' },
    { id: 22, dept: '财务BP', ind_name: '信用评估' },
    { id: 23, dept: '法务', ind_name: '签约路径' },
    { id: 24, dept: '技术', ind_name: '交付可行性' }
  ];
  const rows = buildTaskDispatches(review, tasks, 'http://localhost:8600');
  // 夹具自证: 必须真跨三部门, 否则下面的逐行断言会在单部门退化汇总上空转
  assert.strictEqual(rows.length, 3, '夹具须真跨三部门');
  rows.forEach(r => {
    const h = r.payload.deadline_hint;
    assert.strictEqual(typeof h, 'string', '截止提示须为文本: ' + r.target_key);
    assert.ok(!!h && h.trim().length > 0, '截止提示不得为空: ' + r.target_key);
    assert.ok(/(及时|尽快|按期)/.test(h), '缺催办时间语义: ' + h);
    assert.ok(/(打灯|评审)/.test(h), '未指向前置评审打灯: ' + h);
    // 无 due 列即无日期来源: 数字或历法字样一律判为编造
    assert.strictEqual(/\d/.test(h), false, '截止提示含数字即属编造: ' + h);
    assert.strictEqual(/[一二三四五六日周月号天]/.test(h), false, '截止提示含历法口径即属编造: ' + h);
    assert.strictEqual(/(点击|按钮|确认|锁定|提交)/.test(h), false, '截止提示不得夹带状态动作: ' + h);
  });
  // 补齐而非放宽: 原七键一个不少, 净增恰 deadline_hint 一键
  const keys = Object.keys(rows[0].payload);
  ['title', 'project', 'department', 'pending_count', 'task_ids', 'indicators', 'link']
    .forEach(k => assert.ok(keys.includes(k), '原键丢失: ' + k));
  assert.strictEqual(keys.length, 8, 'payload 须为原七键 + 截止提示: ' + keys.join(','));
  // 纯函数与无来源差异: 同输入两次逐字相同, 各部门只能同一句诚实催办
  assert.deepStrictEqual(buildTaskDispatches(review, tasks, 'http://localhost:8600'), rows);
  assert.strictEqual(new Set(rows.map(r => r.payload.deadline_hint)).size, 1, '无 due 数据源时不得按部门编造不同期限');
});
