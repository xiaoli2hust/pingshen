# 实施计划 · 评审全流程中枢 V4.0（P0 八任务）

**Goal:** 把 V4.0 的「待评审商机 + 交付预算→项目预算→评审单三步硬链 + 类型必填单源 + 全流程页签」落到 a54322b 基线上，收工门 run_all 全绿。
**Architecture:** 服务端先行（数据模型→端点→门禁→注册表），前端消费（360 契约→页签→向导→列表）；每步旧套件全绿或按同批更新裁定演进。
**Spec:** `docs/superpowers/specs/2026-10-14-review-flow-v4-spec.md`（决策点 D-1~D-4 按默认裁定执行，用户可否决）

## Global Constraints

- 继承 spec §0 七条铁律（服务端唯一裁决/红绿纪律/一行回退/绑定参数/esc/UTF-8/精准 git add）。
- Node 托管 22；服务 8600；app.js 静态改动免重启，server.js 改动必重启（写自命名日志）。
- 锚定值 pl8572 六组 / tiandi 十项不得动；新用例先红后绿留档 tests/。
- 每任务完成即原子提交（中文一行式，仿 git log 风格）。

---

### Task 1: 数据模型——opps/opp_delivery 建表 + 存量回填迁移（服务端）

**Files:** Modify `server.js`（阶段 2 DDL 块之后追加 V4.0 DDL 块 + 迁移/回填函数 + 启动时幂等执行）
**Create(临时,跑完删):** `tests/_tmp_opmodel.js`
**Interfaces:** Produces 表 `opps`/`opp_delivery`（spec §1.1/§1.2 DDL 逐字）；`OPP_REQUIRED` 常量；回填/迁移幂等（重复启动零副作用）。
**Steps:** ①临时契约脚本先红（直连 DB 查表存在/列齐/迁移计数=存量 budget_delivery 数）②按 spec §1.1 DDL 建表 + §1.2 + 迁移与回填（budget_delivery→opp_delivery 按 budgets.opp_code 反查；opps 从 reviews/budgets 并集回填，form_json 同名字段继承）③重启服务跑绿 ④`--check` + OC/PA/DA 防回归 ⑤提交 `server.js`
**Commit:** `V4.0-T1 数据模型: opps 待评审商机档案表 + opp_delivery 商机级交付预算表(迁移幂等/要素回填/OPP_REQUIRED)`

### Task 2: 商机档案与交付预算端点（服务端 CRUD/导入/确认）

**Files:** Modify `server.js`（/api/opp/:code/360 块之后插 CRUD；/api/budget/:id/delivery* 旁挂 /api/opp/:code/delivery*）
**Create:** `tests/test_opp_api.js`（OP-*）+ `tests/test_delivery_opp.js`（DL-*）
**Interfaces:** Produces spec §3 表全部商机/交付端点：`POST/PUT/GET /api/opp*`、`GET/PUT /api/opp/:code/delivery`、`POST .../import`（复用现 python 解析器与 row_sources）、`POST .../confirm`（G1 空行 400）；PUT 行改动后 status 回 draft。旧 `budget_delivery` 表转只读（GET 兼容回显，写端点 410 提示迁移）。
**Steps:** OP/DL 用例先红（对旧代码 404/405）→ 实现 → 绿 → OC 防回归 → 提交 `server.js tests/test_opp_api.js tests/test_delivery_opp.js`
**Commit:** `V4.0-T2 商机档案与交付预算端点: /api/opp CRUD(要素必填400/重码409) + /api/opp/:code/delivery 编制/导入/确认(G1空行门禁, 修订回draft), budget_delivery 转只读`

### Task 3: 三步链硬门禁 G2/G3/G4（计算判定层，最高风险）

**Files:** Modify `server.js`（/lock 938-952 段、/submit 1325-1336 段、archive 动作处）；Update `tests/test_delivery.js`（D- 门禁语义同批）、`tests/test_gate_presale.js`（T3 口径）
**Create:** `tests/test_chain.js`（CH-*）
**Interfaces:** `DELIVERY_REQUIRED_TYPES=['bid','presale','change']` 常量 + 一行回退注释（仿 BUDGET_REQUIRED_TYPES:301）。G2：锁定要求 opp_delivery confirmed（缺环 400 文案含「先完成交付预算编制并确认」）。G3：提交时二次核验（预算 locked ∧ 该商机交付 confirmed；change 仅在关联预算时核验）。G4：归档后无在途单 → opps.status='reviewed'。
**Steps:** CH-* 六态用例先红（缺①/①draft/①confirmed缺②/②locked缺③/全齐/历史绕过）+ 回退开关用例 → 实现 → 绿 → **锚定值回归**（pl8572/tiandi 经 DA/R 套件）+ D/T3 同批更新后全绿 → 提交 `server.js tests/test_chain.js tests/test_delivery.js tests/test_gate_presale.js`
**Commit:** `V4.0-T3 三步链硬门禁: 预算锁定需交付confirmed(G2) + 提交二次核验链(G3) + 归档翻转reviewed(G4), DELIVERY_REQUIRED_TYPES 一行回退, D/T3 套件同批演进`

