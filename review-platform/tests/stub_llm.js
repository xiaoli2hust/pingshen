// 阶段 2 H 系列人工验收用 LLM 常驻桩(9801): 按 user 消息关键字路由固定应答, 与 test_agent_chat.js 同套路
// 用法: node tests/stub_llm.js  +  config.json LLM_BASE_URL=http://127.0.0.1:9801
// 特殊路由: "降级测试" -> 返回无 JSON 内容(服务端 extractFields 解析失败 -> degraded=true, H-02 点选补齐)
const http = require('http');
const STUB_ROUTES = [
  [/降级测试/, null], // null = 返回纯文本, 触发降级
  [/合同|240\s*万/, { contract: 2400000, sub_cost: 1000000 }],
  [/交付处|人月|差旅/, { dev_dept: '交付处', dev_pd: 220, del_travel: 20000 }],
  [/80\s*万/, { sub_cost: 800000 }]
];
http.createServer((req, res) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let said = '';
    try {
      const userMsg = (JSON.parse(body || '{}').messages || []).filter(m => m.role === 'user').map(m => m.content).join('\n');
      said = (userMsg.split('用户说：')[1] || userMsg).trim(); // 只路由用户消息, 避免草稿 JSON 干扰
    } catch (e) {}
    let fields = null; // null 命中 = 降级应答
    for (const [re, f] of STUB_ROUTES) if (re.test(said)) { fields = f; break; }
    const content = fields === null
      ? '这个问题我无法用 JSON 回答。' // 无 {} 块 -> extractFields throw -> degraded
      : '```json\n' + JSON.stringify({ fields }) + '\n```';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    console.log('[stub] ' + (said.slice(0, 40) || '(空)') + ' -> ' + (fields === null ? '(降级)' : JSON.stringify(fields)));
  });
}).listen(9801, () => console.log('LLM stub on http://127.0.0.1:9801 (降级关键词: 降级测试)'));
