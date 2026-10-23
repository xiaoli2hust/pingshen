# AGENTS.md · f:\workbuddy\9

唯一代码项目是 `review-platform/`（丰图科技项目评审平台 MVP：信息收集 → 各部门前置打灯 → 红黄绿灯研判 → 归档）。工作区根目录其余内容是方案文档与工具产物，不含可运行代码。

## 命令

PATH 上的 `node` 是 v18，跑任何脚本都会 `No such built-in module: node:sqlite`（已实测）。必须用 workbuddy 托管的 Node 22：

```powershell
$N = "C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
cd f:\workbuddy\9\review-platform
```

**第二个运行时：Python。** `review-platform/tools/parse_form_xlsx.py`（附1 评审表 + 预算表）与 `tools/parse_delivery_xlsx.py`（附3 交付明细）由 `server.js` 的 `runPython()` 以 `python -X utf8` 调用，`tests/test_parser_audit.js` 直接 spawn 同一入口。本机实测 `python` = Python 3.12.10、`openpyxl` 3.1.5；仓库内没有 requirements.txt 之类的版本声明，以这两个实测值为口径。python 或 openpyxl 缺失、文件非对应模板时，相关端点返回 502 并提示 `python/openpyxl 不可用`——先看提示再排查，不要当成业务判定失败。换机或换人先按实测值就位，再跑 PA / PL 套件。

| 目的 | 命令 |
|---|---|
| 启动服务（端口 8600） | `& $N server.js` |
| 一键全回归（**需服务已启动**；套数与顺序以 `tests/run_all.js` 的 `SUITES` 为准） | `& $N tests\run_all.js --log=tests\green_run.txt` |
| 规则矩阵 E2E（走 `preview-light` dry-run，不落库） | `& $N tests\test_rules_e2e.js` |
| 判例锚定回归（灯态不变式） | `& $N tests\data_feasibility_check.js` |
| 解析器全字段对账（原表逐格审计，走 python） | `& $N tests\test_parser_audit.js` |
| 解析器实验室（admin 上传实测 + 关键词调优） | `& $N tests\test_parser_lab.js` |
| 语法检查 | `& $N --check server.js`（finance.js / agent.js / public\app.js 同） |
| 人工验收（playwright + 截图） | `& $N tests\h_manual_check.js` |

Node 目录名会随 workbuddy 升级变化，失效时去 `...\binaries\node\versions\` 看实际存在的目录，并同步改 `start.bat`。

## 铁律

1. **零 npm 依赖**。只用 Node 22 内置模块（http / fs / path / crypto / node:sqlite）。本机无 C++ 编译器、npm 极慢、GitHub 不通，任何需编译的原生模块都装不上。唯一例外是 `E:\npm-global\node_modules\playwright`，只服务人工验收脚本，不进运行时。
2. **LLM 边界**。LLM 只做「口语 → 结构化字段」翻译和「缺项 → 追问」两件事。**判灯、算账、锁定 / 提交 / 结论确认永不出代码**。LLM 失败必须自动降级为点选问答，且 HTTP 仍返回 200。
3. **`config.json` 永不入 git**（真实 DeepSeek key + REPORT_SECRET）。四键：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` / `REPORT_SECRET`。REPORT_SECRET 首启自动生成并写回，写回时必须保留其余三键。
4. **中文一律 UTF-8，且禁止用 shell 读写**。源码与测试证据都是 UTF-8；PowerShell `Get-Content` / `>` / `Tee-Object` 会经控制台代码页把中文不可逆损坏。证据必须由脚本内部 `fs.writeFileSync(path, log, 'utf8')` 落盘。同理，`node -e` 内联脚本经 PowerShell 传递会吞 `$`、`§` 等字符——跨文件校验请落成临时 js 文件执行后删除。
5. **不擅自改用户全局配置**（git config / 环境变量 / PATH），给出的命令必须可直接复制粘贴。

## 改动纪律

