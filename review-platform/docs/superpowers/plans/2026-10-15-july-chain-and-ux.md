# 7 月真实单据全链路接通 + 下钻返回与 360 性能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修通六份 2026M7W2 工作簿的附3交付预算、附1项目预算和评审表三条通道，让每单经真实 HTTP 门禁完成确认、锁定、提交、部门打灯、研判、结论与归档，同时修复下钻返回件和 360 页签重复请求。

**Architecture:** Python 解析器只负责从原表提取原值与坐标；Node 服务端统一清洗、计价、挂链校验和预算投影；原生 SPA 展示可编辑明细、来源核对、返回件与缓存。财务公式、判灯规则和门禁保持不变，原件与平台模型不一致时展示差异，不修改输入凑平。

**Tech Stack:** Node.js 22 内置模块、`node:sqlite`、原生 JavaScript/CSS、Python 3.12.10、openpyxl 3.1.5、Playwright（仅浏览器验收）。

**Spec:** `docs/superpowers/specs/2026-10-15-july-chain-and-ux-design.md`

## Global Constraints

- Node 命令使用 `C:\Users\01386380\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`，下文记作 `$N`；不得依赖 PATH 上的旧 Node。
- 零 npm 运行时依赖，不改 `finance.js`、`judge()`、必填注册表、提交/锁定/结论裁决。
- 不修改或提交 `config.json`；实施前后用 Node 脚本比较字节和 SHA-256。
- 中文证据由测试脚本内部 `fs.writeFileSync(path, log, 'utf8')` 写入；不用 shell 重定向生成中文文件。
- 每个行为改动先取得旧实现红证据，再做最小实现，再取得绿证据；既有断言不得放宽。
- 不用 SQL 直接写评审终态、灯色、任务完成态、结论或归档态。
- 不停止无法确认归属的 8600 端口进程；开发验证优先沿用已确认由本任务启动的服务。需要独立语法验证时不启动服务。
- 全量门会污染共享业务库，必须在门前停写并复制数据库，在门后停服务还原；快照和临时脚本不纳入版本管理。
- 不创建提交，除非用户另行明确要求。

## File Map

| 文件 | 职责 |
|---|---|
| `tools/parse_form_xlsx.py` | 补评审两键；按附1固定业务行提取四类金额与审计坐标；不写 `dev_dept` |
| `tools/parse_delivery_xlsx.py` | 提取实施/运维差旅，保留有内容的全零人天行，输出坐标与分阶段汇总 |
| `server.js` | 保存和计价 `travel_cost`、投影 `del_travel`、提供评审挂预算唯一裁判 |
| `public/app.js` | 两套交付编辑器和核对视图展示差旅；统一返回件；360 缓存与写后失效 |
| `public/style.css` | 返回件样式 |
| `tests/test_delivery.js` | 附3差旅、附1上下文金额、预算投影和真实原件锚定 |
| `tests/test_delivery_opp.js` | 内容全零行、费用行、清洗与确认后修订回草稿 |
| `tests/test_excel_import.js` | EI-11 真实挂链提交；EI-12 评审两键与来源 |
| `tests/h_ia_shots.js` | 两套编辑器、四类返回件、360 请求计数和写后刷新 |
| `tests/run_all.js` | 当前 29 套收工门；不硬编码未来套数 |

---

### Task 1: 固化解析与交付行模型的红证据

**Files:**
- Modify: `tests/test_delivery.js`
- Modify: `tests/test_delivery_opp.js`
- Modify: `tests/test_excel_import.js`

**Interfaces:**
- Produces permanent assertions for `travel_cost`, attached-budget contextual fields, `ops_years`, `cost_happened`, audit coordinates, and review-to-budget linking.
- Existing helpers remain unchanged: D/DL use `raw(token, path, method, body)` and an `api(token, path, method, body)` that returns response data; EI uses `api(token, path, method, body)` that returns `{ status, data }`. D uses `check(id, name, ok)`; DL/EI use `check(id, name, ok, evidence)`. `near(a, b, tol)` and `mkXlsx(rows, type)` retain their current signatures.

- [ ] **Step 1: Extend `tests/test_delivery.js` with discriminating real-workbook assertions**

After D-01 import, retain its response in a variable accessible to the assertions and add:

```js
    check('D-01', '附3差旅字段存在且进入 sum',
      (d.rows || []).every(x => typeof x.travel_cost === 'number') && typeof (d.sum || {}).travel_cost === 'number',
      'travel=' + JSON.stringify((d.sum || {}).travel_cost));
```

In DA-02, extend the coordinate loop:

```js
      if (s.cols && s.cols.travel_cost) {
        const gv = gridAt(s.cols.travel_cost);
        const gnum = gv === undefined || gv === '' ? 0 : parseFloat(gv);
        if (isNaN(gnum) || Math.abs(gnum - row.travel_cost) > 0.01) bad++;
      }
```

Extend D-03’s appended row and assertions:

```js
    rows.push({ content: '追加交付物', stage: '实施', pm_pd: 1, own_pd: 3, prod_pd: 6, travel_cost: 500 });
    check('D-03', '差旅保存并计入行成本',
      near((d.rows || []).find(r => r.content === '追加交付物').cost, 9204, 1) && near(s.travel_cost, 500, 0.01));
```

Extend D-05 source row and projection assertions:

