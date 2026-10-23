# Excel 导入通道 · 产品方案（预算单 + 评审单）

| 项 | 内容 |
|---|---|
| 版本 | V1.0（2026-10-09） |
| 背景 | Excel 导入通道已有附3（交付明细）；用户提出预算单和评审单也应支持上传 Excel——真实模板（附1-预算表/信息收集表）均为键值对布局，已实测可解析 |
| 定调 | **Excel 是导入通道，不是数据权威**——解析出的字段经白名单清洗后落草稿；判灯/算账/锁定/提交仍走服务端规则与人确认门，Excel 改不动任何规则 |

## 一、四要素

- **谁在做**：申请人（销售/项目经理）——手头已有线下编制的评审表/预算表 Excel，不想在系统里重填一遍
- **做什么**：新建预算单/评审单时点"上传 Excel 导入"选文件 → 系统自动解析字段 → 跳到核对页确认 → 走既有锁定/关联/提交流程
- **系统解决什么问题**：消灭"线下已填过的数据在系统里誊抄第二遍"——Excel 从"附件存档品"变成"结构化导入源"
- **产出什么东西**：两个导入端点 + 前端上传入口 + 解析器；三个录入通道（对话/表单/Excel）并行，白名单和门禁共用

## 二、三个导入场景

| 场景 | 输入 | 解析 sheet | 目标字段 | 落库形态 | 后续流程 |
|---|---|---|---|---|---|
| 预算单导入 | 含"附1-预算表"的 xlsx | 附1-预算表 | 17 预算字段 | budgets 草稿（fields+calc 实算） | 用户核对 → 编交付明细 → **人工点锁定** |
| 评审单导入 | 含"信息收集表"的 xlsx | 投标决策/售前立项/关键事项-信息收集 | 37 评审字段 | reviews 草稿（form_json） | 用户核对 → bid/presale **关联锁定预算单** → 提交 |
| 附3 导入（已有） | 含"附3-交付成本评估"的 xlsx | 附3 | 交付明细行 | budget_delivery 明细行 | 编辑 → 锁定 |

## 三、关键映射表（Excel 标签 → 系统字段）

**预算（附1 → BUDGET_WHITELIST 17 字段）**：合同金额→contract、分包采购成本→sub_cost、软件类生产外包→sw_outsource、灵活用工→flex_labor、销售差旅费→sales_travel、招待费→sales_entertain、市场营销→sales_marketing、所属部门/交付部门→dev_dept（枚举匹配十部门）、人天类→dev_pd/prod_pd、交付差旅/差旅费→del_travel、项目管理费→pm_cost、验收/综合办公/专业服务→del_other 合计、客户名称→customer、项目名称（内部）→project_name、渠道调节系数/项目难度系数→incentive_factor

**评审（信息收集表 → BID_WHITELIST）**：商机代码→opp_code、商机阶段→opp_stage、营销区域→region、最终客户名称→customer、业务线→biz_line、预计合同金额→contract_amount、销售经理→sales、项目经理→pm、预计签单时间→sign_date、贡献毛利率→gross_margin、签约路径→sign_path、分包总金额→sub_amount、指定类分包金额→designated_sub_amount、测绘类分包金额→survey_sub_amount、是否类→sub_core/survey/jiadao/secret/guarantee/non_compete/sub_limit（是/否枚举）、项目所在地省份→province、结算方式→settle_method、推广激励面向对象→promo_target、项目推广激励→promo_amount、售前投入→presale_invest、售前实施周期→presale_period 等

## 四、验收标准（EI-01~09）

| 用例 | 验收 |
|---|---|
| EI-01~04 预算导入 | 真实 pl8572.xlsx → 17 字段解析 → **六组锚定实算命中**（226415.09/41448/2264.15/13298.13/12508.82/5.52）→ draft 状态（不自动锁定） |
| EI-05~07 评审导入 | 真实 c02_08068.xlsx → 字段解析 → 白名单清洗 → draft 创建 → 锚定字段抽核 |
| EI-08 安全 | 毒件/非 xlsx → 400/502 拒绝不落库；结构键注入 → 白名单丢弃 |
| EI-09 性能 | 单文件导入 < 3 秒 |

## 五、约束

- 零依赖延续（spawn python + openpyxl 同附3 先例；无 python 降级提示）
- 白名单清洗：mergeDraft(BUDGET_WHITELIST / BID_WHITELIST)——Excel 无法注入 status/budget_id/locked 等结构键
- 人确认门：预算不自动锁定、评审不自动关联提交——Excel 只是填草稿

## 六、完成记录（2026-10-10）

交付物：tools/parse_form_xlsx.py（键值对解析器·标签模糊匹配+候选值智能选型）、server.js 两端点（/api/budget/import、/api/reviews/import，**异步 spawn**）、app.js 两入口（技能①页“上传 Excel 建预算单”+评审类型页“上传 Excel 导入评审单”）、tests/test_excel_import.js。

验证（红→绿，红基线=旧代码无端点 17 failed，绿 18/0 两连绿）：
- 构造干净键值对 xlsx：**六组锚定全命中**（income 226415.09/salesLabor 41448/tax 2264.15/incentive 13298.13/contribution 12508.82/margin 5.52）+ 未自动锁定
- 真实评审表：pl8572（contract=240000、matched 10/105）+ c02（matched 13/74、opp_code 命中）
- 安全：毒件 502 拒绝、结构键注入白名单丢弃
- 性能：单次 2162ms <3s
- 回归：run_all 11/11 + h_ui_shots 9/0 + h_adv_check 12/0

过程修复（工程经验）：
1. **spawnSync 阻塞事件循环**致 keep-alive 连接被关、后续同连接请求 fetch failed（稳定复现于 EI-06c）→ 改异步 spawn(runPython)+server.keepAliveTimeout=65000，两连绿根除
2. 解析器 pick 的 str 字段采用**紧邻优先**（键值对布局值总紧邻标签）——is_label_like 排除法会把“Excel导入测试客户”这类正常中文短值误判为标签而错取 G1
3. Excel 键值对布局存在“值在标签正下方”与“值在右邻”两种，候选收集右邻×3+下邻×3 按字段类型选值（NUM 找首个可转数字）

已知边界（真实复杂表）：嵌套成本明细（销售/交付成本分区）的字段命中率约 60-80%，未命中字段列入 warnings 提示用户核对补齐——属设计内产品边界，非缺陷。
