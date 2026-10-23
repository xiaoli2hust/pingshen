# 评审平台业务流整改 · 设计说明书（长任务单，不分批）

**日期**：2026-10-20
**BASE**：186b251（工作区含未提交的七月链路与返回修复改动，本轮继续沿用「不提交 git」口径）
**性质**：单个连续整改任务。29 项问题一次做完，内部分组只表达依赖顺序，**不构成分批交付**。
**上游诊断**：本会话 PM 视角业务流全量诊断（29 项，P0–P3），证据基座为 `server.js` / `public/app.js` / `tools/parse_form_xlsx.py` 全量阅读 + 只读 DB 逐表实测。

---

## 1. 诊断结论（整改的靶心）

状态机与七道提交门的实现是正确的。业务流真正的断裂在**「人拿不到判定所需的信息」**：

1. 部门 BP 打灯时，弹窗里只有判定标准原文和三个灯按钮，**看不到该单的任何业务数据**（`public/app.js:924-946`）。
2. 门禁只在提交那一刻报错，前端零就绪提示（`server.js:2160-2205` 七道门 vs 前端 grep 门禁原文零命中）。
3. 演示库 86% 是合成数据，所有看板、待办、灯色分布失真。
4. 通知链零投递（`robot_outbox` 90 行全 `preview`，`sent_at` 非空 = 0）。

**一句话目标：把系统从「流程正确、决策无据」改成「流程正确、决策有据、缺口可见」。**

---

## 2. 用户裁定吸收：P0-2 重定向（本 spec 的第一裁定）

### 2.1 用户原话

> 「P0-2 指标体系要判的信息，信息收集表根本没采集：这个是因为需要财务和 FDE、法务等自行判断，依据来自他们的系统，没有对接。」

### 2.2 裁定含义

原诊断把「19 项指标中 10 项在评审表里无对应字段」当成**采集缺口**，整改方向是补字段。**这个方向被推翻。**

真实情况是：这 10 项指标的判定依据本来就存在于财务系统、FDE 的技术评估、法务的征信渠道里，**本平台从未对接这些系统，也不应在本轮对接**。所以：

- **不是「表单少采了字段」**，而是「这些指标的判定权与数据源都在部门侧，平台只负责把任务送到人面前」。
- 平台补采这些字段是**错的**：会制造「平台数据是权威」的假象，与部门自有系统冲突，且无法保证准确性。
- 平台的真实责任是：**让部门 BP 在打灯那一刻，能拿到足够的锚点信息去自己的系统里查这一单**。

### 2.3 重定向后的设计：三类证据分层

打灯弹窗（以及 L2 前置页签）按三类分层呈现，**每一类都明确标注来源，绝不混淆**：

| 类别 | 含义 | 数据来源 | 呈现 |
|---|---|---|---|
| **A 类·系统已算** | 定量项，`judge()` 已按规则算出结论 | `server.js:845-960` judge() 输出 | 直接显示结论 + 计算过程（如「分包占比 72.0% ≥70% → 黄灯+上XO」） |
| **B 类·表单已采** | 评审表里填了的事实字段 | `reviews.form_json` | 按指标映射显示相关字段值 |
| **C 类·部门自有系统** | 平台无数据，判定依据在部门侧 | **无**（不对接） | 明确标注「本项判定依据在贵部门系统，平台不提供数据」+ 给出**查询锚点** |

**C 类的查询锚点**是本裁定的核心交付物。部门 BP 拿到锚点就能去自己系统定位这一单：

- 商机代码（`opp_code`）、项目名称（`title`）
- 最终客户名称（`customer`）
- 预计合同金额（`contract_amount`）
- 签约路径（`sign_path`，法务查上游公司用）
- 申请人与申请时间（`applicant_name` / `created_at`）
- 业务线与营销区域（`biz_line` / `region`）

### 2.4 逐项归类（19 个指标）

依据 `server.js:64-93` `INDICATORS` 与 `server.js:684-763` `REQUIRED` 字段表逐项对账：

**presale（5 项）**

| 指标 | 部门 | 类别 | 依据字段 / 锚点 |
|---|---|---|---|
| 技术可行性 | FDE | **C** | 锚点：项目名称、项目概述、是否涉及测绘 |
| 交付资源风险 | FDE | **C** | 锚点：预计售前实施周期、项目概述 |
| 合同交付物(测绘项目) | 合规BP | **B** | `survey`（是否涉及测绘）+ A 类测绘分包占比 |
| 存在分包提前投入 | 采购BP | **B** | `sub_early_flag` |
| 客户过往合作信誉 | 财务BP | **C** | 锚点：客户名称、合同金额 |

**bid（10 项）**

| 指标 | 部门 | 类别 | 依据字段 / 锚点 |
|---|---|---|---|
| 分包合理性 | 采购BP | **B+C** | B：`sub_core`/`sub_amount`/`designated_sub_amount`/`survey_sub_amount`/`b2b_scene`；C：下游供应商资质（平台不采） |
| 技术可行性 | FDE | **C** | 锚点：项目名称、产品售卖类型、项目概述 |
| 客户历史欠款 | 财务BP | **C** | 锚点：客户名称、合同金额、预计回款时间 |
| 签约客户/最终客户信用评估 | 财务BP | **C** | 锚点：客户名称 |
| 集团公司关联交易金额 | 财务BP | **C** | 锚点：客户名称、签约路径 |
| 付款条件 | 财务BP | **B** | `payment_terms`/`settle_method`/`payback_time`/`revenue_confirm`/`b2b_scene` + A 类结算方式判定 |
| 上游签约路径公司情况 | 法务 | **B+C** | B：`sign_path`；C：上游公司征信（平台不采） |
| 转包限制风险 | 法务 | **B** | `sub_limit` + `sign_path` |
| 合规风险 | 合规BP | **C** | 锚点：项目名称、业务线、是否涉密、是否甲导资质 |
| 数据合规性 | 数据BP | **B+C** | B：`data_review`/`data_plan`/`data_content`/`data_compliance`；C：数据风险等级 C1–C4（平台不采） |

