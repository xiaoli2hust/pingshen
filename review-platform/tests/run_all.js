// 阶段 2/3 · 全套测试聚合入口(收工门一键复跑)
// 用法: node tests/run_all.js [--log=文件路径]
// 前置: 8600 服务运行中(node server.js); test_agent_chat 自带 9801 桩+config 改写/恢复;
//       test_security_notify 自带 9802 webhook 桩; test_bi 自带 SQLite 直查断言源
// 顺序: F(纯函数) -> A核心(纯函数) -> API(HTTP) -> A对话(HTTP+桩) -> 规则矩阵 -> 通知/结论/关联 -> 附3明细 -> BI -> 双回归 -> 数据可行性
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

// 声明式覆盖缺口固定清单(R-66)。四条见证要求 reviews.era 出现在非归档态, 或同一行改 era;
// 全仓 era 唯一业务写入点是历史导入(server.js 内 INSERT ... 'archived' ... 'history'), 无改 era 端点,
// 归档态亦无任何状态守卫可退出——故这些状态组合无已授权 HTTP 产地。恢复 SQL 造态违反红线,
// 新增改 era 的生产端点属规格外写路径, 两者都不采。见证改由 test_flow_remediation 的 ERA-* 源码不变式钉住。
// 清单是双向棘轮: 出现清单外缺口即红, 清单内任一缺口消失(能力恢复或被静默删除)同样即红。
const DECLARED_GAPS = ['CH-11b', 'C2-11-identity', 'OD-08-inflight', 'OD-09-flip'];

const logFile = process.argv.find(a => a.startsWith('--log='));
let log = '';
const out = s => { console.log(s); log += s + '\n'; };

