// 阶段 2 跑红汇总(红绿之"红"): 4 个新测试脚本在旧代码(阶段 1 终态)上执行, 全部必红
//   - test_finance / test_agent_core: require('../finance.js'/'../agent.js') MODULE_NOT_FOUND
//   - test_budget_api / test_agent_chat: /api/budget* 与 /api/agent/chat 一律 404 '接口不存在'
// 输出落盘 tests/red_evidence_stage2.txt(UTF-8, 规避 PowerShell 重定向乱码)
// 用法(仓库根目录): node tests/run_red_stage2.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const out = [];
const run = (title, cmd) => {
  out.push('='.repeat(72));
  out.push('== ' + title);
  out.push('== $ ' + cmd);
  out.push('='.repeat(72));
  try {
    out.push(String(execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })));
    out.push('[exit 0]');
  } catch (e) {
    out.push(String(e.stdout || ''));
    out.push(String(e.stderr || ''));
    out.push('[exit ' + e.status + ']');
  }
  out.push('');
};

run('F 系财务引擎单元(预期红: finance.js 不存在 -> MODULE_NOT_FOUND)', 'node --test tests/test_finance.js');
run('A 系 Agent 纯函数(预期红: agent.js 不存在 -> MODULE_NOT_FOUND)', 'node --test tests/test_agent_core.js');
run('API/S 系预算契约(预期红: /api/budget* 404 -> 全 FAIL)', 'node tests/test_budget_api.js');
run('A 系对话剧本(预期红: /api/agent/chat 404 -> 全 FAIL; 桩照常起停, config.json finally 恢复)', 'node tests/test_agent_chat.js');

out.push('='.repeat(72));
out.push('红证据结论: 4 脚本全红(finance.js/agent.js 不存在, 端点 404)。改造完成后须全部转绿。');
fs.writeFileSync(path.join(ROOT, 'tests', 'red_evidence_stage2.txt'), out.join('\n'), 'utf8');
console.log('已写入 tests/red_evidence_stage2.txt (' + out.join('\n').length + ' chars)');
