# 项目评审平台 · 接手手册（HANDOFF）

> 适用对象：接手本项目的新大模型 / 新开发者。请先读完本文件再动代码。
> 最后核对时间：2026-10-08

---

## 0. 一句话目标

把丰图科技《项目评审管理规则》里的 **信息收集 → 前置评审(各部门打红黄绿灯) → 红黄绿灯综合研判 → 归档** 全流程线上化。评审会（部门级/XO 级）仍线下开，系统负责"收材料、派评审、算灯态、出报告、存档案"，并在会前给领导推风险卡片（后续阶段）。

---

## 1. 项目在哪个文件夹

**绝对路径：`F:\workbuddy\9\review-platform\`**

启动后访问：`http://localhost:8600` （局域网同事用 `http://<本机IP>:8600`）
双击启动脚本：`F:\workbuddy\9\review-platform\start.bat`

---

## 2. 2026-10-08 排障实录（已全部修复，勿再按旧结论操作）

> ⚠️ 原版 HANDOFF 曾断言"index.html 引用的 app.v2.js 是 86 行残缺副本，页面必然空白"。**经实测证伪**：app.v2.js 实为 573 行完整前端（含 P1.5 全部修正），语法检查通过、浏览器实测正常渲染。当时的真实断点只有一个：**服务未运行**（另加 start.bat 里 Node 路径失效）。

- 问题 A（已解决）：前端双文件混淆。历史原因：09-24 实施 P1.5 时 app.js 被宿主预览进程锁定，改动被迫写入 app.v2.js；旧版 app.js 缺"全员可见"修正。**已把 app.v2.js（P1.5 完整版，35164 字节）固化进 app.js，index.html 改指 /app.js，app.v2.js 已删除**。改动前原件备份在 `.bak_20261008/`。
- 问题 B（已解决）：服务未运行。已用正确 Node 启动，端口 8600。
- 问题 C（已解决）：start.bat 原写 `node\versions\22.22.2-3\node.exe`（该目录已不存在，workbuddy Node 已升级）。**已改为 `22.22.2-6`**。
- 验证证据（2026-10-08）：`node --check` 三文件全过；test_flow.js **ALL PASS**（真实案例黄灯-部门级判定一致）；浏览器实测登录/工作台/详情/两步向导全部渲染正常、控制台 0 报错；fde1（普通角色）可见"全部评审单(全员可见·只读)"；DeepSeek fill-budget 接口调用成功。

> 服务当前运行中，用 `sales1` / `123456` 登录即可看到完整功能。

---

## 3. 技术栈与为什么这么选

| 项 | 选择 | 原因（接手者务必理解） |
|---|---|---|
| 运行时 | Node.js 22 免安装版 | 公司禁止装 exe/msi，用 workbuddy 托管的 node |
| 后端依赖 | **零 npm 依赖** | 用内置 `http` + `node:sqlite`。公司网络 npm 极慢、GitHub 不通、机器**无 C++ 编译器**，任何需编译的原生模块都装不上。新增依赖前先确认能零编译！ |
| 数据库 | SQLite 单文件 `data/review.db` | 免部署；备份=复制一个文件。迁移靠 `db.exec('ALTER TABLE ...')` 包 try/catch（见 server.js 顶部） |
| 前端 | 原生 HTML/JS 单页（无框架、无构建） | 改完即生效，适合快速迭代 |
| 附件 | 本地磁盘 `data/uploads/<单据id>/`，≤10MB | 内网无对象存储依赖 |
| AI | 服务端代理调 DeepSeek（见第 9 节） | 规则引擎已够用，AI 只做"预算文字识别填充"和预留"报告润色" |

---

## 4. 目录结构与文件职责