```js
    await api(sales, `/api/budget/${nb}/delivery`, 'PUT', {
      rows: [{ content: '回写源', stage: '实施', pm_pd: 7, own_pd: 39, prod_pd: 184, travel_cost: 6000 }]
    });
    check('D-05', '五科目回写含 del_travel=6000',
      f.dev_pd === 39 && near(f.pm_cost, 11872, 1) && f.prod_pd === 184 && f.del_travel === 6000);
    check('D-05', '预算重算含交付差旅', near((d.calc || {}).delivery, 142896, 1));
```

Add a real attached-budget import assertion using the existing PL00008572 workbook:

```js
  // D-09: 附1上下文成本行按业务坐标提取，不把金额写成人天
  {
    const data = fs.readFileSync(XLSX_8572).toString('base64');
    const r = await raw(sales, '/api/budget/import', 'POST', { filename: 'PL00008572-附1.xlsx', data });
    const f = (r.data || {}).fields || {};
    const src = (((r.data || {}).audit || {}).sources) || {};
    check('D-09', '附1上下文四金额字段进入预算草稿', r.status === 200 &&
      ['rd_outsource', 'del_travel', 'pm_cost', 'del_other'].every(k => Object.prototype.hasOwnProperty.call(f, k)), JSON.stringify(f));
    check('D-09', '附1上下文字段都有原表值坐标',
      ['rd_outsource', 'del_travel', 'pm_cost', 'del_other'].every(k => src[k] && Array.isArray(src[k].val_positions) && src[k].val_positions.length >= 1), JSON.stringify(src));
    check('D-09', 'G19/G21 金额未污染 dev_pd/prod_pd', f.dev_pd !== 39 * 1696 && f.prod_pd !== 184 * 320,
      JSON.stringify({ dev_pd: f.dev_pd, prod_pd: f.prod_pd }));
  }
```

- [ ] **Step 2: Extend `tests/test_delivery_opp.js` clean-row matrix**

Replace DL-03 input with five distinct rows and use exact output semantics:

```js
    const rows = [
      { content: 'POI 数据更新', stage: '实施', own_pd: 5, prod_pd: 20, travel_cost: 300 },
      { content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '空行' },
      { content: '仅保留建设内容', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0 },
      { content: '', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 800 },
      { content: '运维', stage: '运维', prod_pd: 6, travel_cost: 200 }
    ];
    const p = await raw(sales, `/api/opp/${codeA}/delivery`, 'PUT', { rows });
    const rowsOut = (p.data || {}).rows || [];
    check('DL-03', '完全空行剔除，内容全零行与仅差旅行保留', rowsOut.length === 4,
      JSON.stringify(rowsOut.map(r => ({ content: r.content, travel_cost: r.travel_cost }))));
    check('DL-03', '内容全零行保留为实施底稿', rowsOut.some(r => r.content === '仅保留建设内容' && r.stage === '实施'));
    check('DL-03', '仅差旅行保留且 sum.travel_cost=1300', rowsOut.some(r => !r.content && r.travel_cost === 800) && (p.data.sum || {}).travel_cost === 1300);
```

Extend DL-02’s expected cost to include travel:

```js
    const rows = [
      { content: '天地图POI数据生产', stage: '实施', pm_pd: 2, own_pd: 8, prod_pd: 40, travel_cost: 600 },
      { content: '研发外包接口开发', stage: '实施', pm_pd: 1, own_pd: 2, rd_pd: 4, travel_cost: 0 },
      { content: '运维保障', stage: '运维', pm_pd: 1, own_pd: 1, prod_pd: 10, travel_cost: 400 }
    ];
    check('DL-02', 'sum.cost 含差旅且 rate=null 时外包+差旅仍计价',
      near((d.sum || {}).cost, 4 * 995 + 50 * 320 + 1000, 0.05));
```

- [ ] **Step 3: Add EI-12 and EI-11 to `tests/test_excel_import.js`**

Add EI-12 before temporary-file cleanup:

```js
  const e12Code = 'PL-EI12-' + Date.now();
  const e12Rows = vRows.map(r => r[0] === '商机代码' ? ['商机代码', e12Code] : r).concat([
    ['项目运维周期', '1年'],
    ['项目已发生成本（万元）', 3.5]
  ]);
  const e12Xlsx = mkXlsx(e12Rows, 'review');
  const e12 = await api(sales, '/api/reviews/import', 'POST', {
    filename: 'ei12.xlsx', type: 'bid', data: fs.readFileSync(e12Xlsx).toString('base64')
  });
  const e12f = (e12.data || {}).form || {};
  const e12s = (((e12.data || {}).audit || {}).sources) || {};
  check('EI-12', '1年经既有 mergeDraft 数字链归一为 1', e12.status === 200 && e12f.ops_years === 1, JSON.stringify(e12f.ops_years));
  check('EI-12b', '已发生成本命中 3.5', e12f.cost_happened === 3.5, JSON.stringify(e12f.cost_happened));
  check('EI-12c', '两字段都有原表来源坐标', ['ops_years', 'cost_happened'].every(k => e12s[k] && e12s[k].val_pos), JSON.stringify(e12s));
```

Add EI-11 with a fully valid budget fixture and a real G1→G2→G3 chain:

