# 前端 IA 重设计 · 商机中枢式（2026-10-14）

> 状态：设计已获用户批准（方案 A），本文为实施前唯一权威 spec。
> 关联：`docs/产品方案.md` V3.0（五模块 IA + 商机代码主键）；本 spec 是其前端落地形态的收口与修正。

## 0. 背景与第一性原理诊断

用户判定前端"非常混乱"，要求第一性原理重审。平台业务本质一句话：**一个商机（opp_code），走完 信息收集 → 多部门前置打灯 → 红黄绿结论 → 归档**。业务主线是商机代码，工作主体是三类角色（申请人/部门BP/支持组+admin）。

当前前端的组织逻辑是**按"系统有什么"摆页面**，而非按"业务怎么走"聚合。六个实测根因（行号以 2026-10-14 HEAD 为准）：

| # | 症状 | 根因 |
|---|---|---|
| 1 | 11 个导航项分 5 组平铺（app.js renderShell:148-169） | 按模块罗列，用户要自己猜"我的事在哪页" |
| 2 | 工作台(renderDashboard:301)、评审单页(renderReviewsList:1549)、商机总览(renderOpps:1475) 三处渲染评审列表 | 同一实体三种呈现，每种都不完整 |
| 3 | 销售发起评审 4 扇门：智能体/新建评审单/Excel 导入/商机总览 | 入口按填单方式分，不按业务动作分 |
| 4 | 智能体页一页三职：对话窗+预算编辑器(renderAgentPreview:1204)+评审表编辑器(renderAgentReview:1063) | 对话优先的定位混入表单编辑 |
| 5 | 工作台 vs 评审单页、研判台 vs 评审单页重复表格/筛选/卡片 | 视图重复实现，从不收敛 |
| 6 | opp_code 主键只在商机总览列表体现 | 主键活在列表里，没活在工作目的地 |

**解法（方案 A·商机中枢式）**：导航按角色压到 4~6 项；商机 360° 页成为唯一工作目的地；四扇门收敛为一个向导；重复页面吸收合并。既有的"单机器人三技能、对话窗优先"决策保留——对话窗在 360° 页内是一等席位。

## 1. 目标与非目标

**目标**
1. 五角色导航各 4~6 项，扁平无分组。
2. `#/opp/:code` 商机 360° 页落地：七标签一页到底。
3. 发起评审的 4 个入口收敛为 `#/new` 一个向导（三种编制方式）。
4. 消除三处评审列表、智能体页三职、工作台双表。
5. 旧深链不死（#/reviews、#/budgets 重定向；#/agent 深链功能保留）。
6. 红绿测试闭环：新用例先红后绿，全回归 20 套 ALL PASS。

**非目标（明确不做）**
- 不建 opps 表：商机仍是 reviews/budgets 按 opp_code 的**派生聚合**（YAGNI）。
- 不改数据库 schema：opp_code 列/索引/JSON 回填已存在（server.js:137-141），OC-01~06 套件已覆盖——V3.0 P1 的"预算挂靠键回填"实际已完成，本次服务端仅剩 360 聚合端点。
- 不动判灯/财务引擎/LLM 边界/通知链路。
- V3.0 P2（权限管理页/机器人对接页/BI 商机维度）不在本次范围。
- 不引入任何 npm 包、框架、构建步骤（零依赖红线）。

## 2. 目标态 IA

### 2.1 角色导航矩阵（新 nav，扁平、无 .nav-group 分组 div）

