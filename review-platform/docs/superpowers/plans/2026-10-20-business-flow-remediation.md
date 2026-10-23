# 评审平台业务流整改（29 项一次做完）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **本次执行方式（自行裁定，spec 已批准故跳过选择门）**：29 项改动高度集中在 `server.js` / `public/app.js` 两个大文件，任务间共享同一组夹具与同一个共享演示库（每次跑套件都要停机快照还原），并行子代理会互相覆盖同一文件且争用 8600 端口，故采用 **executing-plans 式主代理串行执行**；独立性由「每组完成后派独立审查子代理只读审查 diff」保证。

**Goal:** 把系统从「流程正确、决策无据」改成「流程正确、决策有据、缺口可见」：打灯弹窗呈现 A/B/C 三类证据、三步链就绪态前置、导航与 IA 补全、退回不留僵尸任务、代打可见、看板去夹具、通知积压可见、change 导入禁用，并一次性清理演示库夹具。

**Architecture:** 服务端只追加只读能力（`IND_EVIDENCE` 映射常量、`judgeCoverage` 只读镜像、`isFixtureCode` 谓词、`GET /api/tasks/:id/evidence`、360/详情/任务列表的追加键），唯一写语义变化是退回时同轮兄弟 pending → `'cancelled'`（spec §3.3 已批准）与档案 PUT 补事件留痕；前端在既有渲染器内追加区块，夹具过滤在客户端按 `/api/meta/fields` 下发的 `fixtureCodePattern` 统一执行；组 5 用独立清理脚本按显式 id 清单删夹具。

**Tech Stack:** Node 22 内置模块（http/fs/path/crypto/node:sqlite，零 npm）；Python 3.12 + openpyxl（仅既有解析器）；Playwright（仅浏览器验收套件，`E:\npm-global\node_modules\playwright`，`channel:'chrome'`）。

**Spec:** `docs/superpowers/specs/2026-10-20-business-flow-remediation-design.md`（权威；冲突一律以 spec 为准，偏离处见下文「动态裁定」并记 ledger）。

## Global Constraints（逐条来自用户任务单与 spec §3.2，对所有任务隐式生效）

- 不创建任何 git commit、不 push、不建 PR、不 amend；保留用户已有未提交改动，不覆盖、不丢弃、不 stash、不 reset、不 clean。禁 `git add -A`。
- 不修改 `config.json`（270B / sha256 前16 `f285c66ad4790370`，未入库），不写入或输出任何凭据，不申请权限。
- 不调用真实钉钉、外部网络或其他共享服务；机器人/outbox 始终本地 preview，`provider.active=false`，`capabilities.provider_send=false`。
- 零 npm 运行时依赖；Node 一律用 `C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`（下称 `$N`），不得用 PATH 上的 Node 18。
- LLM 仅做口语→结构化字段与缺项追问；不判灯、不算账、不锁定、不提交、不确认结论。
- 除 spec 批准的 `tasks.status='cancelled'` 外，不改判灯引擎（`judge()` 一字不改）、财务计算（`finance.js` 零 diff）、预算锁定、`reviews` 状态机、结论/归档权限、数据库 schema（零 ALTER）。
- 不用 SQL 伪造算账、锁定、提交、判灯、退回、归档或结论等业务终态；测试夹具一律走带鉴权 HTTP 真实链路，跑完清理（还原快照）。
- 部门专属判断依据留在部门系统；平台只展示 A/B/C 证据类别、明确措辞与查询锚点，禁止虚构平台权威字段（不新增采集字段）。
- 夹具识别只以服务端 `isFixtureCode` 为单一来源，经 `/api/meta/fields` 的 `fixtureCodePattern` 下发；前端不得复制第二份正则；不得挪用 `reviews.era`。
- 中文文件与测试证据一律 UTF-8，由脚本内部 `fs.writeFileSync(...,'utf8')` 落盘；禁止 shell 重写中文；Git Bash 禁止长输出接管道（写日志后 Read）。
- 不擅自杀进程；8600 服务按 CIM 双采样确认 PID，只停本任务自起或已明确归属（`node.exe server.js`，本项目会话所起）的进程。
- 共享演示库保护：任何写库套件前停机→字节快照→ID 清单；跑完停机→按字节还原→SHA256 全串 + 逐表 `SELECT * ORDER BY rowid` JSON 指纹比对；保留 REAL7 商机、6 张真实评审/预算与 PL00008572 锚点。
- 时间窗（Asia/Shanghai，Git Bash 用 `date -u` +8h）：07:40 起只做安全收尾；07:55 后不再修改/测试；08:00 前终止。

## 文件结构与职责

| 文件 | 职责 / 本轮改动 |
|---|---|
| `server.js` | `IND_EVIDENCE`/`EXT_HINT`/`indEvidence()`/`isFixtureCode`（`TYPE_NAMES` 后）；`QUANT_ITEMS`/`judgeCoverage()`（紧邻 `judge()` 后，互指注释）；`evidenceFor()`；meta 追加 `indEvidence`/`fixtureCodePattern`；`GET /api/tasks/:id/evidence`；任务列表 `stats`/`dispatch`/代打标注；退回同轮兄弟 cancelled；完成时代打事件；360 追加 `launch`/`profile_can_edit`/`profile_events`；详情追加 `coverage`；档案 PUT 字段级事件；outbox `backlog`；能力文案 |
| `public/app.js` | `META` 加载与 `isFixture()`；「包含测试数据」开关；打灯弹窗证据区；结论页覆盖卡；就绪三态与表单就绪条；编辑态关联预算；下一步指引；导航；预算单页；360 预算卡/档案编辑/分析时间线；任务中心进度/筛选/分页/代打/僵尸；研判台 tile；首页 tile 拆分与待办横幅；商机列表空码独立行；归档/向导文案；change 导入禁用；colspan 常量 |
| `tests/test_flow_remediation.js`（新） | HTTP 专项：EV-01~04/06、RD-01/03、IA-47、SM-01/02、NT-01/02、MT（meta 对账） |
| `tests/h_remediation_shots.js`（新） | 浏览器专项：EV-05、RD-02、IA-44~50、SM-03/04、NT-01 UI、CH-01、PL-02、DG-05 |
| `tests/run_all.js` | SUITES 追加上述两套（套数以实测为准） |
| 既有受影响套件 | 仅在断言语义被 spec 显式改变处同步（不放宽），逐处记 ledger |
| `tools/cleanup_fixtures.js`（新） | 组 5 一次性清理：显式 id 清单落盘 → 5 条前置断言 → 删除；ABORT 只写 scratch |
| `docs/打灯证据对账表.md`（新） | 19 项指标 A/B/C 对账（含统计口径更正） |
| `docs/待确认业务口径清单.md`（新） | P1-9 等挂账项，绑定用例 R-01 |
| `docs/superpowers/reports/2026-10-21-business-flow-remediation-report.md`（新） | 最终报告（不提交） |
| `.superpowers/sdd/2026-10-20-business-flow-remediation/`（git 根下，已 gitignore） | ledger、`guard.js`（停起服务/快照/还原/指纹）、服务日志、DB 快照、基线副本 |