```js
  const e11Code = 'PL-EI11-' + Date.now();
  const e11Rows = vRows.map(r => r[0] === '商机代码' ? ['商机代码', e11Code] : r).concat([
    ['商机名称', 'EI-11 挂链测试'], ['项目运维周期', '1年'], ['已发生成本', 0]
  ]);
  const e11Xlsx = mkXlsx(e11Rows, 'review');
  const e11Review = await api(sales, '/api/reviews/import', 'POST', {
    filename: 'ei11.xlsx', type: 'bid', data: fs.readFileSync(e11Xlsx).toString('base64')
  });
  const reviewId = (e11Review.data || {}).id;
  const e11Budget = await api(sales, '/api/budget', 'POST', {
    project_name: 'EI-11 预算', opp_code: e11Code,
    fields: { project_name: 'EI-11 预算', opp_code: e11Code, contract: 240000, sub_cost: 0,
      dev_dept: '交付处', dev_pd: 10, del_travel: 0 }
  });
  const budgetId = (e11Budget.data || {}).id;
  const dPut = await api(sales, `/api/opp/${encodeURIComponent(e11Code)}/delivery`, 'PUT', {
    rows: [{ content: 'EI-11 交付内容', stage: '实施', own_pd: 10, travel_cost: 0 }]
  });
  const dConfirm = await api(sales, `/api/opp/${encodeURIComponent(e11Code)}/delivery/confirm`, 'POST', {});
  const bLock = await api(sales, `/api/budget/${budgetId}/lock`, 'POST', {});
  check('EI-11a', '前置 G1/G2 夹具自洽', dPut.status === 200 && dConfirm.status === 200 && bLock.status === 200,
    `${dPut.status}/${dConfirm.status}/${bLock.status}`);
  const link = await api(sales, `/api/reviews/${reviewId}`, 'PUT', { budget_id: budgetId });
  const linked = await api(sales, `/api/reviews/${reviewId}`);
  check('EI-11b', '评审 PUT 挂上同商机已锁定预算', link.status === 200 && (linked.data.review || {}).budget_id === budgetId,
    JSON.stringify((linked.data.review || {}).budget_id));
  const beforeForm = JSON.parse((linked.data.review || {}).form_json || '{}');
  check('EI-11c', '仅挂预算不清空 form_json', beforeForm.customer === 'Excel导入测试客户' && beforeForm.ops_years === 1, JSON.stringify(beforeForm));
  const missingBudget = await api(sales, `/api/reviews/${reviewId}`, 'PUT', { budget_id: 99999999 });
  check('EI-11d', '不存在预算被唯一裁判拒绝', missingBudget.status === 400, String((missingBudget.data || {}).error || ''));
  const submit = await api(sales, `/api/reviews/${reviewId}/submit`, 'POST', {});
  const submitted = await api(sales, `/api/reviews/${reviewId}`);
  check('EI-11e', '挂链后真实提交到 reviewing 并创建任务', submit.status === 200 &&
    (submitted.data.review || {}).status === 'reviewing' && (submitted.data.tasks || []).length > 0,
    JSON.stringify({ submit: submit.status, status: (submitted.data.review || {}).status, tasks: (submitted.data.tasks || []).length }));
```

Include `e11Xlsx` and `e12Xlsx` in the existing cleanup array.

- [ ] **Step 4: Capture red evidence**

Run, with the current service still serving old code:

```bash
$N tests/test_delivery.js --log=tests/red_july_delivery.txt
$N tests/test_delivery_opp.js --log=tests/red_july_delivery_opp.txt
$N tests/test_excel_import.js --log=tests/red_july_excel_import.txt
```

Expected red causes:
- D: `travel_cost`, attached-budget contextual fields, and `del_travel` projection fail.
- DL: content-only/cost-only rows and travel totals fail.
- EI: EI-12 fields and EI-11 budget link fail; EI-11a must pass, otherwise repair the fixture before implementation.
- Existing assertions must remain green.

---

### Task 2: Extend both Excel parsers with provenance

**Files:**
- Modify: `tools/parse_form_xlsx.py:10-275`
- Modify: `tools/parse_delivery_xlsx.py:31-143`
- Test: `tests/test_parser_audit.js`
- Test: `tests/test_parser_lab.js`

**Interfaces:**
- `parse_form_xlsx.py` adds `ops_years`, `cost_happened` and `sources[field].val_positions` without changing `try_num()`.
- `parse_delivery_xlsx.py` rows add numeric `travel_cost`; `sum`, `sum.impl`, and `sum.ops` add the same key; `row_sources[].cols.travel_cost` is a single total-cell coordinate.

- [ ] **Step 1: Add review mappings and numeric declarations**

Add to `REVIEW_MAP`:

```python
  'ops_years': ['运维周期', '项目运维周期'],
  'cost_happened': ['已发生成本', '项目已发生成本', '项目已发生成本（万元）'],
```

Add both names to `NUM_FIELDS`. Do not edit `try_num()`.

- [ ] **Step 2: Add attached-budget contextual extraction**

Add this helper before `main()`:

```python
def extract_budget_context(ws):
  specs = {
    'rd_outsource': [20],
    'del_travel': [22, 24, 25],
    'pm_cost': [23],
    'del_other': [26, 27, 28],
  }
  fields, sources = {}, {}
  for key, rows in specs.items():
    vals, positions, labels = [], [], []
    for row_no in rows:
      cell = ws.cell(row=row_no, column=7)
      n = try_num(cell.value)
      if n is None:
        continue
      vals.append(n)
      positions.append((row_no - 1, 6))
      labels.append(' / '.join(str(ws.cell(row=row_no, column=c).value or '').strip() for c in range(1, 7) if ws.cell(row=row_no, column=c).value))
    if vals:
      fields[key] = round(sum(vals), 2)
      sources[key] = {
        'label': ' + '.join(labels),
        'lab_pos': (rows[0] - 1, 0),
        'val_pos': positions[0],
        'val_positions': positions,
      }
  return fields, sources
```

After generic field collection and before result construction, for `typ == 'budget'` overwrite only the four exact monetary fields:

```python
  context_sources = {}
  if typ == 'budget':
    context_fields, context_sources = extract_budget_context(ws)
    fields.update(context_fields)
```

