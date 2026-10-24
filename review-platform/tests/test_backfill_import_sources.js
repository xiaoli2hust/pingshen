// Task6 旧单原件补录(BF)套件: 真实工具 + 真实 Python 解析器 + 真实 XLSX 原件, 只在自建临时库/临时上传目录上运行。
// 用法: Node 22 tests/test_backfill_import_sources.js [--log=tests/green_import_source_backfill.txt]
// 红线: 绝不打开共享 data/review.db 或 data/uploads; 临时目录建在 os.tmpdir() 下(先核父目录), 收尾只删本套件创建的文件。
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'backfill_import_sources.js');
const REALDATA = path.join(__dirname, 'realdata');
const SHARED_DB = path.resolve(ROOT, 'data', 'review.db');
const SHARED_UPLOADS = path.resolve(ROOT, 'data', 'uploads');
const { mergeDraft, BID_WHITELIST } = require('../agent.js');
const { saveImportSource, latestImportSource, budgetImportSource, IMPORT_SOURCES_DDL } = require('../import-source.js');

const LOG = [];
let pass = 0, fail = 0;
const log = line => { LOG.push(line); console.log(line); };
const check = (id, name, fn) => {
  try { fn(); pass++; log('PASS - ' + id + ' ' + name); }
  catch (e) { fail++; log('FAIL - ' + id + ' ' + name + ' | ' + String(e.message).split('\n').slice(0, 6).join(' / ')); }
};

// ---------- 临时目录与自有文件登记 ----------
const created = { files: [], dirs: [] };
function makeScratch() {
  const parent = path.resolve(os.tmpdir());
  assert.ok(fs.statSync(parent).isDirectory(), 'os.tmpdir() 必须是已存在目录');
  const dir = fs.mkdtempSync(path.join(parent, 'bf-import-src-'));
  assert.equal(path.dirname(path.resolve(dir)), parent, '临时目录父级必须为 os.tmpdir()');
  assert.ok(!path.resolve(dir).startsWith(path.resolve(ROOT) + path.sep), '临时目录不得落在仓库内');
  created.dirs.push(dir);
  return dir;
}
function mkdirOwn(dir) { fs.mkdirSync(dir); created.dirs.push(dir); return dir; }
function copyOwn(src, dst) { fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL); created.files.push(dst); return dst; }
function cleanup() {
  for (const f of created.files.reverse()) { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { log('WARN - 清理文件失败 ' + f + ' ' + e.message); } }
  for (const d of created.dirs.reverse()) { try { if (fs.existsSync(d)) fs.rmdirSync(d); } catch (e) { log('WARN - 清理目录失败(非空即说明有未登记文件) ' + d + ' ' + e.message); } }
}

function realFile(code) {
  const names = fs.readdirSync(REALDATA).filter(n => n.includes(code) && /\.xlsx$/i.test(n));
  assert.equal(names.length, 1, code + ' 必须定位唯一真实 xlsx 原件');
  return { file: path.join(REALDATA, names[0]), name: names[0] };
}

