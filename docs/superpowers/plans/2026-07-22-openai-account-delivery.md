# OpenAI Account Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenAI 账号交付从 Plus 支付模式中解耦，按目标支持 OAuth、ChatGPT Session 和 SUB2API Agent Identity，并保持 Plus 当前不可用。

**Architecture:** `flows/openai/account-delivery.js` 定义交付方式元数据，OpenAI target capability 定义目标支持矩阵，settings schema 保存每个目标的选择，flow capability 解析唯一有效 route，workflow 只组合注册、可选支付和交付三段。ChatGPT 会话读取和 Agent Identity 协议分别下沉到独立 OpenAI 模块，`background.js` 与 `sidepanel.js` 只保留装配。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript IIFE 模块、Web Crypto Ed25519、Node.js `node:test`。

---

## 文件结构

新增文件：

- `flows/openai/account-delivery.js`：交付方式 ID、标签、说明与归一化纯模块。
- `flows/openai/content/chatgpt-session.js`：只读 `/api/auth/session` 内容脚本和通用消息协议。
- `flows/openai/background/agent-identity.js`：claims、Ed25519、OpenSSH、Agent 注册和 `auth.json` 构造。
- `flows/openai/background/steps/sub2api-agent-identity-import.js`：Agent Identity 交付步骤编排。
- `sidepanel/account-delivery-control.js`：交付方式选择器的纯 UI 控制器。
- `tests/openai-account-delivery.test.js`、`tests/openai-chatgpt-session-content.test.js`、`tests/background-openai-agent-identity.test.js`、`tests/sidepanel-account-delivery-control.test.js`：新增领域回归测试。

主要修改文件：

- `flows/openai/index.js`：target capability、runtime source、driver、设置组。
- `core/flow-kernel/source-registry.js`：重叠 source 的显式检测优先级。
- `core/flow-kernel/settings-schema.js`：schema v6、按目标保存、旧字段迁移与清理。
- `core/flow-kernel/flow-capabilities.js`：请求方式、有效方式、route、显隐和运行锁。
- `flows/openai/workflow.js`：三阶段组合与交付 route registry。
- `flows/openai/background/session-reader.js`：通用 source、窗口锁、字段契约和有界就绪重试。
- `background/sub2api-api.js`：共享预检和 codex-session 导入契约。
- `flows/openai/background/steps/cpa-session-import.js`、`flows/openai/background/steps/sub2api-session-import.js`、两个 OpenAI publisher：统一依赖 session reader。
- `background.js`：脚本加载、依赖注入、执行器注册和旧字段清除。
- `sidepanel/sidepanel.html`、`sidepanel/sidepanel.js`、`sidepanel/i18n-static.js`：控件装配、显式 target 保存和状态同步。
- `tests/helpers/script-bundles.js` 及已有相关测试：装载新增模块并替换旧 Plus 断言。
- `项目文件结构说明.md`、`项目完整链路说明.md`、`项目开发规范（AI协作）.md`、`README.md` 和使用教程：同步正式架构。

## 阶段通用门禁

每个阶段提交前执行：

```powershell
node --check <本阶段每个修改过的 JavaScript 文件>
node --test <本阶段定向测试文件>
npm test
git diff --check
```

UTF-8 检查使用抛出异常的严格解码读取本阶段修改文件，并用不会在检查命令自身中形成样例文本的分段正则搜索 Unicode replacement character 与常见错码组合。最后用 `git status --short` 确认没有无关文件，再以中文提交信息提交。

### Task 0: 固化规格与实施计划

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-openai-account-delivery-design.md`
- Create: `docs/superpowers/plans/2026-07-22-openai-account-delivery.md`

- [x] **Step 1: 写入 PR #307 的安全约束**

规格必须明确：session reader 支持 `requiredFields`；首次等待 1 秒、间隔 2 秒、最多 11 次；只重试未就绪；SUB2API 预检先于 Agent 注册；注册后的导入重试复用同一内存 `auth.json`；不得整步重试或回退 Session。

- [x] **Step 2: 运行文档自检**

```powershell
rg -n "T[B]D|T[O]DO|implement[ ]later|fill[ ]in[ ]details" docs/superpowers/specs/2026-07-22-openai-account-delivery-design.md docs/superpowers/plans/2026-07-22-openai-account-delivery.md
git diff --check
npm test
```

预期：占位符搜索无输出，diff 检查和完整测试退出码均为 0。

- [x] **Step 3: 提交阶段 0**

```powershell
git add docs/superpowers/specs/2026-07-22-openai-account-delivery-design.md docs/superpowers/plans/2026-07-22-openai-account-delivery.md
git commit -m "docs: 补充 OpenAI 账号交付实施计划"
```

### Task 1: 建立账号交付注册表与 capability

**Files:**
- Create: `flows/openai/account-delivery.js`
- Create: `tests/openai-account-delivery.test.js`
- Modify: `flows/openai/index.js`
- Modify: `core/flow-kernel/flow-capabilities.js`
- Modify: `tests/helpers/script-bundles.js`
- Modify: `tests/flow-capabilities-module.test.js`
- Modify: `tests/flow-registry-settings-schema.test.js`
- Modify: `background.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `项目文件结构说明.md`

