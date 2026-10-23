// H-IA: 商机概览 L1 + 评审实例 L2 两级 IA(spec 2026-10-19): L1 七分区/旧 ?t= 收敛/实例卡 L2 四页签/prefill 建单预填
// 迁移自 2026-10-14 版七页签 IA(对照表见 docs/superpowers/plans/2026-10-19-opp360-l1l2-redesign.md Task 4):
//   IA-7/8/9/16/17/10/18/19/22/23/33/34 改 L1/L2 锚点; IA-15/25/27/28/31/32 与 COMPAT 一字不动; 新增 IA-35~40。
// 红跑兜底: 断言段 waitForTimeout + 显式 waitForSelector(新 DOM 20s); 登录锚 waitForSelector(metric-grid 20s)
//   (并行会话下默认名 red_ia.txt 可能是他会话未提交产物, 给了 --log= 就不得回写默认文件)
const B = 'http://127.0.0.1:8600';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const LOG = [];
const out = s => { console.log(s); LOG.push(s); };
const LOGARG = process.argv.find(a => a.startsWith('--log='));
const writeLog = fail => fs.writeFileSync(LOGARG ? path.resolve(LOGARG.slice(6)) : path.join(__dirname, fail === 0 ? 'green_ia.txt' : 'red_ia.txt'), LOG.join('\n') + '\n', 'utf8');

