#!/usr/bin/env node
// 旧单原件补录(Task6, spec §12.1): 为 import_sources 建表之前已导入的预算/评审/交付补写原件来源。
//
// 前提: 必须在 8600 服务停机时运行(本工具不启停服务、不改 config/环境变量/PATH、不联网);
//       由控制方确认无进程占用目标库后执行。默认目标为 data/review.db 与 data/uploads。
// 用法: node tools/backfill_import_sources.js [--db=<sqlite>] [--uploads=<dir>] [--log=<utf8 日志>]
//       [--dry-run] [--allow-gaps] [--review-scope=evidence|coded]
//   --dry-run       只读打开库, 只出计划不写入
//   --allow-gaps    有缺口时仍写入可解析的来源(缺口照常列出, 退出码仍为 1); 默认有缺口则零写入
//   --review-scope  evidence(默认): 只补有 Excel 导入证据(事件/历史附件)的评审; coded: 另含所有带商机代码的评审
// 退出码: 0=无缺口; 1=存在未解决缺口; 2=参数/环境错误(库不存在、python 不可用、写入失败)
//
// 口径(与 server.js 四个导入点同形): 只 INSERT import_sources(backfilled=1), 已有来源的实体跳过;
// 不改任何实体字段/状态/灯态/结论; 导入值=当前解析器重新解析原件后按服务端同口径归一,
// 并在 audit.meta.backfill 明示「重新解析」, 不冒充历史当次解析快照。缺原件/路径越界/代码不符只记缺口, 不猜文件。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { IMPORT_SOURCES_DDL, saveImportSource, resolveImportSourcePath } = require('../import-source.js');
// agent.js 载入无副作用: 顶层只 require child_process/finance.js 并定义常量, 联网 spawn 仅在 extractFields 调用时发生(本工具不调用)
const { mergeDraft, BID_WHITELIST } = require('../agent.js');
const { hasBudgetNumbers } = require('../delivery-rows.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = path.join(ROOT, 'data', 'review.db');
const DEFAULT_UPLOADS = path.join(ROOT, 'data', 'uploads');
const FORM_PARSER = path.join(ROOT, 'tools', 'parse_form_xlsx.py');
const DELIVERY_PARSER = path.join(ROOT, 'tools', 'parse_delivery_xlsx.py');
const PREREQ = '前提: 8600 服务必须已停机(本工具不启停服务、不改配置/环境、不联网), 由控制方确认无进程占用目标库';
const BACKFILL_NOTE = '补录来源：导入值按当前解析器重新解析原件得出，非历史当次导入快照';

// server.js:708 num 与 :423 cleanDeliveryRows 同口径(八字段; cost 依赖计价设置, 非比较字段, 不补算)
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };
const cleanDeliveryRows = rows => (Array.isArray(rows) ? rows : []).map(r => ({
  content: String(r.content || '').slice(0, 200),
  stage: r.stage === '运维' ? '运维' : '实施',
  pm_pd: Math.max(0, num(r.pm_pd) || 0), own_pd: Math.max(0, num(r.own_pd) || 0),
  rd_pd: Math.max(0, num(r.rd_pd) || 0), prod_pd: Math.max(0, num(r.prod_pd) || 0),
  travel_cost: Math.max(0, num(r.travel_cost) || 0),
  note: String(r.note || '').slice(0, 500)
})).filter(hasBudgetNumbers);
// server.js:1581 评审导入毛利率归一化同口径
function reviewForm(fields) {
  const form = mergeDraft(fields, {}, { whitelist: BID_WHITELIST });
  if (form.gross_margin !== undefined && form.gross_margin > 0 && form.gross_margin < 1) form.gross_margin = Math.round(form.gross_margin * 10000) / 100;
  return form;
}
const REVIEW_SHEET = type => type === 'bid' ? '投标决策' : (type === 'presale' ? '售前立项' : ''); // server.js:1574 同口径

