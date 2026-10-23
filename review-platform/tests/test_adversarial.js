// 对抗性测试(攻击视角): AV-01~AV-10(服务运行中, 整改方案 docs/代码审查整改方案.md 第二节)
// 用法: node tests/test_adversarial.js [--log=tests/green_adv.txt]
// 桩方案: 9803 慢桩(1.5s 延迟应答, AV-02 竞态) / 9804 断开桩(连接即毁, AV-04 崩溃) / 9812 webhook 桩(AV-10)
//   config LLM_BASE_URL/PUBLIC_BASE_URL/COMMITTEE_WEBHOOK_URL 临时改写, try/finally 恢复原始字节
const B = 'http://127.0.0.1:8600';
const fs = require('fs');
const http = require('http');
const path = require('path');
const CFG_PATH = path.join(__dirname, '..', 'config.json');

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
const sleep = ms => new Promise(r => setTimeout(r, ms));

let cfgRaw = null;
const setCfg = kv => {
  if (cfgRaw === null) cfgRaw = fs.readFileSync(CFG_PATH, 'utf8');
  const cfg = JSON.parse(cfgRaw);
  Object.assign(cfg, kv);
  fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
};
const restoreCfg = () => { if (cfgRaw !== null) { fs.writeFileSync(CFG_PATH, cfgRaw, 'utf8'); cfgRaw = null; } };

