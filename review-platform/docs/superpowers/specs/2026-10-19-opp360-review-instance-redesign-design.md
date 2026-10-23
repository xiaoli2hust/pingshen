# 商机 360° 重构：商机档案 + 多次评审实例

日期：2026-10-19

状态：待用户复核。本文档只描述设计与验收，不含实现；复核通过后才进入 writing-plans 与 TDD。

基线：HEAD `186b251`。工作区含七月真实单据链路未提交改动，本文档全部行号以当前工作区实测为准，不以 HEAD 的旧文件为准。

## 1. 目标与不可退让边界

业务事实：一个商机在生命周期内可以经历多次评审——售前立项评审、投标决策评审、项目关键事项决策，且同一类型也可能发生多次（例如上一轮退回后重新提交，或年度内再次投标）。因此「商机」是档案与容器，「评审」才是一次有申请人、有轮次、有部门任务、有灯态与结论的事件。

本设计要解决两件事：

1. 进入商机后先看到**商机概览**：新商机显示必填要素与缺项；老商机显示**最新有效要素**（来自最新未撤回评审，而不是首次建档时的快照）。
2. 现在按「信息收集 / 前置评审 / 结论管理 / 数据分析 / 对话 / 归档」切开的维度，全部收进**某一次评审实例**内部；商机页只保留跨实例共享的资源与实例列表。

不可退让边界（沿用本工作区既有约束，逐条生效）：

1. 不提交 git；不修改 `config.json`；不进行真实钉钉或外网调用；不写凭据、不申请权限、不把「未绑定/未激活」伪装成成功。
2. 不用 SQL 伪造算账、锁定、提交、判灯、归档、结论等业务工作流终态；测试夹具一律走带鉴权 HTTP（内部发送队列除外）。
3. LLM 不判灯、不算账、不锁定、不提交、不确认结论；LLM 失败降级路径不在本次改动范围内。
4. 零 npm 运行时依赖；不擅自修改用户全局配置（git config / 环境变量 / PATH）。
5. 判灯引擎、财务计算、预算锁定、评审状态机、结论与归档权限**零改动**；后端只新增一个只读 GET 端点（`prefill`）和两处纯追加读字段（360 顶层 `profile`、评审详情 `siblings`），其余改动都在前端信息架构。
6. 零数据库 schema 变更。现有 `opps`、`reviews`、`tasks`、`events`、`attachments`、`budgets` 已完整支持一商机多评审；不新增列、不新增表、不迁移数据。
7. 专项与全量门都会写共享演示库：每次开跑前停机快照，跑完后停机按字节级还原（沿用 D-67 口径，见 §11.4 第 4 条）。

兼容面（实现必须保住，且由既有套件或新增断言钉住）：

| 契约 | 现状锚点 | 本次要求 |
|---|---|---|
| 360 `delivery` 恰好 8 键 | `server.js:1876-1921`；`tests/test_opp360.js` C2-02 | 不变 |
| 360 `chain` 恰好 5 键 | 同上 C2-03 | 不变 |
| `#/review/:id` 可打开评审详情 | `public/app.js:173`；COMPAT-1 | 不变，改为渲染 L2 实例页 |
| 商机页 `#oppPage` | `public/app.js:2185`；IA-7/8b | L1 继续使用 |
| `#decisionCard`、`.light-banner`、`.progress-seg` | `public/app.js:773`、`701-706`、`747`；h3_check/h_ui | L2 必须始终可被选择器命中 |
| 回归套数 32 | `tests/run_all.js:22-55` | 不新增套件，仍为 32 |

## 2. 现状与根因（逐条实测）

1. **360 是全商机聚合，不是单实例。** `server.js:1880` 一次取出该 `opp_code` 的全部评审单；`lights` 在 `1886` 对全部评审单计数；`tasks` 也在 `1884` 按 `opp_code` 全量取出。前端 `OPP_TABS`（`app.js:2038`）再把这些聚合结果按功能切成七个页签。
2. **单个全局引导会被多实例互相掩盖。** `next_action` 在 `server.js:1908-1914` 由所有在线单求和得出一个标量；`chain.reviews_submitted` 只数「已提交张数」，前端 `app.js:2090` 的 ③ 只看 `reviews_submitted > 0` 就显示「✓ 已完成」。于是「一张已归档 + 一张已退回」的商机，③ 仍显示完成，全局文案也无法同时表达两张单的不同状态。历史承接单不参与在线口径（D-25），更会让全局文案与列表里看到的红灯退回单不一致。
3. **第一次建档的快照被当成永久档案。** `upsertOpp` 在 `server.js:411` 明确「只补档, 永不覆盖」；`OPP_INHERIT`（`app.js:32`，实测 11 键；`title` 不在其中，由 `#f_title` 单独处理）与 `465-466` 新建评审时只从 `/api/opp/:code` 复制这 11 个档案字段。老商机第二次评审时，带入的是首次建档值，不是最近一次评审值——与「带入最新的必填元素」相反。
4. **数据层其实已经按实例隔离。** 评审详情 GET 在 `server.js:2021-2023` 已按 `review_id` 过滤 tasks / events / attachments；`reviews` 表已有 `type`、`round`、`budget_id`、`status`、`light`、`decision_result`、`era`、`archived_at`。缺的只是前端路由、两级呈现与少量只读聚合字段。
5. **缓存只失效 360，且评审详情完全不走缓存。** `invalidate360Cache`（`app.js:111-116`）只清 `/api/opp/*/360`；`renderDetail`（`app.js:691`）用 `api()` 全量重取。结果是 360 能缓存但评审详情每次都打网络，写后重进又可能读到旧 360。
6. **路由没有实例层。** `app.js:160` 的 `#/opp/` 分支先于一切，`#/review/:id` 只能是平级详情页；`#/opp/:code/r/:id` 这种实例深链当前不存在。

一个具体的失败例子：商机 `PL00007297` 有一张退回/红灯的投标决策单；若同一商机还有一张已归档单，L1 的 ③ 会显示「已完成」，页面只有一个混合了所有单的「前置评审」页签，用户无法从商机页看出「是哪一次评审退回了、它自己的任务与结论是什么」。