**change（4 项）**

| 指标 | 部门 | 类别 | 依据字段 / 锚点 |
|---|---|---|---|
| 技术可行性 | FDE | **C** | 锚点：项目名称、决策事项概述 |
| 分包合理性 | 采购BP | **B+C** | B：`old_sub_amount`/`new_sub_amount`；C：供应商资质 |
| 签单与评审的签约差异 | 法务 | **B** | `path_change` + A 类签约路径对比 |
| 项目核减 | 财务BP | **B+C** | B：`change_type`/`old_delivery_cost`/`new_delivery_cost`；C：核减原因合理性 |

**统计**：纯 C 类 **8 项**、B+C 混合 **5 项**、纯 B 类 **6 项**。
→ **19 项中有 13 项需要 C 类锚点呈现**，这是本轮最大的单点交付。

### 2.5 明确不做

- **不新增采集字段**。原诊断建议的「补数据风险等级 select、下游供应商资质 select、核减金额 number」**全部撤销**——那会把部门自有系统的判定权错误地搬进平台。
- **不对接财务/法务/FDE 任何外部系统**。本轮零外部调用（与既有铁律一致）。
- 唯一例外：`change` 型的 `proj_stage` / `change_type` 两项已在 `REQUIRED` 中声明为必填且属**平台自有流程字段**（不是部门判定依据），其导入映射缺失按 P0-7 单独处置。

---

## 3. 目标与非目标

### 3.1 目标

1. 部门 BP 打开任一打灯任务，能在同一个弹窗里看到 A/B/C 三类证据，不需要跳到别的页面、不需要凭记忆。
2. 销售/项目经理在填表之前就知道三步链缺什么，不用填完 35 个字段才被 400 拦。
3. 已存在的草稿能关联预算单（服务端能力 D-59 接上前端）。
4. 看板、待办、灯色分布只反映真实业务数据，测试数据可见但默认不参与。
5. 退回单据不再产生僵尸 pending 任务。
6. 所有角色都能从导航到达自己需要的页面。
7. 通知积压可见（即使零投递）。

### 3.2 非目标（红线，逐条对应既有铁律）

| 红线 | 说明 |
|---|---|
| **判灯引擎零改动** | `server.js:845-960` `judge()` 的阈值、优先级、灯色映射一律不动 |
| **财务计算零改动** | `finance.js` 不动 |
| **预算锁定零改动** | G2 门禁（`server.js:1508-1524`）不动 |
| **评审状态机零改动** | `reviews.status` 的取值与迁移不动 |
| **结论与归档权限零改动** | `/decision`、归档口径不动 |
| **零 npm 运行时依赖** | 只用 Node 22 内置模块 |
| **不改 `config.json`** | 270B / sha 前16 `f285c66ad4790370`，未入库，本轮不读不写 |
| **不提交 git** | 沿用当前口径 |
| **不用 SQL 伪造业务工作流终态** | 清理与演示数据补全一律走 UI/HTTP 真实链路 |
| **零真实钉钉/外网调用** | `provider.active` 保持 `false` |
| **LLM 不判灯、不算账、不锁定、不提交、不确认结论** | 不动 |

### 3.3 需用户显式确认的唯一红线例外

**`tasks.status` 新增取值 `'cancelled'`**（P1-1 退回时收敛同轮其他 pending 任务）。

- `tasks.status` 是 TEXT 列，现有取值 `pending` / `done` / `returned`，**新增取值不构成 schema 变更**（零 ALTER）。
- 判定：这是**任务生命周期收敛**，不是评审状态机改动——`reviews.status` 的取值与迁移完全不动，退回仍然只把 review 置 `returned`。
- 但它确实改变了「退回后其他部门任务去哪了」的可观测行为，故单列请确认。
- 若否决：P1-1 降级为「仅在支持组监控页暴露僵尸任务计数」，不做状态收敛。

---

## 4. 核心设计裁定

### D-A　证据端点：新增只读 `GET /api/tasks/:id/evidence`

**为什么不是复用 `/api/reviews/:id`**：该端点已返回 review+tasks+events+attachments+budget+siblings，是 L2 页面的重载数据源。给它挂证据会让所有调用方变重，且证据只对「当前用户在该单上有待办」的场景有意义。

**为什么不把映射表放前端**：`INDICATORS` 在服务端（`server.js:64-93`），若前端再硬编码一份「指标 → 字段」映射，就出现两份真源，必然漂移（本仓库已发生过 title 派生、D-59 两次同类事故）。

**契约**：

```
GET /api/tasks/:id/evidence
鉴权：登录即可读（与 /api/opp/:code/360 同口径，server.js:1953）
      若 task.dept !== user.role 且 user 非支持组/admin，仍返回数据（只读，不泄露写权限）
响应 200:
{
  "task":     { "id", "review_id", "ind_key", "ind_name", "dept", "standards", "status", "round" },
  "review":   { "id", "type", "title", "opp_code", "status", "round", "applicant_name", "created_at" },
  "computed": [ { "name", "level", "reason", "xo" } ],        // A 类：judge() 已算出的全部定量项
  "formFacts":[ { "k", "label", "value" } ],                  // B 类：按 IND_EVIDENCE[ind_key].formKeys 取值，label 取 REQUIRED 注册表原文
  "anchors":  [ { "label", "value" } ],                       // C 类锚点：恒含 商机代码/项目名称/客户/合同金额/申请人/申请时间
  "external": { "required": true|false, "hint": "…" },        // C 类标注：true 时显示「本项判定依据在贵部门系统」
  "skipped":  [ { "name", "reason" } ]                        // P2-1：因字段缺失未参与判定的定量项
}
响应 404: { "error": "任务不存在" }
```

