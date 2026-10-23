'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const REAL_DB = path.join(ROOT, 'data/review.db');
const SDD = path.resolve(ROOT, '../.superpowers/sdd/2026-10-20-business-flow-remediation');
const arg = (name, fallback) => process.argv.find(x => x.startsWith('--' + name + '='))?.slice(name.length + 3) || fallback;
const FILE = path.resolve(arg('db', REAL_DB));
const IDFILE = path.resolve(arg('id-list', path.join(ROOT, 'tests/dg_cleanup_idlist.json')));
const EVIDENCE = path.resolve(arg('evidence', path.join(ROOT, 'tests/dg_cleanup_evidence.txt')));
const ABORT = path.resolve(arg('abort', path.join(SDD, 'logs/dg_cleanup_abort.txt')));
const REAL7 = ['PL00007297', 'PL00008330', 'PL00006204', 'PL00008026', 'PL00008210', 'PL00008314', 'PL00008572'];
const TUPLES = [[1, 'bid', REAL7[0], 'returned', 'red', 1], [2, 'presale', REAL7[1], 'archived', 'yellow', 2], [3, 'bid', REAL7[2], 'archived', 'yellow', 3], [4, 'bid', REAL7[3], 'archived', 'yellow', 4], [5, 'bid', REAL7[4], 'archived', 'yellow', 5], [6, 'bid', REAL7[5], 'archived', 'yellow', 6]];
const PK = { reviews: 'id', tasks: 'id', events: 'id', attachments: 'id', agent_messages: 'id', budgets: 'id', budget_delivery: 'budget_id', opps: 'opp_code', opp_delivery: 'opp_code', robot_outbox: 'id' };
const COUNTS = { opps: 7, opp_delivery: 7, reviews: 6, budgets: 6, budget_delivery: 0, robot_outbox: 0, tasks: 55, agent_messages: 18, users: 10, settings: 20, llm_calls: 41 };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const sha = f => hash(fs.readFileSync(f));
function abort(reason) {
  fs.writeFileSync(ABORT, 'ABORT ' + new Date().toISOString() + ' ' + reason + '\n', 'utf8');
  console.error('ABORT ' + reason); process.exitCode = 3;
}
function idle() {
  if (FILE.toLowerCase() !== path.resolve(REAL_DB).toLowerCase()) return;
  const command = "$r=try { Get-NetTCPConnection -LocalPort 8600 -State Listen -ErrorAction Stop } catch { if ($_.FullyQualifiedErrorId -like 'CmdletizationQuery_NotFound*') { @() } else { throw } }; $r | Select-Object -ExpandProperty OwningProcess";
  for (let i = 0; i < 2; i++) {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 60000 }).trim();
    if (out) throw new Error('8600 still listening; stop the task-owned service through guard first');
    if (!i) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
  }
}
function readRows(d) {
  const out = {};
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
    out[name] = d.prepare(`SELECT rowid AS __rowid,* FROM "${name}" ORDER BY rowid`).all();
  return out;
}
function build(all, fileSha, pattern) {
  const re = new RegExp(pattern);
  const fixture = c => typeof c === 'string' && re.test(c);
  const real = c => REAL7.includes(c);
  const keptReviews = all.reviews.filter(r => real(r.opp_code));
  const keptBudgets = all.budgets.filter(r => real(r.opp_code));
  const tuples = keptReviews.map(r => [r.id, r.type, r.opp_code, r.status, r.light, r.budget_id]);
  const keepIds = [1, 2, 3, 4, 5, 6];
  if (!same(tuples, TUPLES)) throw new Error('precondition 1: real reviews or immutable workflow tuples differ');
  if (!same(keptBudgets.map(r => r.id), keepIds) || keptBudgets.some(r => r.status !== 'locked')) throw new Error('precondition 2: six real locked budgets required');
  if (!same(keptBudgets.map(r => r.id), keptReviews.map(r => r.budget_id).sort((a, b) => a - b))) throw new Error('precondition 3: budget references differ');
  if (!same(all.opps.filter(r => real(r.opp_code)).map(r => r.opp_code).sort(), [...REAL7].sort())) throw new Error('precondition 4: seven real opportunities required');
  const delivery = all.opp_delivery.filter(r => real(r.opp_code));
  if (!same(delivery.map(r => r.opp_code).sort(), [...REAL7].sort()) || delivery.some(r => r.status !== 'confirmed') || all.budget_delivery.some(r => keepIds.includes(r.budget_id))) throw new Error('precondition 5: confirmed real delivery and no real budget_delivery required');
  if (all.robot_outbox.some(r => r.sent_at || r.status !== 'preview')) throw new Error('outbox contains non-preview or delivered records; not approved for deletion');
  const reviews = all.reviews.filter(r => !real(r.opp_code) && (fixture(r.opp_code) || !r.opp_code)).map(r => r.id);
  const budgets = all.budgets.filter(r => !real(r.opp_code) && (fixture(r.opp_code) || !r.opp_code)).map(r => r.id);
  const del = {
    reviews,
    tasks: all.tasks.filter(r => reviews.includes(r.review_id)).map(r => r.id),
    events: all.events.filter(r => reviews.includes(r.review_id)).map(r => r.id),
    attachments: all.attachments.filter(r => reviews.includes(r.review_id)).map(r => r.id),
    agent_messages: all.agent_messages.filter(r => reviews.includes(r.review_id) || budgets.includes(r.budget_id)).map(r => r.id),
    budgets,
    budget_delivery: all.budget_delivery.filter(r => budgets.includes(r.budget_id)).map(r => r.budget_id),
    opps: all.opps.filter(r => !real(r.opp_code) && fixture(r.opp_code)).map(r => r.opp_code),
    opp_delivery: all.opp_delivery.filter(r => !real(r.opp_code) && fixture(r.opp_code)).map(r => r.opp_code),
    robot_outbox: all.robot_outbox.map(r => r.id)
  };
  for (const [t, n] of Object.entries(COUNTS)) if (all[t].length - (del[t]?.length || 0) !== n) throw new Error('unapproved retained count for ' + t);
  for (const [t, n] of Object.entries({ reviews: 87, budgets: 92, opps: 43, opp_delivery: 19, robot_outbox: 90 })) if (del[t].length !== n) throw new Error('unapproved deletion count for ' + t);
  for (const t of ['tasks', 'events', 'attachments', 'agent_messages']) if (all[t].some(r => !del[t].includes(r.id) && !keepIds.includes(r.review_id) && !(t === 'agent_messages' && keepIds.includes(r.budget_id)))) throw new Error('unapproved retained ownership for ' + t);
  return { sha256: fileSha, fixtureCodePattern: pattern, preconditions: 5, retainedReviews: tuples, delete: del };
}
function fingerprints(all) {
  return Object.fromEntries(Object.entries(all).map(([t, rows]) => [t, { count: rows.length, sha256: hash(JSON.stringify(rows)) }]));
}
let d, committed = false;
try {
  if (process.argv.includes('--apply') === process.argv.includes('--dry-run')) throw new Error('select exactly one of --dry-run or --apply');
  idle();
  if (['-journal', '-wal', '-shm'].some(s => fs.existsSync(FILE + s))) throw new Error('database journal present');
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const match = source.match(/\nconst FIXTURE_CODE_RE = \/(.+)\/([a-z]*);/);
  if (!match || match[2]) throw new Error('fixture predicate source unavailable or unsupported flags');
  const beforeSha = sha(FILE);
  d = new DatabaseSync(FILE, { readOnly: true });
  const before = readRows(d); d.close(); d = null;
  const list = build(before, beforeSha, match[1]);
  if (process.argv.includes('--dry-run')) {
    fs.writeFileSync(IDFILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
    console.log('DRY-RUN preconditions=5; explicit IDs=' + IDFILE + '; database unchanged=' + (sha(FILE) === beforeSha));
  } else {
    if (!same(JSON.parse(fs.readFileSync(IDFILE, 'utf8')), list)) throw new Error('explicit ID list or database snapshot changed; repeat dry-run and review');
    if (sha(FILE) !== beforeSha) throw new Error('database changed before transaction');
    d = new DatabaseSync(FILE); d.exec('BEGIN IMMEDIATE');
    if (!same(build(readRows(d), beforeSha, match[1]), list)) throw new Error('database rows changed before transaction');
    for (const t of ['robot_outbox', 'agent_messages', 'attachments', 'events', 'tasks', 'budget_delivery', 'reviews', 'budgets', 'opp_delivery', 'opps']) {
      const statement = d.prepare(`DELETE FROM "${t}" WHERE "${PK[t]}"=?`);
      for (const id of list.delete[t]) if (Number(statement.run(id).changes) !== 1) throw new Error('explicit deletion did not affect exactly one row: ' + t);
    }
    const after = readRows(d);
    for (const t of Object.keys(before)) {
      const wanted = before[t].filter(r => !(list.delete[t] || []).includes(r[PK[t]]));
      if (!same(after[t], wanted)) throw new Error('retained rows changed: ' + t);
    }
    d.exec('COMMIT'); committed = true; d.close(); d = null;
    fs.writeFileSync(EVIDENCE, JSON.stringify({ preconditions: 5, fixtureCodePattern: match[1], explicitIds: IDFILE, explicitIdsSha256: sha(IDFILE), sha256: { before: beforeSha, after: sha(FILE) }, retainedReviews: list.retainedReviews, before: fingerprints(before), after: fingerprints(after) }, null, 2) + '\n', 'utf8');
    console.log('DELETE ONLY; preconditions=5; retained rows verified; evidence=' + EVIDENCE);
  }
} catch (e) {
  if (d) { try { d.exec('ROLLBACK'); } catch {} d.close(); }
  if (committed) {
    fs.writeFileSync(ABORT, 'COMMITTED_WITH_EVIDENCE_ERROR ' + e.message + '\n', 'utf8');
    console.error('COMMITTED_WITH_EVIDENCE_ERROR ' + e.message); process.exitCode = 4;
  } else abort(e.message);
}