## 3. 两级信息架构与路由

### 3.1 两级定义

- **L1 商机概览**：`#/opp/:code`。回答「这个商机是什么、共享资源办到哪、有哪些评审实例」。
- **L2 评审实例**：`#/opp/:code/r/:reviewId`。回答「这一次评审走到哪、它的信息、任务、灯态、结论是什么」。

`#/review/:reviewId` 继续可用，渲染与 L2 完全相同的组件，不做重定向；面包屑父级同样指向 `#/opp/:code`。这样旧链接、h_ui、h3_check 与 COMPAT-1 都不需要改语义。

### 3.2 路由顺序（`renderRoute`，`app.js:157-176`）

必须按下列顺序匹配，每条先去掉 query：

1. `#/opp/:code/r/:id` → `renderDetail(id, code)`；必须放在 `#/opp/` 之前。
2. `#/opp/:code` → `renderOpp360(code)`（L1）。
3. `#/review/:id/edit` → `renderForm(null, id)`；必须放在 `#/review/` 之前。
4. `#/review/:id` → `renderDetail(id, null)`。

`renderForm` 必须先调序才能支撑第 3 条：现实现 `app.js:401` 的 `if (!type)` 早于 `app.js:453` 的 `EDIT_ID = editId || null`，`renderForm(null, id)` 会落到建档首屏而不是编辑页。改法：函数开头先判断 `if (editId)`，先 `GET /api/reviews/:id` 取 `review.type`、`review.round` 与 `form_json`，再设 `EDIT_ID`、`window._round = review.round`，最后按该 `type` 渲染；`type` 入参只在新建时使用（第 3 条传 `null`）。保存仍走既有 `PUT /api/reviews/:id`，编辑页不新增写端点；保存成功后的落点沿用现状 `#/budget/:EDIT_ID`（`app.js:676-677`），本设计不改。

`#/review/:id/edit` 用来替掉现有「`location.hash='#/new/x'` + `setTimeout(()=>renderForm(type,id),0)`」的竞态写法（`app.js:791`、`793`），并让「红灯打回」也能直达编辑页。

### 3.3 实例与轮次不是一回事

- **实例** = `reviews` 表的一行。同类型第二次发起是另一行，`id` 不同，在 L1 列表里是另一张卡。
- **轮次** = 同一行因退回后重新提交而递增的 `round`（`server.js:2110`）。它仍是一条评审单、一个 `review_id`、一份 `form_json`。
- 轮次选择器只作用于：任务列表/打灯矩阵、头部进度。流转记录是**实例级**（`events` 表无 `round` 列，实测确认），不按轮次过滤，文案标注「本实例全部轮次」。
- 表单与结论没有按轮次版本化：`reviews.form_json`、`decision_result` 都是单行单值。本次不引入版本表；轮次 > 1 时表单页显示一句「表单为实例级，不按轮次版本化」。

## 4. 设计裁定

### D-68：商机 = 档案 + 多评审实例，L1/L2 两级

L1 采用单页滚动分区，不再有页签；L2 才有页签。L1 的任何「进入某次评审」都走 `#/opp/:code/r/:id`。`#/review/:id` 保留为同一 L2 渲染器的别名。

### D-69：L1 的 ③ 不再承担全局引导

`#oppChain` 保留 ① 交付预算 / ② 项目预算 / ③ 评审单 三个 `.chain-dot`。③ 去掉「✓ 已完成」与「去提交」，改为中性实例计数（例如「进行中 1 · 已提交 2」）；点击由 JS `scrollIntoView` 定位 `#oppInstances`——**不得写成 `<a href="#oppInstances">`**，hash 路由会把这次点击当成路由跳转而离开商机页。`NEXT_ACTION_TEXT` 收缩为只保留前三个键（`confirm_delivery` / `lock_budget` / `submit_review`），只在 ①② 未完成时显示全局提示；一旦已有评审单提交，L1 不再显示全局「当前该做的」，逐张单的状态由实例卡表达。

### D-70：360 只做加法

`reviews[]` 追加 `budget_id`、`budget_code`、`applicant_name` 三键；顶层追加 `profile`（见 §5.1）。`delivery` 8 键、`chain` 5 键、`opp` 18 列、`budgets`/`tasks`/`lights` 结构全部不变。排序从 `updated_at DESC` 改为 `updated_at DESC, id DESC`，只为消除同秒并列的不确定性。

### D-71：要素带入用逐字段级联，档案只是最后兜底

同一个解析帮手服务两个入口：L1 的 `profile`（跨全部类型）与 `#/new` 的 `prefill`（按目标类型）。级联层级见 §5.2。草稿一律排除；`0` 是有效值；只填空不覆盖。

### D-72：`summary` 不跨类，`title` 独立，代码不由前端派生

- `summary` 永不跨类型取：售前与投标的「项目概述」只取同类型或档案；`change` 的 `summary` 是「决策事项概述」，永不取档案（档案里是项目概述）。
- `title` 走独立级联 1→2→3→4→5（§5.2），不受 `CROSS_TYPE_KEYS` 限制，因为项目名称在三种评审里语义相同。
- `opp_code` 由 URL 上下文强制，不从级联取；`proj_code` 永不从 `opp_code` 推导。

### D-73：旧深链映射为 L1 分区焦点，不做页面重定向

`#/opp/:code?t=budget|collect|review|pre|light|judge|analysis|chat|archive` 一律 `history.replaceState` 去掉 query，落到 `#/opp/:code`，并给对应分区加 `data-focus`：

| 旧 t | `data-focus` | 落在哪个分区 |
|---|---|---|
| `budget` / `collect` | `collect` | `#oppShared` |
| `review` / `pre` / `light` | `pre` | `#oppInstances` |
| `judge` / `archive` | `judge` / `archive` | `#oppInstances` |
| `analysis` | `analysis` | `#oppAnalysis` |
| `chat` | `chat` | `#oppAgent` |

`replaceState` 不触发 hashchange，不会形成循环。滚动定位可选（`scrollIntoView({block:'start'})`），但测试只断言 hash 与 `[data-focus]`，不断言滚动位置，避免时序抖动。