**`skipped` 的实现**：不改 `judge()`，而是新增一个**只读镜像函数** `judgeCoverage(review)`，用与 `judge()` 相同的 `if (x != null)` 谓词列出「哪些定量项因数据缺失被跳过」。
⚠️ 风险：镜像函数与 `judge()` 会漂移。**处置**：`judgeCoverage` 必须与 `judge` 相邻放置并加互指注释，且新增专项用例 `EV-*` 断言「`judge()` 产出的项名集合 ∪ `judgeCoverage()` 产出的项名集合 = 该类型全部定量项名集合」，用集合完整性钉住漂移。

### D-B　`IND_EVIDENCE` 常量：指标 → 证据映射的唯一真源

位置：`server.js`，紧邻 `INDICATORS`（`server.js:93` 之后）。

```js
// 指标 → 打灯证据映射(本 spec §2.4 逐项对账结果)。
// 三类: formKeys=B类表单事实 / anchors=C类查询锚点 / external=C类标注(true=判定依据在部门自有系统)
// 未列出的 key 视为 external:true 且 formKeys:[]（安全默认：宁可说"没有数据"，不可假装平台能判）
const IND_EVIDENCE = { … };
```

- 每个 `INDICATORS` 的 `key` 都必须有对应条目（用专项用例断言键集完整对账，仿既有 `LM-21` 键集对账口径）。
- 安全默认：映射表漏项时按 `external:true` 处理，**不允许静默显示空证据**。

### D-C　夹具识别谓词：`isFixtureCode(code)`，不新增列

**实测依据**（只读 DB 探针，2026-10-20）：

- 真实商机码形态 = `PL` + 8 位数字：`PL00006204` / `PL00007297` / `PL00008026` / `PL00008210` / `PL00008314` / `PL00008330` / `PL00008572`（共 7 个，`opps` 表 REAL7 = 7 行）。
- 测试码形态 = `PL-` 前缀：`PL-T*`（reviews 69 行 / opps 10 行 / budgets 6 行）、`PL-RW-*`（reviews 12 行 / opps 多行）、`PL-AW-*`（reviews 2 行）、`PL-A-DL-*`（opps 4 行）、`PL-AD-RB-*`（opps 2 行，XSS 对抗用例，title 含 `<img data-rwxss …>`）。
- `reviews.era` 全为 `online`（93/93），`history` = 0 → **era 列不可用作夹具标记**（会污染 online/history 双轨的业务语义），且历史补录通道从未被真实使用。
- `budgets` 中 `opp_code IS NULL` 共 76 行，`code` 前缀全为 `B-2026`，`project_name` 样本含「技能②带入预算」「RB 预算 [T]RB-07a-8682780-1」→ 全为夹具。

**裁定谓词**：

```js
// 夹具识别(本 spec D-C): 真实商机码恒为 PL+8位数字, 测试码恒为 PL- 前缀。
// 不复用 reviews.era —— era 是 online/history 业务双轨, 加第三值会污染语义(实测 era 93/93 全 online)。
const isFixtureCode = c => typeof c === 'string' && /^PL-[A-Za-z0-9]/.test(c);
```

**谓词下发方式（消除前后端两份真源）**：正则字符串经既有 `GET /api/meta/fields`（`server.js:1854`，登录即可读，已在下发 `REQUIRED` 注册表）追加一个 `fixtureCodePattern` 键下发，前端 `new RegExp(meta.fixtureCodePattern)` 构造，**不在 `public/app.js` 里硬编码第二份**。新增专项用例断言两侧对同一组样本（`PL00006204` / `PL-T3-x` / `PL-RW-1-MAIN` / `PL-A-DL-1` / `PL-AD-RB-1` / 空值 / `null`）判定逐一相同。

- **运行时过滤**（看板/列表默认）：只过滤 `isFixtureCode` 命中的行。
- **`opp_code` 为空的行不被运行时过滤**——因为 `OPP_REQUIRED`（`server.js:334`）不含 `opp_code`，真实业务允许尚未拿到商机码的单据存在，过滤掉会藏真实数据。空码行按 P1-6 独立成行显示。
- `budgets` 的 NULL-`opp_code` 行靠**一次性清理**根治（见 D-D），不靠运行时谓词（NULL 不是稳定的夹具特征）。

### D-D　一次性数据清理：只删夹具，保留 REAL7 全部资产

**清理范围**（行数为 2026-10-20 只读探针实测值，非估算）：

| 表 | 删除条件 | 实测行数 |
|---|---|---|
| `reviews` | `isFixtureCode(opp_code)`（83）或 `opp_code` 空（4） | **87** |
| `tasks` | `review_id` 属待删 reviews | **640** |
| `events` | 同上 | **511** |
| `attachments` | 同上 | **0** |
| `agent_messages` | `review_id` 属待删 reviews（32）或 `budget_id` 属待删 budgets（208） | **240** |
| `budgets` | `isFixtureCode(opp_code)`（16）或 `opp_code` 空（76） | **92** |
| `budget_delivery` | `budget_id` 属待删 budgets | **72** |
| `opps` | `isFixtureCode(opp_code)` | **43** |
| `opp_delivery` | `isFixtureCode(opp_code)` | **19** |
| `robot_outbox` | 全部（90 行全 `preview`，`sent_at` 非空 = 0，零投递无业务价值） | **90** |
| `llm_calls` | **不动**（用量审计，与业务数据无关） | 0（现存 41） |
| `users` / `settings` / `notify_matrix` / `robot_instances` / `robot_whitelist` / `robot_user_bindings` / `robot_targets` | **不动** | 0（users 10 / settings 20） |