```
review-platform/
├── server.js              # ⭐ 后端全部逻辑：路由 / 状态机 / 研判规则引擎 / SQLite 建表 / LLM 代理
├── public/
│   ├── index.html         # 入口页，引用 /app.js
│   ├── app.js             # ⭐ 完整前端 SPA（573 行，P1.5 完整版：两步向导+全员可见+在线预算表+评审弹窗）
│   └── style.css          # 样式
├── data/                  # 运行生成：review.db + uploads/  （勿删；备份=拷这个目录）
│   └── uploads/
├── .bak_20261008/        # 2026-10-08 整合前原件备份（旧 app.js/app.v2.js/index.html/start.bat），稳定后可删
├── config.json            # ⚠️ 存 DeepSeek key（真实密钥，勿外发/勿提交 git）
├── start.bat              # 双击启动（已设 NODE_TLS_REJECT_UNAUTHORIZED=0）
├── test_flow.js           # 端到端联调脚本（填单→提交→退回→再提交→研判→归档）
├── test_p15_flow.js       # P1.5 互补回归：在线预算表闭环（提交放行+研判优先用精算毛利率）+ 退回-再提交闭环(round+1)，2026-10-08 新增
├── README.md              # 设计/功能说明（偏文档）
└── docs/设计规划与开发方案.html  # 规划方案（含 P1.5 两项修正的目标设计）
```

---

## 5. 角色与演示账号（密码均为 123456）

| 账号 | 角色 role | 职责 |
|---|---|---|
| sales1 | 销售经理 | 填单（售前立项/投标决策）、改单、重提交、看报告 |
| pm1 | 项目经理 | 填单（关键事项决策），其余同 sales1 |
| fde1 | FDE | 收本部门指标任务、打灯+意见、退回 |
| fin1 | 财务BP | 同上（财务类指标、客户信誉） |
| pur1 | 采购BP | 同上（分包类指标） |
| legal1 | 法务 | 同上（转包/背靠背/担保类指标） |
| comp1 | 合规BP | 同上（合规风险） |
| data1 | 数据BP | 同上（数据合规性，投标决策特有） |
| zhichizu | 销售支持组 | 全部单据监控、手动重跑研判、归档（相当于管理员） |

权限模型：**看得见 ≠ 动得了**。详情页对所有登录用户只读；只有申请人能改单/提交，责任部门能打灯，销售支持组能归档/重研判。

---

## 6. 业务主流程（状态机）

```
draft(草稿)
  │ 提交（必须已填预算表，见第 8 节）
  ▼
reviewing(前置评审中) ──任一评审人"退回"──▶ returned(退回修改)
  │                                        │ 修改后重新提交（round+1，旧任务作废留痕，新任务重分发）
  │ 全部指标打灯完成                        │
  ▼ ◀──────────────────────────────────────┘
judged(已研判：综合灯态 + 评审路径 + 报告)
  │ 红灯 → 申请人可修改后重新提交
  │ 销售支持组归档
  ▼
archived(已归档，材料+报告入库)
```

- 前置评审任务按"指标责任矩阵"在提交时**自动分发**给对应部门（`INDICATORS` 配置里每项带 `dept`）。
- 最后一项指标打灯完成 → 系统**自动跑规则引擎**出灯态（`judge()`），无需人工触发。
- 退回修改闭环：评审人对任一指标可"退回"填意见 → 单据回申请人 → 修改 → 重提交。

---

## 7. 核心业务规则（研判逻辑，写在 server.js 的 `judge()` 与 `INDICATORS`）

### 7.1 三类评审单与前置评审指标
- **投标决策(bid)**：10 项指标 — 分包占比、测绘分包占比、贡献利润(毛利率)、合同金额、运维周期、指定类分包、签约转包次数、担保/竞业、结算方式、合规风险、数据合规性。
- **售前立项(presale)**：5 项 — 售前投入、投入占比、实施周期、签单时间、客户过往合作信誉。
- **关键事项(change)**：交付成本变动、变更后毛利率、变更后金额、超进度支付等。

