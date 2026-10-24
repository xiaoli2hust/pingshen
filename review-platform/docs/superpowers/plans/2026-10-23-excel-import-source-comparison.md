# Excel 导入原表对照与空行剔除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三类 Excel 导入均可持久左右对照，并在所有交付写入路径与存量中剔除无预算数字行。

**Architecture:** Python 输出保留原表显示格式/合并区域的 sheet 与来源格；Node 保存 append-only 原件记录和导入快照，source 端点按当前值比较；独立 vanilla JS 组件 SRCV 挂到已有实体页面。详情只传原件 meta，四页签切换无请求。

**Tech Stack:** Node 22.22.2-6 内置 node:sqlite/http/fs，Python 3.12/openpyxl，vanilla JS/CSS，已有 Playwright（仅测试）。

**Spec:** `docs/superpowers/specs/2026-10-23-excel-import-source-comparison-design.md`（5561d39，原始代码基线 150e246）。

## Global Constraints

- 单个连续任务，内部分组只表示依赖顺序，不构成分批交付。
- 五键 `pm_pd / own_pd / rd_pd / prod_pd / travel_cost`，至少一键 >0 才保留。
- rows 与 row_sources 严格等长同序；最多 300 行，每格显示值最多 2000 字。
- 零 npm 依赖；Node 使用 `C:/Users/01386380/.workbuddy/binaries/node/versions/22.22.2-6/node.exe`。
- 不改 config.json、全局设置、PATH、仓库公开性或账号；不真发钉钉，不伪造 workflow 终态。
- 中文读写只用专用文件工具或程序内 fs.writeFileSync(...,'utf8')；spawn 全部 windowsHide。
- 只提交本任务文件，不提交数据库/上传原件/密钥/手工备份/.superpowers；保留他人 untracked 文件。
- 新用例先跑旧代码取红；既有断言改变须源自用户新保留口径，红绿均留且显式负断言不弱化。
- BI-12 <300ms、EI-09 <4000ms；IA-33/34/37/38 不改。
- 用户已授权自主选择默认值；不再询问计划确认和执行方式，采用本会话执行并独立审查。

## 文件职责

| 文件 | 职责 |
|---|---|
| 新 delivery-rows.js | 数值保留谓词和两张表幂等清理 |
| 新 import-source.js | DDL、append-only 存取、meta、三值比较、预算标签 |
| 新 tools/sheet_audit.py | 两个解析器共用显示格式/合并区域输出 |
| tools/parse_delivery_xlsx.py | 数值过滤、skipped_rows、扩充合计来源 |
| tools/parse_form_xlsx.py | raw/raw_d/selected/unpicked/多格来源，不动原 pick 语义 |
| server.js | 四导入存证、详情 meta、实体 source、鉴权下载、boot prune |
| robot-orchestrator.js | 共用保留谓词 |
| 新 public/source-view.js | 只管 SRCV 显示、选择、过滤、下载，无业务写入 |
| public/app.js / style.css / index.html | 挂载组件、空行保存反馈、附件下载、加载新脚本 |
| 新 tools/backfill_import_sources.js | 停机时幂等补已有原件，标明重新解析 |
| 新 tests/test_import_source.js / h_source_compare.js | IS API/纯函数/解析器；SC 浏览器和旧 HR 全部链路 |
| tests/test_delivery.js / test_delivery_opp.js / test_robot_orchestrator.js / run_all.js | 强制调整 D/DL/RO 断言及注册 |
| 移除 tests/h_import_review.js | 由 SC 永久套件接管，不重复遗留辅助脚本 |

## 接口锁定

`delivery-rows.js`：`DELIVERY_NUM_KEYS:string[]`、`hasBudgetNumbers(row):boolean`、`pruneEmptyRows(rows):array`、`pruneStoredDelivery(db):{opp_delivery:{before,after,changed,demoted},budget_delivery:{before,after,changed}}`。

`import-source.js`：

```js
saveImportSource(db, {entity_type, entity_key, file_name, file_path, parsed, imported, user, created_at, backfilled:0});
latestImportSource(db, entity_type, entity_key); // DB row or null
budgetImportSource(db, budgetId); // row + inherited_from when parent used
sourceMeta(row); // null or {id,file_name,sheet,created_at,importer_name,backfilled,inherited_from?}
formComparison(audit, imported, current, labels, types); // {kind:'form',rows,counts,warnings}
deliveryComparison(audit, importedRows, currentRows); // {kind:'delivery',rows,counts,check,warnings:[]}
```