After generic `sources` construction:

```python
    sources.update(context_sources)
```

This deliberately does not use G19/G21 and does not populate `dev_dept`.

- [ ] **Step 3: Locate travel sections contextually in the delivery parser**

After person-day column discovery add:

```python
    c_impl_travel = col_of('实施阶段', '差旅成本')
    c_ops_travel = col_of('运维阶段', '差旅成本', after=c_impl_travel if c_impl_travel is not None else -1)

    def travel_cols(total_col):
        if total_col is None: return []
        return [c for c in range(total_col + 1, min(total_col + 6, n))]

    impl_travel_parts = travel_cols(c_impl_travel)
    ops_travel_parts = travel_cols(c_ops_travel)
```

Inside the row loop add:

```python
        def travel_value(total_col, part_cols):
            parts = [numv(row, c) for c in part_cols]
            part_sum = round(sum(parts), 2)
            return part_sum if part_sum else round(numv(row, total_col), 2)

        impl_travel = travel_value(c_impl_travel, impl_travel_parts)
        ops_travel = travel_value(c_ops_travel, ops_travel_parts)
        impl_has = any(impl) or bool(impl_travel)
        ops_has = any(ops) or bool(ops_travel)
```

Replace the two append conditions with:

```python
        if impl_has or not ops_has:
            rows.append({"content": content[:200], "stage": "实施", "pm_pd": round(impl[0], 2),
                         "own_pd": round(impl[1], 2), "rd_pd": round(impl[2], 2), "prod_pd": round(impl[3], 2),
                         "travel_cost": impl_travel, "note": ""})
            src_impl["cols"]["travel_cost"] = [ri, c_impl_travel] if c_impl_travel is not None else None
            src_impl["travel_parts"] = [[ri, c] for c in impl_travel_parts]
            row_sources.append(src_impl)
        if ops_has:
            rows.append({"content": content[:200], "stage": "运维", "pm_pd": round(ops[0], 2),
                         "own_pd": round(ops[1], 2), "rd_pd": round(ops[2], 2), "prod_pd": round(ops[3], 2),
                         "travel_cost": ops_travel, "note": ""})
            src_ops["cols"]["travel_cost"] = [ri, c_ops_travel] if c_ops_travel is not None else None
            src_ops["travel_parts"] = [[ri, c] for c in ops_travel_parts]
            row_sources.append(src_ops)
```

Extend `agg()` and `meta.cols`:

```python
        return {k: round(sum(r[k] for r in rs), 2) for k in ('pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost')}
```

```python
"travel": {"impl_total": c_impl_travel, "impl_parts": impl_travel_parts,
           "ops_total": c_ops_travel, "ops_parts": ops_travel_parts}
```

Extend `total_row` with `impl_travel` and `ops_travel` from the section total columns.

- [ ] **Step 4: Run parser-only checks**

```bash
python -X utf8 -m py_compile tools/parse_form_xlsx.py tools/parse_delivery_xlsx.py
$N tests/test_parser_audit.js --log=tests/green_july_parser_audit.txt
$N tests/test_parser_lab.js --log=tests/green_july_parser_lab.txt
```

Expected: syntax succeeds; PA and PL end in `0 failed`. If field-count expectations rise because the two new review fields are now present, update only exact counts while preserving equality comparisons.

---

### Task 3: Carry travel through the service and add review-budget linking

**Files:**
- Modify: `server.js:298-320`
- Modify: `server.js:417-418`
- Modify: `server.js:1379-1435`
- Modify: `server.js:1881-1890`

**Interfaces:**
- `cleanDeliveryRows(rows)` preserves `travel_cost` and rows with content or any numeric contribution.
- `deliverySumFor(rows,devDept)` returns `sum.travel_cost` and includes it in each row’s `cost`.
- `delivery/apply` writes `del_travel` from `sum.travel_cost`.
- `linkBudgetErr(review,budgetId)` returns an empty string or a user-facing validation error.
- `PUT /api/reviews/:id` accepts `{title?, form?, budget_id?}` without clearing omitted fields.

- [ ] **Step 1: Extend the delivery row cleaner and calculator**

Update the row map:

```js
  rd_pd: Math.max(0, num(r.rd_pd) || 0), prod_pd: Math.max(0, num(r.prod_pd) || 0),
  travel_cost: Math.max(0, num(r.travel_cost) || 0),
  note: String(r.note || '').slice(0, 500)
})).filter(r => r.content.trim() || r.pm_pd || r.own_pd || r.rd_pd || r.prod_pd || r.travel_cost);
```

Update `deliverySumFor`:

```js
  const sum = { pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, cost: 0 };
```

```js
    const cost = (r.pm_pd + r.own_pd) * (rate ?? 0)
      + r.rd_pd * (num(S.price_rd_outsource) || 995)
      + r.prod_pd * (num(S.price_prod_outsource) || 320)
      + r.travel_cost;
    sum.travel_cost += r.travel_cost;
```

Round `travel_cost` together with the existing sum keys.

- [ ] **Step 2: Extend delivery apply**

Add to the existing merge object:

```js
          del_travel: calc.sum.travel_cost,
```

Update agent messages to include the travel total. Do not change `computeBudget()`.

- [ ] **Step 3: Add the unique review-budget validator**

Immediately after `getBudgetRaw` add:

```js
function linkBudgetErr(review, budgetId) {
  const budget = getBudgetRaw(budgetId);
  if (!budget) return '预算单不存在';
  if (budget.status !== 'locked') return '只能关联已锁定的预算单';
  const reviewCode = String((review && review.opp_code) || '').trim();
  const budgetCode = String(budget.opp_code || '').trim();
  if (reviewCode !== budgetCode) return '预算单与评审单必须属于同一商机';
  return '';
}
```

