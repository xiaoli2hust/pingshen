// SC: Excel 原表对照永久浏览器套件
const B = 'http://127.0.0.1:8600';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const LOG = [];
const logArg = process.argv.find(arg => arg.startsWith('--log='));
const logPath = path.resolve(logArg ? logArg.slice(6) : path.join(__dirname, 'green_source_compare.txt'));
const out = line => {
  console.log(line);
  LOG.push(line);
  fs.writeFileSync(logPath, LOG.join('\n') + '\n', 'utf8');
};
let passed = 0;
let failed = 0;
const check = (name, ok, evidence = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'} - ${name}${evidence ? ' | ' + String(evidence).replace(/\s+/g, ' ').slice(0, 240) : ''}`;
  out(line);
  ok ? passed++ : failed++;
};
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const letters = index => {
  let result = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
};
const mergedInteriorEvidence = (page, mountSelector, url) => page.locator(mountSelector).evaluate(async (root, sourceUrl) => {
  const data = await window.api(sourceUrl);
  const positions = row => [...(row.positions || []), ...(row.lab_positions || []), ...(row.val_positions || [])];
  const visibleRows = [...root.querySelectorAll('.srcv-sheet tbody tr > th')].map(cell => Number(cell.textContent) - 1);
  const visibleCols = [...root.querySelectorAll('.srcv-sheet thead th:not(.srcv-corner)')].map(cell => {
    let result = 0;
    for (const character of cell.textContent) result = result * 26 + character.charCodeAt(0) - 64;
    return result - 1;
  });
  let cases = 0;
  let linked = true;
  (data.comparison.rows || []).forEach((row, rowIndex) => positions(row).forEach(position => {
    const merge = (data.sheet.merges || []).find(item => position[0] >= item[0] && position[0] <= item[2]
      && position[1] >= item[1] && position[1] <= item[3] && (position[0] !== item[0] || position[1] !== item[1]));
    if (!merge) return;
    const rows = visibleRows.filter(item => item >= merge[0] && item <= merge[2]);
    const cols = visibleCols.filter(item => item >= merge[1] && item <= merge[3]);
    if (!rows.length || !cols.length) return;
    cases++;
    const anchor = root.querySelector(`.srcv-sheet td[data-r="${rows[0]}"][data-c="${cols[0]}"]`);
    if (!anchor || !(anchor.dataset.links || '').split(/\s+/).includes(String(rowIndex))) linked = false;
  }));
  return { cases, linked };
}, url);