**合计删除 1794 行**，保留 REAL7 全部资产。（原写 1714 为本节逐项加总的笔误，2026-10-21 执行清理时用脚本重算表内十项之和为 1794 后改正；逐项数字与 `tools/cleanup_fixtures.js` 的钉住断言一致，未变。）

**清理前置断言（脚本必须先跑，不通过即 ABORT，不写任何删除）**：

1. 保留 reviews 集合 = `opp_code LIKE 'PL0000%' AND opp_code NOT LIKE 'PL-%'` → 实测 **6 行**（id 1–6）
2. 保留 budgets 集合 = 同谓词 → 实测 **6 行**（id 1–6，全 `locked`，逐一挂靠 REAL7）
3. **保留 budgets 的 id 集合 ≡ 保留 reviews 引用的 `budget_id` 集合** → 实测 `[1,2,3,4,5,6]` 两侧**完全相等**，故删除后无孤儿引用
4. 保留 opps 集合 = 7 行（REAL7，其中 `PL00008572` `source='history'`，余 6 行 `source='form'`）
5. 保留 `opp_delivery` = 7 行（REAL7 各一行 `confirmed`）；保留 `budget_delivery` = **0** 行（实测：真实单的交付明细挂在商机级 `opp_delivery`，不挂预算单级 `budget_delivery`——两表语义不同，清理时勿混）

**保留的 6 张真实评审单**（实测明细，清理后应逐行不变）：

```
id=1  bid      PL00007297  returned  red     budget_id=1
id=2  presale  PL00008330  archived  yellow  budget_id=2
id=3  bid      PL00006204  archived  yellow  budget_id=3
id=4  bid      PL00008026  archived  yellow  budget_id=4
id=5  bid      PL00008210  archived  yellow  budget_id=5
id=6  bid      PL00008314  archived  yellow  budget_id=6
```

**保留的 7 个真实商机**（实测标题）：`PL00006204` 武汉市GA地图地址服务项目 / `PL00007297` 百望云区域企业白名单服务 / `PL00008026` 武汉市地图产品采购项目 / `PL00008210` 长沙智慧消防一张图及辅助决策信创改造 / `PL00008314` 上海保险交易所地理信息系统项目 / `PL00008330` 深圳供电局三维数据合作项目 / `PL00008572` 江西省天地图POI数据服务项目。

**`PL00008572` 的 21 个引用文件不受清理影响**（实测：`tests/h_flicker.js`、`h_flicker2.js`、`h_ia_shots.js`、`h_import_review.js`、`h_lab_shots.js`、`h_nav_shots.js`、`h_opp_shots.js`、`h_robot_workbench_shots.js`、`test_delivery.js`、`test_delivery_opp.js`、`test_excel_import.js`、`test_finance.js`、`test_opp360.js`、`test_opp_api.js`、`test_opp_dialog.js`、`test_opp_thread.js`、`test_parser_audit.js`、`test_parser_lab.js`、`test_robot_orchestrator.js`、`test_roundtrip.js`、`tools/parse_delivery_xlsx.py`）——因为它属保留项。
⚠️ 但 P3-1 指出它 `reviews=0 budgets=0`，**演示三步链走不通**，按 P3-1 单独处置。

**执行纪律**（沿用既有共享库保护口径）：

1. 停 8600 服务（双采样确认 PID，不停陌生 PID）
2. `Copy-Item data/review.db` → 带时间戳快照
3. 清理脚本按**显式 id 清单**删（先用谓词生成清单并落盘人工复核，再删），不用谓词直接删
4. 还原点验证：`certutil` SHA256 全串比对 + 逐表 `SELECT * ORDER BY rowid` JSON 指纹
5. 起服务，跑全量门 32 套
6. 门红则**还原快照**，逐项排查是哪套依赖被删数据，改套件而不是保留脏数据
7. 门绿则交付，并在 `tests/` 留清理前后两份指纹证据

### D-E　代打权限：本轮**不收紧**，只让事实可见

**实测依据**：`tasks.done_by` 分布——`销售支持组` **292** / `财务BP- demo` 21 / `法务- demo` 10 / `FDE工程师- demo` 7 / `采购BP- demo` 6 / `合规BP- demo` 6 / `数据BP- demo` 5。**代打占 292/347 = 84%**。`done_by` 为空的 done 行 = 0 → **该列已可靠记录操作人**。

**深层根因**：`users` 表每角色只有 1 个账号（实测 10 角色 × 1 账号），且部门账号名带 `- demo` 后缀。真实使用时多人共用一个部门账号，支持组代打成了常态。

**裁定**：收紧权限是破坏性变更，且**在多账号体系建立之前收紧没有意义**（部门只有 1 个账号，谁登录都是同一个人）。本轮改为：

1. `done_by` 所属角色 ≠ `task.dept` 时，UI 标注「由 {done_by} 代 {dept} 打灯」（L2 前置页签 `app.js:830,834` + 任务中心已处理页签）
2. 支持组监控页新增指标「代打占比 N%（M/K）」，让管理者看见这个事实
3. `completeTask` 代打时补 `addEvent(review_id, '代打', user.name, '由 {role} 代 {dept} 完成 {ind_name}')`（零 schema）
4. `server.js:2704-2748` 的权限判定**一字不改**

**挂账**：多账号体系 + 代打权限收紧 = 另一个 spec，本轮不做。

### D-F　change 通道：禁用导入，明确文案

`tools/parse_form_xlsx.py:24-53` `REVIEW_MAP` 无 `proj_stage` / `change_type` 映射；`server.js:744-746` 这两项是 `req:1`；`server.js:1418` sheet 选择对 change 传空字符串。→ **Excel 导入的变更单永远无法提交**。