Exact equality is required even when one code is blank; a detached budget cannot satisfy a coded review.

- [ ] **Step 4: Replace the review PUT update**

Use presence checks so omitted values stay unchanged:

```js
        const body = await parseBody(req);
        const hasForm = Object.prototype.hasOwnProperty.call(body, 'form');
        const hasBudget = Object.prototype.hasOwnProperty.call(body, 'budget_id');
        if (hasBudget) {
          const err = linkBudgetErr(review, body.budget_id);
          if (err) return send(res, 400, { error: err });
        }
        const nextTitle = body.title || review.title;
        const nextForm = hasForm ? JSON.stringify(body.form || {}) : review.form_json;
        const nextOpp = hasForm ? String((body.form || {}).opp_code || '').trim() || null : review.opp_code;
        const nextBudget = hasBudget ? body.budget_id : review.budget_id;
        db.prepare('UPDATE reviews SET title=?, form_json=?, budget_id=?, opp_code=?, updated_at=? WHERE id=?')
          .run(nextTitle, nextForm, nextBudget, nextOpp, now(), review.id);
        addEvent(review.id, hasBudget ? '关联预算单' : '修改材料', user.name,
          hasBudget ? '预算单 #' + body.budget_id : '');
        return send(res, 200, { ok: true, budget_id: nextBudget });
```

- [ ] **Step 5: Syntax check**

```bash
$N --check server.js
```

Expected: no output and exit code 0.

---

### Task 4: Show and edit travel in both delivery editors and provenance views

**Files:**
- Modify: `public/app.js:1432-1599`
- Modify: `public/app.js:1911-2008`

**Interfaces:**
- Both editors use key `travel_cost` and include it in local preview cost.
- Import review highlights `row_sources[].cols.travel_cost` plus `travel_parts`.
- Server remains authoritative after save/import.

- [ ] **Step 1: Extend budget-level editor**

Add the header `差旅招待` before `行成本(元)` and include `travel_cost` in the numeric key list:

```js
${['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'].map(k => `<td><input data-di="${i}" data-dk="${k}" type="number" min="0" step="any" value="${r[k]}" style="width:72px" oninput="deliveryRowCost(${i})" ${locked ? 'disabled' : ''}></td>`).join('')}
```

Update local row cost:

```js
  return Math.round(((+r.pm_pd || 0) + (+r.own_pd || 0)) * (DLV.rate ?? 0)
    + (+r.rd_pd || 0) * (DLV.rd_price || 995)
    + (+r.prod_pd || 0) * (DLV.prod_price || 320)
    + (+r.travel_cost || 0));
```

Update sum initialization, accumulation, rounding, summary label, help text, and new-row defaults to include `travel_cost`.

- [ ] **Step 2: Extend opportunity-level editor**

Apply the same exact key, calculation, sum, label, help text, and default-row changes to `opdlvCalcRow`, `opdlvCalcSum`, `opdlvRender`, and `opdlvAddRow`. Preserve D-47: confirmed status must not disable editing controls.

- [ ] **Step 3: Extend delivery import review**

When building highlighted coordinates:

```js
    Object.values(s.cols || {}).forEach(p => { if (Array.isArray(p)) valSet[p[0] + ',' + p[1]] = i; });
    (s.travel_parts || []).forEach(p => { if (Array.isArray(p)) valSet[p[0] + ',' + p[1]] = i; });
```

Add a `差旅招待` column to result rows and totals. Extend `aggBy` with `travel_cost`; add implementation and operations travel comparisons against `total_row.impl_travel` and `total_row.ops_travel`. Update visible wording from “人天格” to “人天/差旅格”.

- [ ] **Step 4: Extend generic import provenance for aggregate attached-budget sources**

In `renderImportReview`, add all `val_positions` to `valSet`, while preserving `val_pos` as the focus anchor:

```js
    (s.val_positions || []).forEach(p => { if (Array.isArray(p)) valSet[p[0] + ',' + p[1]] = k; });
```

In `impRvFocus`, focus all source cells:

```js
  const n = impRvPickCells(sp ? [sp.lab_pos, sp.val_pos].concat(sp.val_positions || []) : []);
```

- [ ] **Step 5: Syntax check**

```bash
$N --check public/app.js
```

Expected: no output and exit code 0.

---

### Task 5: Add unified breadcrumbs and write-boundary 360 cache invalidation

**Files:**
- Modify: `public/app.js:110-160`
- Modify: `public/app.js:301-309`
- Modify: `public/app.js` renderDetail/renderBudget/renderDeliveryPage/renderOpp360
- Modify: `public/style.css`
- Modify: `tests/h_ia_shots.js`

**Interfaces:**
- `crumbBar(href,parent,current)` returns accessible two-level navigation.
- A successful non-GET `api()` call clears every cache key matching `/api/opp/*/360`.
- `renderOpp360()` reads through `apiCached()`.

- [ ] **Step 1: Put invalidation at the API boundary**

Add before `api()`:

```js
function invalidate360Cache() {
  if (!window._pgCache) return;
  Object.keys(window._pgCache).forEach(k => {
    if (/^\/api\/opp\/[^/]+\/360$/.test(k)) delete window._pgCache[k];
  });
}
```

After the `if (!r.ok)` check and before returning `d`:

```js
  if ((method || 'GET').toUpperCase() !== 'GET') invalidate360Cache();
```

Change only the data call in `renderOpp360()`:

