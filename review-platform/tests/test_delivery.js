// 附3 交付成本评估明细(上传解析+在线编辑+递进门禁) 专项: D-01~D-08(服务运行中)
// 用法: node tests/test_delivery.js [--log=tests/green_stage3_delivery.txt]
// 锚定: PL00008572 原件解析(实施 PM5+正编39+生产184 / 运维 PM2, 与附3合计行一致);
//   行成本 = (pm+own)×rateFor(dev_dept) + rd×995 + prod×320(与附1 交付成本口径同源)
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const XLSX_8572 = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');

async function raw(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function api(token, reqPath, method, body) {
  const r = await raw(token, reqPath, method, body);
  if (r.status >= 400) throw new Error(reqPath + ' -> ' + r.status + ' ' + (r.data.error || ''));
  return r.data;
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).token;
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name;
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

(async () => {
  const sales = await login('sales1');
  const fin = await login('fin1');
  const GREEN_BUDGET = { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, project_name: '附3测试预算', customer: '附3客户' };

  // ---- 预置: 建预算单(dev_dept=交付处, rate 1696) ----
  const bg = (await api(sales, '/api/budget', 'POST', { project_name: '附3测试预算' })).id;
  await api(sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });

  // D-01: 上传 PL00008572 原件解析(锚定: 实 PM5/正编39/生产184, 运维 PM2)
  {
    const data = fs.readFileSync(XLSX_8572).toString('base64');
    const r = await raw(sales, `/api/budget/${bg}/delivery/import`, 'POST', { filename: 'PL00008572-附3.xlsx', data });
    const d = r.data || {};
    check('D-01', '上传解析 200', r.status === 200);
    const s = d.sum || {};
    check('D-01', '解析锚定: 正编39/生产184/PM合计7', s.own_pd === 39 && s.prod_pd === 184 && s.pm_pd === 7);
    check('D-01', '与原件合计行一致(total_row 对照)', near(d.total_row && d.total_row.impl_own, 39, 0.01) && near(d.total_row && d.total_row.impl_prod, 184, 0.01));
    const rows = d.rows || [];
    check('D-01', '12 行(含零人天建设内容底稿)且内容来自建设内容回退链',
      rows.length === 12 && rows.every(x => /POI数据/.test(x.content)));
    check('D-01', '附3差旅字段存在且进入 sum',
      rows.every(x => typeof x.travel_cost === 'number') && typeof s.travel_cost === 'number');
    check('D-01', '实施行成本=139504(=(5+39)×1696+184×320+6000差旅)',
      near(rows[0] && rows[0].cost, 139504, 1));
    check('D-01', '运维行成本=3392(=2×1696, 与附3运维 PM 金额同源)', near(rows[1] && rows[1].cost, 3392, 1));
  }

  // DA: 附3 解析溯源 audit(row_sources 坐标 + 原表 grid 逐格对账)——证据即所见
  {
    const data = fs.readFileSync(XLSX_8572).toString('base64');
    const r = await raw(sales, `/api/budget/${bg}/delivery/import`, 'POST', { filename: 'PL00008572-附3.xlsx', data });
    const d = r.data || {};
    const au = d.audit || {};
    check('DA-01', 'import 响应附 audit(row_sources 与 rows 等长 + grid 非空)', (au.row_sources || []).length === (d.rows || []).length && (au.grid || []).length >= 10, `rs=${(au.row_sources || []).length} rows=${(d.rows || []).length} grid=${(au.grid || []).length}`);
    const gridAt = p => { for (const row of (au.grid || [])) { const c = (row || []).find(x => x.r === p[0] && x.c === p[1]); if (c) return c.v; } return undefined; };
    let bad = 0;
    (au.row_sources || []).forEach((s, i) => {
      const row = (d.rows || [])[i];
      if (!row) { bad++; return; }
      if (String(gridAt(s.content_pos) || '').replace(/\s/g, '') !== String(row.content || '').replace(/\s/g, '')) bad++;
      ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd'].forEach(k => {
        if (s.cols && s.cols[k]) {
          const gv = gridAt(s.cols[k]);
          const gnum = gv === undefined || gv === '' ? 0 : parseFloat(gv); // 空格=0(稀疏网格不含空格子)
          if (isNaN(gnum) || Math.abs(gnum - row[k]) > 0.01) bad++;
        }
      });
      if (s.cols && s.cols.travel_cost) {
        const gv = gridAt(s.cols.travel_cost);
        const gnum = gv === undefined || gv === '' ? 0 : parseFloat(gv);
        if (isNaN(gnum) || Math.abs(gnum - row.travel_cost) > 0.01) bad++;
      }
    });
    check('DA-02', '逐格对账: content_pos 与 cols 坐标上的原表值与解析行一致', (au.row_sources || []).length >= (d.rows || []).length && (d.rows || []).length > 0 && bad === 0, 'rs=' + (au.row_sources || []).length + ' mismatches=' + bad);
    check('DA-02b', '每条解析行都有差旅来源坐标', (au.row_sources || []).length > 0 && (au.row_sources || []).every(s => s.cols && Array.isArray(s.cols.travel_cost)));
    check('DA-03', 'audit.meta 含 sheet 名与列定位 cols', /交付/.test((au.meta || {}).sheet || '') && !!(au.meta || {}).cols);
  }

  // D-02: GET 回显(含行成本与源文件)
  {
    const d = await api(sales, `/api/budget/${bg}/delivery`);
    check('D-02', '回显 12 行+sum+源文件名', (d.rows || []).length === 12 && !!d.sum && /PL00008572/.test(d.source_file || ''));
  }

  // D-03: 在线编辑(建设内容基础上修改): 改一行 + 加一行
  {
    const d0 = await api(sales, `/api/budget/${bg}/delivery`);
    const rows = d0.rows.map(r => ({ ...r }));
    rows[0].own_pd = 40; rows[0].prod_pd = 190; // 39->40, 184->190
    rows.push({ content: '追加交付物', stage: '实施', pm_pd: 1, own_pd: 3, prod_pd: 6, travel_cost: 500 });
    const d = await api(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows });
    const s = d.sum || {};
    check('D-03', '修改+加行保存(正编 40+3=43)', s.own_pd === 43 && s.prod_pd === 196 && s.pm_pd === 8);
    check('D-03', '差旅保存并计入行成本',
      near((d.rows || []).find(r => r.content === '追加交付物').cost, 9204, 1) && near(s.travel_cost, 6500, 0.01));
  }

  // D-04: 递进门禁——新单无明细锁定 400; 本单(有明细)可锁定
  {
    const nb = (await api(sales, '/api/budget', 'POST', { project_name: '门禁对照-无明细' })).id;
    await api(sales, `/api/budget/${nb}`, 'PUT', { fields: GREEN_BUDGET });
    const bad = await raw(sales, `/api/budget/${nb}/lock`, 'POST');
    check('D-04', '无交付明细锁定被拦(400 递进门禁)', bad.status === 400 && /交付明细/.test(bad.data.error || ''));
    const okL = await raw(sales, `/api/budget/${bg}/lock`, 'POST');
    check('D-04', '有交付明细锁定 200', okL.status === 200);
  }

  // D-05: 递进回写(apply)——锁定前在另一单验证四科目回写
  {
    const nb = (await api(sales, '/api/budget', 'POST', { project_name: 'apply 测试单' })).id;
    await api(sales, `/api/budget/${nb}`, 'PUT', { fields: GREEN_BUDGET });
    await api(sales, `/api/budget/${nb}/delivery`, 'PUT', {
      rows: [{ content: '回写源', stage: '实施', pm_pd: 7, own_pd: 39, prod_pd: 184, travel_cost: 6000 }]
    });
    const d = await api(sales, `/api/budget/${nb}/delivery/apply`, 'POST');
    const f = d.fields || {};
    check('D-05', '五科目回写含 del_travel=6000',
      f.dev_pd === 39 && near(f.pm_cost, 11872, 1) && f.prod_pd === 184 && f.del_travel === 6000);
    const c = d.calc || {};
    check('D-05', '预算重算含交付差旅', near(c.delivery, 142896, 1));
  }

  // D-06: 权限——非 owner 编辑 403
  {
    const r = await raw(fin, `/api/budget/${bg}/delivery`, 'PUT', { rows: [] });
    check('D-06', '非 owner 编辑交付明细 403', r.status === 403);
  }

  // D-07: 锁定后编辑 400(bg 已在 D-04 锁定)
  {
    const r = await raw(sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'x', own_pd: 1 }] });
    check('D-07', '锁定后编辑明细 400(提示新建版本)', r.status === 400 && /锁定/.test(r.data.error || ''));
  }

  // D-08: import 权限+脏文件容错
  {
    const r403 = await raw(fin, `/api/budget/${bg}/delivery/import`, 'POST', { filename: 'x.xlsx', data: Buffer.from('not-excel').toString('base64') });
    check('D-08', '非 owner 上传 403', r403.status === 403);
    const nb = (await api(sales, '/api/budget', 'POST', { project_name: '脏文件对照' })).id;
    const rBad = await raw(sales, `/api/budget/${nb}/delivery/import`, 'POST', { filename: 'bad.xlsx', data: Buffer.from('not-excel').toString('base64') });
    check('D-08', '非 xlsx 文件解析失败提示(不崩, 提示可手编)', rBad.status === 502 || rBad.status === 400);
  }

  // D-09: 附1上下文成本行按业务坐标提取，不把金额写成人天
  {
    const data = fs.readFileSync(XLSX_8572).toString('base64');
    const r = await raw(sales, '/api/budget/import', 'POST', { filename: 'PL00008572-附1.xlsx', data });
    const f = (r.data || {}).fields || {};
    const src = (((r.data || {}).audit || {}).sources) || {};
    check('D-09', '附1上下文四金额字段进入预算草稿', r.status === 200 &&
      ['rd_outsource', 'del_travel', 'pm_cost', 'del_other'].every(k => Object.prototype.hasOwnProperty.call(f, k)));
    check('D-09', '附1上下文字段都有原表值坐标',
      ['rd_outsource', 'del_travel', 'pm_cost', 'del_other'].every(k => src[k] && Array.isArray(src[k].val_positions) && src[k].val_positions.length >= 1));
    check('D-09', 'G19/G21 金额未污染 dev_pd/prod_pd', f.dev_pd !== 39 * 1696 && f.prod_pd !== 184 * 320);
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
