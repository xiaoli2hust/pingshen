'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const start = src.indexOf('async function renderForm('), end = src.indexOf('// ---- V4.0 T7', start);
if (start < 0 || end < 0) throw new Error('renderForm source missing');
async function render(editId, budgetId, listed) {
  const calls = [], nodes = {};
  const node = () => ({ value: '', textContent: '', dataset: {}, isConnected: true, addEventListener() {} });
  for (const id of ['f_budget', 'f_title', 'nextBtn', 'budgetGate', 'readyBar']) nodes['#' + id] = node();
  nodes['#readyBar'].isConnected = false;
  let html = '';
  nodes['#page'] = {
    querySelectorAll: () => [],
    set innerHTML(value) {
      html = value;
      const select = /<select id="f_budget"[^>]*>([\s\S]*?)<\/select>/.exec(value)[1];
      const selected = [...select.matchAll(/<option value="([^"]*)"([^>]*)>/g)].find(m => /\bselected\b/.test(m[2]));
      nodes['#f_budget'].value = selected ? selected[1] : '';
      nodes['#nextBtn'].disabled = /<button[^>]*id="nextBtn"[^>]*\bdisabled\b/.test(value);
      nodes['#f_title'].value = /<input id="f_title" value="([^"]*)"/.exec(value)[1];
    }
  };
  const context = {
    $: selector => nodes[selector], document: { querySelector: () => null }, window: {}, EDIT_ID: null,
    FIELDS: { bid: [] }, META: { bid: [] }, TYPE_NAMES: { bid: '投标决策' },
    esc: v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    prefillHint: () => '', pill: () => '', toast() {},
    api: async url => {
      calls.push(url);
      if (url.startsWith('/api/reviews/')) return { review: { type: 'bid', title: '已有草稿', form_json: '{}', budget_id: budgetId, opp_code: 'PL-RM-N1' } };
      if (url.includes('/prefill?')) return { fields: {} };
      throw new Error('unexpected api ' + url);
    },
    apiCached: async url => {
      calls.push(url);
      if (url === '/api/budget') return { budgets: listed };
      if (url === '/api/budget/' + budgetId) return { budget: { id: budgetId, code: 'B-' + budgetId, status: 'locked', fields: {}, opp_code: 'PL-RM-N1' } };
      throw new Error('unexpected apiCached ' + url);
    }
  };
  const fn = vm.runInNewContext(src.slice(start, end) + '\nrenderForm;', context);
  await fn('bid', editId, 'PL-RM-N1', budgetId);
  return { html, value: nodes['#f_budget'].value, disabled: nodes['#nextBtn'].disabled, calls };
}
(async () => {
  const own = { id: 11, code: 'B-11', status: 'locked', version: 1 };
  const open = { id: 12, code: 'B-12', status: 'draft', version: 1 };
  const cases = [
    ['BP-01 新建不预选列表外预算且不拉其详情', null, 99, [own], r => r.value === '' && r.disabled && !r.calls.includes('/api/budget/99') && !r.html.includes('当前关联')],
    ['BP-02 新建列表外预算明确提示重新选择', null, 99, [own], r => r.html.includes('该预算单不在你的已锁定列表')],
    ['BP-03 新建本人已锁预算仍自动选中', null, 11, [own], r => r.value === '11' && !r.disabled && r.calls.includes('/api/budget/11')],
    ['BP-04 编辑列表外当前关联仍逐字保留', 7, 99, [own], r => r.value === '99' && r.html.includes('当前关联') && r.html.includes('data-orig="99"')],
    ['BP-05 新建未锁预算不预选', null, 12, [own, open], r => r.value === '' && r.disabled && !r.calls.includes('/api/budget/12')],
    ['BP-06 编辑当前未锁预算仍保留', 7, 12, [own, open], r => r.value === '12' && r.html.includes('当前关联')]
  ];
  const lines = []; let failed = 0;
  for (const [name, edit, id, list, assertion] of cases) {
    const r = await render(edit, id, list), ok = assertion(r);
    if (!ok) failed++;
    lines.push(`${ok ? 'PASS' : 'FAIL'} - ${name} | selected=${r.value || 'empty'}, disabled=${r.disabled}`);
  }
  lines.push(`${cases.length - failed} passed, ${failed} failed -> ${failed ? 'SOME FAIL' : 'ALL PASS'}`);
  const log = process.argv.find(a => a.startsWith('--log='));
  if (log) fs.writeFileSync(log.slice(6), lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n')); process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
