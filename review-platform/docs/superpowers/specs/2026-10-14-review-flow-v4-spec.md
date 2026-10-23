# Spec · 评审全流程中枢 V4.0 工程规格（P0 详规 + P1/P2 契约）

> 立论来源: `docs/产品方案V4.0-评审全流程中枢.md`（提交 2f1738c）
> 实施基线: `a54322b`（前端 IA 8 任务完成态, run_all 20/20 全绿）
> 版本: 2026-10-14 ｜ 状态: 待批准开工
> 配套任务表: `docs/superpowers/plans/2026-10-14-review-flow-v4.md`

---

## §0 全局约束（继承 AGENTS.md 铁律，违反即返工）

1. 零 npm 依赖；Node 22 托管版；node:sqlite 单文件 server.js。
2. **服务端是唯一裁决面**：一切门禁/必填/锁定/提交/判灯/结论校验在 server.js；FE 提示仅引导。判灯、算账、锁定、提交、结论确认**永不出 LLM**。
3. 计算与判定逻辑改动必须命中真实原件锚定值（`tests/fixtures/pl8572.json` 六组、`tiandi.json` 十项）；新用例先取红证据（旧代码 FAIL 且非破坏基线全 PASS），再改码取绿；红绿日志留档 `tests/`。
4. 门禁/判例修正各留**一行回退注释 + 常量开关**（仿 `BUDGET_REQUIRED_TYPES` 模式，server.js:301）。
5. SQL 参数一律 `?` 绑定；innerHTML 一律 `esc()`；中文 UTF-8，证据由脚本内部 `fs.writeFileSync(...,'utf8')` 落盘。
6. `config.json` 永不入 git；重启服务写自命名日志（server_tN.log）。
7. 每任务 `git add` 只加简报点名文件；禁 `git add -A`。

---

## §1 数据模型（P0）

### 1.1 新表 `opps`（待评审商机档案）

```sql
CREATE TABLE IF NOT EXISTS opps (
  opp_code TEXT PRIMARY KEY,               -- 商机代码(业务主键, 沿用现网编码, 导入可带外部 ERP 码)
  title TEXT NOT NULL DEFAULT '',          -- 商机/项目名称
  customer TEXT DEFAULT '',                -- 客户名称
  region TEXT DEFAULT '',                  -- 营销区域
  province TEXT DEFAULT '',                -- 项目所在地省份
  biz_line TEXT DEFAULT '',                -- 业务线 G1|B2|G2
  contract_amount REAL,                    -- 预计合同金额(万元)
  opp_stage TEXT DEFAULT '',               -- 商机阶段
  sign_date TEXT DEFAULT '',               -- 预计签单时间
  sales TEXT DEFAULT '',                   -- 销售经理
  pm TEXT DEFAULT '',                      -- 项目经理
  survey TEXT DEFAULT '',                  -- 是否涉及测绘 否|是
  summary TEXT DEFAULT '',                 -- 项目概述
  source TEXT DEFAULT 'form',              -- 建档来源 form|excel|dialog|history
  status TEXT DEFAULT 'pending',           -- pending(待评审) | reviewed(归档翻转)
  created_by INTEGER, created_at TEXT, updated_at TEXT
);
```

**要素齐全（必填集 `OPP_REQUIRED`，服务端裁决，一行可调）**：
`['title','customer','biz_line','contract_amount','opp_stage','sales','summary']`
POST /api/opp 缺项 → 400 `{error:'商机要素缺失:字段中文标签/…'}`（复用 `MISSING_LABELS` 映射口径）。

**存量回填（幂等，仿 OC-04 模式）**：对 `reviews.opp_code ∪ budgets.opp_code` 的每个非空代码，若无 opps 行则建——title 取该商机最新评审标题/预算 project_name，其余要素取该商机最新一份 `form_json` 的同名字段，`source='history'`，status 按是否已有 archived 单判定。回填计数落日志。

### 1.2 新表 `opp_delivery`（交付预算升格商机级）

```sql
CREATE TABLE IF NOT EXISTS opp_delivery (
  opp_code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',    -- draft | confirmed(项目经理确认编制完成)
  rows_json TEXT DEFAULT '[]',             -- 行级明细(结构同现 budget_delivery.rows_json)
  source_file TEXT, owner_id INTEGER,
  created_at TEXT, updated_at TEXT
);
```

- 行成本/汇总实算**复用现 `deliverySum()`**（server.js:909）与 `finance.js rateFor()` 单价档，口径零改动。
- `budget_delivery` 表**保留只读**（历史预算单版本快照回显），不再接受新写；迁移：`budget_delivery` 每行按 `budgets.opp_code` 反查 → 无同码 opp_delivery 则插入，`status` 置 `confirmed`（能锁定即曾完整）且 `source_file` 原样带过来；已有则跳过（幂等）。

### 1.3 关系

```
opps 1 ── N budgets(项目预算, 版本链, +opp_code 已存在)
opps 1 ── N reviews(评审单, type ∈ presale|bid|change, +opp_code 已存在)
opps 1 ── 1 opp_delivery(交付预算, 先行编制)
```

---

## §2 三步链硬门禁（P0 核心，要严谨）

### 2.1 链路状态机

```
① 交付预算 opp_delivery: draft ──confirm──> confirmed ──(可修订后需再确认, 修订即回 draft)
② 项目预算 budgets:      draft ──lock─────> locked     (派生 newversion → draft, 链 parent_id 保留)
③ 评审单 reviews:        draft ──submit───> reviewing → judged → archived
```

### 2.2 门禁规则（服务端唯一裁决，全部 400/409 + 明确缺环文案）

| 闸口 | 位置（现状锚点） | V4.0 规则 |
|---|---|---|
| G1 交付预算确认 | 新端点 `POST /api/opp/:code/delivery/confirm` | 行集非空方可 confirmed；空行集 400「交付预算无明细行，不能确认」 |
| G2 项目预算锁定 | server.js `/lock`（实到 `:1076-1090`） | **缺项**（missingOf，不变）+ **该商机交付预算 status='confirmed'**（替换现「budget_delivery 行存在」检查；由常量 `DELIVERY_REQUIRED_TYPES=['bid','presale','change']` 控制——默认全类型要求，较今日**收紧不放松**，一行可回退）。**回退作用域边界（D-27）**：常量只管辖 `oppCodeB` 非空的商机级判定，无挂靠分支的现网附3 底稿门永不被短路 |
| G3 评审单提交 | server.js:1325-1336 `/submit` | 现三项校验保留（预算存在/锁定/`BUDGET_REQUIRED_TYPES` 关联）+ **二次核验链**：`review.budget_id` 对应预算已锁 **且** 其 `opp_code` 交付预算仍 confirmed（防历史数据绕过；bid 严格适用，presale 同，change 关联了预算才校验）。商机码取源见 **D-23**：只用 `budgets.opp_code`，不得回退到 `reviews.opp_code`；无挂靠（预算 `opp_code` 为空）时 G3 不核验，沿用 D-6 的现网附3 口径 |
| G4 归档翻转 reviewed | 归档动作处（现 archive 流程） | 归档成功后该商机若无未归档在途单 → `opps.status='reviewed'`。**读侧不变量（D-35 S-2）**：`opps.status` 是「归档事实的历史标记」而非实时状态机——翻转单向（全仓无写回 `pending` 的路径），任何「是否仍有在途」的判断一律用 D-25 的 era 在线单计数（`chain.reviews_total - chain.reviews_submitted` 或 G4 同款谓词），**禁止**读本列；回填侧「有一张归档即 reviewed」的相反判据记 P1（S-1），并带条件门：本列一旦被 FE 或端点响应当作在途/终态判据消费，S-1 必须先于该层落地 |

> **口径说明（对 V4.0 §2.2 的一处从严修订）**：产品文档写 presale「交付预算可选」；实测现网锁定本就要求附3明细（D-01~08 套件锚定），若按文档放开 presale 属**放松**。从严处理：三类预算锁定统一要求交付预算 confirmed，差异只体现在必填字段集。回退开关一行可调。此修订需用户确认（见 §7 决策点 D-2）。

> **共享语义（D-12，实施中升格）**：交付预算属**商机级**，同一 `opp_code` 下的多张预算单共享同一份 `opp_delivery` 行集——A 单确认后同商机 B 单亦可锁定，这是升格的设计意图而非漏洞；但**状态门不因共享而放宽**：`opp_delivery.status` 为 `draft` 时 A、B 双双 400。CH-13/CH-14 两例把这一强/弱两侧各自钉死。`getDelivery()` 的「先读 opp_delivery、无则回退 budget_delivery」是存量承接路径，不是并列真相源。

### 2.3 缺环诊断响应（供链路进度条消费）

`GET /api/opp/:code/360` 响应追加：

```json
{ "opp": {...opps 全要素...},
  "delivery": { "status":"draft|confirmed|none", "rows": n, "total_cost": x, "updated_at": "..." },
  "chain": { "delivery_confirmed": true|false, "budget_locked": true|false,
             "reviews_total": n, "reviews_submitted": n, "next_action": "confirm_delivery|lock_budget|submit_review|reviewing|judged" } }
```

`next_action` 由服务端按链序推导（FE 只渲染，不重算）。

---

## §3 API 契约（P0 新增/变更，全部参数绑定、登录门内）

| 方法路径 | 鉴权 | 请求 | 响应/错误 |
|---|---|---|---|
| `POST /api/opp` | 登录（销售三角色+支持组+admin 可建） | 商机要素 JSON | 200 `{opp}`；重复码 409「商机代码已存在」；缺要素 400 列表 |
| `PUT /api/opp/:code` | 创建人/支持组/admin | 要素子集 | 200 `{opp}`；404 |
| `GET /api/opp/:code` | 登录 | — | 200 `{opp}`；404 |
| `GET /api/opp/:code/delivery` | 登录 | — | 200 `{delivery:{status,rows,calc}}`（无则 `delivery:null`） |
| `PUT /api/opp/:code/delivery` | 项目经理/创建人/支持组/admin | `{rows:[...]}` | 200 `{delivery, calc}`；行改动后 status 回 `draft`（重确认纪律） |
| `POST /api/opp/:code/delivery/import` | 同上 | multipart xlsx（附3 模板，走现 python 解析器） | 200 `{delivery, row_sources}`；解析失败 502（现口径） |
| `POST /api/opp/:code/delivery/confirm` | 项目经理/创建人/支持组/admin | — | 200 `{status:'confirmed'}`；空行 400（G1） |
| `GET /api/meta/fields` | 登录 | — | 200 `{presale:[{k,l,t,o,req}],bid:[...],change:[...],opp:[...]}`（服务端注册表） |
| `GET /api/opp/:code/360` | 登录（已有） | — | 响应追加 opp 全要素/delivery/chain（§2.3，向后兼容追加键） |

变更（不改 URL）：`/lock`、`/submit` 门禁按 §2.2；`POST /api/reviews/import` 与附1 导入在建档缺失时**自动 upsert opps**（source='excel'）。