// 构造 2024 老模板 xlsx(与 test_history_import.js 同套路): 只有附1-预算表 sheet + 键值对(IA-40 prefill 夹具)
const mkXlsx = rows => {
  const pyCode = `
import openpyxl, json, sys
rows = json.loads(sys.argv[1])
wb = openpyxl.Workbook()
ws = wb.active
ws.title = '附1-预算表'
for r in rows:
    ws.append(r)
wb.save(sys.argv[2])
`;
  const tmp = path.join(__dirname, '_ia40' + Date.now() + '.xlsx');
  const r = spawnSync('python', ['-X', 'utf8', '-c', pyCode, JSON.stringify(rows), tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mkXlsx fail: ' + r.stderr);
  return tmp;
};

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const { chromium } = playwright;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
  page.setDefaultTimeout(6000);
  const browserErrors = [];
  page.on('pageerror', e => { const msg = '[pageerror] ' + String(e).slice(0, 200); browserErrors.push(msg); console.log(msg); });
  page.on('console', m => { if (m.type() === 'error') { const msg = '[console.error] ' + m.text().slice(0, 200); browserErrors.push(msg); console.log(msg); } });
  let pass = 0, fail = 0;
  const check = (name, ok, ev) => { const line = (ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : ''); out(line); ok ? pass++ : fail++; };

  const login = async (u) => {
    await page.goto(B + '/');
    await page.fill('#lu', u);
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell', { timeout: 5000 });
  };
  const navTexts = async () => page.locator('.sidebar nav a').allTextContents();
  const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---- IA-1/2: zhichizu 六项扁平导航 + 归档库文本锚(h_flicker) ----
  await login('zhichizu');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n1 = await navTexts();
  check('IA-1 zhichizu 导航七项含全部预算单', sameArr(n1, ['首页', '全部商机', '全部预算单', '待办打灯', '研判台', '归档库', '解析器实验室']), '实得:' + n1.join(','));
  check('IA-2 扁平无分组div + 归档库文本保留', (await page.locator('.sidebar .nav-group').count()) === 0 && (await page.locator('nav a:has-text("归档库")').count()) === 1);
  await page.screenshot({ path: 'shots/H_IA_1_shell.png', fullPage: false });

  // ---- IA-6: 首页个人工作台(我的待办队列) ----
  const home1 = await page.textContent('#page');
  check('IA-6 首页含我的待办与前置收集/待录结论分项', home1.includes('我的待办') && home1.includes('前置收集中') && home1.includes('待录结论'), '');
  await page.screenshot({ path: 'shots/H_IA_2_home.png', fullPage: false });

  // ---- IA-7/15: 商机概览 L1 七分区(页签移除) + 三步链 ----
  let l1ok = false;
  try {
    await page.evaluate(() => { location.hash = '#/opp/PL00008572'; });
    await page.waitForSelector('#oppProfileCard', { timeout: 20000 });
    await page.waitForTimeout(900);
    l1ok = true;
  } catch (e) { /* 旧前端无 L1 七分区 */ }
  if (l1ok) {
    const tabsC = await page.locator('#oppTabs').count();
    const secIds = ['oppProfileCard', 'oppChain', 'oppShared', 'oppInstances', 'oppLightAgg', 'oppAnalysis', 'oppAgent'];
    const secCounts = {};
    for (const id of secIds) secCounts[id] = await page.locator('#' + id).count();
    check('IA-7 商机概览 L1 七分区且 #oppTabs 移除', tabsC === 0 && secIds.every(id => secCounts[id] === 1), '#oppTabs=' + tabsC + ' ' + JSON.stringify(secCounts));
    const chainC = await page.locator('#oppChain').count();
    const dots = await page.locator('#oppChain .chain-dot').count();
    const cTxt = chainC ? await page.textContent('#oppChain') : '';
    check('IA-15 三步链 #oppChain + ①②③ + 三 dot', chainC === 1 && dots === 3 && cTxt.includes('①') && cTxt.includes('②') && cTxt.includes('③'),
      '#oppChain=' + chainC + ' .chain-dot=' + dots);
  } else {
    check('IA-7 商机概览 L1 七分区且 #oppTabs 移除', false, '旧前端无 #oppProfileCard(L1 未渲染)');
    check('IA-15 三步链 #oppChain + ①②③ + 三 dot', false, '同上: L1 未渲染');
  }
  await page.screenshot({ path: 'shots/H_IA_3_opp360.png', fullPage: false });

  // ---- IA-18/19: 旧深链 t 值收敛: hash 去 query 且映射到分区 data-focus ----
  try {
    await page.evaluate(() => { location.hash = '#/opp/PL00008572?t=budget'; });
    await page.waitForSelector('#oppShared[data-focus="collect"]', { timeout: 20000 });
    const h18 = await page.evaluate(() => location.hash);
    check('IA-18 旧深链 t=budget 收敛: hash 无 query 且 #oppShared[data-focus=collect]', h18 === '#/opp/PL00008572', 'hash=' + h18);
  } catch (e) { check('IA-18 旧深链 t=budget 收敛: hash 无 query 且 #oppShared[data-focus=collect]', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  try {
    await page.evaluate(() => { location.hash = '#/opp/PL00008572?t=light'; });
    await page.waitForSelector('#oppInstances[data-focus="pre"]', { timeout: 20000 });
    const h19 = await page.evaluate(() => location.hash);
    check('IA-19 旧深链 t=light 收敛: hash 无 query 且 #oppInstances[data-focus=pre]', h19 === '#/opp/PL00008572', 'hash=' + h19);
  } catch (e) { check('IA-19 旧深链 t=light 收敛: hash 无 query 且 #oppInstances[data-focus=pre]', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // Shared-card presence must not depend on an incidental hint elsewhere on the page.
  try {
    await page.waitForSelector('#opdlvTable', { timeout: 20000 });
    await page.waitForTimeout(1400);
    const readShared = () => {
      const shared = document.querySelector('#oppShared');
      const cards = ['oppDlv', 'oppBudgets', 'oppLaunch'].map(id => {
        const matches = shared?.querySelectorAll(':scope > #' + id) || [];
        return { id, count: matches.length, title: matches[0]?.querySelector('h3')?.textContent.trim() || '' };
      });
      const launch = shared?.querySelector(':scope > #oppLaunch');
      const types = ['presale', 'bid', 'change'].map(type => {
        const matches = launch?.querySelectorAll('[data-launch="' + type + '"]') || [];
        const links = matches[0]?.querySelectorAll('a.btn') || [];
        return { type, count: matches.length, title: matches[0]?.querySelector('b')?.textContent.trim() || '', links: links.length, href: links[0]?.getAttribute('href') || '' };
      });
      return { cards, cardCount: shared?.querySelectorAll(':scope > .card').length || 0, types, typeCount: launch?.querySelectorAll('[data-launch]').length || 0,
        rows: [...(shared?.querySelectorAll('#oppDlv #opdlvTable tbody tr') || [])].filter(row => row.querySelector('[data-oi]')).length,
        tables: document.querySelectorAll('#opdlvTable').length, summaryCount: shared?.querySelectorAll('#oppDlv #opdlvSum').length || 0,
        summary: shared?.querySelector('#oppDlv #opdlvSum')?.textContent || '' };
    };
    const validShared = data => data.cardCount === 3 && data.cards.every((card, i) => card.count === 1 && card.title.startsWith(['① 交付预算', '② 项目预算', '发起评审'][i]))
      && data.typeCount === 3 && data.types.every((type, i) => type.count === 1 && type.title === ['售前立项评审', '投标决策评审', '项目关键事项决策'][i]
        && type.links === 1 && type.href.split('?')[0] === '#/new/' + type.type && new URLSearchParams(type.href.split('?')[1]).get('opp') === 'PL00008572')
      && data.rows >= 1 && data.tables === 1 && data.summaryCount === 1 && data.summary.includes('交付成本合计');
    const observed = await page.evaluate(readShared);
    check('IA-8 L1 共享区三卡/三类型真入口+交付行集与汇总', validShared(observed), JSON.stringify(observed));
    for (const mutation of ['missing', 'misplaced', 'heading', 'target']) {
      try {
        await page.evaluate(kind => {
          if (kind === 'missing' || kind === 'misplaced') {
            const node = document.querySelector(kind === 'missing' ? '#oppLaunch' : '#oppBudgets');
            const parent = node.parentNode, next = node.nextSibling;
            window.__ia8Undo = () => parent.insertBefore(node, next);
            if (kind === 'missing') node.remove(); else document.querySelector('#oppPage').append(node);
          } else if (kind === 'heading') {
            const node = document.querySelector('#oppLaunch h3'), children = [...node.childNodes];
            window.__ia8Undo = () => node.replaceChildren(...children);
            node.textContent = '错误卡片';
          } else {
            const node = document.querySelector('#oppLaunch [data-launch="bid"] a.btn'), href = node.getAttribute('href');
            window.__ia8Undo = () => node.setAttribute('href', href);
            node.setAttribute('href', '#/new/bid?opp=WRONG-OPPORTUNITY');
          }
        }, mutation);
        check('IA-8m ' + mutation + ' 变异被同一实际DOM断言拒绝', !validShared(await page.evaluate(readShared)));
      } finally {
        await page.evaluate(() => { if (window.__ia8Undo) window.__ia8Undo(); delete window.__ia8Undo; });
      }
    }
    check('IA-8m 变异后原三卡与入口完整还原', validShared(await page.evaluate(readShared)));
  } catch (e) { check('IA-8 L1 共享区三卡/三类型真入口+交付行集与汇总', false, 'EX:' + String(e.message).slice(0, 120)); }

  // (IA-9 已移至自建夹具 FX 之后: 七月锚 PL00008572 的评审行 opp_code=null(导入通道缺口, spec 审计已记), 其 L1 实例恒为空, 不可作 L2 入口)

  // ---- IA-16/17/10: L1 灯色汇总 / 数据分析(P2 空态) / 对话 ----
  try {
    await page.evaluate(() => { location.hash = '#/opp/PL00008572'; });
    await page.waitForSelector('#oppLightAgg', { timeout: 20000 });
    const laTxt = await page.textContent('#oppLightAgg');
    check('IA-16 L1 灯色汇总含红/黄/绿计数与在途/历史两列',
      laTxt.includes('灯色汇总') && laTxt.includes('红') && laTxt.includes('黄') && laTxt.includes('绿')
      && (await page.locator('#oppLightAgg [data-agg="inflight"]').count()) === 1 && (await page.locator('#oppLightAgg [data-agg="history"]').count()) === 1,
      '灯色汇总=' + laTxt.includes('灯色汇总') + ' 两列=' + (await page.locator('#oppLightAgg [data-agg]').count()));
  } catch (e) { check('IA-16 L1 灯色汇总含红/黄/绿计数与在途/历史两列', false, 'EX:' + String(e.message).slice(0, 120)); }
  try {
    const anTxt = await page.textContent('#oppAnalysis');
    check('IA-17 L1 展示已有灯色时间线与结论对比', anTxt.includes('灯色时间线') && anTxt.includes('结论对比') && !/上线中|P2/.test(anTxt), '');
  } catch (e) { check('IA-17 L1 展示已有灯色时间线与结论对比', false, 'EX:' + String(e.message).slice(0, 120)); }
  try {
    const agTxt = await page.textContent('#oppAgent');
    check('IA-10 L1 对话分区含该商机目标(预算/评审表)', agTxt.includes('预算') && agTxt.includes('评审表'), '');
  } catch (e) { check('IA-10 L1 对话分区含该商机目标(预算/评审表)', false, 'EX:' + String(e.message).slice(0, 120)); }

  // ---- IA-11 + IA-21~26(V4.0 T7): 新建待评审商机向导 —— 建档优先 + 要素继承 + 同商机再次评审 ----
  // 登录身份 = zhichizu(销售支持组, 在 server OPP_CREATE_ROLES 内且为自建档案的 created_by)
  await page.evaluate(() => { location.hash = '#/new'; });
  await page.waitForTimeout(700);
  const wiz = await page.textContent('#page');
  check('IA-11 新建待评审商机首屏(建档优先 · 三编制方式改「建档」)',
    wiz.includes('新建待评审商机') && wiz.includes('商机代码') && wiz.includes('① 对话式建档') && wiz.includes('③ Excel 导入') && wiz.includes('② 表单式建档'),
    '建档=' + wiz.includes('新建待评审商机') + ' 商机代码=' + wiz.includes('商机代码') + ' ①=' + wiz.includes('① 对话式建档') + ' ③=' + wiz.includes('③ Excel 导入') + ' ②=' + wiz.includes('② 表单式建档'));
  await page.screenshot({ path: 'shots/H_IA_4_wizard.png', fullPage: false });

  // IA-21: 空表直接提交 → FE 必填拦截(该文案只存在于 createOppProfile 发请求之前的 miss 分支)
  try {
    const c21a = await page.locator('#newOppCode').count();
    await page.click('#page button:has-text("建档案并进入下一步")');
    await page.waitForTimeout(500);
    const e21 = await page.textContent('#oppProfileErr');
    const c21b = await page.locator('#newOppCode').count();
    check('IA-21 #/new 空表提交被 FE 必填拦截且不发请求',
      c21a === 1 && /必填未填/.test(e21) && /商机代码/.test(e21) && c21b === 1,
      '#newOppCode=' + c21a + '→' + c21b + ' 报错=' + JSON.stringify(e21));
  } catch (e) { check('IA-21 #/new 空表提交被 FE 必填拦截且不发请求', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  const WZ = 'PL-WZ-' + String(Date.now()).slice(-7);
  const WZ_FILL = async () => {
    await page.evaluate(() => { location.hash = '#/new'; });
    await page.waitForTimeout(700);
    await page.fill('#newOppCode', WZ);
    await page.fill('[data-ok="title"]', 'T7 向导用例商机');
    await page.fill('[data-ok="customer"]', '江西省自然资源测绘与监测院');
    await page.selectOption('[data-ok="biz_line"]', 'G1');
    await page.fill('[data-ok="contract_amount"]', '240');
    await page.fill('[data-ok="opp_stage"]', '投标决策');
    await page.fill('[data-ok="sales"]', '王超');
    await page.fill('[data-ok="summary"]', 'T7 IA-22 建档用例概述');
  };

  // IA-22: 唯一码 + 7 必填 → 建档案并进入下一步 → 落 L1 商机概览, #oppLaunch 出三类型卡
  try {
    await WZ_FILL();
    await page.click('#page button:has-text("建档案并进入下一步")');
    await page.waitForSelector('#oppLaunch', { timeout: 20000 });
    const h22 = await page.evaluate(() => location.hash);
    const t22 = await page.textContent('#page');
    check('IA-22 建档成功落 L1: hash=#/opp/<码> 且 #oppLaunch 三类型卡',
      h22 === '#/opp/' + WZ && (await page.locator('#oppLaunch').count()) === 1 && t22.includes('售前立项评审') && t22.includes('投标决策评审') && t22.includes('项目关键事项决策'),
      'code=' + WZ + ' hash=' + h22 + ' #oppLaunch=' + (await page.locator('#oppLaunch').count()));
    await page.screenshot({ path: 'shots/H_IA_5_picktype.png', fullPage: false });
  } catch (e) { check('IA-22 建档成功落 L1: hash=#/opp/<码> 且 #oppLaunch 三类型卡', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-23: 从 #oppLaunch 选「投标决策评审」→ #/new/bid?opp= 三值来自 prefill + #pfHint
  try {
    await page.click('#oppLaunch a[href="#/new/bid?opp=' + WZ + '"]');
    await page.waitForSelector('#pfHint', { timeout: 20000 });
    const h23 = await page.evaluate(() => location.hash);
    const vals = {};
    for (const k of ['title', 'opp_code', 'customer']) {
      const loc = k === 'title' ? page.locator('#f_title') : page.locator(`[data-k="${k}"]`);
      vals[k] = (await loc.count()) === 1 ? await loc.inputValue() : '(缺失)';
    }
    const hint23 = await page.textContent('#pfHint');
    check('IA-23 从 #oppLaunch 选投标卡: hash=#/new/bid?opp= 且 三值 prefill 带入 + #pfHint 评审N项',
      h23 === '#/new/bid?opp=' + WZ && vals.title === 'T7 向导用例商机' && vals.opp_code === WZ && vals.customer === '江西省自然资源测绘与监测院'
      && /评审\s*\d+\s*项/.test(hint23),
      'hash=' + h23 + ' 继承实得=' + JSON.stringify(vals) + ' hint=' + JSON.stringify(hint23.slice(0, 60)));
    await page.screenshot({ path: 'shots/H_IA_6_inherit.png', fullPage: false });
  } catch (e) { check('IA-23 从 #oppLaunch 选投标卡: hash=#/new/bid?opp= 且 三值 prefill 带入 + #pfHint 评审N项', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-24: 同码重复建档 → 服务端 409 文案就地红显
  try {
    await WZ_FILL();
    await page.click('#page button:has-text("建档案并进入下一步")');
    await page.waitForTimeout(1600);
    const e24 = await page.textContent('#oppProfileErr');
    check('IA-24 同码重复建档显示服务端 409「商机代码已存在」', /商机代码已存在/.test(e24) && e24.includes(WZ),
      '报错=' + JSON.stringify(e24));
  } catch (e) { check('IA-24 同码重复建档显示服务端 409「商机代码已存在」', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-25: ?opp= 指向已建档商机(要素齐全) → 跳过建档直出类型选择, 不得出现建档表单与必填报错
  try {
    await page.evaluate(() => { location.hash = '#/new?opp=PL00008572'; });
    await page.waitForTimeout(1200);
    const t25 = await page.textContent('#page');
    const err25 = (await page.locator('#oppProfileErr').count()) === 1 ? await page.textContent('#oppProfileErr') : '';
    check('IA-25 #/new?opp=存量已建档商机 → 不出现建档表单, 直接出「选择首个评审类型」',
      t25.includes('选择首个评审类型') && (await page.locator('#newOppCode').count()) === 0 && !/必填未填/.test(t25) && !/必填未填/.test(err25),
      '#newOppCode=' + (await page.locator('#newOppCode').count()) + ' 报错=' + JSON.stringify(err25));
  } catch (e) { check('IA-25 #/new?opp=存量已建档商机 → 不出现建档表单, 直接出「选择首个评审类型」', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-26: 列表页新建入口文案同步
  try {
    await page.evaluate(() => { location.hash = '#/opps'; });
    await page.waitForTimeout(1200);
    const l26 = await page.locator('.card h3 a[href="#/new"]').allTextContents();
    check('IA-26 商机列表页入口为「+ 新建待评审商机」', l26.length >= 1 && l26.some(t => t.trim() === '+ 新建待评审商机'),
      '入口文本=' + JSON.stringify(l26));
  } catch (e) { check('IA-26 商机列表页入口为「+ 新建待评审商机」', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }


  // ---- IA-12/13: #/reviews 重定向 → #/opps ----
  await page.evaluate(() => { location.hash = '#/reviews'; });
  await page.waitForTimeout(800);
  check('IA-12 #/reviews 重定向 #/opps', (await page.evaluate(() => location.hash)) === '#/opps', 'hash=' + (await page.evaluate(() => location.hash)));
  await page.waitForTimeout(700);
  const oppsTxt = (await page.locator('#oppsTbl').count()) ? await page.textContent('#oppsTbl') : '';
  check('IA-13 商机列表渲染(商机代码列)', oppsTxt.includes('商机代码'), '');

  // ---- IA-20: 列表链路三点列(spec §4.3 降级口径: 列表端点无 chain, ① 恒灰) ----
  try {
    const heads = await page.locator('#oppsTbl th').allTextContents();
    const iChain = heads.findIndex(h => h.includes('链路进度'));
    const iLight = heads.findIndex(h => h.includes('最新灯态'));
    const trs = await page.locator('#oppsTbl tbody tr').count();
    const minis = await page.locator('#oppsTbl .chain-mini').count();
    check('IA-20 列表「链路进度」列在最新灯态前且每行有 .chain-mini', iChain >= 0 && iChain < iLight && minis >= 1 && minis === trs - 1,
      '表头=' + heads.join(',') + ' 链路列=' + iChain + ' 灯态列=' + iLight + ' tr=' + trs + ' .chain-mini=' + minis);
  } catch (e) { check('IA-20 列表「链路进度」列在最新灯态前且每行有 .chain-mini', false, 'EX:' + String(e.message).slice(0, 120)); }

  // ---- 写入类用例夹具: 自建商机 ----
  // 锚定码 PL00008572 的 delivery/budgets 是 C2-06/C2-07/C2-07b 与 DL-15 的观测对象, 写用例只用自建码。
  const tok = await page.evaluate(() => localStorage.token);
  const call = async (reqPath, method, body) => {
    const r = await fetch(B + reqPath, { method: method || 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  };
  const FX = 'PL-T6-' + String(Date.now()).slice(-7);
  const fxCreate = await call('/api/opp', 'POST', { opp_code: FX, title: 'T6用例商机', customer: '江西省自然资源测绘与监测院', region: '华东', province: '江西',
    biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: 'T6 IA-8b 写入用例夹具' });
  // fields 口径与 C2/CH 的 BF 同源(缺 dev_dept 即撞「必填缺失」门, 测不到 G2)
  const fxField = { project_name: 'T6 用例预算', customer: '江西省自然资源测绘与监测院', contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, opp_code: FX };
  const fxBgR = await call('/api/budget', 'POST', { project_name: 'T6 用例预算', opp_code: FX, fields: fxField });
  const fxBg = fxBgR.data && fxBgR.data.id;
  const fxReviewR = await call('/api/reviews', 'POST', { type: 'bid', title: 'T6 用例评审', form: { opp_code: FX }, submit: false });
  const fxReviewId = fxReviewR.data && fxReviewR.data.id;

  // ---- IA-9: L1 实例卡 → L2 前置评审页签(评判指标/部门/轮次留痕) ----
  try {
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppInstances .inst-card[data-rid]', { timeout: 20000 });
    await page.click('#oppInstances .inst-card[data-rid]');
    await page.waitForSelector('#instTabs button[data-tab]', { timeout: 20000 });
    await page.click('#instTabs button[data-tab="pre"]');
    await page.waitForTimeout(600);
    const t9 = await page.textContent('#page');
    check('IA-9 L2 前置评审页签含评判指标/部门/轮次留痕', t9.includes('评判指标') && t9.includes('部门') && t9.includes('轮次留痕'), '');
  } catch (e) { check('IA-9 L2 前置评审页签含评判指标/部门/轮次留痕', false, 'EX:' + String(e.message).slice(0, 120)); }

  // ---- IA-8b(D-32): 已确认 ≠ 只读 —— 建行→保存→确认→(confirmed 态三写入口仍可点)→改行→保存→回草稿→G2 重新拦 ----
  try {
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#opdlvTable', { timeout: 20000 });
    const cardH3 = '#oppPage .card:has(#opdlvTable) h3';
    const btnDis = async label => {
      const l = page.locator('#oppPage button:text-is("' + label + '")');
      return (await l.count()) === 1 ? await l.isDisabled() : '(无按钮)';
    };
    // ① 建行 + 保存(先填文本再填数字: 数字格的 oninput 会把同行全部输入同步进 OPDLV)
    await page.click('#oppPage button:text-is("+ 加行")');
    await page.waitForTimeout(400);
    await page.fill('#opdlvTable [data-oi="0"][data-ok="content"]', 'T6用例行一');
    await page.fill('#opdlvTable [data-oi="0"][data-ok="own_pd"]', '39');
    await page.click('#oppPage button:text-is("保存明细")');
    await page.waitForTimeout(1200);
    const put1 = await call('/api/opp/' + FX + '/delivery');
    // ② 确认(新 L1 就地更新 pill, 不整页重绘; 等待原样保留)
    await page.click('#oppPage button:text-is("确认交付预算")');
    await page.waitForTimeout(1600);
    const confirmedPill = ((await page.locator('#opdlvPill').count()) === 1) ? (await page.textContent('#opdlvPill')).includes('已确认')
      : (((await page.locator(cardH3).count()) ? await page.locator(cardH3).first().textContent() : '').includes('已确认'));
    const disConfirmed = { imp: await btnDis('上传附3 解析'), add: await btnDis('+ 加行'), save: await btnDis('保存明细'), confirm: await btnDis('确认交付预算') };
    // ---- IA-8c(D-47 ①): confirmed 态下行内输入格不得因 locked 锁死(写权限只由服务端 can_write 裁决, status 不参与) ----
    try {
      const cellDis = {};
      for (const k of ['content', 'own_pd', 'note']) cellDis[k] = await page.locator(`#opdlvTable [data-oi="0"][data-ok="${k}"]`).isDisabled();
      const delBtn = await page.locator('#opdlvTable button:text-is("删")').count();
      check('IA-8c D-47① confirmed 态行内输入格与删行按钮不被 locked 锁死',
        Object.values(cellDis).every(v => v === false) && delBtn >= 1, 'disabled=' + JSON.stringify(cellDis) + ' 删按钮=' + delBtn);
    } catch (e) { check('IA-8c D-47① confirmed 态行内输入格与删行按钮不被 locked 锁死', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 120)); }
    // ---- IA-8d(D-47 ②): 只改非数字控件(content/note/stage)、不碰任何数字格, 保存后服务端须回写新值 ----
    try {
      await page.fill('#opdlvTable [data-oi="0"][data-ok="content"]', 'D47只改文本');
      await page.fill('#opdlvTable [data-oi="0"][data-ok="note"]', 'D47备注');
      await page.selectOption('#opdlvTable [data-oi="0"][data-ok="stage"]', '运维');
      await page.click('#oppPage button:text-is("保存明细")');
      await page.waitForTimeout(1200);
      const r0 = (((((await call('/api/opp/' + FX + '/delivery')).data) || {}).delivery || {}).rows || [])[0] || {};
      check('IA-8d D-47② 只改文本/阶段(不碰数字)保存后服务端即为新值',
        r0.content === 'D47只改文本' && r0.note === 'D47备注' && r0.stage === '运维',
        '实得=' + JSON.stringify({ content: r0.content, note: r0.note, stage: r0.stage, pm_pd: r0.pm_pd, own_pd: r0.own_pd }));
    } catch (e) { check('IA-8d D-47② 只改文本/阶段(不碰数字)保存后服务端即为新值', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 120)); }
    // ③ confirmed 态下改行 → 保存 → 服务端回草稿
    await page.click('#oppPage button:text-is("+ 加行")');
    await page.waitForTimeout(400);
    await page.fill('#opdlvTable [data-oi="1"][data-ok="content"]', 'T6用例行二');
    await page.fill('#opdlvTable [data-oi="1"][data-ok="pm_pd"]', '5');
    await page.click('#oppPage button:text-is("保存明细")');
    await page.waitForTimeout(1200);
    // ④ 不切页签: #opdlvPill 就地回草稿(opdlvSave 成功分支就地更新)
    const draftPill = ((await page.locator('#opdlvPill').count()) === 1) ? (await page.textContent('#opdlvPill')).includes('草稿') : false;
    const confirmBackEnabled = (await btnDis('确认交付预算')) === false;
    const addBackEnabled = (await btnDis('+ 加行')) === false;
    // ⑤ 服务端真相: 链态回 ① + G2 重新拦(断言文案含「仍为草稿」以钉住是 G2 而非 409 重复锁定/必填缺失)
    const aggFx = (await call('/api/opp/' + FX + '/360')).data || {};
    const chFx = aggFx.chain || {};
    const lockR = await call('/api/budget/' + fxBg + '/lock', 'POST');
    const g2Hit = lockR.status === 400 && /仍为草稿/.test(String((lockR.data || {}).error || ''));
    check('IA-8b confirmed≠只读: 三写入口可点 + 改行保存回草稿 + #opdlvPill 就地回草稿 + chain 回① + G2 重新拦 400',
      confirmedPill && disConfirmed.imp === false && disConfirmed.add === false && disConfirmed.save === false && disConfirmed.confirm === true &&
      draftPill && confirmBackEnabled && addBackEnabled && chFx.delivery_confirmed === false && chFx.next_action === 'confirm_delivery' && g2Hit,
      ' 夹具=' + fxCreate.status + '/' + fxBgR.status + '/bg=' + fxBg + ' confirmed态禁用=' + JSON.stringify(disConfirmed) + ' 就地草稿pill=' + draftPill + ' 重确认后=(' + confirmBackEnabled + '/' + addBackEnabled + ')' +
      ' chain=' + JSON.stringify({ delivery_confirmed: chFx.delivery_confirmed, next_action: chFx.next_action }) +
      ' lock=' + lockR.status + '/' + JSON.stringify((lockR.data || {}).error || '') + ' PUT1=' + put1.status + '/' + (((put1.data || {}).delivery || {}).rows || []).length + '行');
  } catch (e) { check('IA-8b confirmed≠只读: 三写入口可点 + 改行保存回草稿 + #opdlvPill 就地回草稿 + chain 回① + G2 重新拦 400', false, 'EX:' + String(e.message).slice(0, 160)); }

  // ---- IA-20b(D-16 同批, 不新增编号): ② 卡「＋ 新建项目预算(挂靠本商机)」真的建出挂靠单 ----
  try {
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#opdlvTable', { timeout: 20000 });
    const obc = await page.locator('#oppPage [data-obc]').count();
    const rowSel = '#oppPage .card:has(a[href="#/budgets"]) tbody tr';
    const rowsBefore = await page.locator(rowSel).count();
    await page.evaluate(() => { window.prompt = () => 'T6-IA20b 挂靠预算'; });
    await page.click('#oppPage [data-obc]');
    await page.waitForTimeout(1500);
    const hashAgent = await page.evaluate(() => location.hash);
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#opdlvTable', { timeout: 20000 });
    const rowsAfter = await page.locator(rowSel).count();
    const wsLink = await page.locator('#oppPage .card:has(a[href="#/budgets"]) a[href="#/budgets"]').count();
    await page.click('#oppPage .card:has(a[href="#/budgets"]) a[href="#/budgets"]');
    await page.waitForTimeout(900);
    const hashWs = await page.evaluate(() => location.hash);
    check('IA-20b D-16 挂靠建单入口可点且新建单进②表 + 预算工作台可达',
      obc >= 1 && /^#\/agent\?b=\d+$/.test(hashAgent) && rowsAfter === rowsBefore + 1 && wsLink >= 1 && hashWs === '#/budgets',
      '[data-obc]=' + obc + ' 点击后hash=' + hashAgent + ' ②行 ' + rowsBefore + '→' + rowsAfter + ' 工作台链接=' + wsLink + ' hash=' + hashWs);
  } catch (e) { check('IA-20b D-16 挂靠建单入口可点且新建单进②表 + 预算工作台可达', false, 'EX:' + String(e.message).slice(0, 160)); }

  // ---- IA-27~34: 四类下钻返回 + 差旅输入 + 360 缓存与写后失效 ----
  browserErrors.length = 0;
  const navCase = async (hash, expectedHref, label) => {
    try {
      await page.evaluate(h => { location.hash = h; }, hash);
      await page.waitForFunction(href => document.querySelector('.crumb-bar a.btn')?.getAttribute('href') === href, expectedHref, { timeout: 10000 });
      const href = await page.locator('.crumb-bar a.btn').getAttribute('href');
      const text = await page.locator('.crumb-bar').textContent();
      check(label, href === expectedHref && text.includes('›'), 'href=' + href + ' text=' + text.slice(0, 80));
    } catch (e) { check(label, false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  };
  await navCase('#/opp/' + FX, '#/opps', 'IA-27 商机 360 返回全部商机');
  await navCase('#/budget-detail/' + fxBg, '#/opp/' + FX, 'IA-28 预算详情返回所属商机');
  await navCase('#/delivery/' + fxBg, '#/opp/' + FX, 'IA-29 交付详情返回商机概览');
  await navCase('#/review/' + fxReviewId, '#/opp/' + FX, 'IA-30 评审详情返回所属商机');
  try {
    await page.waitForSelector('#reviewInstancePage', { timeout: 10000 });
    check('IA-30b #/review/:id 渲染评审实例视图 #reviewInstancePage', (await page.locator('#reviewInstancePage').count()) === 1, '');
  } catch (e) { check('IA-30b #/review/:id 渲染评审实例视图 #reviewInstancePage', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  try {
    await page.evaluate(c => { location.hash = '#/opp/' + c + '?t=collect'; }, FX);
    await page.waitForSelector('#opdlvTable [data-ok="travel_cost"]');
    check('IA-31 商机级交付编辑器显示差旅招待输入', await page.locator('#opdlvTable [data-ok="travel_cost"]').count() >= 1);
  } catch (e) { check('IA-31 商机级交付编辑器显示差旅招待输入', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  try {
    await page.evaluate(id => { location.hash = '#/delivery/' + id; }, fxBg);
    await page.waitForSelector('#dlvTable [data-dk="travel_cost"]');
    check('IA-32 预算级交付编辑器显示差旅招待输入', await page.locator('#dlvTable [data-dk="travel_cost"]').count() >= 1);
  } catch (e) { check('IA-32 预算级交付编辑器显示差旅招待输入', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  let hits360 = 0, cacheProbeReady = false;
  const on360 = req => { if (/\/api\/opp\/[^/]+\/360$/.test(new URL(req.url()).pathname)) hits360++; };
  page.on('request', on360);
  try {
    await page.evaluate(() => { window._pgCache = {}; location.hash = '#/opps'; });
    await page.waitForSelector('#oppsTbl');
    hits360 = 0;
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppProfileCard', { timeout: 20000 });
    await page.waitForTimeout(500);
    check('IA-33 L1 首进恰请求 1 次 360', hits360 === 1, 'hits=' + hits360);
    cacheProbeReady = true;
  } catch (e) { check('IA-33 L1 首进恰请求 1 次 360', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  try {
    if (!cacheProbeReady) throw new Error('IA-33 L1 探针未完成');
    await page.click('#oppInstances .inst-card[data-rid]');
    await page.waitForSelector('#instTabs button[data-tab]', { timeout: 20000 });
    hits360 = 0;
    for (const k of ['form', 'pre', 'result', 'chat']) {
      await page.click('#instTabs button[data-tab="' + k + '"]');
      await page.waitForTimeout(250);
    }
    check('IA-33 L2 切四页签零 360 请求', hits360 === 0, 'hits=' + hits360);
    await page.evaluate(() => { location.hash = '#/opps'; });
    await page.waitForSelector('#oppsTbl');
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppProfileCard', { timeout: 20000 });
    await page.waitForTimeout(400);
    check('IA-33 返回 L1 命中缓存零 360 请求', hits360 === 0, 'hits=' + hits360);
  } catch (e) { check('IA-33 L2 切四页签/返回 L1 缓存零请求', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  try {
    if (!cacheProbeReady) throw new Error('IA-33 前置缓存探针未完成');
    await page.evaluate(async c => {
      await api('/api/opp/' + c + '/delivery', 'PUT', { rows: [{ content: '缓存失效验证', stage: '实施', own_pd: 1, travel_cost: 25 }] });
    }, FX);
    await page.evaluate(() => { location.hash = '#/opps'; });
    await page.waitForSelector('#oppsTbl');
    hits360 = 0;
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppProfileCard', { timeout: 20000 });
    await page.waitForTimeout(500);
    check('IA-34 成功写请求后重新进入 L1 恰刷新一次', hits360 === 1, 'hits=' + hits360);
  } catch (e) { check('IA-34 成功写请求后重新进入 L1 恰刷新一次', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  let hitsRev = 0;
  const onRev = req => { if (/\/api\/reviews\/\d+$/.test(new URL(req.url()).pathname)) hitsRev++; };
  try {
    if (!cacheProbeReady) throw new Error('IA-33 前置缓存探针未完成');
    // 建单必须走浏览器内 api(): 非 GET 触发 invalidateApiCache, 重进 L1 才会重拉 360 拿到新实例卡(Node 侧 call 清不了前端 30s 缓存)
    const nid = await page.evaluate(async o => { try { const d = await api('/api/reviews', 'POST', o); return (d && d.id) || null; } catch (e) { return null; } },
      { type: 'bid', title: 'T6 缓存用例评审', form: { opp_code: FX }, submit: false });
    if (!nid) throw new Error('夹具建单失败(浏览器内 api POST /api/reviews)');
    await page.evaluate(() => { location.hash = '#/opps'; });
    await page.waitForSelector('#oppsTbl');
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppProfileCard', { timeout: 20000 });
    page.on('request', onRev);
    hitsRev = 0;
    await page.click('#oppInstances .inst-card[data-rid="' + nid + '"]');
    await page.waitForSelector('#instTabs button[data-tab]', { timeout: 20000 });
    check('IA-34 写评审后重进 L2 恰 1 次详情请求', hitsRev === 1, 'hits=' + hitsRev);
  } catch (e) { check('IA-34 写评审后重进 L2 恰 1 次详情请求', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  page.off('request', onRev);
  page.off('request', on360);
  check('IA 浏览器控制台与页面异常为零', browserErrors.length === 0, browserErrors.slice(0, 3).join(' | '));

  // ---- IA-14: 旧深链 #/agent?b= 仍可用 ----
  {
    const tok = await page.evaluate(() => localStorage.token);
    const bl = await (await fetch(B + '/api/budget', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const b = (bl.budgets || [])[0];
    if (b) {
      await page.goto(B + '/#/agent?b=' + b.id);
      await page.waitForTimeout(900);
      check('IA-14 旧深链 #/agent?b= 对话窗仍可用', (await page.locator('#agInput').count()) === 1);
    } else check('IA-14 旧深链 #/agent?b= 对话窗仍可用', false, '库内无预算单可测');
  }

  // ---- 兼容断言(旧代码即 PASS, 证明非破坏性) ----
  {
    const tok = await page.evaluate(() => localStorage.token);
    const rl = await (await fetch(B + '/api/reviews?scope=all', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const r = (rl.reviews || []).find(x => x.opp_code === 'PL00008572') || (rl.reviews || [])[0];
    let ok = false;
    if (r) {
      await page.goto(B + '/#/review/' + r.id);
      await page.waitForTimeout(900);
      ok = ((await page.textContent('#page')) || '').length > 10;
    }
    check('COMPAT-1 #/review/:id 详情页可用', ok, r ? 'id=' + r.id : '无评审单');
  }
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForTimeout(900);
  check('COMPAT-2 #/tasks 任务表格结构不变', (await page.locator('#taskTbl').count()) === 1 && (await page.textContent('#taskTbl')).includes('评判指标'), '');

  // ---- IA-35~40(spec 2026-10-19 新用例; 夹具码每轮唯一, 全部带鉴权 HTTP 夹具) ----

  // IA-35: L1 档案卡 12 行 + 实例恰两组(空组也渲染) + 无页签 + 「待补」分支
  try {
    const I35 = 'PL-IA35-' + String(Date.now()).slice(-7);
    const c35 = await call('/api/opp', 'POST', { opp_code: I35, title: 'IA35 档案用例', customer: '江西省自然资源测绘与监测院', region: '华东', province: '江西',
      biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: 'IA35 结构用例' });
    if (c35.status >= 400) throw new Error('建档 ' + c35.status + ' ' + JSON.stringify(c35.data || {}).slice(0, 80));
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, I35);
    await page.waitForSelector('#oppProfileCard', { timeout: 20000 });
    const pfRows = await page.locator('#oppProfileCard tbody tr').count();
    const grpC = await page.locator('.inst-group[data-group]').count();
    const tabsC35 = await page.locator('#oppTabs').count();
    // PUT 走浏览器内 api() 触发缓存失效; Node 侧 call 清不了前端 30s 缓存, 重进 L1 会命中陈旧 profile 致 [data-missing] 永不出现
    await page.evaluate(c => api('/api/opp/' + c, 'PUT', { sales: '' }), I35);
    await page.evaluate(() => { location.hash = '#/opps'; });
    await page.waitForSelector('#oppsTbl');
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, I35);
    await page.waitForSelector('#oppProfileCard [data-missing]', { timeout: 20000 });
    const missC = await page.locator('#oppProfileCard [data-missing]').count();
    const d35 = (await call('/api/opp/' + I35 + '/360')).data || {};
    const missHas = (((d35 || {}).profile || {}).missing || []).includes('sales');
    check('IA-35 L1 档案卡12行 + 实例恰两组(空组也渲染) + 无#oppTabs + 待补分支[数据缺失]',
      pfRows === 12 && grpC === 2 && tabsC35 === 0 && missC >= 1 && missHas,
      'rows=' + pfRows + ' groups=' + grpC + ' tabs=' + tabsC35 + ' missingDom=' + missC + ' apiMissing=' + JSON.stringify(((d35 || {}).profile || {}).missing));
  } catch (e) { check('IA-35 L1 档案卡12行 + 实例恰两组(空组也渲染) + 无#oppTabs + 待补分支[数据缺失]', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-36: L1 点实例卡 → L2: hash/r/:id + #reviewInstancePage + 四页签 + 面包屑「商机概览 ›」+ 灯横幅与进度条
  try {
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppInstances .inst-card[data-rid]', { timeout: 20000 });
    await page.click('#oppInstances .inst-card[data-rid]');
    await page.waitForSelector('#reviewInstancePage', { timeout: 20000 });
    const h36 = await page.evaluate(() => location.hash);
    const instT = await page.locator('#instTabs button[data-tab]').count();
    const crumb36 = await page.locator('.crumb-bar a.btn').getAttribute('href');
    const crumbTxt = await page.locator('.crumb-bar').textContent();
    const lb = await page.locator('.light-banner').count();
    const ps = await page.locator('.progress-seg').count();
    check('IA-36 L1→L2: hash=/r/:id + #reviewInstancePage + 四页签 + 面包屑商机概览› + 灯横幅/进度条',
      /^#\/opp\/[^/]+\/r\/\d+$/.test(h36) && (await page.locator('#reviewInstancePage').count()) === 1 && instT === 4
      && crumb36 === '#/opp/' + FX && crumbTxt.includes('商机概览 ›') && lb >= 1 && ps >= 1,
      'hash=' + h36 + ' tabs=' + instT + ' crumb=' + crumb36 + '/' + crumbTxt.slice(0, 40) + ' banner=' + lb + ' seg=' + ps);
  } catch (e) { check('IA-36 L1→L2: hash=/r/:id + #reviewInstancePage + 四页签 + 面包屑商机概览› + 灯横幅/进度条', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-37: L2 切四页签零 API 请求(接 IA-36 所在 L2)
  try {
    let apiHits = 0;
    const onApi = req => { if (new URL(req.url()).pathname.startsWith('/api/')) apiHits++; };
    page.on('request', onApi);
    apiHits = 0;
    for (const k of ['form', 'pre', 'result', 'chat']) {
      await page.click('#instTabs button[data-tab="' + k + '"]');
      await page.waitForTimeout(250);
    }
    page.off('request', onApi);
    check('IA-37 L2 切四页签零 API 请求', apiHits === 0, 'hits=' + apiHits);
  } catch (e) { check('IA-37 L2 切四页签零 API 请求', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-38: C3-11 同款两轮夹具(退回重提) → L2 轮次切换零请求 + 时间线跨轮次
  try {
    const I38 = 'PL-IA38-' + String(Date.now()).slice(-7);
    const mk38 = await call('/api/opp', 'POST', { opp_code: I38, title: 'IA38 两轮实例', customer: '江西省自然资源测绘与监测院', region: '华东', province: '江西',
      biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: 'IA38 轮次用例' });
    if (mk38.status >= 400) throw new Error('建档 ' + mk38.status);
    const dput38 = await call('/api/opp/' + I38 + '/delivery', 'PUT', { rows: [{ content: 'IA38 行', stage: '实施', own_pd: 2 }] });
    const dcfm38 = await call('/api/opp/' + I38 + '/delivery/confirm', 'POST', {});
    const bfld38 = { project_name: 'IA38 预算', customer: '江西省自然资源测绘与监测院', contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 200, del_travel: 10000, opp_code: I38 };
    const bg38 = await call('/api/budget', 'POST', { project_name: 'IA38 预算', opp_code: I38, fields: bfld38 });
    const bgid38 = bg38.data && bg38.data.id;
    const lk38 = await call('/api/budget/' + bgid38 + '/lock', 'POST');
    // 必填口径与 C3-11 的 BID_FORM(test_opp360.js:361) 同源: bid 提交门要求全量 bid 必填, 缺一则 submit 400
    const bidForm38 = { customer: '江西省自然资源测绘与监测院', biz_line: 'G1', contract_amount: 240, gross_margin: 30, ops_years: 1, sign_path: '示例:A公司→丰图科技(深圳)有限公司', survey: '否', secret: '否', settle_method: '银行转账', guarantee: '否', non_compete: '否', payment_terms: '验收后30天付款', summary: 'IA38 投标概述', data_review: '否', opp_code: I38 };
    const rv38 = await call('/api/reviews', 'POST', { type: 'bid', title: 'IA38 两轮实例评审', form: bidForm38, budget_id: bgid38, submit: false });
    const rid38 = rv38.data && rv38.data.id;
    if (!rid38) throw new Error('建单失败 ' + rv38.status);
    const sub1 = await call('/api/reviews/' + rid38 + '/submit', 'POST', {});
    if (sub1.status >= 400) throw new Error('submit ' + sub1.status + ' ' + JSON.stringify(sub1.data || {}).slice(0, 80));
    const lg38 = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'fde1', password: '123456' }) });
    const ftok38 = ((await lg38.json()) || {}).token;
    if (!ftok38) throw new Error('fde1 登录失败');
    const mine38 = await (await fetch(B + '/api/tasks?scope=mine', { headers: { Authorization: 'Bearer ' + ftok38 } })).json();
    const t38 = (mine38.tasks || []).find(t => String(t.review_id) === String(rid38) && t.status === 'pending');
    if (!t38) throw new Error('fde1 无该单 pending 任务');
    const ret38 = await fetch(B + '/api/tasks/' + t38.id + '/return', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ftok38 }, body: JSON.stringify({ opinion: 'IA38 退回' }) });
    if (ret38.status >= 400) throw new Error('return ' + ret38.status);
    const sub2 = await call('/api/reviews/' + rid38 + '/submit', 'POST', {});
    if (sub2.status >= 400) throw new Error('resubmit ' + sub2.status);
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, I38);
    await page.waitForSelector('#oppInstances .inst-card[data-rid]', { timeout: 20000 });
    await page.click('#oppInstances .inst-card[data-rid="' + rid38 + '"]');
    await page.waitForSelector('#instTabs button[data-tab]', { timeout: 20000 });
    let hits38 = 0;
    const on38 = req => { if (new URL(req.url()).pathname.startsWith('/api/')) hits38++; };
    page.on('request', on38);
    const prog0 = await page.textContent('#instProgress');
    await page.selectOption('#instRoundSel', '1');
    await page.waitForTimeout(300);
    const prog1 = await page.textContent('#instProgress');
    check('IA-38 两轮实例: 默认第2轮 → 切第1轮进度变化且零请求',
      prog0.includes('第 2 轮') && prog1.includes('第 1 轮') && hits38 === 0,
      'p0=' + prog0.slice(0, 40) + ' p1=' + prog1.slice(0, 40) + ' hits=' + hits38);
    await page.click('#instTabs button[data-tab="result"]');
    await page.waitForTimeout(300);
    const tl38 = (await page.locator('#instTimeline').count()) === 1 ? await page.textContent('#instTimeline') : '';
    check('IA-38 时间线跨轮次: result 页签显全部轮次事件且零请求',
      (await page.locator('#instTimeline').count()) === 1 && tl38.includes('提交') && hits38 === 0,
      'tl=' + tl38.slice(0, 60) + ' hits=' + hits38);
    page.off('request', on38);
    // 夹具卫生(spec §11): 二轮 pending 逐条打 0(与 test_opp360.js drain 同口径), 触发的自动研判属服务端正常流程
    for (const u of ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1']) {
      const lr = await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: '123456' }) });
      const tk = ((await lr.json()) || {}).token;
      if (!tk) continue;
      const mm = await (await fetch(B + '/api/tasks?scope=mine', { headers: { Authorization: 'Bearer ' + tk } })).json();
      for (const t of (mm.tasks || [])) if (String(t.review_id) === String(rid38) && t.status === 'pending')
        await fetch(B + '/api/tasks/' + t.id + '/complete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk }, body: JSON.stringify({ light: 'green', opinion: '' }) });
    }
  } catch (e) { check('IA-38 两轮实例: 默认第2轮 → 切第1轮进度变化且零请求', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 160)); }

  // IA-39: 直开 #/review/:id → 实例视图 + 切换器在场(FX 现有两实例) + hash 不重定向
  try {
    await page.evaluate(id => { location.hash = '#/review/' + id; }, fxReviewId);
    await page.waitForSelector('#reviewInstancePage', { timeout: 20000 });
    const h39 = await page.evaluate(() => location.hash);
    const sw = await page.locator('#instSwitcher').count();
    check('IA-39 直开#/review/:id: 实例视图+切换器在场+hash 不重定向',
      h39 === '#/review/' + fxReviewId && (await page.locator('#reviewInstancePage').count()) === 1 && sw === 1,
      'hash=' + h39 + ' switcher=' + sw);
    await page.click('#instTabs button[data-tab="pre"]');
    await page.waitForTimeout(300);
    check('IA-39 切页签后 hash 仍不变', (await page.evaluate(() => location.hash)) === '#/review/' + fxReviewId, 'hash=' + (await page.evaluate(() => location.hash)));
  } catch (e) { check('IA-39 直开#/review/:id: 实例视图+切换器在场+hash 不重定向', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // IA-40: 专用码 prefill 五级级联(档案旧值 vs 历史导入新值)
  try {
    const I40 = 'PL-IA40-' + String(Date.now()).slice(-7);
    const mk40 = await call('/api/opp', 'POST', { opp_code: I40, title: 'IA40档案旧值', customer: '旧客户', region: '华东', province: '江西',
      biz_line: 'G1', contract_amount: 240, opp_stage: '投标决策', sign_date: '2026-12-31', sales: '王超', pm: '', survey: '', summary: 'IA40 prefill 用例' });
    if (mk40.status >= 400) throw new Error('建档 ' + mk40.status);
    const tmp40 = mkXlsx([
      ['项目名称', 'IA40历史新值'], ['商机代码', I40], ['客户名称', '新客户'], ['合同金额', 240000], ['分包采购成本', 0],
      ['所属部门', '交付处'], ['评审结论', '同意通过'], ['评审日期', '2024-05-12'],
    ]);
    const data40 = fs.readFileSync(tmp40).toString('base64');
    const imp40 = await call('/api/reviews/import', 'POST', { filename: 'ia40.xlsx', type: 'presale', mode: 'history', data: data40 });
    fs.unlinkSync(tmp40);
    if (imp40.status >= 400) throw new Error('导入 ' + imp40.status + ' ' + JSON.stringify(imp40.data || {}).slice(0, 100));
    await page.evaluate(c => { location.hash = '#/new/bid?opp=' + c; }, I40);
    await page.waitForSelector('#pfHint', { timeout: 20000 });
    const hint40 = await page.textContent('#pfHint');
    const v40 = {};
    for (const k of ['title', 'opp_code', 'customer']) {
      const loc = k === 'title' ? page.locator('#f_title') : page.locator(`[data-k="${k}"]`);
      v40[k] = (await loc.count()) === 1 ? await loc.inputValue() : '(缺失)';
    }
    const mHit = /评审\s*(\d+)\s*项/.test(hint40) ? Number(hint40.match(/评审\s*(\d+)\s*项/)[1]) : -1;
    check('IA-40 prefill 五级级联: pfHint评审N项(N≥1) + 标题/客户取历史新值 + 代码强制落位 + 档案旧值不出现',
      mHit >= 1 && v40.title === 'IA40历史新值' && v40.customer === '新客户' && v40.opp_code === I40,
      'hintN=' + mHit + ' vals=' + JSON.stringify(v40) + ' hint=' + JSON.stringify(hint40.slice(0, 60)));
  } catch (e) { check('IA-40 prefill 五级级联: pfHint评审N项(N≥1) + 标题/客户取历史新值 + 代码强制落位 + 档案旧值不出现', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 160)); }

  // ---- IA-41~43: 返回上一步(站内导航栈, 用户验收反馈 2026-10-20): 深链来路回深链 / 下钻链逐级返回 / 直达落固定父级 ----
  try {
    await page.evaluate(() => { location.hash = '#/tasks'; });
    await page.waitForSelector('#taskTbl', { timeout: 10000 });
    await page.evaluate(id => { location.hash = '#/review/' + id; }, fxReviewId);
    await page.waitForSelector('#reviewInstancePage', { timeout: 10000 });
    await page.click('.crumb-bar a.btn');
    await page.waitForFunction(h => location.hash === h, '#/tasks', { timeout: 6000 });
    check('IA-41 深链来路返回: #/tasks→#/review/:id 点← 应回 #/tasks(旧码回固定父级)', (await page.evaluate(() => location.hash)) === '#/tasks', 'hash=' + (await page.evaluate(() => location.hash)));
  } catch (e) { check('IA-41 深链来路返回: #/tasks→#/review/:id 点← 应回 #/tasks(旧码回固定父级)', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  try {
    await page.evaluate(c => { location.hash = '#/opp/' + c; }, FX);
    await page.waitForSelector('#oppInstances .inst-card[data-rid="' + fxReviewId + '"]', { timeout: 10000 });
    await page.click('#oppInstances .inst-card[data-rid="' + fxReviewId + '"]');
    await page.waitForSelector('#reviewInstancePage', { timeout: 10000 });
    const l2hash = await page.evaluate(() => location.hash);
    await page.click('#page a[href="#/budget/' + fxReviewId + '"]');
    await page.waitForSelector('#aiText', { timeout: 10000 });
    await page.click('.crumb-bar a.btn');
    await page.waitForFunction(h => location.hash === h, l2hash, { timeout: 6000 });
    check('IA-42 下钻链逐级返回: L2→在线填写预算表 点← 应回 L2(旧码跳回 L1)', (await page.evaluate(() => location.hash)) === l2hash, '期望=' + l2hash + ' 实得=' + (await page.evaluate(() => location.hash)));
  } catch (e) { check('IA-42 下钻链逐级返回: L2→在线填写预算表 点← 应回 L2(旧码跳回 L1)', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }
  try {
    await page.evaluate(id => { location.hash = '#/review/' + id; }, fxReviewId);
    await page.waitForSelector('#reviewInstancePage', { timeout: 10000 });
    await page.reload({ waitUntil: 'load' }); // 带 hash 刷新清栈: 模拟书签直达(boot 从 localStorage 恢复登录态)
    await page.waitForSelector('#reviewInstancePage', { timeout: 15000 });
    await page.click('.crumb-bar a.btn');
    await page.waitForFunction(c => location.hash === '#/opp/' + c, FX, { timeout: 6000 });
    check('IA-43 直达深链无来路(刷新清栈): ← 落固定父级 #/opp/FX(防回归钉, 新旧码均绿)', (await page.evaluate(() => location.hash)) === '#/opp/' + FX, 'hash=' + (await page.evaluate(() => location.hash)));
  } catch (e) { check('IA-43 直达深链无来路(刷新清栈): ← 落固定父级 #/opp/FX(防回归钉, 新旧码均绿)', false, 'EX:' + String(e.message).split('\n')[0].slice(0, 140)); }

  // ---- 角色导航矩阵: fde1 / sales1 / fin1 ----
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fde1');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n2 = await navTexts();
  check('IA-3 fde1 导航三项含相关商机', sameArr(n2, ['首页', '相关商机', '待办打灯']), '实得:' + n2.join(','));
  check('IA-6b fde1 首页含我的待办', (await page.textContent('#page')).includes('我的待办'), '');
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('sales1');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n3 = await navTexts();
  check('IA-4 sales1 导航四项含我的预算单', sameArr(n3, ['首页', '我的商机', '我的预算单', '新建待评审商机']), '实得:' + n3.join(','));
  check('IA-6c sales1 首页含我的待办', (await page.textContent('#page')).includes('我的待办'), '');
  await page.evaluate(() => logout());
  await page.waitForTimeout(500);
  await login('fin1');
  await page.waitForSelector('.metric-grid', { timeout: 20000 });
  const n4 = await navTexts();
  check('IA-5 财务BP 导航四项(含待办打灯)', sameArr(n4, ['首页', '我的商机', '新建待评审商机', '待办打灯']), '实得:' + n4.join(','));

  await browser.close();
  out(`\n${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`);
  writeLog(fail);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); LOG.push('FAIL:' + e.message); writeLog(1); process.exit(1); });
