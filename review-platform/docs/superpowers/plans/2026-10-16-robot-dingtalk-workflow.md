# 机器人与钉钉业务闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不接通真实钉钉、不改变既有业务状态机的前提下，交付可本地验收的统一机器人工作台、身份/目标映射、幂等外发箱、主动邀请和部门任务消息预览。

**Architecture:** 新增零依赖 `robot-orchestrator.js` 作为纯业务编排边界；`server.js` 继续拥有鉴权、SQLite 与既有预算/评审/交付状态迁移，编排器只净化交付文字抽取结果、生成标准消息并请求入箱。所有出站先写 `robot_outbox`，本轮 provider 恒为本地预演；钉钉适配器只返回“未激活”，绝不发网络请求。

**Tech Stack:** Node.js 22 内置 `http` / `crypto` / `node:sqlite` / `node:test`，原生 SPA，Python 3.12 + openpyxl 3.1.5（仅复用既有 Excel 入口），Playwright（仅浏览器验收）。

**Spec:** `docs/superpowers/specs/2026-10-16-robot-dingtalk-workflow-design.md`

## Global Constraints

- LLM 只做口语到白名单字段的翻译和缺项追问；不得判灯、算账、锁定、提交、打灯、确认结论或归档。
- Excel 只调用既有 `/api/opp/:code/delivery/import`、`/api/budget/import`、`/api/reviews/import`，不复制 Python 解析器。
- 不修改判灯、财务计算、预算锁定、评审提交和状态机。
- 不新增 npm 依赖；所有运行命令使用 `C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`。
- 不修改 `config.json`；测试开始和结束都核对原始字节与 SHA-256。
- 不调用真实钉钉，不写凭据，不申请权限，不把“未绑定/未激活”伪装成成功。
- 不通过 SQL 制造预算锁定、评审提交、打灯、研判、归档等业务状态；业务夹具全部走认证 HTTP。
- 不提交 git；每个任务结束仅保留工作区 diff、红绿证据和 SDD ledger 记录。
- 全量门会污染演示库，必须停任务自有服务、快照数据库、跑门、停服务、字节级恢复、语义复核、再重启。
- `createTasks()` 当前有两个源码调用点，其中新建评审分支受“新单禁止直接提交”门保护；入箱调用收敛在 `createTasks()` 内部，覆盖现在和未来所有调用点，不放松该门。

---

## File Map

- Create: `robot-orchestrator.js` — 交付文字白名单、标准输入输出、邀请/部门消息生成、本地与钉钉未激活适配器。
- Create: `tests/test_robot_orchestrator.js` — 纯函数与适配器边界永久测试。
- Create: `tests/test_robot_workbench.js` — 三张表、管理 API、工作台 API、主动邀请、幂等外发箱、任务分发永久 HTTP 测试。
- Create: `tests/h_robot_workbench_shots.js` — 统一工作台浏览器验收。
- Modify: `server.js` — 三表 DDL、外发箱 helper、管理/用户 API、delivery 对话分支、`createTasks()` 入箱。
- Modify: `public/app.js` — `#/agent?opp=` 统一工作台、机器人管理三个新页签、任务深链过滤。
- Modify: `tests/test_agent_core.js` — 把 delivery 白名单不变量纳入纯函数门。
- Modify: `tests/test_agent_chat.js` — delivery 对话降级与口头确认不迁移状态。
- Modify: `tests/test_robot_admin.js` — 既有 webhook 体系与新外发箱“不双发”回归。
- Modify: `tests/h_admin_shots.js` — 员工绑定、群目标、外发箱页签浏览器验收。
- Modify: `tests/run_all.js` — 注册三套新增永久测试。
- Modify: `.superpowers/sdd/2026-10-16-robot-dingtalk-workflow/progress.md` — 执行 ledger；仅记录任务状态、红绿证据和裁定。

---

### Task 1: 固化全部永久红测

**Files:**
- Create: `tests/test_robot_orchestrator.js`
- Create: `tests/test_robot_workbench.js`
- Create: `tests/h_robot_workbench_shots.js`
- Modify: `tests/test_agent_core.js`
- Modify: `tests/test_agent_chat.js`
- Modify: `tests/test_robot_admin.js`
- Modify: `tests/h_admin_shots.js`
- Modify: `tests/run_all.js`

**Interfaces:**
- Consumes: 现有认证、预算/评审/交付 API 和 `#/agent`、`#/admin/robot` 路由。
- Produces: RO（纯函数）、RW（HTTP）、AW（工作台浏览器）、AD-11~15（管理后台浏览器）永久断言；后续任务不得删除或放宽。

- [ ] **Step 1: 写纯函数红测**