| 角色 | 导航项（文本 → hash） |
|---|---|
| 销售经理 / 项目经理 | 首页(#/) · 我的商机(#/opps) · 新商机(#/new) |
| 财务BP | 首页 · 我的商机 · 新商机 · 待办打灯(#/tasks) |
| FDE / 采购BP / 法务 / 合规BP / 数据BP | 首页 · 待办打灯 |
| 销售支持组 | 首页 · 全部商机(#/opps) · 待办打灯 · 研判台(#/judge) · 归档库(#/archive) · 解析器实验室(#/parser-lab) |
| admin | 同支持组 + LLM 设置(#/settings) |

约定：
- "我的商机/全部商机"同一路由 `#/opps`，按角色取数（销售/PM=我的，支持组/admin=全部）。
- **归档库文本保留不动**（h_flicker.js 以 `.sidebar nav a.on` textContent 断言归档库）。
- 新导航文案避开既有测试锚点子串歧义：如"我的商机"不含"商机总览"子串（新"商机总览"导航项不存在，NAV 旧断言同批退役）。
- .nav-group CSS 类保留在 style.css（无害），DOM 不再输出分组 div。

### 2.2 页面映射（旧 → 新）

| 旧页面（app.js 函数） | 去向 |
|---|---|
| 工作台 renderDashboard(301) | 重写为**首页 renderHome**：我的待办队列 + 指标卡 + 灯色分布/sparkline（组件复用） |
| 商机总览 renderOpps(1475) | 重写为**商机列表 renderOppsList**（#/opps）：角色取数 + 搜索 + 行点击 → `#/opp/:code`；展开单据链保留为辅助 |

**renderOppsList 取数口径**（消除歧义）：reviews 走 `/api/reviews?scope=mine`（销售/PM）或 `scope=all`（支持组/admin）；budgets 走 `/api/budget`，仅在"商机组内"按 opp_code 匹配追加展示——即销售只看到自己 reviews 挂靠的商机下的预算单（只读，写操作鉴权不变）。
| 评审单 renderReviewsList(1549) | 路由撤销，`#/reviews` 重定向 → `#/opps`；列表内容由 360°"评审表"标签承接 |
| 预算单 renderBudgets(1426) | 导航摘除、**路由保留**（版本链与 Excel 导入建预算单的深链家；h_manual H-05、h_adv ADV-XSS2、h_ui 截图以其为落点，零测试改动）；预算列表另活在 360°"预算"标签；`#/budget/:id` 详情页保留 |
| 新建 renderForm(369) | `#/new` 保留，类型选择页改版为**新商机向导**；提交成功后跳 `#/opp/:code` |
| 智能体 renderAgent 家族(851/894/1046/1063) | **导航摘除但路由保留**（?b=/?r= 深链不死）；对话组件容器参数化，360°"对话"标签内嵌；向导"对话式编制"入口 → #/agent |
| 我的前置任务 renderTasksCenter(1583) | 保留，导航文本改"待办打灯" |
| 研判与结论 renderJudgeBoard(1616) | 保留，导航文本改"研判台" |
| 归档库 renderArchive(1920) | 保留（文本不动） |
| LLM 设置 / 解析器实验室 | 保留不动 |
| #/review/:id、#/budget/:id、#/delivery/:bid | 保留（辐条页），页头加"所属商机 →"链回 360° |

### 2.3 商机 360°（新页 `#/opp/:code`）

- **路由**：`#/opp/CODE?t=tab`，tab ∈ overview|budget|review|light|judge|chat|archive，默认 overview。renderRoute 新增 `h.startsWith('#/opp/')` 分支——与 `#/opps` 无前缀冲突（'#/opp/X' 不以 '#/opps' 开头）。
- **七标签**：
  1. **概览**：项目名/类型/状态时间线（draft→reviewing→judged→archived）/灯色分布条(lightDistBar 复用)/关键指标卡(metric-tile 复用)。
  2. **预算**：该商机的 budgets 列表（复用 oppExpandHtml 预算表结构）+ 详情/对话链接。
  3. **评审表**：该商机的 reviews 列表 + 状态/灯态/轮次 + 操作（编辑草稿→#/new/:type、查看→#/review/:id）。深度编辑保留全屏辐条页，不在标签内塞完整编辑器。
  4. **前置灯态**：该商机的 tasks 行（含部门/评判指标/轮次）+ 打灯按钮（openTask 复用，仅对应部门角色与支持组/admin 显示）。
  5. **结论**：judged 单的 decision_result/judge_detail 研判卡 + 结论录入/触发研判入口（仅支持组/admin，复用既有端点）。
  6. **对话**：对话目标选择器（该商机的预算单/评审单 chips）+ 内嵌对话组件。renderAgent/renderAgentReview 改造为接受容器参数（默认 '#page'，兼容 #/agent 旧深链），技能①②在窗内切换，上下文锁定该商机。
  7. **归档**：archived 单（含 era=history）快照 + 链到 #/archive 该商机过滤。
- **数据源**：单次 `GET /api/opp/:code/360`（见 §3）。
- **空态**：404 → "该商机不存在或已被清理" + 新商机入口按钮。
- **工程防线**：整页慢页竞态守卫（h0 模式）；所有插值 esc()；onclick 参数用安全码（`String(code).replace(/[^A-Za-z0-9_-]/g,'_')`，展示保留原码）；内联 onclick 调用的函数保持全局作用域；navHighlight 对 `#/opp/` 及 `#/review/:id`、`#/budget/:id` 高亮"我的商机/全部商机"导航项（父入口归属感）。

### 2.4 首页 renderHome（替代 renderDashboard）

- **我的待办**一条合并队列（按角色取数，全部复用既有 API，服务端零改动）：
  - 销售/PM：`/api/reviews?scope=mine` 的 draft/returned 单（补齐/修改入口）；
  - 部门BP（含财务BP）：`/api/tasks?scope=mine` 的 pending 任务（打灯按钮直达 openTask）；
  - 支持组/admin：`/api/reviews?scope=all` 的 reviewing（待研判）+ judged 黄灯（跳研判台）。
- **指标卡**：复用 metric-grid/metric-tile/lightDistBar/sparklineSVG 组件（renderDashboard 现有实现迁移）。
- **快捷入口**按角色：新商机 / 去打灯 / 去研判。
- 原"我的评审单/全部评审单"两表**删除**（根因 #2 消除）。

### 2.5 新商机向导（#/new 改版）

- 类型选择页（renderForm 无 type 分支）改版：**三种编制方式**并排呈现——① 对话式编制（→#/agent 技能① / #/agent?r=pick 技能②）② 表单式编制（→现有 renderForm 流程）③ Excel 导入（现有 importReviewExcel 行保留）。
- 选型后流程不变：预算先行门禁、字段表、提交链路。
- **提交成功回调统一跳 `#/opp/:code`**（表单提交处、向导完成处、Excel 导入核对视图 onNext 处）。

## 3. 服务端改动（仅 1 个新端点）

`GET /api/opp/:code/360`

- **鉴权**：登录即可（与 /api/reviews?scope=all"全员只读"同口径）；写操作仍由各既有端点自行鉴权（看得见≠动得了）。
- **响应契约**：
```json
{ "opp": { "code": "PL00008572", "title": "…" },
  "reviews": [ …reviews 行（含 id/type/title/status/round/light/era/updated_at）… ],
  "budgets": [ …budgets 行（含 id/code/version/status/updated_at）… ],
  "tasks": [ …tasks 行（联查带 r.title/r.type/r.opp_code）… ],
  "lights": { "red": 0, "yellow": 0, "green": 0, "none": 0 } }
```
- **实现要点**：三查询全部参数绑定（node:sqlite 对 undefined 抛异常的教训防线）；reviews/budgets WHERE opp_code=?（reviews 含 era=history 一并返回，归档标签呈现）；tasks JOIN reviews ON review_id WHERE r.opp_code=?；lights 由 reviews 聚合；reviews+budgets 均空 → 404 `{error:'商机不存在'}`。
- 其余端点、schema、判灯、财务引擎**零改动**。

## 4. 路由与重定向表

| 旧 hash | 新行为 |
|---|---|
| `#/reviews` | 重定向 `#/opps` |
| `#/budgets` | 保留（导航摘除，深链不死——版本链的家） |
| `#/opps` | 商机列表（重建 renderOppsList） |
| `#/agent` | 保留（导航摘除；?b=/?r= 深链功能不变） |
| `#/new` | 新商机向导（升级） |
| `#/review/:id`、`#/budget/:id`、`#/delivery/:bid` | 保留 + 所属商机面包屑 |
| 其余（#/tasks、#/judge、#/archive、#/settings、#/parser-lab） | 不变 |

重定向实现：renderRoute 顶部 `location.hash = '#/opps'; return;`（hashchange 自动重渲染）。

## 5. 错误处理

- 360 端点 404 → 空态卡 + 新商机入口按钮（不 toast 刷屏）。
- api() 异常 → toast(红)，loading 清理。
- LLM 对话降级链路不变（HTTP 200 + 点选问答）。
- 所有新页 await 后 `location.hash !== h0` 弃写（慢页竞态守卫）。

## 6. 测试策略（红绿纪律）

### 6.1 新用例 `tests/h_ia_shots.js`（IA-01~14，playwright，截图+DOM 断言）

- IA-1~5 导航：sales1 三项（无待办打灯/研判台）；fin1 四项（含待办打灯）；fde1 两项（仅首页+待办打灯）；zhichizu 六项（含解析器实验室、无 LLM 设置）；归档库文本存在（h_flicker 锚点）。
- IA-6 首页：sales1 待办含 draft/returned 行；fde1 待办含打灯按钮；zhichizu 待办含待研判队列。
- IA-7~10 360°：`#/opp/PL00008572` 七标签渲染；评审表标签行≥1；前置灯态标签含部门列；对话标签含该商机预算/评审入口 chips。
- IA-11 向导：#/new 三种编制方式可见。
- IA-12~13 重定向：#/reviews → #/opps（#/budgets 改为路由保留，见 §2.2 修订）。
- IA-14 旧深链：#/agent?b= 仍渲染对话窗。
- 截图 shots/H_IA_1~5；日志按 fail 数落 red_ia.txt / green_ia.txt（脚本内 fs.writeFileSync utf8）。
- **兼容断言**：归档库文本、#/review/:id 详情可用、#/tasks 表格结构——旧代码上即 PASS（证明非破坏性）。

### 6.2 旧 H 测试同批更新（切换提交内完成）

- h_manual_check.js:31/121/134（nav click 智能体/预算单/新建评审单）→ 改 goto hash 或新导航文本。
- h_ui_shots.js:86/110（新建评审单/预算单 nav click）→ 同理。
- h_nav_shots.js：重写为新 IA 断言（套件名保留，NAV 行改测新导航结构）。
- h_flicker.js：归档库 on-text 锚点不动（文本保留）。

### 6.3 回归聚合

- run_all.js SUITES：NAV 行更新描述 + 新增 IA 行（h_ia_shots.js）→ 共 20 套。
- 收工门：20/20 ALL PASS + red_ia.txt（旧代码 FAIL 证据）+ green_ia.txt。

## 7. 实施顺序（超集先固化，再一次切换）

> 【2026-10-14 实施修订】#/budgets 由"重定向"改为"路由保留、导航摘除"；实施顺序按既有验证过的"先固化超集再切换引用"模式细化为下述五步。

1. 写 h_ia_shots.js → 在未改代码上跑出**红证据** red_ia.txt（新路由/新导航 FAIL；兼容断言 PASS）。
2. server.js 新增 GET /api/opp/:code/360（重启服务生效）。
3. **超集固化（每步旧 H 测试保持全绿，旧导航未动）**：智能体容器参数化 → renderOpp360（#/opp/ 新路由挂载）→ renderHome（#/ 换渲染）→ renderOppsList（#/opps 换渲染）→ 向导改版 + 提交跳转。
4. **一次切换**：renderShell 新 nav + renderRoute 收编（#/reviews 重定向、renderReviewsList 撤销）+ 旧 H 测试锚点同批更新 + h_nav_shots 重写 + run_all.js 增至 20 套。
5. 全回归 20 套 → green_ia.txt + green_run_ia.txt → git 提交（含证据日志）。

## 8. 不变式（红线，逐条对应既有事故教训）

1. 零 npm 依赖；无框架无构建；运行仅 Node 22 内置模块。
2. innerHTML 插值一律 esc()（存储型 XSS 防线；h_adv XSS 探针持续验证）。
3. 产品 id 与既有按钮文本不改；**新增按钮文案全局唯一**且避开既有锚点子串（playwright has-text 子串静默错命中的教训）。
4. 模板串内联 onclick/onkeydown 调用的函数保持页面全局作用域（ReferenceError 教训）。
5. CSS 属性选择器带引号；H 测试不把持久化数据写入业务表（已存在短路教训）。
6. 判灯/算账/锁定/提交/结论确认永不出代码；LLM 失败降级且 HTTP 200。
7. 中文 UTF-8；证据由脚本内部 fs.writeFileSync 落盘；node -e 内联脚本不跨 PowerShell 传中文。
8. config.json 永不入 git。

## 9. 验收标准

1. 五角色登录导航各 4~6 项（h_ia_shots DOM 断言实测）。
2. `#/opp/PL00008572` 七标签全渲染且数据与 DB 一致（对账断言）。
3. #/reviews、#/budgets 旧链接重定向生效（IA-12/13）。
4. h_ia_shots.js 全 PASS；run_all 20/20 套 ALL PASS；red_ia.txt 存在且旧代码 FAIL 数>0。
5. git 提交含全部证据日志，提交信息描述 IA 重构与证据落点。

## 10. 风险与回退

- 风险 A：旧 H 测试锚点同批更新遗漏 → run_all 全回归兜底（任一 FAIL 即阻断提交）。
- 风险 B：agent 容器参数化引入回归 → IA-14（#/agent?b= 旧深链）+ A 对话套件兜底。
- 风险 C：sales 我的商机误见他单预算 → 列表仅只读展示（与 /api/budget 现行行为一致），写操作鉴权不受影响。
- 回退：切换层为单提交，`git revert` 该提交即恢复旧导航与旧路由；超集层的附加路由（#/opp/）与旧 IA 并存无害。
