# 前端 UED 优化 · 交互反馈与体验一致性（2026-10-14）

> 状态：spec 初稿（本文为实施前唯一权威口径）。
> 关联：`specs/2026-10-14-frontend-ia-redesign-design.md`（IA 重设计，**正在另一会话实施中**）；`docs/产品方案.md` V3.0。
> **前置依赖：本 spec 的实施排在 IA 收工门（20/20 套 ALL PASS + green_ia.txt 落盘）之后开工**（并行会话错峰纪律，见 AGENTS.md 改动纪律）。文中行号以 2026-10-14 HEAD=7d69a27（IA 代码未落）为准；IA 落地后行号漂移，按函数名+症状对齐。

## 0. 背景与现状诊断

IA 重设计解决"页面在哪、入口收敛"（信息架构）；本 spec 解决"用起来的手感"——**等待可见、动作安全、键盘可达、视觉一致、动效克制**。诊断全部来自对 `public/app.js`（2014 行）与 `public/style.css`（504 行）的逐行实测，不是感觉评价：

| # | 症状（实测证据） | 根因 | 严重度 |
|---|---|---|---|
| D1 | 列表搜索每敲一次字停顿 300ms 后输入框失焦、光标消失 | `setFltQ`（app.js:202-207）防抖后 `rerenderPage()` → `renderRoute` 整块 `innerHTML` 重建，`arcFilterBar` 的 input（app.js:198）虽回填 value 但焦点不还原 | P0 |
| D2 | 两条及以上 toast **完全重叠在同一坐标**（都 `position:fixed; top:18px`，style.css:453-461），后条盖前条；且无 `aria-live`，读屏不可感知 | `toast()`（app.js:107-113）逐个 append 固定定位 div，无容器无栈 | P0 |
| D3 | 归档存储/重新提交评审/重新研判/退回申请人，四类**不可逆或大影响动作点一下立即执行**，无任何确认（全库仅 labClearMap app.js:1910 有 confirm） | 逐函数硬编码（app.js:621/639/643/700），无统一动作门 | P0 |
| D4 | 路由切换期间旧页面原样滞留，**无任何加载指示**（`showLoading` app.js:298-300 仅在页面为空时写一行"加载中…"）；renderDetail（app.js:502-504）连 showLoading 都没有，且无慢页竞态守卫（renderDashboard app.js:314 已有该模式） | 反闪烁修复（保留旧内容防闪黑）顺手消灭了加载反馈，未补替代信号 | P0 |
| D5 | 除对话发送（app.js:1107 '思考中…'）与 AI 识别（app.js:818 '识别中…'）外，**约 15 个提交/保存/上传动作无 in-flight 态**：按钮可连点，双击=重复请求 | 逐处手写，未形成 busy() 约定 | P1 |
| D6 | 打灯弹窗（openTask app.js:661-683）：无 Escape 关闭、无背景点击关闭、无初始焦点、无焦点圈禁、无 `role="dialog"`/`aria-modal`；黄/红灯时"意见必填"仅静态 label 提示（app.js:675），不随所选灯态动态显红 | 手写 DOM，无通用模态壳 | P1 |
| D7 | 键盘 Tab 导航不可见：仅 `.btn:focus-visible`（style.css:260）有焦点环；侧边栏导航、tabs、表格链接、灯选按钮全部无焦点样式 | focus-visible 规则只覆盖了按钮 | P1 |
| D8 | 深色主题下**残留 4 处浅色主题硬编码**：attField 下拉 `border:1px solid #d8d9de`（app.js:529）、毛利色 `#A32D2D/#27500A`（app.js:541）、待我评审行分隔线 `border-bottom:1px solid #f0f1f4`（app.js:546，深底上刺眼白线） | 视觉翻新时漏扫内联样式 | P0 |
| D9 | 同一控件样式在 5+ 处内联重复（arcFilterBar app.js:198、histDate app.js:1955、关键词输入 app.js:1759、attField app.js:529…），各自漂移（attField 即因此残留浅色边框） | 无小组件类，逐处复制 | P1 |
| D10 | 从长页（归档库）切到短页，视口停在半屏处不回顶（全文件无 scrollTo，hashchange 监听 app.js:2014） | 路由切换无滚动复位 | P1 |
| D11 | 窄屏（≤1024px，style.css:468-476）侧边栏变**匿名圆点**：文字 font-size:0、无 title、无图标，8 个导航项不可辨识（1024~1280 笔记本宽度常驻区间） | 折叠方案只考虑了宽度没考虑可辨识性 | P1 |
| D12 | 空态全局一种表达（.empty 虚线圆 style.css:335-345），"无数据""筛选无命中""无权限"混用同一句 | 空态无分级 | P2 |
| D13 | 图表柱/指标数值瞬间出现，无入场动效；`.bar-col i` 虽定义了 `--chart` 过渡（style.css:499）但只在高度变化时才生效，初次渲染不触发 | 动效只做了一半 | P2 |
| D14 | 原生 `window.prompt` 建预算单名称（app.js:918）与深色 UI 割裂，且阻塞 playwright（h_manual_check.js:33/94 被迫 `page.once('dialog')` 适配） | 唯一一个原生弹窗漏网 | P1 |

