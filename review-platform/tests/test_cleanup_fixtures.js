'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const ROOT = path.join(__dirname, '..');
const SDD = path.resolve(ROOT, '../.superpowers/sdd/2026-10-20-business-flow-remediation');
const TOOL = path.join(ROOT, 'tools/cleanup_fixtures.js');
const SNAP = path.join(SDD, 'db/rm_http.db');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const LOG = [];
let pass = 0, fail = 0;
function check(name, ok) { LOG.push((ok ? 'PASS' : 'FAIL') + ' - ' + name); ok ? pass++ : fail++; }
const work = fs.mkdtempSync(path.join(SDD, 'cleanup-test-'));
const realCodes = ['PL00007297', 'PL00008330', 'PL00006204', 'PL00008026', 'PL00008210', 'PL00008314', 'PL00008572'];
function rows(file) {
  const d = new DatabaseSync(file, { readOnly: true });
  const out = {};
  for (const { name } of d.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all())
    out[name] = d.prepare(`SELECT rowid AS __rowid,* FROM "${name}" ORDER BY rowid`).all();
  d.close(); return out;
}
function setup(name) {
  const dir = path.join(work, name); fs.mkdirSync(dir);
  const db = path.join(dir, 'review.db'); fs.copyFileSync(SNAP, db);
  return { dir, db, ids: path.join(dir, 'ids.json'), evidence: path.join(dir, 'evidence.txt'), abort: path.join(dir, 'abort.txt') };
}
function run(a, apply = false) {
  return spawnSync(process.execPath, [TOOL, '--db=' + a.db, '--id-list=' + a.ids, '--evidence=' + a.evidence, '--abort=' + a.abort, apply ? '--apply' : '--dry-run'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
}
try {
  if (!fs.existsSync(TOOL)) {
    check('DG-00 清理工具尚不存在，受保护删除能力未实现', false);
  } else {
    const a = setup('golden'), before = rows(a.db), originalSha = sha(a.db);
    const dry = run(a);
    check('DG-00 dry-run 成功且数据库逐字节未变', dry.status === 0 && sha(a.db) === originalSha && fs.existsSync(a.ids) && !fs.existsSync(a.evidence));
    if (dry.status !== 0) throw new Error('dry-run: ' + dry.stderr);
    const list = JSON.parse(fs.readFileSync(a.ids, 'utf8'));
    check('DG-00 显式删除清单不含真实评审预算商机', !list.delete.reviews.includes(1) && !list.delete.budgets.includes(1) && realCodes.every(c => !list.delete.opps.includes(c) && !list.delete.opp_delivery.includes(c)));
    const applied = run(a, true), after = rows(a.db);
    check('DG-01 按清单删除成功并保留目标计数', applied.status === 0 && Object.entries({ opps: 7, opp_delivery: 7, reviews: 6, budgets: 6, budget_delivery: 0, robot_outbox: 0, tasks: 55, agent_messages: 18, users: 10, settings: 20, llm_calls: 41 }).every(([t, n]) => after[t].length === n));
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    for (const t of ['reviews', 'budgets', 'opps', 'opp_delivery', 'tasks', 'events', 'attachments', 'agent_messages']) {
      const keep = before[t].filter(r => t === 'reviews' || t === 'budgets' ? r.id <= 6 : t === 'opps' || t === 'opp_delivery' ? realCodes.includes(r.opp_code) : t === 'agent_messages' ? (r.review_id >= 1 && r.review_id <= 6) || (r.budget_id >= 1 && r.budget_id <= 6) : r.review_id >= 1 && r.review_id <= 6);
      check('DG-06 ' + t + ' 保留行每个字段与快照一致', same(after[t], keep));
    }
    for (const t of Object.keys(before).filter(t => !(t in list.delete)))
      check('DG-01 不在清单中的 ' + t + ' 全表指纹未变', same(before[t], after[t]));
    check('DG-02 证据包含删除前后每表指纹与哈希', fs.existsSync(a.evidence) && /"before"/.test(fs.readFileSync(a.evidence, 'utf8')) && /"after"/.test(fs.readFileSync(a.evidence, 'utf8')));
    for (const [n, sql] of [['review', 'DELETE FROM reviews WHERE id=6'], ['budget', 'DELETE FROM budgets WHERE id=6'], ['opp', "DELETE FROM opps WHERE opp_code='PL00008572'"], ['delivery', "DELETE FROM opp_delivery WHERE opp_code='PL00008572'"]]) {
      const b = setup('missing-' + n), d = new DatabaseSync(b.db); d.exec(sql); d.close();
      const old = sha(b.db), r = run(b);
      check('DG-00 缺真实' + n + '中止，零数据库写入且不碰正式证据', r.status === 3 && sha(b.db) === old && fs.existsSync(b.abort) && !fs.existsSync(b.ids) && !fs.existsSync(b.evidence));
    }
    const b = setup('tamper-list'); run(b);
    const changed = JSON.parse(fs.readFileSync(b.ids, 'utf8')); changed.delete.reviews.push(1);
    fs.writeFileSync(b.ids, JSON.stringify(changed), 'utf8');
    const bsha = sha(b.db), br = run(b, true);
    check('DG-00 清单混入真实评审时中止且数据库未变', br.status === 3 && sha(b.db) === bsha && !fs.existsSync(b.evidence));
    const c = setup('changed-db'); run(c);
    const d = new DatabaseSync(c.db); d.exec('DELETE FROM robot_outbox WHERE id=(SELECT MIN(id) FROM robot_outbox)'); d.close();
    const csha = sha(c.db), cr = run(c, true);
    check('DG-00 dry-run 后库有漂移时拒绝 apply 且数据库未变', cr.status === 3 && sha(c.db) === csha && !fs.existsSync(c.evidence));
    for (const [name, sql, reason] of [
      ['new-null-review', "INSERT INTO reviews(type,title,form_json) VALUES('presale','未确认归属的真实草稿','{}')", 'unapproved deletion count for reviews'],
      ['null-event', "INSERT INTO events(review_id,action,actor,detail) VALUES(NULL,'档案人工修正','测试','未确认归属的商机事件')", 'unapproved retained ownership for events']
    ]) {
      const x = setup(name), db = new DatabaseSync(x.db); db.exec(sql); db.close();
      const old = sha(x.db), r = run(x);
      check('DG-00 ' + name + '漂移中止且不删未知真实数据', r.status === 3 && sha(x.db) === old && !fs.existsSync(x.ids) && !fs.existsSync(x.evidence) && fs.existsSync(x.abort) && fs.readFileSync(x.abort, 'utf8').includes(reason));
    }
    check('DG-00 只读快照未被测试改写', sha(SNAP) === originalSha);
  }
} catch (e) { LOG.push('FAIL - CRASH ' + e.message); fail++; }
finally {
  fs.rmSync(work, { recursive: true, force: true });
  LOG.push(`${pass} passed, ${fail} failed -> ${fail ? 'SOME FAIL' : 'ALL PASS'}`);
  const arg = process.argv.find(a => a.startsWith('--log='));
  if (arg) fs.writeFileSync(path.resolve(arg.slice(6)), LOG.join('\n') + '\n', 'utf8');
  console.log(LOG.join('\n'));
}
process.exit(fail ? 1 : 0);