**派生列不变量（D-10，链路口径的前提）**：`budgets.opp_code` 列是「商机 ↔ 预算」唯一挂靠真相源（`fields.opp_code` 只是录入载体）。凡写入 `budgets.fields` 的入口都必须在同一条 UPDATE/INSERT 里把 `fields.opp_code` 投影到派生列——覆盖 `POST /api/budget`（建单）、`PUT /api/budget/:id`（表单编辑）、`POST /api/budget/import`（Excel）、`PUT /api/budget/:id/delivery/apply`（交付科目刷新）、`POST /api/agent/chat`（技能①对话编制）**五处**；`newversion` 派生新版本时按父单 `opp_code` 原样继承。取序一律 `本次 merged/body.opp_code || 该单既有列值 || null`，禁止在 body 不带商机码时把已挂靠的列洗成 null。漏任一处的后果：该单在下次启动回填前对分流（D-6）、计价基准（D-5）、G2 门禁、360 链路进度全部不可见，链路表现为「靠重启才通」。该不变量由**两层**守护（D-18）：**行为面 DL-22/DL-23**（对话技能①与 `/delivery/apply` 在「只送顶层 `body.opp_code`」态下各刷一次，断言派生列不被洗）是第一防线；**静态面 DL-21**（扫 `server.js` 全部写 `budgets.fields` 的 budgets 语句，按「`db.prepare` → 配对 `.run(` 的整条语句窗口」判定未同句投影即 FAIL，并对 UPDATE 类与引用 `bd.` 的派生 INSERT 要求「该单既有列值」兜底；用例内自带内存反例证明非恒绿）只作第二道网，其已知盲区是 SQL 由变量拼接时静态法看不见。**新增第六个写入点时，DL-21 会先翻红**——这是刻意的：要么补投影，要么显式改该用例并说明理由。同理 `opp_delivery.owner_id` 仅为最后写入人审计位，鉴权一律走 `canWriteOpp`（D-13）；交付明细的读取口径与写入同严（D-19）。

---

## §4 前端信息架构（P0）

### 4.1 全流程页签重排（#/opp/:code，容器锚 `#oppPage/#oppTabs` 不变）

| 新 t 值 | 页签 | 内容 | 旧 t 兼容 |
|---|---|---|---|
| overview | 概览 | **链路进度条**（①②③ 点状态+缺环红显+去编制直达）+ 指标卡 | overview |
| collect | 信息收集 | 交付预算卡（行表+汇总+确认按钮+三方式入口）/ 项目预算卡（版本链）/ 评审单卡（类型 chips，一商机 N 单） | budget→collect, review→collect |
| pre | 前置评审 | 打灯矩阵（部门×指标）+ 轮次留痕 | light→pre |
| judge | 结论管理 | 红黄绿 + 黄灯上会 + 结论录入 + 报告 | judge |
| analysis | 数据分析 | P2 占位（P0 渲染「上线中」空态） | — |
| chat | 对话 | 技能①/②内嵌（已落地，不动） | chat |
| archive | 归档 | 归档单（已落地，不动） | archive |

实现约束：`OPP_TABS` 常量替换 + renderOpp360 分支重写；旧 t 值在路由入口做一次映射（`location.hash.replace`）保证旧深链/旧断言不死；`?t=` 解析函数抽 `oppTabFromHash()` 供映射复用。信息收集页签的交付预算卡按 **D-21** 的「摘要 + 能力位门控两步加载」实现：360 的 `delivery` 只回摘要（`rows` 是计数），行集明细须待 `can_write` 为真后另拉 `GET /api/opp/:code/delivery`；只读态渲染摘要卡且不发明细请求。

### 4.2 新建待评审商机（#/new）

- 文案：「新商机」→「**新建待评审商机**」（导航 data-n=new 不变，IA 断言同批改）。
- 表单式：商机要素表单（§1.1 必填集 FE 同步标注）→ `POST /api/opp` → 成功后**停留在商机页**并弹出「选择首个评审类型」三卡；选 bid 时链路卡红显缺①②并给三方式入口（不是提交才报错）。
- ① 对话式 / ③ Excel：Excel 导入自动 upsert 商机；对话式建档列 P1（P0 该卡跳 #/agent 现行为不变）。
- 同商机再次评审：全流程页评审单卡「+ 发起新评审」→ 类型选择 → 要素继承。

### 4.3 列表与首页

- `#/opps` 增「链路进度」列（三点 ①②③ 状态 pill，服务端已回 chain 时前端零计算；现列表可先按 reviews/budgets 有无渲染，chain 列随 P0-T6 端点扩展接入）。
- renderHome 待办队列新增「交付预算待确认」（pm/创建人视角），指标卡文案同步。

---

## §5 必填注册表合一（P0）

现状四处口径：`finance.missingOf`（技能①预算 18 字段）、`agent.BID_REQUIRED`（技能②评审表）、`FIELDS[type].req`（FE 表单）、`BID_REQUIRED_FE`（FE 对话清单）。

V4.0 裁决：
1. server.js 新建唯一注册表 `REQUIRED = { opp: OPP_REQUIRED, budget: <from missingOf>, review: { presale:[…], bid:[…], change:[…] } }`——评审三集由服务端按现 FIELDS req 逐项落表（bid 的 FE 表单 req 与 BID_REQUIRED 差异项**逐项裁决**，见 §7 决策点 D-1）。
2. 所有校验路径（表单提交/技能②缺失清单/Excel 白名单/链路 G3）改读 `REQUIRED`。
3. `GET /api/meta/fields` 暴露注册表（含中文标签）。
4. FE `FIELDS` 保留为渲染缓存 + **对账用例** `RQ-*`：断言 FE FIELDS.req 集合 ≡ 服务端 REQUIRED.review[type]（漂移即红），不改造成运行时消费（控风险，P1 再切动态渲染）。

---

## §6 LLM 管理中心与机器人管理中心（P1 契约级，P2 详规另出）

### 6.1 LLM 管理（#/admin/llm，admin）
- **多 profile**：`config.json` 增 `LLM_PROFILES = {default, budget(技能①), review(技能②), parser}`（每 profile：BASE_URL/MODEL/API_KEY，缺省回退 default）；`agent.js` 调用路径按技能取 profile；密钥仍掩码回显、留空不改、永不入 git。
- 连通性诊断：`POST /api/admin/llm/test {profile}` → 上游 1-token 探针，回 `{ok, ms, error}`。
- 用量审计：新表 `llm_calls(ts, profile, ok, degraded, ms, tokens_est, ref)`，agent 调用路径每次落一行；`GET /api/admin/llm/stats?days=7` 聚合（调用数/失败数/降级数/平均延迟）。
- 降级策略：settings 键 `llm.degrade = {timeout_ms, retries, enabled}`；**降级为点选问答且 HTTP 200 的铁律不变**，仅参数化。
- 提示词版本：settings 键 `prompt.<skill>.v<n>`，agent.js 读覆盖否则用冻结默认（SYSTEM 段冻结纪律不破，改动跑 A 系列桩回归）。

### 6.2 机器人管理（#/admin/robot，admin；依托现 notify.js）
- 实例：`robot_instances(name, webhook, secret, env, enabled)`；连通性测试。
- 通知矩阵：`notify_matrix(event, target, enabled, channel)`；事件枚举=提交分派（现 server.js:1345 部门电话@）、灯态齐全待研判、黄灯上会提醒、红灯打回、结论/报告外发、前置超时催办（>48h）。
- 白名单：`robot_whitelist(user_id|phone, scope: create|query)`；机器人侧动作仍走平台同一门禁。
- P2：会话转写查看/人工接管/日成功率监控。

---

## §7 待用户确认的决策点（开工前拍板，默认值按「从严」取）

| # | 决策 | 默认裁定 |
|---|---|---|
| D-1 | bid 必填集差异项裁决（FE 表单 req 与技能② BID_REQUIRED 白名单不重合项：sub_amount/province/jiadao/product_type/b2b_scene/revenue_confirm/promo_* /sub_limit） | 以 FE 表单 req 为**提交硬门禁**；技能②白名单仅作文对话追问集（不因对话缺项而拦提交）——对话是录入手段，提交是裁决面 |
| D-2 | presale/change 的交付预算是否同样硬要求（§2.2 从严口径） | **统一要求 confirmed**（现网既有行为不放松）；`DELIVERY_REQUIRED_TYPES` 一行可回退为仅 bid |
| D-3 | 对话式建档排期 | P1（不阻塞 P0 链路严谨化） |
| D-4 | 同商机同类型多次评审 | 允许（round 递进沿用），不做唯一约束 |

### 7.1 开工后增补的工程裁定（T1~T2 实施中实测产生，总线拍板，非用户否决项）