**既有良好底子（保留并放大）**：完整 design token 体系（style.css:7-69）、`prefers-reduced-motion` 全局兜底（style.css:483-485，新动效自动纳入）、反闪烁 shell 单建策略（app.js:114-119）、表格行 hover/按钮 active 位移、`tabular-nums`、双栏核对琥珀聚焦动效（impRvPulse）。本 spec 是在这个底子上补反馈与一致性，**不是推翻**。

## 1. 目标与非目标

**目标**
1. 所有等待可见：请求级顶部进度条 + 空页结构化骨架 + 按钮统一 in-flight 态。
2. 不可逆动作有统一确认门（confirmAction 模态），退回类动作改动态启用而非事后报错。
3. 键盘与读屏可用：focus-visible 全覆盖、模态焦点管理、tabs 键盘模式、toast aria-live。
4. 视觉一致性清零浅色残留；内联控件样式收编为组件类；关键页统一页头。
5. 动效克制可关：路由进入渐显 + 图表入场，全部吃 reduced-motion。
6. 红绿闭环：新套件 `tests/h_ued_shots.js`（UED-01~16），run_all 由 IA 后的 20 套增至 21 套，全 PASS。

**非目标（明确不做）**
- 不改 IA 信息架构、路由表、角色导航（那是 IA spec 的领地；本 spec 只叠加品质层）。
- 服务端**零改动**（一个端点都不加）。
- 不做表格排序/列宽拖拽等数据交互增强（数据口径归 IA/BI 线，避免双线冲突）。
- 不做浅色主题/主题切换（产品语言=深色驾驶舱，index.html `color-scheme:dark` 已固化）。
- 不引入图标字体/SVG 图标集/npm（零依赖红线）；窄屏侧边栏用文字缩写不用图标。
- 不给灯色加呼吸/闪烁类持续动效——研判场景要静态可读，注意力不被动画劫持（设计决策）。

## 2. 分域设计（U-A ~ U-F 六个工作流）

### 2.1 U-A · 等待可见性

**A1 请求级顶部进度条（instrument api()，零侵入）**
- 在 `api()`（app.js:90）内埋点：fetch 发起 120ms 未返回才显示（短请求无感知），返回即完成并 200ms 淡出。
- 形态：`position:fixed; top:0; left:0; height:2px` 的品牌色进度条 + 伪进度（前 80% 用 `width` 缓动逼近，完成跳 100%），z-index 高于内容、低于 toast。
- 同时给 `#page` 置 `aria-busy="true"`，完成后移除。
- 只改 api() 一处，60+ 调用点零改动；`apiCached`（app.js:289）命中路径不触发（同步返回，无等待）。
- **不触碰 shell 与 #page DOM 结构**——h_flicker/h_flicker2 的反闪烁断言不受影响。

**A2 空页结构化骨架（showLoading 升级）**
- `showLoading(page)`（app.js:298-300）从一行"加载中…"升级为按页面类型的骨架：metric 瓦片骨架 ×4 + 表格头 + 3 行 shimmer 占位（纯 CSS `background` 渐变动画，reduced-motion 下退化为静态灰块）。
- 首访（空页）用骨架；有旧内容时保持现状（不清空不闪），由 A1 的进度条承担"在加载"的信号。**两者互补，反闪烁策略原样保留。**