## 动态裁定（发现—裁定—影响—验证；执行中新增条目追加到 ledger）

| # | 发现 | 裁定 | 影响 | 验证 |
|---|---|---|---|---|
| R-01 | spec §2.4 统计写「纯 C 8 / B+C 5 / 纯 B 6」，按表逐项数实为 C 9（presale 3 + bid 5 + change 1）/ B+C 5 / B 5 | 映射表按逐项表落地，对账文档写实测计数并注明更正；「需 C 类锚点呈现」= C+B+C = 14 项 | 仅文档口径 | MT-03 按指标逐项断言 cls |
| R-02 | presale·合同交付物写「B：survey + A 类测绘分包占比」，但 presale 的 `judge()` 无测绘分包项 | `aItems:[]`，对账表注明「presale 无测绘分包定量项」，不虚构 A 类 | 无 | EV 对 presale 任务断言 computed 不含「测绘类分包占比」 |
| R-03 | `tasks.status='cancelled'` 已在 `server.js:2201`（重新提交时作废旧 pending）使用，并非全新取值 | P1-1 只把同一取值提前到退回时刻；消费方仍按 spec §8 全量 grep | 降低风险 | SM-01 + grep 清单记 ledger |
| R-04 | 档案 PUT（`server.js:2020-2035`）早已存在，鉴权=建档人/支持组/admin；spec §6.1 写「销售经理/支持组/admin」 | **鉴权一字不改**（放宽到任意销售经理=越权、收紧建档人=破坏性变更，均违反 AGENTS.md 改动纪律）；只补字段级事件与 360 `profile_can_edit` 同口径下发 | 入口可见性与服务端同源 | IA-47：支持组可改且留痕；FDE 403 且无入口 |
| R-05 | spec 要「事件流出现档案人工修正」，但 events 只挂 review_id，商机级无事件流 | 事件写 `review_id=NULL`，detail 以 `[商机码] ` 起首；360 用 `substr(detail,1,n)=?` 精确前缀取 `profile_events`（不用 LIKE，防 `_` 通配） | 零 schema | IA-47 断言 360 profile_events 含该条 |
| R-06 | EV-04 要求「judge 名 ∪ coverage 名 = 全部定量项」，HTTP 套件拿不到 judge 内部 | 证据端点追加 `notTriggered`（纯追加键）；EV-04 = 源码抽取 `judge()` 内 `push('名'` 字面量 ⇔ `QUANT_ITEMS` ⇔ 证据三集合并集，且三集合两两不交 | 漂移即红 | EV-04a/b/c |
| R-07 | NT-01「N 与 outbox 未投递行数一致」：outbox 每单每部门一行，旧轮次/已归档单的 preview 行永不消失 | `dispatch` 只计「当前轮 ∧ 单据 reviewing ∧ 本部门仍有 pending」的未投递 task_dispatch 行；首页文案「N 张评审单待打灯（共 M 项指标）」 | 不把陈旧行算成待办 | NT-01：行 id 逐一可在 admin outbox 找到且仍 preview；打完后该单消失 |
| R-08 | 僵尸 pending 存量（spec 实测 108）属旧数据，P1-1 只防新增 | 不用 SQL 回刷存量（禁止伪造终态）；存量随组 5 清理一并消失；SM-01 用「退回前后 zombie 增量=0」+ 清理后 zombie=0 两段验证 | 无 | SM-01a/b |
| R-09 | 运行时夹具过滤放服务端会改既有列表端点语义并波及 32 套回归 | 过滤在客户端：首页/商机列表/任务中心/研判台/预算单默认隐藏 `isFixture(opp_code)` 行，开关存 `localStorage.incFixture`；统计类（任务监控 stats）由服务端按同一 `isFixtureCode` 同时给出 `stats`（不含夹具）与 `stats_all` | 既有端点行集不变 | DG-05 浏览器开关可验证 |
| R-10 | 清理脚本也需夹具谓词，但不能复制第二份正则 | `tools/cleanup_fixtures.js` 从 `server.js` 源码抽取 `FIXTURE_CODE_RE` 字面量构造（单一来源） | 无 | DG-00 打印抽取到的 pattern |
| R-11 | spec §3.2 写「清理……一律走 UI/HTTP 真实链路」，但 D-D 明确规定「清理脚本按显式 id 清单删」，且服务端无 reviews/opps/budgets 的 DELETE 端点 | 按 D-D 执行脚本删除：删除夹具行不伪造任何业务终态，全程零 UPDATE | 无 | DG-00~06 |
| R-12 | spec D-H「深链 `#/tasks?review_id=`」已存在（`app.js:2369`） | 首页横幅直接复用，不新造路由 | 无 | NT-01 UI |
| R-13 | 相关商机（P1-3）由任务派生；`scope=done` 有 LIMIT 50 | 前端合并 `mine`（全量 pending）+ `done`（近 50）去重后派生，页内注明「按近期任务派生」；不改服务端 LIMIT | 可能漏远古商机 | IA-44 |
| R-14 | change 型三步链：① 仅在关联预算时核验、② 非必填，`launch` 无法给出「就绪/未就绪」二值 | change 卡按 spec 三态取「不适用」（附说明「变更决策不强制①②；关联锁定预算时需①已确认」）；若已有锁定预算且①已确认则「就绪」 | 与提交门同源 | RD-01 |

---

### Task 0: 现场护栏（ledger、guard.js、基线）