| # | 裁定 | 依据与影响 |
|---|---|---|
| D-5 | 商机级交付预算的**计价基准**取序：该商机最新预算单 `fields.dev_dept` → 最新评审 `form_json.dev_dept` → 无（`rate=null`，`rate_source:'budget'\|'review'\|'none'`） | 禁止用 settings 兜底单价「造钱」；none 态下正编人天不计价，前端须显式渲染 `rate_source` |
| D-6 | 旧预算级 delivery 端点走**单写双读分流**，不做 410/400 | 原 §3「写端点 410」被证伪：D 套件（`test_delivery.js`）锚定旧写路径且零 `opp_code` 引用，直接 410 会成片翻红。分流键＝`budgets.opp_code`；无挂靠的预算单保持 V3.x 行为零变化，`budget_delivery` 转为只读存量底稿 |
| D-7 | G2 门禁的预算类型由 `reviews WHERE budget_id=?` 最新单推导，无评审时默认 `'bid'` | 宁可拦不放过 |
| D-9 | `POST /api/budget` 增收 `fields`/`opp_code` 并**立即落派生列**；挂靠不存在的商机码 → 400 指明三步链缺环 | 原 §3 隐含前提「建单即可挂靠」被实测证伪（旧 POST 丢弃 `fields`，`opp_code` 列仅 Excel 通道与启动期回填写入） |
| **D-10** | **`budgets.opp_code` 是商机↔预算唯一挂靠真相源；凡写 `fields` 的入口必须同批把 `fields.opp_code` 投影到派生列**（落地后实测**五处**写入点：Excel 导入 INSERT / `POST /api/budget` / `PUT /api/budget/:id` / `delivery/apply` 刷新 / 对话技能①，另 `newversion` 按父单继承；结构约束由 DL-21 源级静态对账守） | 任一处漏投影，该单在下次重启前对 D-6 分流、D-5 计价、G2 门禁、360 链路全部不可见——即「链路看似通了、实则靠重启」 |
| D-11 | Excel 预算导入的隐式建档 `source='excel'`（非 `'form'`）；`'form'` 留给 `POST /api/budget` 建单入口 | 与 §3 的 Excel 自动 upsert 口径对齐 |
| **D-12** | 同商机多张预算单**共享**一份 `opp_delivery` 行集：A 确认后同商机 B 亦可锁定，属商机级模型的**设计意图**而非漏洞 | 由 T2 实测副作用升格为口径；G2 用 CH-13（共享可达）/ CH-14（draft 时 A、B 双双 400，证明共享不放宽状态门）显式固化 |
| D-13 | `opp_delivery.owner_id` 降级为「最后写入人」审计位，**永不作鉴权依据**；商机级写权限唯一来源 `canWriteOpp`（建档人/项目经理/支持组/admin） | 共享模型下该列随最后写入者漂移 |
| **D-15** | 派生列投影的**取序**必须 `本次 opp_code → 该单既有列值 → null`，禁止把已挂靠的列洗成 null；由 DL-21 第二条源级对账守（凡 `UPDATE budgets SET ... opp_code=?` 的**整条语句窗口**内必须出现 `bd.opp_code`；加固口径见 D-18） | D-9 允许只送顶层 `body.opp_code` 建单（`fields` 内无该键），此时若投影只看 `merged.opp_code`，一次对话编制即令该单从链路上消失 |
| **D-16** | 商机360 的「② 项目预算」卡提供**带 `opp_code` 的建单入口**（`oppBudgetCreate(code)` → `POST /api/budget {project_name, opp_code}`），未知码直接透出服务端 400 文案 | 前端原唯一入口 `app.js:929 agentNewBudget()` 只送 `project_name`，永不挂靠 → 分流/计价/G2/链路进度在 UI 上整条走不通（API 层已由 DL-18 证明可通，缺的是入口） |
| **D-17** | 360 契约的计价基准三件套（`dev_dept`/`rate`/`rate_source`）挂在 `delivery` 对象上，`chain` 只承载链状态（五键冻结） | T6 曾按 `chain.dev_dept` 消费，属跨任务契约洞；计价口径属交付预算视图，不属链状态 |
| D-14 | 路由 `decodeURIComponent` 畸形 `%` → 500 属全仓库既存类别（与 360 端点同构），不在链路任务内顺手改 | 独立 P1 加固任务，避免混批 |
| D-8 | `/submit` 必填硬门禁的爆炸半径：若既有断言语义被破，置 `SUBMIT_REQUIRED_GATE=false` 并上报，**禁止改断言凑绿** | T4 执行协议；总线 2026-10-14 静态预检实测**预期零翻红**（DA 两判例 fixture 与各套件 `BID_BASE/BASE_BID` 均含 bid req 全 14 键，`test_opp_thread` 根本不调 `/submit`），见 `task-4-brief.md` §5.2 |
| **D-18** | 派生列不变量的**第一防线是行为用例，静态对账只作第二道网**：DL-22（对话技能①在「只送顶层 `body.opp_code`」态下刷一次对话后列不被洗）+ DL-23（`/delivery/apply` 同态）动态覆盖；DL-21 升级为「`db.prepare` → 配对 `.run(` 的整条语句窗口 + 仅对 UPDATE 类与实参引用 `bd.` 的派生 INSERT 要求兜底 + 内建内存反例自测」 | T2 评审 M1/M2 实测：原逐行谓词在「跨行 INSERT / UPDATE 拆行 / SQL 变量拼接 / 注释里出现 `bd.opp_code` 而实参写死 null / newversion 继承改 null」五种变体上**全部恒绿**，恒绿的静态检查比没有检查更危险；拼接 SQL 属静态法天然盲区，留给行为面 |
| **D-19** | `GET /api/opp/:code/delivery`（含行集、行成本与单价）读取**收紧为 `canWriteOpp` 四项**（建档人/项目经理/支持组/admin），对齐预算级 `canRead` 的审查整改#7 口径；`GET /api/opp/:code/360` **保持登录可读**（链路引导起点，只回摘要），并在 `delivery` 对象回 `can_write` 能力位供 FE 决定编辑态 | T2 评审 M3 反例：`fde1` 读预算级明细 403、经商机级读同一份数据 200，同一敏感数据两套口径属安全面倒退；能力位避免前端自行拼角色判断 |
| **D-20** | 存量脏档案（如实测仍在库的 `opps.opp_code='商机阶段'`、`PL-NOT-EXIST-98`）本轮**不清理**：形态校验只作用于 `POST /api/opp` 显式建档（D-11 隐式不校验），历史脏码由 `source` 可辨 | 删除用户数据不可逆，属数据处置决策，待单独拍板 |
| **D-21** | 商机360「信息收集」页签的交付预算卡采用**摘要 + 能力位门控的两步加载**：360 的 `delivery` 恒为对象且 `rows` 是**计数**（无 `sum`/行集/`rd_price`/`prod_price`/`source_file`），故 FE 先按摘要渲染卡片与状态 pill，再仅当 `delivery.can_write===true` 时 `await GET /api/opp/:code/delivery` 填充行表与汇总（`opdlvMount()`）；只读态渲染合计/单价摘要 + 权限说明，**不发**明细请求 | 原 T6 简报把 360 载荷当明细响应体读，`dl.rows.map(...)` 对数字调用 `.map` 即 TypeError 崩页签；且 D-19 收紧后非四项角色请求明细即 403，无门控会让 FDE/财务一进 360 就被 toast 报错。分工原则：**读权限用 `can_write` 能力位短路，写权限才由服务端 403 裁决**；状态 pill 也须改判 `OPDLV.status`（T5 后 `dl` 恒真值，原 `dl ? 草稿 : 未编制` 会把「未编制」永远显示成「草稿」） |
| **D-22** | 360 摘要的 `rate` 取值表达式定为 `od ? odCalc.rate : rateFor(rp.dev_dept, getSettings())`（与明细端点 `:1472/:1474` 逐分支同构）；`rateFor` 对未知部门/空串天然返回 `null`，**禁止**再叠 `|| 默认值`。同时 T5 的对账类用例（C2-06/07）统一以**销售支持组**身份登录 | 总线自纠（简报带病代码第三次）：D-17 首发写 `rp.rate === undefined ? null : rp.rate`，而 `oppRateOf`（`server.js:242-248`）三个 return 只给 `{dev_dept, source}`、从不返回 `rate`，照原写法 360 的单价恒 `null`、C2-07 两端对账必翻红；C2-06/07 要读明细，用非四项角色即 403，会被误读成契约缺陷 |
| **D-23** | G3 提交二次核验的商机码**只从关联预算单的 `budgets.opp_code` 解析**，取消 `|| review.opp_code` 表单兜底；判定式保持严格式 `if (!odChain \|\| odChain.status !== 'confirmed')`（缺行集即拦），实施中自行放松为 `odChain &&` 的写法一律还原 | 本 spec §2.2 G3 一行原文即「**其**（预算单）`opp_code` 交付预算仍 confirmed」，D-10 亦裁定 `budgets.opp_code` 是链路挂靠唯一真相源；`reviews.opp_code`（`:138/:141` 从 `form_json` 回填）是 G4 档案翻转与 360 聚合用的**档案键**，当作门禁证据等于给门禁加第二条口径。实测反例：`tests/data_feasibility_check.js:57` 建预算不带 opp_code（走 D-6 无挂靠附3 路径锁定）、`:65` 的评审表单携带判例原件真实商机码 → 兜底触发后 DA 判例锚定与 R 规则矩阵整片 400，而这两个套件的期望值按 AGENTS.md 禁止改动。删除兜底不损失防护：anchored 路径的「有明细行 ∧ confirmed」已由 G2 在锁定时强制，提交时「行集不存在」在该路径不可达；漂移防护（① 退草稿）仍由 `status!=='confirmed'` 覆盖。防回归锚=CH-16（无挂靠锁定单 + 表单带 draft 商机码 → 提交 200）与 CH-16b（同商机经 opp 锚定路径仍拦） |

| **D-24** | 提交必填门落地时，锚定值回归套件（DA 判例）若因载荷缺 req 键被拦，**只补套件里的提交载荷、禁改 `tests/fixtures/*.json` 与 `c.expect`**；补值必须落在判例既有结论的阈值区间内（`ops_years` 取 2 落 `<=3` 绿区间；`payment_terms` 为引擎无关键），并要求贴「补前/补后两次 DA 末行逐字对照」证明零漂移 | 实测 `c02_08068.json` 的 `payment_terms` 与 `c03_08111.json` 的 `ops_years` 均为空串（粗筛「键名出现即覆盖」失真），二者各缺 bid req 一项 → `/submit` 必填门必 400。fixture 是判例原件的审计载体、`c.expect` 是人工判定文书，两者按 AGENTS.md 与既有测试规范禁止改动；而 DA 早在 `:52-56` 就用「区间对齐」构造预算输入，补一个绿区间值与既有方法同构。`ops_years` 确为引擎键（`server.js:445/:471-473`），若随手填 `>3` 会新增黄项并带 XO 位、直接污染判例结论——故裁定把「值必须落在哪个区间、为何不动断言面」写死，而不是留给实施者临场判断 |