**A3 按钮统一 in-flight 态（busy 约定）**
- 新增公共 helper `busy(btn, on, pendingText)`：置 `disabled` + 文案换 pendingText（默认原文案+'中…'），finally 复原。
- 覆盖清单（15 处，均为无 in-flight 的变异动作）：submitReview、resubmit、submitDecision、rejudge、archive、uploadAtt、completeTask、returnTask、saveBudget、agentFillSubmit、deliverySave、deliveryImport、importReviewExcel、importHistoryExcel、labSaveMap2、saveLlmConfig、doLogin。
- 对话发送（sendAgentMsg/sendAgentReviewMsg）与 aiFillBudget 已有正确实现，改写为调用同一 helper（行为不变）。

**A4 慢页竞态守卫补齐**
- renderDetail、renderBudget、renderDeliveryReview 等未带守卫的 await 页面，统一补 `h0` 守卫（模式照抄 app.js:314）——防慢请求返回覆盖已切走的新页（IA spec §2.3 已为新页立此规矩，本项把存量页拉齐）。

### 2.2 U-B · 动作确认与安全网

**B1 通用确认模态 confirmAction(opts)**
- 新公共函数，复用 .modal-mask/.modal 样式：`{title, body, confirmText, danger}`；danger=true 时确认按钮用 .btn.dan。
- 接入四类不可逆/大影响动作：归档存储（archive app.js:643）、重新提交评审（resubmit:621，会重新分发前置任务）、重新研判（rejudge:639）、labClearMap（1910，原生 confirm 换掉）。
- **消费方实测**：tests/ 全目录 grep 无任何脚本点击这些按钮（2026-10-14 实测），加确认门对既有回归零破坏——这是本项可行性的关键证据。
- 退回申请人（returnTask:700）**不加确认**，改为动态启用：openTask 内监听意见 textarea input，选黄/红灯且意见为空时"退回申请人修改"与"提交评审结论"禁用 + label 变红（黄/红灯必填的前置表达），从"事后 toast 报错"变"事前可见"。

**B2 prompt() 替换**
- agentNewBudget（app.js:918）的 `window.prompt` 换为小模态（输入框 + 确定/取消），样式同 confirmAction。
- **同批必改消费方**（实测仅两处）：`tests/h_manual_check.js:33`（`page.once('dialog', d=>d.accept('天地图预算-H验收'))`）与 `:94`（同型）——改为模态内填写输入框后点确定。漏改则 H 验收脚本挂死在等待原生对话框上。

**B3 确认模态键盘语义**（与 U-C 的 openModal 壳共用，见 2.3）

### 2.3 U-C · 键盘与可达性

**C1 通用模态壳 openModal(html, {label, onOpen, onClose})**
- 把 openTask（app.js:661-683）的手写 mask 改为走公共壳，一次获得：`role="dialog"` `aria-modal="true"` `aria-labelledby` → 打开时焦点入模态首个可交互元素（打灯场景=绿灯按钮）→ Tab/Shift+Tab 圈禁在模态内 → Escape 与背景点击关闭 → 关闭后焦点还原到触发按钮。
- openTask 的 DOM 结构与按钮文案**一字不动**（.light-pick 按钮文本是 H 测试锚点）；只包壳不改内容。
- confirmAction 与 B2 的输入模态都基于此壳。

**C2 focus-visible 全覆盖（一条 CSS 规则）**
- `:is(.sidebar nav a, .tabs button, .light-pick button, table a, .pill[onclick], a[onclick])` 补 `:focus-visible { outline: 2px solid var(--brand-border); outline-offset: 2px; }`——与 .btn 现行焦点环同款（style.css:260）。

**C3 tabs 键盘模式（面向 IA 落地后的 360° 七标签与任务中心 tab）**
- `.tabs`（style.css:358-360，**当前 CSS 在库、JS 无使用方**——360° 七标签将是首个真实消费方）升级为标准 tablist 交互：`role="tablist"/"tab"`、`aria-selected`、左右方向键切 tab、Tab 键跳出列表。
- 实施时逐页接线：renderOpp360 七标签（?t= 同步 hash）、renderTasksCenter 的 setTaskTab（app.js:1613）。IA 会话先交付行为（点选切换），本 spec 叠加语义与键盘——两线不抢同一代码时段。

**C4 toast 可达**
- 见 D2 修复（2.5 内 E1 前置）：容器化后普通 toast `role="status"` + `aria-live="polite"`，错误 toast `role="alert"`。

