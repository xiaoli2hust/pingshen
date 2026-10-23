# -*- coding: utf-8 -*-
# Excel 导入解析器(预算单/评审单): 键值对 sheet → JSON 系统字段
# 用法: python tools/parse_form_xlsx.py <xlsx路径> --type budget|review
# stdout 输出单行 JSON: {"fields":{系统键:值}, "warnings":[未匹配标签], "meta":{...}}
# 设计定调: Excel 是导入通道——只提取白名单字段原样值, 换算/校验/结构键全归服务端
import sys, json, glob, math, re
from datetime import datetime

# ---------- 标签 → 系统键 模糊映射表 ----------
# 规则: 标签含关键字(去空格/换行/括号内容后 includes)即命中; 数字字段另标注
BUDGET_MAP = {
  # 数字(元)
  'contract': ['合同金额'], 'sub_cost': ['分包采购成本'], 'sw_outsource': ['软件类生产外包'],
  'flex_labor': ['灵活用工'], 'sales_travel': ['销售差旅'], 'sales_entertain': ['招待费'],
  'sales_marketing': ['市场营销'], 'dev_pd': ['正编人天', '自有人天.*交付', '产研正编'],
  'prod_pd': ['生产人天', '生产外包人天'], 'rd_outsource': ['研发外包'],
  'del_travel': ['交付差旅'], 'pm_cost': ['项目管理费'], 'del_other': ['验收', '综合办公', '专业服务'],
  # 枚举
  'dev_dept': ['所属部门', '交付部门', '部门'], 'incentive_factor': ['难度系数', '调节系数'],
  # str
  'customer': ['客户名称'], 'project_name': ['项目名称'],
  'opp_code': ['商机代码'],  # O2: 商机代码贯穿——预算表与评审表同源提取
}
REVIEW_MAP = {
  # num(万元)
  'contract_amount': ['合同金额'], 'sub_amount': ['分包总金额'],
  'designated_sub_amount': ['指定类分包金额'], 'survey_sub_amount': ['测绘类分包金额'],
  'gross_margin': ['贡献毛利率', '毛利率'], 'promo_amount': ['推广激励'],
  'presale_invest': ['售前投入'], 'presale_period': ['实施周期'],
  'ops_years': ['运维周期', '项目运维周期'],
  'cost_happened': ['已发生成本', '项目已发生成本', '项目已发生成本（万元）'],
  # enum 是/否
  'sub_core': ['核心能力'], 'survey': ['是否涉及测绘'], 'jiadao': ['甲导资质'],
  'secret': ['涉密项目'], 'guarantee': ['担保'], 'non_compete': ['竞业'],
  'sub_limit': ['转包限制'], 'over_pay': ['超进度支付'],
  'sub_early_flag': ['分包提前'],
  'data_review': ['数据评审', '数据跨境传输或红线禁止数据'],
  # enum 特殊
  'promo_target': ['面向对象', '激励面向'],
  # str
  'opp_code': ['商机代码'], 'opp_stage': ['商机阶段'], 'region': ['营销区域'],
  'opp_name': ['商机名称'],  # 信息收集表的真项目名(title 首选, 修复"概述长文当标题")
  'customer': ['客户名称'], 'biz_line': ['业务线'], 'sales': ['销售经理'],
  'pm': ['项目经理'], 'sign_date': ['签单时间'], 'sign_path': ['签约路径'],
  'province': ['省份', '项目所在地'], 'settle_method': ['结算方式'],
  'payback_time': ['回款'], 'b2b_scene': ['背靠背'], 'revenue_confirm': ['确收'],
  'payment_terms': ['付款条件'], 'summary': ['项目概述', '概述'],
  # 历史补录专用(不进 BID 白名单, server 从 parsed.fields 直读)
  'decision': ['评审结论', '审批意见', '评审意见'],
  'review_date': ['评审日期', '签批时间', '评审时间'],
}
# 老模板兑底: 无信息收集 sheet 时用附1-预算表(双映射合并)——REVIEW 键优先插入:
# 同关键词(如"合同金额")时 match_field 先遍历到评审语境键(contract_amount), 避免预算键 contract 抢占
BUDGET_REVIEW_FALLBACK = {}
for k, v in REVIEW_MAP.items():
  if k != 'dev_dept': BUDGET_REVIEW_FALLBACK[k] = v
for k, v in BUDGET_MAP.items():
  if k not in BUDGET_REVIEW_FALLBACK: BUDGET_REVIEW_FALLBACK[k] = v