- [x] **Step 1: 写交付注册表失败测试并确认 RED**

测试期待以下公开接口：

```js
const {
  ACCOUNT_DELIVERY_MODE_OAUTH,
  ACCOUNT_DELIVERY_MODE_SESSION,
  ACCOUNT_DELIVERY_MODE_AGENT_IDENTITY,
  getAccountDeliveryModeDefinition,
  getAccountDeliveryModeOptions,
  normalizeAccountDeliveryMode,
} = scope.MultiPageOpenAiAccountDelivery;
```

断言模式顺序为 `oauth / session / agent_identity`，未知值按显式 fallback 归一；CPA、SUB2API、Codex2API、webchat、ChatGPT2API 的默认方式属于支持列表且每个方式都有 route。

```powershell
node --test tests/openai-account-delivery.test.js tests/flow-capabilities-module.test.js tests/flow-registry-settings-schema.test.js
```

预期：因模块和通用 capability 字段不存在而失败。

- [x] **Step 2: 实现模式模块和目标矩阵**

`flows/openai/account-delivery.js` 输出冻结定义：

```js
{
  oauth: { id: 'oauth', label: 'OAuth', description: '通过目标平台 OAuth 授权交付账号' },
  session: { id: 'session', label: 'ChatGPT Session', description: '读取当前 ChatGPT 登录会话并导入目标平台' },
  agent_identity: { id: 'agent_identity', label: 'Agent Identity', description: '注册本地 Agent Identity 后导入目标平台' },
}
```

OpenAI target capability 写入设计中的支持列表、默认值与 route；旧 Plus 交付兼容字段仅在阶段 4 的迁移边界读取，不再作为新能力的事实源。`flow-capabilities.js` 输出 `requestedAccountDeliveryMode`、`availableAccountDeliveryModes`、`effectiveAccountDeliveryMode`、`effectiveAccountDeliveryRouteId`、`canShowAccountDeliveryControl` 和 `canEditAccountDeliveryMode`；贡献模式固定 OAuth，运行或设置锁使控件不可编辑但不覆盖保存值。

- [x] **Step 3: 验证 GREEN 与阶段门禁**

运行定向测试、全部修改 JS 的 `node --check`、完整 `npm test`、乱码检查和 `git diff --check`。

- [x] **Step 4: 提交阶段 1**

```powershell
git commit -m "feat: 建立 OpenAI 账号交付能力模型"
```

### Task 2: 建立通用 ChatGPT session 协议

**Files:**
- Create: `flows/openai/content/chatgpt-session.js`
- Create: `tests/openai-chatgpt-session-content.test.js`
- Modify: `flows/openai/index.js`
- Modify: `core/flow-kernel/source-registry.js`
- Modify: `flows/openai/background/session-reader.js`
- Modify: `flows/openai/background/steps/cpa-session-import.js`
- Modify: `flows/openai/background/steps/sub2api-session-import.js`
- Modify: `flows/openai/background/publisher-webchat.js`
- Modify: `flows/openai/background/publisher-chatgpt2api.js`
- Modify: `tests/source-registry-module.test.js`
- Modify: `tests/background-openai-session-reader.test.js`
- Modify: `tests/background-cpa-session-import.test.js`
- Modify: `tests/background-sub2api-session-import.test.js`
- Modify: `tests/background-openai-publisher-webchat.test.js`
- Modify: `tests/background-openai-publisher-chatgpt2api.test.js`
- Modify: `background.js`
- Modify: `项目文件结构说明.md`