### 2.4 U-D · 视觉一致性

**D1 浅色残留清零（4 处，换 token）**
| 位置 | 现值 | 换为 |
|---|---|---|
| app.js:529 attField 边框 | `#d8d9de` | `var(--border-default)` |
| app.js:541 毛利低值色 | `#A32D2D` | `#ef7b84`（danger 同族，与 .p-red 文字一致） |
| app.js:541 毛利高值色 | `#27500A` | `#35b892`（success 同族，与 tone-green 一致） |
| app.js:546 待我评审行分隔 | `#f0f1f4` | `var(--border-subtle)` |

**D2 小组件类收编内联样式（只新增类名，不删改既有类）**
- `.ctl-sm`：统一 arcFilterBar 搜索框（app.js:198）、histDate（1955）、实验室关键词输入（1759）、attField（529）的小尺寸控件样式——一处定义，四处替换内联。
- `.page-head`：页头模式（页面标题 + 副标题左、动作按钮右），先落在 IA 后的首页/商机列表/360° 三个新页（它们由 IA 会话产出，本 spec 实施期统一加壳），旧页不回头改（避免大面积 diff）。
- 行内提示条 `.row-line`：renderDetail 待我评审行（app.js:546）的 flex+分隔线结构。
- ⚠️ 类名即测试选择器锚点：新类名先全局 grep 确认无撞名再落。

**D3 空态分级**
- `.empty` 保留样式，增加两档语义：`data-kind="nodata"`（真无数据，文案"暂无…，等待新单据"）与 `data-kind="nofilter"`（筛选无命中，文案"没有符合条件的记录" + **一键清除筛选**按钮）；360° 404 空态（IA spec §2.3 已定义）沿用 `data-kind="nodata"` + 新商机入口。
- 仅改文案与可选按钮，不动 .empty 的 DOM 结构（H 测试多处断言 `.empty` 存在性）。

### 2.5 U-E · 动效层（克制、可关、不碰灯色）

**E1 toast 容器化与出场动画（修复 D2 重叠）**
- `#page` 外新增 `#toastBox`（fixed, top:18px, 居中, flex column, gap 8px，z-index 200）——`toast(msg, err)` 签名不变（84 处调用零改动），内部改为 append 进容器。
- 栈上限 3 条：超出时最旧一条立即出场（避免长会话堆积）。
- 入场沿用现有 toast-in；出场新增 160ms 淡出下沉；错误 toast 左边条 danger 色 + `role="alert"`。
- ⚠️ toast 现有选择器 `.toast` 类与结构保留（若有测试断言 .toast，兼容）。

**E2 路由进入渐显（只动画路由切换，不动画筛选重渲染）**
- hash 真实变化（render 判定，非 rerenderPage）时给 #page 置 `data-enter="1"`，CSS 对 `#page[data-enter] > *` 做 140ms 透明度+6px 上移入场，300ms 后移除属性。
- `rerenderPage()`（筛选/搜索原地重渲染）**不置属性**——每敲一个字都动一下是最差的动效滥用。
- reduced-motion 下自动无效（全局兜底已存在）。

**E3 图表入场（bar-cols 生长）**
- renderArchive 的 bar-cols（app.js:1964/1968/1971）初次渲染高度 0 → requestAnimationFrame 后置目标高度，吃已有 `--chart` 过渡（style.css:499）；sparkline 与 dist-bar 不加（信息密度页保持静默）。
- 灯色相关元素（.pill/.light-banner/.dot）一律不加动画——见非目标。

### 2.6 U-F · 导航与滚动

**F1 路由切换滚动复位**：render() 内 hash 变化时 `window.scrollTo(0,0)`（记录 lastHash，筛选重渲染不触发）。
**F2 窄屏侧边栏可辨识（≤1024px）**：匿名圆点改两字缩写——`.sidebar nav a` 折叠态恢复 `font-size:11.5px` 显示导航项前两字（首页/商机/新建/待办/研判/归档/设置/实验），导航文案全部 ≤4 字且前两字互不冲突（IA 新导航文案已满足）；同时给每个 nav a 补 `title` 全称。侧边栏宽 60px：2 字 ×11.5px ≈ 24px + padding，可容纳。
**F3 整行命中区（配合 IA 行点击）**：商机列表行点击 → 360°（IA renderOppsList）后，行 `cursor:pointer` + hover 底色加深已有，补"标题列之外任意 td 点击等效"（或行内显式 → 按钮）。仅新页实施，旧列表保持链接点击。