| **D-25** | 360 的 `chain` 三项计数（`reviews_total`/`reviews_submitted`/`next_action` 的判据）**只统计在线单**（`era IS NULL OR era='online'`），与 G4 的 era 口径对齐；历史单仍完整保留在 `reviews` 列表与 `lights` 聚合里。`delivery.can_write` 保持为路由内 `canWriteOpp` 的**逐字同源副本**（不提取公共函数），并以 C2-10 三身份行为对账（`can_write===true ⇔` 明细 200）作唯一漂移守护；C2-02/03 的契约形状改为**键集恰好相等** | 承接 D-23 的同一教训——门禁与引导必须按同一 era 口径，否则「只有存量历史单」的商机一进 360 就被判成「③ 已提交/链路已闭合」（历史单 `status` 必然非 draft），向导与 next_action 一起说谎；而列表/灯态若也过滤掉历史单，数据分析面就丢失存量承接数据，故两侧口径**故意不同**。`canWriteOpp`（`server.js:1482`）是 delivery 路由内的局部常量，PUT/import/GET/confirm 四处共用，提取成公共函数属越界重构；但 D-19 之后 360 必须报告同一个判权结果，重复不可避免——用行为对账而非口头约定钉住它。形状断言从「包含」改「恰好相等」是因为 D-17/D-19/D-22 三轮追加已让首发文本的键集过期，宽松写法会把漂移读成正常 |
| **D-27** | **G2 的回退开关只管辖「有挂靠商机」分支**：`oppCodeB` 判空必须在外、`DELIVERY_REQUIRED_TYPES.includes(g2Type)` 在内，无挂靠的现网附3 底稿门（含 D 套件锚定文案）**任何情况下不被常量短路**。T3 简报 §3b 给的嵌套骨架与此相反，属总线带病代码第五次，实施者按 §9 纠偏后追认 | 照简报抄则 `[]` 回退会把 D-6 旧路径的递进门禁一并拆掉，`test_delivery.js` 20 条锚定当场翻红——「一行回退」的语义是放松**新门**，不是放松**旧门**。实证：回退态 `tests/green_chain_rollback.txt` 中 CH-01 三条 FAIL(实 200) 而 CH-10 两条 PASS、D 20/0 全绿。**通用规则：凡「一行回退开关」类门禁，简报必须写明开关的作用域边界（哪条分支不归它管），不能只给嵌套骨架** |
| **D-28** | `g2Type` 在默认常量下**零判别力**（三类全在 `DELIVERY_REQUIRED_TYPES` 内，`.includes()` 恒真；实测 272 张挂靠预算单里 236 张的类型来自 D-7 的「无关联评审→默认 bid」），P0 不补「只删 `change` 元素」的类型级行为用例 | 零判别力是 D-2「从严」的设计后果而非缺陷；CH-12 的全清规程已证明开关可单行反转且不伤其他规则，再加一轮常量变体的复跑成本大于收益。真要做类型级回退须先有「change 免交付预算」的业务诉求，届时 `g2Type` 即现成挂载点——记入 P1 |
| **D-29** | 三步链在 T3 之后是「**服务端已通、UI 未可达**」：现网 FE 唯一建预算单入口 `app.js:929 agentNewBudget()` 只送 `{project_name}`（不带 `opp_code`）→ 恒走无挂靠分支，G2/G3 商机级判定对 UI 用户零影响；FE 亦无「确认交付预算」按钮（`opp_delivery` 存量 `draft=191` 的现实成因）。该洞归 **D-16 / T6** 承接（`task-6-brief.md` §D-16 建单带 `opp_code` + `opdlvConfirm()` 接 `/api/opp/:code/delivery/confirm`），非 T3 缺陷 | 收工门口径禁止把「G2/G3 已落地」表述为「用户已被三步链约束」：`task-8-brief.md` §3 的 G-04 只是 API 级端到端手证，T6 落地后 T8 报告须**指名哪条 IA 用例**证明 UI 端 ①→②→③ 可达（现为 T6 IA-20 追加断言证 ② 挂靠、T7 IA-23 证 ③ 表单带码）。存量 draft 数据仍按 D-20 本轮不清理，但演示全流程需人工点一次「确认交付预算」，写进 T8「剩余缺口」 |
| **D-30** | T3 四项收尾裁定：①CH-11b 用 `node:sqlite` 直写库造 `era='history'` 未归档行**保留**（实测 `finally { dropSynth }` 在位、DELETE 带 `id=? AND title=?` 双限定，且有 `test_security_notify.js:105` 先例）；②AV/SN 不由 T3 补跑（二者临时改写 `config.json`，并发会话串扰风险高于收益），改由 T8 全量门复验；③CH-15（链①②齐后 `newversion` 派生不改写 `opp_delivery` 状态）保留，属 G2 收紧直接半径内守护；④日志按轮次另名（`server_t3fix/t3c/t3d/t3e`）认可，最终验收构建=`server_t3e.log` | ①的代价如实记录：`era` 谓词在纯 API 面不可判别，直写库是唯一钉住它的手段；④符合「不得截断已被引用的日志名」硬约束。**附带暴露 T2 遗留静默缺陷**：`test_delivery_opp.js` 旧 3 参 `check()` 签名吞掉了 5 处第 4 实参的证据（DL-17/18/19），签名扩到 4 参后这 5 行输出多 ` \| 证据` 后缀而判定语义零变化——跨 T2/T3 diff DL 日志时属预期差异，勿判为回归 |
| **D-31** | **`/submit` 的门序**：`BUDGET_REQUIRED_TYPES`(必带预算单) → **G3 三步链** → **必填门(`SUBMIT_REQUIRED_GATE`)** → 分派。RQ 提交类用例（RQ-05/06/08）一律用**无挂靠预算单**夹具（`POST /api/budget` 不带 `opp_code` → `PUT /:id/delivery` 附3 底稿 → `/lock`）使 G3 天然跳过，必填门成为唯一被测对象；RQ-06 须断言文案**以「必填缺失」开头**且 `missing` 含目标键 | G3 在前且同样返回 400：若用例预算单有挂靠而 ① 未 confirmed，则「期望 200」的 RQ-05/08 被 G3 拦死，而「期望 400」的 RQ-06 测到的是 G3 而非必填门——**状态码相同、被测对象错位**，是本轮最隐蔽的假绿面。无挂靠路径是现网主干（实测 1535/1807=84.9%），夹具与判例套件同构，成本为零；G3 自身的回归由 CH 套件负责，两面不交叉。附带把 D-27 的通用规则落到 `SUBMIT_REQUIRED_GATE`：回退只关必填校验，不短路预算单必带门与 G3，RQ-09 回退轮须同贴「未闭合有挂靠单仍被 G3 拦」的证据 |
| **D-32** | **已确认（confirmed）≠ 只读**：① 交付预算确认后，「+ 加行 / 保存明细 / 上传附3 解析」三个写入口在 FE 上**必须仍可点**（只有「确认交付预算」按钮自身禁用），因为服务端 `PUT /api/opp/:code/delivery` 的语义就是「修订即自动回 draft，须重新确认」（§2.2 状态机 `:83`）。T6 简报 §3d 原稿把四个按钮统一 `${OPDLV.locked ? 'disabled' : ''}`，属总线带病代码第七次（FE 侧首例），已更正并新增 **IA-8b** 断言 | 原稿构成 **UI 死路**：confirmed 后用户点不到任何写入口，而同一页的用户提示写着「改行再保存即自动回草稿」——文案承诺、服务端能力、FE 可用性三者打架，且旧 IA 断言（只数表格与文案）抓不到。写权限本来由服务端 `canWriteOpp` 四项裁决（D-19），confirmed 状态不参与写权限判断；IA-8b 同时钉住「FE 回草稿 ⇒ 360 `chain.delivery_confirmed` 翻转 ⇒ G2 重新拦锁定 400」这条跨 T5/T3 的联动，防止把回草稿做成纯视觉 |
| **D-33** | **商机要素 FE 注册表的 req 集是 8 项而非 7 项**：T7 简报 §3a 的 `OPP_F` 表实测有 8 个 `req: 1`（`opp_code title customer biz_line contract_amount opp_stage sales summary`），而注释写「7 项必填 req:1」。裁定为**注释错、表对**：`server.js:183 OPP_REQUIRED` 的 7 键确实不含 `opp_code`，但 `:1452-1456` 的 `POST /api/opp` 在 missing 扫描**之前**先跑代码形态正则并 400「商机代码不合法」，即商机代码是走另一条文案的硬门禁、永不进 `missing[]`。简报已就地更正注释、加两条禁止（不得删 `req:1` 求对齐；不得反向把 `opp_code` 塞进 `OPP_REQUIRED`——正则门在前，那是走不到的死分支且混淆 `missing` 语义），并要求 T7 报告贴 `OPP_F` req 集与「7 键 + `opp_code`」的逐键对账 | 总线带病代码第八次（FE 侧第二例）。风险不在运行时而在**下一位读者的手**：一个「7 项」的注释配 8 个星标，最自然的"修正"是删掉一个 flag——而 `opp_code` 那个正是 IA-21（空表提交被 FE 拦、不发请求）的断言点，删掉即把新建立的必填门做成纯服务端兜底、FE 空提交直打 400。对账口径同时给 T4 的 `/api/meta/fields` 实时下发留出可比对的锚 |
| **D-34** | **T5 简报的 `delivery` 对象存着三个版本**（§3 原块 4 键 / §6 D-17 七键 / §7 D-19 八键），而 §2 用例 C2-02 断言键集「恰好等于」8 项。裁定：新增 §8 终版合并块（自 `mOpp` 到 `return send` 一整块，合并 §3+D-17+D-22+D-19/D-25），实施会话**只抄 §8、§3 原块作废**；`chain` 五键冻结不变，键序 `status/rows/total_cost/dev_dept/rate/rate_source/updated_at/can_write`。附带由总线代劳实测四条前置事实（`rateFor` 已 `:8` require、`getSettings` `:294`、`deliverySumFor` `:228-240` 返回含 `rate`、被抄的 `canWriteOpp` 现于 `:1482` 而非 §7 所写旧行号 `:1468`），并裁掉一处用例扩张：C2-10 的 `can_write===false ⇔ 明细 403` 仅对**有档案码**成立（无档案在 `:1479` 先 404，早于权限求值），禁止补 404 分支断言 | 总线带病代码第九次。缺陷形态不是错代码而是**未收敛的分层追加**：把合并劳动留给实施会话，最省事的错误出口是放宽 C2-02 的「恰好相等」——即用改断言迎合实现（红线）；第二类风险是抄半块漏 `can_write`，使编辑态判断退回前端拼角色，违 D-19 初衷。另记一条实况防误读：D-19 ① 的明细读取收紧尚未进 HEAD（`:1484` GET 分支注释仍是「登录即可读」），它本来就是 T5 的活 |
| **D-35** | **T3 评审收口（六项建议处置）**：评审判 APPROVE-WITH-NOTES、R-01~R-10 全通过、T3 本体无必须整改项。S-1（`server.js:207/212` 回填用「有一张归档」判据、与 G4 `:1692` 的「在线单全归档」相反，且在每次重启的生产路径上）记 **P1** + 条件门：**任一层一旦把 `opps.status` 用作在途/终态判据，S-1 必须先于该层落地**。S-2（G4 单向、全仓无 `pending` 回写路径）→ **P0 内补读侧不变量**：「是否在途」一律用 D-25 的 era 在线单计数，`opps.status` 语义冻结为归档事实的历史标记、非实时状态机。S-3（DL-21 静态窗口只向下探 8 行，超距的 prepare/run 分离写法静默失明且不进 `seen`，而 `seen>=6` 恰在下界）记 P1。S-4（报告两处叙述失真：被吞证据 4 处非 5 处；回退态 FAIL 归因实为 G2 剩余 + G3 而非「G3/G4」）总线记账、不回改已收口产物，DL 日志跨轮对拍口径=「4 行变丰富、0 行丢失」。S-5 **取代 D-30④**：验收构建身份改以「`git status --porcelain server.js` 为空 ⇒ 运行源码 ≡ 被验收提交」为口径，PID 只作导航（现持有者 36456/`server_t3g.log`，49056/`server_t3e.log` 已过期）。S-6：`h3_check` **不进 `run_all.js`**（它写 `shots/`，会覆盖他会话未提交产物），T8 以 IA/NAV/UI 三套 + 归属披露结案 | S-1 的实测前置是「该列今天零消费方」：`grep -c reviewed public/app.js` = 0、T6 简报对 `opp.status` 引用数 = 0、全仓写入点仅 `:212`/`:1693` 两处且无回写路径。在此前提下收工门前改 `migrateV40` 判据属无收益扩张（半径覆盖 OP 套件与 D-20 脏档口径）；而把不变量写在**读侧**比新增反向翻转更省，且不新增 `pending` 写路径的鉴权面。S-5 换口径的额外收益：免除了「谁重启了服务」的追踪战，评审即用 `git diff --name-only 5623f81 HEAD` 只含 spec md 证明绿未被并行文档提交污染 |
| **D-36** | **更正 D-35 S-2 的写入点枚举（裁定不动，只改事实陈述）**：`opps.status` 全仓写入面实测为 **3 个 INSERT + 1 个 UPDATE**——`server.js:208`（历史回填，值 `archived ? 'reviewed' : 'pending'`）、`:255`（建档助手，`'pending'`）、`:1558`（`POST /api/opp`，`'pending'`）、`:1798`（G4 归档翻转 `'reviewed'`）。D-35 原文「仅 `:212`/`:1693` 两处」枚举不全，且行号已随 T4 的 +107 行漂移（G4 由 `:1693` → `:1798`）。结论不变且**更强**：唯一的 UPDATE 通道只写 `reviewed`，`PUT /api/opp/:code`（`:1540`）的列白名单是 `OPP_FIELDS`（`:262`，12 键，**不含 `status`**）⇒ 改要素不可能顺带回退状态，单向性由列白名单**结构性**保证而非约定 | 该枚举是 S-1「该列今天零消费方、收工门前不动回填判据」的前提之一；前提里的事实错误即使不动摇结论也必须显式更正，否则后续会话会按「只有两处写入」去审计而漏掉三个 INSERT。同时立一条引用规范：**总线裁定正文里的行号一律标注基准构建**（HEAD 提交号或「T4 未提交 diff」），跨任务引用改为**内容定位**（注释原文 + 相邻语句），因为 +107 行一落，先前写对的行号就会集体失真 |
| **D-37** | **全量门跑前必须快照 `shots/`**：`run_all.js` 的 HL/NAV/IA 三套浏览器套件会重写 `review-platform/shots/*.png`。实测该目录 30 个文件中 **10 个 tracked-but-modified + 8 个 untracked**（含 `H_IA_1~4`、`H_NAV_2_opp360/3_tasks/4_judge/5_sales`，属并行线的现场留证）。未跟踪者 **git 无法还原**，故「跑就跑了、只跑不提交」的旧口径作废；T8 须在跑 `run_all` 前把 `shots/` 整目录快照到 gitignore 的 `.superpowers/` 下并在报告披露两处路径，被跟踪的 10 个**不得**由 T8 主动 `git checkout` 还原 | 收工门是 V4.0 唯一一次把三套浏览器套件放进同一进程全跑，覆盖是**不可逆**的（对未跟踪文件而言）；快照成本一次 `cp -r`，换来的是「并行线的证据可复原」。基线快照已由总线于 18:58 落在 `.superpowers/sdd/2026-10-14-review-flow-v4/shots_pre_t8_20261014_1858/`（实测 30 件），但另一条线随时可能重生成，所以 T8 自己跑前仍须再拍一次新鲜的——`ls | wc -l` 少于在场数即视为快照失败、停下上报 |
| **D-38** | **吸收 T4 报告 §10 的两处规格事实更正（基准构建 `d86338b`，总线实测复现）**：① **集合关系**——bid 的「提交必填门 req 集」与「对话追问集 `BID_REQUIRED`」**互不包含**，不是 §5 原文所暗示的包含关系。实测 req 集 14 键、追问集 17 键、交叠仅 7 键（`customer/contract_amount/sign_path/secret/settle_method/guarantee/non_compete`）；req 独有 7 键（`biz_line/gross_margin/ops_years/survey/payment_terms/summary/data_review`）、追问独有 10 键（`sub_amount/province/jiadao/product_type/b2b_scene/revenue_confirm/promo_target/promo_amount/promo_outside/sub_limit`）。证据件 `tests/bus_d38_sets.txt`。② **`shots/` 的写入方**——真正重写 `review-platform/shots/*.png` 的是 `run_all.js` SUITES 里的 **HL/NAV/IA 三套**，它们用**相对路径** `page.screenshot({ path: 'shots/…' })`，从 `review-platform/` 启动时 CWD 命中该目录；而 `h3_check / h_adv_check / h_ui_shots / h_manual_check` 四套用的是 `path.join(__dirname, 'shots')` = **`tests/shots/`**，且 `.gitignore:23` 正是忽略它 ⇒ 这四套**从不**触碰并行线的 10 M + 8 untracked 留证。据此 **D-37 的快照令仍然成立且必要**（威胁来源换了名字，风险没变），但 **D-35 S-6 给 h3_check 免跑的理由作废**——它应改为「浏览器层已由 IA/NAV/UI 覆盖，h3 无增量证据价值」，禁令保留、理由重写，以免后续会话据错误理由扩大禁令范围 | D-35 S-2 的枚举教训（D-36）是同一类失真的第二次：一次单模式 grep 就下「全仓只有两处」的结论。本条的两处更正都来自实施会话的实测反驳，总线逐条复现后才落笔——①用 `GET /api/meta/fields` + `require('./agent.js').BID_REQUIRED` 求差集，②用 `grep 路径形态` 区分 `__dirname` 与相对路径两种写法。规范再进一格：**引用「某套件写哪些文件」必须以路径解析方式（相对 or `__dirname`）+ 当前 CWD 双确**，只看文件名会得出方向相反的结论 |
| **D-39** | **并发跑库的假红分类法 + 契约用例必须有永久载体**：① 总线自有轮次首跑 `test_required.js` 得 **28 passed / 1 failed**，失败行是 `RQ-05 … status=500 服务器错误:database is locked`，同套**单跑立即 29/0**——根因是实施线（T5）此刻仍在跑套、共享 `data/review.db` 被并发写。立规：**凡红先分类**，`database is locked`（及 500 文案含 locked / EBUSY）一律记**环境红**，必须单跑复验后才允许入档；总线开跑前须确认实施线已交报告并**显式声明让出 DB**，否则不跑。② T5 的 C2 契约用例写在临时脚本 `tests/_tmp_360v2.js` 里，按 AGENTS.md「临时脚本用完即删」被删，只剩 `red_360v2.txt` / `green_360v2.txt` 两份日志 ⇒ **D-19 的 403 边界、D-17 的 delivery 八键 / chain 五键冻结、D-22 的 `rate` 分支同构、D-25 的 era 在线单口径在回归体系里没有可注册载体**（T8 的 `run_all` 无法追加不存在的文件）。裁定：T5 补一个永久套件 **`tests/test_opp360.js`**（22 条 C2 语义一字不改地固化，支持 `--log=`，零新语义、不改 `server.js`），**T8 的 D-26 注册表由四套扩为五套**（OP/DL/CH/RQ + **C2**），套数仍按 `SUITES` 实测项数填写 | 单文件 SQLite 没有行级并发，多会话共用工作区是本项目既定现实（AGENTS.md 已记「并发会话共用工作目录」）；不把「环境红」显式区分出来，收工门就会出现既无法复现、也无法解释的红。第二个发现是纪律的正确执行反而暴露了缺口：临时脚本规则保住了工作区整洁，却把不变式变成了无载体的口头承诺——回归价值必须靠「永久套件」这一形态来兑现 |
| **D-40** | **浏览器层验证的归属与 `shots/` 保护统一（消除派发词自相矛盾）**：T5 报告 §9-① 如实记录了一处**主动偏离**——`task-5-dispatch.md` 硬约束 5 禁碰 `review-platform/shots/`（他会话未提交留证），同一份派发的验证清单却又要求跑 `h_ia_shots.js` / `h_nav_shots.js`；二者在 D-38 ② 实测出「IA/NAV/HL 用相对路径写 `review-platform/shots/`」之后被证明**不可同时满足**。裁定按任务性质分轨：① **服务端契约类任务**（T5 及后续同类）的浏览器层验证一律由「API 级契约套件 + 一次性 FE 检查（截图只落 `tests/shots/`）」满足，派发词**不再**要求其跑 IA/NAV；全量浏览器验证只归属 T8 收工门，受 D-37 快照保护。② **前端类任务**（T6 页签重构 / T7 新建向导）的 IA 用例就是核心验收面，**必须跑** IA/NAV/UI，但自本裁定起把 D-37 的快照令从「T8 专属」扩张为「**任何将要跑 IA/NAV/HL 的任务，跑前必须先把 `shots/` 整目录快照到 `.superpowers/` 下的带时间戳目录，并在报告披露源与快照两处路径**」；被跟踪的修改文件不得由实施会话主动 `git checkout` 还原。③ 派发词若再同时出现「禁碰 shots/」与「跑 IA/NAV」两条，视为总线侧缺陷，实施会话**按本条分轨口径执行并在报告披露**，不必 BLOCKED 等待 | T5 的取舍经实测是正确的（它给的 `11 passed, 0 failed` FE 检查与 `tests/shots/` 落点都不伤并行线），但一个需要会话「自行调和互相矛盾的约束」的派发体系不可持续——同一矛盾会原样砸在 T6/T7 身上，而这两条任务恰恰**必须**跑 IA，若不加保护就会覆盖那 8 个 git 救不回来的 untracked 留证。分轨后：契约类不碰浏览器全量门，前端类带着快照保护碰，两个方向都不再有口头矛盾 |
| **D-41** | **`chain.next_action` 五态机的第 5 态无守卫，补一条用例而不是改口径**：总线对 T5 的永久契约套件 `tests/test_opp360.js`（23 条）做深度复核，四条不变式的判据强度都合格（键集用 `Object.keys().sort()` 全等、`near()` 双侧须为 number 使 `null` 蒙不过去、era 过滤有正反两向断言、403 同时比状态码与文案且与 `can_write` 成对）。**唯一缺口**：C2-04 的三条蕴含式跑在同一个 ANCHOR 夹具上，实测该夹具落在「① 已确认、② 未锁定」⇒ 只有 `next_action==='lock_budget'` 这一支真的开火；①③⑤ 分别由 C2-05 与 C2-11 覆盖，**`'reviewing'`（④：存在 online 且 status='reviewing' 的评审单）在全件里没有任何断言**。⇒ 若服务端把 `some(r.status==='reviewing')` 误写成 `every(...)`，23 条全绿也照不出来。裁定：T6 让出 `review.db` 后向 T5 线补 **C2-04b**（构造一张 online + `status='reviewing'` 的评审单，断言 `chain.next_action==='reviewing'`，并附「该单转入研判结论后 next_action 翻为 `judged`」的反证使其非死分支），**既有 23 条语义/断言/期望值一字不动**，末行由 23 变 24；`tests/test_opp360.js` 单独一次提交（仍严禁 `git add -A`） | 这是 D-39 ②「契约用例必须有永久载体」的第二阶问题：有了载体不等于载体有判别力——条件断言必须各自命中一个夹具分支，否则「绿」只代表当前数据恰好绕过了那条支路。与本条同型的空转在 C2-07 上已经抓到并修过一次（`rate_source` 恒为 `none` ⇒ `odCalc.rate` 分支从未执行，遂补 C2-07b）。规范补一句：**写 `cond ? 断言 : true` 形态的用例时，必须同时给出「哪个夹具使 cond 为真」的实测证据**（本套件的证据是绿日志里 `命中规则=②` 这一行），否则该用例按未覆盖计数 |
| **D-42** | **证据文件的「可再生 / 不可再生」分级，废除「禁碰 `tests/green_*.txt`」这类一刀切**：D-40 消灭了 `shots/` 侧的派发矛盾，T6 运行期又暴露同型第二例——派发硬约束写「既有 `tests/green_*.txt` / `red_*.txt` 一律不许碰」，而同一份派发的收工门又要求跑 IA/NAV/UI，这三套的默认 `--log` 落点正是 `tests/green_ia.txt` / `green_nav.txt` / `green_ui.txt`。实测：T6 跑完 IA 后 `git diff --numstat` 只有 **2/2 行**差异（`rows=133` → `rows=148` 这类**运行期数据行数**，断言集与 `18 passed, 0 failed` 逐字不变），NAV 跑完与 HEAD **零差异**——因为它们本来就是「同一套件的最新一次运行输出」，旧版内容在 git 历史里**完好可取**，覆盖不构成证据损失。分级如下：① **可再生证据**＝被 git 跟踪的套件日志（`green_*/red_*`），任何任务跑对应套件都可以直接覆盖，**无需申请**，但**不得**把它当红/绿配对载体——配对必须用任务前缀名（`_t6_pre_ia.txt` / `_t6_post_ia.txt`，T5 的 `_t5_pre_*` 已是正确示范），且**一律不 add**（提交的套件日志只限本任务新增的永久套件）；② **不可再生证据**＝未跟踪文件（`shots/` 下 8 个 `??`、各线临时留证），只能靠快照保护（D-37/D-40）；③ 判定某文件属哪级的唯一实测口径是 `git ls-files --error-unmatch <file>` + `git status --short` 的组合，**不是**文件名的前缀直觉 | 派发词里的「不许碰」把两类证据混为一谈，后果是会话要么违令覆盖（然后被指控越界）、要么为守令拒绝跑收工门点名的套件（然后收工门缺证据）——T5 与 T6 两轮都在这条线上消耗了一轮澄清。规范补一句：**约束必须写明保护手段与证据类别的对应关系**（可再生 ⇒ 版本控制即够；不可再生 ⇒ 快照），否则同一句「不要碰」会在不同文件上要求完全不同的行为 |