比较行固定形状：字段行 `{key,label,raw,imported,current,status,detail,positions,lab_positions,val_positions,row}`；交付行 `{key,label,content,stage,imported,current,status,detail,changed_keys,positions,lab_positions,val_positions,row}`。positions 为 0-based `[r,c][]`，row 为原表 0-based 行或 null。check 为 `{stage,key,label,raw,imported,current,status}[]`。source endpoint 返回 `{source:sourceMeta(record),sheet:audit.sheet,comparison}`。

SRCV：`SRCV.load(mountId,url)` 发请求并挂载；`SRCV.paint(mountId,data)` 同步渲染；`SRCV.cached(url)` 返回已加载数据。失败只在卡片内显示；异步结果只写仍存在且属于该请求的挂点。L2 的 renderDetail 主动请求，renderInstBody 只从缓存 paint，切页签不请求。

---

### Task 1: 固化空行与新来源的红证据

**Files:** tests/test_delivery.js:43-59/93-96、test_delivery_opp.js:96-111、test_robot_orchestrator.js:118-156；新 tests/test_import_source.js。
**Consumes:** BASE 真实原件、旧端点。**Produces:** D/DL/RO 强制新断言与 IS 永久载体。

- [ ] 写三份 parser 数量/剔除断言及缺来源断言，保留所有金额锚定。

```js
assert.equal(p8572.rows.length, 2);
assert.equal(p8572.skipped_rows.length, 10);
assert.equal(p8068.rows.length, 30);
assert.equal(p8111.rows.length, 2);
assert.ok(p8572.rows.every(r => ['pm_pd','own_pd','rd_pd','prod_pd','travel_cost'].some(k => r[k] > 0)));
assert.equal((await api('/api/budget/' + id)).budget.import_source.file_name, fileName);
```

- [ ] D 行数改 2，DL 改 3 且不含纯文字行；RO 删除纯文字期望对象但保留其他三对象逐值八键及幂等断言。

```js
assert.equal(once.length, 3);
assert.ok(!once.some(r => r.content === '功能回归测试'));
assert.deepEqual(cleanDeliveryDraft([{content:'纯文字',note:'备注'}]), []);
```

- [ ] 用 Node 22 跑 RO、IS 和 D/DL；脚本内保存 UTF-8 红日志 `tests/red_evidence_import_source.txt`，D/DL 的 DB 写入放 guard cycle 快照保护内。期望空行/来源明确 FAIL，不能仅模块不存在遮盖 parser 红。

### Task 2: 解析器来源与无预算行净化

**Files:** tools/sheet_audit.py、两个 parse_*、delivery-rows.js、robot-orchestrator.js:12-20；IS 纯函数/parser 部分。
**Consumes:** Task1 断言。**Produces:** sheet、sources 增量和净化函数（接口锁定）。

- [ ] 新 sheet_audit 输出 data_only 工作表显示值与合并区域，日期/百分比按 number_format；未截断原始维度，truncated 明确。

```python
cells.append([cell.row - 1, cell.column - 1, display_value(cell)])
merges = [[m.min_row-1,m.min_col-1,m.max_row-1,m.max_col-1] for m in ws.merged_cells.ranges]
```

- [ ] 附3 在输出前净化各数值，按阶段 >0 产行；无两阶段数字收 skipped，保持 sources 同分支 append。

```python
impl_has = any(max(0.0, round(x, 2)) > 0 for x in (*impl, impl_travel))
ops_has = any(max(0.0, round(x, 2)) > 0 for x in (*ops, ops_travel))
if not impl_has and not ops_has:
    skipped_rows.append({'r':ri,'content':content,'content_pos':[ri,c_content],'reason':'无预算数字'})
```

- [ ] 附1 audit 来源记录 raw/raw_d/selected，未采用匹配格入 unpicked；del_other 聚合多来源；旧 grid/val_pos 不动。
- [ ] Node 谓词对五键净化后 >0；pruneStoredDelivery 只更新数变行，保留 updated_at，全空 confirmed→draft。

```js
const hasBudgetNumbers = r => !!r && DELIVERY_NUM_KEYS.some(k => n0(r[k]) > 0);
const next = JSON.parse(row.rows_json).filter(hasBudgetNumbers);
if (next.length !== old.length) update.run(JSON.stringify(next), row.opp_code);
```