// 系统前缀: 旧版 Date.now()+'_' 与新版 writeUniqueUpload 的 UUID+'_'
const PREFIX_RE = /^(?:\d{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(.+)$/i;
const originalName = safe => { const m = String(safe).match(PREFIX_RE); return m ? m[1] : String(safe); };
const uploadMs = safe => { const m = String(safe).match(/^(\d{10,})_./); const n = m ? Number(m[1]) : NaN; return Number.isSafeInteger(n) ? n : null; };
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameHasCode = (name, code) => new RegExp('(?:^|[^A-Za-z0-9])' + escRe(code) + '(?![A-Za-z0-9])').test(name);

class Fatal extends Error {}

function parseArgs(argv) {
  const opts = { db: DEFAULT_DB, uploads: DEFAULT_UPLOADS, log: null, dryRun: false, allowGaps: false, reviewScope: 'evidence' };
  for (const a of argv) {
    if (a.startsWith('--db=')) opts.db = a.slice(5);
    else if (a.startsWith('--uploads=')) opts.uploads = a.slice(10);
    else if (a.startsWith('--log=')) opts.log = a.slice(6);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--allow-gaps') opts.allowGaps = true;
    else if (a.startsWith('--review-scope=')) opts.reviewScope = a.slice(15);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Fatal('未知参数: ' + a);
  }
  if (!['evidence', 'coded'].includes(opts.reviewScope)) throw new Fatal('--review-scope 只能是 evidence 或 coded');
  opts.db = path.resolve(opts.db);
  opts.uploads = path.resolve(opts.uploads);
  return opts;
}

// 上传目录内相对路径: 只接受 <dir>/<单层文件名>, resolve 后必须仍在 uploads/<dir> 下且为真实文件
function locate(uploads, dir, safe) {
  const s = String(safe || '');
  if (!s || s === '.' || s === '..' || /[\\/]/.test(s) || path.basename(s) !== s) return { error: '原件路径非法/越界: ' + s };
  const rel = dir + '/' + s;
  const abs = resolveImportSourcePath(uploads, rel);
  if (!abs || path.dirname(abs) !== path.resolve(uploads, dir)) return { error: '原件路径非法/越界: ' + rel };
  let st = null;
  try { st = fs.statSync(abs); } catch (e) { st = null; }
  if (!st || !st.isFile()) return { error: '原件不存在: ' + rel, rel };
  return { rel, abs };
}

function runParser(script, abs, args) {
  const r = spawnSync('python', ['-X', 'utf8', script, abs, ...args, '--audit'],
    { encoding: 'utf8', windowsHide: true, shell: false, cwd: ROOT, timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
  if (r.error && r.error.code === 'ENOENT') throw new Fatal('python 不可用(需 Python 3.12 + openpyxl)');
  if (r.error) return { error: '解析器执行失败: ' + r.error.message };
  if (r.status !== 0) return { error: '解析器退出码 ' + r.status + ': ' + String(r.stderr || '').trim().slice(0, 150) };
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch (e) { return { error: '解析输出非 JSON' }; }
  if (!parsed || typeof parsed !== 'object' || parsed.error) return { error: '解析器报错: ' + String(parsed && parsed.error).slice(0, 150) };
  return { parsed };
}

function markReparsed(parsed, script, runAt) {
  parsed.meta = { ...(parsed.meta || {}), backfill: { reparsed: true, note: BACKFILL_NOTE,
    tool: 'tools/backfill_import_sources.js', parser: 'tools/' + path.basename(script), at: runAt } };
  return parsed;
}

function backfill(db, opts, out) {
  const runAt = new Date().toISOString();
  const hasTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_sources'").get();
  const hasSource = (type, key) => hasTable &&
    !!db.prepare('SELECT 1 FROM import_sources WHERE entity_type=? AND entity_key=? LIMIT 1').get(type, String(key));
  const userOf = id => id == null ? null : (db.prepare('SELECT id,name FROM users WHERE id=?').get(id) || null);
  const plans = [], gaps = [], skipped = [], notApplicable = [], inherited = [];
  const gap = (type, key, reason, extra = {}) => { gaps.push({ entity_type: type, entity_key: String(key), reason, ...extra });
    out(`GAP ${type}:${key} ${reason}`); };
  const skip = (type, key) => { skipped.push({ entity_type: type, entity_key: String(key) }); out(`SKIP-EXISTING ${type}:${key} 已有来源, 不追加`); };
  const na = (type, key, reason) => { notApplicable.push({ entity_type: type, entity_key: String(key), reason }); out(`N/A ${type}:${key} ${reason}`); };

  // ---- 预算: assistant 消息 [Excel导入] <safe> -> N 字段 ----
  const msgRe = /^\[Excel导入\] (.+?) -> \d+ 字段/;
  const byBudget = new Map();
  for (const m of db.prepare("SELECT id,budget_id,content FROM agent_messages WHERE role='assistant' AND budget_id IS NOT NULL ORDER BY id DESC").all()) {
    const hit = String(m.content).match(msgRe);
    if (!hit) continue;
    if (!byBudget.has(String(m.budget_id))) byBudget.set(String(m.budget_id), []);
    byBudget.get(String(m.budget_id)).push(hit[1]);
  }
  for (const key of [...byBudget.keys()].sort((a, b) => Number(a) - Number(b))) {
    const budget = db.prepare('SELECT id,owner_id,created_at,opp_code FROM budgets WHERE id=?').get(key);
    if (!budget) { na('budget', key, '导入消息所属预算已不存在'); continue; }
    if (hasSource('budget', key)) { skip('budget', key); continue; }
    let found = null; const misses = [];
    for (const safe of byBudget.get(key)) { // 最近的消息优先, 采用首个真实存在的指名原件
      const loc = locate(opts.uploads, 'import', safe);
      if (loc.error) misses.push(loc.error); else { found = { safe, ...loc }; break; }
    }
    if (!found) { gap('budget', key, misses.join('; ')); continue; }
    if (misses.length) out(`NOTE budget:${key} 更新的导入消息指名原件不可用(${misses.join('; ')}), 采用较早消息指名原件`);
    const pr = runParser(FORM_PARSER, found.abs, ['--type', 'budget']);
    if (pr.error) { gap('budget', key, pr.error, { file_path: found.rel }); continue; }
    if (!Object.keys(pr.parsed.fields || {}).length) { gap('budget', key, '原件未解析到预算字段', { file_path: found.rel }); continue; }
    const imported = mergeDraft(pr.parsed.fields, {}); // server.js:1548 同口径
    const owner = userOf(budget.owner_id);
    plans.push({ entity_type: 'budget', entity_key: key, file_name: originalName(found.safe), file_path: found.rel,
      parsed: markReparsed(pr.parsed, FORM_PARSER, runAt), imported,
      user: { id: budget.owner_id, name: owner ? owner.name : null }, created_at: budget.created_at,
      logInfo: `fields=${Object.keys(imported).length} sheet=${pr.parsed.meta && pr.parsed.meta.sheet}` });
  }
  // 派生版本: 无自身导入消息者沿 parent_id 继承最近原件, 不重复建源
  const planned = new Set(plans.map(p => p.entity_type + ':' + p.entity_key));
  for (const b of db.prepare('SELECT id,parent_id FROM budgets WHERE parent_id IS NOT NULL ORDER BY id').all()) {
    if (byBudget.has(String(b.id)) || hasSource('budget', b.id)) continue;
    const seen = new Set([String(b.id)]);
    let id = b.parent_id, from = null;
    while (id != null && !seen.has(String(id))) {
      seen.add(String(id));
      if (hasSource('budget', id) || planned.has('budget:' + id)) { from = String(id); break; }
      const p = db.prepare('SELECT parent_id FROM budgets WHERE id=?').get(id);
      id = p ? p.parent_id : null;
    }
    if (from) { inherited.push({ budget_id: String(b.id), inherited_from: from }); out(`INHERIT budget:${b.id} 沿版本链继承 budget:${from} 的原件, 不重复建源`); }
  }

  // ---- 评审: 同商机代码且上传时间≤创建时间的最新 import 原件, 重解析核码 ----
  const importDir = path.resolve(opts.uploads, 'import');
  let importFiles = [];
  try {
    importFiles = fs.readdirSync(importDir, { withFileTypes: true }).filter(d => d.isFile())
      .map(d => ({ safe: d.name, ms: uploadMs(d.name) })).filter(f => f.ms != null);
  } catch (e) { importFiles = []; }
  const evidence = db.prepare(`SELECT 1 FROM events WHERE review_id=? AND ((action='保存草稿' AND detail LIKE 'Excel 导入%') OR action='历史数据导入')
    UNION ALL SELECT 1 FROM attachments WHERE review_id=? AND field='历史评审表原件' LIMIT 1`);
  for (const rv of db.prepare('SELECT id,type,opp_code,applicant_id,applicant_name,created_at FROM reviews ORDER BY id').all()) {
    const key = String(rv.id);
    const code = String(rv.opp_code || '').trim();
    const hasEvidence = !!evidence.get(rv.id, rv.id);
    if (!hasEvidence && !(opts.reviewScope === 'coded' && code)) {
      if (code) na('review', key, '无 Excel 导入证据(事件/历史附件), 非导入建单');
      continue;
    }
    if (hasSource('review', key)) { skip('review', key); continue; }
    if (!code) { gap('review', key, '单据无商机代码, 无法按码定位原件'); continue; }
    const createdMs = Date.parse(rv.created_at);
    if (!Number.isFinite(createdMs)) { gap('review', key, '单据创建时间不可解析: ' + rv.created_at); continue; }
    const cands = importFiles.filter(f => f.ms <= createdMs && nameHasCode(originalName(f.safe), code))
      .sort((a, b) => b.ms - a.ms || (a.safe < b.safe ? 1 : -1));
    if (!cands.length) { gap('review', key, `无上传时间≤创建时间且文件名含 ${code} 的 import 原件`); continue; }
    const loc = locate(opts.uploads, 'import', cands[0].safe);
    if (loc.error) { gap('review', key, loc.error); continue; }
    const pr = runParser(FORM_PARSER, loc.abs, ['--type', 'review', '--sheet', REVIEW_SHEET(rv.type)]);
    if (pr.error) { gap('review', key, pr.error, { file_path: loc.rel }); continue; }
    const fileCode = String((pr.parsed.fields || {}).opp_code || '').trim();
    if (fileCode !== code) { // 不回退猜更早文件
      gap('review', key, `商机代码不匹配: 原件 ${loc.rel} 解析为 ${fileCode || '(空)'}, 单据为 ${code}`, { file_path: loc.rel });
      continue;
    }
    const imported = reviewForm(pr.parsed.fields);
    const applicant = userOf(rv.applicant_id);
    plans.push({ entity_type: 'review', entity_key: key, file_name: originalName(cands[0].safe), file_path: loc.rel,
      parsed: markReparsed(pr.parsed, FORM_PARSER, runAt), imported,
      user: { id: rv.applicant_id, name: applicant ? applicant.name : (rv.applicant_name || null) }, created_at: rv.created_at,
      logInfo: `fields=${Object.keys(imported).length} opp_code=${code} sheet=${pr.parsed.meta && pr.parsed.meta.sheet}` });
  }

  // ---- 交付: 只认实体 source_file 指名原件 ----
  const deliveryPlan = (type, key, sourceFile, user, fallbackAt) => {
    const sf = String(sourceFile || '').trim();
    if (!sf) { na(type, key, 'source_file 为空(在线编制, 非导入)'); return; }
    if (hasSource(type, key)) { skip(type, key); return; }
    const safe = sf.startsWith('delivery/') ? sf.slice('delivery/'.length) : sf;
    const loc = locate(opts.uploads, 'delivery', safe);
    if (loc.error) { gap(type, key, loc.error); return; }
    const pr = runParser(DELIVERY_PARSER, loc.abs, []);
    if (pr.error) { gap(type, key, pr.error, { file_path: loc.rel }); return; }
    const rows = cleanDeliveryRows(pr.parsed.rows);
    if (!rows.length) { gap(type, key, `原件无有预算数字的明细行(剔除 ${(pr.parsed.skipped_rows || []).length} 行)`, { file_path: loc.rel }); return; }
    const ms = uploadMs(safe);
    plans.push({ entity_type: type, entity_key: key, file_name: originalName(safe), file_path: loc.rel,
      parsed: markReparsed(pr.parsed, DELIVERY_PARSER, runAt), imported: rows, user,
      created_at: ms != null ? new Date(ms).toISOString() : (fallbackAt || null),
      logInfo: `rows=${rows.length} skipped=${(pr.parsed.skipped_rows || []).length} sheet=${pr.parsed.meta && pr.parsed.meta.sheet}` });
  };
  for (const d of db.prepare('SELECT opp_code,source_file,owner_id,created_at,updated_at FROM opp_delivery ORDER BY opp_code').all()) {
    let uid = d.owner_id; // 最后写入者; 缺失时回落商机建档人
    if (uid == null) { const o = db.prepare('SELECT created_by FROM opps WHERE opp_code=?').get(d.opp_code); uid = o ? o.created_by : null; }
    const u = userOf(uid);
    deliveryPlan('delivery_opp', String(d.opp_code), d.source_file, { id: uid ?? null, name: u ? u.name : null }, d.updated_at || d.created_at);
  }
  for (const d of db.prepare('SELECT budget_id,source_file,created_at,updated_at FROM budget_delivery ORDER BY budget_id').all()) {
    const b = db.prepare('SELECT owner_id FROM budgets WHERE id=?').get(d.budget_id);
    if (!b && String(d.source_file || '').trim()) { gap('delivery_budget', String(d.budget_id), '所属预算不存在, 无法确定导入者'); continue; }
    const u = b ? userOf(b.owner_id) : null;
    deliveryPlan('delivery_budget', String(d.budget_id), d.source_file, { id: b ? b.owner_id : null, name: u ? u.name : null }, d.updated_at || d.created_at);
  }

  for (const p of plans) out(`ADOPT ${p.entity_type}:${p.entity_key} file=${p.file_path} ${p.logInfo} importer=${p.user && p.user.id} created_at=${p.created_at}`);

  // ---- 写入: 单事务, 只 INSERT; 有缺口默认零写入 ----
  let inserted = 0;
  const byType = {};
  const write = !opts.dryRun && plans.length && (!gaps.length || opts.allowGaps);
  if (write) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(IMPORT_SOURCES_DDL);
      for (const p of plans) {
        if (db.prepare('SELECT 1 FROM import_sources WHERE entity_type=? AND entity_key=? LIMIT 1').get(p.entity_type, p.entity_key)) continue;
        const row = saveImportSource(db, { entity_type: p.entity_type, entity_key: p.entity_key, file_name: p.file_name, file_path: p.file_path,
          parsed: p.parsed, imported: p.imported, user: p.user, created_at: p.created_at, backfilled: 1 });
        out(`INSERTED import_sources#${row.id} ${p.entity_type}:${p.entity_key}`);
        inserted++;
        byType[p.entity_type] = (byType[p.entity_type] || 0) + 1;
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch (e2) {}
      throw new Fatal('写入失败已回滚: ' + e.message);
    }
  } else if (!opts.dryRun && plans.length && gaps.length) {
    out(`HOLD 存在 ${gaps.length} 个缺口, 默认零写入(核实后可用 --allow-gaps 仅写可解析的 ${plans.length} 条)`);
  }
  return { mode: opts.dryRun ? 'dry-run' : 'apply', db: opts.db, uploads: opts.uploads, review_scope: opts.reviewScope,
    planned: plans.length, inserted, by_type: byType,
    planned_by_type: plans.reduce((m, p) => (m[p.entity_type] = (m[p.entity_type] || 0) + 1, m), {}),
    skipped_existing: skipped, inherited, not_applicable: notApplicable, gaps };
}

function main() {
  const lines = [];
  const out = line => { lines.push(line); console.log(line); };
  let code = 0, opts = null;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (opts.help) { out(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).join('\n')); return 0; }
    out(PREREQ);
    out(`目标库=${opts.db} 上传目录=${opts.uploads} 模式=${opts.dryRun ? 'dry-run(只读)' : 'apply'} 评审范围=${opts.reviewScope}`);
    if (!fs.existsSync(opts.db) || !fs.statSync(opts.db).isFile()) throw new Fatal('库文件不存在(不会新建): ' + opts.db);
    if (!fs.existsSync(opts.uploads) || !fs.statSync(opts.uploads).isDirectory()) throw new Fatal('上传目录不存在: ' + opts.uploads);
    const db = new DatabaseSync(opts.db, opts.dryRun ? { readOnly: true } : {});
    let summary;
    try { summary = backfill(db, opts, out); } finally { db.close(); }
    code = summary.gaps.length ? 1 : 0;
    out('SUMMARY ' + JSON.stringify(summary));
  } catch (e) {
    code = 2;
    out('FATAL ' + (e instanceof Fatal ? e.message : (e && e.stack || String(e))));
    out('SUMMARY ' + JSON.stringify({ mode: 'fatal', error: String(e && e.message || e), planned: 0, inserted: 0, gaps: [] }));
  } finally {
    if (opts && opts.log) {
      try { fs.writeFileSync(path.resolve(opts.log), lines.join('\n') + '\n', 'utf8'); }
      catch (e) { console.error('日志写入失败: ' + e.message); code = code || 2; }
    }
  }
  return code;
}

if (require.main === module) process.exitCode = main();
module.exports = { backfill, cleanDeliveryRows, reviewForm, originalName, uploadMs, locate };