**裁定**：变更型只走在线填写。导入 UI 的类型选择里**移除 change 选项**（或置灰 + 文案「变更决策无 Excel 模板，请在线填写」）。
**不做**：补 `REVIEW_MAP` 映射——需先拿到变更决策表原件，属挂账项。

### D-G　L1 数据分析区：做最小实现，删除内部编号字样

`public/app.js:2224` 现为 `上线中(P2): … P0 阶段此处为空态占位`——L1 七分区之一长期空白，且**向最终用户暴露 P0/P2 内部阶段编号**（违反既有偏好：公司材料禁用内部编号与技术黑话）。

**裁定**：改为最小实现——该商机的**灯色时间线**（各轮 reviews 的 light + updated_at）+ **各轮结论对比**（decision_result / judge 摘要）。数据全在 `reviews` 与 `events` 里，`/api/opp/:code/360` 已返回 reviews 列表，**零新端点、零 schema**。

### D-H　通知：`robot_outbox` 从「发送队列」改造成「站内待办真源」

零投递是合规约束下的正确状态，不改。**改的是可见性**：

1. 部门角色首页用未投递 outbox 行渲染「你所在部门有 N 项待打灯」+ 机器人草稿摘要，深链 `#/tasks?review_id=`（该深链过滤已存在，`app.js:2369`）
2. 机器人管理页显示「当前本地预演，N 条待投递」，把 90 行沉默数据变成可见积压量
3. 能力命名与文案统一为「生成待发送草稿（本地预演）」，去掉「推送/群发」暗示
4. `provider.active` 保持 `false`，`capabilities.provider_send` 保持 `false`，**零外部调用**

---

## 5. 整改项全集（29 项 → 8 组，一次做完）

分组只表达**依赖顺序**（前组的产出是后组的输入），不构成分批交付。

### 组 1｜判定证据层（4 项）— 本轮最大交付

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P0-1** | 打灯弹窗无任何业务数据 | `app.js:924-946` `openTask()`；新增 `server.js` 证据端点 | 弹窗改为 async，先拉 `/api/tasks/:id/evidence`，按 A/B/C 三类分区渲染；底部加「打开完整评审单」深链（新标签，不打断打灯） |
| **P0-2** | 13 项指标需部门自有系统判定，平台无数据 | `server.js` 新增 `IND_EVIDENCE`；`docs/` 落对账表 | 按 §2 裁定：C 类明确标注「判定依据在贵部门系统」+ 提供 6 项查询锚点；**不补采集字段** |
| **P2-1** | 定量项字段缺失静默跳过，灯可能偏绿 | `server.js` 新增 `judgeCoverage()`（只读镜像）；研判结论页 | 结论页显式列出「N 项因数据缺失未参与判定：…」；`judge()` 一字不改 |
| **P2-2** | 7 个字段采集了但既不判灯也不进指标依据 | `IND_EVIDENCE` 映射 | `sub_core`/`sub_limit` → 采购BP·分包合理性 与 法务·转包限制；`b2b_scene`/`payment_terms`/`payback_time`/`revenue_confirm` → 财务BP·付款条件；`jiadao`/`product_type` → FDE·技术可行性 |

**依赖**：D-A 端点 + D-B 映射表是组 1 的地基，必须先做。P2-1 的 `judgeCoverage` 与 P0-1 共用证据端点响应。

### 组 2｜就绪态与门禁前置（3 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P0-3** | 门禁全后置，前端零就绪提示 | `app.js:2208` `oppLaunch`；`app.js:427` `renderForm` | ①三类型卡按 ①②就绪态渲染三态（就绪/未就绪-列缺口+一键跳转/不适用），未就绪仍可点进草稿但标注「草稿可填，提交需先完成①②」；②表单页顶部常驻「提交就绪度」条（必填 N/M、预算是否关联、交付是否确认），实时算 |
| **P0-4** | 草稿无法关联预算单（D-59 有 API 无 UI） | `app.js:508,531,707` | 编辑态同样渲染「关联预算单」区块（初值 `r.budget_id`）；`submitReview` 编辑分支把 `budget_id` 一并 PUT |
| **P2-7** | 下一步指引只在 `submitted===0` 时出现 | `app.js:2186`、`NEXT_ACTION_TEXT`（`app.js:2111`） | 去掉 `submitted===0` 前置条件，改为按整条链状态派生（①未确认→去确认；②未锁定→去锁定；③草稿→去提交；已研判→去录结论；已归档→查看归档），与 `oppChain` dot 同源 |

**依赖**：就绪态计算需要读 `opp_delivery.status` 与 `budgets.status`，`/api/opp/:code/360` 已返回，**零新端点**。