### 7.2 量化指标自动判（按表单数值，阈值与规则文件一致）
- 分包占比：`≥40%` 黄、`≥70%` 红
- 测绘分包占比：`≥40%` 黄
- 贡献毛利率：`<0%` 黄(且触发杜总)、`<10%` 黄；**研判优先读取在线预算表精算的毛利率**（标注"取自在线预算表"），表单粗填值让位
- 合同金额：`≥500万` 黄 + 触发 XO + 触发杜总
- 运维周期：`>3年` 黄 + 触发 XO + 触发杜总
- 指定类分包：`>0` 黄 + 触发 XO + 触发杜总
- 签约转包次数：= 签约路径层数 − 1（**注意：真实规则是层数减 1**，如 4 层路径=3 次转包→黄）。`≥3次` 黄、`≥5次` 红
- 担保/竞业：有即黄 + 触发 XO
- 结算方式：商业承兑汇票为红线(红)

### 7.3 综合灯态与升级路由
- 综合：任一红→红(打回)；任一黄→黄(上会)；全绿→绿(免上会)。
- 命中 XO 条件（运维>3年 / 毛利<0 / 金额≥500万 / 提前投入≥50万 / 分包≥70% / 担保 / 竞业 / 指定供应商）→ 评审路径标 **XO 级**。
- 其中 运维>3年、毛利<0、金额≥500万、提前投入≥50万、分包≥70% 五项额外标 **"需推送杜总"**（为后续会前推送用）。

### 7.4 研判产出
- 自动生成《项目风险评估报告》HTML，版式对齐线下：`/api/reports/<id>.html` **免登录可访问**（为"推领导"准备的载体）。含状态卡 / 项目基础信息 / 风险评估详述(只列红黄灯+当前值+规则) / 前置评审意见汇总 / 会议准备(参会人员+汇报话术+材料清单)。

---

## 8. 已上线功能（2026-10-08 接口+浏览器双重实测通过）

- [x] 登录 + 9 个角色账号
- [x] 三类评审单在线填报（字段 100% 对齐规则 Excel Part A，含必填校验、下拉）
- [x] **预算表前置（P1.5 已落地，2026-10-08 浏览器实测通过）**：新建单 = 第1步基础信息 → 保存跳第2步预算表；提交时**强校验**预算表（在线填 或 上传 Excel 附件，二选一），没预算表不让提交
- [x] **在线预算表**：只填成本项，收入/税金/激励/贡献毛利按财务口径自动算（合同÷1.06、净签单×1727元/万、考核利润×7.7% 等，公式见 app.js `computeBudget()`）
- [x] **AI 识别填充预算表**：粘贴文字 → DeepSeek 抽字段填入（Flash/Pro 可切换）
- [x] 前置评审自动分发 / 各部门打灯+意见 / 退回
- [x] 退回-修改-再提交闭环（round+1）
- [x] 红黄绿灯自动研判 + 报告
- [x] **结果全员可见（P1.5 已落地，2026-10-08 用普通角色 fde1 实测通过）**：`/api/reviews?scope=all` 对所有登录用户开放只读；"全部评审单"列表+详情页（各部门灯态/意见/最终报告）全员可读
- [x] 附件上传（含预算表必传校验）
- [x] 归档库
- [x] 全程流转记录（timeline）

---

## 9. 已接入的大模型（DeepSeek）

- 凭据存本机 `config.json`（**勿提交 git / 勿外发**），结构：
  ```json
  { "LLM_BASE_URL": "https://api.deepseek.com", "LLM_API_KEY": "sk-xxxx", "LLM_MODEL": "deepseek-chat" }
  ```
- 接口：`POST /api/llm/fill-budget`，body `{ text, model }`，`model` 可选 `deepseek-chat`(Flash 快速版) / `deepseek-reasoner`(Pro 增强版)。
- 服务端代理，凭据**不落前端**。
- **网络坑（重要）**：公司防火墙会 reset Node 原生 TLS 出站连接。server.js 里 LLM 请求走系统通道转发（已内置处理）；`start.bat` 已加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 应对公司自签 MITM 证书。若换环境后 AI 调不通，先查这两处。
- 也可切换回公司网关：把 config.json 换成 `ANTHROPIC_BASE_URL` 对应地址（但公司网关当前回"不再支持个人工号"，已失效）。

---

## 10. API 接口清单（接手者改前端/对接用）