建档成功后的落点改为 L1：`oppAfterCreate`（`app.js:613-619`）改为 `#/opp/:code`。`#/new?opp=已建档商机` **不重定向**，仍是「选择首个评审类型」页（IA-25 保留），因为 L1 的「发起新评审」就链接到这里。

### D-74：评审详情追加 `siblings`，L2 不拉 360

`GET /api/reviews/:id` 追加 `siblings[]`（不含自身、同一 `opp_code`、按 `updated_at DESC, id DESC`）。L2 只请求这一个端点即可渲染实例切换器，不再为切换到另一张单而先拉 360。`siblings` 为空时隐藏切换器。

### D-75：轮次选择器是本地视图筛选

数据在评审详情响应里已经齐备（`tasks` 含 `round`）。轮次切换只过滤已加载的 `tasks` 并重绘矩阵/进度，**零网络请求**。不改变 `reviews.round`，不触发任何写操作。

### D-76：缓存命中零 loading，写后失效一次

新增 `peekCached(path)`；L1 与 L2 命中新鲜缓存时同步渲染、不调用 `showLoading`、不发请求。L2 四个页签的切换是纯本地重绘，零请求。任何成功非 GET 调用后，统一失效三类缓存：`/api/opp/*/360`、`/api/opp/*/prefill*`、`/api/reviews/:id`（含子路径）。写后重新进入页面恰好刷新一次。

### D-77：测试等强度或更强，不新增套件

现有 32 套不变。C3 用例追加进 `tests/test_opp360.js`；IA 用例在 `tests/h_ia_shots.js` 内迁移并新增 IA-35~IA-40。旧断言只允许替换选择器/路由锚点，不允许把精确相等放宽为 `includes`、不允许删断言凑绿。新夹具全部走带鉴权 HTTP；历史来源夹具走真实 `POST /api/reviews/import mode=history`（与 `tests/test_history_import.js:27-58` 同机制生成最小 xlsx），禁止直接 SQL 写业务状态。

### D-78：权限与状态机零改动

不新增写端点、不改任何端点的鉴权分支。两个新能力（360 的 `profile`、`prefill`）都是登录即可读的 GET，与 360 现有口径一致。提交、打灯、退回、研判、结论、归档仍由原端点与原按钮触发。

### D-79：零 schema，档案语义不动

不新增表/列；`upsertOpp` 的「只补档，永不覆盖」不改。L1 的档案卡是**只读档案快照**；「最新值」由 `profile` 单独表达，每个字段标明来源（最新评审 / 档案 / 待补），不让用户误以为档案被自动覆盖。

## 5. 商机要素解析：`profile` 与 `prefill`

### 5.1 L1 的 `profile`（360 顶层新键）

字段形状（示例；`sources` 此处只展示 3 个键并省略同构项，实际恒含 12 键）：

```json
{
  "profile": {
    "fields":  { "title": "…", "customer": "…", "region": "西湖区", "province": "江西省", "biz_line": "G1",
                 "contract_amount": 240, "opp_stage": "投标决策", "sign_date": "2026-12-31", "sales": null,
                 "pm": "…", "survey": "否", "summary": "…" },
    "sources": { "title": { "kind": "review", "id": 12, "type": "bid", "era": "online", "round": 1,
                            "status": "judged", "updated_at": "2026-10-18T…" },
                 "customer": { "kind": "review", "id": 12, "type": "bid", "era": "online", "round": 1,
                               "status": "judged", "updated_at": "2026-10-18T…" },
                 "region": { "kind": "archive" } },
    "missing": ["sales"]
  }
}
```

规则：

- `fields` 与 `sources` 恒含 `OPP_FIELDS`（`server.js:421`）的全部 12 键；未解析到值为 `null`。
- 来源取数：`title` 取评审行的 `reviews.title`（为空再回落该行 `form_json.title`）；其余 11 键取评审行 `form_json` 的同名字段。档案来源取 `opps` 同名列，仅在 `opps` 行存在时可用。
- 参与解析的评审 = 该 `opp_code` 下全部 `status <> 'draft'` 的行（含 `era='history'`），按 `updated_at DESC, id DESC` 排序。逐字段取第一个非空值；`summary` 跳过 `type='change'`；其余键不区分类型。
- 值一律**原样返回**，不做第二套数值解析；`0` 原样保留。
- `missing` 是 `OPP_REQUIRED`（`server.js:334`，7 键）中 `fields` 为空的键，恒为其子集；非必填空值不入 `missing`。
- 来源对象：来自评审时 `kind:'review'` 并带 `id/type/era/round/status/updated_at`；来自档案时 `kind:'archive'`；未解析为 `null`。
- 该键纯读取，零写库。

前端 `#oppProfileCard` 按 12 键渲染，必填缺项显示「待补」（带 `data-missing`），非必填空值显示「—」；来源为评审的字段加小标「评审」，来源为档案的加「档案」。卡片标题下固定一行说明：档案只在首次建档落库、不会自动覆盖，最新值取自最近一次非草稿评审。

### 5.2 `GET /api/opp/:code/prefill?type=`（新端点）

用途：`#/new/:type?opp=:code` 新建评审时逐字段带入。

`type` 必须 ∈ `presale | bid | change`，否则 400。未登录 401。`opps`、`reviews`、`budgets` 三者皆无该码时 404（与 360 同口径）。全部只读。

响应：

```json
{
  "code": "PL00008572",
  "type": "bid",
  "title": "项目名称",
  "title_source": { "kind": "review", "scope": "same", "id": 12, "type": "bid", "era": "online",
                    "round": 1, "status": "judged", "updated_at": "2026-10-18T…" },
  "fields":  { "<目标类型 FIELDS 的每个键，除 opp_code>": "…" },
  "sources": { "<同 fields 的键>": { "kind": "review|archive", "scope": "same|cross|archive", "id": 12,
                                     "type": "bid", "era": "online", "round": 1, "status": "judged",
                                     "updated_at": "…" } }
}
```

`fields` 与 `sources` 恒含目标类型的全部键（除 `opp_code`）；未解析到值的键在 `fields` 中为 `null`、在 `sources` 中为 `null`。不返回 `missing`——前端提示只需按非空/空计数，提交必填门仍由 `FIELDS[type]` 的 `req` 标志在提交时判断。