### Task 4: 类型必填注册表合一（REQUIRED 单源 + /api/meta/fields + RQ 对账）

**Files:** Modify `server.js`（新注册表 + meta 端点；提交/对话/导入三消费点改读注册表）；消费 `agent.js` BID_REQUIRED 的调用点
**Create:** `tests/test_required.js`（RQ-*）
**Interfaces:** `REQUIRED = {opp, budget, review:{presale,bid,change}}`；D-1 裁定：提交硬门禁=现 FIELDS req 集；技能②白名单仅对话追问集。RQ 对账用例断言 `GET /api/meta/fields` 的 req 集 ≡ FE `public/app.js` FIELDS[type].req 集（解析 FE 源文本比对，漂移即红）。
**Steps:** RQ-* 先红 → 实现 → 绿 → A/R/EI 套件防回归（对话缺失清单语义不变）→ 提交 `server.js tests/test_required.js`
**Commit:** `V4.0-T4 必填注册表合一: 服务端 REQUIRED{opp,budget,review[type]} 单源 + GET /api/meta/fields + RQ 对账用例锁死 FE≡BE 零漂移`

### Task 5: 360 聚合端点扩展（opp 全要素 + delivery + chain 推导）

**Files:** Modify `server.js`（/api/opp/:code/360 块）
**Create(临时):** `tests/_tmp_360v2.js`
**Interfaces:** 响应追加 `opp`（opps 全行）、`delivery`（status/rows/total_cost/updated_at）、`chain`（delivery_confirmed/budget_locked/reviews_total/reviews_submitted/next_action 服务端按链序推导）。旧键零变更（向后兼容）。
**Steps:** 契约先红 → 实现 → 绿（PL00008572 真实数据断言 next_action）→ 提交 `server.js`
**Commit:** `V4.0-T5 360端点扩展: 响应追加 opp 全要素/delivery 摘要/chain 链路状态与 next_action(服务端推导, FE 零重算)`

### Task 6: 全流程页签重构（renderOpp360 七签 + 链路进度条 + 旧 t 兼容）

**Files:** Modify `public/app.js`（OPP_TABS/renderOpp360/路由 t 映射）；Update `tests/h_ia_shots.js`（IA-7~10 新文案与锚点）
**Interfaces:** 新 t 序 `overview/collect/pre/judge/analysis/chat/archive`；旧 `budget|review→collect`、`light→pre` 一次性映射；容器锚 `#oppPage/#oppTabs` 保留 + 新锚 `#oppChain`（链路进度条）`#oppDelivery/#oppBudgets/#oppReviews`；交付预算卡含行表/汇总/确认按钮/三方式入口（对话式 P1 前跳 #/agent）。
**Steps:** IA 套件按新断言先红（旧页签 FAIL）→ 实现 → 绿（14+ 全项）→ NAV/h_ui/h_flicker 防回归 → 提交 `public/app.js tests/h_ia_shots.js`
**Commit:** `V4.0-T6 全流程页签: 信息收集(三件套链路进度条)/前置评审/结论管理/数据分析 重排 + 旧t值301兼容 + 交付预算确认入口内嵌, IA 断言同批演进`

### Task 7: 新建待评审商机向导（#new 文案 + 要素建档 + 链路前置提示）

**Files:** Modify `public/app.js`（renderForm !type 块 + 建档表单 + renderShell「新商机」文案 + renderHome 文案）；Update `tests/h_ia_shots.js`（IA-1/3/4/5/11 新文案断言）
**Interfaces:** 「新建待评审商机」全站唯一文案；建档表单（OPP_REQUIRED FE 镜像 + 标签）→ POST /api/opp → 成功后类型三卡；选 bid 显示链路卡（缺环红显 + 三入口）；Excel 导入 upsert 商机（服务端已支持则 FE 零改）。
**Steps:** IA-11 改「待评审商机」断言先红 → 实现 → 绿 + h_manual 防回归（H-06 stat 锚不动）→ 提交 `public/app.js tests/h_ia_shots.js`
**Commit:** `V4.0-T7 新建待评审商机: 向导文案全站收敛 + 商机要素建档(必填400前端同步标注) + 选类型即链路前置提示卡, IA-11 断言演进`