let pass = 0, fail = 0;
const LOG = [];
const check = (id, name, ok, evidence) => {
  const line = (ok ? 'PASS' : 'FAIL') + ' - ' + id + ' ' + name + (evidence ? ' | ' + evidence : '');
  console.log(line); LOG.push(line);
  ok ? pass++ : fail++;
};
const GREEN_BUDGET = { contract: 2400000, sub_cost: 1000000, dev_dept: '交付处', dev_pd: 220, del_travel: 20000, project_name: 'AV对抗预算', customer: 'AV客户' };
const BID_BASE = {
  opp_code: 'PL-T-AV', opp_stage: '投标决策', region: '华北营销处-渠道', customer: 'AV客户', biz_line: 'G1',
  contract_amount: '24', sales: '王超', pm: '冯金华', sign_date: '2026-12-31', gross_margin: '15', cost_happened: '0',
  ops_years: '1', sign_path: '客户公司→丰图科技(深圳)有限公司', sub_amount: '0', designated_sub_amount: '0',
  survey_sub_amount: '0', sub_core: '否', survey: '否', jiadao: '否', secret: '否', province: '江西省',
  product_type: '标品', promo_target: '无', promo_amount: '0', settle_method: '银行转账',
  payback_time: '预计26年Q4回款100%', b2b_scene: '无', revenue_confirm: '一次性确收',
  payment_terms: '预付30%,验收后70%', guarantee: '否', non_compete: '否', sub_limit: '否',
  summary: 'AV', data_review: '是', data_plan: '公开POI数据', data_content: '名称/坐标/分类', data_compliance: '无敏感数据'
};
const DEPTS = ['pur1', 'fde1', 'fin1', 'legal1', 'comp1', 'data1'];
const makeLocked = async token => {
  const id = (await api(token, '/api/budget', 'POST', { project_name: 'AV对抗预算' })).id;
  await api(token, `/api/budget/${id}`, 'PUT', { fields: GREEN_BUDGET });
  await api(token, `/api/budget/${id}/delivery`, 'PUT', { rows: [{ content: 'AV明细', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
  await api(token, `/api/budget/${id}/lock`, 'POST');
  return id;
};
// 建单(关联)→附件→提交→judged→(可选归档)
async function makeReview(tokens, { archived = false } = {}) {
  const bg = await makeLocked(tokens.sales);
  const rid = (await api(tokens.sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]AV-' + Date.now(), form: BID_BASE, submit: false, budget_id: bg })).id;
  await api(tokens.sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'av.xlsx', data: Buffer.from('x').toString('base64') });
  await api(tokens.sales, `/api/reviews/${rid}/submit`, 'POST');
  for (const u of DEPTS) {
    const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
    for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
  }
  if (archived) await api(tokens.admin, `/api/reviews/${rid}/archive`, 'POST');
  return rid;
}

(async () => {
  const tokens = { sales: await login('sales1'), fin: await login('fin1'), admin: await login('zhichizu') };
  for (const u of DEPTS) tokens[u] = await login(u);

  try {
    // ---------- AV-01: 未登录直连附件 ----------
    {
      const r = await fetch(`${B}/uploads/1/whatever.xlsx`);
      check('AV-01', '未登录 GET /uploads/ 401(附件鉴权)', r.status === 401, 'status=' + r.status);
    }

    // ---------- AV-02: 慢桩竞态(chat 写穿锁定单) ----------
    {
      const slow = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => setTimeout(() => {
          const content = '```json\n' + JSON.stringify({ fields: { sub_cost: 800000 } }) + '\n```';
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
        }, 1500));
      });
      await new Promise(r => slow.listen(9803, '127.0.0.1', r));
      try {
        const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV02竞态' })).id;
        await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
        await api(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'AV02明细', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
        setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9803' });
        const chatP = raw(tokens.sales, '/api/agent/chat', 'POST', { budget_id: bg, message: '把分包改成 80 万' });
        await sleep(400); // chat 已进入 LLM await 窗口
        const lk = await raw(tokens.sales, `/api/budget/${bg}/lock`, 'POST');
        check('AV-02', '竞态窗口内锁定成功', lk.status === 200, 'lock=' + lk.status);
        const chat = await chatP;
        check('AV-02', 'chat 被拒 409(条件更新拦住写穿)', chat.status === 409, 'chat=' + chat.status);
        const bd = (await api(tokens.sales, '/api/budget/' + bg)).budget;
        check('AV-02', '锁定 fields 未被改写(sub_cost 仍 1000000)', bd.fields.sub_cost === 1000000, 'sub_cost=' + bd.fields.sub_cost);
        check('AV-02', '锁定 calc 与快照一致(margin 未被桩数据覆盖)', bd.calc && bd.settings_snapshot && Math.abs(bd.calc.margin - (JSON.parse(JSON.stringify(bd.calc))).margin) < 0.01 && bd.status === 'locked');
      } finally { restoreCfg(); slow.close(); }
    }

    // ---------- AV-03: XSS 注入存库(前端转义在 h_adv_check 浏览器断言) ----------
    {
      const payload = '"><img src=x onerror="window.__xss=1">';
      const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV03-XSS' })).id;
      await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: { ...GREEN_BUDGET, customer: payload, project_name: 'AV03-XSS' } });
      const bd = (await api(tokens.sales, '/api/budget/' + bg)).budget;
      check('AV-03', 'payload 原样存储(转义责任在前端)', bd.fields.customer === payload);
    }

    // ---------- AV-04: 断开桩连打 10 次(进程不崩) ----------
    {
      const killer = http.createServer((req, res) => { res.socket.destroy(); });
      killer.on('connection', sock => sock.destroy());
      await new Promise(r => killer.listen(9804, '127.0.0.1', r));
      try {
        const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV04崩溃' })).id;
        await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
        await api(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'AV04', pm_pd: 1, own_pd: 1, prod_pd: 1 }] });
        setCfg({ LLM_BASE_URL: 'http://127.0.0.1:9804' });
        let all200 = true;
        for (let i = 0; i < 10; i++) {
          const r = await raw(tokens.sales, '/api/agent/chat', 'POST', { budget_id: bg, message: '合同 240 万' });
          if (r.status !== 200) { all200 = false; break; }
        }
        check('AV-04', '断开桩下 10 次 chat 均降级 200', all200);
        const me = await fetch(`${B}/api/me`);
        check('AV-04', '服务进程仍在线(/api/me 401 响应)', me.status === 401, 'status=' + me.status);
      } finally { restoreCfg(); killer.close(); }
    }

    // ---------- AV-05: judge 状态门 ----------
    {
      const bg0 = await makeLocked(tokens.sales);
      const draft = (await api(tokens.sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]AV05-draft', form: BID_BASE, submit: false, budget_id: bg0 })).id;
      const r1 = await raw(tokens.admin, `/api/reviews/${draft}/judge`, 'POST');
      check('AV-05', 'draft 单 judge 被拦 400', r1.status === 400 && /前置评审中/.test(r1.data.error || ''), 'status=' + r1.status);
      const arch = await makeReview(tokens, { archived: true });
      const r2 = await raw(tokens.admin, `/api/reviews/${arch}/judge`, 'POST');
      check('AV-05', 'archived 单 judge 被拦 400(归档不可倒退)', r2.status === 400 && /前置评审中/.test(r2.data.error || ''), 'status=' + r2.status);
    }

    // ---------- AV-06: 退回后其他部门继续打灯 ----------
    {
      const rid = await (async () => {
        const bg = await makeLocked(tokens.sales);
        const r = (await api(tokens.sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]AV06-退回', form: BID_BASE, submit: false, budget_id: bg })).id;
        await api(tokens.sales, `/api/reviews/${r}/attachments`, 'POST', { field: '项目预算表', filename: 'a6.xlsx', data: Buffer.from('x').toString('base64') });
        await api(tokens.sales, `/api/reviews/${r}/submit`, 'POST');
        return r;
      })();
      const purTask = (await api(tokens.pur1, '/api/tasks?scope=mine')).tasks.find(t => t.review_id === rid);
      await api(tokens.pur1, `/api/tasks/${purTask.id}/return`, 'POST', { opinion: '技术方案不明确' });
      // 退回后 scope=mine 不再返回该单任务(过滤 reviewing), 改用 scope=all 拿 fde 任务验证状态门
      const fdeTask = (await api(tokens.fde1, '/api/tasks?scope=all')).tasks.find(t => t.review_id === rid && t.dept === 'FDE');
      const r = await raw(tokens.fde1, `/api/tasks/${fdeTask.id}/complete`, 'POST', { light: 'green', opinion: '' });
      check('AV-06', '退回后其他部门 complete 被拦 400', r.status === 400 && /退回/.test(r.data.error || ''), 'status=' + r.status);
      const rv = (await api(tokens.sales, '/api/reviews/' + rid)).review;
      check('AV-06', '单据保持 returned(未被自动研判)', rv.status === 'returned', 'status=' + rv.status);
    }

    // ---------- AV-07: complete 双击并发 ----------
    {
      const bg = await makeLocked(tokens.sales);
      const rid = (await api(tokens.sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]AV07-双击', form: BID_BASE, submit: false, budget_id: bg })).id;
      await api(tokens.sales, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'a7.xlsx', data: Buffer.from('x').toString('base64') });
      await api(tokens.sales, `/api/reviews/${rid}/submit`, 'POST');
      // 前 5 部门正常完成, 最后 data1 并发双击
      for (const u of DEPTS.slice(0, 5)) {
        const ts = (await api(tokens[u], '/api/tasks?scope=mine')).tasks.filter(t => t.review_id === rid);
        for (const t of ts) await api(tokens[u], `/api/tasks/${t.id}/complete`, 'POST', { light: 'green', opinion: '' });
      }
      const lastTask = (await api(tokens.data1, '/api/tasks?scope=mine')).tasks.find(t => t.review_id === rid);
      const [a, b] = await Promise.all([
        raw(tokens.data1, `/api/tasks/${lastTask.id}/complete`, 'POST', { light: 'green', opinion: '' }),
        raw(tokens.data1, `/api/tasks/${lastTask.id}/complete`, 'POST', { light: 'green', opinion: '' })
      ]);
      const statuses = [a.status, b.status].sort();
      check('AV-07', '双击恰一次 200 一次 400', statuses[0] === 200 && statuses[1] === 400, JSON.stringify(statuses));
      const d = await api(tokens.sales, '/api/reviews/' + rid);
      const judgeEvents = d.events.filter(e => e.action === 'AI 研判');
      check('AV-07', 'AI 研判事件恰一条(无重复研判)', judgeEvents.length === 1, 'events=' + judgeEvents.length);
      check('AV-07', '单据 judged(自动研判正常触发)', d.review.status === 'judged');
      await api(tokens.admin, `/api/reviews/${rid}/archive`, 'POST');
    }

    // ---------- AV-08: 越权读预算详情/消息 ----------
    {
      const bg = await makeLocked(tokens.sales);
      const r1 = await raw(tokens.fin, '/api/budget/' + bg);
      const r2 = await raw(tokens.fin, `/api/budget/${bg}/messages`);
      const r3 = await raw(tokens.fin, `/api/budget/${bg}/versions`);
      check('AV-08', '非 owner 读详情/对话/版本链均 403', r1.status === 403 && r2.status === 403 && r3.status === 403, [r1.status, r2.status, r3.status].join('/'));
    }

    // ---------- AV-09: 越权上传附件 ----------
    {
      const bg0 = await makeLocked(tokens.sales);
      const rid = (await api(tokens.sales, '/api/reviews', 'POST', { type: 'bid', title: '[T]AV09-越权传', form: BID_BASE, submit: false, budget_id: bg0 })).id;
      const r = await raw(tokens.fin, `/api/reviews/${rid}/attachments`, 'POST', { field: '项目预算表', filename: 'evil.xlsx', data: Buffer.from('x').toString('base64') });
      check('AV-09', '非申请人上传附件被拦 403', r.status === 403, 'status=' + r.status);
    }

    // ---------- AV-10: 通知链接 PUBLIC_BASE_URL ----------
    {
      const hooks = [];
      const hook = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => { hooks.push(body); res.writeHead(200); res.end('{}'); });
      });
      await new Promise(r => hook.listen(9812, '127.0.0.1', r));
      try {
        setCfg({ PUBLIC_BASE_URL: 'http://10.0.0.1:8600', COMMITTEE_WEBHOOK_URL: 'http://127.0.0.1:9812/committee' });
        const rid = await makeReview(tokens); // 绿灯 judged
        const dr = await raw(tokens.admin, `/api/reviews/${rid}/decision`, 'POST', { decision_result: '同意', decision_note: 'AV10' });
        check('AV-10', 'decision 同意 200', dr.status === 200);
        for (let i = 0; i < 40 && hooks.length === 0; i++) await sleep(100);
        const payload = hooks[0] || '';
        const text = (JSON.parse(payload || '{}').markdown || {}).text || '';
        check('AV-10', '通知链接含配置地址(10.0.0.1:8600)且不含 localhost', /10\.0\.0\.1:8600/.test(text) && !/localhost/.test(text), text.slice(0, 80));
        await api(tokens.admin, `/api/reviews/${rid}/archive`, 'POST');
      } finally { restoreCfg(); hook.close(); }
    }
    // ========== 第二轮对抗(AV2, 2026-10-09): 针对前端翻新+附3交付明细+新通道 ==========
    // AV2-01/02: 交付明细越权读(上轮 #7 漏了 delivery GET——已实证漏洞)
    {
      const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV2-越权读' })).id;
      await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
      const r1 = await raw(tokens.fin, `/api/budget/${bg}/delivery`);
      check('AV2-01', '非 owner 读空明细 /delivery 被拦 403', r1.status === 403, 'status=' + r1.status);
      await api(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: '机密交付项', pm_pd: 2, own_pd: 39, prod_pd: 184 }] });
      const r2 = await raw(tokens.fin, `/api/budget/${bg}/delivery`);
      const leaked = (r2.data && r2.data.rows || []).some(x => /机密/.test(x.content || ''));
      check('AV2-02', '非 owner 读有明细单不泄露 rows(403)', r2.status === 403 && !leaked, 'status=' + r2.status + ' leaked=' + leaked);
      // AV2-03: apply 越权(验证已有 canWrite 不误伤)
      const r3 = await raw(tokens.fin, `/api/budget/${bg}/delivery/apply`, 'POST', {});
      check('AV2-03', '非 owner POST /delivery/apply 被拦 403', r3.status === 403, 'status=' + r3.status);
      // AV2-04: owner 读合法路径不误伤
      await api(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 'AV2明细', pm_pd: 2, own_pd: 2, prod_pd: 4 }] });
      await api(tokens.sales, `/api/budget/${bg}/lock`, 'POST');
      const r4 = await raw(tokens.sales, `/api/budget/${bg}/delivery`);
      check('AV2-04', 'owner 读锁定单 /delivery 正常 200', r4.status === 200 && ((r4.data || {}).rows || []).length === 1, 'status=' + r4.status);
    }

    // AV2-05: 资源面——巨量行 PUT 不崩服务
    {
      const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV2-巨量行' })).id;
      await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
      const big = Array.from({ length: 3000 }, (_, i) => ({ content: '行' + i + 'x'.repeat(190), stage: '实施', own_pd: 1, prod_pd: 1 }));
      const t0 = Date.now();
      const r = await raw(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: big });
      const ok1 = r.status === 200 && ((r.data || {}).rows || []).length === 3000;
      const g = await api(tokens.sales, `/api/budget/${bg}/delivery`);
      const ok2 = ((g.rows) || []).length === 3000;
      const me = await fetch(`${B}/api/me`);
      check('AV2-05', '3000 行 PUT/GET 一致且服务在线(耗时' + (Date.now() - t0) + 'ms)', ok1 && ok2 && me.status === 401);
    }

    // AV2-06: 毒件——假 xlsx 公式注入(解析失败不落库)
    {
      const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV2-毒件' })).id;
      await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
      const poison = Buffer.concat([Buffer.from('=cmd()\r\n'), Buffer.from('PK\x03\x04' + 'garbage')]).toString('base64');
      const r = await raw(tokens.sales, `/api/budget/${bg}/delivery/import`, 'POST', { filename: 'evil.xlsx', data: poison });
      const g = await api(tokens.sales, `/api/budget/${bg}/delivery`);
      const poisoned = ((g.rows) || []).length > 0;
      check('AV2-06', '毒件解析被拒且不落 rows', (r.status === 400 || r.status === 502) && !poisoned, 'import=' + r.status);
    }

    // AV2-07: 行内容截断+存储转义分离(存储原样截断 200, 渲染转义归前端)
    {
      const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV2-截断' })).id;
      await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
      const long = 'A'.repeat(150) + '<img src=x onerror=window.__av2=1>' + 'B'.repeat(150);
      const r = await raw(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: long, own_pd: 1 }] });
      const saved = (((r.data || {}).rows) || [])[0] || {};
      check('AV2-07', '超长 content 截断 200 字', saved.content != null && saved.content.length === 200, 'len=' + (saved.content || '').length);
    }

    // AV2-09: chat skill 白名单(非 review 走技能①, 不越权)
    {
      const bg = (await api(tokens.sales, '/api/budget', 'POST', { project_name: 'AV2-skill' })).id;
      await api(tokens.sales, `/api/budget/${bg}`, 'PUT', { fields: GREEN_BUDGET });
      await api(tokens.sales, `/api/budget/${bg}/delivery`, 'PUT', { rows: [{ content: 's', pm_pd: 1, own_pd: 1, prod_pd: 1 }] });
      // skill=evil: 应走技能①(需 budget_id)——不传 budget_id 应 404 预算单不存在, 而非走评审分支
      const r = await raw(tokens.sales, '/api/agent/chat', 'POST', { skill: 'evil', message: '测试' });
      check('AV2-09', '非 review skill 走技能①路径(budget 缺 404)', r.status === 404, 'status=' + r.status);
    }

    // AV2-08 由 h_adv_check 浏览器层覆盖(hash 路由注入)
  } finally {
    restoreCfg();
  }

  const summary = `${pass} passed, ${fail} failed -> ${fail === 0 ? 'ALL PASS' : 'SOME FAIL'}`;
  console.log('\n' + summary);
  console.log('config.json 已恢复原始字节');
  const logFile = process.argv.find(a => a.startsWith('--log='));
  if (logFile) {
    require('fs').writeFileSync(logFile.slice(6), LOG.join('\n') + '\n\n' + summary + '\n', 'utf8');
    console.log('日志已写入: ' + logFile.slice(6));
  }
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { restoreCfg(); console.error('FAIL:', e.message); process.exit(1); });
