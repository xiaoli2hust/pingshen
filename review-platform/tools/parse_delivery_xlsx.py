# -*- coding: utf-8 -*-
# 附3-交付成本评估 解析器: xlsx -> JSON 明细行(供 server.js spawn 调用)
# 用法: python tools/parse_delivery_xlsx.py <xlsx路径>
# stdout 输出单行 JSON:
#   {"rows":[{content,stage,pm_pd,own_pd,rd_pd,prod_pd,note}...],
#    "sum":{pm_pd,own_pd,rd_pd,prod_pd}, "total_row":{...原件合计行对照}, "meta":{...}}
# 行模型对齐附1 交付成本口径:
#   pm_pd(项目经理人天,×部门单价归"项目管理费") / own_pd(产研正编人天,×部门单价)
#   rd_pd(产研外包人天) / prod_pd(生产外包人天,×320)
# 校准锚定(PL00008572 原件): 实施段 pm=5,own=39,prod=184; 运维段 pm=2 -> own=39 与 prod=184 同原件合计行
import sys, json

AUDIT = '--audit' in sys.argv

def _txt(v):
    return str(v).replace(' ', '').replace('\u3000', '').replace('\n', '') if v is not None else ''

def main(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = None
    for s in wb.worksheets:
        t = _txt(s.title)
        if '交付' in t and ('评估' in t or '成本' in t):
            ws = s; break
    if ws is None:
        print(json.dumps({"error": "未找到附3-交付成本评估 sheet"}, ensure_ascii=False)); return
    grid = [[c.value for c in row] for row in ws.iter_rows()]
    n = max(len(r) for r in grid)

    # 二级表头行: 含"建设内容"的行(实测在行2/3); 一级表头在其上一行
    h2 = None
    for ri in range(min(8, len(grid))):
        if any('建设内容' in _txt(v) for v in grid[ri]):
            h2 = ri; break
    if h2 is None:
        print(json.dumps({"error": "未定位'建设内容'列头"}, ensure_ascii=False)); return

    def col_of(*kws, exclude=(), after=-1, rows=None):
        rows = rows if rows is not None else [h2, h2 - 1]
        for ri in rows:
            if ri < 0 or ri >= len(grid): continue
            for ci in range(n):
                t = _txt(grid[ri][ci] if ci < len(grid[ri]) else None)
                if t and all(k in t for k in kws) and not any(x in t for x in exclude) and ci > after:
                    return ci
        return None

    c_main = col_of('建设内容', exclude=('细分', '模块'))
    c_sub = col_of('细分模块')
    c_item = col_of('具体功能项')
    # 实施阶段人天四列(二级表头"人天汇总(项目经理/产研正编/产研外包/生产外包)")
    c_pm = col_of('人天汇总', '项目经理')
    c_own = col_of('人天汇总', '正编', exclude=('外包',))
    c_rd = col_of('人天汇总', '产研外包')
    c_prod = col_of('人天汇总', '生产外包')
    # 运维阶段人天列(二级表头"项目经理正编人天/产研正编人天/产研外包人天/生产外包人天", 列在运维人力成本区)
    c_ops_hr = col_of('运维阶段', '人力成本')
    guard = c_ops_hr if c_ops_hr is not None else 60
    def ops_col(*kws):
        for ri in (h2, h2 - 1):
            if ri < 0 or ri >= len(grid): continue
            for ci in range(guard, n):
                t = _txt(grid[ri][ci] if ci < len(grid[ri]) else None)
                if t and all(k in t for k in kws):
                    return ci
        return None
    c_pm_ops = ops_col('项目经理', '人天')
    c_own_ops = ops_col('产研', '正编', '人天')
    c_rd_ops = ops_col('产研', '外包', '人天')
    c_prod_ops = ops_col('生产外包', '人天')  # 第一个(数据类); 软件类与数据类同名列, 取到即用
    c_impl_travel = col_of('实施阶段', '差旅成本')
    c_ops_travel = col_of('运维阶段', '差旅成本', after=c_impl_travel if c_impl_travel is not None else -1)

    def travel_cols(total_col):
        if total_col is None: return []
        return [c for c in range(total_col + 1, min(total_col + 6, n))]

    impl_travel_parts = travel_cols(c_impl_travel)
    ops_travel_parts = travel_cols(c_ops_travel)

    def numv(row, idx):
        if idx is None or idx >= len(row) or row[idx] is None: return 0.0
        try: return float(row[idx])
        except (TypeError, ValueError): return 0.0

    rows = []
    row_sources = []  # 每解析行的原表溯源: content 取值格 + 四类人天列坐标(0-based, 与 grid 同体系)
    for ri in range(h2 + 1, len(grid)):
        row = grid[ri]
        # 内容回退链: 建设内容 -> 建设内容-细分模块 -> 具体功能项
        content = ''
        c_content = None
        for c in (c_main, c_sub, c_item):
            if c is not None and c < len(row) and row[c] is not None and str(row[c]).strip():
                content = str(row[c]).strip(); c_content = c; break
        if not content or content.startswith(('填写说明', '制表人', '合计', '序号', '项目名称')):
            continue
        impl = (numv(row, c_pm), numv(row, c_own), numv(row, c_rd), numv(row, c_prod))
        ops = (numv(row, c_pm_ops), numv(row, c_own_ops), numv(row, c_rd_ops), numv(row, c_prod_ops))

        def travel_value(total_col, part_cols):
            parts = [numv(row, c) for c in part_cols]
            part_sum = round(sum(parts), 2)
            return part_sum if part_sum else round(numv(row, total_col), 2)

        impl_travel = travel_value(c_impl_travel, impl_travel_parts)
        ops_travel = travel_value(c_ops_travel, ops_travel_parts)
        impl_has = any(impl) or bool(impl_travel)
        ops_has = any(ops) or bool(ops_travel)
        # 溯源坐标: 实施行记实施列区, 运维行记运维列区(同 r 行横跨两列区)
        def _src(cols_def):
            return {"content": content[:200], "content_pos": [ri, c_content] if c_content is not None else None,
                    "cols": {k: [ri, cv] for k, cv in cols_def if cv is not None}}
        src_impl = _src((('pm_pd', c_pm), ('own_pd', c_own), ('rd_pd', c_rd), ('prod_pd', c_prod)))
        src_ops = _src((('pm_pd', c_pm_ops), ('own_pd', c_own_ops), ('rd_pd', c_rd_ops), ('prod_pd', c_prod_ops)))
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

    def agg(stage=None):
        rs = [r for r in rows if stage is None or r['stage'] == stage]
        return {k: round(sum(r[k] for r in rs), 2) for k in ('pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost')}
    # 原件合计行(第一行含"合计"的行)对照锚定
    total_row = None
    for ri in range(min(4, len(grid))):
        if _txt(grid[ri][0]).startswith('合计'):
            total_row = {
                "impl_pm": numv(grid[ri], c_pm), "impl_own": numv(grid[ri], c_own),
                "impl_rd": numv(grid[ri], c_rd), "impl_prod": numv(grid[ri], c_prod),
                "impl_travel": numv(grid[ri], c_impl_travel),
                "ops_pm": numv(grid[ri], c_pm_ops), "ops_own": numv(grid[ri], c_own_ops),
                "ops_travel": numv(grid[ri], c_ops_travel)
            }
            break
    out = {
        "rows": rows,
        "sum": {**agg(None), "impl": agg("实施"), "ops": agg("运维")},
        "total_row": total_row,
        "meta": {"sheet": ws.title, "rows_parsed": len(rows),
                 "cols": {"main": c_main, "sub": c_sub, "item": c_item, "impl": [c_pm, c_own, c_rd, c_prod],
                          "ops": [c_pm_ops, c_own_ops, c_rd_ops, c_prod_ops],
                          "travel": {"impl_total": c_impl_travel, "impl_parts": impl_travel_parts,
                                     "ops_total": c_ops_travel, "ops_parts": ops_travel_parts}}}
    }
    if AUDIT:
        # 审计模式: 行溯源坐标 + 稀疏网格(全行, 0-based 与 row_sources 同体系)供导入核对视图逐格对账
        out["row_sources"] = row_sources
        grid_cells = []
        for ri, row in enumerate(grid):
            cells = []
            for ci, val in enumerate(row):
                if val is None: continue
                s = str(val)
                if not s.strip(): continue
                cells.append({'r': ri, 'c': ci, 'v': s[:220]})
            if cells: grid_cells.append(cells)
        out["grid"] = grid_cells
    print(json.dumps(out, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: parse_delivery_xlsx.py <xlsx路径>"}, ensure_ascii=False)); sys.exit(1)
    main(sys.argv[1])