- 动骨架前先备份：`Copy-Item server.js,public\app.js,data\review.db .bak_stage<N>_<日期>\`；整阶段回滚 = 还原该三件套。❗ `.bak_*` 只能整阶段回滚、不能 diff、无法排序，一旦仓库有了首个 commit 就以 git 为主、`.bak_*` 降为临时手段，不再新增无日期的语义命名备份目录。
- 计算与判定逻辑改动，必须跑既有回归并命中**源自真实原件的锚定值**（`tests/fixtures/pl8572.json` 六组、`tiandi.json` 十项）。禁止拿推断值当期望值。
- 新用例先取**红证据**（旧代码必须 FAIL 且非破坏基线全 PASS），再改代码取绿；红绿日志都留在 `tests/`。
- 判例修正类改动各留一行回退注释并绑定专用编号用例，做到可单行反转而不影响其他规则。
- 收紧既有免登录端点的鉴权属破坏性变更：先 grep 出全部消费方（测试脚本 + 前端链接）再同批改，否则回归基线会在收工门前才断裂。
- 完成声明必须附真实命令输出；文件状态类断言先实测证伪再落笔。

## 当前进度：本文件不记录进度，一律实测

开发在多个对话框并行推进，源码一天内多次变动，任何写死的进度或套数都会在几十分钟内失真（本文件已因此漂移两次）。判断现状只认下列实测：

| 想知道 | 怎么实测 |
|---|---|
| 阶段任务清单与验收标准 | `docs/开发详细设计.md` §3~§6（唯一权威任务表） |
| 某组件是否已落地 | `Test-Path notify.js`；`Select-String -Path server.js -Pattern "preview-light|/decision" -Encoding utf8` |
| 回归覆盖面 | 读 `tests/run_all.js` 的 `SUITES` 数组（每阶段新增，勿引用旧数字） |
| 最近一次收工门结论 | `tests/green_*.txt` / `red_evidence_*.txt` 的文件时间与末行 |
| 代码改动史 | `git log --oneline`（改动归属）；`git diff` / `git diff --stat`（当前变更边界）；`git ls-files`（是否已被跟踪） |

**版本管理现状（接手必读）**：仓库已建立真实提交历史（分支 `main`），回滚与改动归属一律以 git 为准：`git log --oneline` 查改动史、`git diff` 定当前变更边界、`git revert` 回退。`review-platform/.bak_*/` 手工快照已降级为动骨架前的临时手段（命名无法排序、无法 diff，勿再当版本管理用）。并行会话共用一个工作区时，每完成一项独立改动只提交自己改的文件（`git add <文件>`，**勿 `git add -A`** 吞掉其他会话未提交的变更）。依赖 diff 的评审技能（`code-review` / `code-review-expert` / `business-rules-validation`）现在可用，指向具体提交或工作区差异即可。⚠️ 仍需人工判断新鲜度的只有 Qoder 知识中心：wiki 若生成于建立提交历史之前（元数据 `last_commit_id` 全零、分支为魔法占位名），无法自判过期——**引用任何架构知识或 wiki 结论前，先比对其生成时间与源文件 `LastWriteTime`。**

## 按需深入（不要一次性全读）

| 要什么 | 读哪 |
|---|---|
| 角色 / 状态机 / API 清单 / 演示账号 | `review-platform/HANDOFF.md` — ⚠️ 2026-10-08 版，其 §7.4 与 §10「报告免登录可访问」已被阶段 1.5 的 HMAC 签名鉴权推翻，一律以 `server.js` 实现为准 |
| 四阶段任务表 + 逐任务设计 | `review-platform/docs/开发详细设计.md` |
| 用例矩阵与放行门标准 | `review-platform/docs/测试方案.md` |
| 架构总纲 | `review-platform/docs/技术落地方案.md` |
| 业务全流程视图 | `review-platform/docs/总体流程与建设方案.html` |
| Excel 导入解析契约与字段映射（附1/附3 模板口径） | `review-platform/docs/Excel导入产品方案.md` |
| 历史数据承接口径（存量单导入） | `review-platform/docs/历史数据承接方案.md` |
| 归档库 BI 视图设计 | `review-platform/docs/归档库BI产品方案.md` |
| 协作环境体检结论（本地产物，已 gitignore） | `.qoder/better-harness/<日期>/<时间>-<target>/findings.json` |
