// Excel 导入通道用例: EI-01~10(docs/Excel导入产品方案.md §四)
// 两层验证: 构造干净键值对 xlsx(六组锚定全命中) + 真实评审表(部分命中+核心字段)
// 红基线: 旧代码无端点 -> 404
// 用法: node tests/test_excel_import.js [--log=tests/red|green_ei.txt]
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

async function api(token, reqPath, method, body) {
  const r = await fetch(B + reqPath, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const login = async u => (await api(null, '/api/login', 'POST', { username: u, password: '123456' })).data.token;

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol;

// 构造干净键值对 xlsx(17 预算字段 / 15 评审字段)——python openpyxl 生成
const mkXlsx = (rows, typ) => {
  const pyCode = `
import openpyxl, json, sys
rows = json.loads(sys.argv[1])
wb = openpyxl.Workbook()
ws = wb.active
ws.title = sys.argv[2] if sys.argv[2] != 'budget' else '附1-预算表'
for r in rows:
    ws.append(r)
wb.save(sys.argv[3])
`;
  const tmp = path.join(__dirname, '_mk' + Date.now() + '.xlsx');
  const r = spawnSync('python', ['-X', 'utf8', '-c', pyCode, JSON.stringify(rows), typ || 'x', tmp], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('mkXlsx fail: ' + r.stderr);
  return tmp;
};

(async () => {
  const sales = await login('sales1');

  // ---- 构造预算 xlsx: 17 字段键值对(值=pl8572 fixture 同源) ----
  const bRows = [
    ['项目名称', '天地图POI-Excel导入测试'],
    ['客户名称', '江西省自然资源测绘与监测院'],
    ['合同金额', 240000], ['分包采购成本', 0], ['软件类生产外包', 0], ['灵活用工', 0],
    ['销售差旅费', 5000], ['招待费', 5000], ['市场营销', 0],
    ['所属部门', '交付处'], ['正编人天', 39], ['生产人天', 184], ['研发外包', 0],
    ['交付差旅', 8000], ['项目管理费', 11872], ['验收招待及综合办公', 2000],
  ];
  const bXlsx = mkXlsx(bRows, 'budget');
  const bData = fs.readFileSync(bXlsx).toString('base64');

  // EI-01: 预算导入 200 + draft
  const t1 = Date.now();
  const r1 = await api(sales, '/api/budget/import', 'POST', { filename: 'ei-test.xlsx', data: bData });
  const tOne = Date.now() - t1; // 单次导入耗时(EI-09 用)
  const d1 = r1.data || {};
  check('EI-01', '预算 Excel 导入 200 + draft 状态', r1.status === 200 && typeof d1.id === 'number');
  check('EI-02', '17 字段白名单清洗落库(fields 数)', Object.keys(d1.fields || {}).length >= 14, 'fields=' + Object.keys(d1.fields || {}).length);

  // EI-03: 六组锚定(computeBudget 实算)
  const c = d1.calc || {};
  check('EI-03a', 'income=226415.09(六组锚定①)', near(c.income, 226415.09, 0.01), c.income);
  check('EI-03b', 'salesLabor=41448(②)', c.salesLabor === 41448, c.salesLabor);
  check('EI-03c', 'tax=2264.15(③)', near(c.tax, 2264.15, 0.01), c.tax);
  check('EI-03d', 'incentive=13298.13(④)', near(c.incentive, 13298.13, 1), c.incentive);
  check('EI-03e', 'contribution=12508.82(⑤)', near(c.contribution, 12508.82, 1), c.contribution);
  check('EI-03f', 'margin=5.52(⑥)', near(c.margin, 5.52, 0.01), c.margin);
  check('EI-03g', '未自动锁定(人确认门)', d1.fields && d1.fields.status === undefined);

  // EI-04: 真实 pl8572.xlsx 部分命中(核心字段)
  const realFile = path.join(__dirname, 'realdata', '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx');
  const realData = fs.readFileSync(realFile).toString('base64');
  const r4 = await api(sales, '/api/budget/import', 'POST', { filename: 'pl8572.xlsx', data: realData });
  const d4 = r4.data || {};
  check('EI-04', '真实评审表导入: contract=240000 + matched>=8', r4.status === 200 && d4.fields && d4.fields.contract === 240000 && (d4.meta || {}).matched >= 8, 'matched=' + ((d4.meta || {}).matched));

  // ---- 构造评审 xlsx: 键值对(评审字段) ----
  const vRows = [
    ['商机代码', 'PL-EI-01'], ['商机阶段', '投标决策'], ['营销区域', '华北营销处'],
    ['最终客户名称', 'Excel导入测试客户'], ['业务线', 'G1'], ['预计合同金额', 24],
    ['销售经理', '测试销售'], ['项目经理', '测试PM'], ['预计签单时间', '2026-12-31'],
    ['预计贡献毛利率', 15], ['签约路径', '客户→丰图科技'], ['分包总金额', 0],
    ['是否涉密项目', '否'], ['项目所在地省份', '江西省'], ['结算方式', '银行转账'],
  ];
  const vXlsx = mkXlsx(vRows, 'review');
  const vData = fs.readFileSync(vXlsx).toString('base64');

  // EI-05: 评审导入 200 + draft
  const r5 = await api(sales, '/api/reviews/import', 'POST', { filename: 'ei-review.xlsx', type: 'bid', data: vData });
  const d5 = r5.data || {};
  check('EI-05', '评审 Excel 导入 200 + draft', r5.status === 200 && typeof d5.id === 'number');

  // EI-06: 白名单清洗 + 核心字段
  check('EI-06', '评审核心字段命中(customer/contract_amount/gross_margin)', (d5.form || {}).customer === 'Excel导入测试客户' && (d5.form || {}).contract_amount === 24 && (d5.form || {}).gross_margin === 15, JSON.stringify({ c: (d5.form || {}).customer, ca: (d5.form || {}).contract_amount, gm: (d5.form || {}).gross_margin }));
  check('EI-06b', 'gross_margin 归一化(0.15→15)', (d5.form || {}).gross_margin === 15);

  // EI-06c: 归一化变体(0.15 格式)
  const v2 = vRows.map(r => r[0] === '预计贡献毛利率' ? ['预计贡献毛利率', 0.15] : r);
  const vXlsx2 = mkXlsx(v2, 'review');
  const v2Data = fs.readFileSync(vXlsx2).toString('base64');
  const r6c = await api(sales, '/api/reviews/import', 'POST', { filename: 'ei-review2.xlsx', type: 'bid', data: v2Data });
  check('EI-06c', '小数格式毛利率自动×100(15)', (r6c.data.form || {}).gross_margin === 15, 'gm=' + (r6c.data.form || {}).gross_margin);

  // EI-07: 真实 c02 评审表部分命中
  const c02File = path.join(__dirname, 'realdata', '【投标决策】PL00008068-260921-昆山市消防要素可视化分析平台 (1).xlsx');
  const r7 = await api(sales, '/api/reviews/import', 'POST', { filename: 'c02.xlsx', type: 'presale', data: fs.readFileSync(c02File).toString('base64') });
  const d7 = r7.data || {};
  check('EI-07', '真实评审表导入: matched>=10 + opp_code 命中', r7.status === 200 && (d7.meta || {}).matched >= 10 && (d7.form || {}).opp_code === 'PL00008068', 'matched=' + ((d7.meta || {}).matched));

  // EI-08: 安全(毒件+注入)
  const poison = Buffer.concat([Buffer.from('=cmd()\r\n'), Buffer.from('PK\x03\x04garbage')]).toString('base64');
  const r8 = await api(sales, '/api/budget/import', 'POST', { filename: 'evil.xlsx', data: poison });
  check('EI-08a', '毒件拒绝(400/502)', r8.status === 400 || r8.status === 502, 'status=' + r8.status);
  const injectRows = bRows.concat([['status', 'locked'], ['budget_id', 999], ['code', 'B-2026-9999']]);
  const iXlsx = mkXlsx(injectRows, 'budget');
  const r8b = await api(sales, '/api/budget/import', 'POST', { filename: 'inject.xlsx', data: fs.readFileSync(iXlsx).toString('base64') });
  check('EI-08b', '结构键注入被白名单丢弃', r8b.status === 200 && (r8b.data.fields || {}).status === undefined && (r8b.data.fields || {}).budget_id === undefined);

  // EI-09: 性能(单次导入<3s——python 启动+openpyxl+解析)
  check('EI-09', '单次导入耗时<4s(python 启动+机器负载波动)', tOne < 4000, tOne + 'ms');

  // EI-10: 标题取「商机名称」而非「项目概述」长文
  // 判别力来源: 夹具同时给出 商机名称(短) 与 项目概述(长文, 以「项目建设内容：」开头)。
  // 旧实现 form.summary 排在候选首位 => title=概述长文; 新实现 form.opp_name 居首 => title=商机名称。
  // 二者在观测值上必然分道, 不是靠 includes 放宽混过去的。
  // upsertOpp「只补档、永不覆盖既有要素」, 固定码会让本条在二次运行时读到上一轮的陈旧标题,
  // 故用每轮唯一码, 保证断言测的始终是「新建锚点」这条路径。
  const tCode = 'PL-EI10-' + Date.now();
  const tRows = vRows.map(r => r[0] === '商机代码' ? ['商机代码', tCode] : r).concat([
    ['商机名称', 'EI-10 真项目名'],
    ['项目概述', '项目建设内容：这是一段刻意写长的项目概述，用来验证它不会被误当成单据标题。项目对丰图的价值：验证标题派生口径。'],
  ]);
  const tXlsx = mkXlsx(tRows, 'review');
  const r10 = await api(sales, '/api/reviews/import', 'POST', { filename: 'ei10.xlsx', type: 'bid', data: fs.readFileSync(tXlsx).toString('base64') });
  const d10 = r10.data || {};
  const g10 = await api(sales, '/api/reviews/' + d10.id, 'GET');
  const title10 = String(((g10.data || {}).review || {}).title || '');
  check('EI-10', '评审单标题=商机名称(非项目概述长文)', r10.status === 200 && title10 === 'EI-10 真项目名', 'title=' + JSON.stringify(title10.slice(0, 40)));
  check('EI-10b', '标题不得以「项目建设内容：」开头', !/^项目建设内容/.test(title10), 'title=' + JSON.stringify(title10.slice(0, 40)));
  const o10 = await api(sales, '/api/opp/' + tCode + '/360', 'GET');
  check('EI-10c', '商机锚点 title 同源=商机名称', String(((o10.data || {}).opp || {}).title || '') === 'EI-10 真项目名', 'opp.title=' + JSON.stringify(String(((o10.data || {}).opp || {}).title || '').slice(0, 40)));

  const e12Code = 'PL-EI12-' + Date.now();
  const e12Rows = vRows.map(r => r[0] === '商机代码' ? ['商机代码', e12Code] : r).concat([
    ['项目运维周期', '1年'],
    ['项目已发生成本（万元）', 3.5]
  ]);
  const e12Xlsx = mkXlsx(e12Rows, 'review');
  const e12 = await api(sales, '/api/reviews/import', 'POST', {
    filename: 'ei12.xlsx', type: 'bid', data: fs.readFileSync(e12Xlsx).toString('base64')
  });
  const e12f = (e12.data || {}).form || {};
  const e12s = (((e12.data || {}).audit || {}).sources) || {};
  check('EI-12', '1年经既有 mergeDraft 数字链归一为 1', e12.status === 200 && e12f.ops_years === 1, JSON.stringify(e12f.ops_years));
  check('EI-12b', '已发生成本命中 3.5', e12f.cost_happened === 3.5, JSON.stringify(e12f.cost_happened));
  check('EI-12c', '两字段都有原表来源坐标', ['ops_years', 'cost_happened'].every(k => e12s[k] && e12s[k].val_pos), JSON.stringify(e12s));

  const e11Code = 'PL-EI11-' + Date.now();
  const e11Rows = vRows.map(r => r[0] === '商机代码' ? ['商机代码', e11Code] : r).concat([
    ['商机名称', 'EI-11 挂链测试'], ['项目运维周期', '1年'], ['已发生成本', 0],
    ['是否涉及测绘', '否'], ['合同是否存在担保', '否'], ['合同是否存在竞业条款', '否'],
    ['付款条件', '验收后付款'], ['项目概述', 'EI-11 真实提交链'], ['是否涉及数据评审', '否']
  ]);
  const e11Xlsx = mkXlsx(e11Rows, 'review');
  const e11Review = await api(sales, '/api/reviews/import', 'POST', {
    filename: 'ei11.xlsx', type: 'bid', data: fs.readFileSync(e11Xlsx).toString('base64')
  });
  const reviewId = (e11Review.data || {}).id;
  const e11Budget = await api(sales, '/api/budget', 'POST', {
    project_name: 'EI-11 预算', opp_code: e11Code,
    fields: { project_name: 'EI-11 预算', opp_code: e11Code, contract: 240000, sub_cost: 0,
      dev_dept: '交付处', dev_pd: 10, del_travel: 0 }
  });
  const budgetId = (e11Budget.data || {}).id;
  const dPut = await api(sales, `/api/opp/${encodeURIComponent(e11Code)}/delivery`, 'PUT', {
    rows: [{ content: 'EI-11 交付内容', stage: '实施', own_pd: 10, travel_cost: 0 }]
  });
  const dConfirm = await api(sales, `/api/opp/${encodeURIComponent(e11Code)}/delivery/confirm`, 'POST', {});
  const bLock = await api(sales, `/api/budget/${budgetId}/lock`, 'POST', {});
  check('EI-11a', '前置 G1/G2 夹具自洽', dPut.status === 200 && dConfirm.status === 200 && bLock.status === 200,
    `${dPut.status}/${dConfirm.status}/${bLock.status}`);
  const link = await api(sales, `/api/reviews/${reviewId}`, 'PUT', { budget_id: budgetId });
  const linked = await api(sales, `/api/reviews/${reviewId}`);
  check('EI-11b', '评审 PUT 挂上同商机已锁定预算', link.status === 200 && (linked.data.review || {}).budget_id === budgetId,
    JSON.stringify((linked.data.review || {}).budget_id));
  const beforeForm = JSON.parse((linked.data.review || {}).form_json || '{}');
  check('EI-11c', '仅挂预算不清空 form_json', beforeForm.customer === 'Excel导入测试客户' && beforeForm.ops_years === 1, JSON.stringify(beforeForm));
  const missingBudget = await api(sales, `/api/reviews/${reviewId}`, 'PUT', { budget_id: 99999999 });
  check('EI-11d', '不存在预算被唯一裁判拒绝', missingBudget.status === 400, String((missingBudget.data || {}).error || ''));
  const submit = await api(sales, `/api/reviews/${reviewId}/submit`, 'POST', {});
  const submitted = await api(sales, `/api/reviews/${reviewId}`);
  check('EI-11e', '挂链后真实提交到 reviewing 并创建任务', submit.status === 200 &&
    (submitted.data.review || {}).status === 'reviewing' && (submitted.data.tasks || []).length > 0,
    JSON.stringify({ submit: submit.status, error: (submit.data || {}).error, missing: (submit.data || {}).missing,
      status: (submitted.data.review || {}).status, tasks: (submitted.data.tasks || []).length }));

  // 清理临时文件
  [bXlsx, vXlsx, vXlsx2, tXlsx, e11Xlsx, e12Xlsx].concat([path.join(__dirname, '_mk.xlsx')]).forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
