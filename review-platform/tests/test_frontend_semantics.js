'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function extract(from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error('source missing: ' + from);
  return src.slice(a, b);
}
const chainSource = extract('const NEXT_ACTION_TEXT =', 'function oppLaunchHtml(') + extract('function oppChainHtml(', 'function oppProfileEdit(');
const chain = vm.runInNewContext(chainSource + '\noppChainHtml;', {});
async function evidence(readOnly, task, failed = false) {
  const elements = { h3: {}, '#evStandards': {}, '#evBox': {} };
  const mask = { isConnected: true, querySelector: s => elements[s] };
  const e = { task: { ind_name: '客户历史欠款', standards: '部门核实', ...task }, review: { id: 1, round: 2 }, computed: [], skipped: [], notTriggered: [], formFacts: [], anchors: [], external: { required: true, hint: '部门自有系统' } };
  const fn = vm.runInNewContext(extract('async function openTask(', 'function pickLight(') + '\nopenTask;', {
    TASK_ID: null, TASK_LIGHT: null, INST: { tasks: [] }, window: {},
    document: { createElement: () => mask, body: { appendChild() {} } },
    api: async () => { if (failed) throw new Error('本机测试错误'); return e; }, esc: v => String(v ?? ''), lightPill: () => ''
  });
  await fn(1, readOnly);
  return { shell: mask.innerHTML, text: elements['#evBox'].textContent || '', html: elements['#evBox'].innerHTML || '' };
}
async function delivery(confirm, refreshFails, writeFails = false) {
  const messages = [], editor = { isConnected: true }, nodes = { '#opdlvTable': editor, '#opdlvPill': {}, '#opdlvConfirmBtn': {} };
  const state = { code: 'PL-RM-SEM', rows: [{ content: '实施' }], status: 'draft', locked: false };
  const context = {
    OPDLV: state, location: { hash: '#/opp/PL-RM-SEM' }, $: s => nodes[s],
    api: async () => { if (writeFails) throw new Error('写入失败'); return { rows: state.rows, sum: { cost: 100 }, rate: 1 }; },
    refreshOppChain: async () => { if (refreshFails) throw new Error('刷新失败'); },
    opdlvRender() {}, pill: label => '<span>' + label + '</span>', toast: (text, level = 0) => messages.push({ text, level })
  };
  const fn = vm.runInNewContext(extract('async function opdlvSave(', 'async function opdlvImport(') + (confirm ? '\nopdlvConfirm;' : '\nopdlvSave;'), context);
  await fn();
  return { messages, state };
}
(async () => {
  const results = [];
  const check = (name, ok) => results.push([name, Boolean(ok)]);
  const d = next_action => ({ chain: { next_action, delivery_confirmed: next_action !== 'confirm_delivery', budget_locked: next_action === 'judged' }, reviews: [{ era: 'online', status: 'archived' }] });
  check('FS-01 已归档但交付回草稿时优先确认交付', chain(d('confirm_delivery')).includes('在「① 交付预算」编制明细并确认') && !chain(d('confirm_delivery')).includes('在线评审已归档'));
  check('FS-02 已归档但预算未锁定时优先锁定预算', chain(d('lock_budget')).includes('在「② 项目预算」锁定预算单') && !chain(d('lock_budget')).includes('在线评审已归档'));
  check('FS-03 链就绪且全归档时仍提示归档', /在线评审已归档/.test(chain(d('judged'))));
  const old = await evidence(true, { status: 'pending', round: 1 });
  check('FS-04 往轮只读证据披露不是当时快照', old.html.includes('以下为当前数据，不是打灯时的快照') && !old.shell.includes('id="pk-g"'));
  const handled = await evidence(true, { status: 'done', round: 2 });
  check('FS-05 已处理任务披露实时证据', handled.html.includes('以下为当前数据，不是打灯时的快照'));
  const current = await evidence(false, { status: 'pending', round: 2 });
  check('FS-06 当前待办保留打灯且不冒称历史快照', current.shell.includes('id="pk-g"') && !current.html.includes('不是打灯时的快照'));
  const readError = await evidence(true, { status: 'done', round: 2 }, true);
  check('FS-07 只读证据失败不指示打灯', readError.text.includes('证据加载失败') && !readError.text.includes('打灯'));
  const writeError = await evidence(false, { status: 'pending', round: 2 }, true);
  check('FS-08 待办证据失败保留部门核实提示', writeError.text.includes('请在部门系统核实后打灯'));
  const saved = await delivery(false, true);
  check('FS-09 保存成功刷新失败仍明确已保存', saved.messages.some(m => m.level === 1 && m.text.includes('已保存，链路状态刷新失败')) && saved.state.status === 'draft');
  const confirmed = await delivery(true, true);
  check('FS-10 确认成功刷新失败仍明确已确认', confirmed.messages.some(m => m.level === 1 && m.text.includes('已确认，链路状态刷新失败')) && confirmed.state.status === 'confirmed');
  const failed = await delivery(false, false, true);
  check('FS-11 写失败不报已保存', failed.messages.length === 1 && failed.messages[0].text === '写入失败' && failed.messages[0].level === 1);
  let profileHtml = '';
  const profile = vm.runInNewContext(extract('function oppProfileEdit(', 'async function oppProfileSave(') + '\noppProfileEdit;', {
    window: { _opp360: { profile_can_edit: true, opp: { biz_line: 'G1 ' } } },
    $: () => ({ set innerHTML(value) { profileHtml = value; } }),
    OPP_FIELDS: ['biz_line'], OPP_F: [{ k: 'biz_line', t: 'select', o: ['G1'] }], OPP_FIELD_NAMES: { biz_line: '业务线' },
    esc: v => String(v ?? ''), document: { querySelectorAll: () => [] }
  });
  profile();
  check('FS-12 未知下拉原值显示标记且value逐字保留', profileHtml.includes('value="G1 " selected>G1 （原值）</option>'));
  const failures = results.filter(r => !r[1]).length;
  const lines = results.map(([name, ok]) => `${ok ? 'PASS' : 'FAIL'} - ${name}`);
  lines.push(`${results.length - failures} passed, ${failures} failed -> ${failures ? 'SOME FAIL' : 'ALL PASS'}`);
  const log = process.argv.find(a => a.startsWith('--log='));
  if (log) fs.writeFileSync(log.slice(6), lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n')); process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