- [x] **Step 1: 写协议、source 优先级、窗口锁和重试失败测试**

内容脚本只响应：

```js
{ type: 'OPENAI_SESSION_GET_CURRENT', source: 'background' }
```

读取器接口固定为：

```js
reader.readCurrentSessionFromState(state, {
  visibleStep,
  targetLabel,
  requiredFields: ['session'],
});
```

测试覆盖 checkout URL 解析为 `plus-checkout`、普通 ChatGPT URL 解析为 `openai-session`；有 `automationWindowId` 时所有候选标签必须来自该窗口；缺少必需字段时 11 次读取，等待序列为 `1000` 后十次 `2000`；Stop、标签关闭、URL 不支持和协议错误不重试。

- [x] **Step 2: 实现通用内容脚本与显式 source 优先级**

新增 `openai-session` source/driver。`source-registry.js` 按数值 `detectionPriority` 降序检测，未声明时为 0；`plus-checkout` 高于 `openai-session`，避免依赖对象插入顺序。

- [x] **Step 3: 收敛所有调用方**

CPA、SUB2API、webchat 请求 `requiredFields: ['session']`；ChatGPT2API 请求 `requiredFields: ['accessToken']`。各步骤不再自行查询标签、注入脚本或发送 `PLUS_CHECKOUT_GET_STATE`。支付步骤继续保留旧 checkout 消息。

- [x] **Step 4: 验证 GREEN、定向残留与阶段门禁**

```powershell
rg -n "PLUS_CHECKOUT_GET_STATE|PLUS_CHECKOUT_SOURCE" flows/openai/background/session-reader.js flows/openai/background/steps/cpa-session-import.js flows/openai/background/steps/sub2api-session-import.js flows/openai/background/publisher-webchat.js flows/openai/background/publisher-chatgpt2api.js
```

预期无输出；随后执行阶段通用门禁。

- [x] **Step 5: 提交阶段 2**

```powershell
git commit -m "refactor: 统一 OpenAI 会话读取协议"
```

### Task 3: 实现 Agent Identity 与共享 SUB2API 导入边界

**Files:**
- Create: `flows/openai/background/agent-identity.js`
- Create: `flows/openai/background/steps/sub2api-agent-identity-import.js`
- Create: `tests/background-openai-agent-identity.test.js`
- Create: `tests/background-sub2api-agent-identity-import.test.js`
- Modify: `background/sub2api-api.js`
- Modify: `tests/background-sub2api-session-import.test.js`
- Modify: `项目文件结构说明.md`

- [x] **Step 1: 写协议编码和错误边界失败测试**

测试公开纯函数与工厂：

```js
decodeJwtPayload(accessToken)
readOpenAiIdentity(accessToken, session)
encodeSshEd25519PublicKey(rawPublicKey)
createAgentIdentity(accessToken, session, { cryptoImpl, fetchImpl })
```

用固定 32 字节 public key 断言 OpenSSH blob 为 `uint32('ssh-ed25519') + utf8('ssh-ed25519') + uint32(32) + rawKey` 的 Base64；私钥精确等于 PKCS#8 bytes 的 Base64。覆盖 `chatgpt_account_id`、`chatgpt_user_id / user_id / sub` 优先级、缺失 claims、无 Ed25519、非 2xx、无 `agent_runtime_id` 和错误脱敏。

- [x] **Step 2: 写 SUB2API 预检和不可逆边界失败测试**

共享 API 契约固定为：

```js
const prepared = await client.prepareCodexSessionImport(config);
await client.importPreparedCodexAuth(prepared, {
  authJson,
  accountName,
  expiresAt: null,
});
```

断言登录、分组和代理解析全部发生在 `createAgentIdentity` 前；注册成功后的导入可重试时复用同一对象引用和同一个 `agent_runtime_id`，Agent 注册仅调用一次；session 与 agent 两种 auth JSON 使用同一个 payload builder、warnings 和计数解析器。

- [x] **Step 3: 实现独立 Agent Identity 模块和步骤**

`AGENT_VERSION = '0.138.0-alpha.6'` 只存在于 `agent-identity.js`。步骤执行顺序为 Stop 检查、SUB2API 预检、读取 accessToken、生成并注册 Agent、导入同一内存 `authJson`、写脱敏日志、完成节点。不得把 accessToken、私钥或完整 auth JSON 传给 `setState`、日志或错误文本。