`fields` 的键集 = `FIELDS[type]`（`app.js:35-108`）去掉 `opp_code`；服务端用同一份 `REQUIRED.review[type]` 键集（`server.js:684-764`，实测键集与前端逐字一致）。`title` 单独返回，不放进 `fields`。

逐字段级联（每个键独立判断，非整单回退）：

1. 在线同类型、非草稿、该键非空的最近一张（`era IS NULL OR era='online'`）。
2. 在线跨类型、非草稿、该键非空的最近一张；仅当该键 ∈ `CROSS_TYPE_KEYS` = `customer, biz_line, region, province, sales, pm, contract_amount, opp_stage, sign_date, survey`，且目标类型确实有该键。
3. 历史同类型、非草稿、该键非空的最近一张（`era='history'`）。
4. 历史跨类型、非草稿、该键非空的最近一张；同样受 `CROSS_TYPE_KEYS` 限制。
5. `opps` 档案同名列；仅当该键 ∈ `OPP_FIELDS`。

例外面：

- `summary`：只走 1、3、5，且 `type='change'` 时跳过 5。永不跨类型。
- `title`：走 1 → 2 → 3 → 4 → 5（不看 `CROSS_TYPE_KEYS`）；来源取评审行的 `reviews.title` 列，为空再回落该行 `form_json.title`。
- `opp_code`：不参与级联，由 URL 上下文强制写入。
- `proj_code`：只走 1、3、5（同类型在线、同类型历史、档案）；档案无该列即 `null`，永不从 `opp_code` 派生。

空值谓词：`v === undefined || v === null || String(v).trim() === ''` 视为空；`0`、`'0'`、`false` 不是空。草稿（`status='draft'`）不参与任何一级。排序每级都是 `updated_at DESC, id DESC`。

前端使用（`renderForm`，`app.js:455-468`）：

1. 删除 `OPP_INHERIT`（`app.js:32`）及其唯一使用点 `465-466`。
2. 新表单（`!editId && ctxCode`）改为 `GET /api/opp/:code/prefill?type=:type`；`title` 仅在标题框为空时填入；`fields` 仅在对应表单值为空时填入；`form.opp_code = ctxCode` 最后强制写入。
3. 顶部提示改为 `#pfHint`：「已带入 N 项：评审 X 项 / 档案 Y 项 / 待补 Z 项」。N = X + Y = `fields` 非空键数（不含 `opp_code`），Z = 空值键数，N + Z = `fields` 键数；X 含在线与历史评审来源。
4. 请求失败不阻断表单：降级为空表单 + toast，保持可手工填写；降级时仍最后强制 `form.opp_code = ctxCode`，不丢上下文。

## 6. 360 与评审详情 API 增量

### 6.1 `GET /api/opp/:code/360`

只加两类：

1. `reviews[]` 每项追加 `budget_id`（`reviews.budget_id`，无则 `null`）、`budget_code`（`LEFT JOIN budgets` 的 `code`，无则 `null`）、`applicant_name`（`reviews.applicant_name`）。
2. 顶层 `profile`（§5.1）。

排序改为 `ORDER BY updated_at DESC, id DESC`。其余 SQL 与字段一字不动。

### 6.2 `GET /api/reviews/:id`

追加 `siblings[]`，每项：

```
{ id, type, title, status, round, light, era, decision_result, archived_at, updated_at,
  budget_id, budget_code, applicant_name }
```

排除自身；`review.opp_code` 为 `null` 时返回 `[]`。原有 `{review,tasks,events,attachments,budget}` 不变；tasks/events/attachments 继续按 `review_id` 过滤（`server.js:2021-2023`）。

### 6.3 明确不动的契约

`delivery` 8 键、`chain` 5 键、`opp` 18 列、`budgets` 行、`tasks` 行、`lights` 四档计数、`#review/:id` 的五个旧键（`review` / `tasks` / `events` / `attachments` / `budget`），全部保持。`profile` 与 `siblings` 都是纯追加，旧消费方不受影响（C2-01 只断言旧键在场，不拒绝新键）。

## 7. L1 商机页（`#/opp/:code`）

保留外壳 `#oppPage` 与面包屑 `#/opps › 全部商机 › 标题`；去掉 `#oppTabs`、`OPP_TABS`、`OPP_TAB_ALIAS`、`oppTabFromHash` 与 `renderOpp360` 里的 `t` 分支。分区顺序：

1. `#oppProfileCard` —— 商机档案（只读）。12 要素 + 必填缺项「待补」（`data-missing`）+ 来源小标（评审 / 档案）；底部固定一行「档案只在首次建档落库，不会自动覆盖；最新值见上方来源标注」。
2. `#oppChain` —— 三步链。保持 3 个 `.chain-dot` 与 ①②③ 文案；①② 未完成时显示 `NEXT_ACTION_TEXT` 对应文案与原有去办理链接；③ 去掉「✓ 已完成」，改为中性实例计数（如「进行中 1 · 已提交 2」），点击由 JS `scrollIntoView` 定位 `#oppInstances`，不写 `<a href="#oppInstances">`。已有评审单提交后不再显示全局「当前该做的」。
3. `#oppShared` —— 跨实例共享资源：
   - `#oppDlv`：商机级交付预算编辑器。外层卡增加 `id="oppDlv"`，卡头状态 pill 增加 `id="opdlvPill"`，工具条说明区增加 `id="opdlvHint"`；数据仍由 `OPDLV` / `opdlvMount` / `#opdlvTable` / `#opdlvSum` 驱动。认证且 `can_write` 时挂载；只读态不发明细请求（D-21 原样）。
   - `#oppBudgets`：项目预算表 + `[data-obc]` 挂靠建单入口。
   - `#oppLaunch`：发起新评审，三张类型卡（售前立项 / 投标决策 / 关键事项决策），链接 `#/new/:type?opp=:code`；卡片区文案含「项目评审单」字样。
