// Excel 原表对照永久套件: 真实解析器、显示/来源边界、交付存行清理与 HTTP 存证契约。
// 用法: Node 22 tests/test_import_source.js [--pure] [--log=tests/green_import_source.txt]
// 默认执行 pure+HTTP；--pure 严格不访问服务或共享数据库，存行清理仅使用内存 SQLite。
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REALDATA = path.join(__dirname, 'realdata');
const BASE = 'http://127.0.0.1:8600';
const PURE_ONLY = process.argv.includes('--pure');
const NUM_KEYS = ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'];
const FIXTURES = [
  { code: 'PL00008572', rows: 2, skipped: 10 },
  { code: 'PL00008068', rows: 30, skipped: 7 },
  { code: 'PL00008111', rows: 2, skipped: 1 }
];
const LOG = [];
const parsedDeliveries = new Map();
let syntheticForm, presaleForm;
let pass = 0, fail = 0;
const log = line => { LOG.push(line); console.log(line); };
const check = (id, name, fn) => {
  try {
    fn();
    pass++;
    log('PASS - ' + id + ' ' + name);
  } catch (e) {
    fail++;
    log('FAIL - ' + id + ' ' + name + ' | ' + e.message);
  }
};
const checkAsync = async (id, name, fn) => {
  try {
    await fn();
    pass++;
    log('PASS - ' + id + ' ' + name);
  } catch (e) {
    fail++;
    log('FAIL - ' + id + ' ' + name + ' | ' + e.message);
  }
};
const norm = v => String(v ?? '').replace(/\s/g, '');
const posOK = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= 0);
const gridMap = grid => new Map((grid || []).flat().map(c => [c.r + ':' + c.c, c.v]));
const gridAt = (grid, p) => posOK(p) ? grid.get(p.join(':')) : undefined;

function fixtureFile(code) {
  const names = fs.readdirSync(REALDATA).filter(n => n.includes(code) && /\.xlsx$/i.test(n));
  assert.equal(names.length, 1, code + ' 必须定位唯一真实 xlsx 原件');
  return path.join(REALDATA, names[0]);
}

function parse(id, file, kind) {
  const script = path.join(ROOT, 'tools', kind === 'delivery' ? 'parse_delivery_xlsx.py' : 'parse_form_xlsx.py');
  const args = ['-X', 'utf8', script, file];
  if (kind !== 'delivery') args.push('--type', kind);
  if (kind === 'review') args.push('--sheet', '投标决策');
  args.push('--audit');
  const r = spawnSync('python', args, {
    windowsHide: true, encoding: 'utf8', cwd: ROOT, timeout: 60000, maxBuffer: 8 * 1024 * 1024
  });
  if (r.stderr) log('PYTHON STDERR - ' + id + '\n' + r.stderr);
  let parsed;
  check(id + '-RUN', '真实 ' + kind + ' 解析器成功并输出 JSON（非依赖失败）', () => {
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr || 'Python exit=' + r.status);
    parsed = JSON.parse(r.stdout);
    assert.ok(parsed && typeof parsed === 'object');
    assert.ok(!parsed.error, parsed.error);
  });
  return parsed && !parsed.error && r.status === 0 ? parsed : null;
}

function checkSheet(id, parsed) {
  check(id + '-SHEET', '新增 sheet 保留显示格、合并区域与真实维度', () => {
    const s = parsed.sheet;
    assert.ok(s && typeof s === 'object', '缺少新增 sheet 字段');
    assert.equal(s.name, parsed.meta.sheet);
    assert.ok(Number.isInteger(s.max_row) && s.max_row > 0);
    assert.ok(Number.isInteger(s.max_col) && s.max_col > 0);
    assert.equal(typeof s.truncated, 'boolean');
    assert.ok(Array.isArray(s.cells) && s.cells.length > 0, 'sheet.cells 必须非空');
    assert.ok(s.cells.every(c => Array.isArray(c) && posOK(c.slice(0, 2)) && typeof c[2] === 'string'));
    assert.ok(Array.isArray(s.merges), '缺少 sheet.merges');
    assert.ok(s.merges.every(m => Array.isArray(m) && m.length === 4 && m.every(Number.isInteger)));
  });
}

function checkDelivery(fixture, parsed) {
  const id = 'IS-' + fixture.code + '-DEL';
  check(id + '-ROWS', '仅保留 ' + fixture.rows + ' 行预算明细', () => {
    assert.ok(Array.isArray(parsed.rows), '缺少 rows');
    assert.equal(parsed.rows.length, fixture.rows);
  });
  check(id + '-SKIPPED', 'skipped_rows 明确记录 ' + fixture.skipped + ' 行无预算数字', () => {
    assert.ok(Array.isArray(parsed.skipped_rows), '缺少新增 skipped_rows 字段');
    assert.equal(parsed.skipped_rows.length, fixture.skipped);
    assert.equal(parsed.meta.rows_skipped, fixture.skipped, 'meta.rows_skipped 不一致');
    assert.ok(parsed.skipped_rows.every(r => Number.isInteger(r.r) && r.r >= 0
      && typeof r.content === 'string' && r.content.length > 0 && posOK(r.content_pos)
      && r.content_pos[0] === r.r && r.reason === '无预算数字'));
  });
  check(id + '-POSITIVE', '每行五项预算数字有限非负且至少一项 >0（文字不能保留）', () => {
    assert.ok(Array.isArray(parsed.rows) && parsed.rows.length > 0);
    const bad = parsed.rows.filter(r => !NUM_KEYS.every(k => typeof r[k] === 'number' && Number.isFinite(r[k]) && r[k] >= 0)
      || !NUM_KEYS.some(k => r[k] > 0));
    assert.deepEqual(bad.map(r => r.content), [], '无预算数字明细仍保留');
  });
  check(id + '-ALIGN', 'row_sources 与 rows 严格等长同序且内容/人天坐标逐格相符', () => {
    assert.ok(Array.isArray(parsed.rows) && parsed.rows.length > 0);
    assert.ok(Array.isArray(parsed.row_sources), '缺少 row_sources');
    assert.equal(parsed.row_sources.length, parsed.rows.length);
    const grid = gridMap(parsed.grid);
    parsed.rows.forEach((r, i) => {
      const s = parsed.row_sources[i];
      assert.ok(s && posOK(s.content_pos), '第 ' + i + ' 行无内容坐标');
      assert.equal(s.content, r.content, '第 ' + i + ' 行来源错序');
      assert.equal(norm(gridAt(grid, s.content_pos)), norm(r.content));
      NUM_KEYS.forEach(k => {
        assert.ok(s.cols && posOK(s.cols[k]), '第 ' + i + ' 行无 ' + k + ' 坐标');
        assert.equal(s.cols[k][0], s.content_pos[0]);
        if (k !== 'travel_cost') assert.equal(Number(gridAt(grid, s.cols[k]) || 0), r[k]);
      });
    });
  });
  checkSheet(id, parsed);
  check(id + '-SKIPPED-SHEET', '剔除内容仍在完整原表显示格，不从原表删除', () => {
    assert.ok(parsed.sheet && Array.isArray(parsed.sheet.cells), '缺少新增 sheet.cells');
    assert.ok(Array.isArray(parsed.skipped_rows) && parsed.skipped_rows.length === fixture.skipped, '缺少完整 skipped_rows');
    const cells = new Map(parsed.sheet.cells.map(c => [c[0] + ':' + c[1], c[2]]));
    parsed.skipped_rows.forEach(r => assert.equal(norm(gridAt(cells, r.content_pos)), norm(r.content)));
  });
  check(id + '-TOTAL-SOURCE', '合计行来源坐标与运维外包合计字段齐全', () => {
    assert.ok(Number.isInteger(parsed.meta.total_row_r) && parsed.meta.total_row_r >= 0, '缺少 meta.total_row_r');
    assert.equal(typeof parsed.total_row.ops_rd, 'number', '缺少 total_row.ops_rd');
    assert.equal(typeof parsed.total_row.ops_prod, 'number', '缺少 total_row.ops_prod');
  });
  if (fixture.code === 'PL00008572') {
    check(id + '-IMPL-ANCHOR', '真实实施锚定 5/39/0/184/6000，内容为 POI数据', () => {
      const impl = parsed.rows.filter(r => r.stage === '实施' && NUM_KEYS.some(k => r[k] > 0));
      assert.equal(impl.length, 1);
      assert.match(impl[0].content, /POI数据/);
      assert.deepEqual(NUM_KEYS.map(k => impl[0][k]), [5, 39, 0, 184, 6000]);
    });
    check(id + '-OPS-ANCHOR', '真实运维锚定 2/0/0/0/0，内容为 POI数据', () => {
      const ops = parsed.rows.filter(r => r.stage === '运维');
      assert.equal(ops.length, 1);
      assert.match(ops[0].content, /POI数据/);
      assert.deepEqual(NUM_KEYS.map(k => ops[0][k]), [2, 0, 0, 0, 0]);
    });
    check(id + '-SUM-ANCHOR', '原件合计与遗留解析合计 PM7/正编39/生产184/差旅6000 不漂移', () => {
      assert.deepEqual(NUM_KEYS.map(k => parsed.sum[k]), [7, 39, 0, 184, 6000]);
      assert.equal(parsed.total_row.impl_pm, 5);
      assert.equal(parsed.total_row.impl_own, 39);
      assert.equal(parsed.total_row.impl_prod, 184);
      assert.equal(parsed.total_row.impl_travel, 6000);
      assert.equal(parsed.total_row.ops_pm, 2);
    });
  }
  if (fixture.code === 'PL00008068') {
    check(id + '-GAP-ANCHOR', '真实原件正编合计 17.5 与解析 11.5 的差异不被掩盖', () => {
      assert.equal(parsed.total_row.impl_own, 17.5);
      assert.equal(parsed.sum.impl.own_pd, 11.5);
    });
  }
}

function checkForm(code, kind, parsed) {
  const id = 'IS-' + code + '-' + kind.toUpperCase();
  checkSheet(id, parsed);
  check(id + '-SOURCES', '已提取字段仍有标签格/值格来源', () => {
    assert.ok(parsed.fields && Object.keys(parsed.fields).length > 0);
    assert.ok(parsed.sources && Object.keys(parsed.sources).length > 0);
    Object.keys(parsed.fields).forEach(k => {
      const s = parsed.sources[k];
      assert.ok(s && posOK(s.lab_pos) && posOK(s.val_pos), k + ' 来源缺失');
    });
  });
  check(id + '-RAW', '来源新增 raw/raw_d/selected，缺字段须显式 FAIL', () => {
    assert.ok(parsed.sources && Object.keys(parsed.sources).length > 0);
    Object.entries(parsed.sources).forEach(([k, s]) => {
      assert.ok(Object.hasOwn(s, 'raw'), k + ' 缺少 raw');
      assert.equal(typeof s.raw_d, 'string', k + ' 缺少 raw_d');
      assert.equal(typeof s.selected, 'boolean', k + ' 缺少 selected');
    });
  });
  check(id + '-UNPICKED', '新增 unpicked 数组显式披露未采用来源格', () => {
    assert.ok(Array.isArray(parsed.unpicked), '缺少新增 unpicked 字段');
  });
  check(id + '-RAW-ORIGIN', '采用原值与每个实际来源格相符，多格合计无丢项', () => {
    const cells = new Map((parsed.sheet?.cells || []).map(c => [c[0] + ':' + c[1], c]));
    const originalAt = pos => {
      const cell = cells.get(pos.join(':'));
      // 稀疏原表省略空格；预算上下文的实际空值必须仍保留为 null，不能补成字段的 0。
      return cell ? (cell.length === 4 ? cell[3] : cell[2]) : null;
    };
    Object.entries(parsed.sources).forEach(([key, s]) => {
      assert.equal(s.selected, true, key + ' 已采用字段须标记 selected');
      assert.ok(posOK(s.raw_pos), key + ' 缺少实际采用格');
      assert.deepEqual(s.raw, originalAt(s.raw_pos), key + ' 原值来自错误候选');
      if (s.val_positions) {
        assert.deepEqual(s.raws, s.val_positions.map(originalAt), key + ' 多格原值漏项');
      }
    });
  });
  if (kind === 'review' && ['PL00008572', 'PL00008111'].includes(code)) {
    check(id + '-LEGACY-POS', 'data_review 原值与既有来源坐标不漂移', () => {
      const s = parsed.sources.data_review;
      const newer = code === 'PL00008572';
      assert.equal(parsed.fields.data_review, newer ? '是' : '否');
      assert.deepEqual(s.lab_pos, newer ? [25, 0] : [22, 6]);
      assert.deepEqual(s.val_pos, newer ? [25, 3] : [22, 8]);
    });
  }
}

function runPure() {
  for (const fixture of FIXTURES) {
    let file;
    check('IS-' + fixture.code + '-FILE', '按商机码定位真实原件', () => { file = fixtureFile(fixture.code); });
    if (!file) continue;
    const delivery = parse('IS-' + fixture.code + '-DEL', file, 'delivery');
    if (delivery) {
      checkDelivery(fixture, delivery);
      parsedDeliveries.set(fixture.code, delivery);
    }
    for (const kind of ['review', 'budget']) {
      const form = parse('IS-' + fixture.code + '-' + kind.toUpperCase(), file, kind);
      if (form) checkForm(fixture.code, kind, form);
    }
  }
}