- [x] **Step 4: 验证 GREEN、敏感数据扫描与阶段门禁**

```powershell
rg -n "0\.138\.0-alpha\.6|agent_private_key|Authorization.*Bearer" flows/openai/background background/sub2api-api.js
```

确认版本常量唯一，敏感字段仅存在于协议构造/序列化边界；随后执行阶段通用门禁。

- [x] **Step 5: 提交阶段 3**

```powershell
git commit -m "feat: 实现 SUB2API Agent Identity 交付"
```

### Task 4: 原子切换 schema v6、workflow 与后台装配

**Files:**
- Modify: `core/flow-kernel/settings-schema.js`
- Modify: `core/flow-kernel/flow-capabilities.js`
- Modify: `flows/openai/workflow.js`
- Modify: `data/step-definitions.js`
- Modify: `background.js`
- Modify: `tests/flow-registry-settings-schema.test.js`
- Modify: `tests/background-settings-schema-persistence.test.js`
- Modify: `tests/background-settings-import-mode-validation.test.js`
- Modify: `tests/step-definitions-module.test.js`
- Modify: `tests/background-step-registry.test.js`
- Modify: `tests/background-step-node-registry-module.test.js`
- Rename: `tests/background-message-router-plus-final-step.test.js` -> `tests/background-message-router-final-node.test.js`
- Create: `tests/background-account-delivery-mode.test.js`
- Delete: `tests/background-effective-plus-account-access-strategy.test.js`
- Delete: `tests/plus-account-access-strategy.test.js`
- Modify: `项目文件结构说明.md`

- [x] **Step 1: 写 schema v6 迁移失败测试**

断言 canonical 路径为 `flows.openai.targets.<targetId>.accountDeliveryMode`，优先级为 canonical、原型 Agent Identity 导入值、旧 Plus 交付值、目标默认值。`buildSettingsView()` 只派生当前目标的 `accountDeliveryMode`；输出 schema 6；规范化结果和持久化清理列表不再含旧字段。

- [x] **Step 2: 写 workflow 组合矩阵失败测试**

对邮箱/手机号注册和五个目标逐项断言交付尾链。公开 route registry 包含 `oauth`、`cpa-session`、`sub2api-session`、`sub2api-agent-identity`、`webchat-session`、`chatgpt2api-session`。测试确认导出对象不存在支付方式与交付方式的交叉变体，且所有步骤重新连续编号。

- [x] **Step 3: 实现 schema 和三阶段 workflow**

workflow builder 使用：

```js
const registration = buildRegistrationStage(options);
const payment = buildPaymentStage(options);
const delivery = buildAccountDeliveryStage(options.accountDeliveryRouteId);
return linkAndOrderNodes([...registration, ...payment, ...delivery]);
```

Plus 继续强制关闭，但 dormant payment stage 保留。交付 route 只由 capability 解析结果决定，不读取旧字段或猜测 target。

- [x] **Step 4: 一次性接通后台**

加载 Agent Identity 步骤并注册 `sub2api-agent-identity-import` executor。后台构建步骤只透传 `targetId / accountDeliveryMode / accountDeliveryRouteId`；保存或直接消息在运行锁下拒绝交付方式修改。删除旧策略常量、最终步骤表、执行器选择和恢复分支。

- [x] **Step 5: 验证 GREEN、旧模型残留与阶段门禁**

运行本任务全部定向测试；用 `rg` 确认旧值只出现在 `settings-schema.js` 的迁移常量和迁移测试夹具；随后执行阶段通用门禁。

- [x] **Step 6: 提交阶段 4**

```powershell
git commit -m "refactor: 切换 OpenAI 账号交付组合工作流"
```

### Task 5: 实现独立侧栏控件与跨目标状态回归

**Files:**
- Create: `sidepanel/account-delivery-control.js`
- Create: `tests/sidepanel-account-delivery-control.test.js`
- Modify: `sidepanel/sidepanel.html`
- Modify: `sidepanel/sidepanel.js`
- Modify: `sidepanel/i18n-static.js`
- Modify: `tests/sidepanel-flow-source-registry.test.js`
- Modify: `tests/sidepanel-settings-autosave.test.js`
- Modify: `tests/sidepanel-contribution-mode.test.js`
- Modify: `tests/sidepanel-plus-payment-method.test.js`
- Modify: `tests/background-step-execution-range.test.js`
- Modify: `tests/background-auto-run-module.test.js`
- Modify: `项目文件结构说明.md`

