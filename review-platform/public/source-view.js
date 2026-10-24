(() => {
  'use strict';

  const states = new Map();
  const mountRequests = new WeakMap();
  const maxStates = 24;
  let instance = 0;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const sessionGeneration = () => window._apiSessionGeneration || 0;
  const dataGeneration = () => window._apiGeneration || 0;
  const valid = state => state && state.session === sessionGeneration() && state.generation === dataGeneration();
  const remember = (url, state) => {
    states.delete(url);
    states.set(url, state);
    while (states.size > maxStates) states.delete(states.keys().next().value);
  };
  const currentState = url => {
    const state = states.get(url);
    if (valid(state)) remember(url, state);
    return state;
  };
  const letters = index => {
    let result = '';
    for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
    return result;
  };
  const positions = row => [...(row.positions || []), ...(row.lab_positions || []), ...(row.val_positions || [])]
    .filter(position => Array.isArray(position) && position.length >= 2);
  const statusClass = status => {
    if (status === '一致') return 'is-same';
    if (/修改|差异|删除|剔除|拒绝/.test(status || '')) return 'is-diff';
    if (/换算|新建|补录/.test(status || '')) return 'is-change';
    return 'is-muted';
  };
  const cellValue = cell => cell && cell[2];

  function errorData(error) {
    return { __error: true, message: error && error.message ? error.message : '原表来源读取失败' };
  }

  function currentCached(url) {
    const state = currentState(url);
    return valid(state) && state.status === 'success' ? clone(state.data) : null;
  }

  async function load(mountId, url) {
    const mount = document.getElementById(mountId);
    if (!mount) return null;
    const request = Symbol(url);
    const owner = mount.dataset.srcvOwner || `${location.hash}|${Date.now()}|${Math.random()}`;
    mount.dataset.srcvOwner = owner;
    mountRequests.set(mount, request);
    mount.dataset.sourceUrl = url;
    mount.innerHTML = '<div class="srcv srcv-loading"><div class="srcv-empty">正在装载原表证据…</div></div>';
    const capturedHash = location.hash;
    const generation = dataGeneration();
    const session = sessionGeneration();
    try {
      const data = await window.apiCached(url, true);
      if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'source')) {
        if (window._pgCache) delete window._pgCache[url];
        throw new Error('原表来源响应格式无效');
      }
      if (generation !== dataGeneration() || session !== sessionGeneration()) return null;
      remember(url, { status: 'success', data: clone(data), generation, session });
      if (!mount.isConnected || document.getElementById(mountId) !== mount || mountRequests.get(mount) !== request
        || mount.dataset.srcvOwner !== owner || location.hash !== capturedHash) return data;
      paint(mountId, data);
      return data;
    } catch (error) {
      if ((error && error.code === 'STALE_RESPONSE') || generation !== dataGeneration() || session !== sessionGeneration()) return null;
      const settled = errorData(error);
      remember(url, { status: 'error', data: settled, generation, session });
      if (mount.isConnected && document.getElementById(mountId) === mount && mountRequests.get(mount) === request
        && mount.dataset.srcvOwner === owner && location.hash === capturedHash) paint(mountId, settled);
      return settled;
    }
  }

  function rowMarkup(row, index, kind) {
    const pos = positions(row).map(position => letters(position[1]) + (position[0] + 1)).join(' · ');
    const status = row.status || '—';
    const raw = row.raw == null ? '—' : row.raw;
    const imported = row.imported == null ? '—' : row.imported;
    const current = row.current == null ? '—' : row.current;
    if (kind === 'delivery') {
      const keys = [['pm_pd', 'PM'], ['own_pd', '正编'], ['rd_pd', '产研外包'], ['prod_pd', '生产外包'], ['travel_cost', '差旅招待']];
      const value = (record, key) => record && record[key] != null ? record[key] : '—';
      return `<tr data-row="${index}" data-status="${esc(status)}" tabindex="0"><td class="srcv-rownum">${esc(row.row ?? index + 1)}</td>
        <td><b>${esc(row.content || row.label || '未命名行')}</b></td><td>${esc(row.stage || '—')}</td>
        ${keys.map(([key]) => `<td><span>${esc(value(row.imported, key))}</span><small>当前 ${esc(value(row.current, key))}</small></td>`).join('')}
        <td><span class="srcv-status ${statusClass(status)}">${esc(status)}</span></td>
        <td><button type="button" class="srcv-pos" data-pos="1">${esc(pos || '无原表位置')}</button></td></tr>
        <tr class="srcv-detail" data-detail-row="${index}"><td></td><td colspan="9">${esc(row.detail || '')} · 导入值 → 当前值</td></tr>`;
    }
    return `<tr data-row="${index}" data-status="${esc(status)}" tabindex="0"><td class="srcv-rownum">${esc(row.row ?? index + 1)}</td>
      <td><b>${esc(row.label || row.key || '未命名字段')}</b></td><td>${esc(raw)}</td><td>${esc(current)}</td>
      <td><span class="srcv-status ${statusClass(status)}">${esc(status)}</span></td>
      <td><button type="button" class="srcv-pos" data-pos="1">${esc(pos || '无原表位置')}</button></td></tr>
      <tr class="srcv-detail" data-detail-row="${index}"><td></td><td colspan="5">${esc(row.detail || '')} · 导入值 ${esc(imported)} → 当前值 ${esc(current)}</td></tr>`;
  }

  function mergeProjection(sheet, visibleRows, visibleCols) {
    const anchors = new Map();
    const interiors = new Set();
    for (const merge of sheet.merges || []) {
      const [r1, c1, r2, c2] = merge;
      const rows = visibleRows.filter(row => row >= r1 && row <= r2);
      const cols = visibleCols.filter(col => col >= c1 && col <= c2);
      if (!rows.length || !cols.length) continue;
      const anchor = `${rows[0]},${cols[0]}`;
      anchors.set(anchor, { rowspan: rows.length, colspan: cols.length, physical: [r1, c1] });
      for (const row of rows) for (const col of cols) if (`${row},${col}` !== anchor) interiors.add(`${row},${col}`);
    }
    return { anchors, interiors };
  }

  function sheetMarkup(sheet, rows, id) {
    const cells = new Map((sheet.cells || []).map(cell => [`${cell[0]},${cell[1]}`, cell]));
    const visibleCells = (sheet.cells || []).filter(cell => String(cellValue(cell) ?? '').trim() !== '');
    const visibleRows = [...new Set(visibleCells.map(cell => cell[0]))].sort((a, b) => a - b);
    const visibleCols = [...new Set(visibleCells.map(cell => cell[1]))].sort((a, b) => a - b);
    if (!visibleRows.length || !visibleCols.length) return '<div class="srcv-empty">原表没有可显示的单元格</div>';
    const { anchors, interiors } = mergeProjection(sheet, visibleRows, visibleCols);
    const anchorFor = new Map();
    for (const merge of sheet.merges || []) {
      const mergeRows = visibleRows.filter(row => row >= merge[0] && row <= merge[2]);
      const mergeCols = visibleCols.filter(col => col >= merge[1] && col <= merge[3]);
      if (!mergeRows.length || !mergeCols.length) continue;
      const anchor = `${mergeRows[0]},${mergeCols[0]}`;
      for (let row = merge[0]; row <= merge[2]; row++) {
        for (let col = merge[1]; col <= merge[3]; col++) anchorFor.set(`${row},${col}`, anchor);
      }
    }
    const projectedKey = position => anchorFor.get(`${position[0]},${position[1]}`) || `${position[0]},${position[1]}`;
    const links = new Map();
    rows.forEach((row, rowIndex) => positions(row).forEach(position => {
      const key = projectedKey(position);
      const list = links.get(key) || [];
      if (!list.includes(rowIndex)) list.push(rowIndex);
      links.set(key, list);
    }));
    const labelSet = new Set(rows.flatMap(row => row.lab_positions || []).map(projectedKey));
    const valueSet = new Set(rows.flatMap(row => row.val_positions || []).map(projectedKey));
    const skippedSet = new Set(rows.filter(row => /剔除/.test(row.status || '')).flatMap(positions).map(projectedKey));
    return `<table class="srcv-sheet"><thead><tr><th class="srcv-corner"></th>${visibleCols.map(col => `<th>${letters(col)}</th>`).join('')}</tr></thead><tbody>
      ${visibleRows.map(row => `<tr><th>${row + 1}</th>${visibleCols.map(col => {
        const key = `${row},${col}`;
        if (interiors.has(key)) return '';
        const merge = anchors.get(key);
        const physical = merge ? merge.physical : [row, col];
        const cell = cells.get(`${physical[0]},${physical[1]}`) || cells.get(key);
        const value = cellValue(cell) ?? '';
        const linked = links.get(key) || [];
        const classes = ['srcv-cell'];
        if (labelSet.has(key)) classes.push('is-label');
        if (valueSet.has(key)) classes.push('is-value');
        if (skippedSet.has(key)) classes.push('is-skipped');
        return `<td id="sv${id}_${row}_${col}" class="${classes.join(' ')}" data-r="${row}" data-c="${col}" data-links="${linked.join(' ')}" tabindex="0"
          ${merge ? `rowspan="${merge.rowspan}" colspan="${merge.colspan}"` : ''} title="${esc(value)}">${esc(value)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function checksMarkup(check) {
    const checks = Array.isArray(check) ? check : check ? [check] : [];
    if (!checks.length) return '';
    return `<div class="srcv-checks"><h4>原件合计与导入合计</h4><div class="srcv-check-grid">${checks.map(item => {
      const state = item.status || (item.raw == null ? '原件合计不可用' : '—');
      return `<div data-check="${esc(item.stage || '')}-${esc(item.key || '')}" data-status="${esc(state)}"><b>${esc(item.label || `${item.stage || ''} ${item.key || ''}`)}</b><span>原件 ${esc(item.raw ?? '不可用')} · 导入 ${esc(item.imported ?? '—')} · 当前 ${esc(item.current ?? '—')}</span><em class="${statusClass(state)}">${esc(state)}</em></div>`;
    }).join('')}</div></div>`;
  }

  function paint(mountId, data) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    const url = mount.dataset.sourceUrl || '';
    if (data && data.__error) {
      mount.innerHTML = `<div class="srcv srcv-error"><div><b>原表证据暂时无法读取</b><span>${esc(data.message)}</span></div></div>`;
      return;
    }
    if (!data || !data.source) {
      mount.innerHTML = '<div class="srcv srcv-empty-state"><div><b>暂无原件来源</b><span>该记录由在线填写产生，系统不会虚构原表证据。</span></div></div>';
      return;
    }
    const id = ++instance;
    const source = data.source;
    const comparison = data.comparison || { kind: 'form', rows: [], counts: {} };
    const rows = comparison.rows || [];
    const counts = comparison.counts || {};
    const sheet = data.sheet || source.sheet || { cells: [], merges: [] };
    const warnings = comparison.warnings || data.warnings || [];
    mount.innerHTML = `<section class="srcv" data-instance="${id}" data-source-url="${esc(url)}">
      <header class="srcv-head"><div><span class="srcv-kicker">SOURCE EVIDENCE</span><h3>${esc(source.file_name || '原始 Excel')}</h3>
        <p>${esc(sheet.name || source.sheet || '未命名工作表')} · ${esc(source.importer_name || '未知导入人')} · ${esc(source.created_at ? new Date(source.created_at).toLocaleString('zh-CN', { hour12: false }) : '')}</p></div>
        <div class="srcv-actions"><button type="button" class="btn sm srcv-filter-all pri">全部</button><button type="button" class="btn sm srcv-filter-diff">仅差异</button><button type="button" class="btn sm srcv-download">下载原件</button></div></header>
      <div class="srcv-notices">${source.backfilled ? '<span>导入值按当前解析器重新解析原件得出</span>' : ''}${source.inherited_from ? `<span>来源继承自父预算 #${esc(source.inherited_from)}</span>` : ''}${warnings.map(warning => `<span class="is-warning">${esc(warning)}</span>`).join('')}</div>
      <div class="srcv-counts">${Object.entries(counts).map(([key, value]) => `<span><b>${esc(value)}</b>${esc(key)}</span>`).join('')}<span><b>${rows.length}</b>核对项</span></div>
      <div class="srcv-grid"><article class="srcv-left"><div class="srcv-panel-title"><b>系统里</b><span>导入快照与当前值</span></div><div class="srcv-scroll">
        <table class="srcv-result"><thead>${comparison.kind === 'delivery'
          ? '<tr><th>行次</th><th>建设内容</th><th>阶段</th><th>PM人天</th><th>正编人天</th><th>产研外包</th><th>生产外包</th><th>差旅招待</th><th>状态</th><th>位置</th></tr>'
          : '<tr><th>行次</th><th>字段</th><th>原表值</th><th>系统值</th><th>状态</th><th>位置</th></tr>'}</thead><tbody>${rows.map((row, index) => rowMarkup(row, index, comparison.kind)).join('')}</tbody></table>
      </div>${checksMarkup(comparison.check)}</article>
      <article class="srcv-right"><div class="srcv-panel-title"><b>原表里</b><span>${esc(sheet.name || source.sheet || '')} · 保留原行列号</span></div><div class="srcv-formula">点击字段或原表单元格查看完整值</div><div class="srcv-scroll srcv-sheet-scroll">${sheetMarkup(sheet, rows, id)}</div></article></div>
    </section>`;
    bind(mount, rows, sheet, source);
  }

  function bind(mount, rows, sheet, source) {
    const root = mount.querySelector('.srcv');
    const left = root.querySelector('.srcv-left');
    const right = root.querySelector('.srcv-right');
    const leftScroll = left.querySelector('.srcv-scroll');
    const rightScroll = right.querySelector('.srcv-scroll');
    const formula = root.querySelector('.srcv-formula');
    const reveal = (container, element) => {
      const box = container.getBoundingClientRect();
      const target = element.getBoundingClientRect();
      if (target.top < box.top) container.scrollTop -= box.top - target.top;
      else if (target.bottom > box.bottom) container.scrollTop += target.bottom - box.bottom;
      if (target.left < box.left) container.scrollLeft -= box.left - target.left;
      else if (target.right > box.right) container.scrollLeft += target.right - box.right;
    };
    const showFormula = cell => {
      formula.textContent = `${sheet.name || source.sheet || 'Sheet'}!${letters(+cell.dataset.c)}${+cell.dataset.r + 1}  ${cell.title || cell.textContent}`;
    };
    const selectRow = (index, sourceCell) => {
      root.querySelectorAll('tr.is-selected').forEach(row => row.classList.remove('is-selected'));
      root.querySelectorAll('td.is-active').forEach(cell => cell.classList.remove('is-active'));
      const row = root.querySelector(`tr[data-row="${index}"]`);
      if (row) {
        row.classList.add('is-selected');
        if (sourceCell) reveal(leftScroll, row);
      }
      const rowPositions = positions(rows[index] || {});
      let first;
      rowPositions.forEach(position => {
        const cell = root.querySelector(`[data-r="${position[0]}"][data-c="${position[1]}"]`) || root.querySelector(`td[data-links~="${index}"]`);
        if (cell) { cell.classList.add('is-active'); first ||= cell; }
      });
      if (sourceCell) { sourceCell.classList.add('is-active'); showFormula(sourceCell); }
      else if (first) { reveal(rightScroll, first); showFormula(first); }
      else formula.textContent = '该系统行没有原表位置（在线新增或无来源）';
    };
    root.querySelectorAll('tr[data-row]').forEach(row => row.addEventListener('click', () => selectRow(+row.dataset.row)));
    root.querySelectorAll('.srcv-cell').forEach(cell => cell.addEventListener('click', event => {
      event.stopPropagation();
      const linked = (cell.dataset.links || '').split(/\s+/).filter(Boolean).map(Number);
      if (linked.length) selectRow(linked[0], cell);
      else {
        root.querySelectorAll('tr.is-selected').forEach(row => row.classList.remove('is-selected'));
        root.querySelectorAll('td.is-active').forEach(item => item.classList.remove('is-active'));
        cell.classList.add('is-active');
        showFormula(cell);
      }
    }));
    root.querySelector('.srcv-filter-all').addEventListener('click', event => {
      root.querySelectorAll('tr[data-row],tr[data-detail-row]').forEach(row => row.hidden = false);
      root.querySelectorAll('.srcv-actions button').forEach(button => button.classList.remove('pri'));
      event.currentTarget.classList.add('pri');
    });
    root.querySelector('.srcv-filter-diff').addEventListener('click', event => {
      root.querySelectorAll('tr[data-row]').forEach(row => {
        const hidden = row.dataset.status === '一致';
        row.hidden = hidden;
        const detail = root.querySelector(`tr[data-detail-row="${row.dataset.row}"]`);
        if (detail) detail.hidden = hidden;
      });
      root.querySelectorAll('.srcv-actions button').forEach(button => button.classList.remove('pri'));
      event.currentTarget.classList.add('pri');
    });
    root.querySelector('.srcv-download').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const response = await fetch('/api/import-sources/' + source.id + '/file', { headers: { Authorization: 'Bearer ' + (localStorage.token || '') } });
        if (!response.ok) throw new Error('原件下载失败');
        const blob = await response.blob();
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = href; anchor.download = source.file_name || 'source.xlsx'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(href), 0);
      } catch (error) { if (window.toast) window.toast(error.message, 1); }
      finally { button.disabled = false; }
    });
    left.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.closest('tr[data-row]')) event.target.closest('tr[data-row]').click(); });
    right.addEventListener('keydown', event => { if (event.key === 'Enter' && event.target.closest('.srcv-cell')) event.target.closest('.srcv-cell').click(); });
  }

  window.SRCV = {
    load,
    paint,
    cached: currentCached,
    settled(url) {
      const state = currentState(url);
      return valid(state) ? clone(state.data) : null;
    },
    invalidate() {
      for (const [url, state] of states) if (!valid(state)) states.delete(url);
    }
  };
})();