| **D-43** | **P1 的 LLM 管理落点更正 + `config.json` 单一写者原则**：总线实测现网**已有** `GET/POST /api/admin/config`（`server.js:1841` 起，注释自署「T4: LLM 配置管理(admin 限定, key 掩码, 写回保留既有键)」）——GET 回 `{LLM_BASE_URL, LLM_MODEL, LLM_API_KEY_MASKED}`，`maskKey` 取前 3 后 4 且绝不回明文；POST 走 `readCfg()` → 逐键 merge → `fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2))`，并在 `n === 0` 时 400。⇒ 我在 `plans` §P1 给 T9 立的「只许 merge 写回、禁整文件重写（会吞 `REPORT_SECRET`）」红线**早已被既有实现满足**，而 spec §6.1 原文「`config.json` 增 `LLM_PROFILES`」的写法会让人误判为从零建。裁定三条：① T9 的**真实增量只有四件**——FE 页 `#/admin/llm`（`public/app.js` 内 `admin/llm` 实测**零命中**）、`LLM_PROFILES` 多 profile、连通性探针端点、`llm_calls` 用量表 + `llm.degrade`/`prompt.<skill>.v<n>` 两个 settings 键（后两者在 `server.js`/`agent.js` 实测**均不存在**）；② **`config.json` 必须保持单一写者**——profiles 的写入须扩到既有那条 read-modify-write 路径（或复用同一 helper），**禁止**新开第二个直接 `fs.writeFileSync(CFG, …)` 的端点：两个 admin 写者并发就是丢更新竞态，且正是历史上「整文件重写吞掉 `REPORT_SECRET`」那类事故的入口；③ 既有掩码契约不得削弱——新增 profile 的 key 同样只回 `*_MASKED`，任何 GET/列表端点回明文 key 一律视为缺陷 | 派发前的实测把 P1 的估计工作量从「新建一个中心」修正为「扩展一个已有端点 + 补 FE 页 + 加观测」，避免 T9 去重复实现一份与 `/api/admin/config` 打架的写者；也与 D-19 同源教训一致——**改配置面/收权限面前必须先 grep 现成落点**，否则新旧两条写路径会长期并存，而竞态只在并发时暴露、收工门里看不见 |