// Breaks caught: content/cost accidentally preserving a row, wrong DDL key, unnecessary
// UPDATEs, partial pruning demoting confirmation, or a second migration touching data.
function checkCleanup() {
  let cleanup;
  check('IS-CLEANUP-MODULE', '共享清理模块可加载（缺模块单独红，不遮蔽解析器红）', () => {
    cleanup = require('../delivery-rows.js');
  });
  if (!cleanup) return;
  check('IS-CLEANUP-NUMBERS', '五键正数唯一保留依据，单位/负数/非法值正确处理', () => {
    assert.deepEqual(cleanup.DELIVERY_NUM_KEYS, ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost']);
    for (const row of [null, {}, { content: '文字', note: '备注', cost: 100 }, { pm_pd: -1 },
      { own_pd: '无数字' }, { rd_pd: Infinity }, { prod_pd: NaN }, { travel_cost: '0元' }]) {
      assert.equal(cleanup.hasBudgetNumbers(row), false, JSON.stringify(row));
    }
    for (const row of [{ pm_pd: '2人天' }, { own_pd: '1,200.5人天' }, { rd_pd: 1 },
      { prod_pd: '0.25' }, { travel_cost: '800元' }]) assert.equal(cleanup.hasBudgetNumbers(row), true);
    const positive = { travel_cost: '800元', cost: 800, note: '原样保留' };
    const input = [{ content: '纯文字' }, positive, { pm_pd: '-2人天' }];
    assert.deepEqual(cleanup.pruneEmptyRows(input), [positive]);
    assert.strictEqual(cleanup.pruneEmptyRows(input)[0], positive, '不净化或重算存行');
    assert.equal(input.length, 3, '不修改输入数组');
    assert.deepEqual(cleanup.pruneEmptyRows(null), []);
  });
  check('IS-CLEANUP-STORED', '两表行计数/部分与全空清理/状态时间/第二轮零修改', () => {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`CREATE TABLE opp_delivery (
        opp_code TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', rows_json TEXT DEFAULT '[]',
        source_file TEXT, owner_id INTEGER, created_at TEXT, updated_at TEXT);
        CREATE TABLE budget_delivery (
        budget_id INTEGER PRIMARY KEY, rows_json TEXT DEFAULT '[]', source_file TEXT,
        created_at TEXT, updated_at TEXT);
        CREATE TABLE updates (kind TEXT);
        CREATE TRIGGER opp_update AFTER UPDATE ON opp_delivery BEGIN INSERT INTO updates VALUES ('opp'); END;
        CREATE TRIGGER budget_update AFTER UPDATE ON budget_delivery BEGIN INSERT INTO updates VALUES ('budget'); END;`);
      const empty = { content: '无数字', note: '说明', cost: 900 };
      const live = { stage: '运维', travel_cost: '800元', cost: 123, note: '不算账' };
      const putOpp = db.prepare('INSERT INTO opp_delivery VALUES (?,?,?,?,?,?,?)');
      for (const [code, status, rows] of [['partial', 'confirmed', [empty, live]],
        ['full', 'confirmed', [empty, { pm_pd: -2 }]], ['draft', 'draft', [empty]],
        ['other', 'reviewing', [empty]], ['stable', 'confirmed', [live]], ['already-empty', 'confirmed', []]]) {
        putOpp.run(code, status, JSON.stringify(rows), '原件.xlsx', 7, 'created', 'unchanged');
      }
      const putBudget = db.prepare('INSERT INTO budget_delivery VALUES (?,?,?,?,?)');
      putBudget.run(1, JSON.stringify([empty, live]), '原件.xlsx', 'created', 'unchanged');
      putBudget.run(2, JSON.stringify([empty]), '原件.xlsx', 'created', 'unchanged');
      putBudget.run(3, JSON.stringify([live]), '原件.xlsx', 'created', 'unchanged');
      assert.deepEqual(cleanup.pruneStoredDelivery(db), {
        opp_delivery: { before: 7, after: 2, changed: 4, demoted: 1 },
        budget_delivery: { before: 4, after: 2, changed: 2 }
      });
      assert.deepEqual(db.prepare('SELECT opp_code,status FROM opp_delivery ORDER BY opp_code').all().map(r => [r.opp_code, r.status]),
        [['already-empty', 'confirmed'], ['draft', 'draft'], ['full', 'draft'], ['other', 'reviewing'], ['partial', 'confirmed'], ['stable', 'confirmed']]);
      assert.deepEqual(JSON.parse(db.prepare("SELECT rows_json FROM opp_delivery WHERE opp_code='partial'").get().rows_json), [live]);
      assert.deepEqual(JSON.parse(db.prepare('SELECT rows_json FROM budget_delivery WHERE budget_id=1').get().rows_json), [live]);
      assert.deepEqual(JSON.parse(db.prepare('SELECT rows_json FROM budget_delivery WHERE budget_id=2').get().rows_json), []);
      for (const table of ['opp_delivery', 'budget_delivery']) {
        db.prepare('SELECT * FROM ' + table).all().forEach(r => {
          assert.equal(r.updated_at, 'unchanged'); assert.equal(r.created_at, 'created');
          assert.equal(r.source_file, '原件.xlsx');
          if (table === 'opp_delivery') assert.equal(r.owner_id, 7);
        });
      }
      assert.equal(db.prepare('SELECT count(*) AS n FROM updates').get().n, 6);
      assert.deepEqual(cleanup.pruneStoredDelivery(db), {
        opp_delivery: { before: 2, after: 2, changed: 0, demoted: 0 },
        budget_delivery: { before: 2, after: 2, changed: 0 }
      });
      assert.equal(db.prepare('SELECT count(*) AS n FROM updates').get().n, 6, '幂等轮不能 UPDATE');
    } finally { db.close(); }
  });
}