BUDGET_REVIEW_FALLBACK['dev_dept'] = BUDGET_MAP['dev_dept']
NUM_FIELDS = {
  'contract', 'sub_cost', 'sw_outsource', 'flex_labor', 'sales_travel', 'sales_entertain',
  'sales_marketing', 'dev_pd', 'prod_pd', 'rd_outsource', 'del_travel', 'pm_cost', 'del_other',
  'incentive_factor', 'contract_amount', 'sub_amount', 'designated_sub_amount',
  'survey_sub_amount', 'gross_margin', 'promo_amount', 'presale_invest', 'presale_period',
  'cost_happened',
}
DEV_DEPTS = ['交付处', '行业拓展部', '公共服务部', '公共服务业务处-交付运营', '公共服务业务处-市场方案',
  '行业售前部', '企业产品研发部', '数据产品部', '智能地图部', '公共组件部', '研发外包', '生产外包']
PROMO_TARGETS = ['无', '内部', '外部', '均包含']
YES_NO = ['是', '否']

def norm(s):
  return str(s).replace(' ', '').replace('\u3000', '').replace('\n', '') if s is not None else ''

def try_num(s):
  s = str(s).replace(' ', '').replace(',', '').replace('，', '')
  neg = s.startswith('-')
  if neg: s = s[1:]
  idx = s.find('.')
  if idx >= 0: s = s[:idx+1] + s[idx+1:].replace('.', '')
  try: return float(('-' if neg else '') + s)
  except: return None

def try_month_span(s):
  parts = re.findall(r'(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?', str(s))
  if len(parts) < 2: return None
  try:
    start, end = (datetime(*(int(x) for x in part)) for part in parts[:2])
  except ValueError:
    return None
  days = (end - start).days + 1
  return math.ceil(days / 30) if days > 0 else None

def parse_kv(ws):
  """键值对解析: 标签单元格 → 收集候选值(右邻×3+下邻×3, 按优先序)
  返回 [(标签, [候选...]), ...]; 同时填充全局 pair_pos [(标签坐标, [候选坐标...])] 供溯源"""
  grid = [[c for c in r] for r in ws.iter_rows()]
  def cell_val(x):
    if x is None: return None
    v = x.value
    if v is None: return None
    if isinstance(v, str) and v.strip() == '': return None
    return v
  pairs = []
  global pair_pos
  pair_pos = []
  for ri, row in enumerate(grid):
    for ci, cell in enumerate(row):
      lab = cell.value
      if lab is None: continue
      lab = norm(lab)
      if not lab or len(lab) < 2: continue
      if try_num(lab) is not None: continue
      cands = []
      cand_pos = []  # 候选值坐标 [(r,c)] 与 cands 一一对应(溯源: 字段←原表哪个单元格)
      for off in (ci + 1, ci + 2, ci + 3):
        if off < len(row):
          v = cell_val(row[off])
          if v is not None: cands.append(v); cand_pos.append((ri, off))
      if ri + 1 < len(grid):
        for off in (ci, ci + 1, ci + 2):
          if off < len(grid[ri + 1]):
            v = cell_val(grid[ri + 1][off])
            if v is not None: cands.append(v); cand_pos.append((ri + 1, off))
      if cands:
        pairs.append((lab, cands))
        pair_pos.append(((ri, ci), cand_pos))
  return pairs

def is_label_like(v):
  """候选值是否像标签(无法转数字且含中文且短)——仅作 warnings 辅助, 不再用于 str 选值"""
  if try_num(v) is not None: return False
  s = norm(v)
  return len(s) <= 20 and any('\u4e00' <= ch <= '\u9fff' for ch in s)