| **D-44** | **机器人/通知面的实测现状与「唯一真源」裁定（T10 前置）**：现网通知层为 `createNotify(deps)`（`notify.js:34`），四条事实决定 T10 的边界——① webhook 地址**每次发送时从 `config.json` 读**（`:47`、`:55`），键名 `NOTIFY_WEBHOOK_URL` / `COMMITTEE_WEBHOOK_URL`，channel 只有 `notify` / `committee` 两值，未配置即**静默跳过**（`:56`）；② 失败重试 1 次后 `console.error`，**永不阻断主流程**（N-02 铁律，`:10`）；③ 周期去重靠 settings 的 `last_weekly_sent` / `last_xo_push`（`:89`、`:106`）；④ 出站走 `spawn('curl', [参数数组])`（`:21`，不经 shell，故无 shell 注入面，但 URL 值本身是参数面）。真实事件枚举（基准构建 `76edbf3`；行号只作导航，动手前按内容锚 `notifySafe(` 重定位，D-36）= `server.js` 的六个 `notifySafe` 调用点：**红灯自动打回 `:673` / 研判完成 `:677` / 前置评审任务分发 `:1754` / 评审结论·绿灯发布 `:1782` / 评审归档 `:1835` / 评审单被退回 `:1921`**，另加 weekly 与 XO 两类定时。裁定：⑴ `notify_matrix.event` 列**必须取上述实名**，禁止新造事件名（造了就等于矩阵与真实发送点脱钩，矩阵永远命中不上）；⑵ T10 的 `robot_instances` 表与 `config.json` 两条 webhook 键构成**双写源** ⇒ 定 **DB 表为唯一真源**，`config.json` 键降为「迁移前 fallback + 只读展示」，且迁移**一次性完成**、不留长期并存的两条读路径（与 D-43 单一写者原则同源）；⑶ 任何改动**不得削弱 N-02**（通知失败永不阻断）与「未配置静默跳过」——把「未配置」改成报错就是让评审主流程被外部 IM 拖死；⑷ 管理端点写入的 URL 必须校验协议（仅 `http`/`https`）并拒绝以 `-` 开头的值（curl 参数面），`secret` 沿用 `maskKey` 掩码契约（D-43 ③ 同源） | 与 T9 同一教训的第二例：§6.2 原文按「从零建机器人中心」写，实测通知链路早已存在且带三条不可回退的行为契约（静默跳过 / 永不阻断 / 去重标记）。不把这些实测事实钉进任务，T10 实现者要么重复造一套并行通知路径（两条路径同时命中 = 群消息重复），要么为了「管理可见」把静默跳过改成报错，直接在收工门之外埋下主流程被外部服务拖死的事故 |
| **D-45** | **8600 服务进程不属于任何会话的生命周期，故「服务在线」必须作为开工第 0 步实测**：T6 实施线在 20:46 前后转 `cold`，现场核查证明**不是代码问题**——`public/app.js` 与 `tests/h_ia_shots.js` 的未提交改动 `--check` 全通过、`tests/green_ia_v4.txt`（20:48）**26 passed, 0 failed** 且含 IA-8b 与 IA-15~20，红件与旧代码基线都在场；真实根因是 `GET /api/me` 连不上、`netstat` 查 `:8600` **零监听** ⇒ 收工门依赖的那个常驻进程先于会话死亡，后续套件无从执行。此前所有派发词只写「FE 任务默认不需要重启服务」，**从未要求先证明端口在线**，等于把一个不属于任何会话的共享依赖当成永远在。裁定：① 每个实施会话**开工第 0 步**执行 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8600/api/me`，**401 才算在线**；非 401 则自行起服务并记**新日志名** `server_t<N>b.log`，报告里写明「接手时端口不在线」。② **禁止**复用或覆盖任何既有 `server_*.log`（它们是他线留证）。③ **禁止**为了腾出端口 kill 不认识的 PID——先 `netstat -ano` + `tasklist` 辨归属，认不出就上报总线；起第二个实例必须能解释 `EADDRINUSE`。④ 总线侧在实施线 stall 时**可以代为拉起**该共享进程（属基础设施、不改任何源码、不动任何会话文件），并在通报里写明 PID 与自己不承担其生命周期。已把 ①②③ 写进 `task-7-dispatch.md` / `task-8-dispatch.md` 的「开工第 0 步」 | 这类故障的代价不对称：代码无损、证据齐备，却因为一个没人负责的外部进程死掉，让整个任务在收工门前停摆两小时，而会话本身会把它记成「我的改动跑不通」。把「共享常驻依赖的存活」写成可实测的第 0 步，是唯一能让每条线自己发现它的手段——`--check` 与套件绿都不证明端口活着 |
| **D-46** | **验收构建的文件面必须等于跑绿的文件面：T6 提交面裁定为三件**（`public/app.js` + `public/style.css` + `tests/h_ia_shots.js`）。实施会话反驳总线恢复令里「只 add 两件」的表述，实测 `git status` 确有 `M public/style.css`、`git diff --stat` 为 **+15 行**纯新增（`.chain-dot/.chain-row/.chain-mini/.cd-go/.cd-no/.cd-ok/.cd-txt`，未改任何既有规则），且 `task-6-brief.md:18` 逐字写「改动文件恰为三个」、`:348` 有 §3i 专节。⇒ 恢复令那句是总线把派发词的简写抬进正文造成的**派发缺陷**。**裁定依据不是简报措辞而是构建身份**：IA 26/0、NAV 12/0、UI 9/0 与服务端八套全部在**带 CSS 的工作区**上跑绿，只提两件会造出一个**从未被任何验收覆盖的 HEAD**（结构在、排版塌），比多提一个文件严重得多 | 这是 D-35 S-5「验收构建只认 git 内容等价、不认 PID」的对称面：那条管**运行时**与提交等价，本条管**提交面**与跑绿面等价；两侧任一对不上，「全绿」就变成对一份不存在的代码的背书。同时确立一条流程规范：**派发词/恢复令里凡出现「只 add X」类枚举，必须与简报的「改动文件恰为 N 个」清单逐字对齐后再发，且优先引用简报行号而非凭记忆重述**——本条之所以能被实施会话拦下，是因为它刚好去核了简报；若它照抄恢复令，缺陷会静默进入 T8 之后 |
| **D-47** | **T6 报告 §8 前三条的处置：`confirmed ≠ 只读` 在行内输入格上还剩半个洞，且文本格会静默丢字段**（基准 `9ac0c07`）。① `opdlvRender()` 的行内 `input` 仍写 `${OPDLV.locked ? 'disabled' : ''}` ⇒ 四个按钮按 D-32 放开了，**输入格却还锁着**；② `content`/`note` 无 `oninput`，只有数字格的 `opdlvRowCost(i)` 变化时才把整行回写 `OPDLV` ⇒ 用户**只改文本不改数字就丢该文本**。③ `opdlvSave()` 不重绘 ① 卡头 ⇒ 保存后 pill 滞后。裁定：①② 必修（① 行内输入不受 `locked` 影响、写权限只由服务端四项角色裁决；② 文本格补 `oninput` 只回写自身键、不触发成本重算），并**各补一条断言**（confirmed 态 `#opdlvTable input.isDisabled()` 全 false；改 `content`→保存→GET 明细读回相等），IA 末行由 26 → 28 属预期；③ 保持现状但加一行注释说明「保存后以服务端为准」，**禁止**为此在前端自算状态（违 D-25） | ①② 都是**验收面自己没长眼睛**的产物：D-32 当初只裁定到按钮粒度，于是 IA-8b 也只断言四个按钮——26/0 全绿却照不出输入格仍被锁、文本改了不生效。这与 D-41（`reviewing` 态无断言）、C2-07（`rate` 分支空转）是同型第三次：一条规则的可测面必须由该规则的**完整粒度**决定，而不是由实现方便的程度决定。规范补一句：**裁定写成「X 仍可点/仍可改」时，用例要枚举该动作涉及的全部控件层（按钮、输入格、下拉、拖放区），逐层断言，缺一层即视为未覆盖**。执行落点授权给 T7 作为其独立第一个提交（同文件、同构建身份，避免再造一轮串行等待），总线复跑验证 |
| **D-48** | **派发前必须先枚举工作区内所有非总线会话的状态；跨任务「顺带修 X」的授权一律作废**（编排事故 2 的产物，23:39）。事实：我把 D-47 授权给 T7 作为其第一个提交，而未察觉 `95632cbf`（原 T6 线，20:46 因 8600 进程死亡转 cold）在收到 D-46 答复后**已经恢复并自行实现了 D-47**——`app.js` mtime 23:31、`h_ia_shots.js` 23:35、diff 内 `D-47` 两处。T7 检测到「非己方未提交 hunk」后**主动交 BLOCKED、对仓库写入量为 0**，这是正确行为。由于 `git add` 是文件级，若 T7 继续提交就会把别线的 hunk 算进自己的归属。裁定：D-47 归 `95632cbf` 提交（**提交归属跟着作者走**，落为 `9787c97`：`app.js` +14/−5、`h_ia_shots.js` +25/−0、未删任何既有断言，实施线两份绿件 `green_ia_v4f/v4g.txt` 均 **28 passed, 0 failed**，且 `IA-21~26` 命中 0 证明未越界），T7 以新 HEAD 重取前置门后只做向导主体 | 两条可复用的规范：① **派发前置检查**——向该工作区派任何会话之前，必须先 `list_chat_sessions` 看**所有**非总线会话的状态，只要有 `running` 且改动面与本次重叠就不派，先仲裁归属；我只查了「报告件在不在」就判定 `95632cbf` 永久死锁，把「没有产出」当成「没有运行」，这是**状态误判**（`cold` 不等于完成，`waiting-user` 也不等于永久）。② **禁止跨任务顺带授权**——「你顺便把上一个任务的 X 修了再提」会让一次提交承担两个任务的归属与验收，正确形式是 X 由其原作者线提交、后续任务以新 HEAD 起算。附带方法论：我给 T7 的开工令里写「IA 末行已升至 28」是**推算**，随后总线自查发现当时并无新绿件、继而才在 `green_ia_v4f.txt` 实测到 28 ⇒ 已通过门只认 `0 failed`，历史数字只能作参考基线，**低于基线才叫回归** |
| **D-49** | **收工门排序：T8 不等 D-41 的 C2-04b**（23:48）。冲突：两者都要占 `data/review.db`，串行到底会让收工门多等一整轮；但先跑 T8 则注册进去的 C2 是 23 条而非 24 条。裁定依据是 23:45 的只读预检而非便利：`tests/test_opp360.js` 的**写入全部落在自建码** `PL-T5-<n>`（`mkOpp` `:57`、`dlvPut` `:60`），锚定码 `PL00008572` 只在 `:91/:160` 等处**只读**，且 C2-06/07 的断言形态是「两端相等」（同一时刻分别读 360 与明细端点）而非「等于历史快照值」⇒ **新增一条 C2-04b 不改变其余 23 条的通过性，也不改变任何其它套件的行为**。据此：① T8 按当时**实测**条数注册并跑全量门，报告写明「门内 C2 计数 = 实测值，未含 D-41」；② D-41 落地后只需复跑 C2 一套并刷新 `green_run_v4_meta.txt` 的 C2 行 + 台账记一次增量，**不重跑全量门**；③ 若 C2-04b 复跑出现**非新增条目**翻红，则本裁定前提被证伪 ⇒ **必须重跑全量门**（风险敞口显式写明，不隐藏） | 这是「不缩减范围只调排序」的标准处理：C2-04b 仍在任务清单内待执行，收工门的定义（全部注册套件 PASS、一个不能少、不得调序/剔除/`--grep` 掩盖）不因排序而放宽。同时给出一个可复用的判据：**要判断两条测试能否并行或错序，看它的断言是「相等式（自洽于当前数据）」还是「快照式（钉死历史值）」**——前者对顺序不敏感，后者敏感 |
| **D-50** | **报告与台账同样受「文件级写入互斥」约束；接管会话必须与原审会话二选一，或产物强制分名**（编排事故 3，23:50）。事实：`95632cbf`（T6 原实施线）在收到 D-46 后已恢复并按恢复令写好自己的 `task-6-report.md`，而我因先前把它误判为「永久死锁」又派了收尾会话 `a10d11e3` 去写**同一路径**——它 23:21 的写入把原会话 23:24 前的版本**整份覆盖**；`.superpowers/` 被 gitignore，无版本控制可回溯，该损失不可恢复（原会话其后重写并扩充，现 453 行含 §12 收尾轮与 §13 D-47 轮两段）。裁定三条：① 派接管/收尾会话前必须实测「原会话是否仍在运行或将写同一产物」（`list_chat_sessions` + 产物 mtime），不能只看产物在不在；② 若确需并行，**非代码产物强制分名**（如 `task-6-report-closeout.md`），由总线负责合并；③ 「`git add` 是文件级，他人 hunk 在场只能 BLOCKED」这条既有规范**同样适用于写报告**——写入的粒度是文件，不是段落。附带采纳：`95632cbf` 主动把 D-47 的修正扩到 `stage` 下拉（我字面只点 `content`/`note`），因为它是同一 `opdlvRender` 表达式里同型的第三个非数字控件——按 D-47 自立的「枚举该动作涉及的全部控件层」规范，**扩面才是合规，守字面反而不合规**；另其 §13f 主动推翻自己 §12 的「已让出 review.db」（承认 23:29–23:41 为落地 D-47 再次占库）属正确更正，总线此前据此做的「无并发」判断需相应打折 | 这条与 D-42（证据按可再生性分级）、D-48（派发前枚举会话）同源：**总线的可见性判断不能建立在「有没有文件」上，而要建立在「谁正在写、写哪条路径」上**。此前我把三次事故分别记成陈旧数字、跨任务授权、误判停摆，根其实是一个：把「产物缺失」当作「会话停滞」的证据。规范收敛为一句——**判定停滞只看会话状态与写入者，不看产物存在性** |
| **D-51** | **任务必然改变既有断言的期望值时允许改，但要满足三项留证；缺任一项按「凑绿」退回**（T7 实例，23:56）。事实：D-16 要求入口文案改为「新建待评审商机」，于是钉住旧文案的 `NAV-10 sales1 三项(首页/我的商机/新商机)` 与 `NAV-12 财务BP 四项(含待办打灯)` 必然翻红。实施线做法：`_t7_post_nav_red` **10 passed / 2 failed** → 改期望文本 → `_t7_post_nav_green` **12 passed / 0 failed**，另有 `_t7_post_wizard_green` **34/0**（= 28 基线 + IA-21~26 六条，条数自洽）与 CH 45/0。总线判为**合法**，三条判据同时成立：① **变更方向由上游裁定强制**（保持断言不变＝放弃需求，二者只能选一时以裁定为准）；② **先红后绿且两份件都留**（路径可审计，非静默改写）；③ **只换期望值、不减断言强度**（仍是实得数组逐项相等；若改成 `includes('商机')` 或整条删除即属凑绿）。 | 这条把一直沿用的「绝不改既有断言凑绿」补上唯一缺失的边界：**该禁令针对的是「为了让门变绿而弱化判据」，不是「凡改动既有断言即违规」**。上游裁定改变了被断言的行为时，断言必须同步改，否则回归会把正确的实现判成错误。三条判据的意义在于把「不得不改」与「改松一点」区分开——前者只替换期望文本且留红件，后者往往表现为删除断言或放宽比较。 |
| **D-52** | **凭据解析必须收敛到 `resolveLlm` 单一入口，且非 http(s) 的 base 须在写入侧就被拒绝**（T9 §6 复查，00:40）。事实：T9 立了 `resolveLlm`（`server.js:466`）并收敛了技能①②④与探针四处，但 `POST /api/llm/fill-budget`（`:2358`）在 `:2364-2365` 仍自抄一遍 `process.env.LLM_BASE_URL || fileCfg.LLM_BASE_URL || …ANTHROPIC_*`，因此不吃 `LLM_PROFILES.budget`、不吃 `llm.degrade`、**不落 `llm_calls`** ⇒ 管理中心的「近 7 日用量」少一条真实路径，且 profile 路由对这条端点无效，与 T9 自立的单一入口直接冲突。另一半：写侧 `POST /api/admin/config`（`:2034`）把顶层 `LLM_BASE_URL` 原样落盘，而 `:2079` 探针处注释自陈「顶层 LLM_BASE_URL 写入未校验，防 `-` 开头被 curl 当选项」——**校验只做在读侧展示，写侧仍能落进非法值**。出站 HTTP 一律 `spawn('curl')` 且 base 落在 curl 的参数面，故防线必须以写侧为唯一真源：`trim()` 后须匹配 `/^https?:\/\//i`（同时天然排除 `-` 开头），拒绝整个请求、不写文件、不回显敏感提交值；读侧那道降级为纵深防御。 | 单一入口的价值在于「只有一处能被改坏」；留一条自抄解析就等于留一条口径漂移通道。这与 D-43（`config.json` 只允许一个写者）、T11 的 `createOpp` 上提为模块级唯一裁判是同一条纪律的三个侧面：**校验/解析/建档都必须有唯一裁判，且裁判必须站在写入侧**。处置见 `task-14-brief.md`（新增 LM-15~20：profile 路由生效、`llm_calls` 落行、失败仍 HTTP 200、非法 base 被拒且 `config.json` 逐字节未变）。 |
| **D-53** | **管理中心的完成判定必须包含浏览器层；只有 API 套件绿的 UI 交付物记「后端已验、前端待验」，不计入完成**（T10 §9/§10 复查，00:52）。事实：`#/admin/llm` 与 `#/admin/robot` 自落地起从未在浏览器中打开过，验证只有 `--check` 语法与 LM/RB 的 HTTP 端到端；V4.0 既有浏览器层（HL/NAV/IA）全部以业务用户身份跑，不覆盖 admin 页。而管理中心本身就是 UI 交付物——接口 200 与「六卡能渲染、掩码不泄露明文、探针按钮存在、矩阵每事件一行、控制台不抛错」是五件不同的事。裁定：补 `tests/h_admin_shots.js`（AD-01~），至少覆盖 admin 登录门、**明文 key 红线**（读 `config.json` 的真实密钥值作比对、只打印命中与长度、密钥值永不入日志）、掩码可见、`#/settings` 重定向、导航可达、矩阵事件行数、实例空态不白屏、探针请求发出（不要求探针成功）、**console.error/pageerror 均为空**、截图留证（PNG 不入 git）；在其转绿前 P1 这两件不计入 V4.0 完成。 | 「接口绿 ≠ 界面可用」在本项目有历史教训（`h_manual_check` 曾在 HEAD 上因路径缺陷首跑即红）。把 UI 交付物的验收只交给 HTTP 套件，等于把渲染期异常、掩码误用、路由不可达三类缺陷排除在门外——而这三类恰好只有浏览器能照出来。处置见 `task-13-brief.md`；AD-02/AD-09 两条是该套件存在理由，收工时总线要逐条核其实质而非看条数。 |
| **D-54** | **全量门里阈值/耗时类断言变红：分类先于复跑，且绝不放宽阈值、剔除或调序套件；门红期间禁止提交**（T12 实例，01:35）。事实：T12 注册三套后首轮门 **27/28**，唯一红为 `EI-09 单次导入耗时<4s | 4482ms`，而该断言文案本身带「python 启动+机器负载波动」括注；本轮门耗时 498.2s 对 T8 基线 440.9s，负载明显高于基线。裁定处置序：单跑该套三次并**逐次记录 ms**（`tests/_t12_ei_retry.txt`：2484/2890/2893，另附裁定前 2401）→ 有 <4000ms 的绿即判环境型负载红 → 静默机器后重跑全量门取 **28/28**（实得 464.0s，EI-09 3248ms PASS）；若三次全部超阈，判为真实性能退化，**停下上报总线**，不得提交、不得改口径。首轮 27/28 日志留在 `tests/_t12_gate_run1_27of28.txt` 但不入库。 | 这条与 D-39（`database is locked` = 环境型红）同族但不等价：D-39 处理的是「断言逻辑没问题但数据库被并发锁」，本条处理的是「断言本身是性能阈值、天然贴着边界」。把「负载波动」写成「阈值不合理」是错误归因；先把证据分类（三次 ms + 基线对照），再决定动作。阈值只能在有独立性能证据且经总线裁定的前提下改，永远不能在门红的同一轮里由实施线自己改。 |
| **D-55** | **跑证据级全量门之前，必须实测「工作区静默」：8600 监听 PID 在两次间隔 ≥30s 的采样里不变，且无实施线仍在跑套件或将要重启服务**（总线自违规，02:39）。事实：总线在 T14 提交 `c3e4c52` 后 30 多秒起门，得 **`12/29 … SOME FAIL`**（22 条红），纯函数带全绿、自「A 对话流」起级联 `FAIL - … 流程异常:fetch failed`，门后实测监听 PID 由 **67712 → 70436**；对照 T14 转录（「按 T9/T10/T11 既定做法……停掉 PID 41032，起 `server_t14.log`」，其后为落地 `52f5494` **再次重启**）⇒ 门正好跨在实施线「停→起」的瞬间，**整段 HTTP 带是服务不可达造成的假红，而非回归**（304s 对基线 522s 亦自洽）。裁定四条：① 门前置三件套＝目标实施线报告已收口且无待重启改动 + PID 双采样相同 + `GET /api/me` 返 401；② 门红后**先归因再决定复跑**（查 PID/健康/转录时刻），不得直接复跑掩盖，也不得把污染跑次当证据；③ 长跑套件**不要接 `\| tail` 管道**——Git Bash 在长输出上会以 `0xC0000005` 崩溃且 `--log` 证据不落盘（总线与 T14 各中招一次），改 `> /dev/null 2>&1` 后读文件；④ 辅助脚本的 **ABORT/告警分支绝不写被跟踪的证据文件**，另落独立文件（总线的升格脚本曾因 ABORT 分支覆盖 `green_run_v4_meta.txt`，靠 `git checkout --` 还原）。 | 根因与 D-48/D-50 同一个：**总线的可见性判断不能建立在「产物在不在」上，要建立在「谁正在写、谁正在重启共享运行时」上**。8600 与 `data/review.db` 都是单例资源，一个会话为落地改动而重启服务，就等于把所有并发读者变成假红读者。附带采纳的「不污染证据」两条与本条同源：证据文件的写入者必须唯一，且失败路径不得留下误导性内容——本条之后，门绿与否的判定权在脚本守卫（末行不含 ALL PASS 即拒绝升格），不在人的自觉。 |
| **D-56** | **新增写侧校验后，必须在「干净 config」下重跑既有套件；单套自跑绿不等于门绿**（T14 实例，02:50）。事实：T14 把顶层与 profile 的 base 校验收进唯一裁判 `llmBaseErr`（`server.js:466`，调用点 `:2040` 顶层写 / `:2054` profile 写 / `:2089` 读侧探针），自报 LM **51/0**；总线在无并发的最终 HEAD `52f5494` 上跑门得 LM **50/1**，且**单跑同样红**：`FAIL - LM-03 写 profile 200 后 config.json 可 parse、四键在场且值未被吞 \| status=400`。差异成因：实施线那次绿跑里 `config.json` 已被自家新增 LM-15~20 的桩改写过，LM-03 提交的 base 恰好落在被允许的形态；门内从干净 config 起跑才暴露过度收紧——**该拒的应当是「显式提交的非 http(s) 值」，而不是「缺省/空串表示的不修改」**。裁定：① 校验器落地要保留「未提供＝不改」的语义，空值/缺省走原路径，不得因「值为空」判非法；② 写侧校验改动完成后，必须补一条钉空值语义的断言（本项目为 LM-21）并**在干净 config 下重跑受影响的全部既有套件**，自跑绿件与门绿件都留档；③ 复现红必须是「门内也红、单跑也红」两证齐，才允许判定为真回归（否则按 D-55 先归因并发污染）。 | 这是 D-41（条件断言要有命中该分支的夹具）与 D-46（提交面=跑绿面）的合流点：**测试环境的初始状态本身就是夹具的一部分**。自跑时前序用例改了全局 config，等于给后来的既有用例换了一套输入——绿得可疑，红得迟来。规范收敛为一句：**校验类改动要在干净态重跑，且要用一条正向断言把「不修改」语义钉住**，否则收紧会静默吃掉既有能力。 |
## §8 测试与验收（收工门）