- [ ] 跑 IS parser/内存库、RO 和 PA，留绿日志；PA 三个坐标和既有字段值不漂移。

### Task 3: 原件存取与纯比较

**Files:** import-source.js、IS 纯比较测试。
**Consumes:** Task2 audit；agent.js 类型表。**Produces:** 接口锁定全部模块导出。

- [ ] 先断言状态顺序、未采用/补录、重复行匹配、8068 合计差异和预算继承。

```js
assert.equal(formComparison({sources:{ops_years:{raw:'1年',raw_d:'1年',val_pos:[9,3],lab_pos:[9,0]}}},
  {ops_years:1},{ops_years:2},{ops_years:'项目运维周期'},{ops_years:'num'}).rows[0].status, '已修改');
assert.equal(deliveryComparison(audit8068, p8068.rows, p8068.rows).check.find(x => x.stage==='实施' && x.key==='own_pd').status, '有差异');
```

- [ ] DDL 执行、save 只 INSERT、latest 按 id DESC、budget 沿 parent_id 找源；audit_json 不重复 grid；sourceMeta 不暴露路径和 imported_json。
- [ ] 字段行按 raw→imported→current 真语义分类，比较不把缺与零混同；只在 labels 键范围内；原因按实际类型与原值确定。
- [ ] 交付按 content/stage occurrence queue 匹配，改变五键记 changed_keys，原表被剔除行独立加入；check 三列逐阶段逐键汇总。
- [ ] 跑 IS 纯部分取绿，Node --check；不改任何业务金额公式。

### Task 4: 服务端四导入、源端点和权限

**Files:** server.js:293/418-425/1497-1572/1605-1760/2216-2290/2990，IS HTTP 部分。
**Consumes:** Task2/3 接口。**Produces:** meta、source 响应、下载、PUT dropped。

- [ ] 先写所有四导入+history+预算派生+三值修改的 HTTP 断言及无数值有效模板 400；用 python 生成临时模板 windowsHide，finally 删除本人文件。
- [ ] DDL 在启动执行，boot prune 放 migrateV40 后；cleanDeliveryRows 用 hasBudgetNumbers；两 PUT dropped=输入长度-保存长度。
- [ ] 四导入清洗之后存原件，file_path='import/'+safe 或 'delivery/'+safe；保留原 audit 并返回 source。history INSERT 和变异靶点逐字不改，只加源记录并将其附件 fp 改相对。

```js
const source = sourceMeta(saveImportSource(db,{entity_type:'budget',entity_key:String(r.lastInsertRowid),
  file_name:String(filename),file_path:'import/'+safe,parsed,imported:merged,user,created_at:t}));
```

- [ ] budget regex 支持 /delivery/source 三段；先核 canRead 再返回；review source 在单实体 GET 旁；opp source 在 delivery 通道旁，沿 canWriteOpp。
- [ ] 下载按类型查询实体权限；resolve 确认内部路径，缺源/文件 404；UTF-8 Content-Disposition，token 只用请求头。

```js
const fp = path.resolve(UPLOAD_DIR, record.file_path);
if (!fp.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return send(res,403,{error:'原件路径无效'});
```

- [ ] guard 停/快照/启动后跑 IS、D、DL、HI、EI、整改源码不变式，门后还原；无共享端口抢占，当前登记 25452 仍需双采样核实。

### Task 5: SRCV 与所有页面挂载

**Files:** public/source-view.js、public/app.js:783-912/1121-1144/1355/1557-1664/1875-2047/2387-2500、style.css、index.html；新 h_source_compare.js。
**Consumes:** source 响应固定形状。**Produces:** 两面板、联动、过滤、公式栏、下载及所有入口。

- [ ] 浏览器先在旧页面断言 SRCV 双面板/公式栏不存在，记录红；SC 接管旧 HR 核对/下一步链路。

```js
await page.waitForSelector('#instSrc .srcv', {timeout:15000});
await page.locator('.srcv-left tr[data-row]').first().click();
assert.ok(await page.locator('.srcv-grid td.is-active').count());
assert.match(await page.locator('.srcv-formula').innerText(), /![A-Z]+\d+/);
```

