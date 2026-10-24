// 项目评审平台 MVP - 零依赖后端（Node 22 内置 http + node:sqlite）
// 流程: 填单(draft) -> 提交(reviewing) <-> 退回修改(returned) -> 研判(judged) -> 归档(archived)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process'); // T9 探针走 curl 通道(防火墙重置 Node 原生 TLS 指纹, 同 agent.js extractFields)
const { DatabaseSync } = require('node:sqlite');
const { computeBudget, DEFAULT_SETTINGS, missingOf, rateFor, MISSING_BUDGET } = require('./finance.js'); // 阶段2 财务引擎(任务2.1)+单价档(附3行成本)+V4.0§5 预算缺项只读投影
const { mergeDraft, checkMessage, extractFields, buildReply, BUDGET_WHITELIST,
  BID_SYSTEM_PROMPT, BID_WHITELIST, BID_REQUIRED, buildBidReply,
  OPP_SYSTEM_PROMPT, OPP_WHITELIST, buildOppReply } = require('./agent.js'); // 技能①(2.5) + 技能②③(3.3) + 技能④对话式建档(V4.0 P1)
const { createNotify } = require('./notify.js'); // 阶段3 通知适配器(任务 3.6)
const { hasBudgetNumbers, pruneStoredDelivery } = require('./delivery-rows.js');
const { IMPORT_SOURCES_DDL, BUDGET_FIELD_LABELS, saveImportSource, latestImportSource,
  budgetImportSource, sourceMeta, resolveImportSourcePath, writeUniqueUpload, encodeRFC5987Value,
  formComparison, deliveryComparison } = require('./import-source.js');
const {
  DELIVERY_SYSTEM_PROMPT, cleanDeliveryDraft,
  createRobotOrchestrator, buildReviewInvite, buildTaskDispatches,
  createLocalProvider, createDingtalkProvider
} = require('./robot-orchestrator.js'); // 机器人编排纯函数(T2): 邀请消息唯一构造口
const ROBOT_WORKBENCH_ROLES = ['项目经理', '销售经理', '销售支持组', 'admin'];
const ROBOT_INVITE_ROLES = ['销售支持组', 'admin'];

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 8600;
for (const d of [DATA_DIR, UPLOAD_DIR]) fs.mkdirSync(d, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'review.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE, password_hash TEXT, name TEXT, role TEXT, dept TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT, title TEXT, applicant_id INTEGER, applicant_name TEXT,
  status TEXT DEFAULT 'draft', round INTEGER DEFAULT 1,
  form_json TEXT DEFAULT '{}',
  light TEXT, route TEXT, report TEXT, judge_detail TEXT,
  created_at TEXT, updated_at TEXT, archived_at TEXT
);
CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER, round INTEGER,
  ind_key TEXT, ind_name TEXT, dept TEXT, standards TEXT,
  status TEXT DEFAULT 'pending', light TEXT, opinion TEXT,
  done_by TEXT, done_at TEXT
);
CREATE TABLE IF NOT EXISTS attachments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER, field TEXT, filename TEXT, filepath TEXT, uploaded_at TEXT
);
CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id INTEGER, action TEXT, actor TEXT, detail TEXT, created_at TEXT
);
`);

// ---------- 评审类型与指标配置（源自《项目评审管理规则-流程指引与评审表.xlsx》） ----------
const INDICATORS = {
  presale: [ // 售前立项评审
    { key: 'tech', name: '技术可行性', dept: 'FDE', standards: '绿:无技术风险 | 黄:存在交付侧技术风险,但在客户/交付边界控制下可完成 | 红:技术侧无法交付且无法分包' },
    { key: 'resource', name: '交付资源风险', dept: 'FDE', standards: '绿:资源无风险 | 黄:交付实施资源当前周期内存在明确缺口' },
    { key: 'survey_deliver', name: '合同交付物(测绘项目)', dept: '合规BP', standards: '绿:交付物无外业采集和地图数据 | 黄:交付物有外业采集和地图数据相关内容' },
    { key: 'sub_early', name: '存在分包提前投入', dept: '采购BP', standards: '绿:无分包提前介入 | 黄:分包提前介入' },
    { key: 'credit_history', name: '客户过往合作信誉', dept: '财务BP', standards: '绿:无诉讼欠款/无逾期欠款/无沉默的历史交付成本 | 黄:存在逾期欠款或沉默的历史交付成本 | 红:存在未完结诉讼(直接+间接)或历史坏账' }
  ],
  bid: [ // 投标决策评审
    { key: 'sub_reason', name: '分包合理性', dept: '采购BP', standards: '绿:非核心能力分包且非指定性、测绘下游有资质、付款背靠背、供应商合格 | 黄:核心能力被分包/指定性分包(上XO)/非背靠背/下游无资质' },
    { key: 'tech', name: '技术可行性', dept: 'FDE', standards: '绿:无技术风险 | 黄:有风险但边界可控 | 红:无法交付且无法分包' },
    { key: 'arrears', name: '客户历史欠款', dept: '财务BP', standards: '绿:无;或终验款/质保金逾期且销售背书90天内拿回 | 黄:其他逾期款情况' },
    { key: 'credit', name: '签约客户/最终客户信用评估', dept: '财务BP', standards: '绿:政府/央企/国企等优质客户,或小微同时满足5项条件 | 黄:皮包公司或财政资金状况较差 | 红:黑名单客户' },
    { key: 'related_tx', name: '集团公司关联交易金额', dept: '财务BP', standards: '绿:累计关联交易预算<=100万 | 黄:>100万' },
    { key: 'payment', name: '付款条件', dept: '财务BP', standards: '绿:有预付条款且约定付款期间;硬件100%预付;软件100%预付或验收后10日内付清 | 黄:无预付/无约定期间;硬件非100%预付但无垫资;软件非背靠背 | 红:硬件垫资;软件背靠背' },
    { key: 'upstream', name: '上游签约路径公司情况', dept: '法务', standards: '绿:无异常/诉讼/被执行/处罚记录 | 黄:有诉讼(第三人涉义务)、近三年已执行完毕且相关、有处罚已履行 | 红:异常经营/失信/破产;丰图为原被告未了结;执行中/失信被执行;处罚未履行或涉资质' },
    { key: 'subcontract_limit', name: '转包限制风险', dept: '法务', standards: '绿:丰图内部关联交易无需二次评审 | 黄:有背靠背转移风险约定且可转移给供应商 | 红:背靠背但丰图自行交付/供应商无法转移,违约责任超限' },
    { key: 'compliance', name: '合规风险', dept: '合规BP', standards: '绿:无风险,或已有管控举措、风险可控不影响资质 | 黄:风险存在不确定性,或对资质有明确影响但不严重、范围可接受 | 红:对资质有明确严重影响,范围不可接受' },
    { key: 'data', name: '数据合规性', dept: '数据BP', standards: '绿:数据风险等级C1-3 | 黄:数据风险等级C4 | 红:明确禁止' }
  ],
  change: [ // 项目关键事项决策
    { key: 'tech', name: '技术可行性', dept: 'FDE', standards: '绿:无技术风险 | 黄:有风险但边界可控 | 红:无法交付且无法分包' },
    { key: 'sub_reason', name: '分包合理性', dept: '采购BP', standards: '绿:非核心能力且非指定性分包等 | 黄:核心能力被分包/指定性分包/非背靠背/资质不合格' },
    { key: 'sign_diff', name: '签单与评审的签约差异', dept: '法务', standards: '绿:签约路径/客户变化但无风险 | 黄:签约路径/客户变化且有风险' },
    { key: 'deduction', name: '项目核减', dept: '财务BP', standards: '绿:交付减少/考核扣分等合理原因核减 | 黄:化债核减/非合理原因核减' }
  ]
};
const TYPE_NAMES = { presale: '售前立项评审', bid: '投标决策评审', change: '项目关键事项决策' };

// 证据映射由 meta 下发；未登记指标保守标为部门自有数据，不虚构平台依据。
const IND_EVIDENCE = {
  presale: {
    tech: { formKeys: [], anchors: ['summary', 'survey'], external: true },
    resource: { formKeys: [], anchors: ['presale_period', 'summary'], external: true },
    survey_deliver: { formKeys: ['survey'], anchors: [], external: false },
    sub_early: { formKeys: ['sub_early_flag'], anchors: [], external: false },
    credit_history: { formKeys: [], anchors: [], external: true }
  },
  bid: {
    sub_reason: { formKeys: ['sub_core', 'sub_amount', 'designated_sub_amount', 'survey_sub_amount', 'b2b_scene'], anchors: [], external: true, aItems: ['分包占比', '测绘类分包占比', '指定供应商'], hint: '下游供应商资质与合格供应商名录在采购系统中, 平台不采集; 请按下方锚点核验' },
    tech: { formKeys: [], anchors: ['product_type', 'jiadao', 'summary'], external: true },
    arrears: { formKeys: [], anchors: ['payback_time'], external: true },
    credit: { formKeys: [], anchors: [], external: true },
    related_tx: { formKeys: [], anchors: [], external: true },
    payment: { formKeys: ['payment_terms', 'settle_method', 'payback_time', 'revenue_confirm', 'b2b_scene'], anchors: [], external: false, aItems: ['结算方式'] },
    upstream: { formKeys: ['sign_path'], anchors: [], external: true, aItems: ['签约转包次数'], hint: '上游签约路径各公司的经营异常/诉讼/被执行/处罚记录在法务征信渠道中, 平台不采集; 请按签约路径逐家查询' },
    subcontract_limit: { formKeys: ['sub_limit', 'sign_path'], anchors: [], external: false },
    compliance: { formKeys: [], anchors: ['secret', 'jiadao'], external: true },
    data: { formKeys: ['data_review', 'data_plan', 'data_content', 'data_compliance'], anchors: [], external: true, hint: '数据风险等级(C1–C4)在数据合规评估中确定, 平台不采集; 请结合下方表单事实判定' }
  },
  change: {
    tech: { formKeys: [], anchors: ['summary'], external: true },
    sub_reason: { formKeys: ['old_sub_amount', 'new_sub_amount'], anchors: [], external: true, hint: '变更后分包供应商资质在采购系统中, 平台不采集; 请按下方锚点核验' },
    sign_diff: { formKeys: ['path_change'], anchors: [], external: false },
    deduction: { formKeys: ['change_type', 'old_delivery_cost', 'new_delivery_cost'], anchors: [], external: true, aItems: ['成本变动-交付成本'], hint: '核减原因是否合理需结合合同与回款台账判断, 平台不提供该数据' }
  }
};
const EXT_HINT = {
  FDE: '本项判定依据在贵部门(FDE)的技术评估与资源排期中, 平台不提供该数据; 请按下方锚点定位本单后自行判定',
  财务BP: '本项判定依据在财务系统(客户欠款/诉讼/坏账/关联交易台账)中, 平台不提供该数据; 请按下方锚点在财务系统中定位本单',
  法务: '本项判定依据在法务征信渠道中, 平台不提供该数据; 请按下方锚点查询',
  合规BP: '本项判定依据在合规部门的资质与风险台账中, 平台不提供该数据; 请按下方锚点定位本单',
  数据BP: '本项判定依据在数据合规评估中, 平台不提供该数据; 请按下方锚点定位本单',
  采购BP: '本项判定依据在采购系统中, 平台不提供该数据; 请按下方锚点定位本单'
};
function indEvidence(type, key, dept) {
  const e = (IND_EVIDENCE[type] || {})[key];
  const base = e ? { formKeys: e.formKeys, anchors: e.anchors, external: !!e.external, aItems: e.aItems || [], registered: true }
    : { formKeys: [], anchors: [], external: true, aItems: [], registered: false };
  const hint = !base.external ? '' : (e && e.hint) || (e ? EXT_HINT[dept] : '') || '指标证据映射表未登记本指标, 平台不提供该项数据; 请按下方锚点在贵部门系统中定位本单';
  return { ...base, hint, cls: base.formKeys.length ? (base.external ? 'B+C' : 'B') : 'C' };
}
const FIXTURE_CODE_RE = /^PL-[A-Za-z0-9]/;
const isFixtureCode = c => typeof c === 'string' && FIXTURE_CODE_RE.test(c);

// ---------- 种子用户 ----------
function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(8).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPw(pw, stored) {
  const [salt, h] = stored.split(':');
  return crypto.scryptSync(pw, salt, 64).toString('hex') === h;
}
const seed = [
  ['zhichizu', '销售支持组', '销售支持组', '销售支持组'],
  ['sales1', '销售经理- demo', '销售经理', '营销部'],
  ['pm1', '项目经理- demo', '项目经理', '交付部'],
  ['fde1', 'FDE工程师- demo', 'FDE', '交付部'],
  ['fin1', '财务BP- demo', '财务BP', '财务部'],
  ['pur1', '采购BP- demo', '采购BP', '采购部'],
  ['legal1', '法务- demo', '法务', '董办法务'],
  ['comp1', '合规BP- demo', '合规BP', '公共事务'],
  ['data1', '数据BP- demo', '数据BP', '数据部']
];
const insUser = db.prepare('INSERT OR IGNORE INTO users(username,password_hash,name,role,dept) VALUES(?,?,?,?,?)');
for (const [u, n, r, d] of seed) insUser.run(u, hashPw('123456'), n, r, d);
try { db.exec('ALTER TABLE reviews ADD COLUMN report_html TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE reviews ADD COLUMN budget_json TEXT'); } catch (e) {}
// 历史数据承接(docs/历史数据承接方案.md): era 时代标记——online=在线流程(存量默认)/history=历史补录(只在归档展现)
try { db.exec("ALTER TABLE reviews ADD COLUMN era TEXT DEFAULT 'online'"); db.exec("UPDATE reviews SET era='online' WHERE era IS NULL"); } catch (e) {}
// ---------- 阶段 2 DDL(§2.4, 幂等): budgets/agent_messages/settings + 旧表加列 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',      -- draft | locked
  owner_id INTEGER NOT NULL,
  project_name TEXT DEFAULT '', fields TEXT NOT NULL DEFAULT '{}',
  calc TEXT, settings_snapshot TEXT, parent_id INTEGER,
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_budgets_code ON budgets(code);
CREATE TABLE IF NOT EXISTS agent_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id INTEGER, review_id INTEGER,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT
);
CREATE TABLE IF NOT EXISTS budget_delivery ( -- 附3交付成本评估明细(上传解析+在线编辑, 递进挂靠预算单)
  budget_id INTEGER PRIMARY KEY,
  rows_json TEXT DEFAULT '[]',
  source_file TEXT,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT, updated_by TEXT
);`);
try { db.exec('ALTER TABLE reviews ADD COLUMN budget_id INTEGER'); } catch (e) {}
// 商机代码贯穿(O1): opp_code 业务主键——列/索引/回填各自独立幂等(ALTER 已存在不阻断回填)
try { db.exec('ALTER TABLE reviews ADD COLUMN opp_code TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE budgets ADD COLUMN opp_code TEXT'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_reviews_opp ON reviews(opp_code)'); db.exec('CREATE INDEX IF NOT EXISTS idx_budgets_opp ON budgets(opp_code)'); } catch (e) {}
try { db.exec("UPDATE reviews SET opp_code = json_extract(form_json, '$.opp_code') WHERE form_json LIKE '%opp_code%' AND (opp_code IS NULL OR opp_code != json_extract(form_json, '$.opp_code'))"); db.exec("UPDATE budgets SET opp_code = json_extract(fields, '$.opp_code') WHERE fields LIKE '%opp_code%' AND (opp_code IS NULL OR opp_code != json_extract(fields, '$.opp_code'))"); } catch (e) {}
try { db.exec('ALTER TABLE reviews ADD COLUMN decision_result TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE reviews ADD COLUMN decision_note TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE reviews ADD COLUMN decision_by TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE reviews ADD COLUMN decision_at TEXT'); } catch (e) {}
try { db.exec('ALTER TABLE users ADD COLUMN phone TEXT'); } catch (e) {}
// settings 种子(§2.5 十五键, OR IGNORE 缺键才插不覆盖已有)
const insSetting = db.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, String(v), new Date().toISOString(), 'seed');

// ---------- V4.0 T1 DDL(spec 2026-10-14 §1, 幂等): opps 待评审商机档案 + opp_delivery 商机级交付预算 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS opps (
  opp_code TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  customer TEXT DEFAULT '',
  region TEXT DEFAULT '',
  province TEXT DEFAULT '',
  biz_line TEXT DEFAULT '',
  contract_amount REAL,
  opp_stage TEXT DEFAULT '',
  sign_date TEXT DEFAULT '',
  sales TEXT DEFAULT '',
  pm TEXT DEFAULT '',
  survey TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  source TEXT DEFAULT 'form',
  status TEXT DEFAULT 'pending',
  created_by INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS opp_delivery (
  opp_code TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft',
  rows_json TEXT DEFAULT '[]',
  source_file TEXT,
  owner_id INTEGER,
  created_at TEXT,
  updated_at TEXT
);`);
// ---------- V4.0 T9 LLM 用量审计(spec §6.1): 技能/探针每次调用落一行, 失败也落 ----------
db.exec(`CREATE TABLE IF NOT EXISTS llm_calls(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, profile TEXT NOT NULL,
  ok INTEGER NOT NULL, degraded INTEGER NOT NULL, ms INTEGER NOT NULL,
  tokens_est INTEGER, ref TEXT)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_llm_calls_ts ON llm_calls(ts)');
const insLlmCall = db.prepare('INSERT INTO llm_calls(ts,profile,ok,degraded,ms,tokens_est,ref) VALUES(?,?,?,?,?,?,?)');
// 观测写入永不阻断业务(与 notify N-02 同口径): 失败只 console.error
function logLlmCall(profile, ok, degraded, ms, tokensEst, ref) {
  try { insLlmCall.run(now(), String(profile || 'default'), ok ? 1 : 0, degraded ? 1 : 0, Math.max(0, Math.round(ms || 0)),
    tokensEst == null ? null : Math.round(tokensEst), ref == null ? null : String(ref).slice(0, 64)); }
  catch (e) { console.error('llm_calls 写入失败(不阻断):', e.message); }
}
// ---------- V4.0 T10 机器人管理中心(D-44 改造既有通知层): 三表 ----------
// robot_instances.channel 为简报 2a 之外的补列: notify/committee 两群各需独立真源, 否则 DB 真源会把委员会通知推进通知群
db.exec(`CREATE TABLE IF NOT EXISTS robot_instances(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, webhook TEXT NOT NULL,
  secret TEXT, env TEXT DEFAULT 'prod', channel TEXT NOT NULL DEFAULT 'notify', enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS notify_matrix(
  event TEXT NOT NULL, target TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'notify',
  enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(event, target));
CREATE TABLE IF NOT EXISTS robot_whitelist(
  id INTEGER PRIMARY KEY AUTOINCREMENT, ident TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'user_id',
  scope TEXT NOT NULL DEFAULT 'query', created_at TEXT, UNIQUE(ident, kind, scope));`);
// ---------- 机器人工作流 T3: 用户绑定 / 群与部门目标 / 幂等外发箱(三表 + 唯一入箱口) ----------
// 本轮只入箱不发送: provider 未激活, 所有行恒 status='preview'; 不调 notifySafe、不读 webhook、不做状态迁移。
db.exec(`CREATE TABLE IF NOT EXISTS robot_user_bindings(
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'dingtalk',
  external_user_id TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'unbound',
  updated_at TEXT, updated_by TEXT,
  PRIMARY KEY(user_id, provider)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_robot_binding_external
  ON robot_user_bindings(provider, external_user_id) WHERE external_user_id IS NOT NULL AND external_user_id != '';
CREATE TABLE IF NOT EXISTS robot_targets(
  target_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'dingtalk',
  target_type TEXT NOT NULL,
  external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'unbound',
  updated_at TEXT, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS robot_outbox(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opp_code TEXT, review_id INTEGER, task_id INTEGER,
  event TEXT NOT NULL, target_key TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'dingtalk',
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by INTEGER, created_at TEXT NOT NULL, sent_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_robot_outbox_status ON robot_outbox(status, id);`);
db.exec(IMPORT_SOURCES_DDL);
// 工作台深链基址与 reviewLink 同口径(PUBLIC_BASE_URL 优先, 默认本机); 签名报告 token 一律不进机器人消息
function publicBaseUrl() {
  return String(readCfg().PUBLIC_BASE_URL || '').replace(/\/+$/, '') || ('http://localhost:' + PORT);
}
// 全仓唯一入箱口: 同 idempotency_key 冲突时不动既有行, 回读该行供调用方取整数 outbox_id
function enqueueRobotOutbox(record, actor) {
  const t = now();
  db.prepare(`INSERT INTO robot_outbox(
    opp_code,review_id,task_id,event,target_key,provider,payload_json,status,
    idempotency_key,created_by,created_at,attempts,last_error
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,NULL) ON CONFLICT(idempotency_key) DO NOTHING`)
    .run(record.opp_code || null, record.review_id || null, record.task_id || null,
      record.event, record.target_key, record.provider || 'dingtalk',
      JSON.stringify(record.payload || {}), 'preview', record.idempotency_key,
      actor && actor.id || null, t);
  return db.prepare('SELECT * FROM robot_outbox WHERE idempotency_key=?').get(record.idempotency_key);
}
// 用户侧主动邀请(T4): 与 admin preview 共用无副作用层 buildReviewInvite + enqueueRobotOutbox,
// 差别只在这里多一道「该商机已有评审则 409」业务门——用户点的是真推流程, admin 预演不能因已有草稿被拒(不得反向接到本函数)
function inviteReview(user, body) {
  if (!ROBOT_INVITE_ROLES.includes(user.role)) return { status: 403, data: { error: '仅销售支持组或 admin 可主动邀请' } };
  const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(String(body.opp_code || '').trim());
  if (!opp) return { status: 404, data: { error: '商机档案不存在' } };
  if (db.prepare('SELECT id FROM reviews WHERE opp_code=? LIMIT 1').get(opp.opp_code))
    return { status: 409, data: { error: '该商机已有评审草稿或流程记录' } };
  const target = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(Number(body.target_user_id) || 0);
  if (!target || !['项目经理', '销售经理'].includes(target.role))
    return { status: 400, data: { error: '接收人必须是已有项目经理或销售经理' } };
  const record = buildReviewInvite({ opp, targetUser: target, baseUrl: publicBaseUrl() });
  const row = enqueueRobotOutbox(record, user);
  return { status: 200, data: { ok: true, outbox_id: row.id, status: row.status, existing: row.created_by !== user.id } };
}
// V4.0-T10 事件枚举实名(必须与 notifySafe 的真实调用点一致, 禁新造事件名 D-44 ①)
const NOTIFY_EVENTS = ['red_reject', 'judged', 'task_dispatch', 'green_publish', 'archived', 'returned', 'weekly', 'xo_push'];
const MATRIX_TARGETS = ['sales_group', 'applicant', 'committee', 'dept'];
// 事件 -> [接收对象, 群通道]: 与调用点实际 @对象/群一一对应, 矩阵行只认这一组合
const EVENT_ROUTE = {
  red_reject: ['applicant', 'notify'], judged: ['applicant', 'notify'], task_dispatch: ['dept', 'notify'],
  green_publish: ['committee', 'committee'], archived: ['sales_group', 'notify'], returned: ['applicant', 'notify'],
  weekly: ['sales_group', 'notify'], xo_push: ['committee', 'notify']
};
const EVENT_LABEL = {
  red_reject: '红灯自动打回', judged: '研判完成', task_dispatch: '前置评审任务分发', green_publish: '评审结论·绿灯发布',
  archived: '评审归档', returned: '评审单被退回', weekly: '周一评审周报', xo_push: '周四 XO 待上会加推'
};
// V4.0-T10: 通知矩阵开关。判定只在 notify.send 一处(经 deps.allow 注入), 业务调用点不改发送逻辑(单漏斗原则)。
// 关闭/未命中 => 直接不发; 异常 => 放行发送(fail-open), 与 N-02「通知问题永不阻断业务」一致:
// 这里的取舍是「矩阵读失败宁可多发一条, 也不能因为管理面故障漏发关键通知」——漏发会让评审链路失联。
const matrixAllows = (event, target, channel) => {
  try {
    if (!event) return true; // 未标事件的旧调用点保持原行为(迁移期不丢通知)
    const r = db.prepare('SELECT enabled FROM notify_matrix WHERE event=? AND target=? AND channel=?').get(event, target || '*', channel || 'notify');
    if (r) return r.enabled === 1;
    const any = db.prepare('SELECT enabled FROM notify_matrix WHERE event=? AND target=?').get(event, '*');
    if (any) return any.enabled === 1;
    return true; // 矩阵无该行 = 未纳入管理, 默认放行
  } catch (e) { console.error('notify_matrix 读取失败(放行发送):', e.message); return true; }
};
const matrixAllowsEvent = (event, channel) => {
  const rt = EVENT_ROUTE[event];
  return matrixAllows(event, rt ? rt[0] : '*', rt ? rt[1] : channel);
};
// V4.0-T10: 发送目标解析。robot_instances(enabled=1, 同 channel) 为唯一真源;
// config.json 的 NOTIFY_WEBHOOK_URL / COMMITTEE_WEBHOOK_URL 降为迁移期 fallback; 二者择一, 同一事件只发一次。
function resolveRobot(channel) {
  const ch = channel === 'committee' ? 'committee' : 'notify';
  try {
    const r = db.prepare('SELECT id, name, webhook, secret, env FROM robot_instances WHERE enabled=1 AND channel=? ORDER BY id LIMIT 1').get(ch);
    if (r && r.webhook) return { source: 'db', id: r.id, name: r.name, url: r.webhook, secret: r.secret || '', env: r.env };
  } catch (e) { console.error('robot_instances 读取失败, 回落 config:', e.message); }
  const cfgKey = ch === 'committee' ? 'COMMITTEE_WEBHOOK_URL' : 'NOTIFY_WEBHOOK_URL';
  let url = '';
  try { url = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'))[cfgKey] || ''); } catch (e) {}
  return { source: 'config', name: cfgKey, url, secret: '' };
}
// webhook 是 curl 的参数位(notify.js postViaCurl): 入库前硬校验
const badWebhook = (u) => {
  const s = String(u || '').trim();
  if (!s) return 'webhook 不能为空';
  if (s.startsWith('-')) return 'webhook 不得以 - 开头(会被 curl 当选项解析)';
  let parsed; try { parsed = new URL(s); } catch (e) { return 'webhook 不是合法 URL'; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'webhook 仅允许 http/https';
  if (!parsed.hostname) return 'webhook 缺主机名';
  return null;
};
// 待评审商机要素必填集(T2 建档/校验同源; 一行回退: 减项即放松口径)
const OPP_REQUIRED = ['title', 'customer', 'biz_line', 'contract_amount', 'opp_stage', 'sales', 'summary'];
function migrateV40() { // 幂等: 重复启动零副作用(T2 起新数据走端点, 本函数只承接存量)
  const t = now();
  // ① 交付预算升格商机级: 存量附3明细按所属预算单 opp_code 挂靠(曾锁定过→置 confirmed; 源文件与时间戳原样带过来)
  let moved = 0;
  for (const d of db.prepare('SELECT * FROM budget_delivery').all()) {
    const b = db.prepare('SELECT opp_code FROM budgets WHERE id=?').get(d.budget_id);
    const code = String((b && b.opp_code) || '').trim();
    if (!code) continue;
    if (db.prepare('SELECT opp_code FROM opp_delivery WHERE opp_code=?').get(code)) continue;
    db.prepare('INSERT INTO opp_delivery(opp_code,status,rows_json,source_file,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(code, 'confirmed', d.rows_json || '[]', d.source_file || '', d.created_at || t, t);
    moved++;
  }
  // ② 商机档案回填: reviews∪budgets 非空 opp_code 并集, 要素继承该商机最新评审 form_json
  const codes = new Set();
  for (const r of db.prepare("SELECT DISTINCT opp_code FROM reviews WHERE opp_code IS NOT NULL AND opp_code != ''").all()) codes.add(String(r.opp_code));
  for (const r of db.prepare("SELECT DISTINCT opp_code FROM budgets WHERE opp_code IS NOT NULL AND opp_code != ''").all()) codes.add(String(r.opp_code));
  let made = 0;
  for (const code of codes) {
    if (db.prepare('SELECT opp_code FROM opps WHERE opp_code=?').get(code)) continue;
    const rv = db.prepare('SELECT title, form_json, applicant_id FROM reviews WHERE opp_code=? ORDER BY updated_at DESC LIMIT 1').get(code);
    const bd = db.prepare('SELECT project_name FROM budgets WHERE opp_code=? ORDER BY updated_at DESC LIMIT 1').get(code);
    let f = {}; try { f = JSON.parse((rv && rv.form_json) || '{}'); } catch (e) {}
    const archived = db.prepare("SELECT COUNT(*) c FROM reviews WHERE opp_code=? AND status='archived'").get(code).c;
    db.prepare('INSERT INTO opps(opp_code,title,customer,region,province,biz_line,contract_amount,opp_stage,sign_date,sales,pm,survey,summary,source,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(code, (rv && rv.title) || (bd && bd.project_name) || code, String(f.customer || ''), String(f.region || ''), String(f.province || ''),
        String(f.biz_line || ''), num(f.contract_amount), String(f.opp_stage || ''), String(f.sign_date || ''), String(f.sales || ''),
        String(f.pm || ''), String(f.survey || ''), String(f.summary || ''), 'history', archived ? 'reviewed' : 'pending',
        (rv && rv.applicant_id) || null, t, t);
    made++;
  }
  return { moved, made };
}

// ---------- V4.0 T2 交付预算单源算法(spec §1.2/§3): 预算级与商机级共用同一行清洗与成本口径 ----------
// 行模型: {content, stage:实施|运维, pm_pd, own_pd, rd_pd, prod_pd, travel_cost, note};
// 行成本 = (pm+own)×rateFor(dev_dept) + rd×price_rd_outsource + prod×price_prod_outsource + travel_cost
const cleanDeliveryRows = rows => (Array.isArray(rows) ? rows : []).map(r => ({
  content: String(r.content || '').slice(0, 200),
  stage: r.stage === '运维' ? '运维' : '实施',
  pm_pd: Math.max(0, num(r.pm_pd) || 0), own_pd: Math.max(0, num(r.own_pd) || 0),
  rd_pd: Math.max(0, num(r.rd_pd) || 0), prod_pd: Math.max(0, num(r.prod_pd) || 0),
  travel_cost: Math.max(0, num(r.travel_cost) || 0),
  note: String(r.note || '').slice(0, 500)
})).filter(hasBudgetNumbers);
// 存行文本 -> 行数组的容错解析: 与 robotPayload / llmDegrade 同型(坏 JSON 或非数组一律回兜底值, 不抛)
// 名字避开 putDelivery(rowsJson, …) 的同形参数, 防读侧helper 被局部参数遮蔽
const parseRowsJson = s => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
function deliverySumFor(rows, devDept) {
  const S = getSettings();
  const rate = rateFor(devDept, S);
  const rs = cleanDeliveryRows(rows);
  const sum = { pm_pd: 0, own_pd: 0, rd_pd: 0, prod_pd: 0, travel_cost: 0, cost: 0 };
  const rowsOut = rs.map(r => {
    const cost = (r.pm_pd + r.own_pd) * (rate ?? 0)
      + r.rd_pd * (num(S.price_rd_outsource) || 995)
      + r.prod_pd * (num(S.price_prod_outsource) || 320)
      + r.travel_cost;
    sum.pm_pd += r.pm_pd; sum.own_pd += r.own_pd; sum.rd_pd += r.rd_pd; sum.prod_pd += r.prod_pd;
    sum.travel_cost += r.travel_cost; sum.cost += cost;
    return { ...r, cost: +cost.toFixed(2) };
  });
  ['pm_pd', 'own_pd', 'rd_pd', 'prod_pd', 'travel_cost', 'cost'].forEach(k => sum[k] = +sum[k].toFixed(2));
  return { rows: rowsOut, sum, rate, rd_price: num(S.price_rd_outsource) || 995, prod_price: num(S.price_prod_outsource) || 320 };
}
// 决策点 D-5: 商机级交付预算的计价基准取该商机最新预算单 dev_dept → 最新评审 form_json.dev_dept → none(rate 不兜底)
function oppRateOf(code) {
  const b = db.prepare('SELECT fields FROM budgets WHERE opp_code=? ORDER BY updated_at DESC LIMIT 1').get(code);
  if (b) { try { const f = JSON.parse(b.fields || '{}'); if (f.dev_dept) return { dev_dept: String(f.dev_dept), source: 'budget' }; } catch (e) {} }
  const r = db.prepare('SELECT form_json FROM reviews WHERE opp_code=? ORDER BY updated_at DESC LIMIT 1').get(code);
  if (r) { try { const f = JSON.parse(r.form_json || '{}'); if (f.dev_dept) return { dev_dept: String(f.dev_dept), source: 'review' }; } catch (e) {} }
  return { dev_dept: '', source: 'none' };
}
// 隐式建档(spec §3 变更行): 评审单落 opp_code 而档案缺失时补一条; 有意的形态宽松(兼容脏存量码), 显式 POST /api/opp 才做形态校验
function upsertOpp(code, source, formObj, title, applicantId) {
  if (!code) return;
  if (db.prepare('SELECT opp_code FROM opps WHERE opp_code=?').get(code)) return; // 只补档, 永不覆盖既有要素
  const f = formObj || {};
  const t = now();
  db.prepare('INSERT INTO opps(opp_code,title,customer,region,province,biz_line,contract_amount,opp_stage,sign_date,sales,pm,survey,summary,source,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(String(code), String(title || f.title || code), String(f.customer || ''), String(f.region || ''), String(f.province || ''),
      String(f.biz_line || ''), num(f.contract_amount), String(f.opp_stage || ''), String(f.sign_date || ''), String(f.sales || ''),
      String(f.pm || ''), String(f.survey || ''), String(f.summary || ''), String(source || 'form'), 'pending',
      applicantId || null, t, t);
}
// 建档要素的列序常量(T2 读写共用; 与 opps DDL 列序去掉主键/系统列后一致)
const OPP_FIELDS = ['title', 'customer', 'region', 'province', 'biz_line', 'contract_amount', 'opp_stage', 'sign_date', 'sales', 'pm', 'survey', 'summary'];
const OPP_CREATE_ROLES = ['销售经理', '销售支持组', '项目经理', '财务BP', 'admin']; // 一行回退: 加角色即放宽建档口
// 建档缺项谓词(网页表单与技能④对话轮共用, 保证 missing[] 两路径同源)
const oppMissing = body => OPP_REQUIRED.filter(k => {
  const v = body[k];
  if (v === undefined || v === null) return true;
  if (k === 'contract_amount') return num(v) == null;
  return !String(v).trim();
});
// 建档唯一裁判: POST /api/opp(source=form) 与技能④确认建档(source=agent) 同走此处, 形态门/缺项/409 文案逐字一致
function createOpp(user, body, source) {
  const code = String(body.opp_code || body.code || '').trim();
  // 显式建档做形态校验(挡掉 T1 §4.5 那类"商机阶段"表头脏码); 隐式 upsert 故意不校验以兼容存量
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-]{1,39}$/.test(code)) return { status: 400, data: { error: '商机代码不合法:需 2-40 位字母数字开头, 仅可含 . _ -' } };
  const missing = oppMissing(body);
  if (missing.length) return { status: 400, data: { error: '待评审商机要素不齐:' + missing.join(', '), missing } };
  if (db.prepare('SELECT opp_code FROM opps WHERE opp_code=?').get(code)) return { status: 409, data: { error: '商机代码已存在:' + code } };
  const t = now();
  db.prepare('INSERT INTO opps(opp_code,title,customer,region,province,biz_line,contract_amount,opp_stage,sign_date,sales,pm,survey,summary,source,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(code, String(body.title).trim(), String(body.customer).trim(), String(body.region || ''), String(body.province || ''),
      String(body.biz_line).trim(), num(body.contract_amount), String(body.opp_stage).trim(), String(body.sign_date || ''),
      String(body.sales).trim(), String(body.pm || ''), String(body.survey || ''), String(body.summary).trim(),
      source, 'pending', user.id, t, t);
  return { status: 200, data: { opp: db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code) } };
}

// ---------- 工具 ----------
const now = () => new Date().toISOString();
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 25 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
function auth(req) {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!token) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  return db.prepare('SELECT id,username,name,role,dept FROM users WHERE id=?').get(s.user_id);
}
function addEvent(reviewId, action, actor, detail) {
  db.prepare('INSERT INTO events(review_id,action,actor,detail,created_at) VALUES(?,?,?,?,?)')
    .run(reviewId, action, actor, detail || '', now());
}
// ---------- 预算单工具(阶段2, 任务2.2/2.3/2.4) ----------
function getSettings() { // 逐 key 回落 DEFAULT_SETTINGS(§2.5)
  const s = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key,value FROM settings').all()) {
    if (r.key in DEFAULT_SETTINGS) {
      const n = Number(r.value);
      if (Number.isFinite(n)) s[r.key] = n;
    }
  }
  return s;
}
function budgetView(r) {
  return {
    id: r.id, code: r.code, version: r.version, status: r.status, parent_id: r.parent_id || null,
    owner_id: r.owner_id, project_name: r.project_name || '', opp_code: r.opp_code || null,
    fields: JSON.parse(r.fields || '{}'),
    calc: r.calc ? JSON.parse(r.calc) : null,
    settings_snapshot: r.settings_snapshot ? JSON.parse(r.settings_snapshot) : null,
    created_at: r.created_at, updated_at: r.updated_at
  };
}
const getBudgetRaw = id => (id == null ? null : db.prepare('SELECT * FROM budgets WHERE id=?').get(id)); // #R2: 参数缺失容错(undefined 抛异常致 500)
function linkBudgetErr(review, budgetId) {
  const budget = getBudgetRaw(budgetId);
  if (!budget) return '预算单不存在';
  if (budget.status !== 'locked') return '只能关联已锁定的预算单';
  const reviewCode = String((review && review.opp_code) || '').trim();
  const budgetCode = String(budget.opp_code || '').trim();
  if (reviewCode !== budgetCode) return '预算单与评审单必须属于同一商机';
  return '';
}
function getBudget(id) { const r = getBudgetRaw(id); return r ? budgetView(r) : null; }
function budgetChain(bd) { // 版本链: 向上到根 + 收集后代, 按 version 升序
  const byId = {};
  let cur = getBudgetRaw(bd.id), guard = 0;
  while (cur && guard++ < 50) {
    byId[cur.id] = cur;
    if (!cur.parent_id) break;
    cur = getBudgetRaw(cur.parent_id);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of db.prepare('SELECT * FROM budgets').all())
      if (row.parent_id && byId[row.parent_id] && !byId[row.id]) { byId[row.id] = row; grew = true; }
  }
  return Object.values(byId).map(budgetView).sort((a, b) => a.version - b.version);
}
function newBudgetCode() { // 'B-'+年+'-'+序号4位(§4.4)
  const y = new Date().getFullYear();
  const last = db.prepare('SELECT code FROM budgets WHERE code LIKE ? ORDER BY id DESC LIMIT 1').get('B-' + y + '-%');
  const n = last ? (parseInt(last.code.split('-')[2], 10) || 0) + 1 : 1;
  return 'B-' + y + '-' + String(n).padStart(4, '0');
}
function addAgentMsg(budgetId, role, content) {
  db.prepare('INSERT INTO agent_messages(budget_id,role,content,created_at) VALUES(?,?,?,?)').run(budgetId, role, content, now());
}
// 技能②③(任务 3.3): 评审草稿对话留痕(agent_messages.review_id 列, 阶段2 建表已含)
function addAgentMsgReview(reviewId, role, content) {
  db.prepare('INSERT INTO agent_messages(review_id,role,content,created_at) VALUES(?,?,?,?)').run(reviewId, role, content, now());
}