在 `tests/test_robot_orchestrator.js` 直接导入计划中的导出：

```js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  DELIVERY_FIELDS, DELIVERY_SYSTEM_PROMPT, cleanDeliveryDraft,
  buildReviewInvite, buildTaskDispatches,
  createLocalProvider, createDingtalkProvider
} = require('../robot-orchestrator.js');

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
```

- [ ] **Step 2: 写 HTTP 红测**

`tests/test_robot_workbench.js` 使用每轮唯一 `PL-RW-<timestamp>`，所有业务状态只走 HTTP；只允许用只读 SQLite 查询新增三表和核对无敏感字段。至少实现这些判别性断言：

```text
RW-01 非 admin 对 bindings/targets/outbox/preview/cancel 全部 403。
RW-02 admin 可读写已有 user_id 的 binding；不存在 user_id=400；写绑定不改变 users.role/dept。
RW-03 target_key/status/provider/target_type 枚举校验，未绑定是合法状态。
RW-04 invite-review 仅销售支持组/admin 可调用，项目经理/销售经理/部门账号均 403。
RW-05 商机已有任何评审记录时邀请 409；无评审商机写 preview。
RW-06 同一 opp_code+target_user_id 重复邀请返回同一个 outbox id，表中只有一行。
RW-07 outbox payload 不含 token/key/secret/file data，只含工作台深链和可显示文字。
RW-08 provider 未激活时即使 target/binding 标 active 也不访问本地监听桩，状态仍 preview。
RW-09 GET workbench 返回 opp/delivery/budgets/reviews/provider/capabilities，不复制写接口。
RW-10 skill=delivery 返回净化后的 rows；注入 cost/sum/status/action 全丢弃。
RW-11 口头“确认交付预算/锁预算/提交评审”不改变三种状态。
RW-12 Excel 三按钮仍命中既有三个端点；解析错误不生成伪草稿。
RW-13 真实 HTTP 提交评审后，按部门而非按任务入箱；财务多任务只有一行。
RW-14 重复提交/重复 helper 命中幂等键；既有 notify webhook 不因新外发箱再发第二次。
RW-15 outbox cancel 仅 preview/ready 可取消，重复取消返回既有 cancelled；sent 不可取消。
```

fixture 清理只删除本套件自己创建、带唯一前缀的映射和外发箱记录；不得 SQL 更新业务表状态。

- [ ] **Step 3: 扩展既有 Agent 永久断言**

在 `tests/test_agent_core.js` 增加 delivery 白名单键集精确等值测试；在 `tests/test_agent_chat.js` 的 9801 桩增加：

```js
[/交付明细|差旅六千/, { rows: [{ content: '数据实施', stage: '实施', pm_pd: 2,
  own_pd: 3, rd_pd: 1, prod_pd: 4, travel_cost: 6000, note: '文字生成',
  cost: 999999, status: 'confirmed', action: 'confirm' }] }]
```

并断言 `skill='delivery'` 只回八键、HTTP 200、`opp_delivery.status` 仍是 `draft`，消息为“确认”时不得变成 `confirmed`。

- [ ] **Step 4: 写两套浏览器红测**

`tests/h_robot_workbench_shots.js` 使用 `pm1/123456` 和唯一商机，覆盖：

```text
AW-01 #/agent?opp=<code> 显示统一工作台和“本地预演，未连接钉钉”。
AW-02 附3/附1/评审信息表三个上传控件分别存在，accept=.xlsx。
AW-03 交付文字生成后只出现草稿行与人工“保存草稿/确认”按钮，不自动确认。
AW-04 项目预算和评审文字入口复用现有对话区，口头确认不迁移状态。
AW-05 页面显示交付/预算/评审真实状态及下一步深链。
AW-06 工作台 console.error/pageerror 为零并保存截图。
```

`tests/h_admin_shots.js` 增加：

```text
AD-11 机器人管理显示“本地预演，未连接钉钉”。
AD-12 员工绑定/群目标/外发箱三个页签都可点击且各只有一个活动页签。
AD-13 未绑定、preview、failed/cancelled 状态有明确中文，不显示“已送达”。
AD-14 外发箱 payload 以转义文本渲染，注入 HTML 不执行。
AD-15 两页新增交互阶段 console.error/pageerror 为零。
```

- [ ] **Step 5: 注册新增套件并取得旧实现红证据**

在 `tests/run_all.js` 注册：

```js
['RO-01~04 机器人编排纯函数', [NODE, ['--test', 'tests/test_robot_orchestrator.js']]],
['RW-01~15 机器人工作台与外发箱(HTTP)', [NODE, ['tests/test_robot_workbench.js']]],
['AW-01~06 机器人统一工作台浏览器层', [NODE, ['tests/h_robot_workbench_shots.js']]],
```