- [ ] 实现 SRCV 缓存、paint/load、row/cell 双向关联，safe HTML 转义，实例 id；合并区域投射可见行列，保留原行号，不用去空后的序号替代地址。
- [ ] 表头「系统里」「原表里」、状态统计、全/仅差异、backfilled 明示、下载 Blob、≤1100px 堆叠；check 在组件内披露不写实体。
- [ ] renderDetail 进入时主动 load 并缓存，renderInstBody(form) 只 paint；预算详情/交付页/商机交付各加挂点；导入核对页改组件而保留下一步四条按钮文案。
- [ ] 普通附件用携 Bearer fetch Blob；源文件机器人行加深链；保存后以服务 rows 替换编辑器 rows，提示 dropped 并刷新比较。
- [ ] SC 真导入、重入、双向点击、只差异、下载字节、在线修改与窄屏，监听 console error/pageerror；IA-33/34/37/38 原样复跑。

### Task 6: 旧单原件补录与新净库基线

**Files:** tools/backfill_import_sources.js；本地忽略目录中的 migration_verify.js 和证据。
**Consumes:** Task2/3、实际 uploads/agent_messages/reviews/opp_delivery。**Produces:** 19 条可追溯原件与剔除后净库。

- [ ] backfill 先在内存/复制库验证幂等；预算找消息、review 找创建时间之前同码文件并重解析核码、delivery 找 source_file。来源不存在记录缺口，不能猜。

```js
if (latestImportSource(db,type,key)) return;
if (String(parsed.fields.opp_code || '').trim() !== String(review.opp_code).trim()) throw new Error('商机代码不匹配');
saveImportSource(db,{entity_type:type,entity_key:key,file_name:name,file_path:rel,parsed,imported,
  user:{id:owner.id,name:owner.name},created_at:entity.created_at,backfilled:1});
```

- [ ] 停服务→guard snap is_before→新服务启动 DDL/prune→停→backfill→启动核验→停→guard check/snap is_clean。
- [ ] 逐项断言 6204:1/7297:1/8026:1/8210:1/8314:17/8330:4/8572:2，import_sources 6+6+7=19，预算/评审旧状态、灯态、结论未动；跑 backfill 第二次新增=0。
- [ ] guard check 只核 REAL7 存在、真实预算 locked、评审代码和 8572 anchor，不限制其他 delivery 行数，因此不会把新口径当污染。

### Task 7: 全门、独立审查、提交与运行交付

**Files:** tests/run_all.js:29-67；报告 docs/superpowers/reports/2026-10-23-excel-import-source-comparison-report.md；本任务代码和红绿日志。
**Consumes:** Task1-6 已核证交付。**Produces:** 最终 39 套门证据、审查结论、GitHub 同步、运行服务。

- [ ] SC 接管旧 HR 后移除 h_import_review.js（用户请求覆盖范围内）；注册 IS/SC，不改已有 37 套断言或门聚合规则。
- [ ] Node --check、git diff --check、独立代码/业务/测试审查；发现问题先取失败见证再补，不盲信代理报告。
- [ ] 8600 停机后用 guard cycle offline keep-down 跑全门，日志由脚本内 UTF-8 落盘；读完整结果与 exit，失败查因而非削弱阈值。guard cycle --timeout=1800000，Bash 背景执行等通知不轮询。
- [ ] 门后 guard verify is_clean、浏览器真实原件重入确认，留最终快照/资产还原证据；仅删本人 _tmp_probe 文件，不碰他人 untracked。
- [ ] 写报告，将实现/命令输出/单据锚定/缺口/受控审查结论绑定最终版本；按明确文件路径提交，不 git add -A。
- [ ] 用 git ls-tree 内容级核查无 zip/config/db/data/.superpowers/.bak；按已授权 §12.4 fetch 远端父提交，再以当前 HEAD tree 作子提交并非强推同步。
- [ ] 既有 guard CLI 强制 offline，交付真实服务不能通过它 start。另用本人本地脚本 spawn Node22 server.js，detached/windowsHide/独立 stdout stderr/不改 env，核 /api/me=401、登录和真实详情 200 后给用户 `http://localhost:8600`。

## 自审覆盖

Spec §1/2/13/14/15→全局约束及 Task7；§3/5→Task1/2/4/6；§4/6/8/9→Task3/4；§7→Task2；§10→Task5；§11→Task1/4/5/7；§12→Task6/7。接口形状在所有任务统一，不让后续任务猜属性；唯一服务父表写入及 pinned 变异靶点保持。执行不是分批交付，任务间独立审查不要求用户确认。