### 组 3｜导航与信息架构（8 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P1-3** | 五个部门角色无商机入口 | `app.js:206-214` 导航矩阵 | 加「相关商机」入口（该部门有过任务的商机集合，用 tasks join opps 派生）。**360 已登录可读（`server.js:1953`），纯前端改动，无需新权限** |
| **P1-5** | `#/budgets` 无导航入口 + 三处小缺陷 | `app.js:206-214`、`1979`、`1984`、`2016` | 导航补「预算单」（项目经理/销售经理/支持组/admin）；`api()`→`apiCached()`；标题判定加 `admin`；`colspan="6"`→`7` |
| **P1-7** | ②项目预算卡每行重复挂新建按钮 | `app.js:2208` 附近 | 按钮上移卡片头部只出现一次；每行加「已被 #N 评审单关联 / 未关联」标记，未关联的锁定预算行内给「用它发起评审」 |
| **P1-8** | 商机档案无编辑入口 | `app.js:2121-2225` `oppProfileCard`；新增 `PUT /api/opp/:code` | 加「编辑档案」（销售经理/支持组/admin），显式 PUT + 事件流「档案人工修正: 字段 X 由 A 改为 B」。**`upsertOpp` 只补档语义保留不动**（自动路径这样是对的） |
| **P2-3** | 任务中心无分页/筛选/进度 | `app.js:2365-2398` | 加「本单进度 N/M」列（同 review_id 的 done/total）+ 按单折叠；all 监控页加部门+类型筛选与分页 |
| **P2-4** | 研判台 3 个 tile 不可点、队列无翻页 | `app.js:2400-2440` | meet/green/red 三 tile 补 `onclick` 定位对应队列；队列加翻页或「展开全部」 |
| **P2-5** | 历史补录入口在归档库，与在线导入语义混淆 | `app.js:3060-3110`；向导导入 | 归档库入口改名「补录历史已归档评审（直接入库，不走流程）」+ 二次确认；向导导入标「导入为草稿，需走完①②③」 |
| **P2-6** | L1 分析区空态 + 暴露内部编号 | `app.js:2224` | 按 D-G 做最小实现（灯色时间线 + 各轮结论对比）；**立即删除「P0 阶段」字样** |

### 组 4｜语义正确性（4 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P1-1** | 退回产生僵尸 pending（实测 108 行） | `server.js:2704-2748` `returnTask`；`app.js` `taskSt()` | 退回时把该单同轮其他 pending 置 `'cancelled'`（零 schema，见 §3.3 待确认）+ `addEvent` 说明；前端 `taskSt()` 加 cancelled 分支；支持组监控页显示僵尸计数。**须同批 grep 全部 `tasks.status` 消费方** |
| **P1-2** | 支持组代打占 84% 且不可见 | `app.js:830,834`；任务中心；`completeTask` | 按 D-E：标注「由 X 代 YY 部门打灯」+ 监控页「代打占比」+ `addEvent` 留痕。**权限判定一字不改** |
| **P1-4** | 首页「待研判」tile 计数的是不可研判的单 | `app.js:352-415`、`375` | 拆成「前置收集中(N)」与「待录结论(N)」两个 tile，标签取状态机原文；「我的商机」tile 计数与落地页对齐 |
| **P1-6** | 「未标识商机」76 单据塌一行且恒排首 | `app.js:2034,2048,2061` | 空 `opp_code` 单据**不聚合**，各自独立成行 + 「未挂靠商机」标签；排序不再让聚合行占首屏 |

### 组 5｜数据治理（2 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P0-6** | 演示库 86% 合成数据污染全部看板 | 清理脚本 + `isFixtureCode` + 各看板 | 按 D-C/D-D：一次性清理（停机快照→显式 id 清单→双层验证→全量门）+ 看板默认过滤夹具 + 管理页「包含测试数据」开关 |
| **P3-1** | PL00008572 演示锚点三步链走不通 | 演示数据 | 演示脚本改用 PL00006204/8026/8210/8314（均 archived yellow 且有 budget）；或给 8572 走 **UI 真实链路**补预算单+评审单（**不得 SQL 直写终态**） |

**依赖**：组 5 必须在组 1–4 的功能改完**之后**执行——否则清理会破坏正在开发中的夹具，且门验证无法归因。

### 组 6｜通知与预期管理（2 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P0-5** | 通知链零投递，前置评审「没人被告知」 | 首页；机器人管理页 | 按 D-H：`robot_outbox` 改造成站内待办真源 + 积压量可见。**`provider.active` 保持 false，零外部调用** |
| **P2-8** | 机器人能力命名带「推送/群发」暗示 | `server.js:1795-1824`；`app.js:1217` 等 | 命名与文案统一为「生成待发送草稿（本地预演）」 |

### 组 7｜通道口径（1 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P0-7** | change 型导入通道天然无法提交 | 导入 UI 类型选择 | 按 D-F：移除/置灰 change 选项 + 文案「变更决策无 Excel 模板，请在线填写」 |

### 组 8｜打磨与挂账（5 项）

| 编号 | 问题 | 落点 | 整改 |
|---|---|---|---|
| **P3-2** | 部门文案硬编码 | `app.js:2379` | 由 `INDICATORS` 派生 dept 去重列表渲染 |
| **P3-3** | 前端缓存策略不一致 | `app.js:1979` | 统一 `apiCached`；写操作后按既有失效机制清缓存 |
| **P3-4** | colspan 与列数不符 | `app.js:831,2016,2096` | 按各表实际列数改为常量派生 |
| **P3-5** | 旧深链三值同归一分区易被误判 | `app.js:2120` `OPP_T_FOCUS` | 保留兼容 + 一行注释说明「三个旧值同归前置分区，非遗漏」 |
| **P1-9** | 分包占比 ≥70% 判黄而非红，规则悬空 | `server.js:875-878` | **本轮不改判灯代码**（红线）。整改目标 = 拿《项目评审管理规则》原文确认口径，结论落 `docs/待确认业务口径清单.md` 并绑定用例 R-01。属**挂账项**，需业务方给原文 |

---

## 6. 数据契约汇总

### 6.1 新增（全部只读，除 P1-8）

| 项 | 类型 | 位置 |
|---|---|---|
| `GET /api/tasks/:id/evidence` | 只读端点 | `server.js`，紧邻 `/api/tasks` 路由 |
| `IND_EVIDENCE` | 常量（指标→证据映射唯一真源） | `server.js`，紧邻 `INDICATORS`（`:93` 后）；**经 `/api/meta/fields` 下发给前端**，不在 `app.js` 硬编码第二份 |
| `judgeCoverage(review)` | 只读镜像函数（列未参与判定的定量项） | `server.js`，与 `judge()` 相邻 + 互指注释 |
| `isFixtureCode(code)` | 只读谓词 | `server.js`；正则经 `/api/meta/fields` 的 `fixtureCodePattern` 键下发，前端 `new RegExp()` 构造（见 D-C） |
| `GET /api/meta/fields` 响应 | **追加两个键**（`indEvidence` / `fixtureCodePattern`），既有 5 键不动 | `server.js:1854-1859` |
| `PUT /api/opp/:code` | **写端点**（P1-8 档案人工修正） | `server.js`；鉴权=销售经理/支持组/admin；写 `events` 留痕 |
| `tasks.status = 'cancelled'` | 新取值（零 schema，**待 §3.3 确认**） | `server.js` `returnTask` |

