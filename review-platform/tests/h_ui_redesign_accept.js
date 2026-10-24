// H-UI: 「审图台」浅色全站方案的真实浏览器验收(spec 2026-10-25 §7)
// 只读: 只登录与跳路由, 不点任何写按钮; 截图落 shots/UI_*.png; 日志由脚本 utf8 落盘
const fs = require('node:fs');
const path = require('node:path');
const B = process.env.BASE || 'http://127.0.0.1:8600';
const LOGARG = process.argv.find(a => a.startsWith('--log='));
const LOGF = LOGARG ? path.resolve(LOGARG.slice(6)) : path.join(__dirname, 'green_ui_redesign.txt');
const SHOTS = path.join(__dirname, '..', 'shots');
const OPP = 'PL00008572';
let log = '', pass = 0, fail = 0;
const out = s => { log += s + '\n'; console.log(s); };
const check = (name, ok, ev = '') => { ok ? pass++ : fail++; out((ok ? 'PASS' : 'FAIL') + ' - ' + name + (ev ? ' | ' + ev : '')); };

(async () => {
  const playwright = require(path.join('E:\\npm-global\\node_modules\\playwright'));
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  const errs = [];
  let phase = 'boot';
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    page.on('console', m => { if (m.type() === 'error') errs.push('[console.error ' + phase + '] ' + m.text().slice(0, 200)); });
    page.on('pageerror', e => errs.push('[pageerror ' + phase + '] ' + String((e && e.message) || e).slice(0, 200)));
    const shot = async n => page.screenshot({ path: path.join(SHOTS, 'UI_' + n + '.png'), fullPage: true });
    const go = async (h, sel) => { phase = h; await page.evaluate(x => { location.hash = x; }, h); await page.waitForSelector(sel); await page.waitForTimeout(400); };
    const api = p => page.evaluate(x => window.api(x), p);
    const style = (sel, props) => page.evaluate(([s, ps]) => {
      const el = document.querySelector(s); if (!el) return null;
      const cs = getComputedStyle(el); const o = {}; for (const p of ps) o[p] = cs.getPropertyValue(p).trim(); return o;
    }, [sel, props]);
    const varColor = name => page.evaluate(n => {
      const d = document.createElement('div'); d.style.color = 'var(' + n + ')'; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c;
    }, name);
    const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

    // 1 登录
    phase = 'login';
    await page.goto(B + '/');
    await page.waitForSelector('#lu');
    await shot('01_login');
    const scheme = await page.evaluate(() => document.querySelector('meta[name="color-scheme"]').content);
    check('UI-01 登录页 color-scheme=light', scheme === 'light', scheme);
    await page.fill('#lu', 'zhichizu');
    await page.fill('#lp', '123456');
    await page.click('button:has-text("登 录")');
    await page.waitForSelector('.app-shell');

    // 2 工作台
    await go('#/', '.metric-grid');
    await shot('02_workbench');
    const mv = await style('.metric-tile .m-value', ['font-family']);
    check('UI-02 工作台数值字体含 Bahnschrift', !!mv && /Bahnschrift/.test(mv['font-family']), mv && mv['font-family']);
    const bodyText = await style('#page', ['color']);
    const cardBg = (await style('.metric-tile', ['background-color']))['background-color'];
    const r1 = ratio(bodyText.color, cardBg);
    check('UI-03 正文字色/卡片底色对比度 ≥ 4.5', r1 >= 4.5, r1.toFixed(2) + ' ' + bodyText.color + ' on ' + cardBg);
    const t2 = await varColor('--text-2');
    const r2 = ratio(t2, cardBg);
    check('UI-04 次级字色 --text-2/卡片底色对比度 ≥ 4.5', r2 >= 4.5, r2.toFixed(2));

    // 3 商机列表
    await go('#/opps', '#page table');
    await shot('03_opps');
    const priBtn = await page.evaluate(() => { const b = document.querySelector('.btn.pri'); return b ? getComputedStyle(b).backgroundColor : null; });
    const brand = await varColor('--brand');
    check('UI-05 主按钮背景 = --brand', !!priBtn && priBtn === brand, priBtn + ' vs ' + brand);

    // 4 商机 360
    await go('#/opp/' + OPP, '#oppProfileCard');
    await page.waitForSelector('[data-agg="history"]');
    await shot('04_opp360_' + OPP);
    const head = (await page.textContent('#oppProfileCard h3')) || '';
    check('UI-06 360 档案标题商机码 = 路由商机码', head.includes(OPP) && (await page.evaluate(() => location.hash)).includes(OPP), head.replace(/\s+/g, ' ').slice(0, 60));
    const d360 = await api('/api/opp/' + encodeURIComponent(OPP) + '/360');
    const L = d360.lights || {};
    const histText = await page.evaluate(() => document.querySelector('[data-agg="history"]').parentElement.querySelector('.t').textContent);
    const m = histText.match(/红 (\d+) · 黄 (\d+) · 绿 (\d+)/);
    check('UI-07 360 灯色汇总 红/黄/绿 = /api/opp/<code>/360 计数', !!d360.lights && !!m && +m[1] === (L.red || 0) && +m[2] === (L.yellow || 0) && +m[3] === (L.green || 0),
      'page=' + (m ? m.slice(1).join('/') : 'none') + ' api=' + [L.red || 0, L.yellow || 0, L.green || 0].join('/'));
    const pc = await style('#oppProfileCard', ['border-top-width', 'border-top-style']);
    check('UI-08 #oppProfileCard 有 4px 顶线', pc['border-top-width'] === '4px' && pc['border-top-style'] === 'solid', JSON.stringify(pc));

    // 5 评审事件详情(含原表对照): 取第一张有原表的评审单
    let rid = null, src = null;
    for (const r of (d360.reviews || [])) { const s = await api('/api/reviews/' + r.id + '/source').catch(() => null); if (s && s.source && s.source.file_name) { rid = r.id; src = s; break; } }
    if (!rid) { rid = 1; src = await api('/api/reviews/1/source'); }
    await go('#/review/' + rid, '#instSrc .srcv');
    await shot('05_review_' + rid + '_source');
    const srcHead = ((await page.textContent('#instSrc .srcv-head h3')) || '').trim();
    check('UI-09 原表面板标题 = /api/reviews/<id>/source 文件名', !!src.source && srcHead === src.source.file_name, 'rid=' + rid + ' head=' + srcHead);
    const ih = await style('#instHead', ['border-left-width', 'border-left-style']);
    check('UI-10 #instHead 有 4px 左线', ih['border-left-width'] === '4px' && ih['border-left-style'] === 'solid', JSON.stringify(ih));
    const okLight = ['红灯', '黄灯', '绿灯'];
    const lightPills = await page.evaluate(() => [...document.querySelectorAll('#page .pill')].map(e => e.textContent.trim()).filter(t => /灯$/.test(t)));
    check('UI-11 评审详情灯色标签文字只取 红灯/黄灯/绿灯', lightPills.every(t => okLight.includes(t)), 'n=' + lightPills.length + ' ' + [...new Set(lightPills)].join(','));
    const ban = await page.evaluate(() => { const b = document.querySelector('.light-banner.lb-red,.light-banner.lb-yellow,.light-banner.lb-green'); if (!b) return null; const k = b.className.match(/lb-(red|yellow|green)/)[1]; return { k, c: getComputedStyle(b).borderLeftColor }; });
    if (ban) { const want = await varColor('--light-' + ban.k); check('UI-12 灯色横幅左色条 = --light-' + ban.k, ban.c === want, ban.c + ' vs ' + want); }
    else out('INFO - 评审#' + rid + ' 无红黄绿横幅, UI-12 移到研判看板取样');
    // UI-07b: 8572 计数恰为 0/0/0, 另取本评审单所属商机做非零计数核对, 防零对零空转
    const code2 = ((await api('/api/reviews/' + rid)).review || {}).opp_code;
    if (code2) {
      await go('#/opp/' + encodeURIComponent(code2), '[data-agg="history"]');
      const L2 = (await api('/api/opp/' + encodeURIComponent(code2) + '/360')).lights || {};
      const t2x = await page.evaluate(() => document.querySelector('[data-agg="history"]').parentElement.querySelector('.t').textContent);
      const m2 = t2x.match(/红 (\d+) · 黄 (\d+) · 绿 (\d+)/);
      const sum2 = (L2.red || 0) + (L2.yellow || 0) + (L2.green || 0);
      check('UI-07b 有灯商机 360 红/黄/绿 = /api/opp/<code>/360 计数且非零', !!m2 && sum2 > 0 && +m2[1] === (L2.red || 0) && +m2[2] === (L2.yellow || 0) && +m2[3] === (L2.green || 0),
        code2 + ' page=' + (m2 ? m2.slice(1).join('/') : 'none') + ' api=' + [L2.red || 0, L2.yellow || 0, L2.green || 0].join('/'));
      await shot('04b_opp360_' + code2);
    } else check('UI-07b 评审单需有 opp_code', false, 'rid=' + rid);

    // 6 预算工作台 / 7 预算详情 / 8 交付明细
    await go('#/budgets', '#page .card');
    await shot('06_budgets');
    await go('#/budget-detail/1', '#budgetSrc .srcv');
    await shot('07_budget_detail_1');
    const bsText = await page.textContent('#budgetSrc');
    check('UI-13 预算详情原表面板含「原表里」', bsText.includes('原表里'));
    await go('#/delivery/1', '#page .card');
    await shot('08_delivery_1');

    // 9 任务中心 / 10 研判看板 / 11 归档库 / 12 对话窗
    await go('#/tasks', '#page .card');
    await shot('09_tasks');
    await go('#/judge', '#page .card');
    await shot('10_judge');
    if (!ban) {
      const b2 = await page.evaluate(() => { const b = document.querySelector('.light-banner.lb-red,.light-banner.lb-yellow,.light-banner.lb-green'); if (!b) return null; const k = b.className.match(/lb-(red|yellow|green)/)[1]; return { k, c: getComputedStyle(b).borderLeftColor }; });
      if (b2) { const want = await varColor('--light-' + b2.k); check('UI-12 灯色横幅左色条 = --light-' + b2.k, b2.c === want, b2.c + ' vs ' + want); }
      else check('UI-12 灯色横幅左色条(需至少一处横幅样本)', false, '评审详情与研判看板均无横幅');
    }
    await go('#/archive', '#page .card');
    await shot('11_archive');
    const arcPills = await page.evaluate(() => [...document.querySelectorAll('#page .pill')].map(e => e.textContent.trim()).filter(t => /灯$/.test(t)));
    check('UI-14 归档库灯色标签非空且文字合法', arcPills.length > 0 && arcPills.every(t => ['红灯', '黄灯', '绿灯'].includes(t)), 'n=' + arcPills.length + ' ' + [...new Set(arcPills)].join(','));
    await go('#/agent', '#page .card');
    await shot('12_agent');

    // 13 系统设置(admin 才能进)
    const users = ((await api('/api/users')) || {}).users || [];
    const adminName = (users.find(u => u.role === 'admin') || {}).username;
    if (adminName) {
      phase = 'relogin-admin';
      await page.evaluate(() => logout());
      await page.waitForSelector('#lu');
      await page.fill('#lu', adminName);
      await page.fill('#lp', '123456');
      await page.click('button:has-text("登 录")');
      await page.waitForSelector('.app-shell');
      await go('#/admin/llm', '#page .card');
      await shot('13_settings');
      check('UI-15 系统设置页由 admin 打开且有卡片', (await page.locator('#page .card').count()) > 0, 'admin=' + adminName);
    } else check('UI-15 系统设置页(用户表需有 admin)', false, 'no admin');

    // 14 390px 窄屏原表对照
    phase = 'narrow';
    await page.setViewportSize({ width: 390, height: 844 });
    await go('#/budget-detail/1', '#budgetSrc .srcv');
    await page.waitForTimeout(400);
    await shot('14_narrow_390_source');
    const nar = await page.evaluate(() => {
      const g = document.querySelector('#budgetSrc .srcv-grid');
      const cols = g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length : -1;
      return { cols, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
    });
    check('UI-16 390px .srcv-grid 单列且无横向溢出', nar.cols === 1 && nar.sw <= nar.cw, JSON.stringify(nar));

    await page.waitForTimeout(500);
    check('UI-17 console.error 与 pageerror 均为 0', errs.length === 0, errs.slice(0, 4).join(' | '));
  } finally { await browser.close(); }
})().catch(e => { fail++; out('FAIL - ' + String(e.stack || e)); }).finally(() => {
  out(pass + ' passed, ' + fail + ' failed' + (fail ? '' : ' -> ALL PASS'));
  fs.writeFileSync(LOGF, log, 'utf8');
  process.exitCode = fail ? 1 : 0;
});