```js
  try { d = await apiCached('/api/opp/' + encodeURIComponent(code) + '/360'); }
```

Do not add per-handler invalidation calls.

- [ ] **Step 2: Add one breadcrumb renderer**

After `lightPill` add:

```js
function crumbBar(href, parent, current) {
  return `<nav class="crumb-bar" aria-label="页面路径">
    <a class="btn sm" href="${href}">← ${esc(parent)}</a>
    <span><a href="${href}">${esc(parent)}</a> › <b>${esc(current || '')}</b></span>
  </nav>`;
}
```

- [ ] **Step 3: Use it in all four drill-down pages**

- Opportunity 360: parent `全部商机`, href `#/opps`, current `d.opp.title || code`.
- Review detail: when `r.opp_code` exists, href `#/opp/<encoded code>`, parent `所属商机`; otherwise `#/opps`, parent `全部商机`; current `r.title`.
- Budget detail: when `B_REVIEW.opp_code` exists, href its 360 and parent `所属商机`; otherwise `#/budgets`, parent `预算工作台`; current `B_REVIEW.title`.
- Delivery detail: when `b.opp_code` exists, href its 360 collect tab and parent `所属商机`; otherwise `#/agent?b=<id>`, parent `预算对话`; current `b.project_name || b.code`.

Remove the old top-level `float:right;font-size:13px` return links that these replace. Keep unrelated action links such as report, archive analysis, and “发起新评审”.

- [ ] **Step 4: Add styles**

```css
.crumb-bar{display:flex;align-items:center;gap:10px;margin:0 0 12px;color:var(--text-3);font-size:12.5px}
.crumb-bar>span{display:flex;align-items:center;gap:6px}
.crumb-bar>span a{color:var(--text-3);text-decoration:none}
.crumb-bar>span a:hover{color:var(--brand)}
.crumb-bar b{color:var(--text-1);font-weight:600}
```

- [ ] **Step 5: Add browser assertions with self-created fixtures**

In `h_ia_shots.js`, after the existing `call()` and FX fixture setup, add:

```js
  const navCase = async (hash, expectedHref, label) => {
    await page.evaluate(h => { location.hash = h; }, hash);
    await page.waitForSelector('.crumb-bar a.btn', { timeout: 10000 });
    const href = await page.locator('.crumb-bar a.btn').getAttribute('href');
    const text = await page.locator('.crumb-bar').textContent();
    check(label, href === expectedHref && text.includes('›'), 'href=' + href + ' text=' + text.slice(0, 80));
  };
```

Create one draft review for FX through the existing HTTP helper, obtain its id, then assert exact destinations:

```js
  await navCase('#/opp/' + FX, '#/opps', 'IA-27 商机 360 返回全部商机');
  await navCase('#/budget/' + fxBg, '#/opp/' + FX, 'IA-28 预算详情返回所属商机');
  await navCase('#/delivery/' + fxBg, '#/opp/' + FX + '?t=collect', 'IA-29 交付详情返回商机信息收集');
  await navCase('#/review/' + fxReviewId, '#/opp/' + FX, 'IA-30 评审详情返回所属商机');
```

Add travel editor assertions:

```js
  await page.evaluate(c => { location.hash = '#/opp/' + c + '?t=collect'; }, FX);
  await page.waitForSelector('#opdlvTable [data-ok="travel_cost"]');
  check('IA-31 商机级交付编辑器显示差旅招待输入', await page.locator('#opdlvTable [data-ok="travel_cost"]').count() >= 1);
  await page.evaluate(id => { location.hash = '#/delivery/' + id; }, fxBg);
  await page.waitForSelector('#dlvTable [data-dk="travel_cost"]');
  check('IA-32 预算级交付编辑器显示差旅招待输入', await page.locator('#dlvTable [data-dk="travel_cost"]').count() >= 1);
```

Add request counting after first 360 render:

```js
  let hits360 = 0;
  const on360 = req => { if (/\/api\/opp\/[^/]+\/360$/.test(new URL(req.url()).pathname)) hits360++; };
  page.on('request', on360);
  await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
  await page.waitForSelector('#oppTabs');
  await page.waitForTimeout(500);
  hits360 = 0;
  for (const tab of ['collect', 'pre', 'judge', 'overview']) {
    await page.evaluate(([c, t]) => { location.hash = '#/opp/' + c + '?t=' + t; }, [FX, tab]);
    await page.waitForSelector('#oppTabs button.pri');
  }
  check('IA-33 首次加载后切换页签不再请求 360', hits360 === 0, 'hits=' + hits360);
  await call('/api/opp/' + FX + '/delivery', 'PUT', {
    rows: [{ content: '缓存失效验证', stage: '实施', own_pd: 1, travel_cost: 25 }]
  });
  await page.evaluate(() => { location.hash = '#/opps'; });
  await page.waitForSelector('#oppsTbl');
  hits360 = 0;
  await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
  await page.waitForSelector('#oppTabs');
  await page.waitForTimeout(500);
  check('IA-34 成功写请求后重新进入 360 恰刷新一次', hits360 === 1, 'hits=' + hits360);
  page.off('request', on360);
```

Register `page.on('console')` and retain the existing `pageerror` listener; fail the suite if any `console.error` or `pageerror` occurs during these cases.

---

### Task 6: Restart the owned service and close red-to-green loops

**Files:**
- Output: `tests/green_july_delivery.txt`
- Output: `tests/green_july_delivery_opp.txt`
- Output: `tests/green_july_excel_import.txt`
- Output: `tests/green_july_ia.txt`

