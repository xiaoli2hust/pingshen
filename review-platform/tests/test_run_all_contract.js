'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, 'run_all.js'), 'utf8');
const run = (result, env = {}) => new Promise((resolve, reject) => {
  let written = '', calls = 0;
  const options = [];
  const timer = setTimeout(() => reject(new Error('runner did not finish')), 3000);
  const context = {
    require: name => {
      if (name === 'child_process') return { spawnSync: (cmd, args, opts) => { options.push(opts); return calls++ === 0 ? result : { status: 0, signal: null, stdout: '1 passed, 0 failed -> ALL PASS\n', stderr: '' }; } };
      if (name === 'path') return path;
      if (name === 'fs') return { writeFileSync: (file, text, encoding) => { if (encoding !== 'utf8') throw new Error('non-UTF8 log'); written = text; } };
      throw new Error('unexpected dependency ' + name);
    },
    __dirname,
    console: { log() {}, error() {} },
    fetch: async () => ({ status: 401 }),
    process: { env, execPath: process.execPath, argv: ['node', 'run_all.js', '--log=controlled.txt'], exit: code => { clearTimeout(timer); resolve({ code, written, calls, options }); } }
  };
  vm.runInNewContext(src, context, { filename: 'run_all.js' });
});
(async () => {
  const DECL = 'NOT EXECUTABLE CH-11b legacy-state G4 mutation coverage gap\n' +
    'NOT EXECUTABLE C2-11-identity same-row era flip identity coverage gap\n' +
    'NOT EXECUTABLE OD-08-inflight history-draft inflight mutation witness gap\n' +
    'NOT EXECUTABLE OD-09-flip literal same-record era flip coverage gap\n';
  const OK = { status: 0, stdout: DECL + '1 passed, 0 failed, 4 NOT EXECUTABLE -> EXECUTED PASS\n', stderr: '' };
  const cases = [
    ['RG-01 全部套件实际完成且四条声明缺口在位才汇总 ALL PASS', OK, 0, 'ALL PASS'],
    ['RG-02 未登记缺口即使不在末六行也禁止全绿', { status: 0, stdout: 'NOT EXECUTABLE XX-99 bogus gap\n' + DECL + 'normal output\n'.repeat(8), stderr: '' }, 1, 'COVERAGE GAP'],
    ['RG-03 stderr 未登记缺口禁止全绿', { status: 0, stdout: DECL + '1 passed, 0 failed -> ALL PASS\n', stderr: 'COVERAGE GAP XX-98 unsupported identity\n' }, 1, 'COVERAGE GAP'],
    ['RG-04 子套件失败仍汇总失败', { status: 1, stdout: '0 passed, 1 failed -> SOME FAIL\n', stderr: '' }, 1, 'SOME FAIL'],
    ['RG-05 超时未完成不能算通过', { status: null, signal: 'SIGTERM', stdout: '', stderr: '' }, 1, 'SOME FAIL'],
    ['RG-06 非行首的 NOT EXECUTABLE 字样不得被误认成缺口', { status: 0, stdout: DECL + 'note: 99 NOT EXECUTABLE counted in prose\n1 passed, 0 failed, 4 NOT EXECUTABLE -> EXECUTED PASS\n', stderr: '' }, 0, 'ALL PASS'],
    ['RG-08 声明缺口消失(见证静默删除或能力恢复)必须红', { status: 0, stdout: '1 passed, 0 failed -> ALL PASS\n', stderr: '' }, 1, 'DECLARED GAP LOST'],
    ['RG-09 全绿日志仍须逐条落声明缺口 id, 禁止读作零覆盖', OK, 0, 'ALL PASS']
  ];
  const lines = [];
  let failed = 0;
  for (const [name, result, code, verdict] of cases) {
    const r = await run(result);
    const ok = r.calls > 0 && r.code === code && r.written.trim().endsWith(verdict) &&
      (name !== 'RG-09' || ['CH-11b', 'C2-11-identity', 'OD-08-inflight', 'OD-09-flip'].every(id => r.written.includes(id)));
    if (!ok) failed++;
    lines.push(`${ok ? 'PASS' : 'FAIL'} - ${name} | exit=${r.code}${ok ? '' : ' last=' + r.written.trim().split('\n').at(-1)}`);
  }
  const guarded = await run(OK, { RP_GUARD_TREE_TIMEOUT: '1' });
  const delegated = guarded.code === 0 && guarded.options.length > 0 && guarded.options.every(o => o.timeout === 0);
  if (!delegated) failed++;
  lines.push(`${delegated ? 'PASS' : 'FAIL'} - RG-07 自有树护栏接管超时，聚合器不得提前只杀测试Node`);
  lines.push(`${cases.length + 1 - failed} passed, ${failed} failed -> ${failed ? 'SOME FAIL' : 'ALL PASS'}`);
  const log = process.argv.find(a => a.startsWith('--log='));
  if (log) fs.writeFileSync(log.slice(6), lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n'));
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
