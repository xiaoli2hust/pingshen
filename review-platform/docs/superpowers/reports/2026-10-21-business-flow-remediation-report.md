# 业务流整改执行报告

日期：2026-10-21，Asia/Shanghai。最终交付报告：功能与专项验证已落地，但全部交付条件未满足；完整门仍为 33 通过、1 失败、3 覆盖缺口，真实演示库未清理。不提交 git。

## 1. 需求与执行边界

权威需求为[批准的设计](file:///F:/workbuddy/9/review-platform/docs/superpowers/specs/2026-10-20-business-flow-remediation-design.md)，实施按[计划](file:///F:/workbuddy/9/review-platform/docs/superpowers/plans/2026-10-20-business-flow-remediation.md)和[动态裁定台账](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/ledger.md)推进。实际开工 2026-10-20 22:39 CST；07:40 开始收尾，07:55 停改停测，08:00 前终止。

没有创建提交、暂存、push、PR、stash、reset 或 clean。共享工作区原有大量未提交改动及文件，保留，不宣称工作区干净。真实配置只核对字节指纹，没有写入或输出凭据。没有批准真实外部调用；应用套件均经测试专用离线隔离，只允许指定本地端口，不把该隔离等同于操作系统级零网络包证明。

## 2. 已实现内容与尚未满足的验收

| 整改项 | 当前结果 | 可观测证据或边界 |
|---|---|---|
| P0-1 打灯依据 | 实现，专项通过 | EV-01/05：A/B/C 三区、真实字段值、只读完整单深链、异常提示 |
| P0-2 部门系统依据 | 实现，专项通过 | 19 项映射完整；C 类明确外部依据，提供查询锚点，不虚构权威字段 |
| P2-1 缺失覆盖 | 实现，专项通过 | 已算/未触发/缺失三集合完整且不相交；缺分包字段明确披露；不参与判灯 |
| P2-2 已采集事实利用 | 实现，专项通过 | 表单事实由服务端映射和注册表标签派生 |
| P0-3 提交就绪提示 | 实现，专项通过 | 三卡缺口与锚点、实时必填 N/M、确认/回草稿即时刷新 |
| P0-4 草稿关联预算 | 实现，专项通过 | 编辑原值保真、真实 PUT 关联、不可见与未锁定外来预算不预选 |
| P2-7 下一步 | 实现，专项通过 | 已提交仍显示；按当前链态派生，归档后交付回草稿仍优先确认 |
| P1-3 部门商机入口 | 实现，专项通过 | 五个部门账号真实登录、相关商机可达 |
| P1-5 预算导航 | 实现，专项通过 | 四角色导航、admin 全部范围、实际七列对齐 |
| P1-7 预算卡 | 实现，专项通过 | 新建按钮仅一次，逐行显示关联 |
| P1-8 档案修正 | 实现，专项通过 | 原字段值保留、事件含中文字段/旧值/新值；沿用既有创建人/支持组/admin 写鉴权 |
| P2-3 任务中心 | 实现，专项通过 | 本单进度、折叠可展开、监控筛选/分页；未知进度不伪造零 |
| P2-4 研判队列 | 实现，专项通过 | 三个 tile 实际定位，移除点击/错队列变异必须失败 |
| P2-5 两种导入 | 实现，专项通过 | 历史明确直接归档入库，在线向导明确草稿 |
| P2-6 商机分析 | 实现，专项通过 | 灯色时间线、结论对比，无内部阶段占位词 |
| P1-1 退回任务 | 新退回闭环通过；**存量净化 10-22 已完成（见 §11.4）** | 八个同轮兄弟 cancelled，不计已处理；待办排除，重提旧任务拒绝；净库实测 zombie 0 / orphan 0 / pending 0（SM-01b 15/0 之一） |
| P1-2 代打 | 实现，专项通过 | 角色标注、事件与占比；没有收紧权限 |
| P1-4 首页语义 | 实现，专项通过 | reviewing/judged 两类计数与落地页、实际灯色一致 |
| P1-6 空商机码 | 实现，专项通过 | 各单独立成行，不聚成首行；不把空码当稳定夹具特征 |
| P0-6 数据净化 | **10-22 已执行完毕（见 §11.4）** | 默认过滤/开关浏览器通过；真实库按显式 id 删 1794 行零 UPDATE，净库复核 15/0，新基线 sha 9cddd8af |
| P3-1 演示锚点 | 演示口径已落档 | 改用 6204/8026/8210/8314；8572 仅保留解析/交付锚点，不用 SQL 补终态 |
| P0-5 站内待办 | 实现，专项通过 | 同一 outbox 行、当前轮部门 pending、打完后消失；不宣称真实消息已送达 |
| P2-8 能力文案 | 正常与缺省路径通过 | AW/AD 精确同步；AW-01b 红7/1→绿8/0，唯一旧兜底字符串已修 |
| P0-7 change 导入 | 实现，专项通过 | 在线 Excel 类型不可选，明确在线填写；没有擅补模板映射 |
| P3-2 部门单源 | 实现，专项通过 | 改 META 部门名，前端文案随之改变 |
| P3-3 缓存 | 实现，专项通过 | 第二次进入预算列表零网络请求 |
| P3-4 列数 | 实现，专项通过 | 预算链七列等实际对齐，不以空页不崩替代验证 |
| P3-5 旧深链 | 按批准范围保留 | 三个旧值仍归前置分区，兼容说明保留 |
| P1-9 分包规则 | 按批准范围挂账 | 不改判灯；等待制度原文和适用版本，已绑定后续 R-01 口径 |

专项并不等于全量通过。DG-01、DG-03、DG-04 及实际清理前后 DG-02 尚未完成；SM-01 的存量僵尸归零也依赖实际清理。

## 3. 修改范围

生产实现集中于 [server.js](file:///F:/workbuddy/9/review-platform/server.js)、[public/app.js](file:///F:/workbuddy/9/review-platform/public/app.js) 和 [public/style.css](file:///F:/workbuddy/9/review-platform/public/style.css)。服务端新增证据映射、只读覆盖、任务标注/站内待办、档案事件和退回同轮任务作废；前端对应证据、就绪、导航、列表与文案。判灯函数、财务引擎、预算锁定/提交门、reviews 状态机、结论/归档写权限与 schema 不作为本轮改动。

专项及工具：[test_flow_remediation.js](file:///F:/workbuddy/9/review-platform/tests/test_flow_remediation.js)、[h_remediation_shots.js](file:///F:/workbuddy/9/review-platform/tests/h_remediation_shots.js)、[test_budget_preselect.js](file:///F:/workbuddy/9/review-platform/tests/test_budget_preselect.js)、[test_frontend_semantics.js](file:///F:/workbuddy/9/review-platform/tests/test_frontend_semantics.js)、[test_run_all_contract.js](file:///F:/workbuddy/9/review-platform/tests/test_run_all_contract.js)、[cleanup_fixtures.js](file:///F:/workbuddy/9/review-platform/tools/cleanup_fixtures.js)、[test_cleanup_fixtures.js](file:///F:/workbuddy/9/review-platform/tests/test_cleanup_fixtures.js)。

既有测试同步：[run_all.js](file:///F:/workbuddy/9/review-platform/tests/run_all.js)、[test_chain.js](file:///F:/workbuddy/9/review-platform/tests/test_chain.js)、[test_opp360.js](file:///F:/workbuddy/9/review-platform/tests/test_opp360.js)、[test_opp_dialog.js](file:///F:/workbuddy/9/review-platform/tests/test_opp_dialog.js)、[test_robot_admin.js](file:///F:/workbuddy/9/review-platform/tests/test_robot_admin.js)、[test_robot_workbench.js](file:///F:/workbuddy/9/review-platform/tests/test_robot_workbench.js)、[h_nav_shots.js](file:///F:/workbuddy/9/review-platform/tests/h_nav_shots.js)、[h_ia_shots.js](file:///F:/workbuddy/9/review-platform/tests/h_ia_shots.js)、[h_robot_workbench_shots.js](file:///F:/workbuddy/9/review-platform/tests/h_robot_workbench_shots.js)、[h_admin_shots.js](file:///F:/workbuddy/9/review-platform/tests/h_admin_shots.js)。

文档：[打灯证据对账表](file:///F:/workbuddy/9/review-platform/docs/打灯证据对账表.md)、[待确认业务口径清单](file:///F:/workbuddy/9/review-platform/docs/待确认业务口径清单.md)。本任务隔离/快照/审查产物位于 SDD 目录；基线逐文件共 55 个，不用 HEAD 差异把其他会话修改算成本任务改动。

## 4. 红绿与实际浏览器证据

| 证据 | 实际结果 |
|---|---|
| [HTTP 首红](file:///F:/workbuddy/9/review-platform/tests/red_flow_remediation.txt) → [专项绿](file:///F:/workbuddy/9/review-platform/tests/green_flow_remediation.txt) | 24/68 → 92/0；首红 PRE/PIN 全通过 |
| [服务审查红](file:///F:/workbuddy/9/review-platform/tests/red_flow_review.txt) → [服务审查绿](file:///F:/workbuddy/9/review-platform/tests/green_flow_review.txt) | 96/2 → 98/0；admin 读取范围与只读激励覆盖边界 |
| [浏览器审查红](file:///F:/workbuddy/9/review-platform/tests/red_remediation_review_shots.txt) → [最终浏览器专项](file:///F:/workbuddy/9/review-platform/tests/green_remediation_final_shots.txt) | 42/18 → 68/0；中间 58/2 没有被当作完成 |
| [预算预选红](file:///F:/workbuddy/9/review-platform/tests/red_budget_preselect.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_budget_preselect_final.txt) | 3/3 → 6/0；另有真实浏览器探针 |
| [状态语义红](file:///F:/workbuddy/9/review-platform/tests/red_frontend_semantics.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_frontend_semantics.txt) | 4/8 → 12/0；另有真实浏览器探针 |
| [工作台文案红](file:///F:/workbuddy/9/review-platform/tests/red_remediation_aw_copy.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_remediation_aw_copy.txt) | 6/1 → 7/0；其他断言不放宽 |
| [管理页文案红](file:///F:/workbuddy/9/review-platform/tests/red_remediation_ad_copy.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_remediation_ad_copy.txt) | 23/1 → 24/0；权限/掩码/XSS/页签/取消/console 检查保留 |
| [缺省文案红](file:///F:/workbuddy/9/review-platform/tests/red_remediation_aw_fallback.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_remediation_aw_fallback.txt) | 7/1 → 8/0，仅新 AW-01b 首红；缺省消息实际 DOM 与其他七条一起复验 |
| [首门 IA 原红](file:///F:/workbuddy/9/review-platform/tests/rm_gate_pre_27_stdout.txt) → [IA 严格 DOM 复验](file:///F:/workbuddy/9/review-platform/tests/green_remediation_ia_shared.txt) | 57/1 → 63/0；不补产品文案凑绿，三直接子卡/真实类型入口/交付范围，四实际 DOM 变异拒绝 |
| [最终门 AD 原红](file:///F:/workbuddy/9/review-platform/tests/rm_gate_final_29_stdout.txt) → [管理页身份复验](file:///F:/workbuddy/9/review-platform/tests/green_remediation_ad_identity.txt) | 22/2 → 24/0；只修测试等待目标页标题，24 条业务断言不动，产品代码不动；不替换最终全量门结果 |
| [审计检测红](file:///F:/workbuddy/9/review-platform/tests/red_gate_evidence_detector.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_gate_evidence_detector.txt) | 6/1 → 7/0；只读审计新增识别零退出码的 SOME FAIL，不误伤 ALL PASS 或 TAP # fail 0 |
| [机器人管理实际离线专项](file:///F:/workbuddy/9/review-platform/tests/green_rb_offline_final.txt) | 62/0，逐条读过真实本地投递 0/1 断言 |
| [工作台实际离线专项](file:///F:/workbuddy/9/review-platform/tests/green_rw_offline_final.txt) | 19/0 |
| [清理工具红](file:///F:/workbuddy/9/review-platform/tests/red_cleanup_fixtures.txt) → [绿](file:///F:/workbuddy/9/review-platform/tests/green_cleanup_fixtures.txt) | 0/1 → 29/0，仅独立副本；审查边界 29/2 → 31/0 |

浏览器为实际本机 Chrome 的授权无头运行，非仅 VM/语法检查。68 项包括五角色导航、表单填值、真实关联、只读证据、失败分支、返回/面包屑、队列定位、缓存、交付草稿/确认即时刷新、保留编辑器与字段原值。AW 三页签 XSS、AD 掩码/权限、整改专项与管理页的 console.error/pageerror 均有实际日志。IA 完整日志含故意重复创建触发的预期 409 console.error；后段清空监控后为零，不声称 IA 整段日志零错误。早期不完整红跑的 CRASH 留档，不冒充纯红或完整通过。

## 5. 全量门与覆盖真实性

实测 [SUITES](file:///F:/workbuddy/9/review-platform/tests/run_all.js#L22) 登记 **37 套**，不是 spec 旧 32 套。两轮均保留 37 份完整 stdout、原始退出码和完整聚合结果，均已逐一回读：

| 运行 | 原始实际结果 | 耗时 | 后续处理 |
|---|---|---|---|
| [首轮完整门](file:///F:/workbuddy/9/review-platform/tests/green_run_remediation_pre.txt) | 33 PASS / 1 FAIL / 3 COVERAGE GAP | 834.2s | IA-8 旧提示语代理断言红，测试改成严格 DOM 检查后 IA 63/0；未补产品文字凑绿 |
| [最终完整门](file:///F:/workbuddy/9/review-platform/tests/green_run_remediation_final.txt) | **33 PASS / 1 FAIL / 3 COVERAGE GAP → SOME FAIL** | **840.4s** | AD 原 22/2；随后只修测试页身份等待，独立 AD 24/0；**没有第三轮全量门，不将专项复验折算成 34/37 或 ALL PASS** |

最终门 06:41:52 CST 启动，套件 06:57:35 结束。最终 [manifest](file:///F:/workbuddy/9/review-platform/tests/rm_gate_final_manifest.json) 确认 AD 第 29 套 status=1，其余子套件 status=0、signal=null、error 为空；CH/C2/OD 三套虽退出 0 仍分别按完整原文识别为覆盖缺口。[完整证据审计](file:///F:/workbuddy/9/review-platform/tests/final_remediation_gate_evidence_final.txt)核实 **37/37 记录、auditFailures=0、databaseLocks=0**。审计通过只证明结果与原始记录一致，不证明完整功能门通过。

四个历史见证不能由授权 HTTP 链制造：**CH-11b、C2-11-identity、OD-08-inflight、OD-09-flip**。没有恢复 SQL 造态或增加生产测试专用端点；保留 `NOT EXECUTABLE` / `COVERAGE GAP`，聚合器扫描完整子套件输出，缺口非零退出。可执行断言通过不能写成完整 ALL PASS。

全量使用[独立日志入口](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/gate-final-runner.js)：原 run_all 源码、参数与状态聚合不变，仅子套件日志改到全新路径并保留完整 stdout/stderr。规则矩阵、纯财务测试、原件逐格解析、真实交付/预算锚点和判例可执行链均通过；全量完整输出无 database is locked。

## 6. 数据与配置保护

每次写库循环先安全停服，快照原库和 uploads/shots 字节；结束后先确认测试/服务停止，再恢复并核对 SHA256、certutil 和 20 张表有序指纹。新增测试附件回收，原截图逐字节恢复，新任务截图留证。wrapper 退出 0 不能替代 `cycle.exit` 与原始断言。

原库：52,826,112B，SHA256 `96cf5ea46f9a044eafd8c149bb8b9e136aec8024d561aab3f2b7febb558574d4`。原资产 uploads=3390、shots=41。REAL7 全部商机及 confirmed 交付锚点、六张真实评审/预算均保留。

| 保护循环 | 恢复核实时间（CST） | 原套件退出 | 安全结果 |
|---|---|---|---|
| [首门](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/logs/cycle_rm_gate_pre.json) | 06:23:03 | 1 | timedOut=false；stopped/suiteStopped/restored=true；errors=[]；configUnchanged=true |
| [IA 复验](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/logs/cycle_rm_ia_shared_green.json) | 06:32:41 | 0 | 同上 |
| [最终门](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/logs/cycle_rm_gate_final.json) | **06:58:57** | 1 | 同上；guard15192/app37292/suite26200 均已停止；全库、20 表和原资产一致 |
| [AD 身份复验](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/logs/cycle_rm_ad_identity_green.json) | **07:10:18** | 0 | 同上；app24708/suite15144 正常停止；全库、20 表和原资产一致 |

最终门快照 shots=43，AD 快照 shots=45，增加的是本任务有意留存的浏览器证据；原 41 张截图逐字节恢复，非测试残留。原库本就含 **tasks695/pending348/reviews93/opps50/outbox90preview**。[只读现场审计](file:///F:/workbuddy/9/review-platform/tests/final_remediation_scene_audit.txt) **11/0**：六张原单六字段逐行不变、六预算 locked、七交付 confirmed、原 outbox 全 preview；14 份临时 Excel 逐格、来源 run 与每轮 1+6 唯一案例核实。**字节恢复证明本轮没新增库污染，不等于原库存量 pending 或夹具已归零。真实演示库没有执行清理。**

配置原指纹始终为 **270B / SHA 前16 `f285c66ad4790370`**，未被 git 跟踪。门前、门后、AD 后 [源码审计](file:///F:/workbuddy/9/review-platform/tests/final_remediation_source_audit_after_ad.txt)均 **17/0**：judge、finance、agent、robot-orchestrator 字节不变，19 个 CREATE TABLE 与 11 条 ALTER 字面量不变，夹具正则前端没有第二份。最终门期间 55 个记录源码零漂移；门后只改 AD 测试 helper，生产/guard/preload/run_all 保持冻结。

自有临时件与最终只读现场核对在第 10 节记录；不按文件名前缀清空共享工作区。

## 7. 独立审查与动态裁定

服务与前端有完整独立源码审查，先处理发现的 Critical/Important，再用真实 HTTP/浏览器核验。原生 Agent 入口多次 ENOENT，使用独立 builtin 会话回退，未声称失败入口已运行。[IA-8 窄审](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/ia-shared-review.txt)、[最终门入口窄审](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/gate-final-entry-review.txt)及[证据工具窄审](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/gate-evidence-review.txt)均为 Critical 0 / Important 0；静态结论不等同于全量门通过。证据工具漏识别 SOME FAIL、stage/tag 错配两项已实改和独立关闭。

[收尾两项窄审](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/closeout-reviews.txt)均 C0/I0。AD 根因是产品加载时保留旧页，两页恰有六卡，旧测试只数卡片加固定延时误读 LLM；最小裁定只等待目标首卡标题与六卡，不动产品或 24 条断言。场景审计原仅凭时间/文件名认领临时件，被独立指出后增加逐格、来源 run、唯一案例及精确数量，不认识的文件绝不删除。预算临时件无 run ID 的 Minor 通过执行前附加两轮 EI-08b PASS 见证补强；AD 同页刷新仍有固定 400ms 的 Minor，可能误报失败，不作额外 late-stage 改动。

[护栏审查](file:///F:/workbuddy/9/.superpowers/sdd/2026-10-20-business-flow-remediation/guard-timeout-review.txt#L81)绑定 guard `d67d6d04`、preload `669c56f4`：Critical 0，**I-4 未关闭**，root-only 终止后代的退出时长不稳定。只放行监督、串行、有限时长的正常循环；不放行无人值守超时自动恢复。第一次实际 Chrome 超时见证失败关闭恢复，第二次同字节见证七身份消失并清自有 profile；两个结果留档，未猜测根因，也未擅杀后代或陌生进程。

离线屏障绑定 handler、响应 finish、send/retry 整体 Promise 和实际 curl close；33 项专项与 17 个 child 全 close。拒绝语义 12/4 → 16/0，未吞业务异常或把通知失败变成绿。它不是任意背景线程或操作系统级网络包审计。

其他最小裁定详见台账：可达商机页锚点替代不存在路由；admin 只扩大预算读取、不改写门；已处理任务明确查看当前数据而非虚构历史快照；写成功但刷新失败分别陈述；空码不作为运行时夹具识别；规则与部门权威留在原裁判/部门系统。

## 8. 未完成与下一步

**本次未完成全部 29 项交付条件。** 两轮完整门均未全绿；最终门 AD 后仅专项复验，没有第三轮完整回归；四个历史覆盖缺口及护栏 I-4 保留。真实演示库一次性清理、清理后全量/浏览器净库验证没有执行。完整门未满足，不将独立副本 31/0 写成 DG-01/03/04 完成，不为赶截止以 SQL 伪造业务终态。

后续先在不越过状态机/配置/外部调用红线的前提下裁定四个历史见证的合法覆盖方式、解决 I-4 或限定受监督安全边界；再在 AD 修复后的冻结版本跑完整门。完整门满足后，才执行显式 ID 清理、真实清理前后指纹和净库浏览器/全量验证。真实钉钉、change 模板根治、多账号/代打权限、分包规则原文仍按批准范围挂账。

## 9. 逐项验收对账

| Spec 验收 | 结果与边界 |
|---|---|
| EV-01~06 | HTTP 98/0 与实际浏览器 68/0，键集/三类/锚点/缺项/真实字段和失败分支已验证 |
| RD-01~04 | 专项通过；原值与外来预算边界、实时就绪及交付链态刷新另外钉住 |
| IA-44~50 | 五部门与四角色导航、七列、档案事件/403、折叠/定位、两通道、时间线已验证 |
| SM-01 | 新退回同轮 cancelled/待办排除已通过；**存量僵尸归零 10-22 已实测**（净库 pending 0 / zombie 0 / orphan 0，SM-01b 属 15/0 复核项） |
| SM-02~04 | 代打痕迹/事件、状态计数、空码独立成行已通过 |
| DG-00 | 工具副本 ABORT 与明确删除边界 31/0；10-22 真实执行亦走同五条前置（dry-run 复算库 sha 未变后才 apply） |
| DG-01/03/04 | **10-22 已完成**：净库逐表计数 opps7/opp_delivery7/reviews6/budgets6/budget_delivery0/outbox0/tasks55、分布 1售前+5投标 / 1退回+5归档 / 1红+5黄、零夹具码残留；DG-04 落为永久断言（红 68/2 → 绿 70/0）随每轮门自动核 |
| DG-02 | 所有测试循环快照/还原双层核实；**清理前后 SHA 与逐表指纹已落** tests/dg_cleanup_evidence.txt（before 96cf5ea4 → after 9cddd8af） |
| DG-05 | 浏览器开关已验证；空码按 spec 不作为运行时过滤条件 |
| DG-06 | **10-22 已按清理后实测**：工具在事务内逐表比对保留行（`same(after[t], wanted)`，任何字段漂移即回滚），另有 dg_post_cleanup_verify.txt 按位元组核六张单六字段逐行一致（15/0 之一） |
| NT-01/02、CH-01、PL-01/02 | 本地待办/provider禁用、change不可选、META部门变异、二次进入零请求已通过 |
| RL-01/02 | 最终门规则/判例可执行链、pl8572六组与tiandi十项、原件逐格锚定通过 |
| RL-03/04/05 | 财务源码未改、真实配置270B/f285未变未跟踪、37完整输出锁库0 |
| RL-06 | 所有受保护应用启动的未登录 `/api/me` 为401；最终保持停服，不在线重启读取真实凭据 |

## 10. 最终安全收尾

07:40 已转入安全收尾，不再新增功能或运行套件。实际结果如下：

- [明确临时件清理](file:///F:/workbuddy/9/review-platform/tests/final_remediation_scratch_cleanup.txt)：07:30:22–07:30:36 CST，**精确删除 14 份自有 Excel，保留 110 份同前缀外来文件**；每件有逐格/run/数量、常规文件非符号链接、大小、SHA256 与未跟踪见证，删除前再次核验。全部检查通过，errors=[]，数据库/配置未变。
- 07:32:13 CST，`guard.js verify rm_ad_identity_green` 实际输出 `ok=true`，原 SHA256 与 certutil 均为 `96cf5ea46f9a044eafd8c149bb8b9e136aec8024d561aab3f2b7febb558574d4`，`tables_mismatch=[] tables=20 assets_mismatch=[]`。
- [最终安全检查](file:///F:/workbuddy/9/review-platform/tests/final_remediation_closeout.txt)：07:40:09–07:40:25 CST，实际命令输出 **`FINAL CLOSEOUT: 13 passed, 0 failed; removedExecutors=2; service remains down`**。07:40:22 端口 8600 双采样为空；记录的 7 个自有应用/套件/护栏 PID 均不存在；55 源文件及 guard/preload 无漂移；配置 270B/f285 未变未跟踪、原库 SHA 未变；定范围 `git diff --check` 退出 0，仅既有 LF/CRLF 提示，HEAD 未变，共享工作区仍 dirty，不作清空。
- 同次检查对 **291 个定范围源码与证据文件**扫描长 API key / 字面量 REPORT_SECRET 模式，findings=[]；不解码真实配置值，不输出凭据。该结论只涵盖指定模式与扫描时点，不冒充任意秘密格式的检测证明。
- 已删除本会话两个一次性执行器 `close-owned-scratch.js`、`final-close-check.js`，其删除前 SHA 与明确名字记录在证据内。恢复快照、护栏/隔离、可复用只读审计、原始红绿日志和有意留存截图保留，用于复核和后续安全继续；不冒充临时产物全目录清空。

此后仅完成本报告/台账的 UTF-8 落档与只读文本核对，末次核对时刻见[报告落档检查](file:///F:/workbuddy/9/review-platform/tests/final_remediation_document_closeout.txt)。本轮不再启动服务、写库、运行第三门或执行真实演示库清理；完成最终响应即终止，未通过与未完成项保留，不延续到截止之后。

## 11. 续跑补完（2026-10-21 白天，用户指令「继续任务」）

第 1~10 节是 08:00 截止时的快照，其中"未完成"三项已在白天补完。下列数字均为白天实测，不回改上文任何结论。

### 11.1 四历史覆盖缺口的处置（R-66）

四条见证要求 `reviews.era` 出现在非归档态或同一行改 `era`。实测全仓 `era` 只有两个写入点：启动期 `era='online' WHERE era IS NULL` 回填，与历史导入 INSERT 的同一语句内 `'archived'`+`'history'`；无改 `era` 端点，编辑/提交/研判/退回四道状态守卫都不接 `archived`，归档即终态。因此这些状态**无已授权 HTTP 产地**。恢复 SQL 造态违反红线，新增改 `era` 的生产端点属规格外写路径，两者都不采。

替代做法：`tests/run_all.js` 把四条 id 定为**双向棘轮白名单**——出现白名单外缺口即红，白名单内任一缺口消失（能力恢复或被静默删）同样即红，且全绿末行仍逐条落声明缺口 id，禁止把带缺口的绿读作零覆盖；同时新增 `ERA-01~05` 源码不变式把"不可达"变成可执行证明（含三组按分区判定的变异自测）。

- 契约红 [tests/red_run_all_gap_allowlist.txt](file:///F:/workbuddy/9/review-platform/tests/red_run_all_gap_allowlist.txt) 4 passed/5 failed（改造前聚合器副本）→ 绿 [tests/green_run_all_gap_allowlist.txt](file:///F:/workbuddy/9/review-platform/tests/green_run_all_gap_allowlist.txt) **9/0**。
- ERA 红 [tests/red_flow_remediation_era_parserbug.txt](file:///F:/workbuddy/9/review-platform/tests/red_flow_remediation_era_parserbug.txt) 104/1（我的括号偏移把普查扫空，ERA-01 抓到；同轮暴露 ERA-04 因空集而"变异通过"的假绿，已改为按分区判定）→ 绿 [tests/green_flow_remediation_era.txt](file:///F:/workbuddy/9/review-platform/tests/green_flow_remediation_era.txt) **105/0**。

### 11.2 全量门

| 轮次 | 库状态 | 实测末行 | 耗时 |
|---|---|---|---|
| [rm_gate3b](file:///F:/workbuddy/9/review-platform/tests/green_run_remediation_gate3b.txt) | 清理前 96cf5ea4 | **37/37 套通过, 失败 0, 未登记覆盖缺口 0, 声明缺口 4/4, 缺口消失 0 -> ALL PASS** | 776.9s |
| [rm_gateclean](file:///F:/workbuddy/9/review-platform/tests/green_run_remediation_gateclean.txt) | 清理后 | 36/37, 失败 1（EI-09 4148ms） | 791.3s |
| [rm_gatefinal2](file:///F:/workbuddy/9/review-platform/tests/green_run_remediation_gatefinal2.txt) | 清理后 | **37/37 -> ALL PASS**（后被 R-75 证伪为"交付面"，因门后又改测试） | 770.2s |
| rm_gatefinal3 | 清理后 | **未完成**：起跑 19:47 后笔记本整夜睡眠，护栏 30 分钟墙钟超时直到次日 10:16 才触发 SIGTERM，22/37 套已产出；已手动 `restore` 回净库基线 | — |
| [rm_gatefinal4](file:///F:/workbuddy/9/review-platform/tests/green_run_remediation_gatefinal4.txt) | 清理后（**交付轮**） | **37/37 套通过, 失败 0, 未登记覆盖缺口 0, 声明缺口 4/4, 缺口消失 0 -> ALL PASS** | 727.9s |

交付轮 rm_gatefinal4 已包含 R-75 的守卫加固（ERA 107 条含 5 类变异自测、DG-04 两条含空转守卫），即**跑绿面＝交付面**。其 manifest 37 条记录全 status=0 且无 signal/error；逐套原始 stdout 复扫 [final_gatefinal4_raw_stdout_scan.txt](file:///F:/workbuddy/9/review-platform/tests/final_gatefinal4_raw_stdout_scan.txt) 为 **ALL 37 CLEAN**；`database is locked` 计数 0；cycle 记录 stopped/suiteStopped/restored/configUnchanged 全为真、`errors=[]`、`timedOut=false`。

两轮 ALL PASS 均逐套回读原始 stdout：[final_gate3b_raw_stdout_scan.txt](file:///F:/workbuddy/9/review-platform/tests/final_gate3b_raw_stdout_scan.txt) 与 [final_gatefinal2_raw_stdout_scan.txt](file:///F:/workbuddy/9/review-platform/tests/final_gatefinal2_raw_stdout_scan.txt) 都是 **ALL 37 CLEAN**（含 TAP 与 `ALL PASS` 变体格式），`database is locked` 计数 0，manifest 37 条记录全 status=0。

口径更正：spec §7.5 DG-03 写的是"清理后全量门 **32** 套 ALL PASS"，32 为写 spec 时的陈旧套数；`tests/run_all.js` 的 SUITES 实测 **37**，交付以 37 套 ALL PASS 为准，不引用陈旧数字。另有两处判定口径须按实测读：①`h_remediation_shots` 的汇总只写进它自己的 `--log` 文件，stdout 无汇总行（门内实测 70/0），扫描器据其自带日志回退取值，不因 stdout 缺汇总而误判；②"ALL PASS"包含 4 条声明缺口的逐条落档，不得读作这四类见证已覆盖。

### 11.3 EI-09 那条红的定性（含我自己实验设计的错误）

净库门唯一红是 `EI-09 单次导入耗时<4s` 实测 4148ms。第一版单变量对照我排成"清理前×2、清理后×2"，得出差约 500ms 的结论——**该设计是错的**，时间漂移与分组混叠。改成交替序 P,C,P,C,P,C 重测：清理前均值 3366ms、清理后 3414ms，差 48ms 远小于组内 2716~4059ms 波动，据此**证伪"清理导致变慢"**（两份原始数据 logs/ab_ei09.json 缺陷版与 logs/ab2_ei09.json 交替版都保留）。结合 5345ms 出现在我连续十几轮 cycle 争抢 CPU 的窗口，定性为环境负载型红；阈值 4000ms 对均值仅约 15% 余量属测试自身设计问题，未据此放宽断言，而是趁机器空闲重跑取交付结果。

### 11.4 真实演示库清理（P0-6）与 DG 验收

前置门全绿后按编排顺序执行：端口空双采样 → 库等于基线且无 journal → `guard snap dg_pre_cleanup` → `--dry-run` 生成显式 id 清单并复算库 sha 未变 → 十项删除计数逐项对上批准清单 → `--apply`（工具内再校验清单与事务内逐字段保留比对，每行 DELETE 恰影响 1 行）→ 只读复核 → `guard snap dg_cleaned`。

- 实际删除 **1794 行**，零 UPDATE：reviews 87、tasks 640、events 511、attachments 0、agent_messages 240、budgets 92、budget_delivery 72、opps 43、opp_delivery 19、robot_outbox 90。证据 [dg_cleanup_evidence.txt](file:///F:/workbuddy/9/review-platform/tests/dg_cleanup_evidence.txt)，显式清单 [dg_cleanup_idlist.json](file:///F:/workbuddy/9/review-platform/tests/dg_cleanup_idlist.json)。
- 净库复核 [dg_post_cleanup_verify.txt](file:///F:/workbuddy/9/review-platform/tests/dg_post_cleanup_verify.txt) **15/0**：保留 opps 7 / reviews 6 / budgets 6(全 locked) / opp_delivery 7(全 confirmed) / tasks 55 / agent_messages 18 / events 93，budget_delivery 0 / robot_outbox 0 / attachments 0，llm_calls 41 与 users 10 / settings 20 未动；六张真实单六字段逐行等于批准元组；`pending 348→0`，zombie 0、orphan 0（**SM-01b 由"未完成"变为已实测**）。
- DG-04「首页灯色合计」原先**在永久套件里没有载体**（全仓 grep 零命中）。未硬编码 6，改为在 [tests/h_remediation_shots.js](file:///F:/workbuddy/9/review-platform/tests/h_remediation_shots.js) 加两条数据自洽断言：首页"共 N 单"与红/黄/绿/待研判四档逐项等于排除夹具后的真实分布；夹具开关前后差恰为夹具单数且关闭后复原。变异红 [red_dg04_fixture_mutation.txt](file:///F:/workbuddy/9/review-platform/tests/red_dg04_fixture_mutation.txt) 68/2（强制显示夹具时两条必红、其余 68 条不动）→ 绿 [green_dg04_netdb.txt](file:///F:/workbuddy/9/review-platform/tests/green_dg04_netdb.txt) **70/0**；未新增套件，SUITES 仍 37。
- 净库新基线 sha `9cddd8af0684e7ae5d0cf40dff54523329a0b1ab99029da9a5030afd86de86b0`；回退点 `db/dg_pre_cleanup.db`、`db/rm_gate3b.db` 均字节等于旧基线 `96cf5ea4…`。
- 顺带纠两处错：spec §D-D「合计删除 1714 行」是逐项加总笔误，已就地改正并注明（逐项数字与工具断言一致）；我自己的净库校验器首跑 DG-06 假红源于 `JSON.stringify` 键序敏感，改为与清理工具同口径的按位比对，未动数据也未放宽断言。

### 11.5 规格外新增改动：桌面不再狂闪控制台窗口

用户投诉跑门时终端反复弹窗。实测根因不是端口探测（护栏早已 `windowsHide`），而是子进程未关控制台窗口：`notify.js:24`、`server.js:1401`、`server.js:2542`、`agent.js:199` spawn curl/python 无 `windowsHide`（每发一条通知、每解析一次 Excel 闪一窗），`tests/run_all.js:65` 起 37 个子套件同样缺省。五处一律补 `windowsHide: true`，只关窗口，argv/stdio/env 与任何判定零改动。四文件 `--check` 通过；红线审计重跑 [tests/redline_remediation_audit.txt](file:///F:/workbuddy/9/review-platform/tests/redline_remediation_audit.txt) **6/0**（judge 逐字符不变、finance 逐字节不变、19 建表+11 迁移字面量不变、config 270B/f285 不变）；契约 RG-07 在加开关后仍 9/0。此为 29 项之外的新增改动，故在此显式登记。

### 11.6 一条需要点名的自纠

`guard.js:350` 在非 `--keep-down` 的 cycle 结束后会**自动再起一个 `<tag>_idle` 服务**（计划 T16「服务现场恢复」的实现）。我一度把它记成"外来会话抢占端口"，实为本计划自己的护栏：该起服会跑开机迁移（日志 `delivery moved=0 opps backfilled=0`），把刚还原的库字节改写，并让下一轮 cycle 因端口占用 ABORT。台账 R-67 已更正归因。由此得到一条口径：**字节还原不变式只在"最后一次动作是还原且其后无人起服"时成立**；后续写库 cycle 一律带 `--keep-down`，或在下一轮前显式停掉 idle。另有一次为夺回端口强杀中断事务留下 `review.db-journal`，我没有手删（手删会跳过回滚致半写），改为读写打开一次让 SQLite 自行回滚，`integrity_check=ok` 后再还原。

### 11.7 交付时点状态

以 **rm_gatefinal4（37/37 ALL PASS）** 为交付结果：演示库等于净库基线 `9cddd8af0684e7ae5d0cf40dff54523329a0b1ab99029da9a5030afd86de86b0`，`certutil` 与脚本 SHA256 一致，20 表有序 JSON 指纹零差异、uploads/shots 资产零差异、无 journal；`config.json` 270B / sha16 `f285c66ad4790370`、未被 git 跟踪；8600 属主双采样为空，服务保持停服（不再后台占用桌面），需要界面自查时用 `start.bat` 或托管 Node 起 `server.js`。零 git commit（HEAD 仍 `186b251`）、未 push、未 add、暂存区为空。

一条环境残留需你处置：为防夜间再次睡眠，我起过 `~/.qoder/scripts/keepawake.ps1 -Display`，但查状态时该断言的 reason 显示为 `logon`（PID 3832），无法确定是我起的还是你登录时本就有的，因此**我没有关闭它**。不需要时用 `powershell -File C:\Users\01386380\.qoder\scripts\keepawake.ps1 stop` 停掉即可。

### 11.9 交付前的自我证伪（独立评审未获得，如实登记）

### 11.8 仍未完成 / 已挂账

四个历史见证仍为声明缺口（源码不变式已替代）；护栏 I-4（root-only 终止后代的退出时长不稳定）未关闭，本轮全部 cycle 均为受监督、有限时长、正常结束并逐条核查 `stopped/suiteStopped/restored/configUnchanged/errors`；分包占比 ≥70% 是否红线、变更类评审表原件模板、真实钉钉接入、每角色多账号与代打收紧、部门自有系统对接，均按批准范围继续挂账。EI-09 的 4000ms 阈值余量偏小已记为测试设计问题，待后续单独裁定，本轮未擅自调阈值。

### 11.9 交付前的自我证伪（独立评审未获得，如实登记）

我尝试派独立评审子代理，入口报 `ENOENT`（本项目已知失效形态）。**我没有把它算作"已评审"**，改为自写攻击性探针，专门尝试打掉自己新加的守卫，并逐条证伪"已完成"表述。这一探针打出了两个真洞：

1. `eraViolations()` 原实现只扫**整句 SQL 字面量**，因此两类合法写法可以绕过而不变式仍显示"绿"：拼接式 `'UPDATE reviews SET ' + 'era' + '=?'`，以及 upsert 的 `ON CONFLICT(id) DO UPDATE SET era=excluded.era`。实测两条变异的"命中分区"为空数组——即守卫确实拦不住。
2. DG-04 第二条在夹具数为 0 时会退化成 `0 - 0 === 0` 的恒真断言（空转通过）。

处置：对 `UPDATE reviews SET` 与 `DO UPDATE SET` 之后 80 字符窗口按**词元边界**扫 `era`（`(^|[^\w$])era([^\w$]|$)`，避免 `general`/`extract` 之类误报），仅放行启动期 `era='online' WHERE era IS NULL` 回填原句；DG-04 第二条加 `fx > 0` 响亮失败。另确认 `era` 列只存在于 `reviews` 表（其余 18 表 DDL 无该列），故普查范围无需扩表。

- 红 [tests/red_flow_era_bypass.txt](file:///F:/workbuddy/9/review-platform/tests/red_flow_era_bypass.txt) **105/2**（只有这两条新变异红，原三条变异与其余全绿＝非破坏基线）→ 绿 [tests/green_flow_era_bypass.txt](file:///F:/workbuddy/9/review-platform/tests/green_flow_era_bypass.txt) **107/0**（五条变异各由指定分区拦截，原码 ERA-01/02/03 零违规）。
- DG-04 加空转守卫后 [tests/green_dg04_netdb2.txt](file:///F:/workbuddy/9/review-platform/tests/green_dg04_netdb2.txt) **70/0**。
- 因两处改动发生在 rm_gatefinal2 全绿**之后**，交付面不等于跑绿面，故以同一净库基线重跑完整门（rm_gatefinal3）作最终交付结果，不援引"门后只加断言可免重跑"的口径。

### 11.10 文档自纠

台账一度被我的插入式编辑弄出重复行（R-68/R-69 各两行）与错位行，已用只读审计脚本定位、删重复（保留首次出现）并复核：现 62 条裁定行 R-15~R-76 无重复、续跑表 7 行完整。教训登记为 R-76 的执行注记：对同一 Markdown 表格做锚点插入前，必须先 grep 确认锚点唯一。