### 6.2 明确不新增

- 不新增采集字段（§2.5）
- 不新增 `era` 取值（D-C）
- 不新增任何 ALTER TABLE
- 不新增 npm 依赖
- 不对接任何外部系统

---

## 7. 验收标准（每项可观测）

### 7.1 组 1 判定证据层

- **EV-01**　`GET /api/tasks/:id/evidence` 对 bid 型「分包合理性」任务返回：`computed` 含分包占比项、`formFacts` 含 `sub_core`/`sub_amount`/`designated_sub_amount`/`b2b_scene`、`external.required === true`、`anchors` 含商机代码与客户名称。
- **EV-02**　对纯 C 类指标（bid·客户历史欠款）返回 `formFacts` 为空数组且 `external.required === true`、`external.hint` 非空——**断言不静默返回空证据**。
- **EV-03**　`IND_EVIDENCE` 键集与 `INDICATORS` 三类型全部 `key` 完整对账（仿 LM-21 键集对账口径），漏项即红。
- **EV-04**　`judge()` 产出项名集合 ∪ `judgeCoverage()` 产出项名集合 = 该类型全部定量项名集合（钉住镜像漂移）。
- **EV-05**　浏览器层：财务BP 账号登录 → 待办打灯 → 打开任一任务弹窗 → 断言 DOM 中同时存在 A/B/C 三类区块标题与至少一个锚点值；`console.error` 与 `pageerror` 为零。
- **EV-06**　缺 `sub_amount` 的 bid 单，研判结论页出现「N 项因数据缺失未参与判定」且列出「分包占比」。

### 7.2 组 2 就绪态

- **RD-01**　商机 ①未确认时，`oppLaunch` 三卡显示缺口清单与「去确认交付预算」跳转；①②就绪后显示「就绪」。
- **RD-02**　表单页顶部就绪度条在必填未满时显示 `N/M`，补齐后实时变绿（不刷新页面）。
- **RD-03**　编辑既有草稿时「关联预算单」下拉**存在**且初值为 `r.budget_id`；PUT 后 DB 实测 `reviews.budget_id` 变更。
- **RD-04**　已提交过评审单的商机，L1 顶部仍显示下一步指引（去掉 `submitted===0` 条件的直接验证）。

### 7.3 组 3 导航与 IA

- **IA-44**　法务/合规BP/数据BP/采购BP/FDE 五个角色登录后导航含「相关商机」，且点进去能看到本部门有过任务的商机。
- **IA-45**　项目经理/销售经理/支持组/admin 导航含「预算单」，`#/budgets` 可达；标题对 admin 显示「全部」；版本链展开行 colspan=7 且列对齐。
- **IA-46**　②项目预算卡「＋新建项目预算」按钮在整卡中**只出现一次**；每行显示关联状态。
- **IA-47**　支持组修正商机档案某字段 → 事件流出现「档案人工修正: 字段 X 由 A 改为 B」；非授权角色看不到编辑入口且 PUT 返回 403。
- **IA-48**　任务中心出现「本单进度 N/M」列；研判台 meet/green/red 三 tile 可点且定位到对应队列。
- **IA-49**　归档库导入入口文案含「直接入库，不走流程」；向导导入文案含「导入为草稿」。
- **IA-50**　L1 分析区渲染灯色时间线（≥1 个数据点）且**全页 grep 无「P0 阶段」「P2」字样**。

### 7.4 组 4 语义

- **SM-01**　退回一个 reviewing 单后，该单同轮其他 pending 任务 status 变 `cancelled`（若 §3.3 通过）；`scope=mine` 不再返回它们；支持组监控页僵尸计数为 0。
- **SM-02**　支持组代打财务BP 任务后，L2 前置页签显示「由 销售支持组 代 财务BP 打灯」，事件流出现「代打」记录。
- **SM-03**　首页两个 tile 标签为「前置收集中」与「待录结论」，计数分别等于 `status='reviewing'` 与 `status='judged'` 的行数。
- **SM-04**　商机列表首行不是聚合行；空 `opp_code` 单据各自独立成行且带「未挂靠商机」标签。

### 7.5 组 5 数据治理

- **DG-00**　清理脚本的 5 条前置断言全部通过后才执行删除；任一条不通过则 ABORT 且**不写任何删除**（ABORT 分支只写独立 scratch 文件，不碰被跟踪证据）。
- **DG-01**　清理后 DB 实测逐表计数：`opps`=7、`opp_delivery`=7、`reviews`=6、`budgets`=6、`budget_delivery`=0、`robot_outbox`=0、`tasks`=**55**（原 695 = done 335 + pending 348 + returned 12，删 640；保留的 55 = REAL7 单上 done/archived 45 + done/returned 10）、`events` 只剩挂靠 6 张真实单的行、`agent_messages` 只剩挂靠保留单的行（原 258，删 240 → 18）、`users`=10、`settings`=20、`llm_calls`=41（均不变）。
- **DG-02**　清理前后 `certutil` SHA256 快照比对记录在案；逐表 `SELECT * ORDER BY rowid` JSON 指纹证据落 `tests/`。
- **DG-03**　清理后全量门 32 套 ALL PASS（含 PL00008572 依赖的 21 个文件所属套件），`grep -c "database is locked"` = 0。
- **DG-04**　首页灯色分布与近 8 周趋势的合计 = **6**（真实单数），不再是 93。
- **DG-05**　「包含测试数据」开关打开后能看到夹具行（开关本身可验证），关闭后为 0。
- **DG-06**　6 张保留单的 `id/type/opp_code/status/light/budget_id` 六字段逐行与 §D-D 明细表一致（清理未误伤真实数据）。