// Breaks caught: percentage interpreted as fraction, lost original dates/dimensions,
// stale source raw after normalization, lost contributors, or ignored conflicts hidden.
function checkSynthetic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-task2-'));
  try {
    const formFile = path.join(dir, 'form.xlsx');
    const deliveryFile = path.join(dir, 'delivery.xlsx');
    const script = `import sys, openpyxl
from datetime import datetime
w = openpyxl.Workbook(); s = w.active; s.title = '附1-预算表'
s['A1'] = 0.125; s['A1'].number_format = '0.0%'
s['B1'] = datetime(2026, 10, 23); s['B1'].number_format = 'yyyy-mm-dd'
s['C1'] = 2.5; s['D1'] = 0; s['E1'] = 'x' * 2010
s.merge_cells('G2:I3'); s['G2'] = '合并'; s['D305'] = '超限'
for r, label, values in [(5, '合同金额', ['非数字', '1,234.50']), (8, '交付部门', ['无匹配', '公共服务部某处']), (11, '合同金额', [99]), (14, '验收', [10]), (17, '综合办公', [20]), (20, '专业服务', [30])]:
 s.cell(r, 1, label)
 for c, v in enumerate(values, 2): s.cell(r, c, v)
w.save(sys.argv[1])
w = openpyxl.Workbook(); s = w.active; s.title = '附3-交付成本评估'
s.cell(1, 1, '合计'); s.cell(2, 12, '运维阶段人力成本')
for c, text in [(1, '建设内容'), (2, '人天汇总项目经理'), (3, '人天汇总正编'), (4, '人天汇总产研外包'), (5, '人天汇总生产外包'), (6, '实施阶段差旅成本'), (12, '项目经理正编人天'), (13, '产研正编人天'), (14, '产研外包人天'), (15, '生产外包人天'), (16, '运维阶段差旅成本')]: s.cell(3, c, text)
for r, text, vals in [(4, '负数', {2:-2, 3:'invalid', 6:-9}), (5, '舍入零', {2:0.004}), (6, '运维仅有差旅', {16:12.345}), (7, '实施有正数', {2:1.236, 3:-1, 4:'bad'}), (8, '差旅分项负数', {7:-50, 8:3.456})]:
 s.cell(r, 1, text)
 for c, v in vals.items(): s.cell(r, c, v)
w.save(sys.argv[2])
`;
    const r = spawnSync('python', ['-X', 'utf8', '-c', script, formFile, deliveryFile], {
      windowsHide: true, encoding: 'utf8', cwd: ROOT, timeout: 60000
    });
    check('IS-SYNTH-FIXTURE', '独立字面值夹具生成成功', () => { assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); });
    if (r.status !== 0) return;
    const form = parse('IS-SYNTH-FORM', formFile, 'budget');
    syntheticForm = form;
    if (form) {
      const cells = new Map((form.sheet?.cells || []).map(c => [c[0] + ':' + c[1], c]));
      check('IS-SHEET-PERCENT', '百分号按显示值渲染且保留原始小数', () => {
        assert.deepEqual(cells.get('0:0'), [0, 0, '12.5%', 0.125]);
      });
      check('IS-SHEET-DATE', '日期按 YYYY-MM-DD 显示', () => { assert.equal(cells.get('0:1')?.[2], '2026-10-23'); });
      check('IS-SHEET-FLOAT', '浮点尾零去除而数值零不丢失', () => {
        assert.equal(cells.get('0:2')?.[2], '2.5'); assert.equal(cells.get('0:3')?.[2], '0');
      });
      check('IS-SHEET-MERGES', '合并范围使用完整零基坐标', () => { assert.deepEqual(form.sheet?.merges, [[1, 6, 2, 8]]); });
      check('IS-SHEET-TRUNCATION', '300行/2000字符封顶而维度保持实际305×9', () => {
        assert.equal(form.sheet?.max_row, 305); assert.equal(form.sheet?.max_col, 9);
        assert.equal(form.sheet?.truncated, true); assert.equal(cells.get('0:4')?.[2].length, 2000);
        assert.ok(!cells.has('304:3')); assert.ok(form.sheet.cells.every(c => c[0] < 300));
      });
      check('IS-SOURCE-NORMALIZED', 'raw描述采用的原值而不是规范化字段值或首个无效候选', () => {
        assert.equal(form.fields.contract, 1234.5); assert.equal(form.sources.contract.raw, '1,234.50');
        assert.equal(form.sources.contract.raw_d, '1,234.50'); assert.equal(form.sources.contract.selected, true);
        assert.equal(form.fields.dev_dept, '公共服务部'); assert.equal(form.sources.dev_dept.raw, '公共服务部某处');
      });
      check('IS-SOURCE-CONFLICT', '重复合同金额99未采用且原因与采用1234.50明确区分', () => {
        assert.ok(form.unpicked?.some(s => s.key === 'contract' && s.raw === 99 && s.selected === false && s.reason && posOK(s.val_pos)));
        assert.ok(form.unpicked?.some(s => s.key === 'contract' && s.raw === '非数字' && s.reason));
      });
      check('IS-SOURCE-MULTI', '验收/办公/服务多项求和保留全部真实来源', () => {
        assert.equal(form.fields.del_other, 60);
        assert.deepEqual(form.sources.del_other.val_positions, [[13, 1], [16, 1], [19, 1]]);
        assert.deepEqual(form.sources.del_other.raws, [10, 20, 30]);
      });
    }
    const delivery = parse('IS-SYNTH-DEL', deliveryFile, 'delivery');
    if (delivery) {
      check('IS-DEL-CLEAN-BEFORE-STAGE', '负数/非法/舍入零先净化，两阶段只按正数生成', () => {
        // 原差旅公式是分项求和后回退合计格；只净化最终 travel_cost，不能先删负分项改公式。
        assert.deepEqual(delivery.rows.map(r => [r.content, r.stage, ...NUM_KEYS.map(k => r[k])]), [
          ['运维仅有差旅', '运维', 0, 0, 0, 0, 12.35],
          ['实施有正数', '实施', 1.24, 0, 0, 0, 0]
        ]);
      });
      check('IS-DEL-SYNTH-ALIGN', '过滤阶段与来源同分支且剔除内容原表仍在', () => {
        assert.equal(delivery.row_sources.length, 2);
        assert.deepEqual(delivery.row_sources.map(s => s.content_pos), [[5, 0], [6, 0]]);
        assert.deepEqual(delivery.skipped_rows?.map(r => [r.r, r.content, r.content_pos, r.reason]),
          [[3, '负数', [3, 0], '无预算数字'], [4, '舍入零', [4, 0], '无预算数字'], [7, '差旅分项负数', [7, 0], '无预算数字']]);
        assert.ok(delivery.sheet?.cells.some(c => c[0] === 3 && c[1] === 0 && c[2] === '负数'));
      });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function checkPresale() {
  const parsed = parse('IS-PRESALE', path.join(__dirname, 'fixtures', 'presale-period-date-range.xlsx'), 'review');
  presaleForm = parsed;
  if (!parsed) return;
  check('IS-PRESALE-RAW-POS', '售前日期范围规范化为3但原值与G11/I11坐标保留', () => {
    assert.equal(parsed.fields.presale_period, 3);
    assert.deepEqual(parsed.sources.presale_period.lab_pos, [10, 6]);
    assert.deepEqual(parsed.sources.presale_period.val_pos, [10, 8]);
    assert.equal(typeof parsed.sources.presale_period.raw, 'string');
    assert.match(parsed.sources.presale_period.raw, /2026/);
    assert.notEqual(parsed.sources.presale_period.raw, '3');
  });
}

// Breaks caught: missing adopted-label trace, later/downward candidates misidentified as
// labels, context labels assumed in column A, or audit enrichment changing business output.
function checkAdoptedLabels() {
  const { formComparison } = require('../import-source.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-adopted-labels-'));
  try {
    const laterFile = path.join(dir, 'later.xlsx');
    const downwardFile = path.join(dir, 'downward.xlsx');
    const contextFile = path.join(dir, 'context.xlsx');
    const script = `import sys, openpyxl
for filename, downward in [(sys.argv[1], False), (sys.argv[2], True)]:
 w = openpyxl.Workbook(); s = w.active; s.title = '附1-预算表'
 s['A14'] = '验收'; s['B14'] = 10
 s['A17'] = '综合办公'; s['B17'] = 'invalid'
 s['B18' if downward else 'C17'] = 20
 s['A20'] = '专业服务'; s['B20'] = 30
 w.save(filename)
w = openpyxl.Workbook(); s = w.active; s.title = '附1-预算表'
for address, value in [('B19', '交付成本'), ('C20', '研发外包'), ('D20', '费用'), ('G20', 40), ('B22', '交付'), ('C22', '差旅'), ('G22', 10), ('B23', '项目管理费'), ('C23', '费用'), ('G23', 5), ('D24', '交付招待'), ('G25', 0), ('B26', '验收'), ('C26', '费用'), ('G26', 10), ('D27', '综合办公'), ('F27', '费用'), ('C28', '专业服务'), ('E28', '费用'), ('G28', 0)]:
 s[address] = value
w.save(sys.argv[3])
`;
    const made = spawnSync('python', ['-B', '-X', 'utf8', '-c', script, laterFile, downwardFile, contextFile], {
      windowsHide: true, encoding: 'utf8', cwd: ROOT, timeout: 60000
    });
    check('IS-ADOPTED-FIXTURE', '真实XLSX字面夹具生成，不使用解析器推导期望', () => {
      assert.ifError(made.error); assert.equal(made.status, 0, made.stderr);
    });
    if (made.status !== 0) return;
    for (const [id, file, values] of [
      ['IS-ADOPTED-LATER', laterFile, [[13, 1], [16, 2], [19, 1]]],
      ['IS-ADOPTED-DOWNWARD', downwardFile, [[13, 1], [17, 1], [19, 1]]]
    ]) {
      const parsed = parse(id, file, 'budget');
      if (!parsed) continue;
      check(id + '-VALUES', '10/20/30合计60与首标签/legacy坐标不漂移', () => {
        assert.equal(parsed.fields.del_other, 60);
        assert.equal(parsed.sources.del_other.label, '验收');
        assert.deepEqual(parsed.sources.del_other.lab_pos, [13, 0]);
        assert.deepEqual(parsed.sources.del_other.val_pos, [13, 1]);
        assert.deepEqual(parsed.sources.del_other.raw_pos, [13, 1]);
        assert.deepEqual(parsed.sources.del_other.val_positions, values);
        assert.deepEqual(parsed.sources.del_other.raws, [10, 20, 30]);
      });
      check(id + '-TRACE', 'producer显式记录实际采用的A14/A17/A20标签', () => {
        assert.deepEqual(parsed.sources.del_other.lab_positions, [[13, 0], [16, 0], [19, 0]], '缺少实际采用标签trace');
      });
      check(id + '-HIGHLIGHTS', '真实后选/下邻值保留A17，invalid不是标签且audit不可变', () => {
        const before = JSON.stringify(parsed);
        const row = formComparison(parsed, { del_other: 60 }, { del_other: 60 },
          { del_other: '其他交付费用' }, { del_other: 'num' }).rows[0];
        assert.equal(row.status, '表内计算'); assert.equal(row.row, 13);
        assert.deepEqual(row.raw, [10, 20, 30]); assert.deepEqual(row.val_positions, values);
        assert.equal(JSON.stringify(parsed), before, '比较不得修改真实audit');
        assert.ok(!row.positions.some(p => p[0] === 16 && p[1] === 1), 'B17无效候选不能作为标签');
        assert.deepEqual(row.lab_positions, [[13, 0], [16, 0], [19, 0]], '必须保留真正A17标签');
        assert.deepEqual(row.positions, [[13, 0], [16, 0], [19, 0], ...values]);
      });
    }
    const context = parse('IS-ADOPTED-CONTEXT', contextFile, 'budget');
    if (!context) return;
    check('IS-ADOPTED-CONTEXT-VALUES', '上下文四项数值/标签/legacy坐标与null/0来源保持', () => {
      assert.deepEqual(context.fields, { rd_outsource: 40, del_travel: 10, pm_cost: 5, del_other: 10 });
      assert.equal(context.sources.del_other.label, '验收 / 费用 + 综合办公 / 费用 + 专业服务 / 费用');
      assert.equal(context.sources.del_travel.label, '交付 / 差旅 + 交付招待 + ');
      for (const [key, lab, val, values, raws] of [
        ['rd_outsource', [19, 0], [19, 6], [[19, 6]], [40]],
        ['del_travel', [21, 0], [21, 6], [[21, 6], [23, 6], [24, 6]], [10, null, 0]],
        ['pm_cost', [22, 0], [22, 6], [[22, 6]], [5]],
        ['del_other', [25, 0], [25, 6], [[25, 6], [26, 6], [27, 6]], [10, null, 0]]
      ]) {
        const source = context.sources[key];
        assert.deepEqual(source.lab_pos, lab); assert.deepEqual(source.val_pos, val);
        assert.deepEqual(source.raw_pos, val); assert.deepEqual(source.val_positions, values);
        assert.deepEqual(source.raws, raws);
      }
    });
    check('IS-ADOPTED-CONTEXT-TRACE', '非A列全部标签部分显式保留，空值/零贡献不丢且全空行无标签', () => {
      assert.deepEqual(context.sources.rd_outsource.lab_positions, [[19, 2], [19, 3]]);
      assert.deepEqual(context.sources.del_travel.lab_positions, [[21, 1], [21, 2], [23, 3]]);
      assert.deepEqual(context.sources.pm_cost.lab_positions, [[22, 1], [22, 2]]);
      assert.deepEqual(context.sources.del_other.lab_positions, [[25, 1], [25, 2], [26, 3], [26, 5], [27, 2], [27, 4]]);
    });
    check('IS-ADOPTED-CONTEXT-HIGHLIGHTS', '所有真实标签部分与值格高亮，空白A列和全空贡献行不虚构标签', () => {
      const before = JSON.stringify(context);
      const result = formComparison(context, context.fields, { ...context.fields },
        { rd_outsource: '研发外包', del_travel: '交付差旅', pm_cost: '项目管理费', del_other: '其他交付费用' },
        { rd_outsource: 'num', del_travel: 'num', pm_cost: 'num', del_other: 'num' });
      assert.deepEqual(result.rows.map(r => [r.key, r.row]), [['rd_outsource', 19], ['del_travel', 21], ['pm_cost', 22], ['del_other', 25]]);
      const other = result.rows.find(r => r.key === 'del_other');
      assert.equal(other.status, '表内计算'); assert.deepEqual(other.raw, [10, null, 0]);
      assert.deepEqual(other.val_positions, [[25, 6], [26, 6], [27, 6]]);
      assert.equal(JSON.stringify(context), before);
      assert.deepEqual(other.lab_positions, [[25, 1], [25, 2], [26, 3], [26, 5], [27, 2], [27, 4]], '上下文标签必须来自实际非空标签部分');
      assert.deepEqual(other.positions, [[25, 1], [25, 2], [26, 3], [26, 5], [27, 2], [27, 4], [25, 6], [26, 6], [27, 6]]);
      const travel = result.rows.find(r => r.key === 'del_travel');
      assert.deepEqual(travel.lab_positions, [[21, 1], [21, 2], [23, 3]]);
      assert.deepEqual(travel.positions, [[21, 1], [21, 2], [23, 3], [21, 6], [23, 6], [24, 6]]);
      assert.deepEqual(result.rows.find(r => r.key === 'rd_outsource').positions, [[19, 2], [19, 3], [19, 6]]);
      assert.deepEqual(result.rows.find(r => r.key === 'pm_cost').positions, [[22, 1], [22, 2], [22, 6]]);
    });
    for (const [id, file, expectedFields] of [
      ['LATER', laterFile, { del_other: 60 }], ['DOWNWARD', downwardFile, { del_other: 60 }],
      ['CONTEXT', contextFile, { rd_outsource: 40, del_travel: 10, pm_cost: 5, del_other: 10 }]
    ]) {
      check('IS-ADOPTED-' + id + '-NONAUDIT', '真实非audit入口仍仅输出原业务结构和字面数值', () => {
        const r = spawnSync('python', ['-B', '-X', 'utf8', path.join(ROOT, 'tools', 'parse_form_xlsx.py'), file, '--type', 'budget'], {
          windowsHide: true, encoding: 'utf8', cwd: ROOT, timeout: 60000
        });
        assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
        const parsed = JSON.parse(r.stdout);
        assert.deepEqual(Object.keys(parsed).sort(), ['fields', 'meta', 'warnings']);
        assert.deepEqual(parsed.fields, expectedFields);
      });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Breaks caught: fake raw coordinates, hidden clearing/unit changes, invented conversion
// reasons, collapsed delivery occurrences, corrected source totals, or overwritten history.
function checkImportSource() {
  let source;
  check('IS-SOURCE-MODULE', '原件模块及锁定 API 可加载，缺实现不遮蔽既有解析器', () => {
    source = require('../import-source.js');
    for (const key of ['saveImportSource', 'latestImportSource', 'budgetImportSource', 'sourceMeta',
      'writeUniqueUpload', 'encodeRFC5987Value', 'formComparison', 'deliveryComparison']) assert.equal(typeof source[key], 'function', key);
    assert.equal(typeof source.IMPORT_SOURCES_DDL, 'string');
  });
  if (!source) return;
  check('IS-PATH-RESOLVER', '真实下载路径解析器拒绝穿越/兄弟前缀/绝对逃逸并接受根内相对路径', () => {
    assert.equal(typeof source.resolveImportSourcePath, 'function', '缺少 resolveImportSourcePath 导出');
    const root = path.resolve(os.tmpdir(), 'is-upload-root');
    const sibling = path.resolve(root, '..', path.basename(root) + '-sibling', '偷取.xlsx');
    const absoluteEscape = path.resolve(root, '..', 'absolute-escape.xlsx');
    assert.equal(source.resolveImportSourcePath(root, '../escape.xlsx'), null);
    assert.equal(source.resolveImportSourcePath(root, sibling), null);
    assert.equal(source.resolveImportSourcePath(root, absoluteEscape), null);
    assert.equal(source.resolveImportSourcePath(root, 'import/中文原件.xlsx'), path.resolve(root, 'import/中文原件.xlsx'));
  });
  check('IS-UPLOAD-IMMUTABLE', '同名同标识碰撞使用独占创建重试且两份原件字节互不覆盖', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-upload-immutable-'));
    const ids = ['fixed-id', 'fixed-id', 'next-id'];
    try {
      const first = source.writeUniqueUpload(dir, '2024_预算.xlsx', Buffer.from('first'), () => ids.shift());
      const second = source.writeUniqueUpload(dir, '2024_预算.xlsx', Buffer.from('second'), () => ids.shift());
      assert.notEqual(first.safe, second.safe);
      assert.equal(fs.readFileSync(first.fp, 'utf8'), 'first');
      assert.equal(fs.readFileSync(second.fp, 'utf8'), 'second');
      assert.equal(ids.length, 0, '碰撞后必须重新生成标识');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  check('IS-RFC5987-FILENAME', 'RFC5987 文件名编码转义单引号、括号与星号', () => {
    assert.equal(source.encodeRFC5987Value("2024_'()*.xlsx"), '2024_%27%28%29%2A.xlsx');
  });
  const { formComparison, deliveryComparison } = source;
  const cellSource = (label, row, raw) => ({ label, lab_pos: [row, 0], val_pos: [row, 1],
    raw_pos: [row, 1], raw, raw_d: raw == null ? '' : String(raw), selected: true });
  const one = (raw, imported, current, type = 'num', key = 'ops_years') =>
    formComparison({ sources: { [key]: cellSource('原标签', 3, raw) } },
      { [key]: imported }, { [key]: current }, { [key]: '字段' }, { [key]: type }).rows[0];

  check('IS-FORM-SEVEN', '七种诚实状态与计数；不能把无法解释的原值差异假称换算', () => {
    const audit = { sources: {
      same: cellSource('相同', 8, '1'), changed: cellSource('改动', 2, 0),
      unit: cellSource('周期', 4, '1年'), rejected: { ...cellSource('拒绝', 6, '不明枚举'), selected: false },
      online: { ...cellSource('补录', 7, '不明枚举'), selected: false },
      calc: { ...cellSource('合计', 5, 10), val_positions: [[5, 1], [5, 2]], raws: [10, 20] },
      gap: cellSource('不符', 9, '2年') }, warnings: ['未知原标签'],
      unpicked: [{ key: 'rejected', reason: '枚举不在白名单' }, { key: 'online', reason: '枚举不在白名单' }] };
    const labels = { same: '相同', changed: '改动', unit: '周期', rejected: '拒绝', online: '补录', calc: '合计', gap: '不符' };
    const result = formComparison(audit, { same: 1, changed: 0, unit: 1, calc: 30, gap: 1 },
      { same: 1, unit: 1, online: '是', calc: 30, gap: 1 }, labels,
      { same: 'num', changed: 'num', unit: 'num', calc: 'num', gap: 'num' });
    assert.equal(result.kind, 'form');
    assert.deepEqual(result.rows.map(r => [r.key, r.status]), [['changed', '已修改'], ['unit', '已换算'],
      ['calc', '表内计算'], ['rejected', '未采用'], ['online', '在线补录'], ['same', '一致'], ['gap', '有差异']]);
    assert.deepEqual(result.counts, { '已修改': 1, '已换算': 1, '表内计算': 1, '未采用': 1, '在线补录': 1, '一致': 1, '有差异': 1 });
    assert.deepEqual(result.warnings, ['未知原标签']);
    const modified = result.rows[0];
    assert.equal(modified.imported, 0); assert.equal(modified.current, null);
    assert.match(modified.detail, /0.*→.*(?:空|未填)/);
    assert.match(result.rows[6].detail, /差异/); assert.doesNotMatch(result.rows[6].detail, /去单位/);
  });
  check('IS-FORM-TRANSFORMS', '换算原因须实际产出导入值；单位、百分数、小数百分比、格式与关键字', () => {
    for (const [raw, value, type, key, reason] of [
      ['1年', 1, 'num', 'ops_years', /去单位/], ['15%', 15, 'num', 'gross_margin', /百分/],
      [0.15, 15, 'num', 'gross_margin', /小数×100/], ['1,234.50', 1234.5, 'num', 'contract', /格式/],
      [' 项目甲 ', '项目甲', 'str', 'project_name', /空格|格式/],
      ['公共服务部某处', '公共服务部', 'enum:交付处|公共服务部', 'dev_dept', /关键字/]]) {
      const row = one(raw, value, value, type, key);
      assert.equal(row.status, '已换算', String(raw)); assert.match(row.detail, reason);
    }
    for (const raw of ['2年', '15%', 0.15]) {
      const row = one(raw, 1, 1, 'num', 'gross_margin');
      assert.equal(row.status, '有差异', String(raw));
      assert.doesNotMatch(row.detail, /去单位|小数×100|关键字/);
    }
  });
  check('IS-FORM-PERCENT-PRECISION', '0.29小数百分比的浮点尾差不能把真实换算误报为差异', () => {
    const row = one(0.29, 29, 29, 'num', 'gross_margin');
    assert.equal(row.status, '已换算'); assert.match(row.detail, /小数×100/);
    assert.equal(one(0.29, 29.01, 29.01, 'num', 'gross_margin').status, '有差异');
  });
  check('IS-FORM-CURRENT-SEMANTICS', '当前值只做语义相等，不去单位/匹配关键词以掩盖人工变化', () => {
    for (const current of [null, undefined, '', '1年', 2]) assert.equal(one('1年', 1, current).status, '已修改');
    assert.equal(one('1', 1, '1').status, '一致');
    assert.equal(one(0, 0, 0).status, '一致');
    assert.equal(one('项目甲', '项目甲', ' 项目甲 ', 'str').status, '一致');
    assert.equal(one('公共服务部某处', '公共服务部', '公共服务部某处',
      'enum:交付处|公共服务部', 'dev_dept').status, '已修改');
  });
  check('IS-FORM-REJECTION', '拒绝来源保留原值、坐标和原因，在线补录与未采用区分', () => {
    const rejected = { key: 'secret', ...cellSource('涉密项目', 12, '未知'), selected: false, reason: '枚举不在白名单' };
    const audit = { unpicked: [rejected] };
    const labels = { secret: '涉密项目' }, types = { secret: 'enum:是|否' };
    const online = formComparison(audit, {}, { secret: '否' }, labels, types).rows[0];
    assert.equal(online.status, '在线补录'); assert.equal(online.raw, '未知'); assert.equal(online.imported, null);
    assert.match(online.detail, /枚举不在白名单/); assert.deepEqual(online.val_positions, [[12, 1]]);
    const ignored = formComparison(audit, {}, {}, labels, types).rows[0];
    assert.equal(ignored.status, '未采用'); assert.match(ignored.detail, /枚举不在白名单/);
  });
  // Breaks caught: dropped explicit labels, row-number-only invention, unrelated/rejected
  // label highlights, duplicate/invalid coordinates, or comparison mutating the audit.
  check('IS-FORM-MULTI', '三项标签/值格证据齐全且去重，null/0不丢、原行与修改优先级保持', () => {
    const audit = { sources: { del_other: { ...cellSource('验收 + 综合办公 + 专业服务', 13, null),
      lab_positions: [[13, 0], [16, 0], [16, 0], [19, 0], [-1, 0], [16, '0'], [1], [1, 2, 3], null],
      val_positions: [[13, 1], [16, 1], [19, 1]], raws: [null, 0, 30] } },
      pairs: [['专业服务', 30, [19, 0]], ['综合办公', 0, [16, 0]], ['综合办公', 0, [16, 0]]],
      sheet: { name: '附1-预算表', cells: [[13, 0, '验收'], [16, 0, '综合办公'], [16, 1, '0', 0],
        [19, 0, '专业服务'], [19, 1, '30', 30]], merges: [], max_row: 20, max_col: 2, truncated: false } };
    const before = JSON.stringify(audit);
    const labels = { del_other: '其他交付费用' }, types = { del_other: 'num' };
    const row = formComparison(audit, { del_other: 30 }, { del_other: 30 }, labels, types).rows[0];
    assert.equal(row.status, '表内计算'); assert.deepEqual(row.raw, [null, 0, 30]);
    assert.deepEqual(row.val_positions, [[13, 1], [16, 1], [19, 1]]);
    assert.equal(row.row, 13, '仍按最初标签行排序');
    assert.equal(formComparison(audit, { del_other: 30 }, { del_other: 0 }, labels, types).rows[0].status, '已修改');
    assert.equal(JSON.stringify(audit), before, '比较不得修改来源、pair或原表格');
    assert.deepEqual(row.lab_positions, [[13, 0], [16, 0], [19, 0]], '须保留三个有证据的标签格');
    assert.deepEqual(row.positions, [[13, 0], [16, 0], [19, 0], [13, 1], [16, 1], [19, 1]]);
  });
  check('IS-FORM-MULTI-EVIDENCE', '显式producer trace补齐贡献标签，pair/sheet有无不影响空贡献标签', () => {
    const labels = { del_other: '其他交付费用' }, types = { del_other: 'num' };
    for (const [evidence, raws, total] of [
      [{ pairs: [['综合办公', 0, [16, 0]], ['专业服务', 30, [19, 0]]] }, [null, 0, 30], 30],
      [{ sheet: { cells: [[13, 0, '验收'], [13, 1, '10', 10], [16, 0, '综合办公'],
        [19, 0, '专业服务'], [19, 1, '0', 0]], merges: [], max_row: 20, max_col: 2, truncated: false } }, [10, null, 0], 10]
    ]) {
      const audit = { sources: { del_other: { ...cellSource('验收 + 综合办公 + 专业服务', 13, raws[0]),
        lab_positions: [[13, 0], [16, 0], [19, 0]],
        val_positions: [[13, 1], [16, 1], [19, 1]], raws } }, ...evidence };
      const before = JSON.stringify(audit);
      const row = formComparison(audit, { del_other: total }, { del_other: total }, labels, types).rows[0];
      assert.equal(row.status, '表内计算'); assert.deepEqual(row.raw, raws);
      assert.deepEqual(row.val_positions, [[13, 1], [16, 1], [19, 1]]); assert.equal(row.row, 13);
      assert.equal(JSON.stringify(audit), before);
      assert.deepEqual(row.lab_positions, [[13, 0], [16, 0], [19, 0]], '独立证据不得丢标签格');
      assert.deepEqual(row.positions, [[13, 0], [16, 0], [19, 0], [13, 1], [16, 1], [19, 1]]);
    }
  });
  check('IS-FORM-MULTI-UNRELATED', '相同标签/相同原值不足以采用无关或拒绝标签，须关联实际贡献格', () => {
    const audit = { sources: { del_other: { ...cellSource('验收 + 综合办公 + 专业服务', 13, 10),
      lab_positions: [[13, 0], [16, 2], [19, 0]],
      val_positions: [[13, 1], [16, 3], [19, 1]], raws: [10, 20, 30] } },
      pairs: [['验收', 10, [13, 0]], ['综合办公', 99, [16, 0]], ['综合办公', 20, [16, 2]],
        ['专业服务', 30, [18, 0]], ['专业服务', 30, [19, 0]], ['无关标签', 30, [19, 2]], ['综合办公', 20, [25, 0]]],
      sheet: { cells: [[13, 0, '验收'], [13, 1, '10', 10], [16, 0, '综合办公'], [16, 1, '99', 99],
        [16, 2, '综合办公'], [16, 3, '20', 20], [18, 0, '专业服务'], [18, 1, '30', 30],
        [19, 0, '专业服务'], [19, 1, '30', 30], [19, 2, '无关标签'], [19, 3, '30', 30],
        [25, 0, '综合办公'], [25, 1, '20', 20]], merges: [], max_row: 26, max_col: 4, truncated: false },
      unpicked: [{ key: 'del_other', label: '综合办公', lab_pos: [16, 0], val_pos: [16, 1], raw: 99, selected: false,
        reason: '重复字段未采用' }, { key: 'del_other', label: '专业服务', lab_pos: [18, 0], val_pos: [18, 1], raw: 30,
        selected: false, reason: '重复字段未采用' }, { key: 'del_other', label: '综合办公', lab_pos: [25, 0], val_pos: [25, 1],
        raw: 20, selected: false, reason: '重复字段未采用' }] };
    const before = JSON.stringify(audit);
    const row = formComparison(audit, { del_other: 60 }, { del_other: 60 },
      { del_other: '其他交付费用' }, { del_other: 'num' }).rows[0];
    for (const rejected of [[16, 0], [18, 0], [19, 2], [25, 0]]) {
      assert.ok(!row.lab_positions.some(p => p[0] === rejected[0] && p[1] === rejected[1]), '不得高亮无关/拒绝标签 ' + rejected);
      assert.ok(!row.positions.some(p => p[0] === rejected[0] && p[1] === rejected[1]));
    }
    assert.deepEqual(row.val_positions, [[13, 1], [16, 3], [19, 1]]); assert.deepEqual(row.raw, [10, 20, 30]);
    assert.deepEqual(row.lab_positions, [[13, 0], [16, 2], [19, 0]]);
    assert.deepEqual(row.positions, [[13, 0], [16, 2], [19, 0], [13, 1], [16, 3], [19, 1]]);
    assert.equal(row.row, 13); assert.equal(JSON.stringify(audit), before);
  });
  check('IS-FORM-MULTI-NO-EVIDENCE', '只有值行号与合成标签不能凭空制造其余标签坐标', () => {
    const audit = { sources: { del_other: { ...cellSource('验收 + 综合办公 + 专业服务', 13, null),
      val_positions: [[13, 1], [16, 1], [19, 1]], raws: [null, 0, 30] } } };
    const before = JSON.stringify(audit);
    const row = formComparison(audit, { del_other: 30 }, { del_other: 30 },
      { del_other: '其他交付费用' }, { del_other: 'num' }).rows[0];
    assert.equal(row.status, '表内计算'); assert.deepEqual(row.raw, [null, 0, 30]);
    assert.deepEqual(row.lab_positions, [[13, 0]]); assert.deepEqual(row.val_positions, [[13, 1], [16, 1], [19, 1]]);
    assert.deepEqual(row.positions, [[13, 0], [13, 1], [16, 1], [19, 1]]); assert.equal(row.row, 13);
    assert.equal(JSON.stringify(audit), before);
  });
  check('IS-FORM-MULTI-LEGACY-EVIDENCE', '没有显式trace时pair/sheet真实标签也不能猜出额外贡献标签', () => {
    const audit = { sources: { del_other: { ...cellSource('验收', 13, 10),
      val_positions: [[13, 1], [16, 1], [19, 1]], raws: [10, 20, 30] } },
      pairs: [['验收', 10, [13, 0]], ['综合办公', 20, [16, 0]], ['专业服务', 30, [19, 0]]],
      sheet: { cells: [[13, 0, '验收'], [13, 1, '10', 10], [16, 0, '综合办公'], [16, 1, '20', 20],
        [19, 0, '专业服务'], [19, 1, '30', 30]] } };
    const before = JSON.stringify(audit);
    const row = formComparison(audit, { del_other: 60 }, { del_other: 60 },
      { del_other: '其他交付费用' }, { del_other: 'num' }).rows[0];
    assert.equal(row.status, '表内计算'); assert.deepEqual(row.raw, [10, 20, 30]);
    assert.deepEqual(row.val_positions, [[13, 1], [16, 1], [19, 1]]); assert.equal(row.row, 13);
    assert.equal(JSON.stringify(audit), before);
    assert.deepEqual(row.lab_positions, [[13, 0]], 'legacy不能从pair/sheet重新解析标签关联');
    assert.deepEqual(row.positions, [[13, 0], [13, 1], [16, 1], [19, 1]]);
  });
  check('IS-FORM-EXPLICIT-EMPTY', '显式空trace或全无效trace不能回退到legacy标签或其他原表证据', () => {
    for (const trace of [[], [[-1, 0], [13, '0'], [1], null]]) {
      const audit = { sources: { del_other: { ...cellSource('验收 + 综合办公', 13, 10),
        lab_positions: trace, val_positions: [[13, 1], [16, 1]], raws: [10, 20] } },
        pairs: [['验收', 10, [13, 0]], ['综合办公', 20, [16, 0]]],
        sheet: { cells: [[13, 0, '验收'], [16, 0, '综合办公']] } };
      const before = JSON.stringify(audit);
      const row = formComparison(audit, { del_other: 30 }, { del_other: 30 },
        { del_other: '其他交付费用' }, { del_other: 'num' }).rows[0];
      assert.equal(row.status, '表内计算'); assert.deepEqual(row.raw, [10, 20]);
      assert.deepEqual(row.val_positions, [[13, 1], [16, 1]]); assert.equal(JSON.stringify(audit), before);
      assert.deepEqual(row.lab_positions, []); assert.equal(row.row, null);
      assert.deepEqual(row.positions, [[13, 1], [16, 1]]);
    }
  });
  check('IS-FORM-SOURCELESS', '无原格导入/补录含0，不制造坐标且不展示白名单外或三值全空字段', () => {
    const result = formComparison({ warnings: ['没有映射的标签'], pairs: [['没有映射的标签', 99, [1, 0]]],
      sources: { unknown: cellSource('没有映射的标签', 1, 99) } },
      { calc: 0, unknown: 99 }, { calc: 0, online: 0, hidden: 3, empty: '' },
      { online: '在线', calc: '计算', empty: '空字段' }, { calc: 'num', online: 'num' });
    assert.deepEqual(result.rows.map(r => [r.key, r.status, r.raw, r.row]),
      [['online', '在线补录', null, null], ['calc', '表内计算', null, null]]);
    result.rows.forEach(r => {
      assert.deepEqual(r.positions, []); assert.deepEqual(r.lab_positions, []); assert.deepEqual(r.val_positions, []);
      assert.deepEqual(Object.keys(r).sort(), ['key', 'label', 'raw', 'imported', 'current', 'status', 'detail',
        'positions', 'lab_positions', 'val_positions', 'row'].sort());
    });
    assert.deepEqual(result.warnings, ['没有映射的标签']);
  });
  check('IS-FORM-RAW-POS-HANDOFF', '真实C5采用值高亮C5而非遗留B5，解析器legacy坐标保持', () => {
    assert.ok(syntheticForm, '真实合成解析器夹具缺失');
    const before = JSON.stringify(syntheticForm);
    const result = formComparison(syntheticForm, syntheticForm.fields, { ...syntheticForm.fields },
      { contract: '合同金额', dev_dept: '交付部门', del_other: '其他交付费用' },
      { contract: 'num', dev_dept: 'enum:公共服务部|交付处', del_other: 'num' });
    const contract = result.rows.find(r => r.key === 'contract');
    assert.equal(contract.raw, '1,234.50'); assert.equal(contract.imported, 1234.5);
    assert.equal(contract.status, '已换算'); assert.deepEqual(contract.val_positions, [[4, 2]]);
    assert.ok(!contract.positions.some(p => p[0] === 4 && p[1] === 1));
    assert.deepEqual(syntheticForm.sources.contract.val_pos, [4, 1]);
    assert.deepEqual(syntheticForm.sources.contract.raw_pos, [4, 2]);
    const other = result.rows.find(r => r.key === 'del_other');
    const contributorPairs = syntheticForm.pairs.filter(p => p[2]?.[1] === 0 && [13, 16, 19].includes(p[2][0]));
    assert.deepEqual(contributorPairs, [['验收', 10, [13, 0]], ['综合办公', 20, [16, 0]], ['专业服务', 30, [19, 0]]]);
    assert.deepEqual(syntheticForm.sheet.cells.filter(c => c[1] === 0 && [13, 16, 19].includes(c[0])),
      [[13, 0, '验收'], [16, 0, '综合办公'], [19, 0, '专业服务']]);
    assert.equal(syntheticForm.sources.del_other.label, '验收', 'legacy首标签文本仍保持，贡献标签由producer trace记录');
    assert.equal(other.status, '表内计算'); assert.deepEqual(other.raw, [10, 20, 30]);
    assert.deepEqual(other.val_positions, [[13, 1], [16, 1], [19, 1]]); assert.equal(other.row, 13);
    assert.equal(JSON.stringify(syntheticForm), before, '比较不得修改解析器audit');
    assert.deepEqual(syntheticForm.sources.del_other.lab_positions, [[13, 0], [16, 0], [19, 0]], 'producer不能漏掉显式贡献标签');
    assert.deepEqual(other.lab_positions, [[13, 0], [16, 0], [19, 0]], '真实解析器多项须高亮全部有证据标签');
    assert.deepEqual(other.positions, [[13, 0], [16, 0], [19, 0], [13, 1], [16, 1], [19, 1]]);
    const legacy = formComparison({ sources: { contract: { label: '合同金额', lab_pos: [2, 0], val_pos: [2, 1],
      raw: 5, raw_d: '5', selected: true } } }, { contract: 5 }, { contract: 5 }, { contract: '合同金额' }, { contract: 'num' });
    assert.deepEqual(legacy.rows[0].val_positions, [[2, 1]], '仅raw_pos缺席时兼容val_pos');
  });
  check('IS-FORM-DATE-HANDOFF', '真实售前日期区间折算月数披露，原始日期不能伪称一致', () => {
    assert.ok(presaleForm, '售前原件解析缺失');
    const row = formComparison(presaleForm, { presale_period: 3 }, { presale_period: 3 },
      { presale_period: '售前周期' }, { presale_period: 'num' }).rows[0];
    assert.equal(row.status, '已换算'); assert.match(row.detail, /日期.*月/);
    assert.deepEqual(row.lab_positions, [[10, 6]]); assert.deepEqual(row.val_positions, [[10, 8]]);
    assert.equal(one('2026-01-01至2026-01-30', 2, 2, 'num', 'presale_period').status, '有差异');
  });

  const deliveryRow = (content, stage, pm_pd, own_pd = 0, travel_cost = 0) =>
    ({ content, stage, pm_pd, own_pd, rd_pd: 0, prod_pd: 0, travel_cost, note: '' });
  const deliverySource = row => ({ content_pos: [row, 0], cols: { pm_pd: [row, 1], own_pd: [row, 2],
    rd_pd: [row, 3], prod_pd: [row, 4], travel_cost: [row, 5] }, travel_parts: [[row, 6], [row, 7]] });
  check('IS-DEL-OCCURRENCE', '重复内容/阶段队列保留两次，仅第二次改动，同内容运维不串实施', () => {
    const imported = [deliveryRow('重复', '实施', 1), deliveryRow('重复', '实施', 2), deliveryRow('重复', '运维', 3)];
    const current = [deliveryRow('重复', '实施', 1), deliveryRow('重复', '运维', 3), deliveryRow('重复', '实施', 9)];
    const audit = { row_sources: [deliverySource(4), deliverySource(5), deliverySource(4)] };
    const before = JSON.stringify({ audit, imported, current });
    const result = deliveryComparison(audit, imported, current);
    assert.equal(result.kind, 'delivery'); assert.equal(result.rows.length, 3);
    assert.deepEqual(result.rows.map(r => [r.row, r.stage, r.imported.pm_pd, r.current.pm_pd, r.status]),
      [[4, '实施', 1, 1, '一致'], [4, '运维', 3, 3, '一致'], [5, '实施', 2, 9, '已修改']]);
    assert.deepEqual(result.rows[2].changed_keys, ['pm_pd']); assert.match(result.rows[2].detail, /2.*→.*9/);
    assert.equal(new Set(result.rows.map(r => r.key)).size, 3); assert.deepEqual(result.counts, { '一致': 2, '已修改': 1 });
    assert.equal(JSON.stringify({ audit, imported, current }), before);
    result.rows.forEach(r => assert.deepEqual(Object.keys(r).sort(), ['key', 'label', 'content', 'stage', 'imported',
      'current', 'status', 'detail', 'changed_keys', 'positions', 'lab_positions', 'val_positions', 'row'].sort()));
  });
  check('IS-DEL-DELETE-NEW-SKIP', '删除/新建/原表剔除互不混淆，无预算原行不伪装已保存行', () => {
    const imported = [deliveryRow('删除', '实施', 2), deliveryRow('保留', '运维', 0, 0, 10)];
    const current = [deliveryRow('新增', '实施', 4), deliveryRow('保留', '运维', 0, 0, 10)];
    const result = deliveryComparison({ row_sources: [deliverySource(7), deliverySource(9)],
      skipped_rows: [{ r: 8, content: '文字', content_pos: [8, 0], reason: '无预算数字' }] }, imported, current);
    assert.deepEqual(result.rows.map(r => [r.content, r.status, r.row]),
      [['删除', '已删除', 7], ['文字', '已剔除', 8], ['保留', '一致', 9], ['新增', '在线补录', null]]);
    assert.equal(result.rows[0].current, null); assert.equal(result.rows[1].imported, null);
    assert.equal(result.rows[1].current, null); assert.equal(result.rows[1].detail, '原表有、系统未保留（无预算数字）');
    assert.deepEqual(result.rows[1].positions, [[8, 0]]); assert.deepEqual(result.rows[1].val_positions, []);
    assert.equal(result.rows[3].imported, null); assert.deepEqual(result.rows[3].positions, []);
    assert.deepEqual(result.counts, { '已删除': 1, '已剔除': 1, '一致': 1, '在线补录': 1 });
  });
  check('IS-DEL-FIVE-CHANGES', '五预算键分别披露；缺失不等于0且当前单位字符串不掩盖变化', () => {
    const old = deliveryRow('数值', '实施', 1);
    const changed = { ...old, pm_pd: 2, own_pd: 3, rd_pd: 4, prod_pd: 5, travel_cost: 6 };
    const row = deliveryComparison({}, [old], [changed]).rows[0];
    assert.equal(row.status, '已修改'); assert.deepEqual(row.changed_keys, ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost']);
    assert.deepEqual(row.imported, old); assert.deepEqual(row.current, changed);
    const cleared = { ...old }; delete cleared.own_pd;
    assert.deepEqual(deliveryComparison({}, [old], [cleared]).rows[0].changed_keys, ['own_pd']);
    assert.deepEqual(deliveryComparison({}, [old], [{ ...old, pm_pd: '1人天' }]).rows[0].changed_keys, ['pm_pd']);
  });
  check('IS-DEL-TRAVEL-NOTE', '差旅单键变化可见，差旅分项坐标齐全，备注变化不污染预算合计', () => {
    const old = deliveryRow('差旅', '运维', 0, 0, 12.35);
    const changed = { ...old, travel_cost: 20 };
    const result = deliveryComparison({ row_sources: [deliverySource(6)] }, [old], [changed]);
    assert.deepEqual(result.rows[0].changed_keys, ['travel_cost']);
    assert.deepEqual(result.rows[0].lab_positions, [[6, 0]]);
    assert.deepEqual(result.rows[0].val_positions, [[6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7]]);
    const travel = result.check.find(r => r.stage === '运维' && r.key === 'travel_cost');
    assert.equal(travel.imported, 12.35); assert.equal(travel.current, 20);
    const noted = deliveryComparison({}, [old], [{ ...old, note: '在线备注' }]);
    assert.equal(noted.check.find(r => r.stage === '运维' && r.key === 'travel_cost').current, 12.35);
    assert.ok(['一致', '已修改'].includes(noted.rows[0].status));
  });
  check('IS-DEL-TOTALS', '十项合计按阶段有限数求和并round2，原件缺合计显式不可用而非0', () => {
    const imported = [deliveryRow('甲', '实施', 0.1), deliveryRow('乙', '实施', 0.2), deliveryRow('丙', '运维', 5, 2, 7)];
    const audit = { total_row: { impl_pm: 0.3, impl_own: 0, impl_rd: 0, impl_prod: 0, impl_travel: 0,
      ops_pm: 5, ops_own: 2, ops_rd: 0, ops_prod: 0, ops_travel: 7 } };
    const result = deliveryComparison(audit, imported, imported);
    assert.equal(result.check.length, 10); assert.ok(result.check.every(r => r.status === '一致'));
    assert.deepEqual(result.check.map(r => [r.stage, r.key, r.raw, r.imported, r.current]), [
      ['实施', 'pm_pd', 0.3, 0.3, 0.3], ['实施', 'own_pd', 0, 0, 0], ['实施', 'rd_pd', 0, 0, 0],
      ['实施', 'prod_pd', 0, 0, 0], ['实施', 'travel_cost', 0, 0, 0], ['运维', 'pm_pd', 5, 5, 5],
      ['运维', 'own_pd', 2, 2, 2], ['运维', 'rd_pd', 0, 0, 0], ['运维', 'prod_pd', 0, 0, 0], ['运维', 'travel_cost', 7, 7, 7]]);
    assert.deepEqual(Object.keys(result.check[0]).sort(), ['stage', 'key', 'label', 'raw', 'imported', 'current', 'status'].sort());
    const unavailable = deliveryComparison({}, [], []).check;
    assert.ok(unavailable.every(r => r.raw === null && /不可用/.test(r.status)), '没有原合计不能宣称一致');
    const invalid = deliveryComparison({ total_row: { impl_pm: Infinity } }, [deliveryRow('非法', '实施', NaN)], []).check[0];
    assert.equal(invalid.raw, null); assert.equal(invalid.imported, 0); assert.equal(invalid.current, 0);
  });
  check('IS-DEL-RAW-TOTAL-PRECISION', '只round2系统行合计，不舍入原件合计以隐藏差异', () => {
    const rows = [deliveryRow('小数', '实施', 0.3)];
    const checkRow = deliveryComparison({ total_row: { impl_pm: 0.304 } }, rows, rows).check[0];
    assert.deepEqual([checkRow.raw, checkRow.imported, checkRow.current, checkRow.status], [0.304, 0.3, 0.3, '有差异']);
  });
  check('IS-DEL-8068-DISCLOSURE', '真实8068原件17.5/导入11.5/当前11.5差异必须保留，绝不修正', () => {
    const parsed = parsedDeliveries.get('PL00008068'); assert.ok(parsed, '8068解析原件缺失');
    const before = JSON.stringify(parsed);
    const result = deliveryComparison(parsed, parsed.rows, parsed.rows);
    const gap = result.check.find(r => r.stage === '实施' && r.key === 'own_pd');
    assert.deepEqual([gap.raw, gap.imported, gap.current, gap.status], [17.5, 11.5, 11.5, '有差异']);
    assert.equal(result.rows.filter(r => r.status === '一致').length, 30);
    assert.equal(result.rows.filter(r => r.status === '已剔除').length, 7); assert.deepEqual(result.warnings, []);
    assert.equal(JSON.stringify(parsed), before);
  });
  check('IS-DEL-8572-ANCHOR', '真实8572十项合计与两条明细/十条剔除保持来源锚定', () => {
    const parsed = parsedDeliveries.get('PL00008572'); assert.ok(parsed);
    const result = deliveryComparison(parsed, parsed.rows, parsed.rows);
    assert.equal(result.rows.length, 12); assert.deepEqual(result.counts, { '已剔除': 10, '一致': 2 });
    assert.ok(result.check.every(r => r.status === '一致'));
    assert.deepEqual(result.check.filter(r => r.stage === '实施').map(r => r.current), [5, 39, 0, 184, 6000]);
    assert.deepEqual(result.check.filter(r => r.stage === '运维').map(r => r.current), [2, 0, 0, 0, 0]);
  });

  check('IS-STORAGE-APPEND', '内存SQLite追加历史/最新id/字符串实体键，audit仅存选定证据无重复字段', () => {
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:');
    try {
      db.exec(source.IMPORT_SOURCES_DDL); db.exec(source.IMPORT_SOURCES_DDL);
      db.exec(`CREATE TRIGGER no_source_update BEFORE UPDATE ON import_sources BEGIN SELECT RAISE(ABORT, 'append only'); END;
        CREATE TRIGGER no_source_delete BEFORE DELETE ON import_sources BEGIN SELECT RAISE(ABORT, 'append only'); END;`);
      const parsed = { sheet: { name: '附1', cells: [[0, 0, '原值']], merges: [], max_row: 1, max_col: 1, truncated: false },
        sources: {}, pairs: [], unpicked: [], warnings: ['未知'], row_sources: [], skipped_rows: [], total_row: null,
        meta: { sheet: 'meta优先' }, grid: [[{ r: 0, c: 0, v: '旧网格' }]], fields: { contract: 99 }, rows: ['不可重复存储'], extra: '不存' };
      const args = { entity_type: 'budget', entity_key: 42, file_name: '预算原件.xlsx', file_path: 'private/42.xlsx',
        parsed, imported: { contract: 99 }, user: { id: 7, name: '导入者' }, created_at: '2026-10-23T12:00:00Z', backfilled: 0 };
      const first = source.saveImportSource(db, args);
      const savedFirst = JSON.stringify(first);
      const second = source.saveImportSource(db, { ...args, imported: { contract: 100 }, created_at: '2020-01-01', backfilled: 1 });
      assert.ok(second.id > first.id); assert.equal(db.prepare('SELECT COUNT(*) n FROM import_sources').get().n, 2);
      assert.equal(first.entity_key, '42'); assert.equal(first.sheet, 'meta优先');
      assert.equal(first.importer_id, 7); assert.equal(first.importer_name, '导入者');
      assert.deepEqual(JSON.parse(first.audit_json), { sheet: parsed.sheet, sources: {}, pairs: [], unpicked: [], warnings: ['未知'],
        row_sources: [], skipped_rows: [], total_row: null, meta: { sheet: 'meta优先' } });
      assert.deepEqual(JSON.parse(first.imported_json), { contract: 99 });
      assert.equal(JSON.stringify(db.prepare('SELECT * FROM import_sources WHERE id=?').get(first.id)), savedFirst);
      assert.equal(source.latestImportSource(db, 'budget', '42').id, second.id, '按id而非created_at找最新');
      assert.equal(source.latestImportSource(db, 'review', 42), null);
      assert.equal(source.latestImportSource(db, 'budget', 999), null);
      const defaulted = source.saveImportSource(db, { ...args, entity_key: 'other', parsed: { sheet: { name: 'sheet次选' } }, user: undefined, backfilled: undefined });
      assert.equal(defaulted.backfilled, 0); assert.equal(defaulted.sheet, 'sheet次选'); assert.equal(defaulted.importer_id, null);
      assert.equal(defaulted.importer_name, null);
    } finally { db.close(); }
  });
  check('IS-STORAGE-META', '来源元信息仅公开锁定白名单，不泄漏路径/audit/导入值/导入者id', () => {
    const row = { id: 2, file_name: '原件.xlsx', sheet: '附1', created_at: '日期', importer_name: '张三', backfilled: 1,
      inherited_from: 8, file_path: 'secret/path', audit_json: 'secret audit', imported_json: 'secret fields', importer_id: 7 };
    assert.deepEqual(source.sourceMeta(row), { id: 2, file_name: '原件.xlsx', sheet: '附1', created_at: '日期',
      importer_name: '张三', backfilled: 1, inherited_from: 8 });
    const own = { ...row }; delete own.inherited_from;
    assert.deepEqual(Object.keys(source.sourceMeta(own)).sort(), ['id', 'file_name', 'sheet', 'created_at', 'importer_name', 'backfilled'].sort());
    assert.equal(source.sourceMeta(null), null);
  });
  check('IS-STORAGE-INHERIT', '预算祖父来源继承、最近父来源、子自身覆盖；无源/未知预算返回null', () => {
    const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:');
    try {
      db.exec(source.IMPORT_SOURCES_DDL);
      db.exec('CREATE TABLE budgets (id INTEGER PRIMARY KEY, parent_id INTEGER); INSERT INTO budgets VALUES (1,NULL),(2,1),(3,2),(4,NULL),(5,4);');
      const save = id => source.saveImportSource(db, { entity_type: 'budget', entity_key: id, file_name: '原件.xlsx',
        file_path: 'private.xlsx', parsed: {}, imported: { contract: id }, user: { id: 7, name: '导入者' }, created_at: '日期', backfilled: 0 });
      const grandparent = save(1);
      assert.equal(source.budgetImportSource(db, 3).id, grandparent.id);
      assert.equal(source.budgetImportSource(db, 3).inherited_from, 1);
      const parent = save(2); assert.equal(source.budgetImportSource(db, 3).id, parent.id);
      assert.equal(source.budgetImportSource(db, 3).inherited_from, 2);
      const child = save(3); assert.equal(source.budgetImportSource(db, 3).id, child.id);
      assert.ok(!Object.hasOwn(source.budgetImportSource(db, 3), 'inherited_from'));
      assert.equal(source.budgetImportSource(db, 5), null); assert.equal(source.budgetImportSource(db, 999), null);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM import_sources').get().n, 3);
    } finally { db.close(); }
  });
  check('IS-BUDGET-LABEL-CONSUMER', '预算白名单标签真实进入对照，含商机代码和销售人力成本', () => {
    const result = formComparison({}, {}, { opp_code: 'PL1', sales_labor: 0, dev_pd: 1, prod_pd: 2 },
      source.BUDGET_FIELD_LABELS, { opp_code: 'str', sales_labor: 'num', dev_pd: 'num', prod_pd: 'num' });
    assert.deepEqual(result.rows.map(r => [r.key, r.label]), [['sales_labor', '销售人力成本'],
      ['dev_pd', '正编人天(天)'], ['prod_pd', '生产外包人天(天)'], ['opp_code', '商机代码']]);
    assert.ok(result.rows.every(r => r.status === '在线补录'));
  });
}

async function httpRaw(token, reqPath, method, body, binary = false) {
  try {
    const response = await fetch(BASE + reqPath, {
      method: method || 'GET',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const headers = Object.fromEntries(response.headers.entries());
    if (binary) return { status: response.status, headers, buffer: Buffer.from(await response.arrayBuffer()) };
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = { _text: text }; }
    }
    return { status: response.status, headers, data };
  } catch (e) {
    return { status: 0, headers: {}, data: { error: e.message }, error: e };
  }
}

async function httpApi(token, reqPath, method, body) {
  const response = await httpRaw(token, reqPath, method, body);
  assert.equal(response.status, 200, reqPath + ' -> ' + response.status + ' ' + String(response.data?.error || ''));
  return response.data;
}

async function httpLogin(username) {
  const data = await httpApi(null, '/api/login', 'POST', { username, password: '123456' });
  assert.equal(typeof data.token, 'string', username + ' 登录未返回 token');
  return data.token;
}

function makeHttpFixtures(nonce) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-task4-http-'));
  const files = {
    budget1: path.join(dir, 'budget-' + nonce + '-1.xlsx'),
    budget2: path.join(dir, 'budget-' + nonce + '-2.xlsx'),
    review: path.join(dir, 'review-' + nonce + '.xlsx'),
    zero: path.join(dir, 'delivery-zero-' + nonce + '.xlsx'),
    headerless: path.join(dir, 'delivery-headerless-' + nonce + '.xlsx')
  };
  const py = `import sys, openpyxl

def make_form(filename, sheet, rows):
    w = openpyxl.Workbook(); s = w.active; s.title = sheet
    for row in rows: s.append(row)
    w.save(filename)

nonce, budget_code, review_code = sys.argv[6:9]
make_form(sys.argv[1], '附1-预算表', [
 ['项目名称', 'IS预算原件一-' + nonce], ['客户名称', 'IS客户一'], ['商机代码', budget_code],
 ['合同金额', 240000], ['分包采购成本', 0], ['软件类生产外包', 0], ['灵活用工', 0],
 ['销售差旅费', 0], ['招待费', 0], ['市场营销', 0], ['所属部门', '交付处'],
 ['正编人天', 39], ['生产人天', 184], ['研发外包', 0], ['交付差旅', 0],
 ['项目管理费', 0], ['验收招待及综合办公', 0]
])
make_form(sys.argv[2], '附1-预算表', [
 ['项目名称', 'IS预算原件二-' + nonce], ['客户名称', 'IS客户二'], ['商机代码', budget_code + '-B'],
 ['合同金额', 350000], ['分包采购成本', 0], ['所属部门', '交付处'], ['正编人天', 1], ['交付差旅', 0]
])
make_form(sys.argv[3], '投标决策', [
 ['商机代码', review_code], ['商机名称', 'IS评审原件-' + nonce], ['商机阶段', '投标决策'],
 ['营销区域', '华北营销处'], ['最终客户名称', 'IS评审客户'], ['业务线', 'G1'], ['预计合同金额', 24],
 ['销售经理', '测试销售'], ['项目经理', '测试PM'], ['预计签单时间', '2026-12-31'],
 ['预计贡献毛利率', 15], ['是否涉及数据评审', '否'], ['评审结论', '同意通过'], ['评审日期', '2024-05-12']
])
w = openpyxl.Workbook(); s = w.active; s.title = '附3-交付成本评估'
s.cell(1, 1, '合计'); s.cell(2, 12, '运维阶段人力成本')
for c, text in [(1, '建设内容'), (2, '人天汇总项目经理'), (3, '人天汇总正编'), (4, '人天汇总产研外包'), (5, '人天汇总生产外包'), (6, '实施阶段差旅成本'), (12, '项目经理正编人天'), (13, '产研正编人天'), (14, '产研外包人天'), (15, '生产外包人天'), (16, '运维阶段差旅成本')]: s.cell(3, c, text)
for r, text in [(4, '全零建设内容甲'), (5, '全零建设内容乙')]:
    s.cell(r, 1, text)
    for c in [2,3,4,5,6,12,13,14,15,16]: s.cell(r, c, 0)
w.save(sys.argv[4])
w = openpyxl.Workbook(); s = w.active; s.title = '附3-交付成本评估'; s['A1'] = '普通说明'; s['B2'] = 123
w.save(sys.argv[5])
`;
  const args = ['-B', '-X', 'utf8', '-c', py, files.budget1, files.budget2, files.review,
    files.zero, files.headerless, nonce, 'PL-IS-B-' + nonce, 'PL-IS-R-' + nonce];
  const made = spawnSync('python', args, {
    windowsHide: true, encoding: 'utf8', cwd: ROOT, timeout: 60000, maxBuffer: 8 * 1024 * 1024
  });
  if (made.status !== 0 || made.error) {
    for (const file of Object.values(files)) { try { fs.unlinkSync(file); } catch (e) {} }
    try { fs.rmdirSync(dir); } catch (e) {}
    throw made.error || new Error('HTTP XLSX 夹具生成失败: ' + made.stderr);
  }
  return { dir, files, budgetCode: 'PL-IS-B-' + nonce, reviewCode: 'PL-IS-R-' + nonce };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function assertMeta(meta, expectedName) {
  assert.ok(meta && Number.isInteger(meta.id) && meta.id > 0, '缺少 source metadata id');
  if (expectedName) assert.equal(meta.file_name, expectedName);
  assert.equal(meta.backfilled, 0);
  for (const key of ['file_path', 'audit', 'audit_json', 'imported', 'imported_json']) {
    assert.ok(!Object.hasOwn(meta, key), 'metadata 泄漏 ' + key);
  }
  assert.ok(meta.sheet == null || typeof meta.sheet === 'string', '详情不得内嵌 sheet 对象');
}

function comparisonRow(payload, key) {
  assert.ok(payload && payload.sheet && Array.isArray(payload.sheet.cells), 'source 未返回真实 worksheet');
  assert.ok(payload.comparison && Array.isArray(payload.comparison.rows), 'source 未返回 comparison');
  const row = payload.comparison.rows.find(item => item.key === key);
  assert.ok(row, 'comparison 缺少 ' + key);
  return row;
}

function oppBody(code, title) {
  return { opp_code: code, title, customer: 'IS商机客户', biz_line: 'G1', contract_amount: 240,
    opp_stage: '投标决策', sales: '测试销售', summary: 'Task4 HTTP 原表对照夹具' };
}

function budgetFields(name, oppCode) {
  return { project_name: name, customer: 'IS预算客户', contract: 240000, sub_cost: 0,
    dev_dept: '交付处', dev_pd: 1, del_travel: 0, ...(oppCode ? { opp_code: oppCode } : {}) };
}

async function createOpp(token, code, title) {
  const data = await httpApi(token, '/api/opp', 'POST', oppBody(code, title));
  assert.equal(data.opp?.opp_code, code);
  return data.opp;
}

async function createBudget(token, name, oppCode) {
  const fields = budgetFields(name, oppCode);
  const data = await httpApi(token, '/api/budget', 'POST', {
    project_name: name, fields, ...(oppCode ? { opp_code: oppCode } : {})
  });
  assert.ok(Number.isInteger(data.id) && data.id > 0);
  return data;
}

async function runHttp() {
  const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let fixture = null;
  const tokens = {};
  await checkAsync('IS-HTTP-SETUP-AUTH', 'HTTP 前置登录 sales1/zhichizu/fin1/pm1/admin 全部成功', async () => {
    tokens.sales = await httpLogin('sales1');
    tokens.support = await httpLogin('zhichizu');
    tokens.finance = await httpLogin('fin1');
    tokens.pm = await httpLogin('pm1');
    tokens.admin = await httpLogin('admin');
  });
  if (!tokens.sales || !tokens.support || !tokens.finance || !tokens.pm || !tokens.admin) return;
  check('IS-HTTP-SETUP-XLSX', 'Python 生成唯一受控预算/评审/全零/无表头 XLSX', () => {
    fixture = makeHttpFixtures(nonce);
    for (const file of Object.values(fixture.files)) assert.ok(fs.statSync(file).isFile());
  });
  if (!fixture) return;

  const generated = Object.values(fixture.files);
  try {
    const real8572 = fixtureFile('PL00008572');
    const realBytes = fs.readFileSync(real8572);
    const budgetName1 = 'IS预算中文原件-' + nonce + '.xlsx';
    const budgetName2 = 'IS预算"第二原件-' + nonce + '.xlsx';
    const concurrentName = "2024_'()*并发同名原件-" + nonce + '.xlsx';
    const reviewName = 'IS评审中文原件-' + nonce + '.xlsx';
    const historyName = '2024_历史评审中文-' + nonce + '.xlsx';
    const deliveryName = 'IS交付中文原件-' + nonce + '.xlsx';
    const b1Bytes = fs.readFileSync(fixture.files.budget1);
    const b2Bytes = fs.readFileSync(fixture.files.budget2);
    const reviewBytes = fs.readFileSync(fixture.files.review);
    const zeroBytes = fs.readFileSync(fixture.files.zero);
    const headerlessBytes = fs.readFileSync(fixture.files.headerless);
    const upload = (filename, bytes, extra = {}) => ({ filename, data: bytes.toString('base64'), ...extra });

    let budget1, budget2, budget1Source, budget2Source, budget1Detail, budget1Compare;
    let review1, review2, historyReview, review1Detail, review1Compare;
    let onlineBudget, onlineReview, unlinkedBudget, unlinkedSource, linkedBudget2, linkedDelivery1, linkedDelivery2;
    let standaloneOpp, standaloneSource, filterBudget, zeroBudget, zeroOpp;
    let crossOpp, crossBudget, crossSource, childBudget;

    await checkAsync('IS-HTTP-BUDGET-IMPORT-1', '预算导入返回来源并保留 legacy audit', async () => {
      budget1 = await httpApi(tokens.sales, '/api/budget/import', 'POST', upload(budgetName1, b1Bytes));
      assert.ok(Number.isInteger(budget1.id));
      assertMeta(budget1.source, budgetName1);
      assert.ok(Array.isArray(budget1.audit?.pairs) && budget1.audit.sources && Array.isArray(budget1.audit.grid));
      budget1Source = budget1.source;
    });
    await checkAsync('IS-HTTP-BUDGET-IMPORT-2', '重复预算导入创建新预算与新来源而非更新旧实体', async () => {
      budget2 = await httpApi(tokens.sales, '/api/budget/import', 'POST', upload(budgetName2, b2Bytes));
      assert.notEqual(budget2.id, budget1.id);
      assertMeta(budget2.source, budgetName2);
      assert.notEqual(budget2.source.id, budget1.source.id);
      budget2Source = budget2.source;
    });
    await checkAsync('IS-HTTP-BUDGET-DETAIL-META', '预算详情只嵌来源元信息且不泄漏路径/audit/sheet对象', async () => {
      budget1Detail = await httpApi(tokens.sales, '/api/budget/' + budget1.id);
      assertMeta(budget1Detail.budget?.import_source, budgetName1);
      assert.equal(budget1Detail.budget.import_source.id, budget1Source.id);
    });
    await checkAsync('IS-HTTP-BUDGET-SOURCE-ORIGINAL', '预算 source 返回真实原表与 contract 原值/导入值/当前值', async () => {
      budget1Compare = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/source');
      assert.equal(budget1Compare.source.id, budget1Source.id);
      const row = comparisonRow(budget1Compare, 'contract');
      assert.equal(row.raw, 240000); assert.equal(row.imported, 240000); assert.equal(row.current, 240000);
    });
    await checkAsync('IS-HTTP-BUDGET-SOURCE-MODIFIED', '预算在线 PUT 只改变 current，导入快照保持并标记已修改', async () => {
      await httpApi(tokens.sales, '/api/budget/' + budget1.id, 'PUT', { fields: { contract: 250000 } });
      const payload = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/source');
      const row = comparisonRow(payload, 'contract');
      assert.equal(row.raw, 240000); assert.equal(row.imported, 240000); assert.equal(row.current, 250000);
      assert.equal(row.status, '已修改');
    });
    await checkAsync('IS-HTTP-BUDGET-FIRST-STABLE', '第二次预算导入后第一预算仍解析自己的原来源', async () => {
      const first = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/source');
      const second = await httpApi(tokens.sales, '/api/budget/' + budget2.id + '/source');
      assert.equal(first.source.id, budget1Source.id); assert.equal(comparisonRow(first, 'contract').imported, 240000);
      assert.equal(second.source.id, budget2Source.id); assert.equal(comparisonRow(second, 'contract').imported, 350000);
    });
    await checkAsync('IS-HTTP-BUDGET-CONCURRENT-BYTES', '并发同名预算导入各自保留原件字节与完整数字前缀文件名', async () => {
      const [first, second] = await Promise.all([
        httpApi(tokens.sales, '/api/budget/import', 'POST', upload(concurrentName, b1Bytes)),
        httpApi(tokens.sales, '/api/budget/import', 'POST', upload(concurrentName, b2Bytes))
      ]);
      assert.notEqual(first.source.id, second.source.id);
      const firstFile = await httpRaw(tokens.sales, '/api/import-sources/' + first.source.id + '/file', 'GET', undefined, true);
      const secondFile = await httpRaw(tokens.sales, '/api/import-sources/' + second.source.id + '/file', 'GET', undefined, true);
      assert.equal(firstFile.status, 200); assert.equal(secondFile.status, 200);
      assert.equal(sha256(firstFile.buffer), sha256(b1Bytes)); assert.equal(sha256(secondFile.buffer), sha256(b2Bytes));
      const encoded = "filename*=UTF-8''2024_%27%28%29%2A%E5%B9%B6%E5%8F%91%E5%90%8C%E5%90%8D%E5%8E%9F%E4%BB%B6-" + nonce + '.xlsx';
      assert.ok((firstFile.headers['content-disposition'] || '').includes(encoded));
      assert.ok((secondFile.headers['content-disposition'] || '').includes(encoded));
    });

    await checkAsync('IS-HTTP-REVIEW-IMPORT-1', '普通评审导入返回 audit/source 并创建独立实体', async () => {
      review1 = await httpApi(tokens.sales, '/api/reviews/import', 'POST', upload(reviewName, reviewBytes, { type: 'bid' }));
      assert.ok(Number.isInteger(review1.id)); assertMeta(review1.source, reviewName);
      assert.ok(Array.isArray(review1.audit?.pairs) && review1.audit.sources && Array.isArray(review1.audit.grid));
      assert.equal(review1.form.opp_code, fixture.reviewCode); assert.equal(review1.form.data_review, '否');
    });
    await checkAsync('IS-HTTP-REVIEW-IMPORT-2', '重复评审导入创建新评审与新来源而非更新旧实体', async () => {
      review2 = await httpApi(tokens.sales, '/api/reviews/import', 'POST', upload('IS评审重复-' + nonce + '.xlsx', reviewBytes, { type: 'bid' }));
      assert.notEqual(review2.id, review1.id); assert.notEqual(review2.source.id, review1.source.id);
    });
    await checkAsync('IS-HTTP-REVIEW-DETAIL-META', '评审详情保留原 opp/data_review 且只嵌来源元信息', async () => {
      review1Detail = await httpApi(tokens.sales, '/api/reviews/' + review1.id);
      const form = JSON.parse(review1Detail.review.form_json || '{}');
      assert.equal(form.opp_code, fixture.reviewCode); assert.equal(form.data_review, '否');
      assertMeta(review1Detail.review.import_source, reviewName);
    });
    await checkAsync('IS-HTTP-REVIEW-SOURCE-MODIFIED', '评审编辑后 source 显示当前修改且 opp_name 标签为商机名称', async () => {
      const form = JSON.parse(review1Detail.review.form_json || '{}');
      await httpApi(tokens.sales, '/api/reviews/' + review1.id, 'PUT', { form: { ...form, data_review: '是' } });
      review1Compare = await httpApi(tokens.sales, '/api/reviews/' + review1.id + '/source');
      const dataReview = comparisonRow(review1Compare, 'data_review');
      assert.equal(dataReview.raw, '否'); assert.equal(dataReview.imported, '否'); assert.equal(dataReview.current, '是');
      assert.equal(dataReview.status, '已修改');
      assert.equal(comparisonRow(review1Compare, 'opp_name').label, '商机名称');
    });
    await checkAsync('IS-HTTP-REVIEW-HISTORY', 'history 导入存来源/audit、相对附件并保持 archived/none 与原字段', async () => {
      historyReview = await httpApi(tokens.support, '/api/reviews/import', 'POST',
        upload(historyName, reviewBytes, { type: 'bid', mode: 'history', review_date: '2024-05-12' }));
      assert.equal(historyReview.status, 'archived'); assert.equal(historyReview.light, 'none');
      assertMeta(historyReview.source, historyName);
      assert.ok(Array.isArray(historyReview.audit?.pairs) && historyReview.audit.sources && Array.isArray(historyReview.audit.grid));
      const detail = await httpApi(tokens.support, '/api/reviews/' + historyReview.id);
      const form = JSON.parse(detail.review.form_json || '{}');
      assert.equal(form.opp_code, fixture.reviewCode); assert.equal(form.data_review, '否');
      assert.equal(detail.review.status, 'archived'); assert.equal(detail.review.light, 'none');
      const attachment = detail.attachments.find(item => item.field === '历史评审表原件');
      assert.ok(attachment); assert.equal(path.isAbsolute(attachment.filepath), false);
      assert.match(attachment.filepath, /^import[\\/]/); assert.ok(!attachment.filepath.includes(ROOT));
    });
    await checkAsync('IS-HTTP-REVIEW-READ-ALL', '评审 source 对所有登录角色可读且非 owner 看到同一来源', async () => {
      for (const token of [tokens.finance, tokens.pm, tokens.support, tokens.admin]) {
        const response = await httpRaw(token, '/api/reviews/' + review1.id + '/source');
        assert.equal(response.status, 200); assert.equal(response.data.source.id, review1.source.id);
      }
      const history = await httpApi(tokens.finance, '/api/reviews/' + historyReview.id + '/source');
      assert.equal(history.source.id, historyReview.source.id);
    });

    await checkAsync('IS-HTTP-ONLINE-SOURCE-NULL', '纯在线预算/评审 current 不伪造原件来源', async () => {
      onlineBudget = await createBudget(tokens.sales, 'IS在线预算-' + nonce, null);
      const bSource = await httpApi(tokens.sales, '/api/budget/' + onlineBudget.id + '/source');
      assert.equal(bSource.source, null);
      onlineReview = await httpApi(tokens.sales, '/api/reviews', 'POST', {
        type: 'bid', title: 'IS在线评审-' + nonce, form: { opp_code: 'PL-IS-ONLINE-' + nonce, data_review: '是' }, submit: false
      });
      const rSource = await httpApi(tokens.sales, '/api/reviews/' + onlineReview.id + '/source');
      assert.equal(rSource.source, null);
      const detail = await httpApi(tokens.sales, '/api/reviews/' + onlineReview.id);
      assert.equal(detail.review.import_source, null);
    });
    await checkAsync('IS-HTTP-ONLINE-DELIVERY-NULL', '纯在线交付有 current 行但 source:null，不虚构 original', async () => {
      await httpApi(tokens.sales, '/api/budget/' + onlineBudget.id + '/delivery', 'PUT', {
        rows: [{ content: '在线建设内容', stage: '实施', own_pd: 1 }]
      });
      const payload = await httpApi(tokens.sales, '/api/budget/' + onlineBudget.id + '/delivery/source');
      assert.equal(payload.source, null);
      const detail = await httpApi(tokens.sales, '/api/budget/' + onlineBudget.id + '/delivery');
      assert.equal(detail.import_source, null); assert.equal(detail.rows.length, 1);
    });

    await checkAsync('IS-HTTP-DELIVERY-BUDGET', '无挂靠预算导入8572落 delivery_budget，返回2行/10剔除/source', async () => {
      unlinkedBudget = await createBudget(tokens.sales, 'IS无挂靠交付-' + nonce, null);
      const data = await httpApi(tokens.sales, '/api/budget/' + unlinkedBudget.id + '/delivery/import', 'POST',
        upload('IS无挂靠8572-' + nonce + '.xlsx', realBytes));
      assert.equal(data.rows.length, 2); assert.equal(data.audit?.skipped_rows?.length, 10);
      assert.equal(data.audit?.row_sources?.length, 2); assert.ok(Array.isArray(data.audit?.grid));
      assert.ok(data.audit?.meta && data.total_row); assert.ok(data.audit?.sheet && Array.isArray(data.audit.sheet.cells));
      assertMeta(data.source, 'IS无挂靠8572-' + nonce + '.xlsx');
      unlinkedSource = data.source;
      const source = await httpApi(tokens.sales, '/api/budget/' + unlinkedBudget.id + '/delivery/source');
      assert.equal(source.source.id, data.source.id); assert.equal(source.comparison.rows.length, 12);
      assert.equal(source.comparison.check.length, 10); assert.deepEqual(source.comparison.counts, { '已剔除': 10, '一致': 2 });
      const detail = await httpApi(tokens.sales, '/api/budget/' + unlinkedBudget.id + '/delivery');
      assert.equal(detail.import_source.id, data.source.id);
    });

    await checkAsync('IS-HTTP-DELIVERY-LINKED-FIRST', '挂靠预算导入实际落 delivery_opp 并返回来源', async () => {
      linkedBudget2 = await createBudget(tokens.sales, 'IS同商机预算二-' + nonce, fixture.budgetCode);
      linkedDelivery1 = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/delivery/import', 'POST',
        upload(deliveryName, realBytes));
      assert.equal(linkedDelivery1.rows.length, 2); assert.equal(linkedDelivery1.audit?.skipped_rows?.length, 10);
      assertMeta(linkedDelivery1.source, deliveryName);
    });
    await checkAsync('IS-HTTP-DELIVERY-LINKED-REIMPORT', '同一 delivery_opp 重导追加新来源 id 且 GET 回显最新元信息', async () => {
      linkedDelivery2 = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/delivery/import', 'POST',
        upload('IS交付重导-' + nonce + '.xlsx', realBytes));
      assert.notEqual(linkedDelivery2.source.id, linkedDelivery1.source.id);
      const detail = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/delivery');
      assert.equal(detail.import_source.id, linkedDelivery2.source.id);
    });
    await checkAsync('IS-HTTP-DELIVERY-SHARED-OPP', '同商机两预算与商机端点读取同一最新 delivery_opp 来源', async () => {
      const first = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/delivery/source');
      const second = await httpApi(tokens.sales, '/api/budget/' + linkedBudget2.id + '/delivery/source');
      const direct = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(fixture.budgetCode) + '/delivery/source');
      assert.equal(first.source.id, linkedDelivery2.source.id);
      assert.equal(second.source.id, linkedDelivery2.source.id);
      assert.equal(direct.source.id, linkedDelivery2.source.id);
      const directDetail = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(fixture.budgetCode) + '/delivery');
      assert.equal(directDetail.delivery.import_source.id, linkedDelivery2.source.id);
    });

    await checkAsync('IS-HTTP-DELIVERY-OPP-DIRECT', '独立商机直接导入8572落自己的 delivery_opp 来源', async () => {
      const code = 'PL-IS-DIRECT-' + nonce;
      standaloneOpp = await createOpp(tokens.sales, code, 'IS独立商机-' + nonce);
      const data = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(code) + '/delivery/import', 'POST',
        upload('IS独立商机8572-' + nonce + '.xlsx', realBytes));
      assert.equal(data.rows.length, 2); assert.equal(data.audit?.skipped_rows?.length, 10);
      assertMeta(data.source, 'IS独立商机8572-' + nonce + '.xlsx');
      standaloneSource = data.source;
      const source = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(code) + '/delivery/source');
      assert.equal(source.source.id, standaloneSource.id);
    });

    const mixedRows = [
      { content: '成本锚定行', stage: '实施', pm_pd: 1, own_pd: 2, rd_pd: 3, prod_pd: 4, travel_cost: 5 },
      { content: '只有内容', stage: '实施' },
      { content: '', stage: '实施', note: '只有备注' },
      { content: '全零', stage: '实施', pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0 },
      { content: '负数', stage: '实施', pm_pd: -1 },
      { content: '非法', stage: '实施', own_pd: '无数字' },
      { content: '仅差旅', stage: '实施', travel_cost: 800 }
    ];
    await checkAsync('IS-HTTP-PUT-BUDGET-DROPPED', '预算 PUT 按五预算键丢5行并保持成本公式锚点', async () => {
      filterBudget = await createBudget(tokens.sales, 'IS预算PUT清理-' + nonce, null);
      const data = await httpApi(tokens.sales, '/api/budget/' + filterBudget.id + '/delivery', 'PUT', { rows: mixedRows });
      assert.equal(data.dropped, 5); assert.deepEqual(data.rows.map(row => row.content), ['成本锚定行', '仅差旅']);
      assert.equal(data.rows.find(row => row.content === '成本锚定行').cost, 9358);
      assert.equal(data.rows.find(row => row.content === '仅差旅').cost, 800);
    });
    await checkAsync('IS-HTTP-PUT-OPP-DROPPED', '商机 PUT 同样丢5行、仅差旅行保留且来源快照不被覆盖', async () => {
      await createBudget(tokens.sales, 'IS独立商机计价预算-' + nonce, standaloneOpp.opp_code);
      const data = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(standaloneOpp.opp_code) + '/delivery', 'PUT', { rows: mixedRows });
      assert.equal(data.dropped, 5); assert.deepEqual(data.rows.map(row => row.content), ['成本锚定行', '仅差旅']);
      assert.equal(data.rows.find(row => row.content === '成本锚定行').cost, 9358);
      assert.equal(data.rows.find(row => row.content === '仅差旅').cost, 800);
      const source = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(standaloneOpp.opp_code) + '/delivery/source');
      assert.equal(source.source.id, standaloneSource.id);
      assert.ok(source.comparison.rows.some(row => row.status === '已删除' || row.status === '在线补录' || row.status === '已修改'));
    });

    await checkAsync('IS-HTTP-ZERO-BUDGET', '预算交付全零有效模板按原表2行给精确400且不保存来源', async () => {
      zeroBudget = await createBudget(tokens.sales, 'IS全零预算-' + nonce, null);
      const response = await httpRaw(tokens.sales, '/api/budget/' + zeroBudget.id + '/delivery/import', 'POST',
        upload('IS全零交付-' + nonce + '.xlsx', zeroBytes));
      assert.equal(response.status, 400);
      assert.equal(response.data.error, '原表 2 行建设内容均无预算数字，未生成明细行。可改用在线编辑手动建行。');
      const source = await httpApi(tokens.sales, '/api/budget/' + zeroBudget.id + '/delivery/source');
      assert.equal(source.source, null);
    });
    await checkAsync('IS-HTTP-ZERO-OPP', '商机交付全零有效模板同样精确400且不保存来源', async () => {
      zeroOpp = await createOpp(tokens.sales, 'PL-IS-ZERO-' + nonce, 'IS全零商机-' + nonce);
      const response = await httpRaw(tokens.sales, '/api/opp/' + encodeURIComponent(zeroOpp.opp_code) + '/delivery/import', 'POST',
        upload('IS商机全零-' + nonce + '.xlsx', zeroBytes));
      assert.equal(response.status, 400);
      assert.equal(response.data.error, '原表 2 行建设内容均无预算数字，未生成明细行。可改用在线编辑手动建行。');
      const source = await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(zeroOpp.opp_code) + '/delivery/source');
      assert.equal(source.source, null);
    });
    await checkAsync('IS-HTTP-HEADERLESS-BUDGET', '预算交付无表头模板保持旧400文案', async () => {
      const response = await httpRaw(tokens.sales, '/api/budget/' + zeroBudget.id + '/delivery/import', 'POST',
        upload('IS无表头-' + nonce + '.xlsx', headerlessBytes));
      assert.equal(response.status, 400);
      assert.equal(response.data.error, "未定位'建设内容'列头");
      assert.equal((await httpApi(tokens.sales, '/api/budget/' + zeroBudget.id + '/delivery/source')).source, null);
    });
    await checkAsync('IS-HTTP-HEADERLESS-OPP', '商机交付无表头模板保持旧400文案', async () => {
      const response = await httpRaw(tokens.sales, '/api/opp/' + encodeURIComponent(zeroOpp.opp_code) + '/delivery/import', 'POST',
        upload('IS商机无表头-' + nonce + '.xlsx', headerlessBytes));
      assert.equal(response.status, 400);
      assert.equal(response.data.error, "未定位'建设内容'列头");
      assert.equal((await httpApi(tokens.sales, '/api/opp/' + encodeURIComponent(zeroOpp.opp_code) + '/delivery/source')).source, null);
    });

    await checkAsync('IS-HTTP-SOURCE-ANONYMOUS', '四类 source 与原件下载均要求登录', async () => {
      const paths = ['/api/budget/' + budget1.id + '/source', '/api/reviews/' + review1.id + '/source',
        '/api/budget/' + budget1.id + '/delivery/source',
        '/api/opp/' + encodeURIComponent(standaloneOpp.opp_code) + '/delivery/source',
        '/api/import-sources/' + budget1Source.id + '/file'];
      for (const reqPath of paths) assert.equal((await httpRaw(null, reqPath)).status, 401, reqPath);
    });
    await checkAsync('IS-HTTP-SOURCE-BUDGET-PERMISSION', '预算来源 owner/支持组/admin 200，非owner财务/PM403', async () => {
      assert.equal((await httpRaw(tokens.sales, '/api/budget/' + budget1.id + '/source')).status, 200);
      assert.equal((await httpRaw(tokens.support, '/api/budget/' + budget1.id + '/source')).status, 200);
      assert.equal((await httpRaw(tokens.admin, '/api/budget/' + budget1.id + '/source')).status, 200);
      assert.equal((await httpRaw(tokens.finance, '/api/budget/' + budget1.id + '/source')).status, 403);
      assert.equal((await httpRaw(tokens.pm, '/api/budget/' + budget1.id + '/source')).status, 403);
    });
    await checkAsync('IS-HTTP-SOURCE-OPP-PERMISSION', '商机来源建档人/PM/支持组/admin 200，普通非建档财务403', async () => {
      const reqPath = '/api/opp/' + encodeURIComponent(standaloneOpp.opp_code) + '/delivery/source';
      assert.equal((await httpRaw(tokens.sales, reqPath)).status, 200);
      assert.equal((await httpRaw(tokens.pm, reqPath)).status, 200);
      assert.equal((await httpRaw(tokens.support, reqPath)).status, 200);
      assert.equal((await httpRaw(tokens.admin, reqPath)).status, 200);
      assert.equal((await httpRaw(tokens.finance, reqPath)).status, 403);
    });
    await checkAsync('IS-HTTP-SOURCE-ADMIN-DELIVERY', 'admin 可读预算级与商机级交付来源', async () => {
      const budgetPath = '/api/budget/' + unlinkedBudget.id + '/delivery/source';
      const oppPath = '/api/opp/' + encodeURIComponent(standaloneOpp.opp_code) + '/delivery/source';
      assert.equal((await httpRaw(tokens.admin, budgetPath)).status, 200);
      assert.equal((await httpRaw(tokens.admin, oppPath)).status, 200);
    });

    await checkAsync('IS-HTTP-DOWNLOAD-BUDGET-BYTES', '预算原件以 Bearer 下载，中文 RFC5987 文件名与上传字节 SHA256 一致', async () => {
      const reqPath = '/api/import-sources/' + budget1Source.id + '/file';
      assert.ok(!reqPath.includes('?') && !/token|bearer/i.test(reqPath), 'source id URL 不得承载 token');
      const response = await httpRaw(tokens.sales, reqPath, 'GET', undefined, true);
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'] || '', /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
      assert.ok((response.headers['content-disposition'] || '').includes("filename*=UTF-8''" + encodeURIComponent(budgetName1)));
      assert.equal(sha256(response.buffer), sha256(b1Bytes));
    });
    await checkAsync('IS-HTTP-DOWNLOAD-BUDGET-PERMISSION', '预算下载 owner/支持组/admin 200、非owner财务403且未知id404', async () => {
      const reqPath = '/api/import-sources/' + budget1Source.id + '/file';
      assert.equal((await httpRaw(tokens.support, reqPath, 'GET', undefined, true)).status, 200);
      assert.equal((await httpRaw(tokens.admin, reqPath, 'GET', undefined, true)).status, 200);
      assert.equal((await httpRaw(tokens.finance, reqPath, 'GET', undefined, true)).status, 403);
      assert.equal((await httpRaw(tokens.sales, '/api/import-sources/999999999/file', 'GET', undefined, true)).status, 404);
    });
    await checkAsync('IS-HTTP-DOWNLOAD-REVIEW-PERMISSION', '评审原件任意登录用户可下载且字节不变', async () => {
      for (const token of [tokens.finance, tokens.admin]) {
        const response = await httpRaw(token, '/api/import-sources/' + review1.source.id + '/file', 'GET', undefined, true);
        assert.equal(response.status, 200); assert.equal(sha256(response.buffer), sha256(reviewBytes));
      }
    });
    await checkAsync('IS-HTTP-DOWNLOAD-NUMERIC-FILENAME', '原文件名合法数字前缀不被误删', async () => {
      const response = await httpRaw(tokens.admin, '/api/import-sources/' + historyReview.source.id + '/file', 'GET', undefined, true);
      assert.equal(response.status, 200);
      assert.ok((response.headers['content-disposition'] || '').includes("filename*=UTF-8''" + encodeURIComponent(historyName)));
    });
    await checkAsync('IS-HTTP-DOWNLOAD-ADMIN-DELIVERY', 'admin 可下载预算级与商机级交付原件且字节不变', async () => {
      for (const source of [unlinkedSource, standaloneSource]) {
        const response = await httpRaw(tokens.admin, '/api/import-sources/' + source.id + '/file', 'GET', undefined, true);
        assert.equal(response.status, 200); assert.equal(sha256(response.buffer), sha256(realBytes));
      }
    });
    await checkAsync('IS-HTTP-BUDGET-OLD-BYTES', '后续预算导入不覆盖第一份原件字节', async () => {
      const response = await httpRaw(tokens.sales, '/api/import-sources/' + budget1Source.id + '/file', 'GET', undefined, true);
      assert.equal(response.status, 200); assert.equal(sha256(response.buffer), sha256(b1Bytes));
    });
    await checkAsync('IS-HTTP-DOWNLOAD-FILENAME-SAFE', '下载回退文件名剔除引号/控制字符且 RFC5987 保留原中文名', async () => {
      const response = await httpRaw(tokens.sales, '/api/import-sources/' + budget2Source.id + '/file', 'GET', undefined, true);
      assert.equal(response.status, 200);
      const disposition = response.headers['content-disposition'] || '';
      assert.ok(disposition.includes("filename*=UTF-8''" + encodeURIComponent(budgetName2)));
      const fallback = disposition.match(/filename="([^"]*)"/)?.[1];
      assert.ok(fallback && !/["\x00-\x1f\x7f]/.test(fallback), disposition);
      assert.ok(!/[\r\n]/.test(disposition), disposition);
    });

    await checkAsync('IS-HTTP-CROSS-OWNER-SETUP', '预算 owner 可经预算端点导入他人建档商机的 delivery_opp', async () => {
      crossOpp = await createOpp(tokens.finance, 'PL-IS-CROSS-' + nonce, 'IS跨owner商机-' + nonce);
      crossBudget = await createBudget(tokens.sales, 'IS跨owner预算-' + nonce, crossOpp.opp_code);
      const imported = await httpApi(tokens.sales, '/api/budget/' + crossBudget.id + '/delivery/import', 'POST',
        upload('IS跨owner交付-' + nonce + '.xlsx', realBytes));
      crossSource = imported.source;
      assertMeta(crossSource, 'IS跨owner交付-' + nonce + '.xlsx');
    });
    await checkAsync('IS-HTTP-CROSS-OWNER-READ', '关联预算 owner 可读 delivery source，但不能由预算所有权扩张商机直读', async () => {
      const budgetRead = await httpRaw(tokens.sales, '/api/budget/' + crossBudget.id + '/delivery/source');
      assert.equal(budgetRead.status, 200); assert.equal(budgetRead.data.source.id, crossSource.id);
      assert.equal((await httpRaw(tokens.sales, '/api/opp/' + encodeURIComponent(crossOpp.opp_code) + '/delivery/source')).status, 403);
    });
    await checkAsync('IS-HTTP-CROSS-OWNER-DOWNLOAD', 'delivery_opp 下载按商机创建者/PM/支持组判权，不按关联预算 owner', async () => {
      const reqPath = '/api/import-sources/' + crossSource.id + '/file';
      assert.equal((await httpRaw(tokens.sales, reqPath, 'GET', undefined, true)).status, 403);
      for (const token of [tokens.finance, tokens.pm, tokens.support]) {
        const response = await httpRaw(token, reqPath, 'GET', undefined, true);
        assert.equal(response.status, 200); assert.equal(sha256(response.buffer), sha256(realBytes));
      }
    });

    await checkAsync('IS-HTTP-VERSION-LOCK', '真实确认交付+完整预算锁定流程可派生版本', async () => {
      const confirmed = await httpRaw(tokens.sales, '/api/opp/' + encodeURIComponent(fixture.budgetCode) + '/delivery/confirm', 'POST', {});
      assert.equal(confirmed.status, 200, String(confirmed.data?.error || ''));
      const locked = await httpRaw(tokens.sales, '/api/budget/' + budget1.id + '/lock', 'POST', {});
      assert.equal(locked.status, 200, String(locked.data?.error || ''));
      childBudget = await httpApi(tokens.sales, '/api/budget/' + budget1.id + '/newversion', 'POST', {});
      assert.equal(childBudget.parent_id, budget1.id); assert.equal(childBudget.status, 'draft');
    });
    await checkAsync('IS-HTTP-VERSION-INHERITED', '派生预算详情/source 继承父来源元信息并披露 inherited_from', async () => {
      const detail = await httpApi(tokens.sales, '/api/budget/' + childBudget.id);
      assert.equal(detail.budget.import_source.id, budget1Source.id);
      assert.equal(detail.budget.import_source.inherited_from, budget1.id);
      const source = await httpApi(tokens.sales, '/api/budget/' + childBudget.id + '/source');
      assert.equal(source.source.id, budget1Source.id); assert.equal(source.source.inherited_from, budget1.id);
    });
    await checkAsync('IS-HTTP-VERSION-CURRENT', '派生预算编辑后仍以父导入快照对照子当前值', async () => {
      await httpApi(tokens.sales, '/api/budget/' + childBudget.id, 'PUT', { fields: { contract: 260000 } });
      const source = await httpApi(tokens.sales, '/api/budget/' + childBudget.id + '/source');
      const row = comparisonRow(source, 'contract');
      assert.equal(row.raw, 240000); assert.equal(row.imported, 240000); assert.equal(row.current, 260000);
      assert.equal(row.status, '已修改'); assert.equal(source.source.inherited_from, budget1.id);
    });
  } finally {
    for (const file of generated) { try { fs.unlinkSync(file); } catch (e) {} }
    try { fs.rmdirSync(fixture.dir); } catch (e) {}
  }
}

function finalize() {
  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  log('\n' + summary);
  const logArg = process.argv.find(arg => arg.startsWith('--log='));
  if (logArg) {
    try { fs.writeFileSync(path.resolve(logArg.slice(6)), LOG.join('\n') + '\n', 'utf8'); }
    catch (e) { fail++; console.error('FAIL - IS-LOG UTF-8 日志写入失败 | ' + e.message); }
  }
  process.exitCode = fail === 0 ? 0 : 1;
}

async function main() {
  try {
    runPure();
    checkCleanup();
    checkSynthetic();
    checkPresale();
    checkAdoptedLabels();
    checkImportSource();
    if (!PURE_ONLY) await runHttp();
  } catch (e) {
    check('IS-RUNNER', '套件执行无未处理异常', () => { throw e; });
  } finally {
    finalize();
  }
}

main().catch(e => {
  check('IS-MAIN', '异步 runner 无未处理拒绝', () => { throw e; });
  finalize();
});