- [ ] **Step 1: Verify syntax before any restart**

```bash
python -X utf8 -m py_compile tools/parse_form_xlsx.py tools/parse_delivery_xlsx.py
$N --check server.js
$N --check public/app.js
```

- [ ] **Step 2: Restart only a service process created by this task**

Record the PID when starting the task service. If port 8600 is held by an unowned process, do not stop it; report the blocker. For an owned process, stop that exact PID, start a new log file, and verify unauthenticated health is 401.

- [ ] **Step 3: Run focused green suites**

```bash
$N tests/test_delivery.js --log=tests/green_july_delivery.txt
$N tests/test_delivery_opp.js --log=tests/green_july_delivery_opp.txt
$N tests/test_excel_import.js --log=tests/green_july_excel_import.txt
$N tests/h_ia_shots.js --log=tests/green_july_ia.txt
```

Expected: every suite ends in `0 failed -> ALL PASS`; no `database is locked`, `pageerror`, or `console.error`.

- [ ] **Step 4: Inspect changed-file diff**

```bash
git diff --check
git diff -- tools/parse_form_xlsx.py tools/parse_delivery_xlsx.py server.js public/app.js public/style.css tests/test_delivery.js tests/test_delivery_opp.js tests/test_excel_import.js tests/h_ia_shots.js
```

Confirm `finance.js`, rule tables, `config.json`, and unrelated evidence files are absent.

---

### Task 7: Rebuild the six July records through real HTTP transitions

**Files:**
- Create temporarily: `tests/_tmp_import_july_w2.js`
- Output: `tests/july_chain_evidence.txt`
- Delete after use: `tests/_tmp_import_july_w2.js`

**Interfaces:**
- Source directory: `F:/Desktop/市场营销支持处/01 商机到项目管控/项目决策/2026M7W2`.
- Every write uses authenticated HTTP.
- SQL is allowed only in a stopped-service reset helper to clear business tables and restore the immutable PL00008572 regression anchor; it must not create workflow states.

- [ ] **Step 1: Stop the owned service and create an external pre-reset backup**

Use `fs.copyFileSync` from a temporary Node script to copy `data/review.db` to a uniquely timestamped file outside the repository. Record its absolute path in the terminal. Do not overwrite any existing backup.

- [ ] **Step 2: Reset business tables and retain users/settings plus the regression anchor**

With the service stopped, clear business tables in one SQLite transaction, preserve `users` and `settings`, and copy only the PL00008572 `opp_delivery` row from the verified pre-cleanup backup. The helper must print before/after counts and abort if the anchor is absent. Delete the helper immediately after success.

- [ ] **Step 3: Implement the temporary importer with an explicit document table**

The script contains these six exact files and confirmed department choices:

```js
const DOCS = [
  ['PL00007297', '【合同签订】PL00007297-百望云区域企业白名单服务合作.xlsx', 'bid', '交付处'],
  ['PL00008330', '【售前投入】PL00008330-深圳市供电局三维数据采购决策表-20260630.xlsx', 'presale', '公共服务业务处-交付运营'],
  ['PL00006204', '【投标决策】PL00006204-武汉市GA地图地址服务项目.xlsx', 'bid', '交付处'],
  ['PL00008026', '【投标决策】PL00008026-武汉市地图产品采购项目（滴滴智驾采集）.xlsx', 'bid', '行业售前部'],
  ['PL00008210', '【投标决策】PL00008210-长沙智慧消防一张图及辅助决策信创改造项目.xlsx', 'bid', '交付处'],
  ['PL00008314', '【投标决策】PL00008314-上海保险交易所地理信息系统（GIS）项目.xlsx', 'bid', '公共服务业务处-交付运营']
];
```

For each document the script must stop that record on the first non-2xx response and execute exactly:

1. `POST /api/opp/:code/delivery/import`.
2. Assert parsed rows, travel total, and audit sources; PL00007297 must have at least 10 content rows and exactly 20,000 travel.
3. `POST /api/opp/:code/delivery/confirm`.
4. `POST /api/budget/import`.
5. `PUT /api/budget/:id` with the explicit human-selected `dev_dept`.
6. `POST /api/budget/:id/delivery/apply` to compute candidates.
7. `PUT /api/budget/:id` restoring the imported attached-budget values for `rd_outsource`, `del_travel`, `pm_cost`, and `del_other`, retaining `dev_pd` from delivery projection and explicitly setting zero-valued required fields.
8. `POST /api/budget/:id/lock`.
9. `POST /api/reviews/import`.
10. For PL00008026 only, `PUT /api/reviews/:id` with existing form plus `ops_years: 0` and log `原件为 /，0 为人工判断`.
11. `PUT /api/reviews/:id` with only `budget_id`.
12. `POST /api/reviews/:id/submit`.
13. Read tasks and submit each with the account matching `task.dept`; preserve report-derived yellow/red opinions, and use green only where the source report has no risk opinion.
14. Assert the last task caused automatic judgment.
15. Compare engine light with the source report; log any mismatch without changing inputs.
16. `POST /api/reviews/:id/decision`, then `POST /api/reviews/:id/archive`.
17. Re-read `/api/opp/:code/360` and assert delivery confirmed, a locked budget exists, and a submitted/archived review exists.

All responses and comparisons append to `tests/july_chain_evidence.txt` through `fs.writeFileSync(evidencePath, lines.join('\n') + '\n', 'utf8')`.

- [ ] **Step 4: Run importer and validate final data semantically**

```bash
$N tests/_tmp_import_july_w2.js
```