**新增/改造套件**（均先红后绿留档）：
- `OP-*` 商机档案：建/重码 409/缺要素 400 列表/回填幂等计数/归档翻转 reviewed。
- `DL-*` 商机级交付预算：CRUD/导入/空行确认 400/修订回 draft/迁移对账（存量 budget_delivery 行数 ≡ 迁移后 opp_delivery 数）。
- `CH-*` 三步链：bid/presale/change ×（缺①/①draft/①confirmed 缺②/②locked 缺③/链全齐）六态 + 历史绕过数据二次核验 + 一行回退开关用例。
- `RQ-*` 必填注册表：REQUIRED 单源 + FE≡BE 对账 + 四处消费路径同源。

**收工门注册口径（D-26，实测）**：四套 V4.0 套件的真实文件名是 `tests/test_opp_api.js`(OP-01~14，末行 24 断言)、`tests/test_delivery_opp.js`(DL-01~23)、`tests/test_chain.js`(CH-01~16b，末行 45 断言)、`tests/test_required.js`(RQ-01~10)——早期简报里的 `test_chain_gate.js`/`test_required_registry.js` 是命名预设，从未落地。**`run_all.js` 现 20 项中不含这四套**，T8 是它们第一次在全量门上下文运行（共享 `data/review.db` 与套件顺序可能暴露独立跑看不到的红），翻红一律 BLOCKED 上报，禁止调顺序/剔除/加过滤来掩盖。套数一律以 `SUITES` 实测项数写入 `green_run_v4_meta.txt`，不沿用推算值。
- `360-*` 契约：响应追加键 + chain.next_action 推导体。
- 浏览器层：IA-7 页签新文案红绿；向导「新建待评审商机」+ 链路卡红显断言；NAV 防回归。
- 既有套件同批更新：D-01~08（门禁语义变化）、T3（口径变化）、IA 全量断言锚。
- **收工门 = run_all 全绿**（套件数从 20 增至 25±，以 `tests/run_all.js` 实测为准）+ 锚定值（pl8572 六组/tiandi 十项）不动。**锚定值归属实名（D-38 吸收 T4 §10.5，`grep -l` 实测）**：`pl8572.json` 的消费方是 `test_excel_import.js`、`test_finance.js`、`test_opp_thread.js`、`test_parser_lab.js`、`test_roundtrip.js`；`tiandi.json` 的消费方是 `test_agent_chat.js`、`test_budget_api.js`、`test_finance.js`、`test_roundtrip.js`；`data_feasibility_check.js` 锚的是 `c02_08068` / `c03_08111` **判例**而非上述两件。后来者找锚定值请按实名套件定位，勿跑到判例套件上找 pl8572。