4. `#oppInstances` —— 评审实例。两个分组容器**始终渲染**（组内为空时渲染空态，保证 IA-35 稳定断言）：
   - `.inst-group[data-group="inflight"]`：`era` 不为 `history` 且 `status ∈ {draft, reviewing, returned}`，标签「进行中」。
   - `.inst-group[data-group="ended"]`：`era='history'`（不论状态）或 `status ∈ {judged, archived}`，标签「已结束」。
   - `.inst-card[data-rid]`：类型、标题、状态 pill、灯态 pill、第 N 轮、申请人、关联预算单 `budget_code`（无则「—」）、更新时间、「进入本次评审 →」→ `#/opp/:code/r/:id`。
   - 两组都为空时，在 `#oppInstances` 内显示「本商机还没有评审实例」+ 三类型发起按钮。
5. `#oppLightAgg` —— 固定的「灯色汇总」卡：卡头必须含「灯色汇总」四字，并显示红/黄/绿计数（`d.lights`）与 `lightDistBar(rs)` 分布条；其下沿用 `oppLightAggHtml(oppLightAgg(d))`，保留 `[data-agg="inflight"]` / `[data-agg="history"]`。文案「跨全部实例，只展示不判定」。现「灯色汇总」只存在于 judge 页签（`app.js:2164`），L1 必须把它落在这里，IA-16 才有新锚点。
6. `#oppAnalysis` —— 数据分析空态占位（保留「上线中」文案）。
7. `#oppAgent` —— 智能体入口，卡头保留「技能①预算 / 技能②评审表」，列出该商机预算单与草稿评审的对话目标（沿用 `oppChatBudget` / `oppChatReview`）。

旧 `?t=` 深链按 D-73 映射 `data-focus`，不渲染旧页签。

文案同步：`app.js:440` 建档首屏提示里的「商机 360° · 信息收集」页签改为「商机概览页」；`NEXT_ACTION_TEXT` 三条文案里的「去「信息收集」」改为「去商机概览对应分区」。

交付明细保存后，`opdlvSave` 直接使用 `PUT /api/opp/:code/delivery` 响应里的 `status:'draft'`（`server.js:1979`）就地更新 `#opdlvPill` 文案与 class、启用确认按钮，不重绘表格、不重拉 360；`opdlvConfirm` 同理用 `/confirm` 响应（`server.js:2010`）就地更新为「已确认」并禁用按钮，不再调用 `renderOpp360`。这样 IA-8b 的第 ④ 步不再需要点页签。

## 8. L2 评审实例页（`#/opp/:code/r/:id` 与 `#/review/:id`）

外壳 `#reviewInstancePage`；面包屑用 `crumbBar(href, parent, current)`（`app.js:134-139`）：返回按钮与父链接都指向 `#/opp/:code`、标签「商机概览」，正文「商机概览 › 本次评审标题」；`review.opp_code` 为 `null` 时父级退回 `#/opps`、标签「全部商机」。结构：

1. `#instHead`：
   - `.light-banner`：**始终渲染**。历史单 / judged / archived / returned / 其他状态各用现有文案与配色。
   - 标题行：标题、类型、申请人、状态 pill、第 N 轮。
   - `#instSwitcher`：`review + siblings` 按更新时间倒序，按钮显示「类型 · 标题（截断）· 状态」；当前项高亮；点击 `#/opp/:code/r/:id`。总数 ≤ 1 时隐藏。
   - `#instRoundSel`：仅当 max(`review.round`, tasks 的最大 `round`) > 1 时显示；选项 1..max；默认 `review.round`。
   - `#instProgress`：**始终包含 `.progress-seg`**；无任务时渲染零宽分段 + 全零图例，不用 `.empty` 取代。轮次选择改变时只重绘这里。
   - `#instTabs`：四个按钮 `data-tab` = `form | pre | result | chat`，文案「本次信息收集」「本次前置评审」「本次结论与归档」「本次对话」。
   - 动作区：保留五个按钮与权限判断——修改材料（owner）、提交评审（owner + draft/returned）、红灯打回（owner + judged + red）、重新研判（支持组/admin + reviewing）、归档存储（支持组/admin + judged）。「修改材料」与「红灯打回」改为 `#/review/:id/edit`。删除与面包屑重复的「返回工作台」（已 grep：无测试依赖）。
2. `#instBody` 四个页签：
   - `form`：本次信息收集——表单字段表、附件列表与上传、在线预算入口 `#/budget/:reviewId`（沿用现状 `app.js:730`）、关联预算单（`review.budget_id` 非空时显示 `#<id>` 并链 `#/budget-detail/:id`；详情响应没有 `budget_code`，不要求展示单号）。
   - `pre`：本次前置评审——本次实例的待我评审、任务矩阵、轮次留痕（按选中轮次过滤）。
   - `result`：本次结论与归档——`#decisionCard`（支持组 + judged + 未录结论时原样出现）、已录结论、AI 研判报告、归档信息、`#instTimeline`（本实例全部轮次）。
   - `chat`：本次对话——本实例评审表 + 其关联预算单的对话目标（`oppChatReview` / `oppChatBudget`）。
3. 默认页签（仅首次进入或状态改变后重新套用）：
   - `era='history'` 或 `status ∈ {judged, archived}` → `result`
   - `status='reviewing'` → `pre`
   - `status ∈ {draft, returned}` → `form`
4. 动作后的页签：状态改变类（提交、研判、归档、退回）重新套用默认规则；非状态改变类（上传附件）保持当前页签。动作后的重渲染统一用 `renderDetail(review.id, INST.ctxCode, keepTab)`，把入口形态原样带下去。
5. 实例隔离：tasks 按 `review_id`；轮次筛选只对 `tasks`；events/attachments 是实例级，不按轮次过滤。siblings 只用于切换器，不合并任务、不合并灯态。「待我评审」始终按 `review.round`（实例当前轮次）取，不随选中轮次变化。
6. 本地状态与重绘边界：模块级 `INST = { ctxCode, review, siblings, tasks, events, attachments, budget, tab, round }` 保存本次加载结果。`renderDetail(id, ctxCode, keepTab)` 只在路由进入时取一次数据并重建整页；`renderInstTab(tab)` 只替换 `#instBody` 与按钮高亮，不重建 `#instHead`；`renderInstRound(r)` 只重绘 `#instProgress` 与（当前在 `pre` 时）任务区。页签与轮次不写进 URL、不发请求、切页签不重置滚动位置。
7. 规范化只针对深链入口：`renderDetail(id, ctxCode)` 中，仅当 `ctxCode` 非空且与 `review.opp_code` 不一致时才 `replaceState`（`review.opp_code` 非空 → `#/opp/:real/r/:id`；为 `null` → `#/review/:id`）。`ctxCode` 为 `null` 时（`#/review/:id` 别名入口，含 COMPAT-1 与动作后的重渲染）一律保持当前 hash，不做任何重定向。