**Files:**
- Create: `F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/ledger.md`
- Create: `F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/guard.js`
- 已完成：`baseline/` 下 server.js、finance.js、agent.js、robot-orchestrator.js、public/*、tests/*.js 副本（diff 基线，`git diff --no-index` 用）

**Interfaces:**
- Produces: `$N guard.js pid` / `stop <pid>` / `start <tag>` / `snap <tag>` / `restore <tag>` / `verify <tag>`；后续每次写库套件均经此。

- [ ] **Step 1: 写 guard.js**（全部用 Node 内置；PID 采样经 `powershell Get-NetTCPConnection` + `Get-CimInstance Win32_Process`，两次间隔 3s 比对 PID/CreationDate/CommandLine 一致才放行；`stop` 只接受 CommandLine 含 `server.js` 的 node 进程；`start` 以 detached spawn `$N server.js`，stdout/stderr 分写 `logs/server_<tag>.out|.err`，轮询 `/api/me` 至 401；`snap` 要求端口空闲且无 `-journal/-wal/-shm`，复制 `data/review.db` → `db/<tag>.db`，记录 `certutil -hashfile SHA256` 全串 + 逐表指纹 JSON；`restore` 要求端口空闲，按字节复制回并立即 `verify`）。
- [ ] **Step 2: 写 ledger.md**（任务表 + 每组状态 + 动态裁定续表 + 证据文件清单）。
- [ ] **Step 3: 记录 config.json 基线**（字节数 + sha256 前16，与 `f285c66ad4790370` 比对）。

### Task 1: HTTP 专项套件 `tests/test_flow_remediation.js` + 旧码红证据

**Files:**
- Create: `tests/test_flow_remediation.js`（HTTP 帮手逐字沿用 `tests/test_chain.js` 的 raw/api/login/check 与 mkOpp/mkBudget/dlvPut/dlvConfirm/lock/mkReview 套路，夹具码 `PL-RM-<ts>-<n>`）
- Evidence: `tests/red_flow_remediation.txt`（旧码红）→ `tests/green_flow_remediation.txt`（新码绿）

**用例（全部为判别性断言，旧码必红）：**

- MT-01 `/api/meta/fields` 既有 5 键仍在且新增 `indEvidence`/`fixtureCodePattern`；MT-02 `new RegExp(fixtureCodePattern)` 对样本 `PL00006204→false / PL-T3-x→true / PL-RW-1-MAIN→true / PL-A-DL-1→true / PL-AD-RB-1→true / ''→false` 与 `server.js` 源码中 `FIXTURE_CODE_RE` 字面量构造的正则逐一同判；MT-03 19 项逐项 `cls` 与 spec §2.4 表一致（R-01）。
- EV-03 源码抽取 `INDICATORS` 三类型 key 集 ≡ `IND_EVIDENCE` key 集 ≡ meta `indEvidence` key 集，且 meta 每条 `registered===true`。
- EV-01 bid 单（sub_amount 填写）提交后取「分包合理性」任务证据：`computed` 含「分包占比」且 focus=true；`formFacts` 含 `sub_core/sub_amount/designated_sub_amount/b2b_scene`（label 取注册表原文）；`external.required===true`；`anchors` 含「商机代码」= 夹具码、含 label 带「客户名称」者 = 夹具客户。
- EV-02 「客户历史欠款」：`formFacts` 为 `[]`、`external.required===true`、`external.hint` 非空；`cls==='C'`。
- EV-04a 源码抽取 `judge()` 三个类型块内 `push('名'` 字面量集合 ≡ 源码 `QUANT_ITEMS` 对应数组；EV-04b 对 bid/presale/change 各一张单，证据 `computed`∪`skipped`∪`notTriggered` 名集合 ≡ `QUANT_ITEMS[type]` 且两两不交。
- EV-06 缺 `sub_amount` 的 bid 单走完全部打灯（绿灯）→ 详情 `coverage.skipped` 含「分包占比」，`review.light` 与同表单填 sub_amount=0 的对照单… （只断言 coverage，不比灯色：judge 一字不改由 RL-01 保证）。
- 404：`/api/tasks/999999999/evidence` → 404 `任务不存在`；未登录 → 401。
- RD-01 新商机①未确认：360 `launch.bid.state==='blocked'` 且 gaps[0].key==='delivery'、href 指向交付页；确认①未锁②：bid gaps 只剩 `budget`；锁定后 `launch.bid.state==='ready'`、`launch.presale.state==='ready'`；change 为 `na` 或 `ready`（R-14）。
- RD-03 草稿 PUT `{budget_id}` 后详情 `review.budget_id` 变更（服务端 D-59 既有能力的回归钉）。
- IA-47 支持组 PUT `/api/opp/:code` 改 region → 360 `profile_events` 含「档案人工修正」且 detail 含「字段 营销区域 由 A 改为 B」；`profile_can_edit` 对支持组 true、对 FDE false；FDE PUT → 403。
- SM-01 bid 单提交后由财务BP 退回一项 → 同轮其余 pending 全部 `cancelled`；`scope=mine`（采购BP 等）不再返回该单任务；`scope=all` 的 `stats_all.zombie` 退回前后增量 = 0；详情事件含「任务作废」。
- SM-02 支持组代打财务BP 一项 → 详情该任务 `proxy===true`、`done_role==='销售支持组'`；事件含 action「代打」且 detail「由 销售支持组 代 财务BP 完成 …」；财务BP 本人打的另一项 `proxy===false`。
- NT-01 提交后财务BP `scope=mine` 的 `dispatch.rows` 含该单且 `dispatch.count===rows.length`；每行 id 在 admin `/api/admin/robot/outbox` 中存在且 status 仍为 `preview`；财务BP 打完本部门全部任务后该单从 dispatch 消失。
- NT-02 admin outbox GET 含数值 `backlog`；`/api/robot/workbench` 的 `provider.active===false`、`capabilities.provider_send===false`。

- [ ] **Step 1: 写套件**（夹具全走 HTTP；所有建单/建预算用 `PL-RM-<ts>-<n>` 码；结尾不做 SQL 清理，由 guard 还原快照兜底）。
- [ ] **Step 2: 旧码红跑**：`guard pid` 双采样 → `guard stop 28112` → `guard snap pre` → `guard start red` → `$N tests/test_flow_remediation.js --log=tests/red_flow_remediation.txt > /dev/null 2>&1` → `guard stop <自起PID>` → `guard restore pre`。期望：新用例 FAIL、帮手链路（建单/提交/打灯）本身成功（非破坏基线）。

### Task 2: 组 1 服务端（证据层）

**Files:** Modify `server.js`（`TYPE_NAMES` 后、`judge()` 后、meta 端点、任务路由前、详情 GET）

- [ ] **Step 1: `TYPE_NAMES` 后插入映射与谓词**

```js
// 指标 → 打灯证据映射(spec 2026-10-20 §2.4 逐项对账, docs/打灯证据对账表.md): 唯一真源, 经 /api/meta/fields 下发, 前端不另存。
// formKeys=B类表单事实 / anchors=C类追加查询锚点(恒有锚点见 evidenceFor) / external=true 即判定依据在部门自有系统 / aItems=A类重点项(judge 项名)
// 未登记的 key 一律按 external:true、formKeys:[] 处理(安全默认: 宁可说"没有数据", 不可假装平台能判)
const IND_EVIDENCE = {
  presale: {
    tech: { formKeys: [], anchors: ['summary', 'survey'], external: true },
    resource: { formKeys: [], anchors: ['presale_period', 'summary'], external: true },
    survey_deliver: { formKeys: ['survey'], anchors: [], external: false },
    sub_early: { formKeys: ['sub_early_flag'], anchors: [], external: false },
    credit_history: { formKeys: [], anchors: [], external: true }
  },
  bid: {
    sub_reason: { formKeys: ['sub_core', 'sub_amount', 'designated_sub_amount', 'survey_sub_amount', 'b2b_scene'], anchors: [], external: true, aItems: ['分包占比', '测绘类分包占比', '指定供应商'], hint: '下游供应商资质与合格供应商名录在采购系统中, 平台不采集; 请按下方锚点核验' },
    tech: { formKeys: [], anchors: ['product_type', 'jiadao', 'summary'], external: true },
    arrears: { formKeys: [], anchors: ['payback_time'], external: true },
    credit: { formKeys: [], anchors: [], external: true },
    related_tx: { formKeys: [], anchors: [], external: true },
    payment: { formKeys: ['payment_terms', 'settle_method', 'payback_time', 'revenue_confirm', 'b2b_scene'], anchors: [], external: false, aItems: ['结算方式'] },
    upstream: { formKeys: ['sign_path'], anchors: [], external: true, aItems: ['签约转包次数'], hint: '上游签约路径各公司的经营异常/诉讼/被执行/处罚记录在法务征信渠道中, 平台不采集; 请按签约路径逐家查询' },
    subcontract_limit: { formKeys: ['sub_limit', 'sign_path'], anchors: [], external: false },
    compliance: { formKeys: [], anchors: ['secret', 'jiadao'], external: true },
    data: { formKeys: ['data_review', 'data_plan', 'data_content', 'data_compliance'], anchors: [], external: true, hint: '数据风险等级(C1–C4)在数据合规评估中确定, 平台不采集; 请结合下方表单事实判定' }
  },
  change: {
    tech: { formKeys: [], anchors: ['summary'], external: true },
    sub_reason: { formKeys: ['old_sub_amount', 'new_sub_amount'], anchors: [], external: true, hint: '变更后分包供应商资质在采购系统中, 平台不采集; 请按下方锚点核验' },
    sign_diff: { formKeys: ['path_change'], anchors: [], external: false },
    deduction: { formKeys: ['change_type', 'old_delivery_cost', 'new_delivery_cost'], anchors: [], external: true, aItems: ['成本变动-交付成本'], hint: '核减原因是否合理需结合合同与回款台账判断, 平台不提供该数据' }
  }
};
const EXT_HINT = {
  FDE: '本项判定依据在贵部门(FDE)的技术评估与资源排期中, 平台不提供该数据; 请按下方锚点定位本单后自行判定',
  财务BP: '本项判定依据在财务系统(客户欠款/诉讼/坏账/关联交易台账)中, 平台不提供该数据; 请按下方锚点在财务系统中定位本单',
  法务: '本项判定依据在法务征信渠道中, 平台不提供该数据; 请按下方锚点查询',
  合规BP: '本项判定依据在合规部门的资质与风险台账中, 平台不提供该数据; 请按下方锚点定位本单',
  数据BP: '本项判定依据在数据合规评估中, 平台不提供该数据; 请按下方锚点定位本单',
  采购BP: '本项判定依据在采购系统中, 平台不提供该数据; 请按下方锚点定位本单'
};
function indEvidence(type, key, dept) {
  const e = (IND_EVIDENCE[type] || {})[key];
  const base = e ? { formKeys: e.formKeys, anchors: e.anchors, external: !!e.external, aItems: e.aItems || [], registered: true }
    : { formKeys: [], anchors: [], external: true, aItems: [], registered: false };
  const hint = !base.external ? '' : (e && e.hint) || (e ? EXT_HINT[dept] : '') || '指标证据映射表未登记本指标, 平台不提供该项数据; 请按下方锚点在贵部门系统中定位本单';
  return { ...base, hint, cls: base.formKeys.length ? (base.external ? 'B+C' : 'B') : 'C' };
}
// 夹具识别(spec 2026-10-20 D-C): 真实商机码恒为 PL+8位数字, 测试码恒为 PL- 前缀; 正则经 /api/meta/fields 的 fixtureCodePattern 下发, 前端与清理脚本不另存第二份。
// 不复用 reviews.era —— era 是 online/history 业务双轨(实测 93/93 全 online), 加第三值会污染语义。
const FIXTURE_CODE_RE = /^PL-[A-Za-z0-9]/;
const isFixtureCode = c => typeof c === 'string' && FIXTURE_CODE_RE.test(c);
```

- [ ] **Step 2: `judge()` 之后插入 `QUANT_ITEMS` 与 `judgeCoverage()`**（与 `judge()` 谓词逐条镜像，见下；`judge()` 本体一字不改）

```js
// judge() 的只读镜像(spec 2026-10-20 D-A/P2-1): 列出定量项中「因数据缺失未参与判定」(skipped)与「数据齐全但未触发」(notTriggered)。
// ⚠️ 与上方 judge() 逐条对应: 改 judge() 任一 if 谓词或项名, 必须同改此处与 QUANT_ITEMS(EV-04 以集合完整性钉住漂移)。只做披露, 绝不参与灯色/路由/报告。
const QUANT_ITEMS = {
  bid: ['分包占比', '测绘类分包占比', '贡献利润', '合同金额', '项目运维周期', '指定供应商', '签约转包次数', '推广激励', '条款外激励', '合同担保事项', '竞业事项', '结算方式'],
  presale: ['售前投入成本', '售前投入占比', '售前实施周期', '预计签单时间'],
  change: ['成本变动-交付成本', '贡献利润', '合同金额', '分包超进度支付']
};
function judgeCoverage(review) {
  const form = JSON.parse(review.form_json || '{}');
  const skipped = [], notTriggered = [];
  const miss = (name, reason) => skipped.push({ name, reason });
  const quiet = (name, reason) => notTriggered.push({ name, reason });
  const blank = v => v == null || String(v).trim() === '';
  const yesNo = (name, v, label) => { if (blank(v)) miss(name, label + '未填'); else if (v !== '是') quiet(name, label + '为「' + v + '」'); };
  if (review.type === 'bid') {
    const amount = num(form.contract_amount), subAmt = num(form.sub_amount), surveySub = num(form.survey_sub_amount);
    let gm = null;
    if (review.budget_id) { const b = getBudgetRaw(review.budget_id); if (b && b.calc) { try { const bc = JSON.parse(b.calc); if (bc && bc.margin != null) gm = bc.margin; } catch (e) {} } }
    if (gm == null) { try { const bj = review.budget_json ? JSON.parse(review.budget_json) : null; if (bj && bj.computed && bj.computed.margin != null) gm = bj.computed.margin; } catch (e) {} }
    if (gm == null) gm = num(form.gross_margin);
    const amtOk = amount != null && amount > 0;
    if (!amtOk || subAmt == null) miss('分包占比', !amtOk ? '缺预计合同金额' : '缺分包总金额');
    if (!amtOk || surveySub == null) miss('测绘类分包占比', !amtOk ? '缺预计合同金额' : '缺测绘类分包金额');
    else if (!(surveySub > 0 && surveySub / amount * 100 >= 40)) quiet('测绘类分包占比', '测绘类分包占比 < 40% 或无测绘分包');
    if (gm == null) miss('贡献利润', '缺贡献毛利率(关联预算单/在线预算表/表单均无)');
    if (amount == null) miss('合同金额', '缺预计合同金额');
    if (num(form.ops_years) == null) miss('项目运维周期', '缺项目运维周期');
    const ds = num(form.designated_sub_amount);
    if (ds == null) miss('指定供应商', '指定类分包金额未填'); else if (!(ds > 0)) quiet('指定供应商', '无指定类分包');
    if (!form.sign_path) miss('签约转包次数', '缺签约路径');
    if (blank(form.promo_target)) miss('推广激励', '推广激励面向对象未填');
    else if (form.promo_target !== '外部' && form.promo_target !== '均包含') quiet('推广激励', '面向对象为「' + form.promo_target + '」');
    else {
      const promoAmt = num(form.promo_amount);
      const ratio = amount != null && promoAmt != null ? promoAmt / amount * 100 : null;
      if (promoAmt == null) miss('推广激励', '缺推广激励金额');
      else if (!((ratio != null && ratio >= 15) || promoAmt >= 30)) quiet('推广激励', '比例 < 15% 且金额 < 30万');
    }
    yesNo('条款外激励', form.promo_outside, 'SF 体系外条款激励');
    yesNo('合同担保事项', form.guarantee, '合同担保');
    yesNo('竞业事项', form.non_compete, '竞业条款');
    if (!String(form.settle_method || '')) miss('结算方式', '缺结算方式');
  }
  if (review.type === 'presale') {
    const invest = num(form.presale_invest), amount = num(form.contract_amount);
    if (invest == null) miss('售前投入成本', '缺预计售前投入成本');
    if (invest == null || amount == null || !(amount > 0)) miss('售前投入占比', invest == null ? '缺预计售前投入成本' : '缺预计合同金额');
    if (num(form.presale_period) == null) miss('售前实施周期', '缺预计售前实施周期');
    if (!form.sign_date) miss('预计签单时间', '缺预计签单时间');
  }
  if (review.type === 'change') {
    const oldCost = num(form.old_delivery_cost), newCost = num(form.new_delivery_cost), newGm = num(form.new_gross_margin), newAmount = num(form.new_contract_amount);
    if (oldCost == null || newCost == null) miss('成本变动-交付成本', oldCost == null ? '缺原交付成本' : '缺变更后交付成本');
    if (newGm == null) miss('贡献利润', '缺变更后贡献毛利率'); else if (!(newGm < 0)) quiet('贡献利润', '变更后毛利率 >= 0%');
    if (newAmount == null) miss('合同金额', '缺变更后合同金额'); else if (!(newAmount >= 500)) quiet('合同金额', '变更后合同金额 < 500万');
    yesNo('分包超进度支付', form.over_pay, '分包超进度支付');
  }
  return { skipped, notTriggered };
}
```

- [ ] **Step 3: 证据组装 `evidenceFor(task, review)`**（同处，`judgeCoverage` 之后）

```js
// 打灯证据(spec D-A): A=judge() 已算定量项 / B=IND_EVIDENCE.formKeys 表单事实(label 取 REQUIRED 原文) / C=查询锚点+部门系统标注。只读。
function evidenceFor(task, review) {
  const form = JSON.parse(review.form_json || '{}');
  const ev = indEvidence(review.type, task.ind_key, task.dept);
  const fields = REQUIRED.review[review.type] || [];
  const label = k => (fields.find(f => f.k === k) || {}).l || k;
  const has = k => fields.some(f => f.k === k);
  const val = v => v == null ? '' : String(v);
  const aSet = new Set(ev.aItems);
  const computed = judge(review).detail.filter(i => !String(i.name).startsWith('前置评审·'))
    .map(i => ({ name: i.name, level: i.level, reason: i.reason, xo: !!i.xo, focus: aSet.has(i.name) }));
  const amountKey = review.type === 'change' ? (blankish(form.new_contract_amount) ? 'old_contract_amount' : 'new_contract_amount') : 'contract_amount';
  const anchors = [
    { label: '商机代码', value: val(review.opp_code || form.opp_code) },
    { label: '项目名称', value: val(review.title) },
    { label: label('customer'), value: val(form.customer) },
    { label: label(amountKey), value: val(form[amountKey]) },
    { label: '申请人', value: val(review.applicant_name) },
    { label: '申请时间', value: val(review.created_at) }
  ];
  for (const k of ['sign_path', 'biz_line', 'region', ...ev.anchors]) {
    if (!has(k) || anchors.some(a => a.label === label(k))) continue;
    anchors.push({ label: label(k), value: val(form[k]) });
  }
  const cov = judgeCoverage(review);
  return {
    task: { id: task.id, review_id: task.review_id, ind_key: task.ind_key, ind_name: task.ind_name, dept: task.dept, standards: task.standards, status: task.status, round: task.round },
    review: { id: review.id, type: review.type, title: review.title, opp_code: review.opp_code, status: review.status, round: review.round, applicant_name: review.applicant_name, created_at: review.created_at },
    cls: ev.cls, computed,
    formFacts: ev.formKeys.map(k => ({ k, label: label(k), value: val(form[k]) })),
    anchors, external: { required: ev.external, hint: ev.hint },
    skipped: cov.skipped, notTriggered: cov.notTriggered
  };
}
const blankish = v => v == null || String(v).trim() === '';
```

- [ ] **Step 4: meta 追加两键**（`server.js:1854` 附近；既有 5 键不动）

```js
indEvidence: Object.fromEntries(Object.keys(INDICATORS).map(t => [t, INDICATORS[t].map(i => {
  const e = indEvidence(t, i.key, i.dept);
  return { key: i.key, name: i.name, dept: i.dept, cls: e.cls, formKeys: e.formKeys, anchors: e.anchors, external: e.external, aItems: e.aItems, hint: e.hint, registered: e.registered };
})])),
fixtureCodePattern: FIXTURE_CODE_RE.source
```

- [ ] **Step 5: 证据端点**（`/api/tasks` GET 之前）

```js
const mEv = p.match(/^\/api\/tasks\/(\d+)\/evidence$/);
if (mEv && req.method === 'GET') { // spec D-A: 登录可读(与 360 同口径), 只读不泄露写权限
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(mEv[1]));
  const review = task && getReview(task.review_id);
  if (!task || !review) return send(res, 404, { error: '任务不存在' });
  return send(res, 200, evidenceFor(task, review));
}
```

- [ ] **Step 6: 详情 GET 追加 `coverage`**：`coverage: review.judge_detail ? judgeCoverage(review) : null`（纯追加键；任务行经 Task 3 的 `annotateTasks`）。

### Task 3: 组 4 服务端（任务生命周期与代打可见）

**Files:** Modify `server.js` 任务路由（2689-2746）、详情 GET、360

- [ ] **Step 1: 帮手**（任务路由前）

```js
// 代打可见(spec D-E): done_by 记的是姓名, 经 users 映射回角色; 角色 ≠ 任务部门即代打。只读标注, 权限判定一字不改。
function annotateTasks(rows) {
  const roleOf = new Map(db.prepare('SELECT name, role FROM users').all().map(u => [u.name, u.role]));
  return rows.map(t => {
    const done_role = t.done_by ? (roleOf.get(t.done_by) || null) : null;
    return { ...t, done_role, proxy: !!(done_role && done_role !== t.dept && (t.status === 'done' || t.status === 'returned')) };
  });
}
```

- [ ] **Step 2: `GET /api/tasks`**：三个分支结果统一 `annotateTasks(rows)`；`scope=all` 追加 `stats`（不含夹具）与 `stats_all`（含夹具），字段 `{handled, proxy, zombie, cancelled}`（zombie = pending ∧ (单据非 reviewing ∨ 轮次落后)）；`scope=mine` 追加 `dispatch:{count, rows}`（R-07 口径 SQL：`robot_outbox o JOIN reviews r` + `o.event='task_dispatch' AND o.target_key='dept:'||角色 AND o.status IN ('preview','ready') AND r.status='reviewing' AND o.idempotency_key='task_dispatch:'||r.id||':'||r.round||':'||角色 AND EXISTS(本部门本轮 pending)`，行带 `payload` 摘要 project/indicators/pending_count/deadline_hint）。
- [ ] **Step 3: 退回分支**（`UPDATE reviews ... 'returned'` 之后、`addEvent('退回修改')` 之后）

```js
// P1-1(spec §3.3 已批准): 退回即收敛同轮其余 pending → cancelled, 与重新提交时(上方 /submit)同一取值; reviews.status 迁移不变
const nCancel = db.prepare("UPDATE tasks SET status='cancelled' WHERE review_id=? AND round=? AND status='pending'").run(review.id, task.round).changes;
if (nCancel) addEvent(review.id, '任务作废', '系统', `单据已退回, 同轮其余 ${nCancel} 项待办作废(重新提交时按新一轮重建)`);
```

- [ ] **Step 4: 完成分支**（`addEvent('前置评审·…')` 之后）

```js
if (user.role !== task.dept) addEvent(review.id, '代打', user.name, `由 ${user.role} 代 ${task.dept} 完成 ${task.ind_name}`); // spec D-E 留痕, 权限不变
```

- [ ] **Step 5: grep 全部 `tasks.status` 消费方**（`status='pending'|status='done'|'returned'|taskSt|ts.status|t.status`，server.js/public/app.js/tests/），逐处判断 cancelled 是否需要分支，清单写 ledger；已知：报告 HTML（`server.js:1105` 附近）、`taskSt()`（`app.js:2375`）、`instProgressHtml`、`oppLightAgg`。

### Task 4: 组 2/3/6 服务端（就绪态、档案留痕、积压、文案）

- [ ] **Step 1: 360 追加 `launch`**（R-14 口径；谓词与 `/submit` 门 `server.js:2168-2187` 同源并互指注释）

```js
// 就绪三态(spec P0-3): 与 /submit 的 BUDGET_REQUIRED_TYPES/DELIVERY_REQUIRED_TYPES 门同源, 前端不得自拼判定
const dlvOk = !!(dlvRow && dlvRow.status === 'confirmed');
const lockedB = budgets.filter(b => b.status === 'locked');
const launch = {};
for (const t of ['presale', 'bid', 'change']) {
  const gaps = [];
  if (!dlvOk) gaps.push({ key: 'delivery', label: '① 交付预算未确认', href: `#/opp/${encodeURIComponent(code)}/delivery` });
  if (!lockedB.length) gaps.push({ key: 'budget', label: '② 项目预算未锁定', href: `#/budget/new?opp=${encodeURIComponent(code)}` });
  const required = BUDGET_REQUIRED_TYPES.includes(t);
  launch[t] = required ? { state: gaps.length ? 'blocked' : 'ready', gaps }
    : { state: gaps.length ? 'na' : 'ready', gaps, note: '变更决策不强制①②; 关联锁定预算单时需该商机交付预算已确认' };
}
```

（`href` 以实施时 `renderRoute` 实测路由为准，若交付页/新建预算路由不同，改为实测值并记 ledger。）

- [ ] **Step 2: 360 追加 `profile_can_edit`（与档案 PUT 鉴权同式：建档人/支持组/admin）与 `profile_events`**（R-05：`SELECT action,actor,detail,created_at FROM events WHERE review_id IS NULL AND action='档案人工修正' AND substr(detail,1,?)=? ORDER BY id DESC LIMIT 50`）；`tasks` 经 `annotateTasks`。
- [ ] **Step 3: 档案 PUT 字段级留痕**：循环内记录 `[k, 旧值, 新值]`（旧值与新值字符串相等的不记），UPDATE 后逐条 `addEvent(null, '档案人工修正', user.name, '[' + code + '] 字段 ' + 标签 + ' 由 ' + (旧||'(空)') + ' 改为 ' + (新||'(空)'))`；标签取 `OPP_REQUIRED` 注册表（缺则用键名）。鉴权行一字不改（R-04）。
- [ ] **Step 4: outbox GET 追加 `backlog`**（`status IN ('preview','ready')` 计数）；工作台 `provider.message` 与能力文案统一「生成待发送草稿（本地预演）」；先 grep tests 中对旧文案的断言，被 spec P2-8 显式改变的同步更新并记 ledger。
- [ ] **Step 5: `$N --check server.js`**；HTTP 专项绿跑（guard 快照/还原包裹）→ `tests/green_flow_remediation.txt`；同轮跑受影响既有 HTTP 套件（test_chain / test_opp360 / test_opp_api / test_robot_* / test_required 等，按 grep 结果）确认未破。

### Task 5: 前端数据层（META 与夹具开关）

- [ ] **Step 1**：`let META = null; async function loadMeta(){ try { META = await api('/api/meta/fields'); } catch (e) { META = null; } }`；`const isFixture = c => !!(META && META.fixtureCodePattern && c && new RegExp(META.fixtureCodePattern).test(c));`（正则只从 META 构造，app.js 不含 `PL-` 字面量）；`const incFixture = () => localStorage.incFixture === '1';`、`const hideFx = rows => incFixture() ? rows : rows.filter(r => !isFixture(r.opp_code));`。
- [ ] **Step 2**：启动与登录后 `await loadMeta()`；`.who` 区加 `<label class="fx-tg"><input type="checkbox" id="fxToggle"> 包含测试数据</label>`（支持组/admin 可见），切换写 `localStorage.incFixture` 并 `render()`；`logout` 的 `localStorage.clear()` 保持（开关随登出复位，可接受）。
- [ ] **Step 3**：`invalidateApiCache` 追加 `/^\/api\/budget(s)?(\?.*)?$/` 等列表键（P3-3），写操作后自动失效。

### Task 6: 组 1 前端（打灯弹窗证据区 + 结论页覆盖卡）

- [ ] **Step 1**：`openTask(t)` 改 async：先渲染既有弹窗骨架（保留 `#pk-g/#pk-y/#pk-r/#taskOp/#mask` 等既有 id 与选择器），再 `api('/api/tasks/'+t.id+'/evidence')` 填充 `#evBox`：三区块标题固定为「A 类·系统已算」「B 类·表单已采」「C 类·部门自有系统」；A 区列 computed（focus 项置顶加粗，空则「本类型无已算定量项」）；B 区列 formFacts（空值显示「未填」，无 formKeys 显示「本指标无表单事实」）；C 区 external.required 时显示 hint，锚点表恒显示；skipped 非空时在 A 区下方「N 项因数据缺失未参与判定：…」；底部 `<a href="#/review/ID" target="_blank">打开完整评审单</a>`。证据拉取失败只在 `#evBox` 显示错误，不阻断打灯。
- [ ] **Step 2**：L2 结论页签（`renderInstBody` 的 result 分支）在 `d.coverage && d.coverage.skipped.length` 时渲染覆盖卡「N 项因数据缺失未参与判定：名(原因)…」，并注明「仅披露，不参与灯色」。

### Task 7: 组 2 前端（就绪态、编辑态关联预算、下一步指引）

- [ ] **Step 1**：`oppLaunch` 三卡按 `d.launch[t].state` 渲染：ready「就绪」；blocked 列 gaps（每条带跳转链接）+「草稿可填，提交需先完成①②」，卡片仍可点进草稿；na 显示 note。
- [ ] **Step 2**：`renderForm` 顶部常驻 `#readyBar`：必填 `已填/总数`（取 META 注册表 req 集，监听表单 input/change 实时重算）、预算是否关联（读当前 `#budgetSel` 值）、交付是否确认（有 opp 时取 360 launch），全部满足时变绿。
- [ ] **Step 3**：编辑态同样渲染「关联预算单」区块（初值 `r.budget_id`），`submitReview` 编辑分支 PUT 时一并带 `budget_id`（D-59 既有能力）。
- [ ] **Step 4**：`oppChain` 下一步指引去掉 `submitted===0` 条件，按链状态派生（①未确认→去确认；②未锁定→去锁定；③有草稿→去提交；有 judged→去录结论；全归档→查看归档），与链 dot 同源。

### Task 8: 组 3 前端（导航与 IA）

- [ ] **Step 1 导航**：FDE/采购BP/法务/合规BP/数据BP 加 `<a href="#/opps" data-n="opps">相关商机</a>`；项目经理/销售经理/支持组/admin 加 `<a href="#/budgets" data-n="budgets">预算单</a>`；`navHighlight` 同步。
- [ ] **Step 2 相关商机页**：`renderOppsList` 对五部门角色改为任务派生（R-13）。
- [ ] **Step 3 预算单页**：`apiCached`；标题 admin 显示「全部」；版本链展开行 colspan 由表头列数常量派生（7）。
- [ ] **Step 4 360 预算卡**：「＋新建项目预算」上移卡头仅一次；每行标「已被 #N 评审单关联 / 未关联」；未关联的锁定预算行给「用它发起评审」→ `#/new/bid?opp=CODE&budget=ID`（`renderRoute` 解析 budget 参数并预选）。
- [ ] **Step 5 档案编辑**：`profile_can_edit` 时档案卡出现「编辑档案」，行内表单 PUT 后 `invalidateApiCache` 并重绘；卡下列 `profile_events`「档案修正记录」。
- [ ] **Step 6 任务中心**：「本单进度 N/M」列（同 review_id 当前轮 done/总数，cancelled 不计）；all 页加部门+类型筛选与每页 50 分页；监控摘要「代打占比 N%（M/K）· 僵尸待办 Z · 已作废 C」。
- [ ] **Step 7 研判台**：meet/green/red 三 tile 加 onclick 定位队列；队列默认 10 行 +「展开全部」。
- [ ] **Step 8 文案**：归档库入口「补录历史已归档评审（直接入库，不走流程）」+ confirm；向导导入标「导入为草稿，需走完①②③」。
- [ ] **Step 9 L1 分析区**：删除「P0 阶段」「P2」字样；渲染灯色时间线（各单 light + updated_at，按时间排序）与各轮结论对比表（类型/状态/灯色/结论/更新时间）。

### Task 9: 组 4 前端（状态语义）

- [ ] **Step 1**：`taskSt()` 加 `cancelled → 已作废`；`instProgressHtml` 与 `oppLightAgg` 排除 cancelled。
- [ ] **Step 2**：L2 前置页签与任务中心已处理页签：`t.proxy` 时显示「由 {done_by} 代 {dept} 打灯」。
- [ ] **Step 3**：首页「待研判」拆为「前置收集中」（status=reviewing）与「待录结论」（status=judged）两个 tile；「我的商机」计数与落地页同源。
- [ ] **Step 4**：商机列表空 `opp_code` 单据不聚合，各自成行 +「未挂靠商机」标签，排在有码商机之后。

### Task 10: 组 6/7/8 前端

- [ ] **Step 1 NT-01**：部门角色首页横幅「你所在部门有 N 张评审单待打灯（共 M 项指标）」+ 草稿摘要（payload.project / indicators），每条深链 `#/tasks?review_id=`；N=0 不显示。
- [ ] **Step 2 NT-02**：机器人管理页显示「当前本地预演，N 条待投递」（outbox `backlog`）；能力文案「生成待发送草稿（本地预演）」。
- [ ] **Step 3 CH-01**：`#impType`、`#rwrType` 移除 change 选项并旁注「变更决策无 Excel 模板，请在线填写」；`#histType` 保持。
- [ ] **Step 4 P3-2**：任务中心部门文案由 `META.indEvidence` 派生 dept 去重列表。
- [ ] **Step 5 P3-4/P3-5**：colspan 改为表头列数常量；`OPP_T_FOCUS` 加一行注释「三个旧值同归前置分区，非遗漏」。
- [ ] **Step 6**：`$N --check public/app.js`。

### Task 11: 浏览器专项 `tests/h_remediation_shots.js` + 既有浏览器套件同步

- [ ] **Step 1**：写套件（Playwright chromium channel chrome headless；每页收集 `console.error` 与 `pageerror` 必须为 0；夹具经 HTTP 建，码 `PL-RM-<ts>-*`）：EV-05、RD-01/02 UI、IA-44~50、SM-02 UI、SM-03、SM-04、NT-01 UI、NT-02 UI、CH-01、PL-01（源码检测任务中心无硬编码部门串）、PL-02（`#/budgets` 二次进入零 `/api/budget` 请求）、DG-05（开关打开见夹具行、关闭 0）。
- [ ] **Step 2**：在「新服务端 + 旧 app.js」上取红（旧前端必红），再在新前端取绿；证据 `tests/red_remediation_shots.txt` / `tests/green_remediation_shots.txt`。
- [ ] **Step 3**：跑既有浏览器套件（h_ia_shots / h_nav_shots / h_opp_shots / test_opp_dialog / h_robot_workbench_shots 等），凡因 spec 显式改变的断言（导航条目、首页 tile、聚合行、change 选项、文案）按 spec 同步并记 ledger；其余红一律修代码不改断言。
- [ ] **Step 4**：`tests/run_all.js` SUITES 追加两套。

### Task 12: 全量门（清理前）

- [ ] guard 快照 → 起服务 → `$N tests/run_all.js --log=tests/green_run_remediation_pre.txt`（后台）→ 停 → 还原 → verify；`database is locked` 计数 0；红则按套归因修复后重跑。

### Task 13: 组 5 数据治理

- [ ] **Step 1**：`tools/cleanup_fixtures.js`：从 server.js 抽 `FIXTURE_CODE_RE`；只读生成 id 清单（reviews/tasks/events/attachments/agent_messages/budgets/budget_delivery/opps/opp_delivery/robot_outbox）落盘 `tests/dg_cleanup_idlist.json`；5 条前置断言（spec D-D）全过才进删除事务（`BEGIN; DELETE ... WHERE id IN (...); COMMIT`），任一不过 ABORT 只写 scratch（sdd 目录）；删除前后逐表计数与指纹写 `tests/dg_cleanup_evidence.txt`。
- [ ] **Step 2**：执行：停服务 → `guard snap pre_cleanup`（certutil 全串）→ dry-run 打印清单 → 正式删除 → `guard snap cleaned` → DG-01/06 校验 → 起服务 → 全量门 `tests/green_run_remediation_cleaned.txt` → 停 → `guard restore cleaned` → 起服务。最终库 = cleaned；pre_cleanup 快照留 sdd 目录备回退。
- [ ] **Step 3**：DG-04（首页灯色合计 = 6）浏览器实测；SM-01b（清理后 stats_all.zombie=0）。
- [ ] **Step 4**：P3-1：演示脚本口径改用 PL00006204/8026/8210/8314，写入报告与 `docs/待确认业务口径清单.md` 的演示说明（不 SQL 补链）。

### Task 14: 文档

- [ ] `docs/打灯证据对账表.md`（19 行，与 `IND_EVIDENCE` 逐项一致 + R-01/R-02 更正）；`docs/待确认业务口径清单.md`（P1-9 绑定 R-01、P0-7 根治、P0-5 根治、P1-2 根治、C 类对接）。

### Task 15: 独立代码审查

- [ ] 派审查子代理（只读）审本轮 diff（基线副本 `git diff --no-index`）对照 spec 与红线；Critical/Important 逐条修复并补跑相关套件。

### Task 16: 收尾验证与报告

- [ ] verification-before-completion：回读 spec §7 逐项对照证据；`config.json` 字节与 sha 前16；`git diff --stat finance.js` 为空；`git status` 无新增被跟踪改动以外的意外文件；无 `tests/_tmp_*`；`/api/me` 未登录 401；服务现场恢复（8600 由本任务新起的进程提供）。
- [ ] 写 `docs/superpowers/reports/2026-10-21-business-flow-remediation-report.md`（已完成项、修改文件、动态裁定、红绿证据、专项/全量/浏览器结果、数据库恢复证据、未完成项、阻塞与下一步）。

## Self-Review

- spec 覆盖：组 1（P0-1/P0-2/P2-1/P2-2）→ T2/T6；组 2（P0-3/P0-4/P2-7）→ T4/T7；组 3（P1-3/P1-5/P1-7/P1-8/P2-3/P2-4/P2-5/P2-6）→ T4/T8；组 4（P1-1/P1-2/P1-4/P1-6）→ T3/T9；组 5（P0-6/P3-1）→ T5/T13；组 6（P0-5/P2-8）→ T3/T4/T10；组 7（P0-7）→ T10；组 8（P3-2/P3-3/P3-4/P3-5/P1-9）→ T5/T10/T14。验收 EV/RD/IA/SM/DG/NT/CH/PL/RL 全部映射到 T1/T11/T12/T13/T16。
- 名称一致性：`indEvidence()`/`IND_EVIDENCE`/`EXT_HINT`/`FIXTURE_CODE_RE`/`isFixtureCode`/`QUANT_ITEMS`/`judgeCoverage`/`evidenceFor`/`annotateTasks`/`launch`/`profile_can_edit`/`profile_events`/`dispatch`/`stats`/`stats_all`/`backlog`/`coverage`/`notTriggered` 在各任务中同名。
- 红线：`judge()`、`finance.js`、锁定门、状态机、鉴权行均未列入改动；唯一写语义变化 = cancelled（已批准）+ 档案 PUT 留痕事件。