**P0 验收对照 V4.0 §14**：链三态逐态正确 / 页签七项新序 + 旧 t 不死 / 待评审商机要素齐全继承 / 注册表零漂移 / （P1 后）LLM+机器人管理可用 / run_all 全绿。

---

## §9 分期与任务映射（详表见 plans/2026-10-14-review-flow-v4.md）

- **P0**（本 spec §1~§5,§8）：T1 数据模型与迁移 → T2 商机级交付预算端点 → T3 三步链门禁 → T4 必填注册表合一 → T5 360 端点扩展 → T6 页签重构 → T7 新建向导语义 → T8 列表/首页链路列 + 原子切换全回归。
- **P1**：LLM 管理中心、机器人实例+矩阵+白名单、对话式建档、打灯矩阵聚合视图。**任务已定形**——见 `plans/2026-10-14-review-flow-v4.md` §P1 任务表（T9 LLM 管理 / T10 机器人管理 / T11 对话式建档+聚合视图，各带落地面、收工门套件、专属红线），**串行接在 P0 收工门之后**。用户口径明确「LLM 管理中心与机器人管理中心必须补齐」⇒ P1 不是可选尾巴，不得以「P0 已收工」当作 V4.0 完成；三套新套件须同批注册进 `run_all.js`（D-26 / D-39 ②）。**P1 的完成判据不止「代码落地 + API 套件绿」**：① 三套必须在全量门内真跑（T12，SUITES 实测计数为准）；② 两个管理中心必须有浏览器层套件（T13 / **D-53**，AD 系列含明文 key 红线与 console/pageerror 零错误），在其转绿前记「后端已验、前端待验」；③ 凭据单一入口不得留自抄解析、非法 base 必须在写入侧被拒（T14 / **D-52**）。三者齐备方可写 V4.0 完成。
- **P2**：数据分析页签（商机级+漏斗）、机器人会话/监控、FE 动态字段渲染（消费 /api/meta/fields）。