`renderDetail` 函数名保留（避免无意义改名牵连 5 处调用），签名改为 `renderDetail(id, ctxCode, keepTab)`；`#/review/:id` 调用时 `ctxCode=null`。

## 9. 缓存与无闪烁

1. 新增 `peekCached(path)`：`window._pgCache[path]` 存在且 `Date.now()-t < 30000` 时返回深拷贝，否则 `null`。
2. `renderOpp360` 与 `renderDetail` 首选 `peekCached`：命中则不调用 `showLoading`、不发请求、同步渲染；未命中才走 `apiCached` 并按现状显示加载。
3. 把 `invalidate360Cache` 改名为 `invalidateApiCache`，在成功非 GET 后清三类：
   - `/^\/api\/opp\/[^/]+\/360$/`
   - `/^\/api\/opp\/[^/]+\/prefill(\?.*)?$/`
   - `/^\/api\/reviews\/\d+(\/.*)?$/`
4. L2 四页签切换、轮次切换、实例切换器内的当前项点击都不发网络请求（实例切换是路由跳转，目标实例若已缓存则 0 请求，未缓存则恰好 1 次 `/api/reviews/:id`）。
5. `opdlvMount` 继续用 `api()` 拉行集（只读态短路），不受缓存改动影响。

## 10. 权限与状态机

- 新增两个 GET（`profile` 在 360 内、`prefill`）与 `siblings` 都是登录可读；不新增写权限，不放宽任何现有 403 分支。
- 商机级交付的 `PUT /api/opp/:code/delivery`（保存）与 `POST /api/opp/:code/delivery/confirm`（确认）的 `can_write` 裁决、档案 PUT、评审提交、任务打灯/退回、研判、结论、归档全部不改。
- L1 只读档案卡不提供编辑入口（现状也无前端编辑入口；`PUT /api/opp/:code` 保持原样）。
- `#/new/:type?opp=` 的必填校验、预算先行门、服务端 400/409 文案全部不动。

## 11. 测试与验收

**夹具卫生（跨 11.1 / 11.2 生效）**：本次新增与迁移的夹具只走带鉴权 HTTP，禁止直连 SQLite 造业务状态；既有 C2-11/C2-04b 合成器不在此列，保持原样。任何经 `POST /api/reviews/:id/submit` 进入 `reviewing` 的夹具，在断言结束后必须把该评审当前轮剩余 `pending` 任务逐条 `POST /api/tasks/:id/complete` 打到 0（部门账号，沿用 `tests/test_budget_api.js:167-172` 的 `finishAll` 套路）；被退回但未重提的也要清掉残留 `pending`。禁止 SQL 清任务，禁止把 `pending` 留在共享演示库。任务清零触发的自动研判/归档属服务端正常流程，允许发生。

### 11.1 C3：追加到 `tests/test_opp360.js`（不新增套件）

| 编号 | 断言 | 夹具与判别力 |
|---|---|---|
| C3-01 | 360 顶层有 `profile`，`fields`/`sources` 恰含 12 键，`missing ⊆ OPP_REQUIRED`；旧键仍全在 | 自建商机 + 一张非草稿评审 |
| C3-02 | `reviews[]` 每项有三种新键；挂预算后 `budget_code` 等于预算码，无预算为 `null` | 自建商机 + 关联预算的评审 |
| C3-03 | 同码两张评审 → `reviews.length===2`，排序 `updated_at DESC, id DESC`；`chain` 五键与 `lights` 四档不变 | 两张不同类型 HTTP 建单 |
| C3-04 | prefill 同类型优先：同类型旧值不被跨类型新值覆盖；草稿不入选 | 同码 presale（非草稿）+ bid（更新且字段不同）+ presale 草稿 |
| C3-05 | 跨类型只走 `CROSS_TYPE_KEYS`；`summary` 不跨类；`change.summary` 不取档案 | presale/bid/change 三型对照；档案 summary 与 change summary 刻意不同 |
| C3-06 | `0` 原样返回且非空；`''`/缺省视为空；只填空不覆盖 | 字段值设为 `0` 与 `''` |
| C3-07 | 无评审时 `fields` 由档案兜底、`sources` 标 `archive`；必填齐全 `missing=[]`，`PUT /api/opp/:code {sales:''}` 后 `missing=['sales']`；未知码 404、非法 type 400、未登录 401 | 仅档案商机；清空必填走合法 HTTP PUT（非 SQL）；全新码 |
| C3-08 | 五级来源优先级：在线同型 > 在线跨型 > 历史同型 > 历史跨型 > 档案 | 四张评审各写不同值；历史单走 `POST /api/reviews/import mode=history`；档案值刻意与四级都不同 |
| C3-09 | `siblings` 不含自身、只含同商机、按更新时间倒序 | 两实例同码 + 一实例异码 |
| C3-10 | 两实例的 tasks/events/attachments 互不串 | 两实例各走 HTTP 提交产生任务与事件；附件在各自 `draft` 态用 `POST /api/reviews/:id/attachments` 传 base64（提交后该端点会 400）；逐项断言 `review_id` 归属 |
| C3-11 | 提交→部门退回→owner 重提 后：`reviews` 仍 1 条、`round=2`、tasks 覆盖两轮 | 全程 HTTP：`POST /submit`、部门账号 `GET /api/tasks?scope=mine`、`POST /api/tasks/:id/return {opinion}`、再 `POST /submit`；断言 round 1 与 round 2 的 tasks 同时存在 |
| C3-12 | 兼容冻结：`delivery` 恰 8 键、`chain` 恰 5 键、`opp` 18 列、`lights` 四档 | 复用 C2 的键集常量 |