### Task 8: 列表链路列 + 收工门全回归（原子切换）

**Files:** Modify `public/app.js`（renderOppsList chain 列 + renderHome 交付待确认待办）；Modify `tests/run_all.js`（注册 OP/DL/CH/RQ 套件）
**Steps:** run_all 逐套全绿（套数 20→24±）→ 单行翻红按偶发规程复跑 → `--log=tests/green_run_v4.txt` 落盘 → 提交 `public/app.js tests/run_all.js tests/green_run_v4.txt`
**Commit:** `V4.0-T8 收工门: 商机列表链路进度列 + 首页交付待确认待办 + run_all 全绿(新套件 OP/DL/CH/RQ 注册)`

---

## P1/P2

P2：数据分析页签（商机级+漏斗）、机器人会话与监控、FE 动态字段渲染。

### P1 任务表（spec §6 契约 → 可派发任务；**串行接在 T8 收工门之后**，不得与 P0 抢 `data/review.db`）

用户产品口径明确要求「LLM 管理中心与机器人管理中心必须补齐」，故 P1 不属于可选尾巴；任务在此定形，派发词按 P0 同构（brief 含逐字代码 + dispatch 含硬约束与收工门）。

| # | 任务 | 落地面（对齐 spec §6） | 收工门（新套件 + 不得翻红的既有套件） | 专属红线 |
|---|---|---|---|---|
| **T9** | LLM 管理中心 `#/admin/llm`（admin）——**属扩展非新建（D-43）** | **既有落点**：`/api/admin/config`（`server.js:1841`）已做 admin 限定 + `maskKey` 掩码 + merge 写回；**T9 只补四件**：FE 页 `#/admin/llm`（现网 `app.js` 零命中）、`LLM_PROFILES{default,budget,review,parser}` 挂在同一写者上、`POST /api/admin/llm/test {profile}`（1-token 探针→`{ok,ms,error}`）、新表 `llm_calls(ts,profile,ok,degraded,ms,tokens_est,ref)` + settings `llm.degrade{timeout_ms,retries,enabled}`、`prompt.<skill>.v<n>` | `tests/test_llm_admin.js`(LM-01~)：非 admin 一律 403、探针在 9801 桩下 `ok=true`、桩断开时**仍返回 200 且自动降级点选**、`llm_calls` 行数随调用单调增长、写回后四键仍在、**任何读端点都不得回明文 key**；既有 `test_agent_chat.js`(AV) 与 `test_security_notify.js`(SN) 零翻红 | **`config.json` 单一写者**：profiles 写入必须走既有那条 read-modify-write（或复用同一 helper），**禁止**新开第二个 `fs.writeFileSync(CFG,…)`（并发丢更新 + 历史上真出过整写吞 `REPORT_SECRET`）；该文件永不入 git；LLM 只参与「口语→结构化」与「缺项→追问」，**判灯/算账/锁定/提交/结论确认不得读 LLM 输出** |
| **T10** | 机器人管理中心 `#/admin/robot`（admin，依托 `notify.js`）——**属改造非新建（D-44）** | 表 `robot_instances(name,webhook,secret,env,enabled)`、`notify_matrix(event,target,enabled,channel)`、`robot_whitelist(user_id\|phone,scope:create\|query)`；CRUD + `POST /api/admin/robot/test {id}`。**`event` 列实名取自 `server.js` 六个 `notifySafe` 调用点**（红灯自动打回 / 研判完成 / 前置评审任务分发 / 评审结论·绿灯发布 / 评审归档 / 评审单被退回）+ weekly / XO 两类定时，**禁止新造事件名**；**webhook 唯一真源改为 DB 表**，现网 `config.json` 的 `NOTIFY_WEBHOOK_URL` / `COMMITTEE_WEBHOOK_URL` 降为迁移前 fallback 与只读展示（一次性迁移，不留两条读路径） | `tests/test_robot_admin.js`(RB-01~)：非白名单 403、`scope` 边界（create≠query）、`enabled=false` 不触发出站请求（走本地 webhook 桩）、`secret` **只写不回显**（读接口返掩码）、矩阵关闭后 SN 套件的期望随之变化而不静默丢通知、**每个真实发送点都能被矩阵命中**（事件名对不上即红） | 机器人侧动作必须走**同一套门禁**（G1~G4 + `/submit` 必填门），不得为机器人开免检旁路；**不得削弱 N-02**（通知失败重试 1 次后仅 `console.error`，永不阻断主流程）与「webhook 未配置静默跳过」；出站 URL 落库前校验协议仅 `http`/`https` 且拒绝以 `-` 开头（现网走 `spawn('curl',[参数数组])`，无 shell 但 URL 是参数面） |
| **T11** | 对话式建档 + 打灯矩阵聚合视图（spec §7 D-3 排期项；实测为**新技能 + 纯展示扩展**，非改造：`agent.js` 现只有技能①预算编制 / ②评审表编制 / ③预判摘要，**无建档意图**） | 建档走既有对话骨架：复用 `extractFields(draft, message, llmCfg)`（`agent.js:154`）+ `mergeDraft(..., opts)`（`:123`，白名单驱动）+ `checkMessage`（`:112`）+ `buildReply`（`:194`），新增 **OPP_SYSTEM_PROMPT / OPP_WHITELIST**（白名单＝服务端 `OPP_REQUIRED` 12 键同集，禁另立一份），落库调既有 `POST /api/opp`；聚合视图数据源仍是 360 的 `lights` 对象与 `tasks`/`reviews` 行集，**不新增判定** | 建档对话路径必须复用 OP 套件的**形态正则 400 与 `missing[]` 恰含**断言（D-33：`opp_code` 由正则门先行、永不进 `missing[]`）；聚合视图数字须与 `lights` 逐项相等，且按 D-25 在线单 / 历史单**分列不得混算** | 建档对话**不得绕过** `SUBMIT_REQUIRED_GATE`（对话只产出档案与草稿单，提交仍走 `/submit` 四层门）；LLM 仅做「口语→结构化」与「缺项→追问」，**判灯/算账/锁定/提交/结论确认不得读 LLM 输出**（铁律 2）；LLM 失败必须自动降级点选问答且 HTTP 仍 200 |

