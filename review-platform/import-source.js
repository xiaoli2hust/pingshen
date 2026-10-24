const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const IMPORT_SOURCES_DDL = `
CREATE TABLE IF NOT EXISTS import_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  file_name TEXT,
  file_path TEXT,
  sheet TEXT,
  audit_json TEXT NOT NULL,
  imported_json TEXT NOT NULL,
  importer_id INTEGER,
  importer_name TEXT,
  created_at TEXT,
  backfilled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_import_sources_entity ON import_sources(entity_type, entity_key, id);
`;

const BUDGET_FIELD_LABELS = {
  contract: '合同金额', project_name: '项目名称', customer: '客户名称',
  sub_cost: '分包采购成本', sw_outsource: '软件类生产外包', flex_labor: '灵活用工',
  sales_labor: '销售人力成本', sales_travel: '差旅费', sales_entertain: '招待费', sales_marketing: '市场营销费',
  dev_dept: '交付部门', dev_pd: '正编人天(天)', prod_pd: '生产外包人天(天)',
  rd_outsource: '研发外包费用', del_travel: '交付差旅招待', pm_cost: '项目管理费', del_other: '其他交付费用',
  incentive_factor: '激励系数', opp_code: '商机代码'
};
const AUDIT_KEYS = ['sheet', 'sources', 'pairs', 'unpicked', 'warnings', 'row_sources', 'skipped_rows', 'total_row', 'meta'];
const DELIVERY_LABELS = { pm_pd: '项目经理人天', own_pd: '正编人天', rd_pd: '产研外包人天',
  prod_pd: '生产外包人天', travel_cost: '差旅费' };
const DELIVERY_KEYS = Object.keys(DELIVERY_LABELS);
const TOTAL_KEYS = ['pm', 'own', 'rd', 'prod', 'travel'];