非草稿在线夹具的 HTTP 通路（C3-04/05/08/10/11、IA-38 共用；禁止直写库）：`PUT /api/opp/:code/delivery {rows}` → `POST /api/opp/:code/delivery/confirm` → `POST /api/budget {project_name, opp_code, fields}` → `POST /api/budget/:id/lock` → `POST /api/reviews {type, title, form 含全部必填, budget_id, submit:false}` → `POST /api/reviews/:id/submit`。顺序不可颠倒：锁预算时 G2 门要求该商机交付预算已 `confirmed`，而评审提交时 G3 门又要求预算已 `locked`；预算与评审必须同 `opp_code`（`linkBudgetErr`）。`change` 类型无预算必填门，可省预算链，改传 `POST /api/reviews/:id/attachments {field:'项目预算表', filename, data(base64)}` 后提交。

红证据要求：先跑旧代码。依赖新增能力的 C3-01/02/04/05/06/07/08/09 必红（无 `profile`/`prefill`/`siblings`）；C3-10/11/12 必绿（实例隔离、轮次语义、兼容冻结在旧码上本就成立）；C3-03 只记录旧码实测（同秒排序可能红），不充当非破坏证明。日志落 `tests/red_c3.txt` 与 `tests/green_c3.txt`。

### 11.2 IA：迁移 `tests/h_ia_shots.js` 并新增 IA-35~IA-40

| 旧用例 | 迁移后 |
|---|---|
| IA-7 七页签 | 改为「L1 无 `#oppTabs`，且 `#oppProfileCard`/`#oppChain`/`#oppShared`/`#oppInstances`/`#oppLightAgg`/`#oppAnalysis`/`#oppAgent` 各恰 1」 |
| IA-15 `#oppChain` | 保留：`#oppChain` + ①②③ + 3 个 `.chain-dot` |
| IA-18 `t=budget` | hash 收敛为 `#/opp/FX`（无 query），`#oppShared[data-focus="collect"]` |
| IA-19 `t=light` | hash 收敛为 `#/opp/FX`，`#oppInstances[data-focus="pre"]` |
| IA-8 信息收集三卡 | 不再点页签；直接断言 L1 三卡文案 + `#opdlvTable` + `#opdlvSum` |
| IA-8b `confirmed≠只读` | 第 ④ 步改为「保存后不切页签，`#oppDlv` 卡头的 `#opdlvPill` 就地回到草稿」；其余断言原样 |
| IA-8c/8d | 选择器从 `#oppPage` 保持；去掉页签依赖 |
| IA-9 前置评审 | 打开 `PL00008572` 的一张实例 L2，切 `pre` 页签；断言「评判指标」「部门」「轮次留痕」三词（0 任务时这三词仍在矩阵卡头与提示里，不依赖夹具数据）。实例取 `#oppInstances .inst-card[data-rid]` 第一张 |
| IA-16 灯色汇总 | 改到 L1 `#oppLightAgg`；断言其文本含「灯色汇总」，且红/黄/绿三计数出现 |
| IA-17 数据分析 | 改到 L1 `#oppAnalysis`；断言含「上线中」 |
| IA-10 对话 | 改到 L1 `#oppAgent`；断言含「预算」「评审表」 |
| IA-20b 挂靠建单 | 保持在 L1 `#oppBudgets` |
| IA-22 建档成功 | hash 改为 `#/opp/WZ`；等待 `#oppPage`，断言 `#oppLaunch` 三类型卡存在 |
| IA-23 继承 | 从 `#oppLaunch` 点投标卡 → `#/new/bid?opp=WZ`；项目名称/商机代码/客户名称三值来自 prefill（档案兜底）；`#pfHint` 出现 |
| IA-25 `#/new?opp=` | 保留：仍出类型选择，不重定向 |
| IA-27 返回 | 保留 `#/opp/:code` → `#/opps` |
| IA-28/30 | 保留；IA-30 进入 `#/review/:id` 后断言 `#reviewInstancePage` |
| IA-29 交付返回 | 父链接改为 `#/opp/FX`（产品内链接同步去掉 `?t=collect`） |
| IA-33 切页签零请求 | L1 首进 1 次 360；进入 L2 后清计数，切四个页签 0 请求；返回 L1（缓存命中）0 请求。**所有 `#oppTabs button.pri` 等待点替换为 `#oppProfileCard` / `#instTabs button[data-tab]`** |
| IA-34 写后恰刷新一次 | 写交付 → 回列表 → 重进 L1，`hits360===1`；另断言写评审后重进 L2 恰 1 次 `/api/reviews/:id`。等待点同样不用 `#oppTabs` |
| COMPAT-1/2 | 保留 |

新增：

- **IA-35** L1 结构：档案卡 12 要素、实例分组 `.inst-group[data-group]` 两组齐在（空组也渲染空态）、`#oppTabs` 计数 0。夹具分两段：主用例用 FX；「待补」分支先自建一个必填齐全的商机（`profile.missing=[]`），再用合法 HTTP `PUT /api/opp/:code {sales:''}` 清空一个必填，断言 `#oppProfileCard [data-missing]` 计数 ≥1 且 360 `profile.missing` 含 `sales`。
- **IA-36** L1→L2：点实例卡 → hash `#/opp/FX/r/:id`；`#reviewInstancePage`、`#instTabs button` 恰 4 个、面包屑返回按钮 href `#/opp/FX` 且正文含「商机概览 ›」；`.light-banner` 与 `.progress-seg` 均存在。
- **IA-37** L2 页签零请求：进入 L2 后清空计数器，依次切四页签，`page.on('request')` 计数 0。
- **IA-38** 轮次选择器：用 C3-11 同款 HTTP 夹具造 2 轮实例；切到第 1 轮，矩阵/进度变化，请求计数 0；时间线仍显示全部轮次事件。
- **IA-39** `#/review/:id` 对等：直接打开旧链接，`#reviewInstancePage` 与（多实例时）`#instSwitcher` 存在；断言 `location.hash` 仍为 `#/review/:id`（无重定向），切一次页签后 hash 仍不变。
- **IA-40** prefill UI：专用码 `PL-IA40-<ts>`，不用 FX——FX 只有一张草稿 bid 评审（`h_ia_shots.js:246` `submit:false`），草稿不入选。夹具全程 HTTP：① `POST /api/opp` 建码，标题/客户写档案旧值「IA40档案旧值」/「旧客户」；② 支持组账号 `POST /api/reviews/import {type:'presale', mode:'history'}` 导入最小 xlsx（`附1-预算表` sheet 含 `商机代码`=该码、`项目名称`=「IA40历史新值」、`客户名称`=「新客户」），得 `era=history, status=archived`；history 导入不建任务，且 `upsertOpp` 只补档永不覆盖，档案旧值原样保留；③ 打开 `#/new/bid?opp=PL-IA40-<ts>`，断言 `#pfHint` 出现且「评审 X 项」的 X ≥ 1、项目名称=`IA40历史新值`、客户名称=`新客户`（历史跨型的 `customer` 在 `CROSS_TYPE_KEYS` 内，标题 1→5 级不受限）、`opp_code` 输入值为上下文码、档案旧值两串均不出现在表单值里。夹具码每轮唯一；导入行随数据库快照还原一并消失。