def pick(key, cands):
  """按字段类型从候选选值: NUM 找首个可转数字; 枚举找含枚举词的; str 紧邻优先(cands[0]);
  opp_code/decision/review_date 按值特征优先(纵排隔列布局下紧邻可能是下一标签)"""
  if key == 'presale_period':
    for c in cands:
      n = try_num(c)
      if n is not None: return n
      n = try_month_span(c)
      if n is not None: return n
    return None
  if key in NUM_FIELDS:
    for c in cands:
      n = try_num(c)
      if n is not None: return n
    return None
  if key == 'dev_dept':
    for c in cands:
      for d in DEV_DEPTS:
        if d in norm(c): return d
    return None
  if key == 'promo_target':
    for c in cands:
      for t in PROMO_TARGETS:
        if t in norm(c): return t
    return None
  # 是否类优先枚举
  for c in cands:
    s = str(c).strip()
    if norm(s) in YES_NO: return norm(s)
  # 值特征优先(业务键): opp_code 含字母+数字且短; decision 含结论词; review_date 日期样式
  if key == 'opp_code':
    for c in cands:
      s = norm(c)
      if 4 <= len(s) <= 20 and any(ch.isdigit() for ch in s) and any(ch.isalpha() for ch in s) and not any('\u4e00' <= ch <= '\u9fff' for ch in s):
        return str(c).strip()
  if key == 'decision':
    for c in cands:
      s = str(c)
      if any(w in s for w in ['通过', '同意', '否决', '放弃', '不通过']): return s.strip()
  if key == 'review_date':
    import re
    for c in cands:
      if re.search(r'20\d{2}[-/年]', str(c)): return str(c).strip()
  # str: 紧邻优先——键值对布局值总紧邻标签, cands[0] 即真值
  if cands:
    first = cands[0]
    if isinstance(first, (int, float)): return first
    return str(first).strip()
  return None

def match_field(label, fmap):
  """标签模糊匹配: 返回系统键或 None"""
  lab = norm(label)
  for key, kws in fmap.items():
    for kw in kws:
      if kw in lab:
        return key
  return None

def convert(key, raw):
  """值兜底转换(仅处理 pick 已选出的值)"""
  if raw is None: return None
  if isinstance(raw, (int, float)): return raw
  return str(raw).strip()

def extract_budget_context(ws):
  def row_label(row_no):
    return ''.join(str(ws.cell(row=row_no, column=c).value or '') for c in range(1, 7))
  if '交付成本' not in row_label(19) or '研发外包' not in row_label(20) or '项目管理费' not in row_label(23):
    return {}, {}
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
      vals.append(n if n is not None else 0)
      positions.append((row_no - 1, 6))
      labels.append(' / '.join(str(ws.cell(row=row_no, column=c).value or '').strip() for c in range(1, 7) if ws.cell(row=row_no, column=c).value))
    fields[key] = round(sum(vals), 2)
    sources[key] = {
      'label': ' + '.join(labels),
      'lab_pos': (rows[0] - 1, 0),
      'val_pos': positions[0],
      'val_positions': positions,
    }
  return fields, sources