function saveImportSource(db, { entity_type, entity_key, file_name = null, file_path = null,
  parsed, imported, user, created_at = null, backfilled = 0 }) {
  const audit = {};
  for (const key of AUDIT_KEYS) if (Object.hasOwn(parsed, key)) audit[key] = parsed[key];
  const result = db.prepare(`INSERT INTO import_sources
    (entity_type,entity_key,file_name,file_path,sheet,audit_json,imported_json,importer_id,importer_name,created_at,backfilled)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(entity_type, String(entity_key), file_name, file_path,
    parsed.meta?.sheet ?? parsed.sheet?.name ?? null, JSON.stringify(audit), JSON.stringify(imported),
    user?.id ?? null, user?.name ?? null, created_at, backfilled);
  return db.prepare('SELECT * FROM import_sources WHERE id=?').get(result.lastInsertRowid);
}

function latestImportSource(db, entity_type, entity_key) {
  return db.prepare('SELECT * FROM import_sources WHERE entity_type=? AND entity_key=? ORDER BY id DESC LIMIT 1')
    .get(entity_type, String(entity_key)) || null;
}

function budgetImportSource(db, budgetId) {
  const seen = new Set();
  let id = budgetId;
  while (id != null && !seen.has(String(id))) {
    seen.add(String(id));
    const source = latestImportSource(db, 'budget', id);
    if (source) return String(id) === String(budgetId) ? source : { ...source, inherited_from: id };
    const budget = db.prepare('SELECT parent_id FROM budgets WHERE id=?').get(id);
    id = budget?.parent_id;
  }
  return null;
}

function sourceMeta(row) {
  if (!row) return null;
  const { id, file_name, sheet, created_at, importer_name, backfilled } = row;
  const meta = { id, file_name, sheet, created_at, importer_name, backfilled };
  if (row.inherited_from != null) meta.inherited_from = row.inherited_from;
  return meta;
}

function resolveImportSourcePath(root, relative) {
  const base = path.resolve(root);
  const value = String(relative || '');
  if (!value || path.isAbsolute(value)) return null;
  const resolved = path.resolve(base, value);
  return resolved.startsWith(base + path.sep) ? resolved : null;
}

function writeUniqueUpload(dir, filename, data, makeId = () => crypto.randomUUID()) {
  const base = path.basename(String(filename)).replace(/[\\/:*?"<>|]/g, '_');
  for (let attempt = 0; attempt < 10; attempt++) {
    const safe = makeId() + '_' + base;
    const fp = path.join(dir, safe);
    try {
      fs.writeFileSync(fp, data, { flag: 'wx' });
      return { safe, fp };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('无法创建唯一上传文件');
}

function encodeRFC5987Value(value) {
  return encodeURIComponent(String(value)).replace(/['()*]/g,
    character => '%' + character.charCodeAt(0).toString(16).toUpperCase());
}

function missing(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function equal(left, right, type) {
  if (missing(left) || missing(right)) return missing(left) && missing(right);
  if (type === 'num') {
    const a = numeric(left), b = numeric(right);
    if (a != null && b != null) return a === b;
  }
  return typeof left === 'string' && typeof right === 'string' ? left.trim() === right.trim() : left === right;
}

function positions(values) {
  const result = [], seen = new Set();
  for (const pos of values) {
    if (!Array.isArray(pos) || pos.length !== 2 || !pos.every(n => Number.isInteger(n) && n >= 0)) continue;
    const key = pos.join(':');
    if (!seen.has(key)) { result.push([...pos]); seen.add(key); }
  }
  return result;
}

function display(value) {
  return missing(value) ? '空' : String(value);
}

function monthSpan(raw) {
  const parts = [...raw.matchAll(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/g)];
  if (parts.length < 2) return null;
  const dates = parts.slice(0, 2).map(part => {
    const year = Number(part[1]), month = Number(part[2]), day = Number(part[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
  });
  if (dates.some(date => date == null)) return null;
  const days = (dates[1] - dates[0]) / 86400000 + 1;
  return days > 0 ? Math.ceil(days / 30) : null;
}

function conversionReason(key, raw, imported, type) {
  const number = numeric(imported);
  if (type === 'num' && number != null) {
    if (/^(?:old_|new_)?gross_margin$/.test(key) && typeof raw === 'number'
      && Math.abs(raw) <= 1 && raw !== number
      && Math.abs(raw * 100 - number) <= Number.EPSILON * Math.max(1, Math.abs(number)) * 2) return '小数×100';
    if (typeof raw === 'string') {
      if (key === 'presale_period' && monthSpan(raw) === number) return '日期区间折算月数';
      const percent = raw.trim().match(/^([+-]?[\d.,，]+)\s*[%％]$/);
      if (percent && numeric(percent[1].replace(/[,，]/g, '')) === number) return '百分号转百分比数字';
      const unit = raw.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:亿元|万元|元|亿|万|个月|月|年|人天|天)$/);
      if (unit && numeric(unit[1]) === number) return '去单位';
      const formatted = raw.replace(/[,，\s]/g, '');
      if (formatted !== raw && numeric(formatted) === number) return '数字格式归一';
    }
  }
  if (typeof raw === 'string' && typeof imported === 'string') {
    if (raw !== imported && raw.trim() === imported) return '去首尾空格（格式归一）';
    if (typeof type === 'string' && type.startsWith('enum:')) {
      const adopted = type.slice(5).split('|').find(value => raw.replace(/\s/g, '').includes(value));
      if (adopted === imported && raw.trim() !== imported) return '关键字识别';
    }
  }
  return null;
}

function countStatuses(rows) {
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return counts;
}

function formComparison(audit, imported, current, labels, types) {
  const rows = [];
  for (const [key, label] of Object.entries(labels)) {
    const rejected = (audit.unpicked || []).filter(source => source.key === key);
    const source = audit.sources?.[key] || rejected[0];
    const val_positions = source ? positions(Array.isArray(source.val_positions) && source.val_positions.length
      ? source.val_positions : [Object.hasOwn(source, 'raw_pos') ? source.raw_pos : source.val_pos]) : [];
    const lab_positions = source ? positions(Array.isArray(source.lab_positions)
      ? source.lab_positions : [source.lab_pos]) : [];
    const multi = val_positions.length > 1;
    const raw = multi && Array.isArray(source.raws) ? [...source.raws] : source?.raw ?? null;
    const hasRaw = Array.isArray(raw) ? raw.some(value => !missing(value)) : !missing(raw);
    const p = missing(imported[key]) ? null : imported[key], s = missing(current[key]) ? null : current[key];
    if (!hasRaw && p == null && s == null) continue;
    const rejection = source?.reason || rejected.find(item => item.reason)?.reason || '原表值未被导入采用';
    let status, detail;
    if (p != null && !equal(p, s, types[key])) {
      status = '已修改'; detail = `${display(p)} → ${display(s)}`;
    } else if (p != null && multi) {
      status = '表内计算'; detail = '多个原格参与计算';
    } else if (p != null && hasRaw) {
      const reason = conversionReason(key, raw, p, types[key]);
      if (reason) { status = '已换算'; detail = `${reason}：${display(raw)} → ${display(p)}`; }
      else if (equal(raw, p, types[key])) { status = '一致'; detail = ''; }
      else { status = '有差异'; detail = `原表与导入值有差异：${display(raw)} → ${display(p)}`; }
    } else if (p != null) {
      status = '表内计算'; detail = '导入值无单一原格来源';
    } else if (s != null) {
      status = '在线补录'; detail = hasRaw ? rejection : '原表与当次导入均无值，当前在线补录';
    } else {
      status = '未采用'; detail = rejection;
    }
    rows.push({ key, label, raw, imported: p, current: s, status, detail,
      positions: positions([...lab_positions, ...val_positions]), lab_positions, val_positions,
      row: lab_positions[0]?.[0] ?? null });
  }
  rows.sort((a, b) => (a.row ?? Infinity) - (b.row ?? Infinity));
  return { kind: 'form', rows, counts: countStatuses(rows), warnings: [...(audit.warnings || [])] };
}

function deliveryComparison(audit, importedRows, currentRows) {
  const queues = new Map(), matched = new Set(), rows = [];
  const identity = row => JSON.stringify([row.content, row.stage]);
  currentRows.forEach((row, index) => {
    const key = identity(row);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push({ row, index });
  });
  importedRows.forEach((imported, index) => {
    const match = queues.get(identity(imported))?.shift();
    if (match) matched.add(match.index);
    const current = match?.row ?? null;
    const source = audit.row_sources?.[index];
    const lab_positions = positions([source?.content_pos]);
    const val_positions = positions([...DELIVERY_KEYS.map(key => source?.cols?.[key]), ...(source?.travel_parts || [])]);
    const changed_keys = current ? DELIVERY_KEYS.filter(key => !equal(imported[key], current[key], 'num')) : [];
    const noteChanged = current && !equal(imported.note, current.note, 'str');
    const status = !current ? '已删除' : changed_keys.length || noteChanged ? '已修改' : '一致';
    const changes = changed_keys.map(key => `${DELIVERY_LABELS[key]}：${display(imported[key])} → ${display(current[key])}`);
    if (noteChanged) changes.push(`备注：${display(imported.note)} → ${display(current.note)}`);
    rows.push({ key: `imported:${index}`, label: `${imported.content}（${imported.stage}）`,
      content: imported.content, stage: imported.stage, imported, current, status,
      detail: !current ? '当次导入有、当前已删除' : changes.join('；'), changed_keys,
      positions: positions([...lab_positions, ...val_positions]), lab_positions, val_positions,
      row: lab_positions[0]?.[0] ?? null });
  });
  (audit.skipped_rows || []).forEach((source, index) => {
    const lab_positions = positions([source.content_pos]);
    rows.push({ key: `skipped:${index}`, label: source.content, content: source.content, stage: null,
      imported: null, current: null, status: '已剔除', detail: '原表有、系统未保留（无预算数字）', changed_keys: [],
      positions: positions(lab_positions), lab_positions, val_positions: [],
      row: Number.isInteger(source.r) && source.r >= 0 ? source.r : lab_positions[0]?.[0] ?? null });
  });
  currentRows.forEach((current, index) => {
    if (matched.has(index)) return;
    rows.push({ key: `current:${index}`, label: `${current.content}（${current.stage}）`,
      content: current.content, stage: current.stage, imported: null, current, status: '在线补录',
      detail: '当次导入无此行，当前在线补录', changed_keys: [], positions: [], lab_positions: [], val_positions: [], row: null });
  });
  const stageOrder = stage => stage === '实施' ? 0 : stage === '运维' ? 1 : 2;
  rows.sort((a, b) => Number(a.status === '在线补录') - Number(b.status === '在线补录')
    || (a.row ?? Infinity) - (b.row ?? Infinity) || stageOrder(a.stage) - stageOrder(b.stage));
  const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const sum = (items, stage, key) => round2(items.filter(row => row.stage === stage)
    .reduce((total, row) => total + (numeric(row[key]) ?? 0), 0));
  const check = [];
  for (const [stage, prefix] of [['实施', 'impl'], ['运维', 'ops']]) {
    DELIVERY_KEYS.forEach((key, index) => {
      const raw = numeric(audit.total_row?.[`${prefix}_${TOTAL_KEYS[index]}`]);
      const imported = sum(importedRows, stage, key), current = sum(currentRows, stage, key);
      check.push({ stage, key, label: DELIVERY_LABELS[key], raw, imported, current,
        status: raw == null ? '原件合计不可用' : raw !== imported || raw !== current ? '有差异' : '一致' });
    });
  }
  return { kind: 'delivery', rows, counts: countStatuses(rows), check, warnings: [] };
}

module.exports = { IMPORT_SOURCES_DDL, BUDGET_FIELD_LABELS, saveImportSource, latestImportSource,
  budgetImportSource, sourceMeta, resolveImportSourcePath, writeUniqueUpload, encodeRFC5987Value,
  formComparison, deliveryComparison };