Expected:
- Six records complete without SQL state changes.
- PL00007297 has content and travel despite zero person-days.
- Every record has confirmed delivery, locked budget, archived review, department task events, and a budget comparison block showing attached-budget amount, platform recomputation, and difference.
- No synthetic test opportunity code is present in the rebuilt business database.

- [ ] **Step 5: Delete all temporary workbook-audit and import files**

Delete only files created for this task:
- `tests/_tmp_import_july_w2.js`
- `tests/_tmp_probe_july_workbooks.py`
- `tests/_tmp_july_budget_audit.json`
- `tests/_tmp_probe_delivery_cost_columns.py`
- `tests/_tmp_delivery_cost_columns.json`

Verify with `git status --short` that no unrelated file was removed.

---

### Task 8: Protect the rebuilt database while running the full gate

**Files:**
- Output: `tests/green_run_july.txt`
- Output: `tests/green_run_july_meta.txt`
- Temporary external database snapshot, deleted only after successful restore verification

- [ ] **Step 1: Capture pre-gate invariants**

With the task-owned service stopped, a temporary Node script must:
- copy `data/review.db` to a unique external snapshot;
- count six July codes and PL00008572;
- assert each July code has confirmed delivery, at least one locked budget, and one archived review;
- assert no opportunity code begins with known fixture prefixes `PL-T`, `PL-EI`, `PL-OC`, or `PL-WZ`;
- record `config.json` byte length and full SHA-256 without printing secrets.

Restart the same task-owned service and verify `/api/me` returns 401.

- [ ] **Step 2: Run the actual suite count**

```bash
$N tests/run_all.js --log=tests/green_run_july.txt
```

Expected: final line reports every suite from the current `SUITES` array passed. At the time of this plan there are 29 suites; acceptance uses the runtime count rather than a hardcoded number.

- [ ] **Step 3: Restore the clean business database**

Stop the task-owned service, copy the external snapshot back over `data/review.db`, restart, then re-run the invariant script. Restoration is successful only if all six July records and the anchor are present and fixture prefixes are absent.

- [ ] **Step 4: Capture metadata without secrets**

A temporary Node script writes `tests/green_run_july_meta.txt` containing:
- current HEAD;
- full-gate final line;
- focused D/DL/EI/IA final lines;
- six-code semantic counts;
- PL00007297 content-row and travel totals;
- config byte length and SHA-256 prefix before/after;
- counts for `database is locked`, `SOME FAIL`, browser `pageerror`, and `console.error`.

Delete the metadata helper after it succeeds. Its failure path writes only a separate untracked abort file and must not overwrite a prior green artifact.

---

### Task 9: Browser-level final acceptance and review

**Files:**
- No new runtime files

- [ ] **Step 1: Verify the golden path in the browser**

Using the rebuilt database and `zhichizu` account:
- Open the opportunity list and each of the six July opportunities.
- Confirm the three-step chain is coherent and complete.
- Open delivery, budget, review, and 360 drill-down pages; click each breadcrumb button and verify its destination.
- In both delivery editors verify travel is visible and editable.
- In import review verify clicking a row highlights content, person-day, and travel source cells.
- Switch every 360 tab while recording network requests; there must be no additional 360 request after first load.
- Perform one safe draft write on a dedicated unique fixture, re-enter 360, and observe exactly one refresh.
- Monitor console and page errors throughout.

- [ ] **Step 2: Run final static and focused checks**

```bash
python -X utf8 -m py_compile tools/parse_form_xlsx.py tools/parse_delivery_xlsx.py
$N --check server.js
$N --check public/app.js
$N tests/test_parser_audit.js --log=tests/green_july_parser_audit.txt
$N tests/test_parser_lab.js --log=tests/green_july_parser_lab.txt
$N tests/test_delivery.js --log=tests/green_july_delivery.txt
$N tests/test_delivery_opp.js --log=tests/green_july_delivery_opp.txt
$N tests/test_excel_import.js --log=tests/green_july_excel_import.txt
$N tests/h_ia_shots.js --log=tests/green_july_ia.txt
```

- [ ] **Step 3: Review changed code**

Run a code-quality review focused only on modified source and permanent tests. Reject:
- duplicated numeric parsing in Python;
- automatic `dev_dept` inference;
- any change to finance/judgment rules;
- per-handler cache invalidation;
- weakened equality assertions;
- silent error swallowing;
- SQL-created workflow states;
- tracked database/config/temporary audit files.

- [ ] **Step 4: Report completion from evidence**

Report exact final-line outputs, six-record semantic counts, browser request counts, and any honest source-vs-platform differences. Do not claim totals or lights match when the evidence says otherwise.

---

## Self-Review

- **Spec coverage:** D-57/D-58 are Tasks 1-2; D-59 is Tasks 1 and 3; D-60/D-62 are Task 7; D-61/D-67 are Tasks 7-8; D-63/D-64 are Tasks 1-4; D-65 is Task 7; D-66 is Task 5. UI, tests, real reconstruction, snapshot protection, and final acceptance each have a dedicated task.
- **Completeness scan:** Every code-writing step identifies exact symbols, request bodies, expected outputs, and permanent test carriers. No fixed process ID, guessed lock-ready fixture, or abbreviated browser assertion remains.
- **Interface consistency:** `travel_cost` is the sole new row key across parser, service, UI, and tests. Attached-budget audit uses `val_positions` while preserving `val_pos`. Review linking is only through `PUT /api/reviews/:id`. 360 invalidation occurs only at the shared `api()` write boundary.
- **Non-target check:** The plan does not modify `finance.js`, judgment rules, required-field definitions, `config.json`, or employee/robot integration work queued after this delivery.