- [x] **Step 1: 写 UI 控制器失败测试**

控制器 API 固定为：

```js
createAccountDeliveryControl({ row, select, caption, onChange })
control.render(capabilityState)
control.destroy()
```

断言 CPA/SUB2API 显示、单一方式目标隐藏；选项来自 capability；运行锁/设置锁/贡献模式禁用或隐藏；change 回调始终携带 `{ targetId, accountDeliveryMode }`。

- [x] **Step 2: 在 HTML 与 sidepanel 装配控件**

账号交付行放在 OpenAI 来源选择之后、目标凭据之前，脚本在 `sidepanel.js` 前加载。`sidepanel.js` 只构造 capability state、调用 `render`、将显式 target/mode 交给现有保存入口；不维护标签、说明或目标矩阵。

- [x] **Step 3: 覆盖跨目标和运行态**

测试 CPA 与 SUB2API 各自恢复偏好；快速切换目标时异步保存仍写入消息携带的 target；后台 `DATA_UPDATED` 不会重显 Plus，也不会把一个目标的 mode 写进另一个目标；手动、自动、跳过、完成、范围钳制和 OAuth retry group 全部消费同一 workflow。

- [x] **Step 4: 验证 GREEN 与阶段门禁**

运行 UI、sidepanel、自动运行、手动运行和完整回归，检查 HTML script 顺序与静态国际化映射，再执行阶段通用门禁。

- [x] **Step 5: 提交阶段 5**

```powershell
git commit -m "feat: 开放按目标配置的账号交付方式"
```

### Task 6: 删除旧模型并完成文档与全量验收

**Files:**
- Modify: `README.md`
- Modify: `使用教程.md`
- Modify: `项目文件结构说明.md`
- Modify: `项目完整链路说明.md`
- Modify: `项目开发规范（AI协作）.md`
- Modify: relevant `md/*.md`

- [x] **Step 1: 删除旧运行模型和失效测试**

运行源码、正式 UI 和正式文档不得保留旧 Plus 交付字段、原型私有导入字段或支付与交付的交叉 workflow 名称。旧序列化值只允许出现在 schema 迁移常量和迁移回归夹具中。

- [x] **Step 2: 更新正式文档**

文档说明账号交付是 OpenAI 通用能力、按目标保存、Plus 当前隐藏且只暂存支付底层；更新新增/删除文件职责、session 读取链、Agent Identity 安全边界、workflow 三阶段模型和维护规则。

- [x] **Step 3: 运行最终静态审计**

```powershell
rg -n "plusAccountAccessStrate[g]y|cpa_codex_sessio[n]|sub2api_codex_sessio[n]|sub2apiImportMod[e]|plusPaypal(Sub2api|Cpa)Session|plusPaypalHosted(Sub2api|Cpa)Session" --glob "!tests/background-account-delivery-mode.test.js" --glob "!core/flow-kernel/settings-schema.js" .
rg -n "accessToken|agent_private_key|authJson" flows/openai/background background.js
git diff --check
```

逐条确认第一条无正式残留，第二条只在允许的内存协议边界出现。

- [x] **Step 4: 运行最终验证**

对全部本任务修改 JS 执行 `node --check`，严格 UTF-8 读取全部修改文件，运行完整 `npm test` 并要求 0 failed，最后复核 `git status --short` 与提交历史。

- [x] **Step 5: 提交阶段 6**

```powershell
git commit -m "docs: 更新 OpenAI 账号交付链路说明"
```

### Task 7: 集成到用户可测试位置

**Files:**
- No production code changes expected

- [x] **Step 1: 使用 finishing-a-development-branch 流程复核**

重新运行完整测试与静态门禁，核对功能分支相对本地 `dev` 的提交和 diff。用户已明确不处理远程，因此不 fetch、不 push、不创建 PR。

- [x] **Step 2: 集成本地分支**

在不覆盖用户改动的前提下，把功能分支提交合并到用户指定的本地测试分支；若正式仓库工作区在此期间出现重叠改动，先报告冲突而不重置或回退。

- [x] **Step 3: 提供手工验收路径**

让用户加载本地扩展后验证 CPA OAuth/Session、SUB2API OAuth/Session/Agent Identity、三个单一方式目标、跨目标偏好恢复、运行锁、Plus 隐藏，以及 Agent Identity 导入结果。
