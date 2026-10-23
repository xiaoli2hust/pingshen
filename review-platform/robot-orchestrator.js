// 机器人编排边界(纯函数): 交付文字净化 + 标准消息生成 + provider 边界
// 铁律: 本模块不判灯、不算账、不写状态、不访问网络; 计价只走 server.js 的 deliverySumFor()
const DELIVERY_FIELDS = ['content', 'stage', 'pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost', 'note'];
const DELIVERY_SYSTEM_PROMPT = `你是交付预算明细抽取器。只输出 {"fields":{"rows":[...]}}。
只允许字段：content, stage, pm_pd, own_pd, rd_pd, prod_pd, travel_cost, note。
stage 只能是实施或运维；人天与差旅只能是非负数字。用户未提及的不编造。
禁止输出或计算行成本、合计、预算状态、确认动作、锁定动作、提交动作。`;
const number0 = v => {
  const n = typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};
function cleanDeliveryDraft(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    content: String((r || {}).content || '').trim().slice(0, 200),
    stage: (r || {}).stage === '运维' ? '运维' : '实施',
    pm_pd: number0((r || {}).pm_pd), own_pd: number0((r || {}).own_pd),
    rd_pd: number0((r || {}).rd_pd), prod_pd: number0((r || {}).prod_pd),
    travel_cost: number0((r || {}).travel_cost),
    note: String((r || {}).note || '').trim().slice(0, 500)
  })).filter(r => r.content || r.pm_pd || r.own_pd || r.rd_pd || r.prod_pd || r.travel_cost);
}

function buildReviewInvite({ opp, targetUser, baseUrl }) {
  const target_key = `user:${targetUser.id}`;
  return {
    opp_code: opp.opp_code, event: 'review_invite', target_key, provider: 'dingtalk',
    idempotency_key: `review_invite:${opp.opp_code}:${targetUser.id}`,
    payload: {
      title: '待编制项目评审',
      text: `${opp.title}(${opp.opp_code}) 等待编制评审材料`,
      link: `${baseUrl}/#/agent?opp=${encodeURIComponent(opp.opp_code)}`
    }
  };
}

function buildTaskDispatches(review, tasks, baseUrl) {
  const groups = new Map();
  for (const task of tasks || []) {
    if (!groups.has(task.dept)) groups.set(task.dept, []);
    groups.get(task.dept).push(task);
  }
  // spec §5.4.4 要求消息含截止提示; tasks 表没有 due 列, 无真数据源即不编造日期, 只给诚实催办
  return [...groups.entries()].map(([dept, rows]) => ({
    opp_code: review.opp_code || null, review_id: review.id, task_id: rows[0].id,
    event: 'task_dispatch', target_key: `dept:${dept}`, provider: 'dingtalk',
    idempotency_key: `task_dispatch:${review.id}:${review.round}:${dept}`,
    payload: {
      title: '前置评审任务分发', project: review.title, department: dept,
      pending_count: rows.length, task_ids: rows.map(r => r.id), indicators: rows.map(r => r.ind_name),
      deadline_hint: '请及时完成本部门前置评审并打灯',
      link: `${baseUrl}/#/tasks?review_id=${review.id}`
    }
  }));
}

// 出站只经注入的 enqueue 入箱, 本模块不发送、不改状态
function createRobotOrchestrator({ enqueue, baseUrl } = {}) {
  const push = records => {
    const outbox_ids = [];
    for (const record of records) {
      const r = enqueue(record);
      const id = typeof r === 'number' ? r : (r || {}).id;
      // enqueue 返回 Promise 或无 id 行时不能静默算成功: 入箱失败必须炸给调用方
      if (!Number.isInteger(id)) throw new Error('robot enqueue 未返回整数 outbox_id');
      outbox_ids.push(id);
    }
    return { reply: '', entity_refs: {}, missing: [], actions: [], outbox_ids };
  };
  return {
    inviteReview: input => push([buildReviewInvite({ ...input, baseUrl })]),
    dispatchTasks: (review, tasks) => push(buildTaskDispatches(review, tasks, baseUrl))
  };
}

function createLocalProvider() {
  return {
    resolveActor: async () => ({ ok: false, preview: true }),
    sendDirect: async () => ({ ok: false, preview: true }),
    sendGroup: async () => ({ ok: false, preview: true }),
    fetchFile: async () => { throw new Error('本地预演不下载外部文件'); },
    health: async () => ({ active: false, mode: 'preview' })
  };
}

function createDingtalkProvider() {
  const inactive = async () => { throw new Error('钉钉适配器未激活'); };
  return { resolveActor: inactive, sendDirect: inactive, sendGroup: inactive, fetchFile: inactive, health: inactive };
}

module.exports = {
  DELIVERY_FIELDS, DELIVERY_SYSTEM_PROMPT, cleanDeliveryDraft,
  buildReviewInvite, buildTaskDispatches,
  createRobotOrchestrator, createLocalProvider, createDingtalkProvider
};