// 预检: 8600 服务在线(HTTP 测试脚本都依赖它)
(async () => {
  let ok = false;
  try { ok = (await fetch('http://127.0.0.1:8600/api/me')).status === 401; } catch (e) {}
  if (!ok) { console.error('预检失败: 8600 服务未运行, 请先启动 node server.js'); process.exit(1); }

  const SUITES = [
    ['F-01~15 财务引擎(纯函数)', [NODE, ['--test', 'tests/test_finance.js']]],
    ['A-05~07/13 agent 核心(纯函数)', [NODE, ['--test', 'tests/test_agent_core.js']]],
    ['RO-01~04 机器人编排纯函数', [NODE, ['--test', 'tests/test_robot_orchestrator.js']]],
    ['API-01~20+S-01~06 预算 API(HTTP)', [NODE, ['tests/test_budget_api.js']]],
    ['A-01~04/A-08~18 对话流(HTTP+桩)', [NODE, ['tests/test_agent_chat.js']]],
    ['RW-01~16 机器人工作台与外发箱(HTTP)', [NODE, ['tests/test_robot_workbench.js']]],
    ['R-01~34 规则矩阵 preview-light + 闭环/SEC', [NODE, ['tests/test_rules_e2e.js']]],
    ['API-21~23/R-33/J/N 通知与结论(HTTP+webhook 桩)', [NODE, ['tests/test_security_notify.js']]],
    ['D-01~08 附3交付明细(上传解析+递进门禁)', [NODE, ['tests/test_delivery.js']]],
    ['BI-01~12 归档库 BI(直查同源+对抗)', [NODE, ['tests/test_bi.js']]],
    ['T3 门禁口径 bid+presale', [NODE, ['tests/test_gate_presale.js']]],
    ['EI-01~09 Excel 导入(六组锚定+安全+性能)', [NODE, ['tests/test_excel_import.js']]],
    ['IS-* Excel 原表存证(解析器/纯函数+HTTP 来源契约)', [NODE, ['tests/test_import_source.js']]],
    ['HI-01~06 历史数据承接', [NODE, ['tests/test_history_import.js']]],
    ['OC-01~06 商机代码贯穿', [NODE, ['tests/test_opp_thread.js']]],
    ['OP-01~14 商机档案 CRUD(HTTP)', [NODE, ['tests/test_opp_api.js']]],
    ['DL-01~23 商机级交付预算(G1 确认门+分流+派生列守护)', [NODE, ['tests/test_delivery_opp.js']]],
    ['CH-01~16b 三步链门禁(G2/G3/G4 六态+D-23 反事实锚)', [NODE, ['tests/test_chain.js']]],
    ['RQ-01~10 必填单源注册表(meta/fields+提交门)', [NODE, ['tests/test_required.js']]],
    ['C2-01~11 360 聚合契约(delivery 八键/chain 五键/D-19 403 边界/rate 分支实执行)', [NODE, ['tests/test_opp360.js']]],
    ['PA-* 解析器全字段对账(原表审计)', [NODE, ['tests/test_parser_audit.js']]],
    ['PL-01~08 解析器实验室(admin 实测+调优)', [NODE, ['tests/test_parser_lab.js']]],
    ['LM-01~14 LLM 管理中心(profile/探针/用量/降级)', [NODE, ['tests/test_llm_admin.js']]],
    ['RB-01~11 机器人管理中心(实例/矩阵/白名单/双轨不双推)', [NODE, ['tests/test_robot_admin.js']]],
    ['OD-01~10 对话式建档 + 灯色聚合视图', [NODE, ['tests/test_opp_dialog.js']]],
    ['HL-1~4 实验室浏览器层', [NODE, ['tests/h_lab_shots.js']]],
    ['NAV-* 商机中枢导航浏览器层', [NODE, ['tests/h_nav_shots.js']]],
    ['IA-1~26 商机中枢IA浏览器层', [NODE, ['tests/h_ia_shots.js']]],
    ['SC-* Excel 原表对照浏览器层', [NODE, ['tests/h_source_compare.js']]],
    ['AW-01~07 机器人统一工作台浏览器层', [NODE, ['tests/h_robot_workbench_shots.js']]],
    ['AD-01~15 管理中心浏览器层(#/admin/llm + #/admin/robot)', [NODE, ['tests/h_admin_shots.js']]],
    ['EV/RD/IA/SM/NT 业务整改 HTTP 专项', [NODE, ['tests/test_flow_remediation.js']]],
    ['EV/RD/IA/SM/NT 业务整改浏览器专项', [NODE, ['tests/h_remediation_shots.js']]],
    ['RG-01~06 全量汇总真实性(隔离子进程结果)', [NODE, ['tests/test_run_all_contract.js']]],
    ['BP-01~06 预算预选与当前关联保真', [NODE, ['tests/test_budget_preselect.js']]],
    ['FS-01~12 前端状态与只读证据语义', [NODE, ['tests/test_frontend_semantics.js']]],
    ['回归 test_flow.js', [NODE, ['test_flow.js']]],
    ['回归 test_p15_flow.js', [NODE, ['test_p15_flow.js']]],
    ['数据可行性 data_feasibility_check.js', [NODE, ['tests/data_feasibility_check.js']]]
  ];
  const results = [];
  const seenGaps = new Set();
  const t0 = Date.now();
  for (const [name, [cmd, args]] of SUITES) {
    out(`\n==== ${name} ====`);
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: process.env?.RP_GUARD_TREE_TIMEOUT === '1' ? 0 : 300000 });
    const tail = (r.stdout || '').trim().split('\n').slice(-6).join('\n');
    out(tail || '(无输出)');
    if (r.status !== 0) out('(stderr 尾部)\n' + (r.stderr || '').trim().split('\n').slice(-4).join('\n'));
    const gapLines = [...new Set(((r.stdout || '') + '\n' + (r.stderr || '')).match(/^(?:NOT EXECUTABLE|COVERAGE GAP)\b.*$/gm) || [])];
    gapLines.forEach(line => out(line));
    const ids = gapLines.map(l => (l.match(/^(?:NOT EXECUTABLE|COVERAGE GAP)\s+(\S+)/) || [])[1]).filter(Boolean);
    ids.forEach(id => seenGaps.add(id));
    const undeclared = ids.filter(id => !DECLARED_GAPS.includes(id));
    results.push([name, r.status !== 0 ? 'FAIL' : undeclared.length ? 'COVERAGE GAP' : 'PASS']);
  }
  out('\n======== 汇总 ========');
  results.forEach(([name, status]) => out(status + '  ' + name));
  const failed = results.filter(r => r[1] === 'FAIL').length;
  const gaps = results.filter(r => r[1] === 'COVERAGE GAP').length;
  const passed = results.filter(r => r[1] === 'PASS').length;
  const lost = DECLARED_GAPS.filter(id => !seenGaps.has(id));
  const declared = [...seenGaps].filter(id => DECLARED_GAPS.includes(id));
  if (declared.length) out('声明缺口(见证未运行, 不得读作已覆盖): ' + declared.join(', '));
  if (lost.length) out('声明缺口消失(须重新裁定, 禁止静默全绿): ' + lost.join(', '));
  const verdict = failed ? 'SOME FAIL' : gaps ? 'COVERAGE GAP' : lost.length ? 'DECLARED GAP LOST' : 'ALL PASS';
  out(`\n${passed}/${results.length} 套通过, 失败 ${failed}, 未登记覆盖缺口 ${gaps}, 声明缺口 ${declared.length}/${DECLARED_GAPS.length}, 缺口消失 ${lost.length}, 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${verdict}`);
  if (logFile) { fs.writeFileSync(logFile.slice(6), log, 'utf8'); console.error('日志已写入 ' + logFile.slice(6)); }
  process.exit(failed || gaps || lost.length ? 1 : 0);
})();