## 3. 服务端改动

**零。** 全部改动限于 `public/app.js`、`public/style.css`、`tests/h_ued_shots.js` 及既有 H 测试的两处同批修订（h_manual_check.js:33/94）。

## 4. 测试策略（红绿纪律）

### 4.1 新套件 `tests/h_ued_shots.js`（UED-01~16，playwright，截图+DOM+计算样式断言）

| 用例 | 断言要点（旧代码必红/新代码必绿） |
|---|---|
| UED-01 toast 栈 | 连发 2 条 toast，两元素 top 坐标不同（容器 gap 生效，不再重叠） |
| UED-02 toast 语义 | 容器存在；err toast 有 role=alert；普通 toast role=status |
| UED-03 搜索焦点保持 | 在商机列表搜索框键入 → 等 400ms（防抖过）→ `document.activeElement` 仍是该 input 且 selectionStart 在末尾 |
| UED-04 归档确认门 | 点"归档存储"→ 出现 .modal-mask 确认框（未发请求，路由拦截计数=0）→ 点取消 → 状态不变；点确认 → 请求发出（route 拦截验证） |
| UED-05 按钮 in-flight | route 拦截延迟 API 800ms → 点提交 → 300ms 内按钮 disabled 且文案含"…"；响应后复原 |
| UED-06 进度条 | route 延迟 600ms（>120ms 阈值）→ 请求期间 #page 有 aria-busy 且顶部进度条可见；完成 400ms 后消失 |
| UED-07 模态键盘 | 打开打灯弹窗 → 焦点在绿灯按钮；按 Escape 弹窗关闭且焦点回触发按钮；Tab 循环不出模态（首尾元素环绕） |
| UED-08 模态 aria | mask 有 role=dialog + aria-modal=true |
| UED-09 焦点环可见 | 键盘 Tab 到侧边栏导航链接 → computed outline 非 none |
| UED-10 浅色残留清零 | attField 毛利率元素 computed color ≠ #A32D2D/#27500A；待我评审行分隔线 computed borderColor ≠ rgb(240,241,244) |
| UED-11 滚动复位 | 归档页 scrollTo(0, 800) → 切首页 → scrollY===0 |
| UED-12 窄屏导航可辨识 | viewport 1024×768 → nav a 有 title 属性且文本非空（缩写可见） |
| UED-13 空态分级 | 无筛选命中 → .empty 内有"清除筛选"按钮且点击后行恢复 |
| UED-14 路由进入动效 | hash 切换后 #page 有 data-enter 属性且 400ms 后被移除；筛选重渲染不触发（连续两次 rerenderPage 无该属性） |
| UED-15 prompt 退役 | 点新建预算单入口 → 出现 .modal-mask 输入框（无原生 dialog 事件，`page.on('dialog')` 计数=0） |
| UED-16 reduced-motion | `page.emulateMedia({reducedMotion:'reduce'})` → 渐显元素 computed animationName 为 none |

- 截图 `shots/H_UED_1~6`（进度条/确认模态/toast 栈/骨架/窄屏导航/打灯焦点管理）。
- 日志 `red_ued.txt`/`green_ued.txt` 由脚本内 `fs.writeFileSync(path, log, 'utf8')` 落盘（铁律 4）。
- 红基线中 D 类缺陷断言（01/03/04/07/10/11/12/15）在旧代码 FAIL，防御断言（.toast 结构、.empty 存在）PASS——证明非破坏性。

### 4.2 既有套件同批修订（实测消费方，仅 2 处）

- `h_manual_check.js:33、:94`：`page.once('dialog')` 原生 prompt 适配 → 改为模态内 `fill` + 点确定（B2 的直接后果）。
- 其余 H 套件（h_flicker/h_ui_shots/h_nav_shots/h_lab_shots/h_ia_shots/h_opp_shots…）**预期零改动**：不动类名、不动按钮文案、不动 shell/#page 结构。跑全回归验证，任一 FAIL 即阻断提交。

### 4.3 回归聚合