function runPython(file, args) {
  const r = spawnSync('python', ['-X', 'utf8', path.join(ROOT, 'tools', args[0]), file, ...args.slice(1), '--audit'],
    { encoding: 'utf8', windowsHide: true, shell: false, cwd: ROOT, timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, 'python exit=' + r.status + ' ' + String(r.stderr).slice(0, 200));
  const parsed = JSON.parse(r.stdout);
  assert.ok(!parsed.error, parsed.error);
  return parsed;
}

function runTool(args) {
  const r = spawnSync(process.execPath, [TOOL, ...args],
    { encoding: 'utf8', windowsHide: true, shell: false, cwd: ROOT, timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  log('TOOL ' + args.map(a => a.replace(/^(--\w[\w-]*=).*[\\/]/, '$1…/')).join(' ') + ' -> exit=' + r.status);
  for (const l of String(r.stdout || '').split(/\r?\n/).filter(l => /^(ADOPT|GAP|SKIP-EXISTING|N\/A|INHERIT|HOLD|INSERTED|FATAL)/.test(l))) log('  | ' + l);
  const line = String(r.stdout || '').split(/\r?\n/).reverse().find(l => l.startsWith('SUMMARY '));
  let summary = null;
  try { summary = line ? JSON.parse(line.slice(8)) : null; } catch (e) { summary = null; }
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), summary, error: r.error };
}

// 与 server.js 同口径的 DDL 子集(实体表列名与生产一致), 另加 import_sources 共享 DDL
const FIXTURE_DDL = `
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, name TEXT, role TEXT, dept TEXT, phone TEXT);
CREATE TABLE reviews(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, title TEXT, applicant_id INTEGER, applicant_name TEXT,
  status TEXT DEFAULT 'draft', round INTEGER DEFAULT 1, form_json TEXT DEFAULT '{}', light TEXT, route TEXT, report TEXT, judge_detail TEXT,
  created_at TEXT, updated_at TEXT, archived_at TEXT, report_html TEXT, budget_json TEXT, era TEXT DEFAULT 'online', budget_id INTEGER,
  opp_code TEXT, decision_result TEXT, decision_note TEXT, decision_by TEXT, decision_at TEXT);
CREATE TABLE tasks(id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER, round INTEGER, ind_key TEXT, ind_name TEXT, dept TEXT,
  standards TEXT, status TEXT DEFAULT 'pending', light TEXT, opinion TEXT, done_by TEXT, done_at TEXT);
CREATE TABLE attachments(id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER, field TEXT, filename TEXT, filepath TEXT, uploaded_at TEXT);
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, review_id INTEGER, action TEXT, actor TEXT, detail TEXT, created_at TEXT);
CREATE TABLE budgets(id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft',
  owner_id INTEGER NOT NULL, project_name TEXT DEFAULT '', fields TEXT NOT NULL DEFAULT '{}', calc TEXT, settings_snapshot TEXT, parent_id INTEGER,
  created_at TEXT, updated_at TEXT, opp_code TEXT);
CREATE TABLE agent_messages(id INTEGER PRIMARY KEY AUTOINCREMENT, budget_id INTEGER, review_id INTEGER, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT);
CREATE TABLE budget_delivery(budget_id INTEGER PRIMARY KEY, rows_json TEXT DEFAULT '[]', source_file TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by TEXT);
CREATE TABLE opps(opp_code TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', customer TEXT DEFAULT '', status TEXT DEFAULT 'pending',
  created_by INTEGER, created_at TEXT, updated_at TEXT);
CREATE TABLE opp_delivery(opp_code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', rows_json TEXT DEFAULT '[]', source_file TEXT,
  owner_id INTEGER, created_at TEXT, updated_at TEXT);
`;

function snapshot(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const out = {};
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('import_sources','sqlite_sequence') ORDER BY name").all();
    for (const { name } of tables) out[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(r => ({ ...r }));
    return out;
  } finally { db.close(); }
}
function sources(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try { return db.prepare('SELECT * FROM import_sources ORDER BY id').all().map(r => ({ ...r })); } finally { db.close(); }
}

const iso = ms => new Date(ms).toISOString();
const SERVER_ROW = r => ({ // server cleanDeliveryRows 八字段口径(测试侧独立复算)
  content: String(r.content || '').slice(0, 200), stage: r.stage === '运维' ? '运维' : '实施',
  pm_pd: r.pm_pd, own_pd: r.own_pd, rd_pd: r.rd_pd, prod_pd: r.prod_pd, travel_cost: r.travel_cost, note: String(r.note || '')
});

function sheetValid(sheet) {
  assert.ok(sheet && typeof sheet === 'object', 'audit.sheet 缺失');
  assert.ok(typeof sheet.name === 'string' && sheet.name, 'sheet.name 缺失');
  assert.ok(Array.isArray(sheet.cells) && sheet.cells.length > 0, 'sheet.cells 为空');
  for (const c of sheet.cells) {
    assert.ok(Array.isArray(c) && (c.length === 3 || c.length === 4), '单元格形状非 [r,c,d(,v)]');
    assert.ok(Number.isInteger(c[0]) && c[0] >= 0 && c[0] < sheet.max_row, '行坐标越界 ' + c[0]);
    assert.ok(Number.isInteger(c[1]) && c[1] >= 0 && c[1] < sheet.max_col, '列坐标越界 ' + c[1]);
  }
  for (const m of sheet.merges || []) assert.ok(Array.isArray(m) && m.length === 4 && m.every(n => Number.isInteger(n) && n >= 0), '合并区域非法');
}

// ---------- 场景 A: 无缺口的受控演示库 ----------
const T = { b1: 1791000000000, r1: 1791000001000, b3: 1791000002000, d1: 1791000003000, d3: 1791000004000, r2: 1791000005000,
  old: 1790000000000, later: 1791000009000 };

function buildScenarioA(dir) {
  const up = mkdirOwn(path.join(dir, 'uploads'));
  const imp = mkdirOwn(path.join(up, 'import'));
  const dlv = mkdirOwn(path.join(up, 'delivery'));
  const f8572 = realFile('PL00008572'), f8111 = realFile('PL00008111');
  const names = {
    b1: T.b1 + '_' + f8572.name, r1: T.r1 + '_' + f8572.name, old: T.old + '_old-PL00008572.xlsx', later: T.later + '_PL00008572-later.xlsx',
    b3: T.b3 + '_' + f8111.name, r2: T.r2 + '_' + f8111.name, d1: T.d1 + '_PL00008572-附3.xlsx', d3: T.d3 + '_PL00008111-附3.xlsx'
  };
  for (const k of ['b1', 'r1', 'old', 'later']) copyOwn(f8572.file, path.join(imp, names[k]));
  for (const k of ['b3', 'r2']) copyOwn(f8111.file, path.join(imp, names[k]));
  copyOwn(f8572.file, path.join(dlv, names.d1));
  copyOwn(f8111.file, path.join(dlv, names.d3));

  const exp = {
    b1: mergeDraft(runPython(f8572.file, ['parse_form_xlsx.py', '--type', 'budget']).fields, {}),
    b3: mergeDraft(runPython(f8111.file, ['parse_form_xlsx.py', '--type', 'budget']).fields, {}),
    r1parsed: runPython(f8572.file, ['parse_form_xlsx.py', '--type', 'review', '--sheet', '投标决策']),
    r2parsed: runPython(f8111.file, ['parse_form_xlsx.py', '--type', 'review', '--sheet', '投标决策']),
    d1parsed: runPython(f8572.file, ['parse_delivery_xlsx.py']),
    d3parsed: runPython(f8111.file, ['parse_delivery_xlsx.py'])
  };
  const reviewForm = parsed => {
    const f = mergeDraft(parsed.fields, {}, { whitelist: BID_WHITELIST });
    if (f.gross_margin !== undefined && f.gross_margin > 0 && f.gross_margin < 1) f.gross_margin = Math.round(f.gross_margin * 10000) / 100;
    return f;
  };
  exp.r1 = reviewForm(exp.r1parsed);
  exp.r2 = reviewForm(exp.r2parsed);
  exp.d1 = exp.d1parsed.rows.map(SERVER_ROW);
  exp.d3 = exp.d3parsed.rows.map(SERVER_ROW);

  const dbFile = path.join(dir, 'fixture_a.db');
  created.files.push(dbFile, dbFile + '-journal');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec(FIXTURE_DDL); db.exec(IMPORT_SOURCES_DDL);
    const u = db.prepare('INSERT INTO users(id,username,password_hash,name,role,dept) VALUES(?,?,?,?,?,?)');
    u.run(1, 'zhichizu', 'salt:hash1', '销售支持组', '销售支持组', '销售支持组');
    u.run(2, 'sales1', 'salt:hash2', '销售经理- demo', '销售经理', '营销部');
    u.run(3, 'pm1', 'salt:hash3', '项目经理- demo', '项目经理', '交付部');
    const b = db.prepare('INSERT INTO budgets(id,code,version,status,owner_id,project_name,fields,calc,parent_id,created_at,updated_at,opp_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    b.run(1, 'B-2026-0001', 1, 'locked', 2, '江西', JSON.stringify({ ...exp.b1, contract: 999999 }), '{"x":1}', null, iso(T.b1 + 9), iso(T.b1 + 99999), 'PL00008572');
    b.run(2, 'B-2026-0002', 2, 'draft', 2, '江西', JSON.stringify({ ...exp.b1, contract: 888888 }), null, 1, '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 'PL00008572');
    b.run(3, 'B-2026-0003', 1, 'locked', 3, '坪山', JSON.stringify(exp.b3), '{"y":2}', null, iso(T.b3 + 5), iso(T.b3 + 5), 'PL00008111');
    b.run(4, 'B-2026-0004', 1, 'draft', 1, '对话建单', '{"contract":1}', null, null, '2026-10-03T00:00:00.000Z', '2026-10-03T00:00:00.000Z', null);
    b.run(5, 'B-2026-0005', 1, 'locked', 1, '已有源', '{}', null, null, iso(T.b1 + 50), iso(T.b1 + 50), 'PL00008572');
    const m = db.prepare('INSERT INTO agent_messages(budget_id,review_id,role,content,created_at) VALUES(?,?,?,?,?)');
    m.run(1, null, 'user', '[Excel导入] ' + names.later + ' -> 99 字段(伪造的用户消息, 不得采用)', iso(T.b1 + 1));
    m.run(1, null, 'assistant', `[Excel导入] ${names.b1} -> 14 字段(命中 14/105 对, 未匹配 3 项)——请核对后编交付明细并人工锁定`, iso(T.b1 + 9));
    m.run(1, null, 'assistant', '[交付明细保存] 2 行(正编39+PM7+生产184人天,差旅6000元)', iso(T.b1 + 500));
    m.run(3, null, 'assistant', `[Excel导入] ${names.b3} -> 14 字段(命中 14/106 对, 未匹配 2 项)——请核对后编交付明细并人工锁定`, iso(T.b3 + 5));
    m.run(4, null, 'assistant', '已记录合同金额 1 万元', '2026-10-03T00:00:01.000Z');
    m.run(5, null, 'assistant', `[Excel导入] ${names.b1} -> 14 字段(命中 14/105 对, 未匹配 3 项)——请核对后编交付明细并人工锁定`, iso(T.b1 + 50));
    const r = db.prepare('INSERT INTO reviews(id,type,title,applicant_id,applicant_name,status,round,form_json,light,judge_detail,created_at,updated_at,archived_at,era,opp_code,decision_result,budget_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    r.run(1, 'bid', '江西省天地图POI数据服务项目', 2, '销售经理- demo', 'archived', 1, JSON.stringify({ ...exp.r1, contract_amount: 99 }), 'yellow', '{"light":"yellow"}', iso(T.r1 + 7), iso(T.r1 + 777777), iso(T.r1 + 777777), 'online', 'PL00008572', '通过', 1);
    r.run(2, 'bid', '坪山区三维数据更新2026', 1, '销售支持组', 'archived', 1, JSON.stringify(exp.r2), 'none', '{"era":"history"}', iso(T.r2 + 3), iso(T.r2 + 3), '2026-08-10', 'history', 'PL00008111', '通过', null);
    r.run(3, 'presale', '表单建单', 2, '销售经理- demo', 'draft', 1, '{"opp_code":"PL00008068"}', null, null, '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', null, 'online', 'PL00008068', null, null);
    r.run(4, 'bid', '已有源评审', 2, '销售经理- demo', 'draft', 1, '{}', null, null, iso(T.r1 + 8), iso(T.r1 + 8), null, 'online', 'PL00008572', null, null);
    const e = db.prepare('INSERT INTO events(review_id,action,actor,detail,created_at) VALUES(?,?,?,?,?)');
    e.run(1, '保存草稿', '销售经理- demo', 'Excel 导入(34 字段, 命中 34/162 对)——请核对补充后提交', iso(T.r1 + 7));
    e.run(1, '提交', '销售经理- demo', '', iso(T.r1 + 1000));
    e.run(2, '历史数据导入', '销售支持组', '来源:x.xlsx', iso(T.r2 + 3));
    e.run(3, '保存草稿', '销售经理- demo', '表单保存', '2026-10-05T00:00:00.000Z');
    e.run(4, '保存草稿', '销售经理- demo', 'Excel 导入(1 字段, 命中 1/1 对)——请核对补充后提交', iso(T.r1 + 8));
    db.prepare('INSERT INTO attachments(review_id,field,filename,filepath,uploaded_at) VALUES(?,?,?,?,?)').run(2, '历史评审表原件', f8111.name, 'import/' + names.r2, iso(T.r2 + 3));
    db.prepare("INSERT INTO tasks(review_id,round,ind_key,ind_name,dept,status,light,opinion,done_by,done_at) VALUES(1,1,'tech','技术可行性','FDE','done','green','ok','fde1',?)").run(iso(T.r1 + 2000));
    db.prepare("INSERT INTO opps(opp_code,title,status,created_by,created_at,updated_at) VALUES('PL00008572','江西','reviewing',2,?,?)").run(iso(T.b1), iso(T.b1));
    db.prepare("INSERT INTO settings(key,value,updated_at,updated_by) VALUES('price_rd_outsource','995','x','seed')").run();
    const od = db.prepare('INSERT INTO opp_delivery(opp_code,status,rows_json,source_file,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    od.run('PL00008572', 'confirmed', JSON.stringify(exp.d1.map((row, i) => i === 0 ? { ...row, own_pd: 40, cost: 1 } : { ...row, cost: 2 })), names.d1, 3, iso(T.d1 - 5000), iso(T.d1 + 60000));
    od.run('PL00008068', 'draft', JSON.stringify([{ content: '在线手填', stage: '实施', pm_pd: 1, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '' }]), '', 2, '2026-10-06T00:00:00.000Z', '2026-10-06T00:00:00.000Z');
    db.prepare('INSERT INTO budget_delivery(budget_id,rows_json,source_file,created_at,updated_at) VALUES(?,?,?,?,?)').run(3, JSON.stringify(exp.d3), names.d3, iso(T.d3), iso(T.d3 + 10));
    // 既有来源(非补录): 工具必须跳过, 不追加
    saveImportSource(db, { entity_type: 'budget', entity_key: '5', file_name: 'pre.xlsx', file_path: 'import/' + names.b1,
      parsed: { meta: { sheet: '附1-预算表' } }, imported: { contract: 1 }, user: { id: 1, name: '销售支持组' }, created_at: iso(T.b1 + 50) });
    saveImportSource(db, { entity_type: 'review', entity_key: '4', file_name: 'pre.xlsx', file_path: 'import/' + names.r1,
      parsed: { meta: { sheet: '投标决策' } }, imported: { opp_code: 'PL00008572' }, user: { id: 2, name: '销售经理- demo' }, created_at: iso(T.r1 + 8) });
  } finally { db.close(); }
  return { dbFile, up, names, exp };
}

// ---------- 场景 B: 缺口/边界库 ----------
function buildScenarioB(dir) {
  const up = mkdirOwn(path.join(dir, 'uploads_b'));
  const imp = mkdirOwn(path.join(up, 'import'));
  mkdirOwn(path.join(up, 'delivery'));
  const f8572 = realFile('PL00008572'), f8111 = realFile('PL00008111'), f8068 = realFile('PL00008068');
  const names = {
    ok: '1792000000000_' + f8572.name,
    genuine8111: '1792000001000_PL00008111-genuine.xlsx',
    mislabeled: '1792000002000_PL00008111-mislabeled.xlsx',
    late8068: '1792000009000_PL00008068-late.xlsx'
  };
  copyOwn(f8572.file, path.join(imp, names.ok));
  copyOwn(f8111.file, path.join(imp, names.genuine8111));
  copyOwn(f8572.file, path.join(imp, names.mislabeled)); // 文件名写 8111, 内容是 8572
  copyOwn(f8068.file, path.join(imp, names.late8068));
  const outside = path.join(dir, 'evil.xlsx'); // 上传目录外的真实文件: 路径穿越即便存在也不得采用
  copyOwn(f8572.file, outside);
  const dbFile = path.join(dir, 'fixture_b.db');
  created.files.push(dbFile, dbFile + '-journal');
  const db = new DatabaseSync(dbFile);
  try {
    db.exec(FIXTURE_DDL); db.exec(IMPORT_SOURCES_DDL);
    db.prepare("INSERT INTO users(id,username,name,role) VALUES(1,'u1','用户一','销售经理')").run();
    const b = db.prepare("INSERT INTO budgets(id,code,status,owner_id,fields,created_at,updated_at,opp_code) VALUES(?,?,'locked',1,'{}',?,?,?)");
    b.run(1, 'B-1', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'PL00008572');
    b.run(2, 'B-2', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'PL00008572');
    b.run(3, 'B-3', iso(1792000000009), iso(1792000000009), 'PL00008572');
    const m = db.prepare("INSERT INTO agent_messages(budget_id,role,content,created_at) VALUES(?,'assistant',?,?)");
    m.run(1, '[Excel导入] 1791999999999_PL00008572-gone.xlsx -> 14 字段(命中 14/105 对, 未匹配 0 项)', '2026-10-01T00:00:00.000Z');
    m.run(2, '[Excel导入] ../../evil.xlsx -> 14 字段(命中 14/105 对, 未匹配 0 项)', '2026-10-01T00:00:00.000Z');
    m.run(3, `[Excel导入] ${names.ok} -> 14 字段(命中 14/105 对, 未匹配 0 项)`, iso(1792000000009));
    const r = db.prepare("INSERT INTO reviews(id,type,applicant_id,status,form_json,created_at,updated_at,opp_code,light,decision_result) VALUES(?,?,1,?,?,?,?,?,?,?)");
    r.run(1, 'bid', 'archived', '{"opp_code":"PL00008111"}', iso(1792000005000), iso(1792000005000), 'PL00008111', 'green', '通过');
    r.run(2, 'bid', 'draft', '{"opp_code":"PL00008068"}', iso(1792000005000), iso(1792000005000), 'PL00008068', null, null);
    const e = db.prepare("INSERT INTO events(review_id,action,actor,detail,created_at) VALUES(?,'保存草稿','用户一','Excel 导入(3 字段, 命中 3/3 对)——请核对补充后提交',?)");
    e.run(1, iso(1792000005000)); e.run(2, iso(1792000005000));
    const od = db.prepare("INSERT INTO opp_delivery(opp_code,status,rows_json,source_file,owner_id,created_at,updated_at) VALUES(?,'confirmed',?,?,1,?,?)");
    const one = JSON.stringify([{ content: 'x', stage: '实施', pm_pd: 1, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, note: '' }]);
    od.run('PL00008111', one, '1792000003000_missing-附3.xlsx', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
    od.run('PL00008572', one, '..\\..\\evil.xlsx', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');
  } finally { db.close(); }
  return { dbFile, up, names };
}

function main() {
  log('BF 套件: 真实 tools/backfill_import_sources.js + 真实 Python 解析器 + tests/realdata 真实 XLSX(只读复制到 os.tmpdir 临时目录)');
  const dir = makeScratch();
  log('INFO - 临时目录(父级已核为 os.tmpdir()): ' + dir);
  let A, B;
  check('BF-00', '受控夹具库与临时上传目录就位(真实解析器预期值独立复算; 非共享库)', () => {
    A = buildScenarioA(dir);
    B = buildScenarioB(dir);
    for (const p of [A.dbFile, B.dbFile, A.up, B.up]) {
      assert.notEqual(path.resolve(p), SHARED_DB); assert.notEqual(path.resolve(p), SHARED_UPLOADS);
      assert.ok(path.resolve(p).startsWith(path.resolve(dir) + path.sep));
    }
    assert.equal(A.exp.d1.length, 2); assert.equal(A.exp.d1parsed.skipped_rows.length, 10);
  });
  if (!A || !B) return;
  const logA = path.join(dir, 'bf_a.log'); created.files.push(logA);
  const before = snapshot(A.dbFile);
  const beforeBytes = fs.readFileSync(A.dbFile);

  // dry-run: 只出计划, 不写库
  const dry = runTool(['--db=' + A.dbFile, '--uploads=' + A.up, '--dry-run']);
  check('BF-01', '--dry-run 计划 6 条且零写入(库字节不变), 退出码 0', () => {
    assert.equal(dry.status, 0, dry.stderr.slice(0, 300) + dry.stdout.slice(-300));
    assert.ok(dry.summary, '缺 SUMMARY 行');
    assert.equal(dry.summary.planned, 6); assert.equal(dry.summary.inserted, 0);
    assert.ok(Buffer.compare(fs.readFileSync(A.dbFile), beforeBytes) === 0, 'dry-run 改动了库文件');
  });

  const run1 = runTool(['--db=' + A.dbFile, '--uploads=' + A.up, '--log=' + logA]);
  check('BF-02', '首跑补录 6 条(2 budget+2 review+1 delivery_opp+1 delivery_budget), 零缺口, 退出码 0, 停机前提在 stdout 明示', () => {
    assert.equal(run1.status, 0, run1.stderr.slice(0, 300) + run1.stdout.slice(-600));
    assert.ok(/停机|服务.*停/.test(run1.stdout), 'stdout 未声明服务停机前提');
    assert.equal(run1.summary.inserted, 6);
    assert.deepEqual(run1.summary.gaps, []);
    assert.deepEqual(run1.summary.by_type, { budget: 2, review: 2, delivery_opp: 1, delivery_budget: 1 });
  });
  const after = sources(A.dbFile);
  const pick = (type, key) => after.filter(s => s.entity_type === type && s.entity_key === key);
  const one = (type, key) => { const rows = pick(type, key); assert.equal(rows.length, 1, type + ':' + key + ' 来源条数=' + rows.length); return rows[0]; };
  const audit = s => JSON.parse(s.audit_json), imported = s => JSON.parse(s.imported_json);

  check('BF-03', '预算#1: 取 assistant [Excel导入] 指名原件(不取 user 伪造消息), 原名去系统时间戳前缀, 导入值=当前解析器 mergeDraft, 不复制已改字段', () => {
    const s = one('budget', '1');
    assert.equal(s.file_path, 'import/' + A.names.b1);
    assert.equal(s.file_name, A.names.b1.replace(/^\d+_/, ''));
    assert.equal(s.backfilled, 1);
    assert.deepEqual(imported(s), A.exp.b1);
    assert.equal(imported(s).contract, 240000, '导入值必须来自原件而非当前已改字段 999999');
    assert.equal(s.importer_id, 2); assert.equal(s.importer_name, '销售经理- demo');
    assert.equal(s.created_at, iso(T.b1 + 9));
    assert.equal(s.sheet, '附1-预算表');
    sheetValid(audit(s).sheet);
    assert.equal(audit(s).meta.backfill.reparsed, true, 'audit.meta.backfill.reparsed 标记缺失');
  });
  check('BF-04', '预算#3(8111) 补录; 派生预算#2 不重复建源而沿 parent 继承 #1; 对话预算#4 不适用无源', () => {
    const s = one('budget', '3');
    assert.deepEqual(imported(s), A.exp.b3); assert.equal(s.importer_id, 3); assert.equal(s.backfilled, 1);
    assert.equal(pick('budget', '2').length, 0); assert.equal(pick('budget', '4').length, 0);
    const db = new DatabaseSync(A.dbFile, { readOnly: true });
    try { const inh = budgetImportSource(db, 2); assert.equal(String(inh.inherited_from), '1'); assert.equal(inh.file_path, 'import/' + A.names.b1); }
    finally { db.close(); }
  });
  check('BF-05', '评审#1: 同码且上传时间≤创建时间的最新 import 原件(排除更早/更晚同码文件与预算原件), 重解析核码, BID 白名单+毛利率归一, 不复制已改字段', () => {
    const s = one('review', '1');
    assert.equal(s.file_path, 'import/' + A.names.r1);
    assert.equal(s.file_name, A.names.r1.replace(/^\d+_/, ''));
    assert.deepEqual(imported(s), A.exp.r1);
    assert.equal(imported(s).opp_code, 'PL00008572');
    assert.equal(imported(s).contract_amount, 24, '导入值必须来自原件而非当前已改字段 99');
    assert.equal(imported(s).gross_margin, 5.52);
    assert.equal(s.importer_id, 2); assert.equal(s.created_at, iso(T.r1 + 7)); assert.equal(s.backfilled, 1);
    assert.equal(s.sheet, '投标决策评审-信息收集与前置评审');
    sheetValid(audit(s).sheet);
    assert.equal(audit(s).meta.backfill.reparsed, true);
  });
  check('BF-06', '评审#2(history 证据): 选同码最新≤创建时间文件; 无 Excel 证据的表单评审#3 不适用无源', () => {
    const s = one('review', '2');
    assert.equal(s.file_path, 'import/' + A.names.r2);
    assert.deepEqual(imported(s), A.exp.r2); assert.equal(s.importer_id, 1); assert.equal(s.importer_name, '销售支持组');
    assert.equal(pick('review', '3').length, 0);
  });
  check('BF-07', '商机交付 PL00008572: 取 source_file 原件 delivery/<safe>, 导入行=服务八字段口径 2 行(实施 5/39/0/184/6000, 运维 2/0/0/0/0), 剔除 10 行披露, 不复制当前已改行', () => {
    const s = one('delivery_opp', 'PL00008572');
    assert.equal(s.file_path, 'delivery/' + A.names.d1);
    assert.equal(s.file_name, 'PL00008572-附3.xlsx');
    const rows = imported(s);
    assert.deepEqual(rows, A.exp.d1);
    const k = r => [r.pm_pd, r.own_pd, r.rd_pd, r.prod_pd, r.travel_cost];
    assert.equal(rows[0].stage, '实施'); assert.deepEqual(k(rows[0]), [5, 39, 0, 184, 6000]);
    assert.equal(rows[1].stage, '运维'); assert.deepEqual(k(rows[1]), [2, 0, 0, 0, 0]);
    assert.equal(audit(s).skipped_rows.length, 10); assert.equal(audit(s).row_sources.length, 2);
    assert.equal(s.importer_id, 3); assert.equal(s.created_at, iso(T.d1)); assert.equal(s.backfilled, 1);
    sheetValid(audit(s).sheet); assert.equal(audit(s).meta.backfill.reparsed, true);
    assert.equal(pick('delivery_opp', 'PL00008068').length, 0, '在线手填(无 source_file)不适用');
  });
  check('BF-08', '预算交付 budget_delivery#3 → delivery_budget 键 "3", 导入者取预算 owner', () => {
    const s = one('delivery_budget', '3');
    assert.equal(s.file_path, 'delivery/' + A.names.d3);
    assert.deepEqual(imported(s), A.exp.d3);
    assert.equal(s.importer_id, 3); assert.equal(s.backfilled, 1);
  });
  check('BF-09', '既有来源实体跳过(预算#5/评审#4 仍各 1 条且 backfilled=0), 只 INSERT 不改既有行', () => {
    const b5 = one('budget', '5'), r4 = one('review', '4');
    assert.equal(b5.backfilled, 0); assert.equal(r4.backfilled, 0);
    assert.equal(b5.id, 1); assert.equal(r4.id, 2);
    assert.equal(after.length, 8);
  });
  check('BF-10', '实体表(预算/评审/任务/事件/附件/商机/交付/消息/用户/设置)逐行逐列不变', () => {
    assert.deepEqual(snapshot(A.dbFile), before);
  });
  check('BF-11', '--log 以 UTF-8 落盘逐实体采用路径与行数, 不含原件内容', () => {
    const text = fs.readFileSync(logA, 'utf8');
    assert.ok(text.includes('delivery/' + A.names.d1), '日志缺交付采用路径');
    assert.ok(/rows=2\b/.test(text), '日志缺行数');
    assert.ok(text.includes('import/' + A.names.r1));
    assert.ok(!text.includes('南昌市POI数据'), '日志不得含原件单元格内容');
    assert.ok(text.includes('SUMMARY '));
  });
  const run2 = runTool(['--db=' + A.dbFile, '--uploads=' + A.up]);
  check('BF-12', '二跑幂等: 新增 0, 来源总数仍 8, 退出码 0', () => {
    assert.equal(run2.status, 0, run2.stdout.slice(-400));
    assert.equal(run2.summary.inserted, 0); assert.equal(run2.summary.planned, 0);
    assert.equal(sources(A.dbFile).length, 8);
    assert.deepEqual(snapshot(A.dbFile), before);
  });

  // ---------- 场景 B ----------
  const bBefore = snapshot(B.dbFile);
  const rb = runTool(['--db=' + B.dbFile, '--uploads=' + B.up]);
  const gapOf = (summary, type, key) => (summary?.gaps || []).find(g => g.entity_type === type && String(g.entity_key) === key);
  check('BF-13', '缺口默认全有或全无: 6 个缺口逐实体给原因, 退出码非 0, 零写入', () => {
    assert.notEqual(rb.status, 0); assert.ok(rb.summary, '缺 SUMMARY 行');
    assert.equal(rb.summary.gaps.length, 6, JSON.stringify(rb.summary.gaps));
    assert.equal(rb.summary.inserted, 0); assert.equal(sources(B.dbFile).length, 0);
    for (const g of rb.summary.gaps) assert.ok(g.reason && typeof g.reason === 'string');
  });
  check('BF-14', '缺原件: 预算消息指名文件不存在 / 交付 source_file 不存在 → 缺口(不猜同码其他文件)', () => {
    assert.match(gapOf(rb.summary, 'budget', '1').reason, /不存在|缺/);
    assert.match(gapOf(rb.summary, 'delivery_opp', 'PL00008111').reason, /不存在|缺/);
  });
  check('BF-15', '路径越界: 预算消息 ../../evil.xlsx 与交付 ..\\..\\evil.xlsx 即便目录外文件真实存在也拒绝', () => {
    assert.match(gapOf(rb.summary, 'budget', '2').reason, /路径|越界|非法/);
    assert.match(gapOf(rb.summary, 'delivery_opp', 'PL00008572').reason, /路径|越界|非法/);
  });
  check('BF-16', '评审商机代码不符: 最新同名文件内容为 8572 → 缺口且不回退采用更早的 8111 原件', () => {
    const g = gapOf(rb.summary, 'review', '1');
    assert.match(g.reason, /商机代码不匹配/); assert.ok(g.reason.includes('PL00008572') && g.reason.includes('PL00008111'));
    assert.ok(String(g.file_path || g.reason).includes('mislabeled'), '缺口须指明被拒文件');
  });
  check('BF-17', '评审无≤创建时间的同码原件(仅有更晚文件) → 缺口', () => {
    assert.match(gapOf(rb.summary, 'review', '2').reason, /无|缺/);
  });
  const rb2 = runTool(['--db=' + B.dbFile, '--uploads=' + B.up, '--allow-gaps']);
  check('BF-18', '--allow-gaps 只写可解析的 1 条(预算#3), 缺口仍列出且退出码仍非 0; 实体表不变', () => {
    assert.notEqual(rb2.status, 0);
    assert.equal(rb2.summary.inserted, 1); assert.equal(rb2.summary.gaps.length, 6);
    const rows = sources(B.dbFile);
    assert.equal(rows.length, 1); assert.equal(rows[0].entity_type, 'budget'); assert.equal(rows[0].entity_key, '3');
    assert.equal(rows[0].backfilled, 1);
    assert.deepEqual(snapshot(B.dbFile), bBefore);
    const db = new DatabaseSync(B.dbFile, { readOnly: true });
    try { assert.equal(latestImportSource(db, 'review', 1), null); } finally { db.close(); }
  });
  const missingDb = path.join(dir, 'no_such.db');
  const rm = runTool(['--db=' + missingDb, '--uploads=' + A.up]);
  check('BF-19', '库文件不存在: 退出码 2 且不创建新库', () => {
    assert.equal(rm.status, 2, rm.stdout + rm.stderr);
    assert.ok(!fs.existsSync(missingDb), '工具不得凭空建库');
  });
}

try { main(); }
catch (e) { check('BF-RUNNER', '套件无未处理异常', () => { throw e; }); }
finally {
  cleanup();
  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  log('\n' + summary);
  const logArg = process.argv.find(a => a.startsWith('--log='));
  if (logArg) fs.writeFileSync(path.resolve(logArg.slice(6)), LOG.join('\n') + '\n', 'utf8');
  process.exitCode = fail === 0 ? 0 : 1;
}