// ---------- 通知适配器(阶段3, 任务 3.6): 8 触发点 + 周一/周四定时 ----------
// settings 原始字符串读写(getSettings 只数字化数字键, 幂等标记为 ISO 日期需独立通道)
const getSettingRaw = k => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : undefined; };
const setSettingRaw = (k, v, by) => {
  db.prepare('INSERT OR REPLACE INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?)').run(k, String(v), now(), by || 'notify');
};
// ---------- V4.0 T9 LLM 管理(spec §6.1): 凭据单一入口 + 降级参数 + 提示词版本 ----------
// config.json 唯一写者仍是 POST /api/admin/config(D-43 ②); 此处只读, 每请求重读故桩测试改写即时生效
const LLM_PROFILE_NAMES = ['default', 'budget', 'review', 'parser'];
const LLM_DEFAULT_MODEL = 'deepseek-chat';
const CFG_PATH = path.join(ROOT, 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch (e) { return {}; } };
const maskKey = k => { // 前 3 后 4 掩码, 绝不回明文
  const s = String(k || '');
  return s.length <= 7 ? '****' : s.slice(0, 3) + '****' + s.slice(-4);
};
// D-52(T14) 唯一裁判: base 恒为 spawn('curl') 的位置参数 ⇒ 非法 base 必须在写入侧挡下(读侧探针那道降级为纵深防御)
// 裁判只裁「显式提交的值是不是 http(s)」; 空串/未提供属「不修改」语义, 恒判合法(空值由各调用侧的「非空才写」守卫拦截)
function llmBaseErr(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  return /^https?:\/\/[^\s]+$/i.test(s) ? '' : '不是 http(s):// 地址';
}
// 优先级: profile 覆盖 > default profile(spec「缺省回退 default」) > 环境变量 > 顶层 config > 内置默认 model
function resolveLlm(profile) {
  const cfg = readCfg();
  const ps = cfg.LLM_PROFILES || {};
  const p = ps[profile] || {}, d = ps.default || {};
  const pick = (k, envK, dflt) => p[k] ? [p[k], 'profile'] : d[k] ? [d[k], 'default'] : process.env[envK] ? [process.env[envK], 'env']
    : cfg[envK] ? [cfg[envK], 'config'] : [dflt, dflt ? 'builtin' : 'none'];
  const [base, base_src] = pick('base', 'LLM_BASE_URL', '');
  const [key, key_src] = pick('key', 'LLM_API_KEY', '');
  const [model, model_src] = pick('model', 'LLM_MODEL', LLM_DEFAULT_MODEL);
  return { base: String(base).replace(/\/+$/, ''), key: String(key), model: String(model), prompt: p.prompt || undefined, base_src, key_src, model_src };
}
// llm.degrade 是 JSON 字符串, 必须 getSettingRaw(getSettings 只数字化 DEFAULT_SETTINGS 数字键)
function llmDegrade() {
  try { const d = JSON.parse(getSettingRaw('llm.degrade') || '{}'); return d && typeof d === 'object' ? d : {}; } catch (e) { return {}; }
}
const llmTimeoutSec = (deg, dflt) => deg.timeout_ms ? Math.min(60, Math.max(1, Math.round(Number(deg.timeout_ms) / 1000) || dflt)) : dflt;
// prompt.<skill>.v<n> 取最高 n; 值为 JSON 字符串(或 {text}), 解析失败按原文
function promptVersions(skill) {
  const re = new RegExp('^prompt\\.' + skill + '\\.v(\\d+)$');
  return db.prepare('SELECT key, value, updated_at, updated_by FROM settings WHERE key LIKE ?').all('prompt.' + skill + '.v%')
    .map(r => { const m = r.key.match(re); return m ? { ...r, v: Number(m[1]) } : null; }).filter(Boolean).sort((a, b) => b.v - a.v);
}
const promptText = raw => { try { const j = JSON.parse(raw); return typeof j === 'string' ? j : (j && typeof j.text === 'string' ? j.text : String(raw)); } catch (e) { return String(raw); } };
function promptFor(skill) {
  const top = promptVersions(skill)[0];
  const t = top ? promptText(top.value).trim() : '';
  return t || undefined;
}
// 技能调用参数: 提示词 settings 版本 > profile.prompt > 冻结默认(fallbackPrompt; 技能① 传 undefined 由 agent.js 回落 SYSTEM_PROMPT)
function llmCfgFor(skill, fallbackPrompt) {
  const c = resolveLlm(skill);
  const deg = llmDegrade();
  return { base: c.base, key: c.key, model: c.model, prompt: promptFor(skill) || c.prompt || fallbackPrompt,
    maxTime: llmTimeoutSec(deg, 30), retries: Math.min(2, Math.max(0, Math.floor(Number(deg.retries) || 0))), enabled: deg.enabled !== false };
}
// retries 缺省 0 ⇒ 与 A-08「失败不重试直接降级」等价; enabled=false ⇒ 不出站直接 throw 交调用方降级
async function extractWithPolicy(draft, message, llmCfg) {
  if (!llmCfg.enabled) throw new Error('大模型已停用(llm.degrade.enabled=false)');
  for (let i = 0; ; i++) {
    try { return await extractFields(draft, message, llmCfg); } catch (e) { if (i >= llmCfg.retries) throw e; }
  }
}
const estTokens = (draft, message) => Math.ceil((JSON.stringify(draft || {}).length + String(message || '').length) / 2);
const applicantPhone = reviewId => {
  const r = db.prepare('SELECT u.phone FROM reviews rv JOIN users u ON u.id=rv.applicant_id WHERE rv.id=?').get(reviewId);
  return r && r.phone ? [r.phone] : [];
};
// 审查整改#6: 通知链接统一入口——PUBLIC_BASE_URL 优先(部署时填 http://<服务器IP>:8600), 默认回落 localhost
function reviewLink(id) {
  let base = '';
  try { base = String(JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).PUBLIC_BASE_URL || '').replace(/\/+$/, ''); } catch (e) {}
  return `${base || 'http://localhost:' + PORT}/#/review/${id}`;
}
const notify = createNotify({
  getSetting: getSettingRaw,
  setSetting: setSettingRaw,
  listReviews: () => db.prepare("SELECT id,title,round,status,light,route,updated_at FROM reviews WHERE status IN ('reviewing','judged') ORDER BY updated_at DESC LIMIT 200").all(),
  reportLink: reviewLink,
  phonesOf: dept => db.prepare("SELECT phone FROM users WHERE role=? AND phone IS NOT NULL AND phone != ''").all(dept).map(r => r.phone),
  allow: matrixAllowsEvent,
  resolveUrl: resolveRobot
});
// fire-and-forget 封装: 通知永不阻断主流程(N-02), 全部 try/catch 兜底
const notifySafe = (channel, md, opts) => { try { notify.send(channel, md, opts || {}).catch(() => {}); } catch (e) { console.error('[notify]' + e.message); } };
function diffFields(oldF, newF) { // 本轮变更字段(值变化或新增)
  const d = {};
  for (const k of Object.keys(newF || {})) if (newF[k] !== (oldF || {})[k]) d[k] = newF[k];
  return d;
}
// ---------- 报告链接 HMAC 签名(任务1.5, SEC-03/04/05) ----------
// 密钥首启生成并写回 config.json(与 LLM 凭据同文件,互不干扰)
function reportSecret() {
  if (reportSecret._v) return reportSecret._v;
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch (e) {}
  if (!cfg.REPORT_SECRET) {
    cfg.REPORT_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(ROOT, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  }
  reportSecret._v = cfg.REPORT_SECRET;
  return reportSecret._v;
}
const signReport = (rid, exp) => crypto.createHmac('sha256', reportSecret()).update(`${rid}.${exp}`).digest('hex');
// 外发链接 token: rid.exp.sig, 默认 7 天有效
const reportToken = (rid, days = 7) => {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  return `${rid}.${exp}.${signReport(rid, exp)}`;
};
function verifyReportToken(t) {
  const m = String(t || '').match(/^(\d+)\.(\d+)\.([0-9a-f]{64})$/);
  if (!m) return null;
  if (signReport(m[1], m[2]) !== m[3]) return null; // SEC-04: 签名不符
  if (+m[2] < Math.floor(Date.now() / 1000)) return null; // SEC-03: 已过期
  return m[1];
}
function getReview(id) { return id == null ? null : db.prepare('SELECT * FROM reviews WHERE id=?').get(id); } // #R2: 同 #R2 参数容错
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isNaN(n) ? null : n; };

// ---------- 提交: 生成前置评审任务 ----------
function createTasks(review, round) {
  const inds = INDICATORS[review.type] || [];
  const ins = db.prepare('INSERT INTO tasks(review_id,round,ind_key,ind_name,dept,standards) VALUES(?,?,?,?,?,?)');
  const rows = [];
  for (const ind of inds) {
    const r = ins.run(review.id, round, ind.key, ind.name, ind.dept, ind.standards);
    rows.push({ id: Number(r.lastInsertRowid), review_id: review.id, round,
      ind_key: ind.key, ind_name: ind.name, dept: ind.dept });
  }
  // 入箱收敛在本函数: 现在与未来的每个调用点都只经这一处, 调用方不得各自再写一份
  try {
    for (const record of buildTaskDispatches({ ...review, round }, rows, publicBaseUrl()))
      enqueueRobotOutbox(record, null);
  } catch (e) { console.error('robot_outbox 入箱失败(不阻断评审提交):', e.message); }
  return rows;
}