(async () => {
  const browserErrors = [];
  let browser;
  let missingTotalFixture;
  try {
    const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
    browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    const page = await context.newPage();
    const mergeEvidence = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', async error => {
      const hash = await page.evaluate(() => location.hash).catch(() => 'unavailable');
      browserErrors.push('[pageerror][' + hash + '] ' + (error.stack || String(error)));
    });
    page.on('console', message => { if (message.type() === 'error') browserErrors.push('[console.error] ' + message.text()); });

    await page.goto(B + '/');
    await page.fill('#lu', 'zhichizu');
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell');

    const fixture8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');
    const fixture8068 = path.join(__dirname, 'realdata', '【投标决策】PL00008068-260921-昆山市消防要素可视化分析平台 (1).xlsx');
    missingTotalFixture = path.join(os.tmpdir(), `source-compare-missing-total-${process.pid}.xlsx`);
    fs.copyFileSync(fixture8572, missingTotalFixture);
    const mutate = spawnSync('python', ['-X', 'utf8', '-c', [
      'import openpyxl,sys',
      'p=sys.argv[1]',
      'w=openpyxl.load_workbook(p,data_only=True)',
      'hit=False',
      'for s in w.worksheets:',
      '  for r in range(1,min(5,s.max_row+1)):',
      '    v=s.cell(r,1).value',
      '    if v is not None and str(v).replace(" ","").startswith(chr(0x5408)+chr(0x8ba1)):',
      '      s.cell(r,1).value=None; hit=True; break',
      '  if hit: break',
      'assert hit, "delivery total row not found"',
      'budget=next(s for s in w.worksheets if chr(0x9644)+"1-"+chr(0x9884)+chr(0x7b97)+chr(0x8868) in s.title)',
      'if "E20:F20" in [str(m) for m in budget.merged_cells.ranges]: budget.unmerge_cells("E20:F20")',
      'budget.merge_cells("E20:G20")',
      'w.save(p)'
    ].join('\n'), missingTotalFixture], { windowsHide: true, encoding: 'utf8', timeout: 60000 });
    if (mutate.status !== 0) throw new Error(mutate.stderr || mutate.stdout || `missing-total fixture exit ${mutate.status}`);

    await page.evaluate(() => { location.hash = '#/budgets'; });
    await page.waitForSelector('#budgetsImpFile', { state: 'attached' });
    await page.setInputFiles('#budgetsImpFile', {
      name: path.basename(fixture8572),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fs.readFileSync(missingTotalFixture)
    });
    const srcvReady = await page.waitForSelector('#page .srcv', { timeout: 30000 }).then(() => true).catch(() => false);
    if (!srcvReady) {
      const evidence = await page.evaluate(() => ({
        hash: location.hash,
        sourceMount: Boolean(document.querySelector('#impSrcv')),
        pageText: (document.querySelector('#page')?.textContent || '').slice(0, 300),
        toast: document.querySelector('.toast')?.textContent || ''
      }));
      check('SC-RED 新原表对照组件已接管预算导入结果', false,
        JSON.stringify(evidence) + (browserErrors.length ? ' | ' + browserErrors.join(' | ') : ''));
      throw new Error('EXPECTED_RED_COMPONENT_MISSING');
    }

    const budgetText = await page.textContent('#page');
    check('SC-1 预算导入展示系统里/原表里双面板', budgetText.includes('系统里') && budgetText.includes('原表里')
      && await page.locator('.srcv-left').count() === 1 && await page.locator('.srcv-right').count() === 1);
    check('SC-2 合同金额严格显示 240000', /(^|\D)240000(\.0+)?(\D|$)/.test(budgetText));
    check('SC-3 中文字段与来源位置可见', budgetText.includes('合同金额') && /[A-Z]+\d+/.test(budgetText));
    check('SC-4 原表标签值与跳过格分层', await page.locator('.srcv-cell.is-label').count() >= 3
      && await page.locator('.srcv-cell.is-value').count() >= 3);
    const displayValueEvidence = await page.locator('#page .srcv').evaluate(async root => {
      const data = await window.api(root.dataset.sourceUrl);
      const cell = (data.sheet.cells || []).find(item => item.length > 3 && String(item[2]) !== String(item[3]));
      if (!cell) return null;
      const rendered = root.querySelector(`.srcv-cell[data-r="${cell[0]}"][data-c="${cell[1]}"]`);
      return { display: String(cell[2]), raw: String(cell[3]), text: rendered?.textContent, title: rendered?.title };
    });
    check('SC-4A 四元素原格显示格式化值而非原始值', displayValueEvidence && displayValueEvidence.display !== displayValueEvidence.raw
      && displayValueEvidence.text === displayValueEvidence.display && displayValueEvidence.title === displayValueEvidence.display,
    JSON.stringify(displayValueEvidence));

    const scrollEvidence = await page.evaluate(async () => {
      const root = document.querySelector('#page .srcv');
      const left = root.querySelector('.srcv-left .srcv-scroll');
      const right = root.querySelector('.srcv-right .srcv-scroll');
      const linked = [...root.querySelectorAll('.srcv-right td[data-links]:not([data-links=""])')]
        .sort((a, b) => Number(b.dataset.r) - Number(a.dataset.r))[0];
      const rowIndex = Number(linked.dataset.links.split(/\s+/)[0]);
      left.scrollTop = 0;
      right.scrollTop = 0;
      const pageBefore = window.scrollY;
      root.querySelector(`.srcv-left tr[data-row="${rowIndex}"]`).click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { active: root.querySelectorAll('.srcv-right td.is-active').length,
        left: left.scrollTop, right: right.scrollTop, pageBefore, pageAfter: window.scrollY };
    });
    check('SC-5 左行点击仅滚动右侧证据面板', scrollEvidence.active >= 1 && scrollEvidence.left === 0
      && scrollEvidence.right > 0 && scrollEvidence.pageAfter === scrollEvidence.pageBefore, JSON.stringify(scrollEvidence));
    const clickedMeta = await page.locator('#page .srcv').evaluate(async root => {
      const data = await window.api(root.dataset.sourceUrl);
      const display = (row, col) => {
        const cell = (data.sheet.cells || []).find(item => item[0] === row && item[1] === col);
        return cell ? String(cell[2] ?? '') : '';
      };
      const cell = [...root.querySelectorAll('.srcv-right td[data-links]:not([data-links=""]):not([rowspan]):not([colspan])')]
        .filter(item => display(Number(item.dataset.r), Number(item.dataset.c)).trim() !== '').at(-1);
      if (!cell) return null;
      return { id: cell.id, row: Number(cell.dataset.r), col: Number(cell.dataset.c),
        value: display(Number(cell.dataset.r), Number(cell.dataset.c)), sheet: data.sheet.name || data.source.sheet || 'Sheet' };
    });
    if (!clickedMeta) throw new Error('no non-empty linked source cell for SC-6/SC-7');
    const clickedSource = page.locator('#' + clickedMeta.id);
    await clickedSource.click();
    check('SC-6 原表点击反选系统行且原格可键盘聚焦', await page.locator('.srcv-left tr.is-selected').count() === 1
      && await clickedSource.getAttribute('tabindex') === '0');
    const formula = await page.textContent('.srcv-formula');
    const expectedFormula = `${clickedMeta.sheet}!${letters(clickedMeta.col)}${clickedMeta.row + 1}  ${clickedMeta.value}`;
    check('SC-7 公式栏精确保留所点非空原格地址和接口完整值', formula === expectedFormula, `${formula} !== ${expectedFormula}`);

    await page.click('.srcv-filter-diff');
    const diffFilter = await page.locator('#page .srcv-left').evaluate(left => {
      const rows = [...left.querySelectorAll('tr[data-row]')];
      const visible = row => !row.hidden && row.getClientRects().length > 0;
      return {
        total: rows.length,
        same: rows.filter(row => row.dataset.status === '一致').length,
        expectedVisible: rows.filter(row => row.dataset.status !== '一致').length,
        visible: rows.filter(visible).length,
        visibleSame: rows.filter(row => visible(row) && row.dataset.status === '一致').length,
        hiddenDiff: rows.filter(row => !visible(row) && row.dataset.status !== '一致').length
      };
    });
    check('SC-8 仅差异筛选精确保留全部非一致行并隐藏全部一致行', diffFilter.same >= 1 && diffFilter.expectedVisible >= 1
      && diffFilter.visible === diffFilter.expectedVisible && diffFilter.visibleSame === 0 && diffFilter.hiddenDiff === 0,
    JSON.stringify(diffFilter));
    await page.click('.srcv-filter-all');

    const originalBytes = fs.readFileSync(missingTotalFixture);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.srcv-download')
    ]);
    const downloaded = await download.createReadStream();
    const chunks = [];
    for await (const chunk of downloaded) chunks.push(chunk);
    check('SC-9 Bearer 下载保持原件字节与中文文件名', sha256(Buffer.concat(chunks)) === sha256(originalBytes)
      && /[\u4e00-\u9fff]/.test(download.suggestedFilename()), download.suggestedFilename());

    const budgetSourceUrl = await page.locator('.srcv').getAttribute('data-source-url');
    const budgetId = (budgetSourceUrl.match(/budget\/(\d+)\/source/) || [])[1];
    mergeEvidence.push(await mergedInteriorEvidence(page, '#page .srcv', budgetSourceUrl));
    await page.screenshot({ path: 'shots/SC_BUDGET.png', fullPage: true });
    const budgetNext = page.locator('button').filter({ hasText: '进入预算单核对/锁定' });
    const budgetNextText = (await budgetNext.textContent()).trim();
    check('SC-10 预算下一步文案仅含一个箭头', budgetNextText === '进入预算单核对/锁定 →'
      && (budgetNextText.match(/→/g) || []).length === 1, budgetNextText);
    await budgetNext.click();
    await page.waitForTimeout(700);
    check('SC-10A 预算下一步落对话页', /#\/agent\?b=\d+/.test(await page.evaluate(() => location.hash)));

    await page.evaluate(() => { location.hash = '#/new'; });
    await page.waitForSelector('#impFile');
    await page.setInputFiles('#impFile', fixture8068);
    await page.click('button:has-text("上传 Excel 导入评审单")');
    await page.waitForSelector('#page .srcv', { timeout: 30000 });
    const reviewText = await page.textContent('#page');
    check('SC-11 评审导入展示短名与对照组件', reviewText.includes('昆山市消防要素可视化分析平台') && reviewText.includes('系统里') && reviewText.includes('原表里'));
    const reviewSourceUrl = await page.locator('.srcv').getAttribute('data-source-url');
    const reviewId = (reviewSourceUrl.match(/reviews\/(\d+)\/source/) || [])[1];
    mergeEvidence.push(await mergedInteriorEvidence(page, '#page .srcv', reviewSourceUrl));
    await page.screenshot({ path: 'shots/SC_REVIEW.png', fullPage: true });
    const reviewNext = page.locator('button').filter({ hasText: '进入草稿编辑(补齐后提交)' });
    const reviewNextText = (await reviewNext.textContent()).trim();
    check('SC-11A 评审下一步文案仅含一个箭头', reviewNextText === '进入草稿编辑(补齐后提交) →'
      && (reviewNextText.match(/→/g) || []).length === 1, reviewNextText);
    await reviewNext.click();
    await page.waitForTimeout(800);
    check('SC-12 评审下一步进入可编辑草稿', (await page.evaluate(() => location.hash)).startsWith('#/new/bid')
      && await page.locator('#f_title,input[data-k],textarea[data-k]').count() > 0);

    await page.evaluate(id => { location.hash = '#/delivery/' + id; }, budgetId);
    await page.waitForSelector('#dlvFile', { timeout: 20000 });
    await page.setInputFiles('#dlvFile', fixture8572);
    await page.click('button:has-text("上传 Excel 解析")');
    await page.waitForSelector('button:has-text("确认无误, 进入明细编辑")', { timeout: 30000 });
    await page.waitForSelector('#dlvSrcv .srcv[data-source-url]', { timeout: 30000 });
    mergeEvidence.push(await mergedInteriorEvidence(page, '#dlvSrcv', `/api/budget/${budgetId}/delivery/source`));
    const deliveryRows = await page.locator('#dlvSrcv .srcv-left tr[data-row]').evaluateAll(rows => ({
      saved: rows.filter(row => row.dataset.status !== '已剔除').length,
      skipped: rows.filter(row => row.dataset.status === '已剔除').length
    }));
    check('SC-13 附3语义行精确为2保存行/10剔除', deliveryRows.saved === 2 && deliveryRows.skipped === 10,
      JSON.stringify(deliveryRows));
    const checkCount = await page.locator('.srcv-checks [data-check]').count();
    check('SC-14 十项原件合计全部呈现', checkCount === 10, checkCount);
    const deliveryControls = await page.locator('#page .card button').evaluateAll(buttons => buttons.map(button => button.textContent.trim()));
    check('SC-14A 附3确认与返回控件箭头严格匹配', deliveryControls.includes('确认无误, 进入明细编辑 →')
      && deliveryControls.includes('重新上传 / 返回编辑页')
      && !deliveryControls.some(text => text === '重新上传 / 返回编辑页 →')
      && deliveryControls.filter(text => text.includes('确认无误, 进入明细编辑')).every(text => (text.match(/→/g) || []).length === 1),
    deliveryControls.join(' | '));
    await page.screenshot({ path: 'shots/SC_DELIVERY.png', fullPage: true });
    await page.click('button:has-text("确认无误, 进入明细编辑")');
    await page.waitForTimeout(700);
    check('SC-16 导入确认只进入明细编辑而非流程确认', (await page.textContent('#page')).includes('保存明细'));

    const editable = page.locator('#dlvTable input[data-dk="content"]').first();
    if (await editable.count()) {
      await editable.fill('未保存文本-SC');
      await page.evaluate(({ id }) => window.SRCV.load('dlvSrcv', '/api/budget/' + id + '/delivery/source'), { id: budgetId });
      await page.waitForTimeout(600);
      check('SC-17 来源刷新不覆盖未保存编辑', await editable.inputValue() === '未保存文本-SC');
    } else check('SC-17 来源刷新不覆盖未保存编辑', false, '缺可编辑文本框');

    await page.click('button[onclick="deliveryAddRow()"]');
    const budgetZeroIndex = await page.locator('#dlvTable input[data-dk="content"]').count() - 1;
    const budgetZeroRow = page.locator('#dlvTable tr').filter({
      has: page.locator(`input[data-di="${budgetZeroIndex}"][data-dk="content"]`)
    });
    const budgetZeroHint = budgetZeroRow.getByText('无预算数字，保存时不保留');
    const budgetHintShown = await budgetZeroHint.isVisible();
    await budgetZeroRow.locator(`input[data-di="${budgetZeroIndex}"][data-dk="own_pd"]`).fill('1');
    const budgetHintCleared = !(await budgetZeroHint.isVisible());
    check('SC-17A 预算编辑器零数字行就地提示且填数后消失', budgetHintShown && budgetHintCleared,
      JSON.stringify({ budgetZeroIndex, budgetHintShown, budgetHintCleared }));

    await page.setInputFiles('#dlvFile', missingTotalFixture);
    await page.click('button:has-text("上传 Excel 解析")');
    await page.waitForSelector('button:has-text("确认无误, 进入明细编辑")', { timeout: 30000 });
    const unavailable = page.locator('.srcv-checks [data-status="原件合计不可用"]');
    const unavailableTexts = await unavailable.allTextContents();
    check('SC-15 缺失原件合计不伪装为0或一致', unavailableTexts.length === 10
      && unavailableTexts.every(text => text.includes('原件 不可用') && !text.includes('原件 0')), unavailableTexts.length);
    await page.click('button:has-text("确认无误, 进入明细编辑")');
    await page.waitForSelector('#dlvTable');

    await page.evaluate(id => { location.hash = '#/budget-detail/' + id; }, budgetId);
    await page.waitForSelector('#budgetSrc .srcv', { timeout: 20000 });
    check('SC-18 预算详情重进仍展示持久来源', (await page.textContent('#budgetSrc')).includes('原表里'));

    await page.evaluate(id => { location.hash = '#/review/' + id; }, reviewId);
    await page.waitForSelector('#instSrc .srcv', { timeout: 20000 });
    const reviewControl = page.locator('#attField');
    if (await reviewControl.count()) {
      await reviewControl.selectOption({ label: '其他材料' });
      await page.evaluate(url => window.SRCV.load('instSrc', url), reviewSourceUrl);
      await page.waitForTimeout(500);
      check('SC-19 评审来源完成不重绘表单控件', await reviewControl.inputValue() === '其他材料');
    } else check('SC-19 评审来源完成不重绘表单控件', false, '缺附件分类控件');

    await page.evaluate(id => { location.hash = '#/budget-detail/' + id; }, budgetId);
    await page.waitForSelector('#budgetSrc', { timeout: 20000 });
    const staleDetailPattern = new RegExp(`/api/reviews/${reviewId}(?:\\?.*)?$`);
    let staleDetailCalls = 0;
    let releaseStaleDetail;
    let sawStaleDetail;
    const staleDetailGate = new Promise(resolve => { releaseStaleDetail = resolve; });
    const staleDetailSeen = new Promise(resolve => { sawStaleDetail = resolve; });
    await page.route(staleDetailPattern, async route => {
      staleDetailCalls++;
      const response = await route.fetch();
      if (staleDetailCalls === 1) { sawStaleDetail(); await staleDetailGate; }
      await route.fulfill({ response });
    });
    await page.evaluate(id => { invalidateApiCache(); location.hash = '#/review/' + id; }, reviewId);
    await staleDetailSeen;
    await page.evaluate(() => invalidateApiCache());
    releaseStaleDetail();
    await page.waitForSelector('#instHead', { timeout: 20000 });
    const staleDetailCache = await page.evaluate(id => {
      const entry = window._pgCache['/api/reviews/' + id];
      return { cached: Boolean(entry), current: Boolean(entry) && entry.generation === window._apiGeneration
        && entry.session === window._apiSessionGeneration };
    }, reviewId);
    check('SC-19A 详情请求途中失效则丢弃旧代际结果并重取当前代际', staleDetailCalls === 2 && staleDetailCache.current,
      JSON.stringify({ calls: staleDetailCalls, ...staleDetailCache }));
    await page.unroute(staleDetailPattern);

    await page.evaluate(() => { invalidateApiCache(); renderInstTab('pre'); renderInstTab('form'); });
    check('SC-19B paint-only重进不复活失效来源', await page.locator('#instSrc .srcv').count() === 0
      && await page.evaluate(url => window.SRCV.settled(url) === null, reviewSourceUrl));

    const staleSourceUrl = `${reviewSourceUrl}?srcv_stale=${process.pid}`;
    const staleSourceMatcher = url => url.toString().includes(`srcv_stale=${process.pid}`);
    let releaseStaleSource;
    let sawStaleSource;
    const staleSourceGate = new Promise(resolve => { releaseStaleSource = resolve; });
    const staleSourceSeen = new Promise(resolve => { sawStaleSource = resolve; });
    await page.route(staleSourceMatcher, async route => {
      const response = await route.fetch();
      sawStaleSource();
      await staleSourceGate;
      await route.fulfill({ response });
    });
    await page.evaluate(url => {
      const mount = document.createElement('div');
      mount.id = 'staleSourceMount';
      document.body.appendChild(mount);
      window.__staleSourceLoad = window.SRCV.load(mount.id, url);
    }, staleSourceUrl);
    await staleSourceSeen;
    await page.evaluate(() => invalidateApiCache());
    releaseStaleSource();
    const staleFailure = await page.evaluate(async url => {
      const result = await window.__staleSourceLoad;
      const mount = document.getElementById('staleSourceMount');
      const evidence = { result: result === null, settled: window.SRCV.settled(url) === null,
        painted: Boolean(mount.querySelector('.srcv[data-source-url], .srcv-error')),
        cached: Boolean(window._pgCache[url]) };
      mount.remove();
      return evidence;
    }, staleSourceUrl);
    check('SC-19C 来源请求途中失效则迟到响应不落状态不绘制', staleFailure.result && staleFailure.settled
      && !staleFailure.painted && !staleFailure.cached, JSON.stringify(staleFailure));
    await page.unroute(staleSourceMatcher);
    const boundedSourceState = await page.evaluate(async baseUrl => {
      const mount = document.createElement('div');
      mount.id = 'boundedSourceMount';
      document.body.appendChild(mount);
      const urls = Array.from({ length: 28 }, (_, index) => `${baseUrl}?srcv_bound=${index}`);
      for (const url of urls) await window.SRCV.load(mount.id, url);
      const result = { oldest: window.SRCV.settled(urls[0]), latest: window.SRCV.settled(urls.at(-1)) };
      mount.remove();
      return { oldestRetained: result.oldest !== null, latestRetained: Boolean(result.latest?.source) };
    }, reviewSourceUrl);
    check('SC-19C2 来源状态缓存有界且保留最近结果', !boundedSourceState.oldestRetained && boundedSourceState.latestRetained,
      JSON.stringify(boundedSourceState));
    await page.evaluate(url => window.SRCV.load('instSrc', url), reviewSourceUrl);
    await page.waitForSelector('#instSrc .srcv:not(.srcv-error)', { timeout: 20000 });

    const sourcePattern = `**${reviewSourceUrl}`;
    let raceCalls = 0;
    let releaseFirst;
    let sawSecond;
    const firstGate = new Promise(resolve => { releaseFirst = resolve; });
    const secondSeen = new Promise(resolve => { sawSecond = resolve; });
    await page.route(sourcePattern, async route => {
      raceCalls++;
      const response = await route.fetch();
      if (raceCalls === 1) await firstGate;
      else sawSecond();
      await route.fulfill({ response });
    });
    await page.evaluate(url => {
      invalidateApiCache();
      window.__sourceRace = [window.SRCV.load('instSrc', url), window.SRCV.load('instSrc', url)];
    }, reviewSourceUrl);
    await secondSeen;
    await page.waitForSelector('#instSrc .srcv:not(.srcv-loading)', { timeout: 20000 });
    const newerInstance = await page.locator('#instSrc .srcv').getAttribute('data-instance');
    releaseFirst();
    await page.evaluate(() => Promise.all(window.__sourceRace));
    check('SC-19D 同键旧请求不得覆盖较新来源', await page.locator('#instSrc .srcv').getAttribute('data-instance') === newerInstance
      && await page.evaluate(url => Boolean(window.SRCV.settled(url)?.source), reviewSourceUrl), `calls=${raceCalls}`);
    await page.unroute(sourcePattern);

    let releaseRemount;
    let sawRemount;
    const remountGate = new Promise(resolve => { releaseRemount = resolve; });
    const remountSeen = new Promise(resolve => { sawRemount = resolve; });
    await page.route(sourcePattern, async route => {
      const response = await route.fetch();
      sawRemount();
      await remountGate;
      await route.fulfill({ response });
    });
    await page.evaluate(url => {
      invalidateApiCache();
      const mount = document.createElement('div');
      mount.id = 'sameIdMount';
      document.body.appendChild(mount);
      window.__remountLoad = window.SRCV.load('sameIdMount', url);
    }, reviewSourceUrl);
    await remountSeen;
    await page.evaluate(() => {
      const old = document.getElementById('sameIdMount');
      const replacement = document.createElement('div');
      replacement.id = old.id;
      replacement.textContent = 'NEW-MOUNT-OWNER';
      old.replaceWith(replacement);
    });
    releaseRemount();
    await page.evaluate(() => window.__remountLoad);
    check('SC-19E 同ID重挂载拒绝旧元素迟到绘制', await page.locator('#sameIdMount').textContent() === 'NEW-MOUNT-OWNER');
    await page.evaluate(() => document.getElementById('sameIdMount').remove());
    await page.unroute(sourcePattern);

    await page.evaluate(id => { location.hash = '#/budget-detail/' + id; }, budgetId);
    await page.waitForSelector('#budgetSrc', { timeout: 20000 });
    const detailPattern = new RegExp(`/api/reviews/${reviewId}(?:\\?.*)?$`);
    let detailCalls = 0;
    let releaseOldDetail;
    let sawOldDetail;
    let sawNewDetail;
    const oldDetailGate = new Promise(resolve => { releaseOldDetail = resolve; });
    const oldDetailSeen = new Promise(resolve => { sawOldDetail = resolve; });
    const newDetailSeen = new Promise(resolve => { sawNewDetail = resolve; });
    await page.route(detailPattern, async route => {
      detailCalls++;
      const response = await route.fetch();
      if (detailCalls === 1) { sawOldDetail(); await oldDetailGate; }
      else sawNewDetail();
      await route.fulfill({ response });
    });
    const errorsBeforeDetailRace = browserErrors.length;
    await page.evaluate(id => { invalidateApiCache(); location.hash = '#/review/' + id; }, reviewId);
    await oldDetailSeen;
    await page.evaluate(id => { location.hash = '#/budget-detail/' + id; }, budgetId);
    await page.waitForSelector('#budgetSrc', { timeout: 20000 });
    await page.evaluate(id => { location.hash = '#/review/' + id; }, reviewId);
    await newDetailSeen;
    await page.waitForSelector('#instHead', { timeout: 20000 });
    releaseOldDetail();
    await page.waitForTimeout(300);
    check('SC-19F 真详情同评审离开返回拒绝陈旧请求且无pageerror', detailCalls === 2
      && await page.locator('#instHead').count() === 1 && browserErrors.length === errorsBeforeDetailRace,
    `calls=${detailCalls} errors=${JSON.stringify(browserErrors.slice(errorsBeforeDetailRace))}`);
    await page.unroute(detailPattern);

    const sharedScope = await page.evaluate(() => ['销售经理', '项目经理', '财务BP'].includes(ME.role) ? 'mine' : 'all');
    const sharedListMatcher = url => url.pathname === '/api/reviews' && url.searchParams.get('scope') === sharedScope;
    let sharedCalls = 0;
    let releaseHomeList;
    let sawHomeList;
    let sawOppsList;
    const homeListGate = new Promise(resolve => { releaseHomeList = resolve; });
    const homeListSeen = new Promise(resolve => { sawHomeList = resolve; });
    const oppsListSeen = new Promise(resolve => { sawOppsList = resolve; });
    await page.route(sharedListMatcher, async route => {
      sharedCalls++;
      const response = await route.fetch();
      if (sharedCalls === 1) { sawHomeList(); await homeListGate; }
      else sawOppsList();
      await route.fulfill({ response });
    });
    const errorsBeforeListRace = browserErrors.length;
    await page.evaluate(() => { invalidateApiCache(); location.hash = '#/'; });
    await homeListSeen;
    await page.evaluate(() => { location.hash = '#/opps'; });
    await oppsListSeen;
    await page.waitForSelector('#oppsQ', { timeout: 20000 });
    releaseHomeList();
    await page.waitForTimeout(500);
    check('SC-19G 首页旧列表请求迟到不在商机页抛pageerror', sharedCalls === 2
      && await page.locator('#oppsQ').count() === 1 && browserErrors.length === errorsBeforeListRace,
    `calls=${sharedCalls} errors=${JSON.stringify(browserErrors.slice(errorsBeforeListRace))}`);
    await page.unroute(sharedListMatcher);

    const suffix = `${Date.now()}-${process.pid}`;
    const oppCode = `PL-SC-${suffix}`;
    const createdOpp = await page.evaluate(async ({ code, marker }) => window.api('/api/opp', 'POST', {
      opp_code: code,
      title: 'SC原表对照商机-' + marker,
      customer: '江西省自然资源测绘与监测院',
      region: '华东',
      province: '江西',
      biz_line: 'G1',
      contract_amount: 240,
      opp_stage: '投标决策/投标决策',
      sign_date: '2026-12-31',
      sales: '王超',
      pm: '',
      survey: '',
      summary: 'SC机会级交付来源浏览器验收'
    }), { code: oppCode, marker: suffix });
    if (createdOpp.opp?.opp_code !== oppCode) throw new Error('synthetic opportunity creation failed');
    await page.evaluate(code => { location.hash = '#/opp/' + encodeURIComponent(code) + '?t=collect'; }, oppCode);
    await page.waitForSelector('#opdlvFile', { timeout: 20000 });
    await page.waitForSelector('#opdlvSrcv .srcv-empty-state', { timeout: 20000 });
    check('SC-24 无导入来源明确显示空状态', (await page.textContent('#opdlvSrcv')).includes('暂无原件来源'));

    const hostileFilename = 'SC-<img src=x onerror=window.__srcvXss=1>.xlsx';
    await page.setInputFiles('#opdlvFile', {
      name: hostileFilename,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: fs.readFileSync(fixture8068)
    });
    await page.click('#oppDlv button:has-text("上传附3 解析")');
    await page.waitForSelector('#opdlvSrcv .srcv[data-source-url]', { timeout: 30000 });
    await page.waitForSelector('#opdlvTable input[data-ok="own_pd"]', { timeout: 30000 });
    const oppSourceUrl = await page.locator('#opdlvSrcv .srcv').getAttribute('data-source-url');
    const oppChecks = await page.locator('#opdlvSrcv .srcv-checks [data-check]').count();
    check('SC-25 机会交付真实挂载 delivery_opp 来源与十项合计',
      oppSourceUrl === `/api/opp/${oppCode}/delivery/source` && oppChecks === 10, `${oppSourceUrl} checks=${oppChecks}`);
    mergeEvidence.push(await mergedInteriorEvidence(page, '#opdlvSrcv', oppSourceUrl));
    const escapedSource = await page.locator('#opdlvSrcv').evaluate((mount, expected) => ({
      title: mount.querySelector('.srcv-head h3')?.textContent,
      injected: mount.querySelector('.srcv-head img') !== null || window.__srcvXss === 1,
      expected
    }), hostileFilename);
    check('SC-25A 真实接口来源文件名按文本转义', escapedSource.title === hostileFilename && !escapedSource.injected,
      JSON.stringify(escapedSource));

    const gap = page.locator('#opdlvSrcv [data-check="实施-own_pd"]');
    const gapText = await gap.textContent();
    check('SC-26 真实8068保留原件17.5/导入11.5/当前11.5差异',
      await gap.getAttribute('data-status') === '有差异'
        && gapText.includes('原件 17.5') && gapText.includes('导入 11.5') && gapText.includes('当前 11.5'), gapText);

    const sourceGeometry = await page.evaluate(async code => {
      const root = document.querySelector('#opdlvSrcv');
      const data = await window.api('/api/opp/' + encodeURIComponent(code) + '/delivery/source');
      const value = cell => cell[2];
      const expectedRows = [...new Set(data.sheet.cells.filter(cell => String(value(cell) ?? '').trim()).map(cell => cell[0]))].sort((a, b) => a - b);
      const expectedCols = [...new Set(data.sheet.cells.filter(cell => String(value(cell) ?? '').trim()).map(cell => cell[1]))].sort((a, b) => a - b);
      const actualRows = [...root.querySelectorAll('.srcv-sheet tbody tr > th')].map(cell => Number(cell.textContent) - 1);
      const actualCols = [...root.querySelectorAll('.srcv-sheet thead th:not(.srcv-corner)')].map(cell => {
        let result = 0;
        for (const character of cell.textContent) result = result * 26 + character.charCodeAt(0) - 64;
        return result - 1;
      });
      const positions = row => [...(row.positions || []), ...(row.lab_positions || []), ...(row.val_positions || [])];
      let mergedInteriorLinked = true;
      let mergedInteriorCases = 0;
      (data.comparison.rows || []).forEach((row, rowIndex) => positions(row).forEach(position => {
        const merge = (data.sheet.merges || []).find(item => position[0] >= item[0] && position[0] <= item[2]
          && position[1] >= item[1] && position[1] <= item[3] && (position[0] !== item[0] || position[1] !== item[1]));
        if (!merge) return;
        const rows = expectedRows.filter(item => item >= merge[0] && item <= merge[2]);
        const cols = expectedCols.filter(item => item >= merge[1] && item <= merge[3]);
        if (!rows.length || !cols.length) return;
        mergedInteriorCases++;
        const anchor = root.querySelector(`.srcv-sheet td[data-r="${rows[0]}"][data-c="${cols[0]}"]`);
        if (!anchor || !(anchor.dataset.links || '').split(/\s+/).includes(String(rowIndex))) mergedInteriorLinked = false;
      }));
      return { spans: root.querySelectorAll('.srcv-sheet td[rowspan],.srcv-sheet td[colspan]').length,
        preservedGap: actualRows.some((item, index) => index > 0 && item - actualRows[index - 1] > 1),
        axesExact: JSON.stringify(actualRows) === JSON.stringify(expectedRows) && JSON.stringify(actualCols) === JSON.stringify(expectedCols),
        mergedInteriorCases, mergedInteriorLinked, expectedRows: expectedRows.length, actualRows: actualRows.length,
        expectedCols: expectedCols.length, actualCols: actualCols.length };
    }, oppCode);
    check('SC-27 合并投影仅显示非空轴并保留原始行号', sourceGeometry.spans > 0
      && sourceGeometry.preservedGap && sourceGeometry.axesExact, JSON.stringify(sourceGeometry));
    const mergedInteriorCases = mergeEvidence.reduce((sum, item) => sum + item.cases, 0);
    check('SC-27A 真实端点合并内部来源坐标链接到可见锚点', mergedInteriorCases > 0
      && mergeEvidence.every(item => item.linked), JSON.stringify(mergeEvidence));

    const ownInput = page.locator('#opdlvTable input[data-ok="own_pd"]').first();
    const importedOwnBefore = await page.locator('#opdlvSrcv tr[data-row="0"] td').nth(4).locator('span').first().textContent();
    const sourceValuesBefore = await page.locator('#opdlvSrcv td[data-links~="0"]').evaluateAll(cells => cells.map(cell => cell.title));
    const changedOwn = Number(await ownInput.inputValue()) + 1;
    await ownInput.fill(String(changedOwn));
    await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`/api/opp/${oppCode}/delivery/source`) && response.status() === 200),
      page.click('#oppDlv button[onclick="opdlvSave()"]')
    ]);
    await page.waitForFunction(() => document.querySelector('#opdlvSrcv tr[data-row="0"]')?.dataset.status === '已修改');
    const modifiedRow = page.locator('#opdlvSrcv tr[data-row="0"]');
    const importedOwnAfter = await modifiedRow.locator('td').nth(4).locator('span').first().textContent();
    const currentOwnAfter = await modifiedRow.locator('td').nth(4).locator('small').textContent();
    const sourceValuesAfter = await page.locator('#opdlvSrcv td[data-links~="0"]').evaluateAll(cells => cells.map(cell => cell.title));
    check('SC-28 在线修改显示已修改且导入值与原表值不变',
      importedOwnAfter === importedOwnBefore && currentOwnAfter.includes(String(changedOwn))
        && JSON.stringify(sourceValuesAfter) === JSON.stringify(sourceValuesBefore),
      `imported ${importedOwnBefore}->${importedOwnAfter}; ${currentOwnAfter}`);
    const modifiedDetail = await page.locator('#opdlvSrcv tr[data-detail-row="0"]').textContent();
    check('SC-28A 交付变化字段只显示中文业务标签', modifiedDetail.includes('正编')
      && !['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost'].some(key => modifiedDetail.includes(key)), modifiedDetail);

    await page.click('#oppDlv button[onclick="opdlvAddRow()"]');
    const oppZeroIndex = await page.locator('#opdlvTable input[data-ok="content"]').count() - 1;
    const oppZeroRow = page.locator('#opdlvTable tr').filter({
      has: page.locator(`input[data-oi="${oppZeroIndex}"][data-ok="content"]`)
    });
    const oppZeroHint = oppZeroRow.getByText('无预算数字，保存时不保留');
    const oppHintShown = await oppZeroHint.isVisible();
    await oppZeroRow.locator(`input[data-oi="${oppZeroIndex}"][data-ok="own_pd"]`).fill('1');
    const oppHintCleared = !(await oppZeroHint.isVisible());
    check('SC-28B 商机编辑器零数字行就地提示且填数后消失', oppHintShown && oppHintCleared,
      JSON.stringify({ oppZeroIndex, oppHintShown, oppHintCleared }));
    await oppZeroRow.locator('button:has-text("删")').click();
    const unlinkedBudget = await page.evaluate(marker => window.api('/api/budget', 'POST', {
      project_name: 'SC无挂靠预算-' + marker,
      customer: '江西省自然资源测绘与监测院'
    }), suffix);
    if (!unlinkedBudget.id || unlinkedBudget.opp_code !== null) throw new Error('unlinked budget creation failed');
    await page.evaluate(id => { location.hash = '#/delivery/' + id; }, unlinkedBudget.id);
    await page.waitForSelector('#dlvFile', { timeout: 20000 });
    await page.setInputFiles('#dlvFile', fixture8572);
    await page.click('button:has-text("上传 Excel 解析")');
    await page.waitForSelector('#dlvSrcv .srcv[data-source-url]', { timeout: 30000 });
    const unlinkedSourceUrl = await page.locator('#dlvSrcv .srcv').getAttribute('data-source-url');
    check('SC-29 无挂靠预算真实落 delivery_budget 来源',
      unlinkedSourceUrl === `/api/budget/${unlinkedBudget.id}/delivery/source`, unlinkedSourceUrl);
    await page.click('button:has-text("确认无误, 进入明细编辑")');
    await page.waitForSelector('#dlvTable input[data-dk="content"]', { timeout: 20000 });
    const unsavedEditor = page.locator('#dlvTable input[data-dk="content"]').first();
    const unsavedText = '错误恢复期间未保存<&"文本';
    await unsavedEditor.fill(unsavedText);

    await page.route(`**${unlinkedSourceUrl}`, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{malformed' });
    }, { times: 1 });
    await page.evaluate(url => { invalidateApiCache(); return window.SRCV.load('dlvSrcv', url); }, unlinkedSourceUrl);
    await page.waitForSelector('#dlvSrcv .srcv-error', { timeout: 20000 });
    check('SC-20 malformed JSON 收敛为编辑器内错误且保留未保存文本',
      await page.locator('#dlvSrcv .srcv-error').count() === 1 && await unsavedEditor.inputValue() === unsavedText);
    await page.evaluate(url => window.SRCV.load('dlvSrcv', url), unlinkedSourceUrl);
    await page.waitForSelector('#dlvSrcv .srcv:not(.srcv-error):not(.srcv-loading)', { timeout: 20000 });
    check('SC-21 错误后的真实重载恢复且仍保留未保存文本',
      (await page.textContent('#dlvSrcv')).includes('原表里') && await unsavedEditor.inputValue() === unsavedText);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobile = await page.evaluate(() => {
      const grid = document.querySelector('#dlvSrcv .srcv-grid');
      const left = grid.querySelector('.srcv-left .srcv-scroll');
      const right = grid.querySelector('.srcv-right .srcv-scroll');
      return {
        stacked: getComputedStyle(grid).gridTemplateColumns.split(' ').length === 1,
        pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        leftInternalOverflow: left.scrollWidth > left.clientWidth,
        rightInternalOverflow: right.scrollWidth > right.clientWidth
      };
    });
    check('SC-22 390px 单列无全局横溢出且双表内部滚动', mobile.stacked && mobile.pageFits
      && mobile.leftInternalOverflow && mobile.rightInternalOverflow, JSON.stringify(mobile));
    await page.screenshot({ path: 'shots/SC_MOBILE.png', fullPage: true });

    check('SC-23 console.error 与 pageerror 均为零', browserErrors.length === 0, browserErrors.join(' | '));
  } catch (error) {
    if (error.message !== 'EXPECTED_RED_COMPONENT_MISSING') {
      check('SC-SETUP/EXEC 套件完整执行', false, error.stack || error.message);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (missingTotalFixture) fs.rmSync(missingTotalFixture, { force: true });
    const summary = `${passed} passed, ${failed} failed -> ${failed === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
    out(summary);
    fs.writeFileSync(logPath, LOG.join('\n') + '\n', 'utf8');
    process.exitCode = failed === 0 ? 0 : 1;
  }
})();
