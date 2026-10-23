// 解析器全字段对账审计: PA-*(docs Excel导入 §四 补强)
// 铁律: 与导入路径同参(--sheet 按类型选表) + 原表键值对逐字段精确对账
// 用法: node tests/test_parser_audit.js [--log=tests/red|green_pa.txt]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};

// 与导入路径同参: --type review --sheet 选择对应评审类型
const audit = (file, sheet = '投标决策') => {
  const r = spawnSync('python', ['-X', 'utf8', path.join(__dirname, '..', 'tools', 'parse_form_xlsx.py'), file, '--type', 'review', '--sheet', sheet, '--audit'], { encoding: 'utf8', cwd: path.join(__dirname, '..'), timeout: 60000 });
  if (r.status !== 0) throw new Error('audit fail: ' + String(r.stderr).slice(0, 150));
  return JSON.parse(r.stdout);
};

// 关键标签(按表实际字段——8572 投标决策 sheet 无"项目经理")
const MUST_LABELS = {
  PL00008068: ['商机名称', '商机代码', '商机阶段', '最终客户名称', '业务线', '预计合同金额', '销售经理', '项目概述'],
  PL00008572: ['商机名称', '商机代码', '商机阶段', '最终客户名称', '业务线', '预计合同金额', '销售经理', '项目概述'],
  PL00008111: ['商机名称', '商机代码', '商机阶段', '最终客户名称', '业务线', '预计合同金额', '销售经理', '项目概述'],
};
// 标签→字段键(精确匹配标签, 不用 includes——includes 会命中"上游签约路径公司情况"等假差异)
const LABEL2KEY = {
  '商机名称': 'opp_name', '商机代码': 'opp_code', '商机阶段': 'opp_stage', '最终客户名称': 'customer',
  '业务线': 'biz_line', '预计合同金额': 'contract_amount', '销售经理': 'sales', '项目经理': 'pm',
  '项目概述': 'summary', '营销区域': 'region', '预计签单时间': 'sign_date', '签约路径': 'sign_path',
  '项目所在地省份': 'province', '结算方式': 'settle_method', '分包总金额': 'sub_amount',
};
const normVal = v => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  const n = parseFloat(s.replace(/[,，]/g, ''));
  if (!isNaN(n) && /^[\d.,，\s-]+$/.test(s)) return n;
  return s;
};
const valsEq = (a, b) => {
  const na = normVal(a), nb = normVal(b);
  if (na == null || nb == null) return false;
  if (typeof na === 'number' && typeof nb === 'number') return Math.abs(na - nb) < 0.01;
  return String(na) === String(nb);
};

const FILES = [
  '【投标决策】PL00008068-260921-昆山市消防要素可视化分析平台 (1).xlsx',
  '【投标决策】PL00008572-260918-江西省天地图POI数据服务项目（20260917).xlsx',
  '【投标决策】PL00008111-坪山区三维数据更新2026项目评审（20260810).xlsx',
];

(async () => {
  for (const f of FILES) {
    const short = f.match(/PL\d+/)[0];
    const a = audit(path.join(__dirname, 'realdata', f));
    const pairs = a.pairs || [], fields = a.fields || {};

    // PA-A: 覆盖率——关键标签在原表对账数据中(精确: pair 标签去空格后 === 或 startsWith)
    const labs = pairs.map(([l]) => String(l).replace(/[\s（）()]/g, ''));
    const missing = (MUST_LABELS[short] || []).filter(ml => !labs.some(l => l === ml || l.startsWith(ml)));
    check('PA-' + short + '-A', '原表关键标签齐全(审计有效性)', missing.length === 0, '缺: ' + missing.join(','));

    // PA-B: 逐字段值对账(精确标签匹配——原表标签值 === 解析字段值)
    let mismatches = [], covered = 0;
    for (const [lab, raw] of pairs) {
      const labN = String(lab).replace(/[\s（）()]/g, '');
      for (const [ml, key] of Object.entries(LABEL2KEY)) {
        if (labN === ml || labN.startsWith(ml)) {
          const pv = fields[key];
          if (pv === undefined) { mismatches.push(ml + '→' + key + ': 未采集(原表值=' + String(raw).slice(0, 12) + ')'); }
          else if (!valsEq(raw, pv)) { mismatches.push(ml + ': 原表=' + String(raw).slice(0, 10) + ' 解析=' + String(pv).slice(0, 10)); }
          else covered++;
        }
      }
    }
    check('PA-' + short + '-B', '逐字段对账 ' + covered + ' 项一致(原表值=解析值)', mismatches.length === 0, mismatches.slice(0, 3).join(' ; '));

    // PA-C: title 源字段(商机名称)为短名
    const nm = fields.opp_name;
    check('PA-' + short + '-C', '商机名称为短名(可作 title)', !!(nm && String(nm).length <= 30 && !/[，。；]/.test(String(nm))), JSON.stringify(nm));

    const dataReviewSource = (a.sources || {}).data_review || {};
    if (short === 'PL00008111') {
      check('PA-' + short + '-D', '旧模板用数据跨境/红线问题兜底 data_review=否', fields.data_review === '否', JSON.stringify(fields.data_review));
      check('PA-' + short + '-E', '旧模板 data_review 溯源到 G23/I23', dataReviewSource.label === '是否涉及数据跨境传输或红线禁止数据'
        && JSON.stringify(dataReviewSource.lab_pos) === '[22,6]' && JSON.stringify(dataReviewSource.val_pos) === '[22,8]', JSON.stringify(dataReviewSource));
    }
    if (short === 'PL00008572') {
      check('PA-' + short + '-D', '明确“是否涉及数据评审”优先于旧模板兜底问题', fields.data_review === '是', JSON.stringify(fields.data_review));
      check('PA-' + short + '-E', '明确 data_review 溯源到 A26/D26', dataReviewSource.label === '是否涉及数据评审'
        && JSON.stringify(dataReviewSource.lab_pos) === '[25,0]' && JSON.stringify(dataReviewSource.val_pos) === '[25,3]', JSON.stringify(dataReviewSource));
    }
  }

  const presale = audit(path.join(__dirname, 'fixtures', 'presale-period-date-range.xlsx'), '售前立项');
  const presaleSource = (presale.sources || {}).presale_period || {};
  check('PA-PRESALE-PERIOD-A', '售前日期区间按含首尾天数折算并向上取整为3个月', presale.fields && presale.fields.presale_period === 3, JSON.stringify(presale.fields && presale.fields.presale_period));
  check('PA-PRESALE-PERIOD-B', '售前周期溯源到 G11/I11', presaleSource.label === '预计售前实施周期'
    && JSON.stringify(presaleSource.lab_pos) === '[10,6]' && JSON.stringify(presaleSource.val_pos) === '[10,8]', JSON.stringify(presaleSource));

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  const logFile = process.argv.find(x => x.startsWith('--log='));
  if (logFile) fs.writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