// ---------- 规则引擎: AI 研判 ----------
// 任务 3.1(S-05/API-20): 提交必填锁定预算单的类型范围。T3 口径扩展(2026-10-09): bid+presale 预算先行
// (售前商机早期可建草稿预算随谈判精化); change 保持可选(预算在历史单)。业务确认调整时改此常量一行即可(回退开关)
const BUDGET_REQUIRED_TYPES = ['bid', 'presale'];
// V4.0-G2 门禁(spec §2.2, 决策点 D-2 从严): 三类预算锁定一律要求该商机交付预算已确认。一行回退: 删元素即放松该类型(仿 BUDGET_REQUIRED_TYPES 惯例)
const DELIVERY_REQUIRED_TYPES = ['bid', 'presale', 'change'];
// ---------- V4.0 §5 必填注册表单源(逐项搬运 public/app.js FIELDS, 键名/顺序/标签/选项一律保持; 对账用例 tests/test_required.js RQ-02/03) ----------
const REQUIRED = {
  // 待评审商机要素(T1 已建, 此处只作投影供 meta 消费)
  opp: OPP_REQUIRED,
  // 预算科目缺项(finance.js MISSING_BUDGET 的只读投影, 不做第二实现)
  budget: MISSING_BUDGET,
  review: {
    presale: [
      { k: 'opp_code', l: '商机代码' }, { k: 'customer', l: '客户名称', req: 1 },
      { k: 'opp_stage', l: '商机阶段' }, { k: 'region', l: '营销区域' },
      { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
      { k: 'contract_amount', l: '预计合同金额(万元)', t: 'number', req: 1 },
      { k: 'sign_date', l: '预计签单时间', t: 'date', req: 1 },
      { k: 'sales', l: '销售经理' }, { k: 'pm', l: '项目经理' },
      { k: 'survey', l: '是否涉及测绘(外业采集或地图)', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'sub_early_flag', l: '是否涉及分包提前进场', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'presale_invest', l: '预计售前投入成本(万元)', t: 'number', req: 1 },
      { k: 'presale_period', l: '预计售前实施周期(月)', t: 'number', req: 1 },
      { k: 'summary', l: '项目概述', t: 'textarea', full: 1, req: 1 }
    ],
    bid: [
      { k: 'opp_code', l: '商机代码' }, { k: 'opp_stage', l: '商机阶段' },
      { k: 'region', l: '营销区域' }, { k: 'customer', l: '最终客户名称', req: 1 },
      { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
      { k: 'contract_amount', l: '预计合同金额(万元)', t: 'number', req: 1 },
      { k: 'sales', l: '销售经理' }, { k: 'pm', l: '项目经理' },
      { k: 'sign_date', l: '预计签单时间', t: 'date' },
      { k: 'gross_margin', l: '预计贡献毛利率(%)', t: 'number', req: 1 },
      { k: 'cost_happened', l: '项目已发生成本(万元)', t: 'number' },
      { k: 'ops_years', l: '项目运维周期(年)', t: 'number', req: 1 },
      { k: 'sign_path', l: '签约路径', full: 1, ph: '示例:A公司→B公司→丰图科技(深圳)有限公司', req: 1 },
      { k: 'sub_amount', l: '分包总金额(万元)', t: 'number' },
      { k: 'designated_sub_amount', l: '指定类分包金额(万元)', t: 'number' },
      { k: 'survey_sub_amount', l: '测绘类分包金额(万元)', t: 'number' },
      { k: 'sub_core', l: '分包是否涉及公司核心能力', t: 'select', o: ['否', '是'] },
      { k: 'survey', l: '是否涉及测绘', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'jiadao', l: '是否涉及甲导资质', t: 'select', o: ['否', '是'] },
      { k: 'secret', l: '是否涉密项目', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'province', l: '项目所在地省份', ph: '如:江西省' },
      { k: 'product_type', l: '产品售卖类型', t: 'select', o: ['非标品', '标品'] },
      { k: 'promo_target', l: '项目推广激励面向对象', t: 'select', o: ['无', '内部', '外部', '均包含'] },
      { k: 'promo_amount', l: '项目推广激励金额(万元)', t: 'number' },
      { k: 'promo_outside', l: '是否存在SF体系外条款激励', t: 'select', o: ['否', '是'] },
      { k: 'settle_method', l: '结算方式', ph: '如:银行转账 / 电汇 / 3个月内银行承兑汇票', req: 1 },
      { k: 'payback_time', l: '预计回款时间', ph: '如:预计26年Q4回款40%,27年Q2回款60%' },
      { k: 'b2b_scene', l: '合同背靠背场景', ph: '如:回款+验收=全部背靠背' },
      { k: 'revenue_confirm', l: '确收方式及预估确收时间', ph: '如:一次性确收,预计27年Q1' },
      { k: 'guarantee', l: '合同是否存在担保', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'non_compete', l: '合同是否存在竞业条款', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'sub_limit', l: '合同是否有转包限制', t: 'select', o: ['否', '是'] },
      { k: 'payment_terms', l: '付款条件(写明合同条款)', t: 'textarea', full: 1, req: 1 },
      { k: 'summary', l: '项目概述', t: 'textarea', full: 1, req: 1 },
      { k: 'data_review', l: '是否涉及数据评审', t: 'select', o: ['否', '是'], req: 1 },
      { k: 'data_plan', l: '预期实现方式(涉及数据评审时填)', t: 'textarea', full: 1 },
      { k: 'data_content', l: '数据交付字段/内容(涉及数据评审时填)', t: 'textarea', full: 1 },
      { k: 'data_compliance', l: '数据合规性审查内容(涉及数据评审时填)', t: 'textarea', full: 1 }
    ],
    change: [
      { k: 'proj_code', l: '项目代码' }, { k: 'sales', l: '销售经理' },
      { k: 'pm', l: '项目经理' }, { k: 'customer', l: '最终客户' },
      { k: 'biz_line', l: '业务线', t: 'select', o: ['G1', 'B2', 'G2'], req: 1 },
      { k: 'region', l: '营销区域' },
      { k: 'proj_stage', l: '项目阶段', t: 'select', o: ['实施中', '运维中'], req: 1 },
      { k: 'change_type', l: '决策事项类型', t: 'select', o: ['签单与投标决策差异', '项目成本变动', '验收单异常', '分包变化', '项目核减', '坏账', '项目非正常终止', '其他'], req: 1 },
      { k: 'old_contract_amount', l: '原合同金额(万元)', t: 'number' },
      { k: 'old_gross_margin', l: '原贡献毛利率(%)', t: 'number' },
      { k: 'new_contract_amount', l: '变更后合同金额(万元)', t: 'number' },
      { k: 'new_gross_margin', l: '变更后贡献毛利率(%)', t: 'number' },
      { k: 'old_sub_amount', l: '原分包金额(万元)', t: 'number' },
      { k: 'new_sub_amount', l: '变更后分包金额(万元)', t: 'number' },
      { k: 'old_delivery_cost', l: '原交付成本(万元)', t: 'number' },
      { k: 'new_delivery_cost', l: '变更后交付成本(万元)', t: 'number' },
      { k: 'old_sales_cost', l: '原销售成本(万元)', t: 'number' },
      { k: 'new_sales_cost', l: '变更后销售成本(万元)', t: 'number' },
      { k: 'over_pay', l: '是否涉及分包合同超进度支付', t: 'select', o: ['否', '是'] },
      { k: 'path_change', l: '是否涉及签约路径变化', t: 'select', o: ['否', '是'] },
      { k: 'delivery_change', l: '是否涉及交付内容变化', t: 'select', o: ['否', '是'] },
      { k: 'summary', l: '决策事项概述', t: 'textarea', full: 1, req: 1 }
    ]
  }
};
const reqKeys = t => (REQUIRED.review[t] || []).filter(f => f.req).map(f => f.k);
const reqLabels = t => (REQUIRED.review[t] || []).filter(f => f.req).map(f => f.l);
// §5 提交必填门一行回退: 置 false 即放松(仿 BUDGET_REQUIRED_TYPES/DELIVERY_REQUIRED_TYPES 惯例)
const SUBMIT_REQUIRED_GATE = true;

// ===== spec 2026-10-19 §4/§5: 商机档案 profile 与建单 prefill 的共享解析帮手（只读, 供 360 与 prefill 两处复用）=====
const CROSS_TYPE_KEYS = ['customer', 'biz_line', 'region', 'province', 'sales', 'pm', 'contract_amount', 'opp_stage', 'sign_date', 'survey'];
const isBlankV = v => v === undefined || v === null || String(v).trim() === '';
const formOf = r => { try { return JSON.parse(r.form_json || '{}'); } catch (e) { return {}; } };
const srcReview = (r, v, source, scope) => ({ value: v, source, from: r.id, type: r.type, era: r.era || null, round: r.round ?? null, status: r.status, updated_at: r.updated_at || null, ...(scope ? { scope } : {}) });

// spec §5.1: 360 顶层 profile — fields/sources 恒含 OPP_FIELDS 全部 12 键(含 title/summary); summary 跳过 change 型;
// 评审来源取非草稿最新一张(updated_at DESC, id DESC), 档案 opps 行兜底; missing = OPP_REQUIRED 子集
function resolveOppProfile(code) {
  const rows = db.prepare('SELECT * FROM reviews WHERE opp_code=? AND status!=\'draft\' ORDER BY updated_at DESC, id DESC').all(code);
  const forms = rows.map(r => ({ r, f: formOf(r) }));
  const arch = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
  const fields = {}, sources = {};
  for (const k of OPP_FIELDS) { fields[k] = null; sources[k] = null; }
  const setArch = k => { if (arch && !isBlankV(arch[k])) { fields[k] = arch[k]; sources[k] = { value: arch[k], source: 'archive' }; } };
  for (const k of OPP_FIELDS) {
    if (k === 'title') {
      const t = forms.find(x => !isBlankV(x.r.title) || !isBlankV(x.f.title));
      if (t) { fields.title = !isBlankV(t.r.title) ? t.r.title : t.f.title; sources.title = srcReview(t.r, fields.title, 'review'); }
      else setArch('title');
      continue;
    }
    if (k === 'summary') {
      const s = forms.find(x => x.r.type !== 'change' && !isBlankV(x.f.summary));
      if (s) { fields.summary = s.f.summary; sources.summary = srcReview(s.r, fields.summary, 'review'); }
      else setArch('summary');
      continue;
    }
    const hit = forms.find(x => !isBlankV(x.f[k]));
    if (hit) { fields[k] = hit.f[k]; sources[k] = srcReview(hit.r, fields[k], 'review'); }
    else setArch(k);
  }
  return { fields, sources, missing: OPP_REQUIRED.filter(k => isBlankV(fields[k])) };
}

// spec §5.2: 建单预填 — fields/sources 键集 = REQUIRED.review[type] 全部键(非 req-only)去 opp_code, 未解析值恒为 null;
// 级联 在线同型>在线跨型(CROSS_TYPE_KEYS)>历史同型>历史跨型>档案(OPP_FIELDS 限); 例外: summary 只同型且 change 不取档案;
// proj_code 不跨型且档案无该列; title 走 1-5 不受限, 取 reviews.title || form_json.title, 单独返回不进 fields; 不返回 missing
function resolvePrefill(code, type) {
  const keys = REQUIRED.review[type].map(f => f.k).filter(k => k !== 'opp_code');
  const rows = db.prepare('SELECT * FROM reviews WHERE opp_code=? AND status!=\'draft\' ORDER BY updated_at DESC, id DESC').all(code);
  const forms = rows.map(r => ({ r, f: formOf(r) }));
  const online = forms.filter(x => !x.r.era || x.r.era === 'online');
  const hist = forms.filter(x => x.r.era === 'history');
  const arch = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
  const fields = {}, sources = {};
  for (const k of keys) { fields[k] = null; sources[k] = null; }
  const pickRev = (list, k, sameOnly) => {
    for (const x of list) {
      if (sameOnly ? x.r.type === type : x.r.type !== type) {
        const v = x.f[k];
        if (!isBlankV(v)) return srcReview(x.r, v, 'review', sameOnly ? 'same' : 'cross');
      }
    }
    return null;
  };
  const setArch = (k, allow) => { if (allow && arch && !isBlankV(arch[k]) && OPP_FIELDS.includes(k)) { fields[k] = arch[k]; sources[k] = { value: arch[k], source: 'archive', scope: 'archive' }; } };
  for (const k of keys) {
    if (k === 'summary') { const hit = pickRev(online, k, true) || pickRev(hist, k, true); if (hit) { fields[k] = hit.value; sources[k] = hit; } else setArch(k, type !== 'change'); continue; }
    if (k === 'proj_code') { const hit = pickRev(online, k, true) || pickRev(hist, k, true); if (hit) { fields[k] = hit.value; sources[k] = hit; } else setArch(k, true); continue; }
    const hit = pickRev(online, k, true) || (CROSS_TYPE_KEYS.includes(k) ? pickRev(online, k, false) : null)
      || pickRev(hist, k, true) || (CROSS_TYPE_KEYS.includes(k) ? pickRev(hist, k, false) : null);
    if (hit) { fields[k] = hit.value; sources[k] = hit; continue; }
    setArch(k, true);
  }
  const tPick = list => {
    for (const x of list) {
      const v = !isBlankV(x.r.title) ? x.r.title : (!isBlankV(x.f.title) ? x.f.title : null);
      if (v !== null) return srcReview(x.r, v, 'review', x.r.type === type ? 'same' : 'cross');
    }
    return null;
  };
  const tHit = tPick(online) || tPick(hist) || (arch && !isBlankV(arch.title) ? { value: arch.title, source: 'archive', scope: 'archive' } : null);
  return { code, type, title: tHit ? tHit.value : '', title_source: tHit || null, fields, sources };
}

function judge(review) {
  const form = JSON.parse(review.form_json || '{}');
  let budget = null;
  try { budget = review.budget_json ? JSON.parse(review.budget_json) : null; } catch (e) {}
  // 任务 3.2(J-01/J-02): budgetMargin 三级优先——关联预算单 budgets.calc > 在线预算表 budget_json.computed > 表单手填
  let budgetMargin = null;
  let gmSrc = '';
  if (review.budget_id) {
    const b = getBudgetRaw(review.budget_id);
    if (b && b.calc) {
      let bc = null;
      try { bc = JSON.parse(b.calc); } catch (e) {}
      if (bc && bc.margin != null) { budgetMargin = bc.margin; gmSrc = '(取自关联预算单)'; }
    }
  }
  if (budgetMargin == null && budget && budget.computed && budget.computed.margin != null) {
    budgetMargin = budget.computed.margin;
    gmSrc = '(取自在线预算表)';
  }
  const items = []; // {name, level, reason, xo}
  const L = { green: 0, yellow: 1, red: 2 };
  const push = (name, level, reason, xo) => items.push({ name, level, reason, xo: !!xo });

  if (review.type === 'bid') {
    const amount = num(form.contract_amount);
    const subAmt = num(form.sub_amount);
    const gm = budgetMargin != null ? budgetMargin : num(form.gross_margin);
    const yunwei = num(form.ops_years);
    const surveySub = num(form.survey_sub_amount);
    if (amount != null && subAmt != null && amount > 0) {
      const rate = subAmt / amount * 100;
      // 回退开关: 制度原文若确认>=70%属红线, 把上一行改回 'red' 并删去第4参即可(用例 R-01 同步反转)
      if (rate >= 70) push('分包占比', 'yellow', `分包占比 ${rate.toFixed(1)}% >= 70%, 过单项目`, true);
      else if (rate >= 40) push('分包占比', 'yellow', `分包占比 ${rate.toFixed(1)}% >= 40%`, true);
      else push('分包占比', 'green', `分包占比 ${rate.toFixed(1)}% < 40%`);
    }
    if (amount != null && surveySub != null && amount > 0 && surveySub > 0) {
      const rate = surveySub / amount * 100;
      if (rate >= 40) {
        const isGD = String(form.province || '').includes('广东');
        push('测绘类分包占比', isGD ? 'red' : 'yellow',
          `测绘类分包占比 ${rate.toFixed(1)}% >= 40%${isGD ? ', 项目地在广东省 → 升红' : ''}`, !isGD);
      }
    }
    if (gm != null) {
      if (gm < 0) push('贡献利润', 'yellow', `贡献毛利率 ${(+gm).toFixed(2)}% < 0%(负毛利)${gmSrc}`, true);
      else if (gm < 10) push('贡献利润', 'yellow', `贡献毛利率 ${(+gm).toFixed(2)}% < 10%${gmSrc}`);
      else push('贡献利润', 'green', `贡献毛利率 ${(+gm).toFixed(2)}% >= 10%${gmSrc}`);
    }
    if (amount != null) {
      if (amount >= 500) push('合同金额', 'yellow', `合同金额 ${amount}万 >= 500万`, true);
      else push('合同金额', 'green', `合同金额 ${amount}万 < 500万`);
    }
    if (yunwei != null) {
      if (yunwei > 3) push('项目运维周期', 'yellow', `运维周期 ${yunwei} 年 > 3年`, true);
      else push('项目运维周期', 'green', `运维周期 ${yunwei} 年 <= 3年`);
    }
    if ((num(form.designated_sub_amount) || 0) > 0) push('指定供应商', 'yellow', `存在指定类分包(金额 ${form.designated_sub_amount} 万),指定性分包需上 XO 级`, true);
    if (form.sign_path) {
      const hops = String(form.sign_path).split(/→|->|>/).filter(s => s.trim()).length;
      const transfers = Math.max(hops - 1, 0);
      if (transfers > 5) push('签约转包次数', 'red', `签约转包 ${transfers} 次(路径 ${hops} 层) > 5 次,红线`);
      else if (transfers >= 3) push('签约转包次数', 'yellow', `签约转包 ${transfers} 次(路径 ${hops} 层), >=3 次需上会`);
      else push('签约转包次数', 'green', `签约转包 ${transfers} 次(路径 ${hops} 层) < 3 次`);
    }
    const promoAmt = num(form.promo_amount);
    if (form.promo_target === '外部' || form.promo_target === '均包含') {
      const ratio = amount != null && promoAmt != null ? promoAmt / amount * 100 : null;
      if ((ratio != null && ratio >= 15) || (promoAmt != null && promoAmt >= 30))
        push('推广激励', 'yellow', `对外推广激励 ${promoAmt}万(占比 ${ratio != null ? ratio.toFixed(1) + '%' : '-'}), 比例>=15%或金额>=30万`, true);
    }
    if (form.promo_outside === '是') push('条款外激励', 'yellow', 'SF 体系内规则条款外激励', true);
    if (form.guarantee === '是') push('合同担保事项', 'yellow', '合同存在提供担保或为他人提供担保', true);
    if (form.non_compete === '是') push('竞业事项', 'yellow', '合同存在竞业条款', true);
    const settle = String(form.settle_method || '');
    if (settle.includes('商业承兑')) push('结算方式', 'red', '商业承兑汇票属红线');
    else if (settle.includes('承兑')) push('结算方式', 'yellow', '超3个月银行承兑汇票需上会');
    else if (settle) push('结算方式', 'green', settle);
  }

  if (review.type === 'presale') {
    const invest = num(form.presale_invest);
    const amount = num(form.contract_amount);
    const period = num(form.presale_period);
    if (invest != null) {
      if (invest >= 50) push('售前投入成本', 'yellow', `售前投入 ${invest}万 >= 50万`, true);
      else if (invest > 10) push('售前投入成本', 'yellow', `售前投入 ${invest}万 > 10万`);
      else push('售前投入成本', 'green', `售前投入 ${invest}万 <= 10万`);
    }
    if (invest != null && amount != null && amount > 0) {
      const rate = invest / amount * 100;
      if (rate > 5) push('售前投入占比', 'yellow', `售前投入占比 ${rate.toFixed(1)}% > 5%`);
      else push('售前投入占比', 'green', `售前投入占比 ${rate.toFixed(1)}% <= 5%`);
    }
    if (period != null) {
      if (period > 3) push('售前实施周期', 'yellow', `售前实施周期 ${period} 个月 > 3个月`);
      else push('售前实施周期', 'green', `售前实施周期 ${period} 个月 <= 3个月`);
    }
    if (form.sign_date) {
      const y = String(form.sign_date).slice(0, 4);
      const cur = String(new Date().getFullYear());
      if (y === cur) push('预计签单时间', 'green', `预计 ${form.sign_date} 签单, 当前自然年内`);
      else push('预计签单时间', 'yellow', `预计 ${form.sign_date} 签单, 非当前自然年`);
    }
  }

  if (review.type === 'change') {
    const oldCost = num(form.old_delivery_cost);
    const newCost = num(form.new_delivery_cost);
    const newGm = num(form.new_gross_margin);
    if (oldCost != null && newCost != null) {
      const delta = newCost - oldCost;
      if (delta > 10 || (newGm != null && newGm < 10)) push('成本变动-交付成本', 'yellow', `交付成本增加 ${delta.toFixed(1)}万${newGm != null ? `, 变更后毛利率 ${newGm}%` : ''}`);
      else push('成本变动-交付成本', 'green', `交付成本增加 ${delta.toFixed(1)}万 <= 10万 且毛利率达标`);
    }
    if (newGm != null && newGm < 0) push('贡献利润', 'yellow', `变更后贡献毛利率 ${newGm}% < 0%`, true);
    const newAmount = num(form.new_contract_amount);
    if (newAmount != null && newAmount >= 500) push('合同金额', 'yellow', `变更后合同金额 ${newAmount}万 >= 500万`, true);
    if (form.over_pay === '是') push('分包超进度支付', 'yellow', '分包合同突破条款超进度支付, 全部上会');
  }

  // 前置评审人工灯态
  const tasks = db.prepare('SELECT * FROM tasks WHERE review_id=? AND round=? AND status=?').all(review.id, review.round, 'done');
  for (const t of tasks) {
    push(`前置评审·${t.ind_name}(${t.dept})`, t.light, t.opinion || `${t.dept} 判定 ${t.light}`);
  }

  // 综合灯态
  let light = 'green';
  for (const it of items) if (L[it.level] > L[light]) light = it.level;
  const hasXO = items.some(i => i.xo && i.level !== 'green');
  // XO 直通(判例 08068 实证): XO 事项仅指定供应商/推广激励/条款外激励时, 跳过部门级直上 XO
  const xoItems = items.filter(i => i.xo && i.level !== 'green');
  const directXO = light === 'yellow' && xoItems.length > 0 &&
    xoItems.every(i => ['指定供应商', '推广激励', '条款外激励'].includes(i.name));
  let route;
  if (light === 'red') route = '红灯打回:销售/项目经理与客户重新协商后再次提交';
  else if (light === 'green') route = '绿灯:免上会,留档备查,直接推进';
  else if (directXO) route = '黄灯:XO级项目评审会(直通)';
  else if (hasXO) route = '黄灯:先部门级评审会,通过后上 XO 级评审会';
  else route = '黄灯:部门级评审会(每周二)';

  // 生成研判报告文本
  const riskItems = items.filter(i => i.level !== 'green');
  let report = `【AI 研判报告】${TYPE_NAMES[review.type]} · ${review.title}\n`;
  report += `综合灯态:${light === 'red' ? '红灯' : light === 'yellow' ? '黄灯' : '绿灯'}\n评审路径:${route}\n\n`;
  if (riskItems.length === 0) {
    report += '全部指标均为绿灯,无关键风险点。\n';
  } else {
    report += `关键风险点(${riskItems.length} 项):\n`;
    riskItems.forEach((it, i) => {
      report += `${i + 1}. [${it.level === 'red' ? '红灯' : '黄灯'}] ${it.name}:${it.reason}${it.xo ? '(触发XO级)' : ''}\n`;
    });
  }
  report += `\n量化指标自动判定 ${items.length - tasks.length} 项,前置评审人工判定 ${tasks.length} 项。`;
  return { light, route, report, detail: items };
}

// judge() 谓词的只读镜像；改定量项时必须同步此表和覆盖分类，绝不参与灯色或路由。
const QUANT_ITEMS = {
  bid: ['分包占比', '测绘类分包占比', '贡献利润', '合同金额', '项目运维周期', '指定供应商', '签约转包次数', '推广激励', '条款外激励', '合同担保事项', '竞业事项', '结算方式'],
  presale: ['售前投入成本', '售前投入占比', '售前实施周期', '预计签单时间'],
  change: ['成本变动-交付成本', '贡献利润', '合同金额', '分包超进度支付']
};
function judgeCoverage(review) {
  const form = JSON.parse(review.form_json || '{}');
  const skipped = [], notTriggered = [];
  const miss = (name, reason) => skipped.push({ name, reason });
  const quiet = (name, reason) => notTriggered.push({ name, reason });
  const yesNo = (name, v, label) => { if (isBlankV(v)) miss(name, label + '未填'); else if (v !== '是') quiet(name, label + '为「' + v + '」'); };
  if (review.type === 'bid') {
    const amount = num(form.contract_amount), subAmt = num(form.sub_amount), surveySub = num(form.survey_sub_amount);
    let gm = null;
    if (review.budget_id) {
      const b = getBudgetRaw(review.budget_id);
      if (b && b.calc) { try { const bc = JSON.parse(b.calc); if (bc && bc.margin != null) gm = bc.margin; } catch (e) {} }
    }
    if (gm == null) { try { const bj = review.budget_json ? JSON.parse(review.budget_json) : null; if (bj && bj.computed && bj.computed.margin != null) gm = bj.computed.margin; } catch (e) {} }
    if (gm == null) gm = num(form.gross_margin);
    const amtOk = amount != null && amount > 0;
    if (!amtOk || subAmt == null) miss('分包占比', !amtOk ? '缺预计合同金额' : '缺分包总金额');
    if (!amtOk || surveySub == null) miss('测绘类分包占比', !amtOk ? '缺预计合同金额' : '缺测绘类分包金额');
    else if (!(surveySub > 0 && surveySub / amount * 100 >= 40)) quiet('测绘类分包占比', '测绘类分包占比 < 40% 或无测绘分包');
    if (gm == null) miss('贡献利润', '缺贡献毛利率(关联预算单/在线预算表/表单均无)');
    if (amount == null) miss('合同金额', '缺预计合同金额');
    if (num(form.ops_years) == null) miss('项目运维周期', '缺项目运维周期');
    const ds = num(form.designated_sub_amount);
    if (ds == null) miss('指定供应商', '指定类分包金额未填'); else if (!(ds > 0)) quiet('指定供应商', '无指定类分包');
    if (!form.sign_path) miss('签约转包次数', '缺签约路径');
    if (isBlankV(form.promo_target)) miss('推广激励', '推广激励面向对象未填');
    else if (form.promo_target !== '外部' && form.promo_target !== '均包含') quiet('推广激励', '面向对象为「' + form.promo_target + '」');
    else {
      const promoAmt = num(form.promo_amount);
      const ratio = amount != null && promoAmt != null ? promoAmt / amount * 100 : null;
      if (promoAmt == null) miss('推广激励', '缺推广激励金额');
      else if (promoAmt < 30 && amount == null) miss('推广激励', '缺预计合同金额，无法判断激励占比');
      else if (!((ratio != null && ratio >= 15) || promoAmt >= 30)) quiet('推广激励', '比例 < 15% 且金额 < 30万');
    }
    yesNo('条款外激励', form.promo_outside, 'SF 体系外条款激励');
    yesNo('合同担保事项', form.guarantee, '合同担保');
    yesNo('竞业事项', form.non_compete, '竞业条款');
    if (!String(form.settle_method || '')) miss('结算方式', '缺结算方式');
  }
  if (review.type === 'presale') {
    const invest = num(form.presale_invest), amount = num(form.contract_amount);
    if (invest == null) miss('售前投入成本', '缺预计售前投入成本');
    if (invest == null || amount == null || !(amount > 0)) miss('售前投入占比', invest == null ? '缺预计售前投入成本' : '缺预计合同金额');
    if (num(form.presale_period) == null) miss('售前实施周期', '缺预计售前实施周期');
    if (!form.sign_date) miss('预计签单时间', '缺预计签单时间');
  }
  if (review.type === 'change') {
    const oldCost = num(form.old_delivery_cost), newCost = num(form.new_delivery_cost), newGm = num(form.new_gross_margin), newAmount = num(form.new_contract_amount);
    if (oldCost == null || newCost == null) miss('成本变动-交付成本', oldCost == null ? '缺原交付成本' : '缺变更后交付成本');
    if (newGm == null) miss('贡献利润', '缺变更后贡献毛利率'); else if (!(newGm < 0)) quiet('贡献利润', '变更后毛利率 >= 0%');
    if (newAmount == null) miss('合同金额', '缺变更后合同金额'); else if (!(newAmount >= 500)) quiet('合同金额', '变更后合同金额 < 500万');
    yesNo('分包超进度支付', form.over_pay, '分包超进度支付');
  }
  return { skipped, notTriggered };
}
function evidenceFor(task, review) {
  const form = JSON.parse(review.form_json || '{}');
  const ev = indEvidence(review.type, task.ind_key, task.dept);
  const fields = REQUIRED.review[review.type] || [];
  const label = k => (fields.find(f => f.k === k) || {}).l || k;
  const has = k => fields.some(f => f.k === k);
  const val = v => v == null ? '' : String(v);
  const aSet = new Set(ev.aItems);
  const computed = judge(review).detail.filter(i => !String(i.name).startsWith('前置评审·'))
    .map(i => ({ name: i.name, level: i.level, reason: i.reason, xo: !!i.xo, focus: aSet.has(i.name) }));
  const amountKey = review.type === 'change' ? (isBlankV(form.new_contract_amount) ? 'old_contract_amount' : 'new_contract_amount') : 'contract_amount';
  const anchors = [
    { label: '商机代码', value: val(review.opp_code || form.opp_code) },
    { label: '项目名称', value: val(review.title) },
    { label: label('customer'), value: val(form.customer) },
    { label: label(amountKey), value: val(form[amountKey]) },
    { label: '申请人', value: val(review.applicant_name) },
    { label: '申请时间', value: val(review.created_at) }
  ];
  for (const k of ['sign_path', 'biz_line', 'region', ...ev.anchors]) {
    if (!has(k) || anchors.some(a => a.label === label(k))) continue;
    anchors.push({ label: label(k), value: val(form[k]) });
  }
  const cov = judgeCoverage(review);
  return {
    task: { id: task.id, review_id: task.review_id, ind_key: task.ind_key, ind_name: task.ind_name, dept: task.dept, standards: task.standards, status: task.status, round: task.round },
    review: { id: review.id, type: review.type, title: review.title, opp_code: review.opp_code, status: review.status, round: review.round, applicant_name: review.applicant_name, created_at: review.created_at },
    cls: ev.cls, computed,
    formFacts: ev.formKeys.map(k => ({ k, label: label(k), value: val(form[k]) })),
    anchors, external: { required: ev.external, hint: ev.hint },
    skipped: cov.skipped, notTriggered: cov.notTriggered
  };
}
function annotateTasks(rows) {
  const roleOf = new Map(db.prepare('SELECT name, role FROM users').all().map(u => [u.name, u.role]));
  return rows.map(t => {
    const done_role = t.done_by ? (roleOf.get(t.done_by) || null) : null;
    return { ...t, done_role, proxy: !!(done_role && done_role !== t.dept && (t.status === 'done' || t.status === 'returned')) };
  });
}

// 保存研判结果(含 HTML 报告); 任务1.4: 红灯不再落 judged, 自动打回 status=returned + auto_return 事件留痕
function saveJudged(review, result) {
  const tasks = db.prepare("SELECT * FROM tasks WHERE review_id=? AND round=? AND status='done'").all(review.id, review.round);
  const form = JSON.parse(review.form_json || '{}');
  const html = buildReportHtml({ ...review, light: result.light, route: result.route }, form, result.detail, tasks);
  const status = result.light === 'red' ? 'returned' : 'judged';
  db.prepare('UPDATE reviews SET status=?, light=?, route=?, report=?, judge_detail=?, report_html=?, updated_at=? WHERE id=?')
    .run(status, result.light, result.route, result.report, JSON.stringify(result.detail), html, now(), review.id);
  if (result.light === 'red') {
    const redReasons = result.detail.filter(i => i.level === 'red').map(i => `${i.name}:${i.reason}`).join('; ');
    addEvent(review.id, 'auto_return', '系统', '红灯自动打回,请修改后重新提交。' + redReasons);
    // ③ 红灯自动打回通知申请人(任务 3.6 触发点)
    notifySafe('notify', `### 红灯自动打回\n**${review.title}** 研判为红灯,请修改后重新提交。\n红灯项:${redReasons || '-'}\n[打开评审单](${reviewLink(review.id)})`, { title: '红灯自动打回', phones: applicantPhone(review.id), event: 'red_reject' });
  } else {
    // ④ 研判完成按灯分级文案(任务 3.6 触发点): 黄=上会提醒 / 绿=免上会留档
    const zh = result.light === 'yellow' ? '黄灯(需上会)' : '绿灯(免上会,留档备查)';
    notifySafe('notify', `### 研判完成\n**${review.title}** 综合灯态:${zh}\n评审路径:${result.route}\n[查看研判报告](${reviewLink(review.id)})`, { title: '研判完成', phones: applicantPhone(review.id), event: 'judged' });
  }
}

// ---------- 研判报告 HTML(对齐真实产出版式) ----------
const FIELD_LABELS = {
  opp_code: '商机代码', opp_name: '商机名称', customer: '最终客户名称', opp_stage: '商机阶段', region: '营销区域',
  biz_line: '业务线', contract_amount: '预计合同金额(万元)', sales: '销售经理', pm: '项目经理',
  sign_date: '预计签单时间', gross_margin: '预计贡献毛利率(%)', cost_happened: '项目已发生成本(万元)',
  ops_years: '项目运维周期', sign_path: '签约路径', sub_amount: '分包总金额(万元)',
  designated_sub_amount: '指定类分包金额(万元)', survey_sub_amount: '测绘类分包金额(万元)',
  sub_core: '分包是否涉及公司核心能力', survey: '是否涉及测绘', jiadao: '是否涉及甲导资质',
  secret: '是否涉密项目', promo_target: '项目推广激励面向对象', promo_amount: '项目推广激励(万元)',
  settle_method: '结算方式', payback_time: '预计回款时间', payment_terms: '付款条件',
  b2b_scene: '合同背靠背场景', revenue_confirm: '确收方式及预估确收时间',
  guarantee: '合同是否存在担保', non_compete: '合同是否存在竞业条款', sub_limit: '合同是否有转包限制',
  province: '项目所在地省份', product_type: '产品售卖类型', data_review: '是否涉及数据评审',
  data_plan: '预期实现方式', data_content: '数据交付字段/内容', data_compliance: '数据合规性审查内容',
  summary: '项目概述', presale_invest: '预计售前投入成本(万元)', presale_period: '预计售前实施周期(月)',
  sub_early_flag: '是否涉及分包提前进场', proj_code: '项目代码', proj_stage: '项目阶段',
  change_type: '决策事项类型', old_contract_amount: '原合同金额(万元)', old_gross_margin: '原贡献毛利率(%)',
  new_contract_amount: '变更后合同金额(万元)', new_gross_margin: '变更后贡献毛利率(%)',
  old_sub_amount: '原分包金额(万元)', new_sub_amount: '变更后分包金额(万元)',
  old_delivery_cost: '原交付成本(万元)', new_delivery_cost: '变更后交付成本(万元)',
  old_sales_cost: '原销售成本(万元)', new_sales_cost: '变更后销售成本(万元)',
  over_pay: '是否涉及分包超进度支付', path_change: '是否涉及签约路径变化', delivery_change: '是否涉及交付内容变化'
};
const WIDE_FIELDS = ['sign_path', 'summary', 'payment_terms', 'data_plan', 'data_content', 'data_compliance'];
const ADVICE = [
  [/毛利|利润/, '审视报价及成本结构的合理性,评估潜在盈利空间;若盈利无望,需准备充分论据阐明项目除财务回报外的核心价值,并清晰说明公司进行战略性投资的必要性。'],
  [/转包次数|签约路径/, '论证多层转包的合理性,明确各层级利润分配机制及回款链路的风险管控。'],
  [/分包占比|过单/, '说明分包必要性、下游分包方资质、付款背靠背安排及过单项目的风险控制措施。'],
  [/合同金额/, '说明大额项目的客户信用评估、付款条件与回款保障措施。'],
  [/运维周期/, '说明长周期运维的人员安排、成本测算与服务质量保障。'],
  [/指定供应商/, '说明指定供应商的必要性、资质情况及替代方案评估。'],
  [/担保/, '说明担保条款的背景、范围、期限及风险缓释措施。'],
  [/竞业/, '说明竞业条款对公司业务的影响范围及应对策略。'],
  [/结算方式/, '说明票据结算的兑付风险与回款安排。'],
  [/付款条件/, '说明付款条款的合理性、垫资情况及回款保障。'],
  [/数据/, '说明数据类型、来源、传输存储链路、加密与脱敏措施,以及合规部门的管控要求落实情况。'],
  [/测绘|甲导|合规/, '说明测绘/资质合规风险点及已采取的管控举措。']
];
function adviceFor(name) {
  for (const [re, text] of ADVICE) if (re.test(name)) return text;
  return '准备该风险项的详细说明材料与风险缓释措施。';
}
function escH(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function buildReportHtml(review, form, items, tasks) {
  const lightTxt = { green: '绿灯 — 免上会', yellow: '黄灯 — 上会决策', red: '红灯 — 红线禁止' }[review.light];
  const theme = { green: ['#065F46', '#D1FAE5', '#6EE7B7'], yellow: ['#D97706', '#FFFBEB', '#FDE68A'], red: ['#B91C1C', '#FEF2F2', '#FECACA'] }[review.light];
  const riskItems = items.filter(i => i.level !== 'green');
  const judgeTime = new Date().toLocaleString('zh-CN', { hour12: false });

  // 基础信息行
  const baseRows = [];
  const entries = Object.entries(FIELD_LABELS).filter(([k]) => form[k] !== undefined && String(form[k]).trim() !== '');
  baseRows.push(`<tr><td class="lb">商机/项目名称</td><td class="vl" colspan="3">${escH(review.title)}</td></tr>`);
  let buf = [];
  for (const [k, label] of entries) {
    if (WIDE_FIELDS.includes(k)) {
      if (buf.length) { baseRows.push('<tr>' + buf.join('') + (buf.length === 2 ? '<td class="lb"></td><td class="vl"></td>' : '') + '</tr>'); buf = []; }
      baseRows.push(`<tr><td class="lb">${label}</td><td class="vl" colspan="3">${escH(form[k])}</td></tr>`);
    } else {
      buf.push(`<td class="lb">${label}</td><td class="vl">${escH(form[k])}</td>`);
      if (buf.length === 4) { baseRows.push('<tr>' + buf.join('') + '</tr>'); buf = []; }
    }
  }
  if (buf.length) baseRows.push('<tr>' + buf.join('') + (buf.length === 2 ? '<td class="lb"></td><td class="vl"></td>' : '') + '</tr>');

  const badge = l => {
    const m = { red: ['#B91C1C', '红灯'], yellow: ['#D97706', '黄灯'], green: ['#059669', '绿灯'] }[l];
    return m ? `<span style="display:inline-block;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600;color:#fff;background:${m[0]};">${m[1]}</span>` : '';
  };
  const riskRows = riskItems.map((it, i) => `<tr>
    <td style="padding:10px 14px;text-align:center;border-bottom:1px solid #E5E7EB;color:#6B7280;">${i + 1}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;font-weight:500;">${escH(it.name)}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;text-align:center;">${badge(it.level)}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;color:#4B5563;font-size:13px;line-height:1.6;">${escH(it.reason)}${it.xo ? '<br><strong>触发 XO 级评审</strong>' : ''}</td>
  </tr>`).join('');

  const taskRows = tasks.map(t => `<tr>
    <td style="padding:8px 14px;border-bottom:1px solid #E5E7EB;">${escH(t.ind_name)}</td>
    <td style="padding:8px 14px;border-bottom:1px solid #E5E7EB;">${escH(t.dept)}</td>
    <td style="padding:8px 14px;border-bottom:1px solid #E5E7EB;text-align:center;">${badge(t.light)}</td>
    <td style="padding:8px 14px;border-bottom:1px solid #E5E7EB;color:#4B5563;font-size:12.5px;">${escH(t.opinion || '—')}</td>
    <td style="padding:8px 14px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:12.5px;">${escH(t.done_by || '')}</td>
  </tr>`).join('');

  const meetingSection = review.light === 'green' ? '' : `
  <h2 class="sec">三、会议准备</h2>
  <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:14px;">
    <tr><td class="lb" style="width:20%">主办组织</td><td class="vl" style="width:30%">销售支持组</td><td class="lb" style="width:20%">主述人</td><td class="vl">${review.type === 'change' ? '项目经理' : '销售经理'}</td></tr>
    <tr><td class="lb">会议时间</td><td class="vl">以会邀为准(部门级每周二/XO级每周五)</td><td class="lb">提报路径</td><td class="vl">${review.type === 'change' ? '项目经理' : '销售经理'}→销售支持组</td></tr>
  </table>
  <div style="display:flex;gap:14px;align-items:stretch;">
    <div style="flex:0 0 220px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px;">
      <div style="font-weight:600;color:#374151;margin-bottom:8px;font-size:13px;">参会人员</div>
      <ul style="margin:0;padding-left:18px;color:#4B5563;font-size:12px;"><li>销售经理</li><li>项目经理</li><li>交付负责人</li><li>营销负责人</li><li>业务线负责人</li><li>采购负责人(BP一同列席)</li><li>财务负责人(BP一同列席)</li><li>法务专员</li><li>公共事务处合规专员</li><li>PMO</li></ul>
    </div>
    <div style="flex:1;background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px;">
      <div style="font-weight:600;color:#92400E;margin-bottom:8px;font-size:13px;">汇报准备</div>
      ${riskItems.map((it, i) => `<div style="margin-bottom:8px;font-size:12px;line-height:1.65;color:#78350F;"><strong style="color:#92400E;">${i + 1}. ${escH(it.name)}:</strong>${adviceFor(it.name)}</div>`).join('')}
    </div>
  </div>
  <div style="margin-top:10px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:14px;">
    <div style="font-weight:600;color:#374151;margin-bottom:8px;font-size:13px;">需准备材料</div>
    <ul style="margin:0;padding-left:18px;color:#4B5563;font-size:12px;"><li>《${TYPE_NAMES[review.type]}-信息收集与前置评审表》</li><li>《项目贡献毛利率及成本预算表》</li><li>智能体风险评估报告</li></ul>
  </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>项目风险评估报告 - ${escH(review.title)}</title>
<style>
body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#F3F4F6;color:#1F2937;line-height:1.6;}
.container{max-width:960px;margin:0 auto;padding:32px 24px;}
.header{background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);color:#fff;padding:32px 36px;border-radius:12px 12px 0 0;}
.header h1{font-size:22px;margin:0 0 4px;}
.header .subtitle{font-size:14px;opacity:.85;}
.content{background:#fff;padding:32px 36px;border-radius:0 0 12px 12px;box-shadow:0 1px 3px rgba(0,0,0,.1);}
.status-card{display:flex;align-items:center;padding:20px 24px;border-radius:10px;margin-bottom:24px;border:2px solid ${theme[2]};background:${theme[1]};}
.status-light{width:26px;height:26px;border-radius:50%;background:${theme[0]};margin-right:18px;}
.status-text h2{font-size:22px;color:${theme[0]};margin:0 0 4px;}
.status-text p{font-size:14px;color:#4B5563;margin:0;}
.sec{font-size:20px;color:#1F2937;margin:32px 0 16px;padding-bottom:10px;border-bottom:2px solid #E5E7EB;}
table{border-collapse:collapse;width:100%;}
.lb{padding:12px 14px;font-weight:600;color:#374151;background:#F9FAFB;width:15%;border-bottom:1px solid #E5E7EB;vertical-align:top;font-size:13px;}
.vl{padding:12px 14px;color:#1F2937;width:35%;border-bottom:1px solid #E5E7EB;font-size:13px;line-height:1.7;}
@media print{body{background:#fff;}.container{padding:0;}.header{border-radius:0;}.content{box-shadow:none;}}
</style></head><body>
<div class="container">
  <div class="header"><h1>丰图科技 · 项目风险评估报告</h1><div class="subtitle">${TYPE_NAMES[review.type]} | 评定时间:${judgeTime} | 第 ${review.round} 轮</div></div>
  <div class="content">
    <div class="status-card"><div class="status-light"></div><div class="status-text"><h2>${lightTxt}</h2><p>${escH(review.route)}</p></div></div>
    <h2 class="sec">一、项目基础信息</h2>
    <table style="border:1px solid #E5E7EB;">${baseRows.join('')}</table>
    <h2 class="sec">二、风险评估详述</h2>
    ${riskItems.length ? `<table style="border:1px solid #E5E7EB;"><thead><tr style="background:#F9FAFB;"><th style="padding:10px 14px;width:50px;text-align:center;border-bottom:2px solid #E5E7EB;">#</th><th style="padding:10px 14px;text-align:left;border-bottom:2px solid #E5E7EB;">风险指标</th><th style="padding:10px 14px;width:80px;text-align:center;border-bottom:2px solid #E5E7EB;">等级</th><th style="padding:10px 14px;text-align:left;border-bottom:2px solid #E5E7EB;">详情</th></tr></thead><tbody>${riskRows}</tbody></table>`
    : '<p style="color:#059669;font-weight:600;">全部指标均为绿灯,无关键风险点。</p>'}
    <h2 class="sec">附:前置评审意见汇总</h2>
    <table style="border:1px solid #E5E7EB;"><thead><tr style="background:#F9FAFB;"><th style="padding:8px 14px;text-align:left;border-bottom:2px solid #E5E7EB;">评判指标</th><th style="padding:8px 14px;text-align:left;border-bottom:2px solid #E5E7EB;">责任部门</th><th style="padding:8px 14px;width:70px;text-align:center;border-bottom:2px solid #E5E7EB;">灯态</th><th style="padding:8px 14px;text-align:left;border-bottom:2px solid #E5E7EB;">前置评审意见</th><th style="padding:8px 14px;width:90px;text-align:left;border-bottom:2px solid #E5E7EB;">评审人</th></tr></thead><tbody>${taskRows}</tbody></table>
    ${meetingSection}
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #E5E7EB;text-align:center;color:#9CA3AF;font-size:12px;">本报告由丰图科技项目评审平台自动生成 | ${judgeTime} | 仅供内部评审参考</div>
  </div>
</div></body></html>`;
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // 静态资源
    if (req.method === 'GET' && (p === '/' || p === '/source-view.js' || p.startsWith('/app.') || p.startsWith('/style'))) {
      const file = p === '/' ? 'index.html' : p.slice(1);
      const fp = path.join(PUBLIC_DIR, file);
      if (fs.existsSync(fp)) {
        const ext = path.extname(fp);
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[ext] || 'text/plain';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-cache' }); // 发版即时生效, 避免旧 JS 缓存导致"修复不生效"
        return res.end(fs.readFileSync(fp));
      }
    }
    // 附件下载(审查整改#1: 补登录鉴权, 未登录 401)
    if (req.method === 'GET' && p.startsWith('/uploads/')) {
      if (!auth(req)) return send(res, 401, { error: '未登录' });
      const rel = decodeURIComponent(p.replace('/uploads/', ''));
      const fp = path.join(UPLOAD_DIR, rel);
      if (fs.existsSync(fp) && fp.startsWith(UPLOAD_DIR)) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(fp))}` });
        return res.end(fs.readFileSync(fp));
      }
      return send(res, 404, { error: '文件不存在' });
    }
    // 审查整改#13: 登录页演示提示开关(免鉴权, 仅下发布尔, 登录页在登录前渲染故走独立端点; 须位于 auth 之前)
    if (p === '/api/public-config' && req.method === 'GET') {
      let demo = true;
      try { demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).DEMO_HINT !== false; } catch (e) {}
      return send(res, 200, { demo_hint: demo });
    }

    // 登录
    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = await parseBody(req);
      const u = db.prepare('SELECT * FROM users WHERE username=?').get(username || '');
      if (!u || !verifyPw(password || '', u.password_hash)) return send(res, 401, { error: '用户名或密码错误' });
      const token = crypto.randomBytes(24).toString('hex');
      db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, u.id, now());
      return send(res, 200, { token, user: { id: u.id, username: u.username, name: u.name, role: u.role, dept: u.dept } });
    }

    // 研判报告 HTML: 双通道鉴权(任务1.5)
    // 通道1: 登录态 Bearer 直接放行(SEC-05,内部用户); 通道2: 外发链接 ?token=rid.exp.sig(SEC-03,7天)
    const mReport = p.match(/^\/api\/reports\/(\d+)\.html$/);
    if (mReport && req.method === 'GET') {
      const rv = getReview(mReport[1]);
      if (!rv || !rv.report_html) return send(res, 404, { error: '报告不存在或尚未研判' });
      if (!auth(req) && verifyReportToken(url.searchParams.get('token')) !== mReport[1])
        return send(res, 403, { error: '报告链接无效或已过期,请登录系统查看,或向单据申请人索取新链接' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(rv.report_html);
    }

    const user = auth(req);
    if (!user) return send(res, 401, { error: '未登录' });

    if (p === '/api/me') return send(res, 200, { user });

    const mImportFile = p.match(/^\/api\/import-sources\/(\d+)\/file$/);
    if (mImportFile && req.method === 'GET') {
      const source = db.prepare('SELECT * FROM import_sources WHERE id=?').get(mImportFile[1]);
      if (!source) return send(res, 404, { error: '原件来源不存在' });
      let entity = null, allowed = false;
      if (source.entity_type === 'review') {
        entity = db.prepare('SELECT id FROM reviews WHERE id=?').get(source.entity_key);
        allowed = !!entity;
      } else if (source.entity_type === 'budget' || source.entity_type === 'delivery_budget') {
        entity = db.prepare('SELECT id,owner_id FROM budgets WHERE id=?').get(source.entity_key);
        allowed = !!entity && (entity.owner_id === user.id || user.role === '销售支持组' || user.role === 'admin');
      } else if (source.entity_type === 'delivery_opp') {
        entity = db.prepare('SELECT opp_code,created_by FROM opps WHERE opp_code=?').get(source.entity_key);
        allowed = !!entity && (entity.created_by === user.id || user.role === '项目经理' || user.role === '销售支持组' || user.role === 'admin');
      }
      if (!entity) return send(res, 404, { error: '来源关联实体不存在' });
      if (!allowed) return send(res, 403, { error: '无权下载该原件' });
      const fp = resolveImportSourcePath(UPLOAD_DIR, source.file_path);
      if (!fp) return send(res, 403, { error: '原件路径不安全' });
      let stat;
      try { stat = fs.statSync(fp); } catch (e) { return send(res, 404, { error: '原件文件不存在' }); }
      if (!stat.isFile()) return send(res, 404, { error: '原件文件不存在' });
      const originalName = source.file_name
        ? String(source.file_name)
        : path.basename(source.file_path || '').replace(/^(?:\d+|[0-9a-f-]{36})_/, '');
      const encodedName = originalName.replace(/[\r\n\0]/g, '') || 'source.xlsx';
      const fallback = encodedName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\x00-\x1f\x7f]/g, '_');
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987Value(encodedName)}`
      });
      return res.end(fs.readFileSync(fp));
    }

    // V4.0-T10 机器人入口: 白名单只决定能否进门(GET 需 query|create, 写操作需 create), 进门后与网页同走全部业务门禁, 不开任何免检旁路
    if (req.headers['x-via-robot']) {
      const scopes = req.method === 'GET' ? ['query', 'create'] : ['create'];
      const ph = (db.prepare('SELECT phone FROM users WHERE id=?').get(user.id) || {}).phone || '';
      const hit = db.prepare(`SELECT 1 FROM robot_whitelist WHERE scope IN (${scopes.map(() => '?').join(',')})
        AND ((kind='user_id' AND ident=?) OR (kind='phone' AND ident=? AND ident != ''))`).get(...scopes, String(user.id), String(ph));
      if (!hit) return send(res, 403, { error: '机器人白名单未授权: 当前身份无' + (req.method === 'GET' ? '查询' : '建档/提交') + '权限' });
    }

    // 报告外发链接(登录态,任务1.5): 返回带 HMAC 签名的临时 URL, 用于微信/邮件推送领导
    const mLink = p.match(/^\/api\/reviews\/(\d+)\/report-link$/);
    if (mLink && req.method === 'GET') {
      const rv = getReview(mLink[1]);
      if (!rv || !rv.report_html) return send(res, 404, { error: '报告不存在或尚未研判' });
      return send(res, 200, { url: `/api/reports/${rv.id}.html?token=${reportToken(rv.id)}`, expires_in: 7 * 86400 });
    }

    // 用户列表(选评审人用)
    if (p === '/api/users' && req.method === 'GET') {
      return send(res, 200, { users: db.prepare('SELECT id,username,name,role,dept FROM users').all() });
    }

    // 异步跑 python(Excel 导入用): spawnSync 会阻塞事件循环 2-5 秒, 期间 keep-alive socket 被
    // server 超时关闭, 后续同连接请求 fetch failed(实测稳定复现)——改异步 spawn 收集输出
    const runPython = (args) => new Promise(resolve => {
      const { spawn } = require('child_process');
      const ch = spawn('python', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '', err = '';
      const timer = setTimeout(() => { try { ch.kill(); } catch (e) {} resolve({ status: 1, stderr: 'timeout', stdout: '', killed: true }); }, 60000);
      ch.stdout.on('data', d => { out += d; });
      ch.stderr.on('data', d => { err += d; });
      ch.on('error', e => { clearTimeout(timer); resolve({ status: 1, stderr: String(e), stdout: '' }); });
      ch.on('close', code => { clearTimeout(timer); resolve({ status: code, stdout: out, stderr: err }); });
    });

    // ---------- 预算单(阶段2, 任务2.4): /api/budget* 端点, 错误体统一 {error} ----------
    // ---------- Admin 解析器实验室(上传实测+原表对账+映射调优, admin 限定) ----------
    const PARSER_LABEL2KEY = { // 对账映射(与 tests/test_parser_audit.js 同源)
      '商机名称': 'opp_name', '商机代码': 'opp_code', '商机阶段': 'opp_stage', '最终客户名称': 'customer',
      '业务线': 'biz_line', '预计合同金额': 'contract_amount', '销售经理': 'sales', '项目经理': 'pm',
      '项目概述': 'summary', '营销区域': 'region', '预计签单时间': 'sign_date', '签约路径': 'sign_path',
      '项目所在地省份': 'province', '结算方式': 'settle_method', '分包总金额': 'sub_amount',
      '客户名称': 'customer', '合同金额': 'contract', '所属部门': 'dev_dept'
    };
    if (p === '/api/admin/parser-lab' && req.method === 'POST') {
      if (user.role !== 'admin' && user.role !== '销售支持组') return send(res, 403, { error: '仅 admin/支持组可用解析器实验室' });
      const { filename, data, type, sheet, use_override } = await parseBody(req);
      if (!filename || !data) return send(res, 400, { error: '缺少文件' });
      const buf = Buffer.from(data, 'base64');
      if (buf.length > 10 * 1024 * 1024) return send(res, 400, { error: '文件不能超过 10MB' });
      const dir = path.join(UPLOAD_DIR, 'lab');
      fs.mkdirSync(dir, { recursive: true });
      const { safe, fp } = writeUniqueUpload(dir, filename, buf);
      // 映射覆盖(调优): settings.parser_map_overrides + use_override 开关
      let mapArgs = [];
      if (use_override) {
        const ov = getSettingRaw('parser_map_overrides');
        if (ov) {
          const ovf = path.join(dir, safe + '.map.json');
          fs.writeFileSync(ovf, ov, 'utf8'); // ov 已是 JSON 文本, 直接写(勿 stringify 双重编码)
          mapArgs = ['--map-override', ovf];
        }
      }
      const args = ['-X', 'utf8', path.join(ROOT, 'tools', 'parse_form_xlsx.py'), fp, '--type', type === 'budget' ? 'budget' : 'review', '--audit'];
      if (sheet) args.push('--sheet', String(sheet));
      const pr = await runPython(args.concat(mapArgs));
      if (pr.status !== 0) return send(res, 502, { error: '解析失败:' + String(pr.stderr || '').slice(0, 200) });
      let parsed;
      try { parsed = JSON.parse(pr.stdout); } catch (e) { return send(res, 502, { error: '解析输出异常' }); }
      if (parsed.error) return send(res, 400, { error: parsed.error });
      // node 侧对账: 原表键值对 vs 解析字段(精确标签匹配); pos=标签格坐标(点击联动溯源)
      const audit = [];
      for (const [lab, raw, pos] of (parsed.pairs || [])) {
        const labN = String(lab).replace(/[\s（）()]/g, '');
        let hit = null;
        for (const [ml, key] of Object.entries(PARSER_LABEL2KEY)) {
          if (labN === ml || labN.startsWith(ml)) { hit = { label: lab, key, raw: raw == null ? null : String(raw).slice(0, 60) }; break; }
        }
        if (hit) {
          const pv = (parsed.fields || {})[hit.key];
          const valsEq = (a, b) => {
            const na = parseFloat(String(a).replace(/[,，]/g, '')), nb = parseFloat(String(b).replace(/[,，]/g, ''));
            if (!isNaN(na) && !isNaN(nb) && /^[\d.,，\s-]+$/.test(String(a))) return Math.abs(na - nb) < 0.01;
            return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
          };
          hit.ok = pv !== undefined && valsEq(raw, pv);
          hit.parsed = pv === undefined ? null : String(pv).slice(0, 60);
        }
        const row = hit || { label: lab, key: null, raw: raw == null ? null : String(raw).slice(0, 60) };
        row.pos = Array.isArray(pos) ? pos : null;
        audit.push(row);
      }
      return send(res, 200, { fields: parsed.fields, warnings: parsed.warnings, meta: parsed.meta, audit, use_override: !!use_override, sources: parsed.sources || {}, grid: parsed.grid || [] });
    }
    // 映射调优: 读/写 settings.parser_map_overrides + 内置默认下示(前端调优表格源)
    if (p === '/api/admin/parser-defaults' && req.method === 'GET') {
      if (user.role !== 'admin' && user.role !== '销售支持组') return send(res, 403, { error: '仅 admin/支持组可调优映射' });
      const pr = await runPython(['-X', 'utf8', path.join(ROOT, 'tools', 'parse_form_xlsx.py'), '--dump-map']);
      if (pr.status !== 0) return send(res, 502, { error: '读取内置映射失败' });
      try { return send(res, 200, { defaults: JSON.parse(pr.stdout) }); } catch (e) { return send(res, 502, { error: '内置映射输出异常' }); }
    }
    if (p === '/api/admin/parser-map' && (req.method === 'GET' || req.method === 'POST')) {
      if (user.role !== 'admin' && user.role !== '销售支持组') return send(res, 403, { error: '仅 admin/支持组可调优映射' });
      if (req.method === 'GET') return send(res, 200, { overrides: (() => { try { return JSON.parse(getSettingRaw('parser_map_overrides') || '{}'); } catch (e) { return {}; } })() });
      const { overrides } = await parseBody(req);
      if (!overrides || typeof overrides !== 'object') return send(res, 400, { error: 'overrides 需为对象' });
      // 校验结构: {REVIEW|BUDGET|FALLBACK: {字段: [关键词...]}}
      for (const [sec, mp] of Object.entries(overrides)) {
        if (!['REVIEW', 'BUDGET', 'FALLBACK'].includes(sec)) return send(res, 400, { error: '非法段: ' + sec });
        if (typeof mp !== 'object') return send(res, 400, { error: sec + ' 需为对象' });
        for (const [k, kws] of Object.entries(mp)) {
          if (!/^\w+$/.test(k) || !Array.isArray(kws) || kws.some(x => typeof x !== 'string' || !x.trim())) return send(res, 400, { error: sec + '.' + k + ' 需为 [关键词字符串数组]' });
        }
      }
      setSettingRaw('parser_map_overrides', JSON.stringify(overrides));
      return send(res, 200, { ok: true });
    }

    // ---------- Excel 导入通道(docs/Excel导入产品方案.md): 预算单/评审单 ----------
    // POST /api/budget/import: 上传含附1-预算表的 xlsx → 解析 17 字段 → mergeDraft 白名单 → 建草稿(不自动锁定)
    if (p === '/api/budget/import' && req.method === 'POST') {
      const { filename, data } = await parseBody(req);
      if (!filename || !data) return send(res, 400, { error: '缺少文件' });
      const buf = Buffer.from(data, 'base64');
      if (buf.length > 10 * 1024 * 1024) return send(res, 400, { error: '文件不能超过 10MB' });
      const dir = path.join(UPLOAD_DIR, 'import');
      fs.mkdirSync(dir, { recursive: true });
      const { safe, fp } = writeUniqueUpload(dir, filename, buf);
      const pr = await runPython(['-X', 'utf8', path.join(ROOT, 'tools', 'parse_form_xlsx.py'), fp, '--type', 'budget', '--audit']);
      if (pr.status !== 0) return send(res, 502, { error: 'Excel 解析失败(python/openpyxl 不可用或文件非附1模板):' + String(pr.stderr || '').slice(0, 150) + '。可在智能体对话口述或手填。' });
      let parsed;
      try { parsed = JSON.parse(pr.stdout); } catch (e) { return send(res, 502, { error: '解析输出异常:' + String(pr.stdout).slice(0, 100) }); }
      if (parsed.error) return send(res, 400, { error: parsed.error });
      if (!Object.keys(parsed.fields || {}).length) return send(res, 400, { error: '未解析到预算字段(需含附1-预算表的评审表模板)。可改用对话口述建单。' });
      const merged = mergeDraft(parsed.fields, {}); // 白名单清洗——status/budget_id 无法注入
      const calc = computeBudget(merged, getSettings());
      const t = now();
      const r = db.prepare('INSERT INTO budgets(code,version,status,owner_id,project_name,fields,calc,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(newBudgetCode(), 1, 'draft', user.id, merged.project_name || safe, JSON.stringify(merged), JSON.stringify(calc), merged.opp_code || null, t, t);
      upsertOpp(String(merged.opp_code || '').trim(), 'excel', merged, merged.project_name || safe, user.id); // D-9 更正: 本锚点是 Excel 通道, source 用 excel(原简报误标 form)
      addAgentMsg(r.lastInsertRowid, 'assistant', `[Excel导入] ${safe} -> ${Object.keys(merged).length} 字段(命中 ${parsed.meta.matched}/${parsed.meta.pairs_total} 对, 未匹配 ${((parsed.warnings || []).length)} 项)——请核对后编交付明细并人工锁定`);
      const source = saveImportSource(db, { entity_type: 'budget', entity_key: String(r.lastInsertRowid),
        file_name: String(filename), file_path: 'import/' + safe, parsed, imported: merged, user, created_at: t });
      return send(res, 200, { ok: true, id: r.lastInsertRowid, fields: merged, calc, warnings: parsed.warnings || [], meta: parsed.meta,
        audit: { pairs: parsed.pairs, sources: parsed.sources, grid: parsed.grid, sheet: parsed.sheet, unpicked: parsed.unpicked || [] }, source: sourceMeta(source) });
    }

    // POST /api/reviews/import: 上传含信息收集表的 xlsx → 解析 → BID 白名单 → 建评审草稿(bid/presale 仍需关联锁定预算提交)
    // mode='history' (docs/历史数据承接方案.md): 历史补录——免门禁直入归档, light='none' 不补判, 仅支持组/admin
    if (p === '/api/reviews/import' && req.method === 'POST') {
      const { filename, data, type, mode, review_date } = await parseBody(req);
      const isHistory = mode === 'history';
      if (isHistory && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅销售支持组可补录历史评审' });
      if (!INDICATORS[type]) return send(res, 400, { error: '评审类型无效(bid/presale/change)' });
      if (!filename || !data) return send(res, 400, { error: '缺少文件' });
      const buf = Buffer.from(data, 'base64');
      if (buf.length > 10 * 1024 * 1024) return send(res, 400, { error: '文件不能超过 10MB' });
      const dir = path.join(UPLOAD_DIR, 'import');
      fs.mkdirSync(dir, { recursive: true });
      const { safe, fp } = writeUniqueUpload(dir, filename, buf);
      const pr = await runPython(['-X', 'utf8', path.join(ROOT, 'tools', 'parse_form_xlsx.py'), fp, '--type', 'review', '--sheet', type === 'bid' ? '投标决策' : (type === 'presale' ? '售前立项' : ''), '--audit']);
      if (pr.status !== 0) return send(res, 502, { error: 'Excel 解析失败:' + String(pr.stderr || '').slice(0, 150) + '。可改用表单手填。' });
      let parsed;
      try { parsed = JSON.parse(pr.stdout); } catch (e) { return send(res, 502, { error: '解析输出异常:' + String(pr.stdout).slice(0, 100) }); }
      if (parsed.error) return send(res, 400, { error: parsed.error });
      if (!Object.keys(parsed.fields || {}).length) return send(res, 400, { error: '未解析到评审字段(需含信息收集表的评审表模板)。可改用表单填写。' });
      const form = mergeDraft(parsed.fields, {}, { whitelist: BID_WHITELIST }); // 白名单清洗
      if (form.gross_margin !== undefined && form.gross_margin > 0 && form.gross_margin < 1) form.gross_margin = Math.round(form.gross_margin * 10000) / 100; // 归一化防线(A-18 同源)
      const t = now();
      // 标题首选商机名称(REVIEW_MAP 只产出 opp_name, 从不产出 project_name, 旧式里那一路是死分支);
      // summary 是项目概述长文, 排首位会把概述当标题, 只留作兜底。本 title 由普通与 history 两分支共用。
      const title = String(form.opp_name || parsed.fields.project_name || form.summary || safe).slice(0, 100);
      if (isHistory) {
        // 历史补录: 业务时间=历史评审日期(缺省取文件名年份), 结论=人工结论, 直入归档不判灯
        const fname = String(filename);
        const ym = fname.match(/(20\d{2})/);
        let archAt = String(review_date || '').slice(0, 10);
        if (!/^20\d{2}-\d{2}-\d{2}$/.test(archAt)) archAt = (parsed.fields.review_date ? String(parsed.fields.review_date).slice(0, 10) : (ym ? ym[1] + '-01-01' : t.slice(0, 10)));
        const dec = String(parsed.fields.decision || '').trim();
        const decision = /通过|同意/.test(dec) ? (/不通过|否决/.test(dec) ? dec : '通过') : (/否决|不通过|放弃/.test(dec) ? dec : '历史导入(结论未录入)');
        const jd = { era: 'history', light: 'none', source: fname, imported_by: user.name, imported_at: t, note: '历史单据无灯态与前置评审过程(灯态规则 2026 年启用)' };
        const r = db.prepare('INSERT INTO reviews(type,title,applicant_id,applicant_name,status,round,form_json,light,decision_result,judge_detail,archived_at,era,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(type, title, user.id, user.name, 'archived', 1, JSON.stringify(form), 'none', decision, JSON.stringify(jd), archAt, 'history', form.opp_code || parsed.fields.opp_code || null, t, t);
        upsertOpp(String(form.opp_code || parsed.fields.opp_code || '').trim(), 'history', form, title, user.id);
        // 原件存证
        db.prepare('INSERT INTO attachments(review_id,field,filename,filepath,uploaded_at) VALUES(?,?,?,?,?)').run(r.lastInsertRowid, '历史评审表原件', fname, 'import/' + safe, t);
        addEvent(r.lastInsertRowid, '历史数据导入', user.name, `来源:${fname} · 评审日期:${archAt} · 结论:${decision} · 导入:${t}(历史单据只在归档库展现)`);
        const source = saveImportSource(db, { entity_type: 'review', entity_key: String(r.lastInsertRowid),
          file_name: fname, file_path: 'import/' + safe, parsed, imported: form, user, created_at: t });
        return send(res, 200, { ok: true, id: r.lastInsertRowid, era: 'history', status: 'archived', light: 'none', decision, archived_at: archAt, form,
          warnings: parsed.warnings || [], meta: parsed.meta,
          audit: { pairs: parsed.pairs, sources: parsed.sources, grid: parsed.grid, sheet: parsed.sheet, unpicked: parsed.unpicked || [] }, source: sourceMeta(source) });
      }
      const r = db.prepare('INSERT INTO reviews(type,title,applicant_id,applicant_name,status,round,form_json,budget_id,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(type, title, user.id, user.name, 'draft', 1, JSON.stringify(form), null, form.opp_code || null, t, t);
      upsertOpp(String(form.opp_code || '').trim(), 'excel', form, title, user.id);
      addEvent(r.lastInsertRowid, '保存草稿', user.name, `Excel 导入(${Object.keys(form).length} 字段, 命中 ${parsed.meta.matched}/${parsed.meta.pairs_total} 对)——请核对补充后提交`);
      const source = saveImportSource(db, { entity_type: 'review', entity_key: String(r.lastInsertRowid),
        file_name: String(filename), file_path: 'import/' + safe, parsed, imported: form, user, created_at: t });
      return send(res, 200, { ok: true, id: r.lastInsertRowid, form, warnings: parsed.warnings || [], meta: parsed.meta,
        audit: { pairs: parsed.pairs, sources: parsed.sources, grid: parsed.grid, sheet: parsed.sheet, unpicked: parsed.unpicked || [] }, source: sourceMeta(source) });
    }

    if (p === '/api/budget' && req.method === 'GET') { // 列表(H-05/H-06, 契约外补充同 messages 先例): 我的(支持组全部; O4: q 商机代码/项目名搜索)
      const q = String(url.searchParams.get('q') || '').trim();
      const esc = q.replace(/[%_\\]/g, m => '\\' + m);
      const conds = [];
      const args = [];
      if (q) { conds.push("(opp_code LIKE ? ESCAPE '\\' OR project_name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')"); args.push('%' + esc + '%', '%' + esc + '%', '%' + esc + '%'); }
      if (!['销售支持组', 'admin'].includes(user.role)) { conds.push('owner_id=?'); args.push(user.id); }
      const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
      const rows = db.prepare('SELECT id,code,version,status,owner_id,project_name,opp_code,updated_at FROM budgets' + where + ' ORDER BY updated_at DESC').all(...args);
      return send(res, 200, { budgets: rows });
    }
    if (p === '/api/budget' && req.method === 'POST') { // 建单(API-01/02): code=B-年-序号4位; D-9 增收 fields/opp_code 并立即落列
      const body = await parseBody(req);
      const merged = mergeDraft(body.fields || {}, {});
      if (body.project_name && !merged.project_name) merged.project_name = String(body.project_name);
      if (body.customer && !merged.customer) merged.customer = String(body.customer);
      const codeB = String(body.opp_code || merged.opp_code || '').trim();
      if (codeB && !db.prepare('SELECT opp_code FROM opps WHERE opp_code=?').get(codeB))
        return send(res, 400, { error: '商机档案不存在:' + codeB + ',请先新建待评审商机(三步链: 建档 → ① 交付预算 → ② 项目预算 → ③ 评审单)' });
      const t = now();
      const code = newBudgetCode();
      const calc = computeBudget(merged, getSettings());
      const r = db.prepare('INSERT INTO budgets(code,version,status,owner_id,project_name,fields,calc,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(code, 1, 'draft', user.id, String(merged.project_name || body.project_name || body.customer || '').slice(0, 200), JSON.stringify(merged), JSON.stringify(calc), codeB || null, t, t);
      return send(res, 200, { id: Number(r.lastInsertRowid), code, version: 1, status: 'draft', opp_code: codeB || null });
    }
    if (p === '/api/budget/preview' && req.method === 'POST') { // 试算(API-07/08): 白名单过滤后纯计算, 不落库
      const { fields } = await parseBody(req);
      const calc = computeBudget(mergeDraft(fields || {}, {}), getSettings());
      return send(res, 200, { calc });
    }
    const mBudget = p.match(/^\/api\/budget\/(\d+)(\/[\w-]+(?:\/[\w-]+){0,2})?$/); // 支持三段子路径(/delivery/import, /delivery/source)
    if (mBudget) {
      const bd = getBudget(mBudget[1]);
      if (!bd) return send(res, 404, { error: '预算单不存在' });
      const sub = mBudget[2];
      const canWrite = bd.owner_id === user.id || user.role === '销售支持组';
      // ---------- 附3交付成本评估明细辅助(上传解析+在线编辑, 递进挂靠预算单) ----------
      // V4.0 T2 裁定 D-6: 有挂靠(opp_code)→单一事实源落 opp_delivery; 无挂靠→沿用 budget_delivery 旧路径(行为零变化, D 套件锚定)
      const oppCodeB = String(bd.opp_code || '').trim();
      const useOppStore = !!oppCodeB;
      const deliverySum = rows => deliverySumFor(rows, bd.fields.dev_dept);
      const getDelivery = () => {
        if (useOppStore) {
          const od = db.prepare('SELECT * FROM opp_delivery WHERE opp_code=?').get(oppCodeB);
          if (od) return od; // 优先新表
        }
        return db.prepare('SELECT * FROM budget_delivery WHERE budget_id=?').get(bd.id); // 回退存量底稿
      };
      // sourceFile 传 undefined 表示保留原值(import 传落盘安全名)
      // D-13: 下面写入的 owner_id 仅为「最后写入人」审计位, 商机级模型下它随最后写入者漂移, 永不作鉴权依据;
      //       商机级写权限唯一来源是 canWriteOpp(建档人/项目经理/支持组/admin)——T3/T5 勿改用本列判权
      const putDelivery = (rowsJson, sourceFile) => {
        const t = now();
        if (useOppStore) {
          const ex = db.prepare('SELECT created_at,source_file FROM opp_delivery WHERE opp_code=?').get(oppCodeB) || {};
          db.prepare('INSERT OR REPLACE INTO opp_delivery(opp_code,status,rows_json,source_file,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
            .run(oppCodeB, 'draft', rowsJson, sourceFile === undefined ? (ex.source_file ?? null) : sourceFile, bd.owner_id, ex.created_at || t, t);
        } else {
          const ex = db.prepare('SELECT created_at,source_file FROM budget_delivery WHERE budget_id=?').get(bd.id) || {};
          db.prepare('INSERT OR REPLACE INTO budget_delivery(budget_id,rows_json,source_file,created_at,updated_at) VALUES(?,?,?,?,?)')
            .run(bd.id, rowsJson, sourceFile === undefined ? (ex.source_file ?? null) : sourceFile, ex.created_at || t, t);
        }
      };
      const canRead = bd.owner_id === user.id || user.role === '销售支持组' || user.role === 'admin'; // 审查整改#7: GET 收紧(对齐 PUT, 放宽 admin)
      if (sub === '/source' && req.method === 'GET') {
        if (!canRead) return send(res, 403, { error: '仅预算单所有者可查看来源' });
        const source = budgetImportSource(db, bd.id);
        if (!source) return send(res, 200, { source: null, sheet: null, comparison: null });
        let audit = {}, imported = {};
        try { audit = JSON.parse(source.audit_json || '{}'); } catch (e) {}
        try { imported = JSON.parse(source.imported_json || '{}'); } catch (e) {}
        return send(res, 200, { source: sourceMeta(source), sheet: audit.sheet || null,
          comparison: formComparison(audit, imported, bd.fields, BUDGET_FIELD_LABELS, BUDGET_WHITELIST) });
      }
      if (!sub && req.method === 'GET') { // 详情含版本链(API-15)
        if (!canRead) return send(res, 403, { error: '仅预算单所有者可查看详情' });
        return send(res, 200, { budget: { ...bd, import_source: sourceMeta(budgetImportSource(db, bd.id)) }, versions: budgetChain(bd) });
      }
      if (!sub && req.method === 'PUT') { // 编辑(API-03/04/05): owner/支持组, 白名单字段合并
        if (!canWrite) return send(res, 403, { error: '仅预算单所有者可编辑' });
        if (bd.status !== 'draft') return send(res, 400, { error: '预算单已锁定,不可编辑,请新建版本' });
        const { fields } = await parseBody(req);
        const merged = mergeDraft(fields || {}, bd.fields);
        const codeP = String(merged.opp_code || '').trim(); // D-9: 显式挂靠落列, 不再等启动回填
        if (codeP && codeP !== String(bd.opp_code || '') && !db.prepare('SELECT opp_code FROM opps WHERE opp_code=?').get(codeP))
          return send(res, 400, { error: '商机档案不存在:' + codeP + ',请先新建待评审商机' });
        const calc = computeBudget(merged, getSettings());
        db.prepare('UPDATE budgets SET fields=?, calc=?, opp_code=?, updated_at=? WHERE id=?')
          .run(JSON.stringify(merged), JSON.stringify(calc), codeP || bd.opp_code || null, now(), bd.id);
        return send(res, 200, { ok: true, calc });
      }
      if (sub === '/lock' && req.method === 'POST') { // 锁定(API-09/10/11, S-01): 缺项全列 400, 重复 409, 快照落库
        if (!canWrite) return send(res, 403, { error: '仅预算单所有者可锁定' });
        if (bd.status !== 'draft') return send(res, 409, { error: '预算单已锁定,请勿重复锁定' });
        const missing = missingOf(bd.fields);
        if (missing.length > 0) return send(res, 400, { error: '必填缺失:' + missing.join(', ') + '(0 允许但必须明确出现)' });
        // V4.0-G2 交付预算门(spec §2.2, D-2 从严): 有挂靠商机→要求 opp_delivery 有明细行且 confirmed; 无挂靠→沿用现网附3 底稿口径(D-6 不放松不收紧)
        if (oppCodeB) {
          const g2Type = String((db.prepare('SELECT type FROM reviews WHERE budget_id=? ORDER BY updated_at DESC LIMIT 1').get(bd.id) || {}).type || 'bid'); // 裁定 D-7: 门禁类型取自该预算单所服务的最新评审单类型; 无关联评审按最严(bid)
          if (DELIVERY_REQUIRED_TYPES.includes(g2Type)) {
            const od = db.prepare('SELECT status,rows_json FROM opp_delivery WHERE opp_code=?').get(oppCodeB);
            if (!od || !cleanDeliveryRows(JSON.parse(od.rows_json || '[]')).length)
              return send(res, 400, { error: '锁定前请先完成交付预算编制:商机 ' + oppCodeB + ' 尚无明细行(① 交付预算 → ② 项目预算 → ③ 评审单)' });
            if (od.status !== 'confirmed')
              return send(res, 400, { error: '锁定前请先确认交付预算:商机 ' + oppCodeB + ' 的交付预算仍为草稿,请在信息收集页签点「确认交付预算」' });
          }
        } else {
          // 无挂靠分支必须永远保留现网口径(简报 §9: 连 DELIVERY_REQUIRED_TYPES=[] 的回退也不短路它), 错误文案为 D 套件锚定原文
          const dl = getDelivery();
          if (!dl || !(JSON.parse(dl.rows_json || '[]')).length)
            return send(res, 400, { error: '锁定前请先上传或编制交付明细表(附3-交付成本评估,递进附件)' });
        }
        const settings = getSettings();
        const calc = computeBudget(bd.fields, settings);
        db.prepare('UPDATE budgets SET status=?, calc=?, settings_snapshot=?, updated_at=? WHERE id=?')
          .run('locked', JSON.stringify(calc), JSON.stringify(settings), now(), bd.id);
        addAgentMsg(bd.id, 'assistant', `预算单已锁定(v${bd.version}),单价快照已存;如需修改请新建新版本。`);
        return send(res, 200, { ok: true, status: 'locked', version: bd.version, calc, settings_snapshot: settings });
      }
      if (sub === '/newversion' && req.method === 'POST') { // 新版本(API-12/13, S-03): 仅锁定版可派生, v1 保持 locked
        if (!canWrite) return send(res, 403, { error: '仅预算单所有者可派生新版本' });
        if (bd.status !== 'locked') return send(res, 409, { error: '无锁定版,仅锁定版本可派生新版本' });
        const chain = budgetChain(bd);
        const maxV = chain.reduce((m, x) => Math.max(m, x.version), 0);
        const t = now();
        const r = db.prepare('INSERT INTO budgets(code,version,status,owner_id,project_name,fields,calc,opp_code,parent_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .run(newBudgetCode(), maxV + 1, 'draft', bd.owner_id, bd.project_name, JSON.stringify(bd.fields), null, bd.opp_code || null, bd.id, t, t); // D-10: 派生版本原样继承父单派生列
        return send(res, 200, getBudget(r.lastInsertRowid));
      }
      if (sub === '/versions' && req.method === 'GET') { // 版本链(API-14)
        if (!canRead) return send(res, 403, { error: '仅预算单所有者可查看版本链' });
        return send(res, 200, { versions: budgetChain(bd) });
      }
      if (sub === '/messages' && req.method === 'GET') { // 对话留痕回放(A-12/A-14)
        if (!canRead) return send(res, 403, { error: '仅预算单所有者可查看对话' });
        return send(res, 200, { messages: db.prepare('SELECT role,content,created_at FROM agent_messages WHERE budget_id=? ORDER BY id').all(bd.id) });
      }

      if (sub === '/delivery/source' && req.method === 'GET') {
        if (!canRead) return send(res, 403, { error: '仅预算单所有者可查看交付明细来源' });
        const oppDelivery = useOppStore ? db.prepare('SELECT * FROM opp_delivery WHERE opp_code=?').get(oppCodeB) : null;
        const d = oppDelivery || db.prepare('SELECT * FROM budget_delivery WHERE budget_id=?').get(bd.id);
        const source = latestImportSource(db, oppDelivery ? 'delivery_opp' : 'delivery_budget', oppDelivery ? oppCodeB : bd.id);
        if (!source) return send(res, 200, { source: null, sheet: null, comparison: null });
        let audit = {}, imported = [];
        try { audit = JSON.parse(source.audit_json || '{}'); } catch (e) {}
        try { imported = JSON.parse(source.imported_json || '[]'); } catch (e) {}
        const current = d ? deliverySum(JSON.parse(d.rows_json || '[]')).rows : [];
        return send(res, 200, { source: sourceMeta(source), sheet: audit.sheet || null,
          comparison: deliveryComparison(audit, Array.isArray(imported) ? imported : [], current) });
      }
      if (sub === '/delivery' && req.method === 'GET') { // 明细回显(含行成本实算)
        if (!canRead) return send(res, 403, { error: '仅预算单所有者可查看交付明细' }); // 第二轮对抗 #R1: 上轮 #7 收紧漏了此端点
        const S = getSettings();
        const oppDelivery = useOppStore ? db.prepare('SELECT * FROM opp_delivery WHERE opp_code=?').get(oppCodeB) : null;
        const d = oppDelivery || db.prepare('SELECT * FROM budget_delivery WHERE budget_id=?').get(bd.id);
        const importSource = latestImportSource(db, oppDelivery ? 'delivery_opp' : 'delivery_budget', oppDelivery ? oppCodeB : bd.id);
        if (!d) return send(res, 200, { rows: [], sum: null, source_file: null, rate: rateFor(bd.fields.dev_dept, S), rd_price: num(S.price_rd_outsource) || 995, prod_price: num(S.price_prod_outsource) || 320, import_source: sourceMeta(importSource) });
        const calc = deliverySum(JSON.parse(d.rows_json || '[]'));
        return send(res, 200, { ...calc, source_file: d.source_file, import_source: sourceMeta(importSource) });
      }
      if (sub === '/delivery' && req.method === 'PUT') { // 在线编辑保存(建设内容基础上修改)
        if (!canWrite) return send(res, 403, { error: '仅预算单所有者可编辑交付明细' });
        if (bd.status !== 'draft') return send(res, 400, { error: '预算单已锁定,请新建版本后编辑明细' });
        const { rows } = await parseBody(req);
        const calc = deliverySum(rows);
        const dropped = (Array.isArray(rows) ? rows.length : 0) - calc.rows.length;
        putDelivery(JSON.stringify(calc.rows));
        addAgentMsg(bd.id, 'assistant', '[交付明细保存] ' + calc.rows.length + ' 行(正编' + calc.sum.own_pd + '+PM' + calc.sum.pm_pd + '+生产' + calc.sum.prod_pd + '人天,差旅' + calc.sum.travel_cost + '元)');
        return send(res, 200, { ok: true, ...calc, dropped });
      }
      if (sub === '/delivery/import' && req.method === 'POST') { // 上传附3 Excel 解析(不入预算字段, 只建可编辑底稿)
        if (!canWrite) return send(res, 403, { error: '仅预算单所有者可上传交付明细' });
        if (bd.status !== 'draft') return send(res, 400, { error: '预算单已锁定,请新建版本后上传明细' });
        const { filename, data } = await parseBody(req);
        if (!filename || !data) return send(res, 400, { error: '缺少文件' });
        const buf = Buffer.from(data, 'base64');
        if (buf.length > 10 * 1024 * 1024) return send(res, 400, { error: '文件不能超过 10MB' });
        const dir = path.join(UPLOAD_DIR, 'delivery');
        fs.mkdirSync(dir, { recursive: true });
        const { safe, fp } = writeUniqueUpload(dir, filename, buf);
        // 异步跑 python(openpyxl): 与 form 导入同因(spawnSync 阻塞事件循环→keep-alive 断连)
        const pr = await runPython(['-X', 'utf8', path.join(ROOT, 'tools', 'parse_delivery_xlsx.py'), fp, '--audit']);
        if (pr.status !== 0) return send(res, 502, { error: 'Excel 解析失败(python/openpyxl 不可用或文件非附3模板):' + String(pr.stderr || '').slice(0, 150) + '。可改用在线编辑手动建行。' });
        let parsed;
        try { parsed = JSON.parse(pr.stdout); } catch (e) { return send(res, 502, { error: '解析输出异常:' + String(pr.stdout).slice(0, 100) }); }
        if (parsed.error) return send(res, 400, { error: parsed.error });
        if (!(parsed.rows || []).length && (parsed.skipped_rows || []).length)
          return send(res, 400, { error: `原表 ${(parsed.skipped_rows || []).length} 行建设内容均无预算数字，未生成明细行。可改用在线编辑手动建行。` });
        if (!(parsed.rows || []).length) return send(res, 400, { error: '未解析到明细行(需为含"建设内容"列的附3 模板)。可改用在线编辑手动建行。' });
        const calc = deliverySum(parsed.rows);
        putDelivery(JSON.stringify(calc.rows), safe);
        const source = saveImportSource(db, { entity_type: useOppStore ? 'delivery_opp' : 'delivery_budget',
          entity_key: useOppStore ? oppCodeB : String(bd.id), file_name: String(filename), file_path: 'delivery/' + safe,
          parsed, imported: calc.rows, user, created_at: now() });
        addAgentMsg(bd.id, 'assistant', `[上传交付明细表] ${safe} -> ${calc.rows.length} 行(正编${calc.sum.own_pd}+PM${calc.sum.pm_pd}+生产${calc.sum.prod_pd}人天,差旅${calc.sum.travel_cost}元)`);
        return send(res, 200, { ok: true, ...calc, source_file: safe, total_row: parsed.total_row,
          audit: { row_sources: parsed.row_sources || [], skipped_rows: parsed.skipped_rows || [], grid: parsed.grid || [], meta: parsed.meta, sheet: parsed.sheet },
          source: sourceMeta(source) });
      }
      if (sub === '/delivery/apply' && req.method === 'POST') { // 递进: 按明细汇总刷新预算交付四科目(人确认门, 不自动覆盖)
        if (!canWrite) return send(res, 403, { error: '仅预算单所有者可刷新交付科目' });
        if (bd.status !== 'draft') return send(res, 400, { error: '预算单已锁定,交付科目不可刷新' });
        const d = getDelivery();
        if (!d || !(JSON.parse(d.rows_json || '[]')).length) return send(res, 400, { error: '请先上传或编制交付明细表' });
        const calc = deliverySum(JSON.parse(d.rows_json || '[]'));
        const merged = mergeDraft({
          dev_pd: calc.sum.own_pd, pm_cost: +((calc.sum.pm_pd) * (calc.rate ?? 0)).toFixed(2),
          rd_outsource: +(calc.sum.rd_pd * (num(getSettings().price_rd_outsource) || 995)).toFixed(2),
          prod_pd: calc.sum.prod_pd, del_travel: calc.sum.travel_cost
        }, bd.fields);
        const newCalc = computeBudget(merged, getSettings());
        db.prepare('UPDATE budgets SET fields=?, calc=?, opp_code=?, updated_at=? WHERE id=?')
          .run(JSON.stringify(merged), JSON.stringify(newCalc), merged.opp_code || bd.opp_code || null, now(), bd.id); // D-10: 写 fields 即投影派生列
        addAgentMsg(bd.id, 'assistant', `[交付科目刷新] dev_pd=${calc.sum.own_pd}, pm_cost=${merged.pm_cost}, rd_outsource=${merged.rd_outsource}, prod_pd=${calc.sum.prod_pd}, del_travel=${merged.del_travel}`);
        return send(res, 200, { ok: true, fields: merged, calc: newCalc });
      }
    }

    // ---------- 技能①预算编制对话(阶段2, 任务2.6) + 技能②③评审表编制/预判(阶段3, 任务 3.3): POST /api/agent/chat ----------
    // 时序(§4.5): auth → load budget(404/403) → 写 user 原文 → LLM(失败降级跳过 merge, HTTP 仍 200)
    //   → mergeDraft 白名单 → budgets.fields 落库 → computeBudget → missing → buildReply → 写 assistant
    if (p === '/api/agent/chat' && req.method === 'POST') {
      const chatBody = await parseBody(req);
      const { budget_id, review_id, message, skill } = chatBody;
      const chk = checkMessage(message);
      if (chk.error) return send(res, 400, { error: chk.error }); // API-17/A-13

      // ---- 机器人工作台 T4 技能: skill='delivery' 交付明细文字抽取 —— 只回草稿, 不写 opp_delivery, 无任何状态动作 ----
      // 必须排在 opp/review 之前: 那两个分支各自 return, 且都默认从 budget_id/review_id 取上下文
      if (skill === 'delivery') {
        if (!ROBOT_WORKBENCH_ROLES.includes(user.role)) return send(res, 403, { error: '仅项目经理/销售经理/销售支持组可使用机器人工作台' });
        const code = String(chatBody.opp_code || '').trim();
        const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
        if (!opp) return send(res, 404, { error: '商机档案不存在' });
        const current = db.prepare('SELECT rows_json,status FROM opp_delivery WHERE opp_code=?').get(code);
        const prior = current ? parseRowsJson(current.rows_json) : [];
        let degraded = false, fields = {};
        try {
          const cfg = llmCfgFor('delivery', DELIVERY_SYSTEM_PROMPT);
          if (!cfg.base || !cfg.key) throw new Error('未配置大模型');
          fields = await extractWithPolicy({ rows: prior }, String(message).trim(), cfg);
        } catch (e) { degraded = true; }
        // 两条路径都过净化: opp_delivery 存行是 deliverySumFor 的产物, 天然带服务端算出的 cost 列,
        // 降级轮若原样回吐 prior 会把这第九键漏给调用方(RW-10/A-DL 的八键不变式与「不信存行 cost」同时破防)
        const rows = cleanDeliveryDraft(degraded ? prior : fields.rows);
        return send(res, 200, {
          reply: degraded ? '大模型暂不可用，本轮未改动交付草稿，请手工补齐。' : `已生成 ${rows.length} 行交付草稿，请检查后点保存；口头确认不生效。`,
          draft: { rows }, missing: rows.length ? [] : ['rows'],
          actions: rows.length ? [{ type: 'save_delivery_draft', label: '保存交付草稿', method: 'PUT', endpoint: `/api/opp/${encodeURIComponent(code)}/delivery` }] : [],
          degraded
        });
      }

      // ---- 技能④(V4.0 P1): skill='opp' 对话式建档 —— 只产档案草稿, 不触评审单/预算/提交门 ----
      if (skill === 'opp') {
        if (!OPP_CREATE_ROLES.includes(user.role)) return send(res, 403, { error: '仅销售/支持组/项目经理/财务BP 可建待评审商机档案' });
        // 客户端草稿同样过白名单: status/opp_code/source 等结构键无法经草稿回灌
        const baseO = mergeDraft(chatBody.draft, {}, { whitelist: OPP_WHITELIST });
        // 人确认门: 建档只认按钮动作(口头「确认」不建档, 不进 LLM); 形态门/缺项/409 由 createOpp 唯一裁判, 本分支不复制门禁
        if (chatBody.action === 'create') {
          const rc = createOpp(user, { ...baseO, opp_code: chatBody.opp_code }, 'agent');
          return send(res, rc.status, rc.status === 200
            ? { ...rc.data, reply: '已建档 ' + rc.data.opp.opp_code + ',下一步选择首个评审类型。', draft: baseO, missing: [], degraded: false }
            : { ...rc.data, draft: baseO });
        }
        let degradedO = false, llmFieldsO = {};
        const t0O = Date.now();
        try {
          const llmCfgO = llmCfgFor('opp', OPP_SYSTEM_PROMPT);
          if (!llmCfgO.base || !llmCfgO.key) throw new Error('未配置大模型');
          llmFieldsO = await extractWithPolicy(baseO, String(message).trim(), llmCfgO);
        } catch (e) { degradedO = true; } // 同技能①②降级语义: 跳过 merge, HTTP 仍 200
        logLlmCall('opp', !degradedO, degradedO, Date.now() - t0O, estTokens(baseO, message), 'opp:' + String(chatBody.opp_code || '').slice(0, 40));
        const mergedO = degradedO ? baseO : mergeDraft(llmFieldsO, baseO, { whitelist: OPP_WHITELIST });
        const changedO = degradedO ? {} : diffFields(baseO, mergedO);
        const missingO = oppMissing(mergedO);
        const actionsO = missingO.length ? [] : [{ type: 'confirm_create', label: '确认建档', method: 'POST', endpoint: '/api/agent/chat' }];
        return send(res, 200, { reply: buildOppReply(changedO, missingO, { degraded: degradedO }), draft: mergedO, missing: missingO, actions: actionsO, degraded: degradedO });
      }

      // ---- 技能②③(任务 3.3): skill='review' 评审表编制 + 预判 ----
      // 意图路由全为确定性代码(铁律: 建单/预判不进 LLM):
      //   ① /用 B-\d{4}-\d{4}/ 建单 → 预算字段映射带入(元→万元) ② /预判|灯/ → dry-run judge 摘要 ③ 其余 → LLM 字段抽取
      if (skill === 'review') {
        const msg = String(message).trim();
        let review = review_id ? getReview(review_id) : null;
        if (review_id && !review) return send(res, 404, { error: '评审单不存在' });
        if (review) {
          if (review.applicant_id !== user.id && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅申请人可对话编制' });
          if (review.status !== 'draft') return send(res, 400, { error: '仅草稿单可通过对话编制(当前状态 ' + review.status + ')' });
        }
        // ① 建单意图: 解析预算单号带入(确定性)
        const mb = msg.match(/用\s*(B-\d{4}-\d{4})/);
        if (mb && !review) {
          const b = db.prepare('SELECT * FROM budgets WHERE code=?').get(mb[1]);
          if (!b) return send(res, 404, { error: '预算单不存在:' + mb[1] });
          if (b.owner_id !== user.id && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅预算单所有者可带入建评审单' });
          const fields = JSON.parse(b.fields || '{}');
          const type = /售前/.test(msg) ? 'presale' : /变更/.test(msg) ? 'change' : 'bid';
          const form = {};
          if (fields.contract != null) form.contract_amount = Math.round(fields.contract / 100) / 100; // 元→万元
          if (fields.sub_cost != null) form.sub_amount = Math.round(fields.sub_cost / 100) / 100;
          if (fields.customer) form.customer = fields.customer;
          if (fields.project_name) form.summary = fields.project_name;
          const t = now();
          const r = db.prepare('INSERT INTO reviews(type,title,applicant_id,applicant_name,status,round,form_json,budget_id,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
            .run(type, (fields.project_name || mb[1]) + '-评审', user.id, user.name, 'draft', 1, JSON.stringify(form), b.id, form.opp_code || fields.opp_code || null, t, t);
          upsertOpp(String(form.opp_code || fields.opp_code || '').trim(), 'agent', form, String((fields.project_name || mb[1]) + '-评审'), user.id);
          review = getReview(r.lastInsertRowid);
          addEvent(review.id, '保存草稿', user.name, '技能②带入预算单 ' + b.code + '(' + TYPE_NAMES[type] + ')');
          addAgentMsgReview(review.id, 'user', msg);
          const missing1 = BID_REQUIRED.filter(k => form[k] === undefined || form[k] === null || form[k] === '');
          const reply1 = `已用 ${b.code} 创建${TYPE_NAMES[type]}草稿(id=${review.id}),带入字段:` + Object.keys(form).join('/') + '\n' + buildBidReply({}, missing1);
          addAgentMsgReview(review.id, 'assistant', reply1);
          return send(res, 200, { reply: reply1, draft: form, missing: missing1, review_id: review.id, degraded: false });
        }
        if (!review) return send(res, 400, { error: '请先发"用 B-xxxx 建评审单"创建评审草稿' });
        // ② 预判意图(技能③, A-17): dry-run judge, 不落库不改 status, 不进 LLM
        if (/预判|灯/.test(msg)) {
          addAgentMsgReview(review.id, 'user', msg);
          const result = judge(review);
          const preview = { light: result.light, route: result.route, items: result.detail };
          const cur = JSON.parse(review.form_json || '{}');
          const reply2 = buildBidReply({}, BID_REQUIRED.filter(k => cur[k] === undefined || cur[k] === null || cur[k] === ''), preview);
          addAgentMsgReview(review.id, 'assistant', reply2);
          return send(res, 200, { reply: reply2, draft: cur, missing: BID_REQUIRED.filter(k => cur[k] === undefined || cur[k] === null || cur[k] === ''), review_id: review.id, preview, degraded: false });
        }
        // ③ LLM 字段抽取(技能②, A-16/A-18): BID 提示词 + 白名单 + 毛利率归一化; 失败降级 HTTP 仍 200
        addAgentMsgReview(review.id, 'user', msg);
        let degradedR = false, llmFieldsR = {};
        const t0R = Date.now();
        try {
          const llmCfgR = llmCfgFor('review', BID_SYSTEM_PROMPT); // T9: profile/降级参数/提示词版本单一入口(每请求重读 config.json)
          if (!llmCfgR.base || !llmCfgR.key) throw new Error('未配置大模型');
          llmFieldsR = await extractWithPolicy(JSON.parse(review.form_json || '{}'), msg, llmCfgR);
        } catch (e) { degradedR = true; } // 同技能①降级语义
        logLlmCall('review', !degradedR, degradedR, Date.now() - t0R, estTokens(review.form_json, msg), 'review:' + review.id);
        const prevR = JSON.parse(review.form_json || '{}');
        const mergedR = degradedR ? prevR : mergeDraft(llmFieldsR, prevR, { whitelist: BID_WHITELIST, normalizePct: true });
        const changedR = degradedR ? {} : diffFields(prevR, mergedR);
        // 审查整改#2: 条件更新防 LLM 等待窗口内单据被锁定/提交后写穿(先检查后写竞态)
        if (!degradedR && Object.keys(changedR).length) {
          const wr = db.prepare("UPDATE reviews SET form_json=?, opp_code=json_extract(form_json, '$.opp_code'), updated_at=? WHERE id=? AND status='draft'").run(JSON.stringify(mergedR), now(), review.id);
          if (wr.changes === 0) {
            const msg409 = '单据状态已变化(可能已提交/锁定),本次对话字段未写入,请刷新后重试。';
            addAgentMsgReview(review.id, 'assistant', msg409);
            return send(res, 409, { error: msg409 });
          }
          upsertOpp(String(mergedR.opp_code || review.opp_code || '').trim(), 'agent', mergedR, review.title, user.id);
        }
        const missingR = BID_REQUIRED.filter(k => mergedR[k] === undefined || mergedR[k] === null || mergedR[k] === '');
        const replyR = degradedR
          ? '大模型暂不可用,请稍后重试或直接在评审表单页填写。\n' + buildBidReply({}, missingR)
          : buildBidReply(changedR, missingR);
        addAgentMsgReview(review.id, 'assistant', replyR);
        return send(res, 200, { reply: replyR, draft: mergedR, missing: missingR, review_id: review.id, degraded: degradedR });
      }

      const bd = getBudget(budget_id);
      if (!bd) return send(res, 404, { error: '预算单不存在' }); // API-18
      if (bd.owner_id !== user.id && user.role !== '销售支持组') return send(res, 403, { error: '仅预算单所有者可对话' }); // A-11/API-19
      addAgentMsg(bd.id, 'user', String(message).trim());
      if (bd.status !== 'draft') { // A-10: locked 后对话提示走 newversion, fields 不变
        const reply = `该预算单已锁定(v${bd.version}),如需修改请新建新版本(newversion);当前字段保持不变。`;
        addAgentMsg(bd.id, 'assistant', reply);
        return send(res, 200, { reply, draft: bd.fields, calc: bd.calc, missing: [], actions: [], degraded: false });
      }
      // LLM 抽取: 凭据每请求读 config.json(桩测试改写 LLM_BASE_URL 即时生效, 无需重启)
      let degraded = false, llmFields = {};
      const t0 = Date.now();
      try {
        const llmCfg = llmCfgFor('budget'); // T9: profile/降级参数/提示词版本单一入口; prompt 缺省由 agent.js 回落 SYSTEM_PROMPT
        if (!llmCfg.base || !llmCfg.key) throw new Error('未配置大模型');
        llmFields = await extractWithPolicy(bd.fields, message, llmCfg);
      } catch (e) { degraded = true; } // A-08: 失败不重试直接降级
      logLlmCall('budget', !degraded, degraded, Date.now() - t0, estTokens(bd.fields, message), 'budget:' + bd.id);
      const merged = degraded ? bd.fields : mergeDraft(llmFields, bd.fields); // 降级跳过 merge, fields 不变
      const changed = degraded ? {} : diffFields(bd.fields, merged);
      const calc = computeBudget(merged, getSettings());
      const missing = missingOf(merged);
      // 审查整改#2: 条件更新防 LLM 等待窗口内预算单被锁定后写穿(先检查后写竞态)
      // D-10: 同批把 fields.opp_code 投影到派生列(对话口述商机号即刻生效, 不等启动期回填)
      // D-15: merged.opp_code 可能为空(D-9 允许只送顶层 body.opp_code 建单, fields 里没有该键), 必须用本单既有派生列兜底, 否则对话一次就把挂靠洗成 null(链路当场消失)
      const wres = db.prepare("UPDATE budgets SET fields=?, calc=?, opp_code=?, updated_at=? WHERE id=? AND status='draft'")
        .run(JSON.stringify(merged), JSON.stringify(calc), String(merged.opp_code || bd.opp_code || '').trim() || null, now(), bd.id);
      if (wres.changes === 0) {
        const msg409 = '预算单状态已变化(可能已锁定),本次对话字段未写入,请刷新后重试。';
        addAgentMsg(bd.id, 'assistant', msg409);
        return send(res, 409, { error: msg409, reply: msg409, draft: bd.fields, calc: bd.calc, missing: [], actions: [], degraded });
      }
      const { reply, actions } = buildReply(changed, calc, missing, { degraded, status: bd.status, version: bd.version, budgetId: bd.id });
      addAgentMsg(bd.id, 'assistant', reply);
      return send(res, 200, { reply, draft: merged, calc, missing, actions, degraded });
    }

    // ---------- 机器人工作台 T4: 统一只读聚合 GET /api/robot/workbench ----------
    // 只读聚合, 不写任何表、不复制预算/评审/交付写接口; 行成本用 deliverySumFor 服务端实算, 不信 opp_delivery 存行的 cost 列
    // 不回 config/secret/token/文件正文: 只回业务列白名单 + 服务端算出的价与合计
    if (p === '/api/robot/workbench' && req.method === 'GET') {
      if (!ROBOT_WORKBENCH_ROLES.includes(user.role)) return send(res, 403, { error: '仅项目经理/销售经理/销售支持组可使用机器人工作台' });
      const code = String(url.searchParams.get('opp_code') || '').trim();
      const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
      if (!opp) return send(res, 404, { error: '商机档案不存在' });
      const reviews = db.prepare('SELECT id,type,title,status,round,light,era,updated_at FROM reviews WHERE opp_code=? ORDER BY updated_at DESC').all(code);
      const budgets = db.prepare('SELECT id,code,version,status,project_name,updated_at FROM budgets WHERE opp_code=? ORDER BY updated_at DESC').all(code);
      const od = db.prepare('SELECT status,rows_json,source_file,updated_at FROM opp_delivery WHERE opp_code=?').get(code);
      const rp = oppRateOf(code);
      const odCalc = od ? deliverySumFor(parseRowsJson(od.rows_json), rp.dev_dept) : null;
      const S = getSettings();
      const delivery = od ? {
        status: od.status, rows: odCalc.rows, sum: odCalc.sum, rate: odCalc.rate,
        rd_price: odCalc.rd_price, prod_price: odCalc.prod_price,
        rate_source: rp.source, source_file: od.source_file, updated_at: od.updated_at
      } : {
        status: 'none', rows: [], sum: null, rate: rateFor(rp.dev_dept, S),
        rd_price: num(S.price_rd_outsource) || 995, prod_price: num(S.price_prod_outsource) || 320,
        rate_source: rp.source, updated_at: null
      };
      // capabilities 只描述当前用户在这条商机上能做什么, 不授予新权限; 编制口径与 /api/opp/:code/delivery 的 canWriteOpp
      // 及 360 卡 delivery.can_write 同源四项(D-25: 改口径须同批改, C2-10 用行为对账钉住)
      const capabilities = {
        can_edit_delivery: opp.created_by === user.id || user.role === '项目经理' || user.role === '销售支持组' || user.role === 'admin',
        can_invite_review: ROBOT_INVITE_ROLES.includes(user.role),
        provider_send: false
      };
      return send(res, 200, { opp, delivery, budgets, reviews, capabilities,
        provider: { name: 'dingtalk', active: false, mode: 'preview', message: '生成待发送草稿（本地预演）' } });
    }

    // ---------- 机器人工作台 T4: 主动邀请 POST /api/robot/invite-review(裁判全在 inviteReview) ----------
    if (p === '/api/robot/invite-review' && req.method === 'POST') {
      const inviteBody = await parseBody(req);
      const r = inviteReview(user, inviteBody);
      return send(res, r.status, r.data);
    }

    // 新建评审单
    if (p === '/api/reviews' && req.method === 'POST') {
      const body = await parseBody(req);
      const { type, title, form, submit, budget_id } = body;
      if (!INDICATORS[type]) return send(res, 400, { error: '评审类型无效' });
      if (!title || !String(title).trim()) return send(res, 400, { error: '请填写项目名称' });
      if (submit) return send(res, 400, { error: '新单据请先保存草稿,上传必传附件《项目贡献毛利率及成本预算表》后再提交评审' });
      const t = now();
      const r = db.prepare('INSERT INTO reviews(type,title,applicant_id,applicant_name,status,round,form_json,budget_id,opp_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(type, String(title).trim(), user.id, user.name, submit ? 'reviewing' : 'draft', 1, JSON.stringify(form || {}), budget_id || null, (form || {}).opp_code || null, t, t);
      upsertOpp(String((form || {}).opp_code || '').trim(), 'form', form, title, user.id);
      const review = getReview(r.lastInsertRowid);
      addEvent(review.id, submit ? '提交评审' : '保存草稿', user.name, TYPE_NAMES[type]);
      if (submit) {
        createTasks(review, 1);
        addEvent(review.id, '前置评审启动', '系统', `已分发 ${INDICATORS[type].length} 项指标至各部门`);
      }
      return send(res, 200, { id: review.id });
    }

    // V4.0 §3/§5: 必填注册表单源暴露(前端渲染缓存与门禁口径的对照面; 登录即可读, 与 /api/opp/:code/360 同口径)
    if (p === '/api/meta/fields' && req.method === 'GET') {
      return send(res, 200, {
        opp: REQUIRED.opp, budget: REQUIRED.budget,
        presale: REQUIRED.review.presale, bid: REQUIRED.review.bid, change: REQUIRED.review.change,
        indEvidence: Object.fromEntries(Object.keys(INDICATORS).map(t => [t, INDICATORS[t].map(i => {
          const e = indEvidence(t, i.key, i.dept);
          return { key: i.key, name: i.name, dept: i.dept, cls: e.cls, formKeys: e.formKeys, anchors: e.anchors, external: e.external, aItems: e.aItems, hint: e.hint, registered: e.registered };
        })])),
        fixtureCodePattern: FIXTURE_CODE_RE.source
      });
    }

    // ---------- 归档库 BI 聚合(docs/归档库BI开发设计.md, 聚合范围严格限 status='archived') ----------
    if (p === '/api/reviews/archive-stats' && req.method === 'GET') {
      // H5(历史数据承接): era 维度——light 四档(none=历史未评), kpi 双口径(在线绿灯率/历史通过率)
      const rows = db.prepare("SELECT id,type,light,route,round,decision_result,archived_at,judge_detail,form_json,era FROM reviews WHERE status='archived'").all();
      const total = rows.length;
      const online = rows.filter(r => !r.era || r.era === 'online');
      const history = rows.filter(r => r.era === 'history');
      const light = { green: 0, yellow: 0, red: 0, none: 0 };
      const types = { presale: 0, bid: 0, change: 0 };
      const monthly = {};
      const riskCount = {};
      const amtBuckets = [0, 0, 0, 0]; // [0,50) / [50,100) / [100,500) / [500,∞) 万
      let amtSum = 0, amtValid = 0, decisionN = 0, roundSum = 0;
      const routes = { xo: 0, dept: 0, green: 0 };
      for (const r of rows) {
        if (light[r.light] != null || r.light === 'none') light[r.light] = (light[r.light] || 0) + 1;
        if (types[r.type] != null) types[r.type]++;
        roundSum += r.round || 1;
        if (r.decision_result) decisionN++;
        if (r.archived_at) { const m = String(r.archived_at).slice(0, 7); monthly[m] = (monthly[m] || 0) + 1; }
        // 风险项: judge_detail 非 green 项聚合计数(历史单 judge_detail 是导入元数据对象非数组, 跳过)
        if (r.judge_detail && r.era !== 'history') {
          try { for (const it of JSON.parse(r.judge_detail)) if (it.level !== 'green') riskCount[it.name] = (riskCount[it.name] || 0) + 1; } catch (e) {}
        }
        // 金额: form_json.contract_amount(万), 半开区间四档(历史单字段齐则参与)
        if (r.form_json) {
          try {
            const a = parseFloat(JSON.parse(r.form_json).contract_amount);
            if (!isNaN(a)) { amtValid++; amtSum += a; amtBuckets[a < 50 ? 0 : a < 100 ? 1 : a < 500 ? 2 : 3]++; }
          } catch (e) {}
        }
        // 路由: XO > 免上会 > 部门级, 红灯打回不入三段(历史单无 route 不入)
        const rt = r.route || '';
        if (rt.includes('XO')) routes.xo++;
        else if (rt.includes('免上会')) routes.green++;
        else if (rt.includes('部门级')) routes.dept++;
      }
      // 月度: 近 12 个月升序、缺月补零(历史单业务时间自动落位年份段)
      const monthlyArr = [];
      const nowM = new Date();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(nowM.getFullYear(), nowM.getMonth() - i, 1);
        const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (monthly[m] || i < 2) monthlyArr.push({ m, c: monthly[m] || 0 }); // 近 3 月必有位, 其余仅有值月显示
      }
      // 年度分布(历史单落位 2024/2025 段)
      const yearly = {};
      for (const r of rows) { if (r.archived_at) { const y = String(r.archived_at).slice(0, 4); yearly[y] = (yearly[y] || 0) + 1; } }
      const years = Object.entries(yearly).map(([y, c]) => ({ y, c })).sort((a, b) => a.y.localeCompare(b.y));
      const risks = Object.entries(riskCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 10);
      // 部门: SQL 聚合(全轮次含 cancelled, 只计在线单——历史单无 tasks), 按黄红占比降序
      const depts = db.prepare("SELECT t.dept, COUNT(1) total, SUM(CASE WHEN t.light='yellow' THEN 1 ELSE 0 END) yellow, SUM(CASE WHEN t.light='red' THEN 1 ELSE 0 END) red FROM tasks t JOIN reviews r ON r.id=t.review_id WHERE r.status='archived' GROUP BY t.dept")
        .all().map(d => ({ dept: d.dept, total: d.total, yellow: d.yellow || 0, red: d.red || 0 }))
        .sort((a, b) => ((b.yellow + b.red) / b.total) - ((a.yellow + a.red) / a.total));
      const pct = v => +(v / (total || 1) * 100).toFixed(1);
      const onlineGreenRate = +(light.green / (online.length || 1) * 100).toFixed(1);
      const historyPassN = history.filter(r => /通过|同意/.test(r.decision_result || '') && !/不通过|否决/.test(r.decision_result || '')).length;
      return send(res, 200, {
        kpi: { total, online: online.length, historyTotal: history.length, greenRate: onlineGreenRate, historyPassRate: +(historyPassN / (history.length || 1) * 100).toFixed(1), avgRound: +(roundSum / (total || 1)).toFixed(2), decisionRate: pct(decisionN) },
        light, types, monthly: monthlyArr, years, risks, depts,
        amounts: [
          { range: '<50万', count: amtBuckets[0] }, { range: '50~100万', count: amtBuckets[1] },
          { range: '100~500万', count: amtBuckets[2] }, { range: '≥500万', count: amtBuckets[3] }
        ],
        totalAmountWan: +amtSum.toFixed(1), amountValid: amtValid,
        routes
      });
    }

    // 列表: 我的 / 全部(支持组) / 归档(H3: 历史单只在归档展现; O4: type/q 商机代码筛选)
    if (p === '/api/reviews' && req.method === 'GET') {
      const scope = url.searchParams.get('scope') || 'mine';
      const fType = url.searchParams.get('type') || '';
      const q = String(url.searchParams.get('q') || '').trim();
      // 动态 WHERE 拼接(参数均经绑定, q 用 LIKE 通配拼接前转义 %/_)
      const conds = [];
      const args = [];
      if (scope === 'all') {
        conds.push("(era IS NULL OR era='online')");
      } else if (scope === 'archived') {
        conds.push('status=?'); args.push('archived');
      } else {
        conds.push('applicant_id=?'); args.push(user.id);
        conds.push("(era IS NULL OR era='online')");
      }
      if (fType) { conds.push('type=?'); args.push(fType); }
      if (q) { conds.push("(opp_code LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\')"); const esc = q.replace(/[%_\\]/g, m => '\\' + m); args.push('%' + esc + '%', '%' + esc + '%'); }
      const order = scope === 'archived' ? 'archived_at DESC' : 'updated_at DESC';
      const rows = db.prepare('SELECT * FROM reviews WHERE ' + conds.join(' AND ') + ' ORDER BY ' + order).all(...args);
      return send(res, 200, { reviews: rows });
    }

    // 商机 360°聚合(spec 2026-10-14 §3 + V4.0 §2.3): 登录即可读(与 scope=all 全员只读同口径), 写操作仍由各端点自鉴权
    const mOpp = p.match(/^\/api\/opp\/([^/?]+)\/360$/);
    if (mOpp && req.method === 'GET') {
      const code = decodeURIComponent(mOpp[1]);
      const reviews = db.prepare(`SELECT r.id,r.type,r.title,r.status,r.round,r.light,r.era,r.decision_result,r.archived_at,r.updated_at,r.budget_id,r.applicant_name,b.code AS budget_code FROM reviews r LEFT JOIN budgets b ON b.id=r.budget_id WHERE r.opp_code=? ORDER BY r.updated_at DESC, r.id DESC`).all(code);
      const budgets = db.prepare('SELECT id,code,version,status,project_name,updated_at FROM budgets WHERE opp_code=? ORDER BY updated_at DESC').all(code);
      const oppRow = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
      if (!reviews.length && !budgets.length && !oppRow) return send(res, 404, { error: '商机不存在' }); // V4.0: 建档即可进 360°, 三全无才 404
      const tasks = db.prepare('SELECT t.*, r.title, r.type, r.opp_code FROM tasks t JOIN reviews r ON r.id=t.review_id WHERE r.opp_code=? ORDER BY t.round DESC, t.id').all(code);
      const lights = { red: 0, yellow: 0, green: 0, none: 0 };
      for (const r of reviews) lights[r.light || 'none'] = (lights[r.light || 'none'] || 0) + 1;
      // V4.0 §2.3 追加①: 交付预算摘要(计价基准只算一次, total_cost 由 deliverySumFor 实算, FE 零重算)
      const od = db.prepare('SELECT status,rows_json,updated_at FROM opp_delivery WHERE opp_code=?').get(code);
      const odRows = od ? JSON.parse(od.rows_json || '[]') : [];
      const rp = oppRateOf(code); // D-5/D-17: 最新预算 dev_dept → 最新评审 form_json.dev_dept → none
      const odCalc = od ? deliverySumFor(odRows, rp.dev_dept) : null;
      const delivery = {
        status: od ? od.status : 'none',
        rows: od ? odCalc.rows.length : 0,
        total_cost: odCalc ? odCalc.sum.cost : 0,
        dev_dept: rp.dev_dept || null, rate: od ? odCalc.rate : rateFor(rp.dev_dept, getSettings()), rate_source: rp.source,
        updated_at: od ? od.updated_at : null
      };
      // D-19: 360 保持登录可读(链路引导起点), 但交付预算卡给不给编辑入口由服务端告知, FE 不得自行拼角色判断
      // D-25: 下面四项是 server.js 商机级 delivery 路由内 `canWriteOpp` 的**逐字同源副本**(禁止增删角色)。
      //       本任务不提取成公共函数——那要动 PUT/import/GET/confirm 四处共用点，属越界重构；改口径必须两处同改，C2-10 用行为对账把漂移变成红灯。
      delivery.can_write = !!oppRow && (oppRow.created_by === user.id || user.role === '项目经理' || user.role === '销售支持组' || user.role === 'admin');
      // V4.0 §2.3 追加②: 三步链状态与 next_action(链序: ① 交付预算确认 → ② 项目预算锁定 → ③ 评审单提交)
      // D-25: 链态计数只认**在线单**(与 T3-G4 的 `era IS NULL OR era='online'` 同口径); 历史单仍完整保留在 reviews 列表与 lights 聚合中, 两侧口径不同属既定设计, C2-11 钉住。
      const onlineReviews = reviews.filter(r => !r.era || r.era === 'online');
      const budgetLocked = budgets.some(b => b.status === 'locked');
      const reviewsSubmitted = onlineReviews.filter(r => r.status !== 'draft').length;
      let next_action = 'confirm_delivery';
      if (delivery.status === 'confirmed') {
        if (!budgetLocked) next_action = 'lock_budget';
        else if (reviewsSubmitted === 0) next_action = 'submit_review';
        else if (onlineReviews.some(r => r.status === 'reviewing')) next_action = 'reviewing';
        else if (onlineReviews.some(r => r.status === 'returned')) next_action = 'returned';
        else next_action = 'judged';
      }
      const chain = { delivery_confirmed: delivery.status === 'confirmed', budget_locked: budgetLocked,
        reviews_total: onlineReviews.length, reviews_submitted: reviewsSubmitted, next_action };
      const opp = oppRow ? Object.assign({}, oppRow, { code: oppRow.opp_code })
        : { code, opp_code: code, title: (reviews[0] || {}).title || (budgets[0] || {}).project_name || '', status: 'pending' };
      // 与 /submit 的三步门同源；change 不强制预算关联，不能谎称被①②阻塞。
      const launch = {};
      for (const t of ['presale', 'bid', 'change']) {
        const gaps = [];
        if (delivery.status !== 'confirmed') gaps.push({ key: 'delivery', label: '① 交付预算未确认', href: `#/opp/${encodeURIComponent(code)}`, anchor: 'delivery' });
        if (!budgetLocked) gaps.push({ key: 'budget', label: '② 项目预算未锁定', href: `#/opp/${encodeURIComponent(code)}`, anchor: 'budget' });
        launch[t] = BUDGET_REQUIRED_TYPES.includes(t) ? { state: gaps.length ? 'blocked' : 'ready', gaps }
          : { state: gaps.length ? 'na' : 'ready', gaps, note: '变更决策不强制①②; 关联锁定预算单时需该商机交付预算已确认' };
      }
      const profile_can_edit = !!oppRow && (oppRow.created_by === user.id || user.role === '销售支持组' || user.role === 'admin');
      const prefix = '[' + code + '] ';
      const profile_events = db.prepare("SELECT action,actor,detail,created_at FROM events WHERE review_id IS NULL AND action='档案人工修正' AND substr(detail,1,?)=? ORDER BY id DESC LIMIT 50").all(prefix.length, prefix);
      return send(res, 200, { opp, reviews, budgets, tasks: annotateTasks(tasks), lights, delivery, chain, launch,
        profile: resolveOppProfile(code), profile_can_edit, profile_events });
    }

    // ---------- spec 2026-10-19: 建单预填(只读, 登录门内; type 必填) ----------
    const mPf = p.match(/^\/api\/opp\/([^/?]+)\/prefill$/);
    if (mPf && req.method === 'GET') {
      const type = new URL(req.url, 'http://x').searchParams.get('type') || '';
      if (!REQUIRED.review[type]) return send(res, 400, { error: 'type 必须是 bid/presale/change' });
      const code = decodeURIComponent(mPf[1]);
      const hasOpp = !!db.prepare('SELECT 1 FROM opps WHERE opp_code=?').get(code);
      const hasRev = !!db.prepare('SELECT 1 FROM reviews WHERE opp_code=?').get(code);
      const hasBud = !!db.prepare('SELECT 1 FROM budgets WHERE opp_code=?').get(code);
      if (!hasOpp && !hasRev && !hasBud) return send(res, 404, { error: '商机不存在' });
      return send(res, 200, resolvePrefill(code, type));
    }

    // ---------- V4.0 T2 待评审商机档案 CRUD(spec §3, 全部参数绑定, 登录门内) ----------
    const mOppOne = p.match(/^\/api\/opp\/([^/?]+)$/);
    if (mOppOne && req.method === 'GET') {
      const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(decodeURIComponent(mOppOne[1]));
      if (!opp) return send(res, 404, { error: '商机档案不存在' });
      return send(res, 200, { opp });
    }
    if (mOppOne && req.method === 'PUT') {
      const code = decodeURIComponent(mOppOne[1]);
      const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
      if (!opp) return send(res, 404, { error: '商机档案不存在' });
      if (opp.created_by !== user.id && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅建档人可编辑商机要素' });
      const body = await parseBody(req);
      const cols = [], args = [], changes = [];
      for (const k of OPP_FIELDS) {
        if (body[k] === undefined) continue;
        const next = k === 'contract_amount' ? num(body[k]) : String(body[k] ?? '');
        cols.push(k + '=?'); args.push(next);
        if (String(opp[k] ?? '') !== String(next ?? '')) changes.push([k, opp[k], next]);
      }
      if (!cols.length) return send(res, 400, { error: '没有可更新的要素字段' });
      cols.push('updated_at=?'); args.push(now(), code);
      db.prepare('UPDATE opps SET ' + cols.join(',') + ' WHERE opp_code=?').run(...args);
      const labels = { title: '商机名称', sales: '销售', pm: '项目经理', opp_stage: '商机阶段', province: '省份', sign_date: '预计签单时间', survey: '是否测绘' };
      for (const [k, prev, next] of changes) {
        const f = Object.values(REQUIRED.review).flat().find(f => f.k === k);
        addEvent(null, '档案人工修正', user.name, '[' + code + '] 字段 ' + (f ? f.l : labels[k] || k) + ' 由 ' + (prev == null || prev === '' ? '(空)' : prev) + ' 改为 ' + (next == null || next === '' ? '(空)' : next));
      }
      return send(res, 200, { opp: db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code) });
    }
    if (p === '/api/opp' && req.method === 'POST') {
      if (!OPP_CREATE_ROLES.includes(user.role)) return send(res, 403, { error: '仅销售/支持组/项目经理/财务BP 可建待评审商机档案' });
      const body = await parseBody(req);
      const r = createOpp(user, body, 'form');
      return send(res, r.status, r.data);
    }

    // ---------- V4.0 T2 商机级交付预算(spec §1.2 升格 + §2.2 G1 确认门) ----------
    const mOppDl = p.match(/^\/api\/opp\/([^/?]+)\/delivery(\/[\w-]+)?$/);
    if (mOppDl) {
      const code = decodeURIComponent(mOppDl[1]);
      const sub = mOppDl[2];
      const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(code);
      if (!opp) return send(res, 404, { error: '商机档案不存在' });
      const rp = oppRateOf(code);
      const sum = rows => { const c = deliverySumFor(rows, rp.dev_dept); return { ...c, rate_source: rp.source }; };
      const canWriteOpp = opp.created_by === user.id || user.role === '项目经理' || user.role === '销售支持组' || user.role === 'admin';
      const getDl = () => db.prepare('SELECT * FROM opp_delivery WHERE opp_code=?').get(code);
      if (sub === '/source' && req.method === 'GET') {
        if (!canWriteOpp) return send(res, 403, { error: '仅商机建档人/项目经理/销售支持组可查看交付预算来源' });
        const source = latestImportSource(db, 'delivery_opp', code);
        if (!source) return send(res, 200, { source: null, sheet: null, comparison: null });
        let audit = {}, imported = [];
        try { audit = JSON.parse(source.audit_json || '{}'); } catch (e) {}
        try { imported = JSON.parse(source.imported_json || '[]'); } catch (e) {}
        const d = getDl();
        const current = d ? sum(JSON.parse(d.rows_json || '[]')).rows : [];
        return send(res, 200, { source: sourceMeta(source), sheet: audit.sheet || null,
          comparison: deliveryComparison(audit, Array.isArray(imported) ? imported : [], current) });
      }
      if (!sub && req.method === 'GET') { // V4.0 D-19: 明细含行成本与单价, 读取收紧到 canWriteOpp 四项(对齐预算级 canRead 的审查整改#7 口径)
        if (!canWriteOpp) return send(res, 403, { error: '仅商机建档人/项目经理/销售支持组可查看交付预算明细' });
        const d = getDl();
        const importSource = latestImportSource(db, 'delivery_opp', code);
        if (!d) return send(res, 200, { delivery: null, rate: rateFor(rp.dev_dept, getSettings()), rd_price: num(getSettings().price_rd_outsource) || 995, prod_price: num(getSettings().price_prod_outsource) || 320, rate_source: rp.source });
        const c = sum(JSON.parse(d.rows_json || '[]'));
        return send(res, 200, { delivery: { status: d.status, rows: c.rows, sum: c.sum, source_file: d.source_file, created_at: d.created_at, updated_at: d.updated_at, import_source: sourceMeta(importSource) }, rate: c.rate, rd_price: c.rd_price, prod_price: c.prod_price, rate_source: rp.source });
      }
      if (!sub && req.method === 'PUT') { // 在线编制: 修订即回 draft(G1 重确认纪律)
        if (!canWriteOpp) return send(res, 403, { error: '仅建档人/项目经理/支持组可编制交付预算' });
        const { rows } = await parseBody(req);
        const c = sum(rows);
        const dropped = (Array.isArray(rows) ? rows.length : 0) - c.rows.length;
        const t = now();
        const ex = getDl();
        db.prepare('INSERT OR REPLACE INTO opp_delivery(opp_code,status,rows_json,source_file,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(code, 'draft', JSON.stringify(c.rows), ex ? ex.source_file : null, user.id, ex ? ex.created_at : t, t);
        return send(res, 200, { ok: true, status: 'draft', ...c, dropped });
      }
      if (sub === '/import' && req.method === 'POST') { // 附3 Excel(复用现 python 解析器与 row_sources, 异步跑避免 keep-alive 断连)
        if (!canWriteOpp) return send(res, 403, { error: '仅建档人/项目经理/支持组可上传交付预算' });
        const { filename, data } = await parseBody(req);
        if (!filename || !data) return send(res, 400, { error: '缺少文件' });
        const buf = Buffer.from(data, 'base64');
        if (buf.length > 10 * 1024 * 1024) return send(res, 400, { error: '文件不能超过 10MB' });
        const dir = path.join(UPLOAD_DIR, 'delivery');
        fs.mkdirSync(dir, { recursive: true });
        const { safe, fp } = writeUniqueUpload(dir, filename, buf);
        const pr = await runPython(['-X', 'utf8', path.join(ROOT, 'tools', 'parse_delivery_xlsx.py'), fp, '--audit']);
        if (pr.status !== 0) return send(res, 502, { error: 'Excel 解析失败(python/openpyxl 不可用或文件非附3模板):' + String(pr.stderr || '').slice(0, 150) + '。可改用在线编辑手动建行。' });
        let parsed;
        try { parsed = JSON.parse(pr.stdout); } catch (e) { return send(res, 502, { error: '解析输出异常:' + String(pr.stdout).slice(0, 100) }); }
        if (parsed.error) return send(res, 400, { error: parsed.error });
        if (!(parsed.rows || []).length && (parsed.skipped_rows || []).length)
          return send(res, 400, { error: `原表 ${(parsed.skipped_rows || []).length} 行建设内容均无预算数字，未生成明细行。可改用在线编辑手动建行。` });
        if (!(parsed.rows || []).length) return send(res, 400, { error: '未解析到明细行(需为含"建设内容"列的附3 模板)。可改用在线编辑手动建行。' });
        const c = sum(parsed.rows);
        const t = now();
        const ex = getDl();
        db.prepare('INSERT OR REPLACE INTO opp_delivery(opp_code,status,rows_json,source_file,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
          .run(code, 'draft', JSON.stringify(c.rows), safe, user.id, ex ? ex.created_at : t, t);
        const source = saveImportSource(db, { entity_type: 'delivery_opp', entity_key: code,
          file_name: String(filename), file_path: 'delivery/' + safe, parsed, imported: c.rows, user, created_at: t });
        return send(res, 200, { ok: true, status: 'draft', ...c, source_file: safe, total_row: parsed.total_row,
          audit: { row_sources: parsed.row_sources || [], skipped_rows: parsed.skipped_rows || [], grid: parsed.grid || [], meta: parsed.meta, sheet: parsed.sheet },
          source: sourceMeta(source) });
      }
      if (sub === '/confirm' && req.method === 'POST') { // G1: 空行集不得确认
        if (!canWriteOpp) return send(res, 403, { error: '仅建档人/项目经理/支持组可确认交付预算' });
        const d = getDl();
        if (!d || !(cleanDeliveryRows(JSON.parse(d.rows_json || '[]'))).length) return send(res, 400, { error: '交付预算无明细行，不能确认(请先在线编制或上传附3)' });
        db.prepare("UPDATE opp_delivery SET status='confirmed', updated_at=? WHERE opp_code=?").run(now(), code);
        return send(res, 200, { ok: true, status: 'confirmed', rows: cleanDeliveryRows(JSON.parse(d.rows_json || '[]')).length });
      }
    }

    const mReview = p.match(/^\/api\/reviews\/(\d+)(\/[\w-]+)?$/);
    if (mReview) {
      const review = getReview(mReview[1]);
      if (!review) return send(res, 404, { error: '单据不存在' });
      const sub = mReview[2];

      if (sub === '/source' && req.method === 'GET') {
        const source = latestImportSource(db, 'review', review.id);
        if (!source) return send(res, 200, { source: null, sheet: null, comparison: null });
        let audit = {}, imported = {}, current = {};
        try { audit = JSON.parse(source.audit_json || '{}'); } catch (e) {}
        try { imported = JSON.parse(source.imported_json || '{}'); } catch (e) {}
        try { current = JSON.parse(review.form_json || '{}'); } catch (e) {}
        return send(res, 200, { source: sourceMeta(source), sheet: audit.sheet || null,
          comparison: formComparison(audit, imported, current, FIELD_LABELS, BID_WHITELIST) });
      }

      if (!sub && req.method === 'GET') {
        const tasks = db.prepare('SELECT * FROM tasks WHERE review_id=? ORDER BY round DESC, id').all(review.id);
        const events = db.prepare('SELECT * FROM events WHERE review_id=? ORDER BY id').all(review.id);
        const atts = db.prepare('SELECT id,field,filename,filepath,uploaded_at FROM attachments WHERE review_id=?').all(review.id);
        const siblings = review.opp_code ? db.prepare('SELECT id,type,title,status,updated_at FROM reviews WHERE opp_code=? AND id!=? ORDER BY updated_at DESC, id DESC').all(review.opp_code, review.id) : [];
        return send(res, 200, { review: { ...review, import_source: sourceMeta(latestImportSource(db, 'review', review.id)) }, tasks: annotateTasks(tasks), events, attachments: atts, budget: review.budget_json ? JSON.parse(review.budget_json) : null, siblings,
          coverage: review.judge_detail ? judgeCoverage(review) : null });
      }

      if (sub === '/budget') {
        if (req.method === 'GET') {
          return send(res, 200, { budget: review.budget_json ? JSON.parse(review.budget_json) : null });
        }
        if (req.method === 'PUT') {
          if (review.applicant_id !== user.id && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅申请人可填写预算表' });
          // 任务2.8(六步法⑤⑥): 服务端实算——收 inputs(白名单过滤), contract 缺省从评审表单 contract_amount 注入(万元→元)
          const body = await parseBody(req);
          const inputs = mergeDraft(body.inputs || (body.budget || {}).inputs || {}, {});
          if (inputs.contract == null) {
            const ca = num(JSON.parse(review.form_json || '{}').contract_amount);
            if (ca != null) inputs.contract = ca * 10000;
          }
          const calc = computeBudget(inputs, getSettings());
          const budget = { inputs, computed: calc }; // judge 读 computed.margin 路径不变
          db.prepare('UPDATE reviews SET budget_json=?, updated_at=? WHERE id=?').run(JSON.stringify(budget), now(), review.id);
          addEvent(review.id, '填写预算表', user.name, '在线预算表已保存(服务端实算)');
          return send(res, 200, { ok: true, calc });
        }
      }

      if (!sub && req.method === 'PUT') { // 编辑(草稿/退回/红灯打回)
        if (review.applicant_id !== user.id) return send(res, 403, { error: '仅申请人可编辑' });
        if (!['draft', 'returned', 'judged'].includes(review.status)) return send(res, 400, { error: '当前状态不可编辑' });
        if (review.status === 'judged' && review.light !== 'red') return send(res, 400, { error: '仅红灯打回可修改' });
        const body = await parseBody(req);
        const hasForm = Object.prototype.hasOwnProperty.call(body, 'form');
        const hasBudget = Object.prototype.hasOwnProperty.call(body, 'budget_id');
        if (hasBudget) {
          const err = linkBudgetErr(review, body.budget_id);
          if (err) return send(res, 400, { error: err });
        }
        const nextTitle = body.title || review.title;
        const nextForm = hasForm ? JSON.stringify(body.form || {}) : review.form_json;
        const nextOpp = hasForm ? String((body.form || {}).opp_code || '').trim() || null : review.opp_code;
        const nextBudget = hasBudget ? body.budget_id : review.budget_id;
        db.prepare('UPDATE reviews SET title=?, form_json=?, budget_id=?, opp_code=?, updated_at=? WHERE id=?')
          .run(nextTitle, nextForm, nextBudget, nextOpp, now(), review.id);
        addEvent(review.id, hasBudget ? '关联预算单' : '修改材料', user.name,
          hasBudget ? '预算单 #' + body.budget_id : '');
        return send(res, 200, { ok: true, budget_id: nextBudget });
      }

      if (sub === '/submit' && req.method === 'POST') {
        if (review.applicant_id !== user.id) return send(res, 403, { error: '仅申请人可提交' });
        if (!['draft', 'returned', 'judged'].includes(review.status)) return send(res, 400, { error: '当前状态不可提交' });
        if (review.status === 'judged' && review.light !== 'red') return send(res, 400, { error: '仅红灯打回可重新提交' });
        const budget = db.prepare("SELECT COUNT(*) c FROM attachments WHERE review_id=? AND field='项目预算表'").get(review.id).c
          + (review.budget_json ? 1 : 0) + (review.budget_id ? 1 : 0); // 阶段3: 关联锁定预算单亦视为预算已提供(任务 3.1 门禁前置)
        if (budget === 0) return send(res, 400, { error: '请先上传或在线填写《项目贡献毛利率及成本预算表》再提交' });
        if (review.budget_id) { // 阶段2 最小校验(API-20/S-05): 带 budget_id 必须锁定
          const bb = db.prepare('SELECT status FROM budgets WHERE id=?').get(review.budget_id);
          if (!bb || bb.status !== 'locked') return send(res, 400, { error: '必须关联已锁定的预算单' });
        }
        // 任务 3.1: bid 类型提交必填锁定预算单(售前/变更兼容可选关联, BUDGET_REQUIRED_TYPES 一行可调)
        if (BUDGET_REQUIRED_TYPES.includes(review.type) && !review.budget_id)
          return send(res, 400, { error: '投标决策评审单必须关联已锁定的预算单(先在智能体完成预算编制并锁定)' });
        // V4.0-G3 三步链二次核验(spec §2.2): 防历史/漂移数据绕过——关联预算已锁 ∧ 该商机交付预算仍 confirmed(change 仅在关联预算时核验, 未关联不受影响)
        // 口径更正(见 task-3-report §缺陷1): 核验对象必须与 G2 同源=「本预算单自己的挂靠商机」(budgets.opp_code), 不能兜底取 review.opp_code。
        // 否则「预算单走 D-6 无挂靠分支锁定成功, 但评审 form 里提了个商机码」的现网合法流程会在提交时被拦(实测连带打红 DA/R/B/AV/SN/h3/h_ui 七套),
        // 且该商机与自己无关的交付预算状态会形成跨数据耦合(PL00008572 有行/其余无行, 翻红随时序抖动)
        if (review.budget_id && DELIVERY_REQUIRED_TYPES.includes(review.type)) {
          const bbChain = db.prepare('SELECT status,opp_code FROM budgets WHERE id=?').get(review.budget_id);
          const codeChain = String((bbChain && bbChain.opp_code) || '').trim();
          if (codeChain) {
            const odChain = db.prepare('SELECT status FROM opp_delivery WHERE opp_code=?').get(codeChain);
            if (!odChain || odChain.status !== 'confirmed')
              return send(res, 400, { error: '三步链未闭合:商机 ' + codeChain + ' 的交付预算未确认或缺失(① 交付预算 → ② 项目预算 → ③ 评审单),请先确认再提交' });
          }
        }
        // V4.0 §5 D-1: 提交硬门禁=REQUIRED.review[type] 的 req 集(BID_REQUIRED 仅对话追问集, 不参与此处)
        if (SUBMIT_REQUIRED_GATE) {
          const formS = JSON.parse(review.form_json || '{}');
          const missS = reqKeys(review.type).filter(k => {
            const v = formS[k];
            return v === undefined || v === null || String(v).trim() === '';
          });
          if (missS.length) {
            const zhS = missS.map(k => { const f = (REQUIRED.review[review.type] || []).find(x => x.k === k) || {}; return f.l || k; });
            return send(res, 400, { error: '必填缺失:' + zhS.join('、'), missing: missS });
          }
        }
        const round = review.status === 'draft' ? review.round : review.round + 1;
        db.prepare("UPDATE tasks SET status='cancelled' WHERE review_id=? AND status='pending'").run(review.id);
        db.prepare('UPDATE reviews SET status=?, round=?, light=NULL, route=NULL, report=NULL, judge_detail=NULL, report_html=NULL, updated_at=? WHERE id=?')
          .run('reviewing', round, now(), review.id);
        createTasks({ ...review, round }, round);
        addEvent(review.id, round > 1 ? `第 ${round} 轮提交` : '提交评审', user.name, '前置评审任务已重新分发');
        // ① 提交分派后 @相关部门(任务 3.6 触发点)
        {
          const depts = [...new Set((INDICATORS[review.type] || []).map(i => i.dept))];
          const phones = depts.flatMap(dp => db.prepare("SELECT phone FROM users WHERE role=? AND phone IS NOT NULL AND phone != ''").all(dp).map(r => r.phone));
          notifySafe('notify', `### 前置评审任务分发\n**${review.title}**(第 ${round} 轮)已提交,前置评审任务已分发至相关部门。\n[打开评审单](${reviewLink(review.id)})`, { title: '评审任务分发', phones, event: 'task_dispatch' });
        }
        return send(res, 200, { ok: true, round });
      }

      if (sub === '/preview-light' && req.method === 'GET') { // 任务 3.5: dry-run 预判, 不落库不改 status
        if (review.applicant_id !== user.id && user.role !== '销售支持组' && user.role !== 'admin')
          return send(res, 403, { error: '仅申请人或支持组可预判' });
        const result = judge(review);
        return send(res, 200, { light: result.light, route: result.route, items: result.detail });
      }

      if (sub === '/decision' && req.method === 'POST') { // 任务 3.4(API-21/22/R-33): 会后结论录入
        if (user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅销售支持组可录入结论' });
        if (review.status !== 'judged') return send(res, 400, { error: '仅已研判单据可录入结论' });
        if (review.decision_result) return send(res, 400, { error: '结论已录入,不可重复' });
        const { decision_result, decision_note, opinion_conflict } = await parseBody(req);
        if (!['同意', '不同意'].includes(decision_result)) return send(res, 400, { error: "decision_result 须为'同意'或'不同意'" });
        db.prepare('UPDATE reviews SET decision_result=?, decision_note=?, decision_by=?, decision_at=?, updated_at=? WHERE id=?')
          .run(decision_result, String(decision_note || '').slice(0, 2000), user.name, now(), now(), review.id);
        addEvent(review.id, '录入结论', user.name, `${decision_result}${decision_note ? ' - ' + String(decision_note).slice(0, 200) : ''}${opinion_conflict ? '(部门意见不一致)' : ''}`);
        // R-33: 意见冲突只升路由不改灯色(判灯权在规则引擎, 人工冲突改的是上会路径)
        if (opinion_conflict) {
          db.prepare('UPDATE reviews SET route=?, updated_at=? WHERE id=?').run('黄灯:XO级评审会(意见冲突重路由)', now(), review.id);
          addEvent(review.id, 'reroute_xo', '系统', '部门意见不一致, 路由升级 XO 级评审会(灯色不变)');
        }
        // ⑤ 绿灯发布: 结论进评审委员会群(N-01, 任务 3.6 触发点)
        if (decision_result === '同意') {
          notifySafe('committee', `### 评审结论·绿灯发布\n**${review.title}** 研判灯态:${review.light}, 结论:同意。\n[查看评审单与研判报告](${reviewLink(review.id)})`, { title: '评审结论发布', phones: applicantPhone(review.id), event: 'green_publish' });
        }
        return send(res, 200, { ok: true });
      }

      if (sub === '/messages' && req.method === 'GET') { // 技能②对话留痕回放(任务 3.3)
        if (review.applicant_id !== user.id && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅申请人可查看对话' });
        return send(res, 200, { messages: db.prepare('SELECT role,content,created_at FROM agent_messages WHERE review_id=? ORDER BY id').all(review.id) });
      }

      if (sub === '/attachments' && req.method === 'POST') {
        // 审查整改#8: 限申请人/支持组 + 仅草稿/退回状态(防冒名上传污染他人材料)
        if (review.applicant_id !== user.id && user.role !== '销售支持组' && user.role !== 'admin')
          return send(res, 403, { error: '仅申请人可上传附件' });
        if (!['draft', 'returned'].includes(review.status))
          return send(res, 400, { error: '当前状态不可上传附件(仅草稿/退回修改,当前 ' + review.status + ')' });
        const { field, filename, data } = await parseBody(req);
        if (!filename || !data) return send(res, 400, { error: '缺少文件' });
        const buf = Buffer.from(data, 'base64');
        if (buf.length > 10 * 1024 * 1024) return send(res, 400, { error: '文件不能超过 10MB' });
        const dir = path.join(UPLOAD_DIR, String(review.id));
        fs.mkdirSync(dir, { recursive: true });
        const safe = `${Date.now()}_${path.basename(filename).replace(/[\\/:*?"<>|]/g, '_')}`;
        fs.writeFileSync(path.join(dir, safe), buf);
        db.prepare('INSERT INTO attachments(review_id,field,filename,filepath,uploaded_at) VALUES(?,?,?,?,?)')
          .run(review.id, field || '其他', filename, `${review.id}/${safe}`, now());
        addEvent(review.id, '上传附件', user.name, filename);
        return send(res, 200, { ok: true });
      }

      if (sub === '/judge' && req.method === 'POST') { // 手动重跑研判(支持组)
        if (user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅销售支持组可触发研判' });
        // 审查整改#5: 状态门——防草稿单跳过全流程直接判灯/归档单被倒退回 returned
        if (!['reviewing', 'judged'].includes(review.status))
          return send(res, 400, { error: '仅前置评审中/已研判单据可触发研判(当前 ' + review.status + ')' });
        const result = judge(review);
        saveJudged(review, result);
        addEvent(review.id, 'AI 研判', '系统', `灯态:${result.light}`);
        return send(res, 200, result);
      }

      if (sub === '/archive' && req.method === 'POST') {
        if (user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '仅销售支持组可归档' });
        if (review.status !== 'judged') return send(res, 400, { error: '仅已研判单据可归档' });
        db.prepare('UPDATE reviews SET status=?, archived_at=?, updated_at=? WHERE id=?').run('archived', now(), now(), review.id);
        addEvent(review.id, '归档', user.name, '评审材料与研判报告已归档存储');
        // V4.0-G4 归档翻转(spec §2.2): 该商机在线单全部归档后档案置 reviewed; 历史单(era='history')不参与计数, 避免存量承接数据误判
        const codeG4 = String(review.opp_code || '').trim();
        if (codeG4) {
          const openG4 = db.prepare("SELECT COUNT(*) c FROM reviews WHERE opp_code=? AND status!='archived' AND (era IS NULL OR era='online')").get(codeG4).c;
          if (openG4 === 0) db.prepare("UPDATE opps SET status='reviewed', updated_at=? WHERE opp_code=?").run(now(), codeG4);
        }
        // ⑧ 结论归档通知(任务 3.6 触发点)
        notifySafe('notify', `### 评审归档\n**${review.title}** 已归档(结论:${review.decision_result || '未录入'})。\n[归档记录](${reviewLink(review.id)})`, { title: '评审归档', event: 'archived' });
        return send(res, 200, { ok: true });
      }
    }

    // ---------- T4: LLM 配置管理(admin 限定, key 掩码, 写回保留既有键) ----------
    // T9: readCfg/maskKey 上提为模块级单一定义; 本块仍是 config.json 唯一写者(D-43 ②), LLM_PROFILES 写入扩在同一 read-modify-write 内
    if (p === '/api/admin/config') {
      if (user.role !== 'admin') return send(res, 403, { error: '仅 admin 可管理 LLM 配置' });
      if (req.method === 'GET') {
        const cfg = readCfg();
        const pm = {};
        for (const [k, v] of Object.entries(cfg.LLM_PROFILES || {})) {
          if (LLM_PROFILE_NAMES.includes(k) && v && typeof v === 'object') pm[k] = { base: v.base || '', model: v.model || '', key: v.key ? maskKey(v.key) : '' };
        }
        return send(res, 200, { LLM_BASE_URL: cfg.LLM_BASE_URL || '', LLM_MODEL: cfg.LLM_MODEL || '', LLM_API_KEY_MASKED: maskKey(cfg.LLM_API_KEY), LLM_PROFILES_MASKED: pm });
      }
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const cfg = readCfg();
        let n = 0;
        if (body.LLM_BASE_URL && String(body.LLM_BASE_URL).trim()) {
          const eTop = llmBaseErr(body.LLM_BASE_URL);
          if (eTop) return send(res, 400, { error: 'LLM_BASE_URL ' + eTop }); // D-52(T14): 整请求拒绝, 此路径永不写文件
          cfg.LLM_BASE_URL = String(body.LLM_BASE_URL).trim(); n++;
        }
        if (body.LLM_MODEL && String(body.LLM_MODEL).trim()) { cfg.LLM_MODEL = String(body.LLM_MODEL).trim(); n++; }
        if (body.LLM_API_KEY && String(body.LLM_API_KEY).trim()) { cfg.LLM_API_KEY = String(body.LLM_API_KEY).trim(); n++; }
        if (body.LLM_PROFILES && typeof body.LLM_PROFILES === 'object' && !Array.isArray(body.LLM_PROFILES)) {
          const prevJson = JSON.stringify(cfg.LLM_PROFILES || {});
          const next = { ...(cfg.LLM_PROFILES || {}) };
          for (const k of LLM_PROFILE_NAMES) {
            const v = body.LLM_PROFILES[k]; if (!v || typeof v !== 'object') continue;
            next[k] = { ...(next[k] || {}) };
            // base 是 curl 的位置参数: 仅收 http(s), 杜绝 '-' 开头被当作选项(裁判统一走 llmBaseErr, 不另抄正则)
            if (typeof v.base === 'string' && v.base.trim()) {
              const eProf = llmBaseErr(v.base);
              if (eProf) return send(res, 400, { error: `profile ${k} 的 base ${eProf}` });
              next[k].base = v.base.trim();
            }
            if (typeof v.model === 'string' && v.model.trim()) next[k].model = v.model.trim().slice(0, 100);
            // key 只接受非掩码明文写入; 读到 **** 视为「不改」(掩码契约 D-43 ③, 防把掩码存成真值)
            if (typeof v.key === 'string' && v.key.trim() && !v.key.includes('****')) next[k].key = v.key.trim();
            for (const f of ['base', 'model', 'key']) if (v[f] === null) delete next[k][f]; // 显式 null = 清除该字段, 回落上一级
            if (!Object.keys(next[k]).length) delete next[k];
          }
          if (JSON.stringify(next) !== prevJson) { cfg.LLM_PROFILES = next; n++; }
        }
        if (n === 0) return send(res, 400, { error: '未提交任何要修改的键' });
        fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); // 保留 REPORT_SECRET 等既有键
        return send(res, 200, { ok: true, updated: n, LLM_API_KEY_MASKED: maskKey(cfg.LLM_API_KEY) });
      }
    }

    // ---------- V4.0 T9: LLM 管理中心(admin 限定; 只读 config.json, 不另开写者) ----------
    if (p.startsWith('/api/admin/llm/') && user.role !== 'admin') return send(res, 403, { error: '仅 admin 可管理 LLM' });
    // 各 profile 实效值与来源(key 一律掩码) + 降级参数 + 提示词版本
    if (p === '/api/admin/llm/profiles' && req.method === 'GET') {
      const profiles = LLM_PROFILE_NAMES.map(name => {
        const c = resolveLlm(name);
        return { name, base: c.base, base_src: c.base_src, model: c.model, model_src: c.model_src, key_masked: c.key ? maskKey(c.key) : '', key_src: c.key_src };
      });
      const prompts = {};
      for (const s of ['budget', 'review']) prompts[s] = promptVersions(s).map(r => ({ v: r.v, chars: promptText(r.value).length, updated_at: r.updated_at, updated_by: r.updated_by }));
      return send(res, 200, { profiles, degrade: llmDegrade(), prompts });
    }
    if (p === '/api/admin/llm/test' && req.method === 'POST') {
      const body = await parseBody(req);
      const prof = LLM_PROFILE_NAMES.includes(body.profile) ? body.profile : 'default';
      const c = resolveLlm(prof);
      if (!c.base || !c.key) return send(res, 200, { ok: false, ms: 0, profile: prof, error: '未配置大模型(base/key 缺失)' });
      if (llmBaseErr(c.base)) return send(res, 200, { ok: false, ms: 0, profile: prof, error: 'base 不是 http(s):// 地址(来源 ' + c.base_src + ')' }); // 纵深防御: 真源已在写入侧(llmBaseErr), 此处只兜历史 config 与环境变量
      // 超时走 llm.degrade.timeout_ms(缺省 8s); 探针是诊断用途, 不受 enabled 开关影响
      const maxTime = llmTimeoutSec(llmDegrade(), 8);
      const payload = JSON.stringify({ model: c.model, temperature: 0, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      const t0 = Date.now();
      const r = await new Promise((resolve) => { // 与 agent.js 同一 curl 通道
        const cp = spawn('curl', ['-s', '--proto', '=http,https', '-X', 'POST', c.base + '/v1/chat/completions',
          '-H', 'Content-Type: application/json', '-H', 'Authorization: Bearer ' + c.key,
          '--data-binary', '@-', '--max-time', String(maxTime)], { windowsHide: true });
        let out = '', err = '';
        cp.stdout.on('data', d => out += d); cp.stderr.on('data', d => err += d);
        cp.on('error', e => resolve({ code: -1, out: '', err: String((e && e.message) || e) }));
        cp.on('close', code => resolve({ code, out, err }));
        cp.stdin.on('error', () => {}); // EPIPE 吞掉(审查整改#4 同口径)
        cp.stdin.write(payload); cp.stdin.end();
      });
      const ms = Date.now() - t0;
      const ok = r.code === 0 && /"choices"/.test(String(r.out || '')); // 网关 200 空响应也判失败
      logLlmCall(prof, ok, !ok, ms, null, 'probe');
      const why = ok ? '' : (String(r.out + r.err).trim() || 'curl 退出码 ' + r.code + (r.code === 28 ? '(超时)' : r.code === 7 ? '(连接失败)' : ''));
      return send(res, 200, { ok, ms, profile: prof, error: why.split(c.key).join('****').slice(0, 200) }); // 诊断端点不以 HTTP 状态表达上游结果
    }
    // spec 写 /stats, 简报写 /usage: 两名同一实现
    if ((p === '/api/admin/llm/usage' || p === '/api/admin/llm/stats') && req.method === 'GET') {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
      // ts 是 now() 的完整 ISO 串, 阈值必须同为完整 ISO 串(.slice(0,19).replace('T',' ') 会因字典序恒不淘汰)
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const rows = db.prepare(`SELECT profile, COUNT(*) n, SUM(ok) ok_n, SUM(degraded) deg_n, CAST(AVG(ms) AS INTEGER) avg_ms, SUM(tokens_est) tokens_est
        FROM llm_calls WHERE ts >= ? GROUP BY profile ORDER BY n DESC`).all(since);
      return send(res, 200, { days, since, rows });
    }
    // 降级参数与提示词新版本(settings 原始串通道; 提示词只追加新版本, 不覆盖旧版本)
    if (p === '/api/admin/llm/settings' && req.method === 'POST') {
      const body = await parseBody(req);
      const out = {};
      const pr = body.prompt && typeof body.prompt === 'object' ? { skill: body.prompt.skill, text: String(body.prompt.text || '').trim() } : null;
      if (pr && !['budget', 'review'].includes(pr.skill)) return send(res, 400, { error: 'skill 仅限 budget/review' });
      if (pr && (!pr.text || pr.text.length > 8000)) return send(res, 400, { error: '提示词不能为空且不超过 8000 字' });
      if (body.degrade && typeof body.degrade === 'object') {
        const d = body.degrade, nd = {};
        if (d.timeout_ms != null && d.timeout_ms !== '') {
          const t = Number(d.timeout_ms);
          if (!Number.isFinite(t) || t < 1000 || t > 60000) return send(res, 400, { error: 'timeout_ms 须在 1000~60000' });
          nd.timeout_ms = Math.round(t);
        }
        if (d.retries != null && d.retries !== '') {
          const r = Number(d.retries);
          if (!Number.isInteger(r) || r < 0 || r > 2) return send(res, 400, { error: 'retries 须为 0~2 的整数' });
          nd.retries = r;
        }
        if (typeof d.enabled === 'boolean') nd.enabled = d.enabled;
        setSettingRaw('llm.degrade', JSON.stringify(nd), user.username);
        out.degrade = nd;
      }
      if (pr) {
        const v = ((promptVersions(pr.skill)[0] || {}).v || 0) + 1;
        setSettingRaw(`prompt.${pr.skill}.v${v}`, JSON.stringify(pr.text), user.username);
        out.prompt = { skill: pr.skill, v };
      }
      if (!Object.keys(out).length) return send(res, 400, { error: '未提交任何要修改的键' });
      return send(res, 200, { ok: true, ...out });
    }

    // ---------- V4.0 T10: 机器人管理中心(admin 限定; secret 只写不回显, webhook 查询串值同走 maskKey) ----------
    if (p.startsWith('/api/admin/robot')) {
      if (user.role !== 'admin') return send(res, 403, { error: '仅 admin 可管理机器人' });
      const maskWebhook = u => {
        const s = String(u || '');
        if (!s) return '';
        try { const x = new URL(s); for (const [k, v] of [...x.searchParams]) x.searchParams.set(k, maskKey(v)); return x.toString(); }
        catch (e) { return maskKey(s); }
      };
      const instView = r => ({ id: r.id, name: r.name, webhook: maskWebhook(r.webhook), has_secret: !!r.secret, secret_masked: r.secret ? maskKey(r.secret) : '',
        env: r.env, channel: r.channel, enabled: r.enabled, created_at: r.created_at, updated_at: r.updated_at });
      const CHANNELS = ['notify', 'committee'];
      const mInst = p.match(/^\/api\/admin\/robot\/instances\/(\d+)$/);
      if (p === '/api/admin/robot/instances' && req.method === 'GET') {
        const instances = db.prepare('SELECT * FROM robot_instances ORDER BY id').all().map(instView);
        const cfg = readCfg();
        const active = {};
        for (const ch of CHANNELS) { const t = resolveRobot(ch); active[ch] = { source: t.source, name: t.name, id: t.id || null, configured: !!t.url }; }
        return send(res, 200, { instances, active,
          config: { NOTIFY_WEBHOOK_URL: maskWebhook(cfg.NOTIFY_WEBHOOK_URL), COMMITTEE_WEBHOOK_URL: maskWebhook(cfg.COMMITTEE_WEBHOOK_URL) } });
      }
      if (p === '/api/admin/robot/instances' && req.method === 'POST') {
        const b = await parseBody(req);
        const name = String(b.name || '').trim();
        if (!name || name.length > 64) return send(res, 400, { error: '名称不能为空且不超过 64 字' });
        const bad = badWebhook(b.webhook);
        if (bad) return send(res, 400, { error: bad });
        const channel = b.channel === undefined ? 'notify' : b.channel;
        if (!CHANNELS.includes(channel)) return send(res, 400, { error: 'channel 仅限 notify/committee' });
        const env = String(b.env || 'prod').slice(0, 16);
        const t = now();
        try {
          const r = db.prepare('INSERT INTO robot_instances(name,webhook,secret,env,channel,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
            .run(name, String(b.webhook).trim(), String(b.secret || ''), env, channel, b.enabled ? 1 : 0, t, t);
          return send(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
        } catch (e) {
          if (/UNIQUE/.test(e.message)) return send(res, 409, { error: '名称已存在' });
          throw e;
        }
      }
      if (mInst && req.method === 'PUT') {
        const cur = db.prepare('SELECT * FROM robot_instances WHERE id=?').get(Number(mInst[1]));
        if (!cur) return send(res, 404, { error: '机器人实例不存在' });
        const b = await parseBody(req);
        const next = { ...cur };
        if (b.name !== undefined) {
          next.name = String(b.name || '').trim();
          if (!next.name || next.name.length > 64) return send(res, 400, { error: '名称不能为空且不超过 64 字' });
        }
        // 回灌掩码串(含 ****)视为不改, 与 /api/admin/config 的 key 口径一致
        if (b.webhook !== undefined && !String(b.webhook).includes('****')) {
          const bad = badWebhook(b.webhook);
          if (bad) return send(res, 400, { error: bad });
          next.webhook = String(b.webhook).trim();
        }
        if (b.secret !== undefined && b.secret !== null && !String(b.secret).includes('****')) next.secret = String(b.secret);
        if (b.secret === null) next.secret = '';
        if (b.channel !== undefined) {
          if (!CHANNELS.includes(b.channel)) return send(res, 400, { error: 'channel 仅限 notify/committee' });
          next.channel = b.channel;
        }
        if (b.env !== undefined) next.env = String(b.env || 'prod').slice(0, 16);
        if (b.enabled !== undefined) next.enabled = b.enabled ? 1 : 0;
        try {
          db.prepare('UPDATE robot_instances SET name=?, webhook=?, secret=?, env=?, channel=?, enabled=?, updated_at=? WHERE id=?')
            .run(next.name, next.webhook, next.secret || '', next.env, next.channel, next.enabled, now(), cur.id);
        } catch (e) {
          if (/UNIQUE/.test(e.message)) return send(res, 409, { error: '名称已存在' });
          throw e;
        }
        return send(res, 200, { ok: true });
      }
      if (mInst && req.method === 'DELETE') {
        const r = db.prepare('DELETE FROM robot_instances WHERE id=?').run(Number(mInst[1]));
        return r.changes ? send(res, 200, { ok: true }) : send(res, 404, { error: '机器人实例不存在' });
      }
      // 探活: 单次直发, 恒 200 {ok, ms, error}; 有 secret 则按钉钉加签发送
      if (p === '/api/admin/robot/test' && req.method === 'POST') {
        const b = await parseBody(req);
        const r = db.prepare('SELECT * FROM robot_instances WHERE id=?').get(Number(b.id) || 0);
        if (!r) return send(res, 404, { error: '机器人实例不存在' });
        const bad = badWebhook(r.webhook);
        if (bad) return send(res, 200, { ok: false, ms: 0, source: 'db', id: r.id, name: r.name, error: bad });
        const out = await notify.probe({ url: r.webhook, secret: r.secret || '' }, `### 机器人连通性测试\n实例「${r.name}」(${r.channel}/${r.env}) 由 ${user.name || user.username} 于 ${now()} 发起。`, '机器人连通性测试');
        const err = String(out.error || '').split(r.webhook).join(maskWebhook(r.webhook));
        return send(res, 200, { ok: out.ok, ms: out.ms, source: 'db', id: r.id, name: r.name, channel: r.channel, error: r.secret ? err.split(r.secret).join('****') : err });
      }
      if (p === '/api/admin/robot/matrix' && req.method === 'GET') {
        const events = NOTIFY_EVENTS.map(ev => {
          const [target, channel] = EVENT_ROUTE[ev];
          const row = db.prepare('SELECT enabled FROM notify_matrix WHERE event=? AND target=? AND channel=?').get(ev, target, channel);
          return { event: ev, label: EVENT_LABEL[ev], target, channel, configured: !!row, enabled: matrixAllows(ev, target, channel) ? 1 : 0 };
        });
        return send(res, 200, { events, targets: MATRIX_TARGETS });
      }
      if (p === '/api/admin/robot/matrix' && req.method === 'PUT') {
        const b = await parseBody(req);
        if (!NOTIFY_EVENTS.includes(b.event)) return send(res, 400, { error: '未知事件: 仅限 ' + NOTIFY_EVENTS.join('/') });
        const [target, channel] = EVENT_ROUTE[b.event];
        if (b.target !== undefined && b.target !== target) return send(res, 400, { error: `事件 ${b.event} 的接收对象只能是 ${target}` });
        if (b.channel !== undefined && b.channel !== channel) return send(res, 400, { error: `事件 ${b.event} 的群通道只能是 ${channel}` });
        db.prepare('INSERT INTO notify_matrix(event,target,channel,enabled) VALUES(?,?,?,?) ON CONFLICT(event,target) DO UPDATE SET channel=excluded.channel, enabled=excluded.enabled')
          .run(b.event, target, channel, b.enabled ? 1 : 0);
        return send(res, 200, { ok: true, event: b.event, target, channel, enabled: b.enabled ? 1 : 0 });
      }
      if (p === '/api/admin/robot/matrix' && req.method === 'DELETE') {
        const ev = url.searchParams.get('event');
        if (!NOTIFY_EVENTS.includes(ev)) return send(res, 400, { error: '未知事件' });
        const r = db.prepare('DELETE FROM notify_matrix WHERE event=?').run(ev);
        return send(res, 200, { ok: true, deleted: Number(r.changes) });
      }
      if (p === '/api/admin/robot/whitelist' && req.method === 'GET') {
        const rows = db.prepare(`SELECT w.id, w.ident, w.kind, w.scope, w.created_at, u.name AS user_name FROM robot_whitelist w
          LEFT JOIN users u ON w.kind='user_id' AND CAST(u.id AS TEXT)=w.ident ORDER BY w.id`).all();
        return send(res, 200, { whitelist: rows });
      }
      if (p === '/api/admin/robot/whitelist' && req.method === 'POST') {
        const b = await parseBody(req);
        const ident = String(b.ident || '').trim();
        if (!['user_id', 'phone'].includes(b.kind)) return send(res, 400, { error: 'kind 仅限 user_id/phone' });
        if (!['query', 'create'].includes(b.scope)) return send(res, 400, { error: 'scope 仅限 query/create' });
        if (b.kind === 'user_id' && !/^\d{1,12}$/.test(ident)) return send(res, 400, { error: 'user_id 须为数字' });
        if (b.kind === 'phone' && !/^\+?\d{5,20}$/.test(ident)) return send(res, 400, { error: '手机号格式不合法' });
        try {
          const r = db.prepare('INSERT INTO robot_whitelist(ident,kind,scope,created_at) VALUES(?,?,?,?)').run(ident, b.kind, b.scope, now());
          return send(res, 200, { ok: true, id: Number(r.lastInsertRowid) });
        } catch (e) {
          if (/UNIQUE/.test(e.message)) return send(res, 409, { error: '该身份与范围已在白名单' });
          throw e;
        }
      }
      const mWl = p.match(/^\/api\/admin\/robot\/whitelist\/(\d+)$/);
      if (mWl && req.method === 'DELETE') {
        const r = db.prepare('DELETE FROM robot_whitelist WHERE id=?').run(Number(mWl[1]));
        return r.changes ? send(res, 200, { ok: true }) : send(res, 404, { error: '白名单条目不存在' });
      }
      // 迁移: config.json 两键 -> robot_instances(停用态, 幂等; 只读 config, 不写回)
      if (p === '/api/admin/robot/import-config' && req.method === 'POST') {
        const cfg = readCfg();
        let inserted = 0;
        const skipped = [];
        for (const [key, ch] of [['NOTIFY_WEBHOOK_URL', 'notify'], ['COMMITTEE_WEBHOOK_URL', 'committee']]) {
          const u = String(cfg[key] || '').trim();
          if (!u) { skipped.push(key + ':未配置'); continue; }
          if (badWebhook(u)) { skipped.push(key + ':' + badWebhook(u)); continue; }
          const t = now();
          const r = db.prepare('INSERT OR IGNORE INTO robot_instances(name,webhook,secret,env,channel,enabled,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)')
            .run('config:' + key, u, '', 'prod', ch, t, t);
          inserted += Number(r.changes);
        }
        return send(res, 200, { ok: true, inserted, skipped });
      }
      // ---------- 机器人工作流 T3: 绑定 / 目标 / 外发箱管理(同一 admin 总门内) ----------
      const BINDING_STATUS = ['unbound', 'active', 'disabled'];
      const TARGET_STATUS = ['unbound', 'active', 'disabled'];
      const TARGET_TYPES = ['direct', 'group'];
      const ROBOT_PROVIDERS = ['dingtalk'];
      const robotPayload = s => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } };
      const bindingView = r => ({ user_id: Number(r.user_id), provider: r.provider, external_user_id: r.external_user_id || '',
        phone: r.phone || '', status: r.status, updated_at: r.updated_at, updated_by: r.updated_by, user_name: r.user_name, user_role: r.user_role });
      const targetView = r => ({ target_key: r.target_key, provider: r.provider, target_type: r.target_type,
        external_ref: r.external_ref || '', status: r.status, updated_at: r.updated_at, updated_by: r.updated_by });
      const outboxView = r => ({ id: Number(r.id), opp_code: r.opp_code, review_id: r.review_id, task_id: r.task_id,
        event: r.event, target_key: r.target_key, provider: r.provider, status: r.status, idempotency_key: r.idempotency_key,
        created_by: r.created_by, created_at: r.created_at, sent_at: r.sent_at, attempts: r.attempts, last_error: r.last_error,
        payload: robotPayload(r.payload_json) });
      if (p === '/api/admin/robot/bindings' && req.method === 'GET') {
        const bindings = db.prepare(`SELECT b.*, u.name AS user_name, u.role AS user_role FROM robot_user_bindings b
          LEFT JOIN users u ON u.id=b.user_id ORDER BY b.user_id, b.provider`).all().map(bindingView);
        return send(res, 200, { bindings, providers: ROBOT_PROVIDERS, statuses: BINDING_STATUS });
      }
      const mBinding = p.match(/^\/api\/admin\/robot\/bindings\/(\d{1,12})$/);
      if (mBinding && req.method === 'PUT') {
        const b = await parseBody(req);
        const userId = Number(mBinding[1]);
        if (!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) return send(res, 400, { error: '用户不存在: ' + userId });
        const provider = b.provider === undefined ? 'dingtalk' : String(b.provider);
        if (!ROBOT_PROVIDERS.includes(provider)) return send(res, 400, { error: 'provider 仅限 ' + ROBOT_PROVIDERS.join('/') });
        const bStatus = b.status === undefined ? 'unbound' : String(b.status);
        if (!BINDING_STATUS.includes(bStatus)) return send(res, 400, { error: 'status 仅限 ' + BINDING_STATUS.join('/') });
        const ext = String(b.external_user_id == null ? '' : b.external_user_id).trim().slice(0, 128);
        const phone = String(b.phone == null ? '' : b.phone).trim().slice(0, 32);
        // 绑定只是身份映射: 只写 robot_user_bindings, 永不回写 users 的 role/dept/phone
        try {
          db.prepare(`INSERT INTO robot_user_bindings(user_id,provider,external_user_id,phone,status,updated_at,updated_by)
            VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET external_user_id=excluded.external_user_id,
              phone=excluded.phone, status=excluded.status, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
            .run(userId, provider, ext, phone, bStatus, now(), user.username);
        } catch (e) {
          if (/UNIQUE constraint failed/.test(e.message)) return send(res, 409, { error: '该钉钉账号已绑定其他用户' });
          throw e;
        }
        const row = db.prepare('SELECT * FROM robot_user_bindings WHERE user_id=? AND provider=?').get(userId, provider);
        return send(res, 200, { ok: true, binding: bindingView(row) });
      }
      if (p === '/api/admin/robot/targets' && req.method === 'GET') {
        const targets = db.prepare('SELECT * FROM robot_targets ORDER BY target_key').all().map(targetView);
        return send(res, 200, { targets, types: TARGET_TYPES, statuses: TARGET_STATUS });
      }
      const mTarget = p.match(/^\/api\/admin\/robot\/targets\/(.+)$/);
      if (mTarget && req.method === 'PUT') {
        const b = await parseBody(req);
        let key;
        try { key = decodeURIComponent(mTarget[1]).trim(); } catch (e) { return send(res, 400, { error: 'target_key 编码不合法' }); }
        if (key !== 'committee' && key !== 'sales_group' && !(key.startsWith('dept:') && key.slice(5).trim())) {
          return send(res, 400, { error: 'target_key 仅限 committee/sales_group/dept:<部门>' });
        }
        const provider = b.provider === undefined ? 'dingtalk' : String(b.provider);
        if (!ROBOT_PROVIDERS.includes(provider)) return send(res, 400, { error: 'provider 仅限 ' + ROBOT_PROVIDERS.join('/') });
        const tType = String(b.target_type || '');
        if (!TARGET_TYPES.includes(tType)) return send(res, 400, { error: 'target_type 仅限 ' + TARGET_TYPES.join('/') });
        const tStatus = b.status === undefined ? 'unbound' : String(b.status);
        if (!TARGET_STATUS.includes(tStatus)) return send(res, 400, { error: 'status 仅限 ' + TARGET_STATUS.join('/') });
        const ref = String(b.external_ref == null ? '' : b.external_ref).trim().slice(0, 512);
        const status = ref ? tStatus : 'unbound'; // 没填外部引用即未绑定, 请求里的 active 不予采信
        db.prepare(`INSERT INTO robot_targets(target_key,provider,target_type,external_ref,status,updated_at,updated_by)
          VALUES(?,?,?,?,?,?,?) ON CONFLICT(target_key) DO UPDATE SET provider=excluded.provider, target_type=excluded.target_type,
            external_ref=excluded.external_ref, status=excluded.status, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
          .run(key, provider, tType, ref, status, now(), user.username);
        const row = db.prepare('SELECT * FROM robot_targets WHERE target_key=?').get(key);
        return send(res, 200, { ok: true, target: targetView(row) });
      }
      if (p === '/api/admin/robot/outbox' && req.method === 'GET') {
        const st = String(url.searchParams.get('status') || '').trim();
        const ev = String(url.searchParams.get('event') || '').trim();
        const lim = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const where = [], args = [];
        if (st) { where.push('status=?'); args.push(st); }
        if (ev) { where.push('event=?'); args.push(ev); }
        const rows = db.prepare('SELECT * FROM robot_outbox ' + (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
          'ORDER BY id DESC LIMIT ?').all(...args, lim).map(outboxView);
        const backlog = db.prepare("SELECT COUNT(*) c FROM robot_outbox WHERE status IN ('preview','ready')").get().c;
        return send(res, 200, { rows, backlog });
      }
      if (p === '/api/admin/robot/outbox/preview' && req.method === 'POST') {
        const b = await parseBody(req);
        if (b.event !== undefined && b.event !== 'review_invite') return send(res, 400, { error: 'preview 目前只支持 event=review_invite' });
        if (b.payload_json !== undefined || b.payload !== undefined) return send(res, 400, { error: '消息正文由服务端生成, 不接受客户端提交' });
        const opp = db.prepare('SELECT * FROM opps WHERE opp_code=?').get(String(b.opp_code || '').trim());
        if (!opp) return send(res, 404, { error: '商机档案不存在' });
        const target = db.prepare('SELECT id,name,role FROM users WHERE id=?').get(Number(b.target_user_id) || 0);
        if (!target || !['项目经理', '销售经理'].includes(target.role)) return send(res, 400, { error: '接收人必须是已有项目经理或销售经理' });
        // 与用户邀请共用同一构造口 + 同一入箱口; 差别只在管理面预演不因该商机已有评审而拒绝(否则已有单的消息样式无法预览)
        const row = enqueueRobotOutbox(buildReviewInvite({ opp, targetUser: target, baseUrl: publicBaseUrl() }), user);
        return send(res, 200, { ok: true, outbox_id: Number(row.id), status: row.status, event: row.event,
          target_key: row.target_key, opp_code: row.opp_code, idempotency_key: row.idempotency_key, payload: robotPayload(row.payload_json) });
      }
      const mOutboxCancel = p.match(/^\/api\/admin\/robot\/outbox\/(\d{1,12})\/cancel$/);
      if (mOutboxCancel && req.method === 'POST') {
        await parseBody(req);
        const id = Number(mOutboxCancel[1]);
        const cur = db.prepare('SELECT * FROM robot_outbox WHERE id=?').get(id);
        if (!cur) return send(res, 404, { error: '外发记录不存在' });
        if (cur.status === 'cancelled') return send(res, 200, { ok: true, status: 'cancelled', row: outboxView(cur) }); // 重复取消幂等
        // 只有尚未交给 provider 的行可取消; sent/failed 属发送侧状态, 本轮无真实发送, 状态迁移用例待接入发送时补
        if (cur.status !== 'preview' && cur.status !== 'ready') return send(res, 409, { error: '当前状态 ' + cur.status + ' 不可取消(仅 preview/ready 可取消)' });
        db.prepare("UPDATE robot_outbox SET status='cancelled' WHERE id=? AND status IN ('preview','ready')").run(id);
        const row = db.prepare('SELECT * FROM robot_outbox WHERE id=?').get(id) || cur;
        if (row.status === 'cancelled') return send(res, 200, { ok: true, status: 'cancelled', row: outboxView(row) });
        return send(res, 409, { error: '状态已被并发改变(当前 ' + row.status + ')' });
      }
      return send(res, 404, { error: '未知的机器人管理端点' });
    }

    const mEv = p.match(/^\/api\/tasks\/(\d+)\/evidence$/);
    if (mEv && req.method === 'GET') {
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(Number(mEv[1]));
      const review = task && getReview(task.review_id);
      if (!task || !review) return send(res, 404, { error: '任务不存在' });
      return send(res, 200, evidenceFor(task, review));
    }

    // 前置评审任务
    if (p === '/api/tasks' && req.method === 'GET') {
      const scope = url.searchParams.get('scope') || 'mine';
      let rows;
      if (scope === 'mine') {
        rows = db.prepare(`SELECT t.*, r.title, r.type, r.opp_code, r.status as review_status FROM tasks t JOIN reviews r ON r.id=t.review_id
          WHERE t.dept=? AND t.status='pending' AND r.status='reviewing' ORDER BY t.id DESC`).all(user.role);
      } else if (scope === 'done') {
        rows = db.prepare(`SELECT t.*, r.title, r.type, r.opp_code FROM tasks t JOIN reviews r ON r.id=t.review_id
          WHERE t.dept=? AND t.status!='pending' ORDER BY t.id DESC LIMIT 50`).all(user.role);
      } else { // all (支持组监控)
        rows = db.prepare(`SELECT t.*, r.title, r.type, r.opp_code FROM tasks t JOIN reviews r ON r.id=t.review_id ORDER BY t.id DESC LIMIT 200`).all();
      }
      const result = { tasks: annotateTasks(rows) };
      if (scope === 'all') {
        const all = annotateTasks(db.prepare(`SELECT t.*, r.opp_code, r.status AS review_status, r.round AS review_round
          FROM tasks t JOIN reviews r ON r.id=t.review_id`).all());
        const statsFor = ts => ({
          handled: ts.filter(t => t.status === 'done' || t.status === 'returned').length,
          proxy: ts.filter(t => t.proxy).length,
          zombie: ts.filter(t => t.status === 'pending' && (t.review_status !== 'reviewing' || t.round < t.review_round)).length,
          cancelled: ts.filter(t => t.status === 'cancelled').length
        });
        result.stats = statsFor(all.filter(t => !isFixtureCode(t.opp_code)));
        result.stats_all = statsFor(all);
      }
      if (scope === 'mine') {
        const pending = rows;
        const dispatchRows = db.prepare(`SELECT o.id,o.review_id,o.opp_code,o.status,o.payload_json FROM robot_outbox o
          JOIN reviews r ON r.id=o.review_id WHERE o.event='task_dispatch' AND o.target_key=?
          AND o.status IN ('preview','ready') AND r.status='reviewing'
          AND o.idempotency_key='task_dispatch:'||r.id||':'||r.round||':'||?
          AND EXISTS(SELECT 1 FROM tasks t WHERE t.review_id=r.id AND t.round=r.round AND t.dept=? AND t.status='pending')
          ORDER BY o.id DESC`).all('dept:' + user.role, user.role, user.role).map(o => {
          const ts = pending.filter(t => t.review_id === o.review_id);
          return { id: o.id, review_id: o.review_id, opp_code: o.opp_code, status: o.status,
            payload: { ...JSON.parse(o.payload_json || '{}'), pending_count: ts.length, task_ids: ts.map(t => t.id), indicators: ts.map(t => t.ind_name) } };
        });
        result.dispatch = { count: dispatchRows.length, rows: dispatchRows };
      }
      return send(res, 200, result);
    }

    const mTask = p.match(/^\/api\/tasks\/(\d+)\/(complete|return)$/);
    if (mTask && req.method === 'POST') {
      const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(mTask[1]);
      if (!task) return send(res, 404, { error: '任务不存在' });
      if (task.dept !== user.role && user.role !== '销售支持组' && user.role !== 'admin') return send(res, 403, { error: '该指标不归你的部门评审' });
      if (task.status !== 'pending') return send(res, 400, { error: '任务已处理' });
      const review = getReview(task.review_id);
      // 审查整改#9: 单据状态门——防部门退回后其他部门继续打灯触发自动研判(状态反复跳变)
      if (review.status !== 'reviewing') return send(res, 400, { error: '单据已退回或已研判,不可继续前置评审(当前 ' + review.status + ')' });
      const body = await parseBody(req);

      if (mTask[2] === 'complete') {
        const { light, opinion } = body;
        if (!['green', 'yellow', 'red'].includes(light)) return send(res, 400, { error: '请选择灯态' });
        if (light !== 'green' && !opinion) return send(res, 400, { error: '黄灯/红灯必须填写前置评审意见' });
        // 审查整改#10: 条件更新防双击并发(双研判/双通知/意见覆盖)
        const cr = db.prepare("UPDATE tasks SET status=?, light=?, opinion=?, done_by=?, done_at=? WHERE id=? AND status='pending'")
          .run('done', light, opinion || '', user.name, now(), task.id);
        if (cr.changes === 0) return send(res, 400, { error: '任务已被处理(勿重复提交)' });
        addEvent(review.id, `前置评审·${task.ind_name}`, user.name, `${task.dept} 判定:${light === 'red' ? '红灯' : light === 'yellow' ? '黄灯' : '绿灯'}${opinion ? ' - ' + opinion : ''}`);
        if (user.role !== task.dept) addEvent(review.id, '代打', user.name, `由 ${user.role} 代 ${task.dept} 完成 ${task.ind_name}`);
        // 全部完成则自动研判
        const left = db.prepare("SELECT COUNT(*) c FROM tasks WHERE review_id=? AND round=? AND status='pending'").get(review.id, review.round).c;
        if (left === 0) {
          const result = judge(getReview(review.id));
          saveJudged(getReview(review.id), result);
          addEvent(review.id, 'AI 研判', '系统', `前置评审完成,综合灯态:${result.light === 'red' ? '红灯' : result.light === 'yellow' ? '黄灯' : '绿灯'}`);
        }
        return send(res, 200, { ok: true, autoJudged: left === 0 });
      }

      if (mTask[2] === 'return') { // 退回修改
        const { opinion } = body;
        if (!opinion) return send(res, 400, { error: '请填写退回意见' });
        const rr = db.prepare("UPDATE tasks SET status=?, opinion=?, done_by=?, done_at=? WHERE id=? AND status='pending'")
          .run('returned', opinion, user.name, now(), task.id);
        if (rr.changes === 0) return send(res, 400, { error: '任务已被处理(勿重复提交)' });
        db.prepare('UPDATE reviews SET status=?, updated_at=? WHERE id=?').run('returned', now(), review.id);
        addEvent(review.id, '退回修改', user.name, `${task.dept} 退回:${opinion}`);
        const nCancel = db.prepare("UPDATE tasks SET status='cancelled' WHERE review_id=? AND round=? AND status='pending'").run(review.id, task.round).changes;
        if (nCancel) addEvent(review.id, '任务作废', '系统', `单据已退回, 同轮其余 ${nCancel} 项待办作废(重新提交时按新一轮重建)`);
        // ② 部门退回通知申请人(任务 3.6 触发点)
        notifySafe('notify', `### 评审单被退回\n**${review.title}** 被${task.dept}退回修改。\n退回意见:${String(opinion).slice(0, 200)}\n[修改材料](${reviewLink(review.id)})`, { title: '评审退回', phones: applicantPhone(review.id), event: 'returned' });
        return send(res, 200, { ok: true });
      }
    }

    // ---------- 大模型: 文本识别填充预算表 ----------
    if (p === '/api/llm/fill-budget' && req.method === 'POST') {
      const { text, model: reqModel } = await parseBody(req);
      if (!text || !String(text).trim()) return send(res, 400, { error: '请粘贴预算相关文字' });
      const ALLOWED_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'glm-5.3'];
      const msgF = String(text).slice(0, 6000);
      // D-52(T14): 收进 T9 单一入口 llmCfgFor('budget')(回落序 profile→default→env→顶层→内置), 旧自抄的「env>顶层」作废 ⇒ LLM_PROFILES.budget 与 llm.degrade 现在对本端点同样生效
      let degradedF = false, llmFieldsF = {}, llmCfgF = null;
      const t0F = Date.now();
      try {
        llmCfgF = llmCfgFor('budget');
        if (!llmCfgF.base || !llmCfgF.key) throw new Error('未配置大模型');
        llmFieldsF = await extractWithPolicy({}, msgF, llmCfgF);
      } catch (e) { degradedF = true; } // 铁律2: 失败自动降级为手填, HTTP 仍 200(与技能①②④同语义)
      logLlmCall('budget', !degradedF, degradedF, Date.now() - t0F, estTokens({}, msgF), 'fill-budget');
      // 任务2.8: 提示词/白名单与技能①同源(复用 agent.js 冻结提示词, 字段模型对齐 dev_dept, 单位元); 前端 Flash/Pro 选择权保留
      const modelF = ALLOWED_MODELS.includes(reqModel) ? reqModel : ((llmCfgF && llmCfgF.model) || LLM_DEFAULT_MODEL);
      if (degradedF) return send(res, 200, { fields: {}, model: modelF, degraded: true });
      return send(res, 200, { fields: mergeDraft(llmFieldsF, {}), model: modelF, degraded: false });
    }

    send(res, 404, { error: '接口不存在' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: '服务器错误:' + e.message });
  }
});

// V4.0-T1: 存量迁移与回填——必须在 num/now 定义之后执行(const TDZ), 故挂 listen 前
try { const m4 = migrateV40(); console.log('[V4.0-T1] delivery moved=' + m4.moved + ' opps backfilled=' + m4.made); } catch (e) { console.log('[V4.0-T1] migrate failed: ' + e.message); }
try { const pruned = pruneStoredDelivery(db); console.log('[Task4] delivery rows pruned=' + pruned); } catch (e) { console.log('[Task4] delivery prune failed: ' + e.message); }

server.listen(PORT, () => {
  // keep-alive 加长: Excel 导入的 python 解析 2-3s+客户端生成文件期间, 默认 5s 会关连接
  // 导致后续同连接请求 fetch failed(实测 flaky); 65s 覆盖全部场景
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 70000;
  console.log(`项目评审平台 MVP 已启动: http://localhost:${PORT}`);
  console.log(`数据目录: ${DATA_DIR}`);
  notify.startScheduler(); // ⑥⑦ 周一汇总/周四 XO 加推(每分钟检查, 幂等键保护)
});
