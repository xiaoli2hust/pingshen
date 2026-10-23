# 铁律（全局） · iron-laws

跨项目、跨会话始终生效的工作铁律插件。**只含一个组件：一条 `alwaysApply: true` 的规则。**

## 它解决什么

Qoder 的规则（`.qoder/rules`）与 `AGENTS.md` 都**只对当前项目生效**（官方文档：docs.qoder.com/zh/user-guide/rules）。
记忆（memory）中除 `user_behavior` / `user_info` 外，其余类别会自动绑定到当前项目，换项目即失效。

因此，要让「铁律」在**所有项目**都强制注入上下文，唯一可靠的文件化机制是：**用户级（User scope）插件 + always-on 规则**。
本插件即为此而做——安装时选择 User 级，即对全部会话生效。

## 规则内容（rules/iron-laws.mdc）

1. **验证优先于声明** — 声称完成/修复/通过前必须实跑验证命令并附真实输出；文件状态断言先实测证伪。
2. **交付物必须可直接执行** — 用户为技术小白，命令须完整可复制粘贴，不假设工具已装，给主路径+备选路径。
3. **不碰全局配置，破坏性操作先说明** — 不改 git 全局配置/环境变量/注册表；删除覆盖类操作先说明再执行。
4. **计算类改动必须命中锚定值** — 金额/比率/判级改动须跑既有回归并逐项命中锚定值；期望值只能源自真实原件。
5. **本机网络事实** — git 全局代理指向未监听的 127.0.0.1:7890、GitHub 绕行方式、公司防火墙 TLS/MITM、Node 18 vs 免安装版 Node 22 路径。

## 安装（必须选 User 级）

1. Qoder IDE 右上角用户图标 → **Qoder IDE 设置**（或 `Ctrl+Shift+,`）→ 左侧 **插件**
2. 右上角 **插件市场** → **+ 创建插件** → **从本地文件夹导入**
3. 选择本目录：`F:\workbuddy\9\iron-laws`
4. 生效范围选 **User 级**（对所有会话生效）；若选 Project 级则只在该项目生效，达不到目的
5. 导入后**新建一个会话**，规则才会注入

## 验证是否生效

新会话中直接问：「你现在受哪些 always-on 规则约束？」
若回答里出现「验证优先于声明」「不碰全局配置」等条目，即已生效。

## 组件构成

| 组件 | 是否包含 | 说明 |
| --- | --- | --- |
| rules | ✅ | `rules/iron-laws.mdc`，`alwaysApply: true` |
| skills | ❌ | 本插件不提供可调用的技能，只提供约束 |
| agents / commands / hooks / mcp | ❌ | 均不需要 |
| logo | ❌ | 未声明，manifest 中不含 `logo` 字段 |

## 来源与说明

- **来源**：本地原创，无外部上游。规则条目提炼自用户在 review-platform 项目中反复声明的工作要求，以及本机实测确认的环境事实（git 代理配置、端口监听状态、Node 版本、GitHub 可达性）。
- **格式依据**：`.mdc` frontmatter 采用 `description` + `alwaysApply` 两字段，与 Qoder 官方插件（firecrawl 的 `rules/install.mdc`）实测格式一致；插件根 `rules/` 目录由 Qoder 自动发现。
- **manifest 依据**：`.qoder-plugin/plugin.json` 仅声明实际存在的 `rules` 组件，未声明任何不存在的组件。
- **字符预算**：规则正文约 1.4K 字符，远低于官方 100,000 字符的活跃规则上限。
- **优先级**：官方文档明确「AGENTS.md 与规则冲突时，规则优先」，故本插件的约束强于项目内 AGENTS.md。
- **未包含**：无 `skills/` 目录。若后续需要把某条铁律升级为可调用流程，再补 `skills/` 并在 manifest 中声明。

## 维护

改铁律只需编辑 `rules/iron-laws.mdc`，保存后新会话生效，无需重新导入。