浏览器层必须双监听 `console.error` 与 `pageerror`，零输出（沿用 IA 现有做法）。

### 11.3 源码层断言

`tests/test_opp_dialog.js` OD-08 的源码正则（`223-246`，现为 `/t === 'pre'[\s\S]{0,400}oppLightAggHtml\(oppLightAgg\(d\)\)/`）改为在 `renderOpp360` 内匹配 `oppLightAggHtml(oppLightAgg(d))`；行为断言（`[data-agg="inflight"]`/`[data-agg="history"]` 文案与数值口径）一字不动。

### 11.4 验收命令

以下命令以 `$N` 代指 Node 22 可执行文件（`C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`）；PATH 上的 `node` 是 v18，缺 `node:sqlite`，会直接报 `No such built-in module`。在 `review-platform/` 下执行：

1. 语法：`& $N --check server.js`、`& $N --check public/app.js`、`& $N --check tests/test_opp360.js`、`& $N --check tests/h_ia_shots.js`、`& $N --check tests/test_opp_dialog.js`。
2. 专项：`& $N tests/test_opp360.js --log=tests/green_c3.txt`；`& $N tests/h_ia_shots.js --log=tests/green_ia_v5.txt`；`& $N tests/test_opp_dialog.js`。
3. 全量：`& $N tests/run_all.js --log=tests/green_run_v5.txt`，必须 32 套、`ALL PASS`、exit 0。
4. 数据库保护两次（专项与全量门都写共享演示库）：跑专项前停机复制 `data/review.db` 快照，专项（C3 / IA）跑完立即停机还原并逐表整行指纹比对；随后为全量门再快照一次，门后再还原并比对。`config.json` 全程前后字节相同且不入库。

## 12. 实施顺序（复核通过后）

1. 备份 `server.js`、`public/app.js`、`tests/test_opp360.js`、`tests/h_ia_shots.js`、`tests/test_opp_dialog.js` 到带日期的临时目录（不提交 git）。
2. 先写 C3-01~C3-12，跑旧代码取红（C3-12 必须绿）。
3. 服务端：抽出唯一解析帮手；360 加 `profile` 与 `reviews[]` 三键；新增 `prefill`；评审详情加 `siblings`。跑 C3 取绿。
4. 前端数据层：`peekCached`、`invalidateApiCache`、`renderForm` 改用 prefill、删除 `OPP_INHERIT`。
5. 前端 L1：重写 `renderOpp360`，去页签，建七分区，旧 `?t=` 映射 `data-focus`，就地刷新交付卡。
6. 前端 L2：`renderDetail(id, ctxCode)` 四页签、头部、切换器、轮次选择器、默认页签、动作保留、`#/review/:id/edit` 路由。
7. 前端路由与落点：新增 `#/opp/:code/r/:id` 与 `#/review/:id/edit`；`oppAfterCreate` 跳 L1；产品内链接去 `?t=`。
8. 迁移 IA 用例并新增 IA-35~40；改 OD-08 正则；先跑旧代码证明新用例红，再跑新代码取绿。
9. 快照保护下跑 32 套全量门，还原数据库，留日志与还原证据。

## 13. 非目标与风险

非目标：

- 不做评审实例删除/合并、不做表单按轮次版本化、不做历史单回填轮次。
- 不做权限模型调整、不做判灯规则调整、不做预算金额或毛利率重算。
- 不接入真实钉钉或外网、不新增 npm 依赖、不修改 `config.json`、不提交 git。
- 不重做商机列表页（`#/opps`）的列与筛选。

风险与处置：

1. **`profile` 覆盖档案值可能被误解为档案被改写。** 处置：档案卡只读 + 每字段来源小标 + 固定说明；档案原始值仍由 `opp` 18 列原样返回。
2. **去掉 `#oppTabs` 会使旧书签落空。** 处置：D-73 的 `data-focus` 映射与 hash 收敛；红绿用例覆盖 IA-18/19。
3. **IA 迁移可能顺手放宽断言。** 处置：只允许替换选择器/路由锚点；逐条对照原断言，保留精确相等；评审时 diff 每个断言。
4. **缓存失效范围扩大导致重复请求。** 处置：三条精确正则 + IA-34 钉「恰一次」；L2 页签与轮次切换断言 0 请求。
5. **轮次选择器让人误以为表单分版本。** 处置：页签内固定说明「表单为实例级，不按轮次版本化」。
6. **共享演示库污染。** 处置：D-67 外部快照 + 字节级还原（专项与全量门各一次）+ 夹具结束前清空 pending 任务；新夹具使用每轮唯一商机码，避免与固定锚定码 `PL00008572`/`PL00007297` 相撞。
7. **本次实施不提交 git，且工作区含未提交的七月链路改动，无法用 git 精确回退本次改动。** 处置：实施前把五个文件备份到带日期的临时目录；回退即整文件还原，不触碰工作区里其他人的未提交改动。