def main(path, typ):
  import openpyxl
  is_audit = '--audit' in sys.argv
  # --map-override <json路径>: admin 解析器实验室在线调优——覆盖内置关键词映射
  map_override = {}
  for i, a in enumerate(sys.argv):
    if a == '--map-override' and i + 1 < len(sys.argv):
      try:
        with open(sys.argv[i + 1], encoding='utf-8') as fh: map_override = json.load(fh)
      except Exception as e:
        return {'error': 'map-override 加载失败: ' + str(e)}
  if map_override:
    for sec, mp in (('REVIEW', REVIEW_MAP), ('BUDGET', BUDGET_MAP), ('FALLBACK', BUDGET_REVIEW_FALLBACK)):
      ov = (map_override.get(typ.upper()) or {}).get(sec) or (map_override.get(sec) or {})
      if ov:
        for k, kws in ov.items():
          if isinstance(kws, list): mp[k] = [str(x) for x in kws]
          if sec == 'FALLBACK': BUDGET_REVIEW_FALLBACK[k] = [str(x) for x in kws]
  wb = openpyxl.load_workbook(path, data_only=True)
  sheet_kw = ''
  for i, a in enumerate(sys.argv):
    if a == '--sheet' and i + 1 < len(sys.argv): sheet_kw = sys.argv[i + 1]
  if typ == 'budget':
    fmap = BUDGET_MAP
    ws = None
    for s in wb.worksheets:
      t = norm(s.title)
      if '附1' in t or '预算表' in t: ws = s; break
    if ws is None: return {'error': '未找到附1-预算表 sheet'}
  else:
    fmap = REVIEW_MAP
    ws = None
    # 按 --sheet 关键词优先(同文件含多个信息收集 sheet 时选对口的, 如 bid→投标决策)
    for s in wb.worksheets:
      t = norm(s.title)
      if '信息收集' in t and ('评审' in t or '决策' in t) and (not sheet_kw or sheet_kw in t): ws = s; break
    if ws is None and sheet_kw:
      for s in wb.worksheets:
        t = norm(s.title)
        if '信息收集' in t and ('评审' in t or '决策' in t): ws = s; break
    if ws is None:
      # 历史老模板兑底: 无信息收集 sheet → 附1-预算表(双映射合并)或首张 sheet
      for s in wb.worksheets:
        t = norm(s.title)
        if '附1' in t or '预算表' in t:
          ws = s; fmap = BUDGET_REVIEW_FALLBACK; break
      if ws is None: ws = wb.worksheets[0]; fmap = BUDGET_REVIEW_FALLBACK
  pairs = parse_kv(ws)
  fields, warnings, seen = {}, [], set()
  for label, cands in pairs:
    key = match_field(label, fmap)
    if key is None:
      warnings.append(label)
      continue
    val = pick(key, cands)
    if key in seen and fields.get(key) not in (None, ''):
      if key == 'del_other':  # 多项合计(验收/办公/服务)
        n = try_num(val)
        pn = fields.get(key) if isinstance(fields.get(key), (int, float)) else 0
        if n is not None: fields[key] = (pn or 0) + n
      elif key == 'data_review' and '数据评审' in norm(label) and val not in (None, ''):
        fields[key] = val
      continue
    seen.add(key)
    if val is None or val == '':
      continue
    fields[key] = val
  context_sources = {}
  if typ == 'budget':
    context_fields, context_sources = extract_budget_context(ws)
    fields.update(context_fields)
  # 溯源: fields → 原表坐标(标签格+选中的值格)——导入核对视图高亮用
  sources = {}
  if is_audit:
    for idx, (label, cands) in enumerate(pairs):
      key = match_field(label, fmap)
      if key is None or key not in fields: continue
      # 找到该字段选中的值在候选中的序号(值相等即命中; 纵排/隔列布局下 cands[0] 为首选)
      lab_pos, cand_pos = pair_pos[idx] if idx < len(pair_pos) else (None, [])
      val_pos = cand_pos[0] if cand_pos else None
      selected = False
      for ci2, cv in enumerate(cands):
        if str(fields.get(key)) == str(cv):
          val_pos = cand_pos[ci2] if ci2 < len(cand_pos) else val_pos
          selected = True
          break
      source = {'label': str(label), 'lab_pos': lab_pos, 'val_pos': val_pos}
      if key == 'data_review' and '数据评审' in norm(label) and selected:
        sources[key] = source
      else:
        sources.setdefault(key, source)
    sources.update(context_sources)
  result = {'fields': fields, 'warnings': sorted(set(warnings))[:20],
            'meta': {'sheet': ws.title, 'pairs_total': len(pairs), 'matched': len(fields)}}
  if is_audit:
    # 审计模式: 原表键值对(标签+首候选值+坐标) + 命中溯源 + 网格(前 50 行)供导入核对视图
    result['pairs'] = [[lab, (str(cands[0]) if not isinstance(cands[0], (int, float)) else cands[0]) if cands else None,
                        (pair_pos[i][0] if i < len(pair_pos) else None)] for i, (lab, cands) in enumerate(pairs)]
    result['sources'] = sources
    grid_out = []
    for r, row in enumerate(grid_rows(ws, 50)):
      cells = []
      for c, v in enumerate(row):
        if v is None: continue
        s = str(v)
        if not s.strip(): continue
        cells.append({'r': r, 'c': c, 'v': s[:60]})
      if cells: grid_out.append(cells)
    result['grid'] = grid_out
  return result

def grid_rows(ws, max_rows):
  """前 max_rows 行的稀疏网格 [[值 or None, ...], ...]"""
  out = []
  for r in ws.iter_rows(max_row=max_rows):
    out.append([c.value for c in r])
  return out

if '--dump-map' in sys.argv:
  # admin 实验室: 输出内置映射(前端调优表格的默认值来源)
  print(json.dumps({'REVIEW': REVIEW_MAP, 'BUDGET': BUDGET_MAP, 'FALLBACK': BUDGET_REVIEW_FALLBACK}, ensure_ascii=False))
  sys.exit(0)

if __name__ == '__main__':
  if len(sys.argv) < 2 or '--type' not in sys.argv:
    print(json.dumps({'error': '用法: parse_form_xlsx.py <xlsx> --type budget|review'}, ensure_ascii=False))
    sys.exit(1)
  path = sys.argv[1]
  typ = sys.argv[sys.argv.index('--type') + 1]
  print(json.dumps(main(path, typ), ensure_ascii=False))
