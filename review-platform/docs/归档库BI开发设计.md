# 归档库 BI · 技术与开发设计

| 项 | 内容 |
|---|---|
| 版本 | V1.0（2026-10-09） |
| 上游 | docs/归档库BI产品方案.md（8 维度 + BI-01~12 验收） |
| 批次 | R1 服务端聚合端点 → R2 前端 BI 区 → R3 测试与对抗 |

## 一、API 设计

**GET /api/reviews/archive-stats**（登录全员，聚合范围严格限 status='archived'）

响应结构（全部数字由下述口径实算）：

```json
{
  "kpi": { "total": 378, "greenRate": 36.2, "avgRound": 1.06, "decisionRate": 13.0 },
  "light": { "green": 137, "yellow": 224, "red": 17 },
  "types": { "bid": 330, "presale": 24, "change": 24 },
  "monthly": [{ "m": "2026-09", "c": 2 }, { "m": "2026-10", "c": 376 }],
  "risks": [{ "name": "贡献利润", "count": 89 }],
  "depts": [{ "dept": "财务BP", "yellow": 38, "red": 0, "total": 1532 }],
  "amounts": [{ "range": "<50万", "count": 214 }, { "range": "50~100万", "count": 90 }, { "range": "100~500万", "count": 44 }, { "range": "≥500万", "count": 6 }],
  "totalAmountWan": 20433.4,
  "routes": { "xo": 151, "dept": 73, "green": 137 }
}
```

## 二、聚合口径（逐项，与 BI 用例 SQL 直查同源）

| 维度 | 实现 | 精确口径 |
|---|---|---|
| kpi.total | SQL `COUNT(1) WHERE status='archived'` | — |
| kpi.greenRate | light='green'/total×100 保留 1 位 | 分母 total |
| kpi.avgRound | SQL AVG(round) 保留 2 位 | — |
| kpi.decisionRate | decision_result IS NOT NULL 计数/total×100 | 空串按已录（服务端写入时非空约束） |
| light/types | SQL GROUP BY light / type | — |
| monthly | JS 按 archived_at.slice(0,7) 分桶，近 12 个月缺月补零、升序 | 无 archived_at 剔除 |
| risks | JS 解析每单 judge_detail（JSON），取 level != 'green' 的 name 聚合，降序 Top10 | 解析失败跳过该单 |
| depts | SQL tasks JOIN reviews（archived）GROUP BY dept；yellow/red 为 light 计数，total 为该部门全部任务数（含 cancelled/returned）；按 (yellow+red)/total 降序 | 全轮次 |
| amounts | JS 解析 form_json.contract_amount（万）；四档**半开区间** [0,50) / [50,100) / [100,500) / [500,∞) | parseFloat 失败/null 剔除 |
| totalAmountWan | 金额求和保留 1 位 | 同上剔除规则 |
| routes | JS route 文本匹配：含 'XO'→xo；否则含 '免上会'→green；否则含 '部门级'→dept；其余丢 | 红灯单 route 为"红灯打回…"——不进三段（摸底：17 红 = 378-151-137-73=17 对齐） |

## 三、前端设计（public/app.js renderArchive 改造）

归档库页结构：BI 区（新增）在顶部 → 既有明细列表下移。

- **KPI 行**：`metric-grid` 4 张 `metric-tile`（复用既有深色组件）
- **灯色/路由**：复用 `dist-bar` + `dist-legend`
- **类型占比**：三条 `rank-bar`（带百分比）
- **月度趋势**：`bar-cols`（纯 CSS 柱状：flex + height%，悬停 title 显示数）
- **风险项 Top10**：`rank-bar` 横向条形降序（宽度=count/max×100%）
- **部门命中率**：`rank-bar`（黄红数/占比标注，按占比排序）
- **金额分布**：`bar-cols` 四柱 + 总额标注
- 新 CSS 类（style.css 追加）：`.bi-grid`（两列大区布局）、`.rank-bar`（排行条：label+track+fill+num）、`.bar-cols`（柱状组）、`.bi-note`（周期维说明位）

## 四、测试设计（tests/test_bi.js）

- **断言源铁律**：BI-01~08 的期望值全部由脚本内 SQLite 直查计算（复刻摸底探针），禁止手拍
- BI-01 kpi 四值 / BI-02 light / BI-03 types / BI-04 monthly / BI-05 risks Top10 / BI-06 depts / BI-07 amounts+总额 / BI-08 routes
- BI-09 空态：查 DB 内 archived 数为 0 时的结构兜底（用一个跳过条件实现：若库非空则验证"结构完整"而非"全 0"——不破坏真实库）
- BI-10 对抗：GET 带 ?scope=xxx' OR '1'='1 / 恶意 query → 容错 200（参数被忽略）
- BI-11 对抗：对比 archive-stats.total 与 SQL 直查 archived 数（在途/草稿不混入）+ 响应内抽查一未归档单标题不出现
- BI-12：耗时 < 300ms
- 浏览器层：h_ui_shots.js 加归档页断言（.bi-grid 存在 + 无 JS 报错 + 截图 UI_08_archive_bi.png）

## 五、风险与回退

- 归档页渲染函数整体改动 → H 脚本归档相关断言核对（h_manual 无归档页依赖；h_ui_shots 需同步演进）
- 378 单 judge_detail 逐单 JSON.parse 聚合（约 378 次解析）性能可控（<50ms 预期，BI-12 卡 300ms）
- 回退：.bak_bi/ 三件套