**注册义务**：T9~T11 各自的新套件必须同批进 `tests/run_all.js` 的 `SUITES`（按 D-26 / D-39 ②，契约类套件不得只留日志），套数继续按实测项数写、不写推算值。

**P1 落地实况（2026-10-15 总线实测，逐条可复核）**

- **T9 LLM 管理中心** = `c5cfbe9`（`tests/test_llm_admin.js` 41/0，LM-01~14）。
- **T10 机器人管理中心** = `4193ec2`（`tests/test_robot_admin.js` 61/0，RB-01~11 含 10a/10b）。
- **T11 对话式建档 + 灯色聚合** = `d0c01b6`（`tests/test_opp_dialog.js` 30/0，OD-01~10）。
- **T12 测试面闭环**（注册义务的执行体）= `6230a4e`：三套注册使 `SUITES` **25 → 28**（`grep -c "^    \['"` 实测），并补 D-41 的 **C2-04b**（`test_opp360.js` 末行 **23 → 24**，钉住 `server.js:1737` 的 `onlineReviews.some(status==='reviewing')` 支）；全量门 **`28/28 套通过, 耗时 464.0s -> ALL PASS`**，首轮那条 `EI-09 4482ms>4000ms` 红按 **D-54** 分类为环境型负载红（单跑三次 2484/2890/2893ms，阈值一字未放宽）后复跑转绿。
- **T13 = D-53 补救**（`tests/h_admin_shots.js`，AD 系列，浏览器层验 `#/admin/llm` 与 `#/admin/robot`，含明文 key 红线与 console/pageerror 零错误）：派发 `60685cc3`，注册后套数 28 → **29**。**在 AD 套件转绿前，P1 两个管理中心记「后端已验、前端待验」。**
- **T14 = D-52 补救**（`server.js:2364-2365` 的 `fill-budget` 自抄凭据解析收敛进 `resolveLlm`/`logLlmCall`，`server.js:2034` 顶层 `LLM_BASE_URL` 写入侧加 `/^https?:\/\//i` 拒绝）：简报 `task-14-brief.md` 就绪，**待 T13 让出工作区后串行派发**（同文件并发与并发跑门是 D-48/D-50 的事故成因）。
- P2（数据分析页签、机器人会话与监控、FE 动态字段渲染）不在 V4.0 范围，未开工。

## Self-Review 记录

- Spec 覆盖：§1→T1/T2，§2→T3，§3→T2/T5，§4→T6/T7/T8，§5→T4，§8→各任务步骤与 T8。无缺口。
- 依赖序：T1→T2→T3（门禁依赖 confirmed 状态）；T4 独立可并行；T5→T6→T7→T8（FE 消费链）。执行按 T1..T8 串行。
- 风险最高=T3（改判定）：锚定值回归 + 一行回退 + CH-* 六态全覆盖。