- run_all.js SUITES 追加 `['UED-01~16 交互反馈与可达性浏览器层', [NODE, ['tests/h_ued_shots.js']]]` → IA 后 20 套 → **21 套**。
- 收工门：21/21 ALL PASS + red_ued.txt + green_ued.txt。

## 5. 实施顺序

> 前置门：IA 收工门通过（green_ia.txt 落盘、20 套全绿）。若 IA 未收工，本 spec 只读不改码。

1. 写 `tests/h_ued_shots.js` → 未改代码跑出红基线 `red_ued.txt`（含 UED-01/03/04/07/10/11/12/15 FAIL）。
2. **U-B 安全网**（confirmAction + openModal 壳 + prompt 替换 + h_manual 两处同批）——先做破坏面最大、行为最确定的一块。
3. **U-A 等待可见性**（api() 进度条埋点 + showLoading 骨架 + busy() 15 处 + 竞态守卫补齐）。
4. **U-C + U-D** 可达性与视觉一致性（focus-visible 一条规则 / tabs 语义 / 浅色残留 / .ctl-sm 收编 / 空态分级）。
5. **U-E + U-F** 动效与导航（toast 容器化 / 路由渐显 / 图表入场 / 滚动复位 / 窄屏缩写）。
6. 全回归 21 套 → green_ued.txt + green_run_ued.txt → git 提交（只 add 本 spec 改动文件，勿 `git add -A`）。

每步之间旧套件保持全绿（沿用 IA 的超集固化节奏），任一步红了即停即修。

## 6. 不变式（红线）

1. 继承 IA spec §8 全部八条（零依赖/esc()/产品 id 与按钮文本不改/全局作用域/属性选择器带引号/LLM 边界/UTF-8/config 不入 git）。
2. **类名即测试锚点**：不删除、不重命名任何既有 class；新 class（.ctl-sm/.page-head/.row-line/#toastBox）先 grep 全局确认无撞名。
3. **新增按钮文案全局唯一**且避开既有 H 测试 has-text 锚点子串（确认框按钮：`确认归档`/`确认重新提交`/`确认重新研判`/`清除筛选`——落码前逐一 grep tests/ 验证唯一性）。
4. toast()/api()/showLoading() 的**函数签名向后兼容**（84/60+/10+ 处调用零改动）。
5. 反闪烁三件套不动：shell 单建（render app.js:114-119）、旧内容保留策略（showLoading 注释 app.js:297）、rerenderPage 不重建 shell——进度条是 fixed 覆盖层、骨架只在空页，均不触碰该机制。
6. 所有新动效必须被 `prefers-reduced-motion: reduce` 全局规则关闭（style.css:483-485 已兜底，新 keyframes 自动纳入，UED-16 验证）。
7. 灯色表达不加持续动画（非目标 §1）；深色主题不新增任何非 token 硬编码色值。

## 7. 验收标准

1. D1~D14 逐项可指认修复落点（函数名+行为），非"整体感觉变好"。
2. h_ued_shots.js 16 用例全 PASS；red_ued.txt 存在且旧代码 FAIL 数 ≥8。
3. run_all 21/21 套 ALL PASS（含 h_flicker 反闪烁、h_ia_shots IA 断言、h_manual 两处修订后验收链）。
4. 键盘走查：全程不碰鼠标可完成 登录→导航→打灯弹窗（选择灯态、填写意见、提交）→toast 可被读屏 API 感知。
5. 深色一致性走查：renderDetail 页 computed style 无一处浅色主题色值。
6. git 提交含全部证据日志与截图。

## 8. 风险与回退

- 风险 A：与 IA 会话同工作区撞车 → 硬前置门（IA green_ia.txt 落盘后才开工）+ 只提交自己改的文件。
- 风险 B：确认门/模态壳改动破坏既有 H 断言 → 消费方已全量 grep（仅 h_manual 两处），收工门 21 套兜底。
- 风险 C：进度条/动效在慢机器上引入视觉噪声 → 120ms 阈值 + reduced-motion + 140ms 短时长三重克制；UED-06/14/16 断言可关停。
- 风险 D：IA 落地后行号漂移 → 实施时按函数名+症状对齐（本 spec 行号仅作取证快照）。
- 回退：本 spec 六工作流各自独立可 revert；U-B 的确认门每处一个独立提交，可单点撤除恢复"点了就执行"。