运行：

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --test tests/test_robot_orchestrator.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_workbench.js --log=tests/red_robot_workbench.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/h_robot_workbench_shots.js --log=tests/red_robot_workbench_ui.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/h_admin_shots.js --log=tests/red_robot_admin_tabs.txt
```

Expected: RO 因模块不存在失败；RW 因新端点 404/新表不存在而失败；AW/AD 因新控件不存在而失败。既有断言必须继续通过。用脚本内部 `fs.writeFileSync(..., 'utf8')` 保存日志，不使用 shell 管道或重定向。

---

### Task 2: 实现纯编排器和 provider 边界

**Files:**
- Create: `robot-orchestrator.js`
- Test: `tests/test_robot_orchestrator.js`
- Test: `tests/test_agent_core.js`

**Interfaces:**
- Consumes: 标准化 `review`、`tasks`、工作台 base URL 和注入的 `enqueue(record)`。
- Produces: `DELIVERY_FIELDS`、`DELIVERY_SYSTEM_PROMPT`、`cleanDeliveryDraft(rows)`、`buildReviewInvite()`、`buildTaskDispatches()`、`createRobotOrchestrator(deps)`、`createLocalProvider()`、`createDingtalkProvider()`。

- [ ] **Step 1: 写模块常量与交付净化函数**

```js
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
```

不得在此模块计算 `cost` 或 `sum`；计价仍只走 `server.js` 的 `deliverySumFor()`。

- [ ] **Step 2: 实现标准消息和幂等键**

```js
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
  return [...groups.entries()].map(([dept, rows]) => ({
    opp_code: review.opp_code || null, review_id: review.id, task_id: rows[0].id,
    event: 'task_dispatch', target_key: `dept:${dept}`, provider: 'dingtalk',
    idempotency_key: `task_dispatch:${review.id}:${review.round}:${dept}`,
    payload: {
      title: '前置评审任务分发', project: review.title, department: dept,
      pending_count: rows.length, task_ids: rows.map(r => r.id), indicators: rows.map(r => r.ind_name),
      link: `${baseUrl}/#/tasks?review_id=${review.id}`
    }
  }));
}
```

- [ ] **Step 3: 实现注入式编排器与未激活适配器**

`createRobotOrchestrator({ enqueue, baseUrl })` 只调用注入的 `enqueue`，返回 `outbox_ids`；标准输出固定为：

```js
{ reply: '', entity_refs: {}, missing: [], actions: [], outbox_ids: [] }
```

`createLocalProvider().sendDirect/sendGroup` 返回 `{ ok: false, preview: true }`；`fetchFile` 抛出“本地预演不下载外部文件”。`createDingtalkProvider()` 的五个方法全部抛出“钉钉适配器未激活”，且模块中不得出现 `fetch(`、`http.request(`、`https.request(`、`spawn('curl'`。

- [ ] **Step 4: 跑纯函数绿测**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --test tests/test_robot_orchestrator.js tests/test_agent_core.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check robot-orchestrator.js
```

Expected: RO 与既有 A-core 全部通过；`robot-orchestrator.js` 语法检查 exit 0。

---

### Task 3: 建立三表、幂等外发箱和管理 API

**Files:**
- Modify: `server.js:197-208`
- Modify: `server.js:2182-2335`
- Test: `tests/test_robot_workbench.js`

**Interfaces:**
- Consumes: `createRobotOrchestrator()` 产生的 record。
- Produces: 三张 SQLite 表、`enqueueRobotOutbox(record, actor)`、bindings/targets/outbox 管理 API；后续邀请和任务分发复用。

- [ ] **Step 1: 增加幂等 DDL**

在现有机器人三表之后增加：

```sql
CREATE TABLE IF NOT EXISTS robot_user_bindings(
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'dingtalk',
  external_user_id TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'unbound',
  updated_at TEXT, updated_by TEXT,
  PRIMARY KEY(user_id, provider)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_robot_binding_external
  ON robot_user_bindings(provider, external_user_id) WHERE external_user_id IS NOT NULL AND external_user_id != '';
CREATE TABLE IF NOT EXISTS robot_targets(
  target_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'dingtalk',
  target_type TEXT NOT NULL,
  external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'unbound',
  updated_at TEXT, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS robot_outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opp_code TEXT, review_id INTEGER, task_id INTEGER,
  event TEXT NOT NULL, target_key TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'dingtalk',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by INTEGER, created_at TEXT NOT NULL, sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_robot_outbox_status ON robot_outbox(status, id);
```

- [ ] **Step 2: 实现唯一入箱 helper**

```js
function enqueueRobotOutbox(record, actor) {
  const t = now();
  db.prepare(`INSERT INTO robot_outbox(
    opp_code,review_id,task_id,event,target_key,provider,payload_json,status,
    idempotency_key,created_by,created_at,attempts,last_error
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,NULL) ON CONFLICT(idempotency_key) DO NOTHING`)
    .run(record.opp_code || null, record.review_id || null, record.task_id || null,
      record.event, record.target_key, record.provider || 'dingtalk',
      JSON.stringify(record.payload || {}), 'preview', record.idempotency_key,
      actor && actor.id || null, t);
  return db.prepare('SELECT * FROM robot_outbox WHERE idempotency_key=?').get(record.idempotency_key);
}
```

本轮不把任何记录置为 `ready`：绑定或目标 active 只代表映射已配置，钉钉 provider 仍未激活。helper 不调用 `notifySafe()`，也不读取 webhook。

- [ ] **Step 3: 实现 bindings 与 targets 管理 API**

在现有 `/api/admin/robot` admin 总门内增加：

```text
GET /api/admin/robot/bindings
PUT /api/admin/robot/bindings/:userId
GET /api/admin/robot/targets
PUT /api/admin/robot/targets/:targetKey
```

验证规则固定为：

```js
const BINDING_STATUS = ['unbound', 'active', 'disabled'];
const TARGET_STATUS = ['unbound', 'active', 'disabled'];
const TARGET_TYPES = ['direct', 'group'];
```

PUT binding 先 `SELECT id FROM users WHERE id=?`，不存在返回 400；provider 仅 `dingtalk`；`external_user_id` 和 `phone` 只存字符串，不改 `users`。PUT target 只接受 `target_key` 为 `committee`、`sales_group`、`dept:<非空部门>`；`external_ref` 可空，空时 status 必须回落 `unbound`。

- [ ] **Step 4: 实现 outbox 管理 API**

```text
GET /api/admin/robot/outbox?status=&event=&limit=100
POST /api/admin/robot/outbox/preview
POST /api/admin/robot/outbox/:id/cancel
```

GET 最大 200 行，服务端解析 `payload_json` 后返回 `payload`，不回文件正文、token、secret 或 config。`preview` 只接受 `{event:'review_invite', opp_code, target_user_id}` 并调用与用户邀请相同 helper，禁止客户端提交任意 `payload_json`。cancel 只允许 `preview|ready`，重复取消幂等返回 cancelled，其他状态 409。

- [ ] **Step 5: 跑管理 API 专项绿测**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check server.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_workbench.js --only=admin --log=tests/green_robot_admin_api.txt
```

Expected: RW-01~03、RW-07、RW-15 通过；尚未实现的 workbench/invite/dispatch 条目继续按测试脚本分组跳过，不得用“缺端点也算通过”的条件断言。

---

### Task 4: 实现统一工作台 API、delivery 文字抽取和主动邀请

**Files:**
- Modify: `server.js:10-12`
- Modify: `server.js:1453-1602`
- Modify: `server.js:1700-1860`
- Test: `tests/test_agent_chat.js`
- Test: `tests/test_robot_workbench.js`

**Interfaces:**
- Consumes: `cleanDeliveryDraft()`、现有 `extractWithPolicy()`、`deliverySumFor()`、`enqueueRobotOutbox()`。
- Produces: `GET /api/robot/workbench`、`POST /api/robot/invite-review`、`skill='delivery'`；不新增预算或评审写接口。

- [ ] **Step 1: 引入编排器并定义角色常量**

```js
const {
  DELIVERY_SYSTEM_PROMPT, cleanDeliveryDraft,
  createRobotOrchestrator, buildReviewInvite, buildTaskDispatches,
  createLocalProvider, createDingtalkProvider
} = require('./robot-orchestrator.js');
const ROBOT_WORKBENCH_ROLES = ['项目经理', '销售经理', '销售支持组', 'admin'];
const ROBOT_INVITE_ROLES = ['销售支持组', 'admin'];
```

不得把部门 BP 加入邀请角色，不得让映射状态绕过角色判断。

- [ ] **Step 2: 增加 delivery 对话分支**

在 `/api/agent/chat` 的 `opp`、`review` 分支之前处理 `skill === 'delivery'`：

```js
if (skill === 'delivery') {
  if (!ROBOT_WORKBENCH_ROLES.includes(user.role)) return send(res, 403, { error: '仅项目经理/销售经理/销售支持组可使用机器人工作台' });
  const code = String(chatBody.opp_code || '').trim();
  const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
  if (!opp) return send(res, 404, { error: '商机档案不存在' });
  const current = db.prepare('SELECT rows_json,status FROM opp_delivery WHERE opp_code=?').get(code);
  const prior = current ? JSON.parse(current.rows_json || '[]') : [];
  let degraded = false, fields = {};
  try {
    const cfg = llmCfgFor('delivery', DELIVERY_SYSTEM_PROMPT);
    if (!cfg.base || !cfg.key) throw new Error('未配置大模型');
    fields = await extractWithPolicy({ rows: prior }, String(message).trim(), cfg);
  } catch (e) { degraded = true; }
  const rows = degraded ? prior : cleanDeliveryDraft(fields.rows);
  return send(res, 200, {
    reply: degraded ? '大模型暂不可用，本轮未改动交付草稿，请手工补齐。' : `已生成 ${rows.length} 行交付草稿，请检查后点保存；口头确认不生效。`,
    draft: { rows }, missing: rows.length ? [] : ['rows'],
    actions: rows.length ? [{ type: 'save_delivery_draft', label: '保存交付草稿', method: 'PUT', endpoint: `/api/opp/${encodeURIComponent(code)}/delivery` }] : [],
    degraded
  });
}
```

此分支不写 `opp_delivery`，前端只通过既有 PUT 保存；不返回 confirm 动作。

- [ ] **Step 3: 实现 workbench 只读聚合**

`GET /api/robot/workbench?opp_code=...`：

- 校验 `ROBOT_WORKBENCH_ROLES`。
- 读取 `opps`、`opp_delivery`、该商机 budgets/reviews。
- delivery 用 `deliverySumFor()` 返回服务端成本，不信任存储行的 cost。
- 返回 `provider:{name:'dingtalk',active:false,mode:'preview',message:'本地预演，未连接钉钉'}`。
- 返回 `capabilities`，只描述当前用户能否编制/邀请，不授予新权限。
- 不返回 config、secret、token、文件 base64。

- [ ] **Step 4: 实现主动邀请**

`POST /api/robot/invite-review` 和 admin preview 共用：

```js
function inviteReview(user, body) {
  if (!ROBOT_INVITE_ROLES.includes(user.role)) return { status: 403, data: { error: '仅销售支持组或 admin 可主动邀请' } };
  const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(String(body.opp_code || '').trim());
  if (!opp) return { status: 404, data: { error: '商机档案不存在' } };
  if (db.prepare('SELECT id FROM reviews WHERE opp_code=? LIMIT 1').get(opp.opp_code))
    return { status: 409, data: { error: '该商机已有评审草稿或流程记录' } };
  const target = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(Number(body.target_user_id) || 0);
  if (!target || !['项目经理', '销售经理'].includes(target.role))
    return { status: 400, data: { error: '接收人必须是已有项目经理或销售经理' } };
  const record = buildReviewInvite({ opp, targetUser: target, baseUrl: publicBaseUrl() });
  const row = enqueueRobotOutbox(record, user);
  return { status: 200, data: { ok: true, outbox_id: row.id, status: row.status, existing: row.created_by !== user.id } };
}
```

`publicBaseUrl()` 复用现有 `PUBLIC_BASE_URL` 读取方式，默认 `http://localhost:<PORT>`；不得把签名报告 token 用作工作台链接。

- [ ] **Step 5: 跑工作台 API 和 Agent 绿测**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_agent_chat.js --log=tests/green_robot_agent_chat.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_workbench.js --only=workbench --log=tests/green_robot_workbench_api.txt
```

Expected: RW-04~12 与新增 Agent delivery 条目通过；既有预算/评审对话断言不减少。

---

### Task 5: 在任务生成唯一入口按部门入箱

**Files:**
- Modify: `server.js:585-590`
- Modify: `server.js:1957-1968`
- Test: `tests/test_robot_workbench.js`
- Test: `tests/test_robot_admin.js`

**Interfaces:**
- Consumes: `createTasks(review, round)` 和 `buildTaskDispatches()`。
- Produces: 每个 `review_id + round + dept` 恰一条 `task_dispatch` preview；既有 notify 仍保持一次。

- [ ] **Step 1: 让 createTasks 返回真实插入任务并统一入箱**

```js
function createTasks(review, round) {
  const inds = INDICATORS[review.type] || [];
  const ins = db.prepare('INSERT INTO tasks(review_id,round,ind_key,ind_name,dept,standards) VALUES(?,?,?,?,?,?)');
  const rows = [];
  for (const ind of inds) {
    const r = ins.run(review.id, round, ind.key, ind.name, ind.dept, ind.standards);
    rows.push({ id: Number(r.lastInsertRowid), review_id: review.id, round,
      ind_key: ind.key, ind_name: ind.name, dept: ind.dept });
  }
  try {
    for (const record of buildTaskDispatches({ ...review, round }, rows, publicBaseUrl()))
      enqueueRobotOutbox(record, null);
  } catch (e) { console.error('robot_outbox 入箱失败(不阻断评审提交):', e.message); }
  return rows;
}
```

不得在两个调用点各写一份入箱逻辑；不得删除原 `notifySafe('notify', ..., event:'task_dispatch')`，过渡期测试必须证明 webhook 仍恰一次而不是外发箱再发一次。

- [ ] **Step 2: 真实 HTTP 产生任务并断言部门汇总**

测试用销售账号依次经 HTTP 创建商机、交付草稿、确认交付、创建预算、填写、锁定、创建评审、关联预算、提交。提交后只读检查：

```js
const tasks = await tasksOf(reviewId);
const deptCount = new Set(tasks.map(t => t.dept)).size;
const outbox = await adminGet(`/api/admin/robot/outbox?event=task_dispatch`);
assert.strictEqual(outbox.rows.filter(r => r.review_id === reviewId).length, deptCount);
```

财务 BP 多指标的 `payload.pending_count` 必须大于 1，`payload.task_ids` 必须与真实 tasks id 一致。

- [ ] **Step 3: 验证重复与通知故障不影响业务**

- 对相同 record 再调唯一 helper（通过 admin preview 不允许伪造 task event，因此测试直接重复提交应被业务门拒绝），表行数不变。
- 关闭 webhook 桩后再提交另一单，评审仍 200/reviewing，outbox 仍完整写入。
- 既有 RB-07/RB-08 继续证明 webhook 一次和失败不阻断。

- [ ] **Step 4: 跑任务分发绿测**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_workbench.js --only=dispatch --log=tests/green_robot_dispatch.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_admin.js --log=tests/green_robot_admin_regression.txt
```

Expected: RW-13~14 通过；RB 既有条目全部通过；无真实外网请求。

---

### Task 6: 实现 `#/agent?opp=` 统一工作台

**Files:**
- Modify: `public/app.js:1063-1504`
- Modify: `public/app.js` 的任务页渲染函数
- Test: `tests/h_robot_workbench_shots.js`

**Interfaces:**
- Consumes: `GET /api/robot/workbench`、现有三个 Excel 入口、`POST /api/agent/chat` 三个 skill、既有 PUT/confirm/lock/submit 动作。
- Produces: 商机上下文工作台；保留 `#/agent?b=` 与 `#/agent?r=` 旧深链。

- [ ] **Step 1: 在 renderAgent 最前增加 opp 路由**

```js
async function renderAgent() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const oppCode = q.get('opp');
  if (oppCode) return renderRobotWorkbench(oppCode);
  // 保留现有 b/r 分支原样
}
```

没有 `opp` 时不得改变现有预算、评审对话页。

- [ ] **Step 2: 渲染三段工作台**

页面固定包含：

```html
<div class="std-box" id="robotMode">本地预演，未连接钉钉；机器人只生成草稿，确认、锁定和提交必须由你点击。</div>
<nav class="tabbar" id="robotWorkbenchTabs">
  <button data-rwt="delivery">交付预算</button>
  <button data-rwt="budget">项目预算</button>
  <button data-rwt="review">项目评审</button>
</nav>
```

- 交付区：文字框 `#rwdText`、生成按钮、八列草稿表、`保存交付草稿`、既有确认端点按钮、附3上传 `#rwdFile`。
- 项目预算区：列该商机预算，进入 `#/agent?b=<id>`；无草稿时调用现有 `POST /api/budget`；附1上传调用 `/api/budget/import`。
- 评审区：列该商机评审，进入 `#/agent?r=<id>`；文字走现有 `skill=review`；信息表上传调用 `/api/reviews/import`。
- 每区显示真实 status；按钮是否可点以后端响应为准，不复制门禁。

- [ ] **Step 3: delivery 文字只生成，显式保存才写草稿**

```js
async function robotDeliveryText() {
  const d = await api('/api/agent/chat', 'POST', { skill: 'delivery', opp_code: window._robotWb.opp.opp_code, message: $('#rwdText').value });
  window._robotWb.deliveryDraft = (d.draft || {}).rows || [];
  renderRobotDeliveryDraft();
}
async function robotDeliverySave() {
  await api('/api/opp/' + encodeURIComponent(window._robotWb.opp.opp_code) + '/delivery', 'PUT', { rows: window._robotWb.deliveryDraft || [] });
  toast('交付预算草稿已保存，尚未确认');
  renderRobotWorkbench(window._robotWb.opp.opp_code);
}
```

不得根据回复文字自动调用 `/confirm`、`/lock` 或 `/submit`。

- [ ] **Step 4: 任务深链过滤而非伪造任务**

`#/tasks?review_id=N` 仍调用现有 `/api/tasks?scope=mine`，只在浏览器端把返回行过滤到该 `review_id` 并显示“来自机器人提醒”的筛选提示；清除筛选后显示全部。不得用 query 参数改变服务端部门鉴权。

- [ ] **Step 5: 跑工作台浏览器绿测**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check public/app.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/h_robot_workbench_shots.js --log=tests/green_robot_workbench_ui.txt
```

Expected: AW-01~06 全部通过，console/pageerror 均 0，截图写入既有 `tests/shots/` 命名空间且不覆盖其他套件截图。

---

### Task 7: 扩展机器人管理后台三个页签

**Files:**
- Modify: `public/app.js:2283-2394`
- Modify: `tests/h_admin_shots.js`

**Interfaces:**
- Consumes: bindings/targets/outbox 管理 API。
- Produces: 员工绑定、群目标、外发箱三个页签；保留既有实例/矩阵/白名单管理。

- [ ] **Step 1: 保留既有五区并增加业务接入卡**

在现有五张 card 后增加第六张 card：

```html
<div class="card" id="robotBusinessAdmin">
  <h3>业务机器人接入 <span class="pill p-yellow">本地预演，未连接钉钉</span></h3>
  <div class="tabbar">
    <button data-rba="bindings">员工绑定</button>
    <button data-rba="targets">群目标</button>
    <button data-rba="outbox">外发箱</button>
  </div>
  <div id="robotBusinessPane"></div>
</div>
```

更新 AD-05b 的 card 数为 6，但保留前五张标题逐项断言，不得把原管理能力藏掉。

- [ ] **Step 2: 员工绑定页签**

展示内部用户姓名/角色/部门、external_user_id、phone、status。保存只调用 `PUT /api/admin/robot/bindings/:userId`；文案明确“外部身份只用于路由，不授予平台权限”。未绑定显示 pill `未绑定`，disabled 显示 `已停用`。

- [ ] **Step 3: 群目标页签**

固定展示 `committee`、`sales_group` 以及当前指标部门的 `dept:<角色>` 行；可编辑 external_ref/status。未填 external_ref 时前端提交 `status:'unbound'`，不得生成假群 ID。

- [ ] **Step 4: 外发箱页签**

表格列：事件、商机/评审、目标、状态、创建时间、尝试次数、最后错误、操作。`payload.text` 和 `payload.link` 全部经 `esc()`；preview 显示“仅预演”，failed 显示错误，cancelled 显示“已取消”，只有 preview/ready 显示取消按钮。本轮不得显示“发送/重试”按钮。

- [ ] **Step 5: 跑管理后台浏览器绿测**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/h_admin_shots.js --log=tests/green_robot_admin_tabs.txt
```

Expected: 既有 AD-01~10 与新增 AD-11~15 全部通过；明文凭据断言继续为 0 命中；console/pageerror 为 0。

---

### Task 8: 专项收敛、静态审查与独立代码评审

**Files:**
- Modify: `tests/run_all.js`（仅在 Task 1 注册不完整时修正）
- Modify: `.superpowers/sdd/2026-10-16-robot-dingtalk-workflow/progress.md`
- Test: 所有本任务文件

**Interfaces:**
- Consumes: Task 1~7 全部实现和证据。
- Produces: 可进入全量门的专项绿基线；无 Critical/Important 审查问题。

- [ ] **Step 1: 跑语法与差异卫生检查**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check server.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check robot-orchestrator.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check public/app.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check tests/test_robot_workbench.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --check tests/h_robot_workbench_shots.js
git diff --check -- server.js robot-orchestrator.js public/app.js tests/test_agent_core.js tests/test_agent_chat.js tests/test_robot_admin.js tests/test_robot_orchestrator.js tests/test_robot_workbench.js tests/h_admin_shots.js tests/h_robot_workbench_shots.js tests/run_all.js
```

Expected: 全部 exit 0。若全工作区 `git diff --check` 被既有证据尾空格阻断，只能报告既有文件，不能改写历史证据凑绿。

- [ ] **Step 2: 跑全部专项套件**

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe --test tests/test_robot_orchestrator.js tests/test_agent_core.js
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_agent_chat.js --log=tests/green_robot_agent_chat.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_workbench.js --log=tests/green_robot_workbench.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/test_robot_admin.js --log=tests/green_robot_admin_regression.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/h_robot_workbench_shots.js --log=tests/green_robot_workbench_ui.txt
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/h_admin_shots.js --log=tests/green_robot_admin_tabs.txt
```

Expected: 0 failed；日志内无 `database is locked`、真实钉钉 URL、secret、token、LLM key。

- [ ] **Step 3: 作边界 grep**

必须逐项检查：

```text
robot-orchestrator.js 无 fetch/http.request/https.request/spawn('curl')。
新代码没有 UPDATE reviews SET status/light、UPDATE budgets SET status、UPDATE tasks SET light。
新测试没有 SQL UPDATE 业务状态。
新 API 没有第二套预算/评审/交付写入实现。
createTasks() 外没有第二处 task_dispatch 入箱 helper 调用。
config.json 不在 git diff，运行前后 SHA-256 一致。
```

- [ ] **Step 4: 独立代码评审**

请求 reviewer 只审本任务 diff，重点检查：权限绕过、幂等键、XSS、敏感信息、外网调用、状态机越权、双发、条件断言空转。Critical/Important 必须修复并重跑受影响专项；Minor 只有与 spec 直接相关才改，避免扩项。

---

### Task 9: 快照保护全量门与最终浏览器验收

**Files:**
- Create/Delete during execution: `tests/_tmp_robot_gate_snapshot.js`
- Modify: `.superpowers/sdd/2026-10-16-robot-dingtalk-workflow/progress.md`
- Evidence: `tests/green_run_robot_workflow.txt`
- Evidence: `tests/green_run_robot_workflow_meta.txt`

**Interfaces:**
- Consumes: Task 8 专项全绿状态。
- Produces: 恢复后的演示数据库、全量门证据、最终 UI/HTTP 语义证据。

- [ ] **Step 1: 核对服务所有权并停任务自有服务**

只停止本会话启动的 8600 服务；如果 PID 归属不明，不得杀进程。记录停止前 `/api/me=401`、Node PID 和 `config.json` SHA-256。

- [ ] **Step 2: 创建数据库外部快照和语义清单**

`tests/_tmp_robot_gate_snapshot.js` 使用 `fs.copyFileSync` 将 `data/review.db` 复制到仓库外带时间戳文件，并只读输出：六份七月商机的 delivery/budget/review 终态、PL00008572 锚点、新增三表计数、所有 outbox 状态分布。不得把数据库放入 git。

- [ ] **Step 3: 启动任务自有服务并跑完整 run_all**

Run:

```text
C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe tests/run_all.js --log=tests/green_run_robot_workflow.txt
```

Expected: `SUITES.length/SUITES.length 套通过 -> ALL PASS`；实际套数以运行时 `SUITES` 为准，不在报告硬编码旧的 29。

- [ ] **Step 4: 停服务并字节级恢复数据库**

用同一临时脚本恢复快照，比较 SHA-256 全串一致后再删除外部快照。随后只读复核：

```text
六份七月商机仍在；六份 delivery=confirmed；六份 budget=locked；
五份 review=archived/yellow；PL00007297=returned/red；
PL00008572 delivery=confirmed；门夹具前缀计数为 0；
机器人专项夹具前缀计数为 0；新增三表恢复到门前计数与状态分布。
```

- [ ] **Step 5: 重启并做最终浏览器验收**

新鲜运行 `h_robot_workbench_shots.js` 与 `h_admin_shots.js`，再人工用项目经理打开代表商机工作台、用 admin 打开三个管理页签。确认：本地预演文案、上传/文字入口、人工确认按钮、任务深链、未绑定/preview 状态、无闪烁、console/pageerror 为零。

- [ ] **Step 6: 写 meta、删除临时件并完成 ledger**

`tests/green_run_robot_workflow_meta.txt` 记录：HEAD、套件数、末行、专项计数、数据库恢复 SHA、`config.json` SHA、`/api/me=401`、外发请求计数 0。删除 `_tmp_robot_gate_snapshot.js` 和外部快照；不提交 git。

---

## Self-Review Results

- Spec coverage: 工作台、delivery 独立白名单、三张表、主动邀请、两个 `createTasks()` 调用点的统一覆盖、管理 API、三个新页签、local/dingtalk provider 边界、浏览器验收、快照保护全量门均有任务。
- Scope correction: 不把现有 webhook 实例误当作钉钉企业应用 provider；本轮所有新 outbox 均保持 `preview`，因此没有伪造 `ready/sent`。
- State-machine correction: delivery 对话只返回草稿与既有 PUT 动作；确认、锁定、提交均不由编排器执行。
- Placeholder scan: 无 TBD/TODO/“同 Task N”或未定义接口。
- Type consistency: delivery 行固定八键；标准 outbox record、幂等键、provider 方法和前后端 endpoint 名称逐任务一致。
- Execution policy: 用户已预授权无人值守采用推荐方案，因此计划完成后直接进入 subagent-driven-development；不再询问执行方式。