| 方法 | 路径 | 说明 | 权限 |
|---|---|---|---|
| POST | `/api/login` | 登录，返回 token | 公开 |
| GET | `/api/me` | 当前用户 | 登录 |
| GET | `/api/reviews?scope=mine\|all\|archived` | 列表（all=全员只读） | 登录 |
| POST | `/api/reviews` | 新建（body: type,title,form,submit） | 登录 |
| GET | `/api/reviews/:id` | 详情(含 tasks/events/attachments/budget) | 登录(只读) |
| PUT | `/api/reviews/:id` | 改材料(title,form) | 申请人 |
| GET/PUT | `/api/reviews/:id/budget` | 读/写在线预算表 | 申请人/支持组 |
| POST | `/api/reviews/:id/submit` | 提交评审（校验预算表） | 申请人 |
| POST | `/api/reviews/:id/judge` | 手动重跑研判 | 销售支持组 |
| POST | `/api/reviews/:id/archive` | 归档 | 销售支持组 |
| POST | `/api/reviews/:id/attachments` | 上传附件(base64) | 登录 |
| GET | `/api/tasks?scope=mine` | 我的待评审任务 | 登录 |
| POST | `/api/tasks/:id/complete` | 打灯+意见(light,opinion) | 责任部门 |
| POST | `/api/tasks/:id/return` | 退回(opinion 必填) | 责任部门 |
| POST | `/api/llm/fill-budget` | AI 识别预算文字 | 登录 |
| GET | `/api/reports/:id.html` | 正式研判报告（**免登录**） | 公开 |

---

## 11. 数据模型（表，建表语句见 server.js 顶部）

- `users(id, username, password_hash, name, role, dept)`
- `reviews(id, type, title, applicant_id, applicant_name, status, round, light, route, report, report_html, budget_json, form_json, created_at, updated_at, archived_at)`
- `tasks(id, review_id, round, ind_key, ind_name, dept, standards, status, light, opinion, done_by, created_at)`
- `events(id, review_id, action, actor, detail, created_at)`
- `attachments(id, review_id, field, filename, filepath, uploaded_at)`

---

## 12. 待办路线图（按优先级）

**P1.5（已完成，2026-10-08 验证）**：两步向导、预算表前置、全员可见均已在浏览器实测通过；test_flow.js ALL PASS。当前服务运行中。

**P2（下一阶段）**：
1. 钉钉/邮件通知催办——任务分发、退回、研判完成时自动提醒（钉钉 connector 已连接，可用）
2. 会前风险卡片推送领导（周一汇总 + 会前 1 天），载体就是 `/api/reports/:id.html`，按灯态/级别分流收件人
3. 规则配置后台——阈值改成可配置，不动代码
4. LLM 增强研判——合同条款类文字指标 AI 辅助解读；报告"汇报准备"话术用大模型生成
5. 会上投屏看板 + 会议结论线上录入
6. CRM 商机 / PMS 项目数据打通

---

## 13. 接手建议的"第一周动作"

1. ~~修 index.html + 删 app.v2.js + 启动服务~~（2026-10-08 已完成，见第 2 节排障实录）。
2. ~~跑 test_flow.js 端到端验证~~（已完成：ALL PASS，含真实案例 PL00008572 黄灯-部门级判定核对，与线下一致）。
3. 当前直接从 P2 第 1 项（钉钉催办）开始，这是用户最想要的"不用登录才看见待办"。

---

## 14. 环境坑速查（公司机器）

- 无 C++ 编译器 → 不碰需 node-gyp 编译的依赖，零依赖优先。
- GitHub 不通、npm 极慢 → 新包尽量走预编译或内置模块。
- 公司 HTTPS MITM（自签证书）→ `NODE_TLS_REJECT_UNAUTHORIZED=0` 已写在 start.bat。
- Node 必须用 `C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`（workbuddy 升级会换目录名，失效时去 `versions\` 下看实际存在的目录；start.bat 已改对）。
- 数据备份：`data/` 整个目录拷走即可。
- `config.json` 含真实密钥，交接给外部/提交仓库前务必移除。