### 7.6 组 6–8

- **NT-01**　部门角色首页显示「你所在部门有 N 项待打灯」，N 与 `robot_outbox` 未投递行数一致；深链跳 `#/tasks?review_id=` 后只显示该单任务。
- **NT-02**　机器人管理页显示待投递积压量；`GET /api/robot/workbench` 的 `provider.active` 仍为 `false`、`capabilities.provider_send` 仍为 `false`（断言零外部调用未被破坏）。
- **CH-01**　导入 UI 的类型选择中 change 不可选（或置灰且带文案）。
- **PL-01**　任务中心部门文案由 `INDICATORS` 派生（改一个 dept 名，文案随之变——变异测试）。
- **PL-02**　`renderBudgets` 使用 `apiCached`（二次进入零网络请求，用 `list_network_requests` 断言）。

### 7.7 红线守护（全部组共用）

- **RL-01**　`tests/test_rules_e2e.js` 与 `tests/data_feasibility_check.js` 全绿——判灯规则与判例锚定不变式未破。
- **RL-02**　`tests/fixtures/pl8572.json` 六组、`tiandi.json` 十项锚定值全部命中。
- **RL-03**　`finance.js` 零 diff（`git diff --stat finance.js` 为空）。
- **RL-04**　`config.json` 逐字节未变（270B / sha 前16 `f285c66ad4790370`）且未入库。
- **RL-05**　全量门日志 `grep -c "database is locked"` = 0。
- **RL-06**　`/api/me` 未登录返回 401（鉴权面未被放宽）。

---

## 8. 风险与处置

| 风险 | 概率 | 处置 |
|---|---|---|
| `judgeCoverage` 与 `judge()` 漂移 | 中 | EV-04 用集合完整性钉住；两函数相邻放置 + 互指注释；**只读镜像，不参与判定** |
| 清理后某套件断言依赖被删数据 → 门红 | **高** | 清理前先跑一次门取基线；门红时**改套件**（让它自造数据）而不是保留脏数据；还原快照可回退。已知最高风险 = `test_opp360.js` 的 `ANCHOR='PL00008572'`（保留项，理论安全） |
| `tasks.status='cancelled'` 漏改消费方 | 中 | 派发前 `grep -n "tasks.status\|status='pending'\|status='done'" server.js public/app.js tests/`，同批改完；报告 HTML（`server.js:1105`）与 `taskSt()`（`app.js:2375`）是已知两处 |
| 证据端点暴露跨部门数据 | 低 | 数据本就是登录可读（`/api/reviews/:id` 无角色限制、360 登录可读），证据端点同口径，**不放宽也不收紧** |
| P0-3 就绪态与七道门文案漂移 | 中 | 就绪态计算复用服务端同一批谓词（经 360 或 meta 下发），**前端不得自行拼判定**（沿用 D-19 口径：`server.js:1976` 注释） |
| 组 1 弹窗改动破坏既有 IA/C2 浏览器套件 | 中 | 弹窗 DOM 保留既有 id（`#pk-g/#pk-y/#pk-r/#taskOp/#mask`），只**追加**证据区块；既有选择器不动 |
| 长任务跨多轮会话，上下文丢失 | **高** | 用 SDD ledger 记录每组完成状态；每组结束跑专项门并落证据文件；不依赖会话记忆 |
| 清理误删真实数据 | 低但后果重 | 显式 id 清单先落盘复核，不用谓词直接删；停机快照 + 双层验证；REAL7 白名单硬编码在删除条件里 |

---

## 9. 挂账项（本轮不做，需外部输入）

| 项 | 阻塞原因 | 解锁条件 |
|---|---|---|
| **P1-9** 分包占比 ≥70% 是否红线 | 制度原文未确认 | 业务方提供《项目评审管理规则》原文；确认后改 `server.js:875` 一行 + 反转用例 R-01 |
| **P0-7 的根治** change 型 Excel 导入 | 无变更决策表原件 | 拿到原件后补 `REVIEW_MAP` 的 `proj_stage`/`change_type` 映射 + `server.js:1418` sheet 选择 |
| **P0-5 的根治** 真实钉钉投递 | 接口权限未批（须走版本发布审批流程） | 权限生效后接 provider，补 `sent/failed` 状态迁移用例（`server.js:2678` 注释已预留） |
| **P1-2 的根治** 代打权限收紧 | 每角色仅 1 个账号，收紧无意义 | 先建多账号体系（每部门多人），再收紧代打并保留 admin 兜底 |
| **C 类指标的数据对接** | 财务/法务/FDE 系统未对接 | 另立 spec；届时 C 类降级为 B 类，`IND_EVIDENCE` 的 `external` 标志翻转即可（映射表已为此留好结构） |

---

## 10. 执行方式

- **单个长任务**，用 `superpowers:subagent-driven-development` 执行，SDD ledger 记 8 组的完成状态。
- 组内任务粒度由 writing-plans 阶段决定；组间顺序按 §5 依赖（组 5 数据治理必须最后）。
- 每组结束跑专项门 + 落红绿证据；全部结束跑全量门 32 套 + 快照还原双层验证。
- 全程不提交 git（沿用当前口径）；证据文件由脚本内部 `fs.writeFileSync(…, 'utf8')` 落盘，禁 shell 读写。
