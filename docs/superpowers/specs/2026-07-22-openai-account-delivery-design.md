# OpenAI 账号交付架构升级设计

> 日期：2026-07-22
> 状态：已确认，实施中
> 适用仓库：FlowPilot

## 1. 背景

升级前 OpenAI flow 把“账号如何交付到目标系统”错误地挂在 Plus 模式下，并使用全局 Plus 专属交付字段。这导致三个本应独立的概念形成了组合状态：

- 注册方式：邮箱或手机号
- 支付方式：PayPal、Hosted、无需支付
- 账号交付方式：OAuth 或当前 ChatGPT 会话导入

由此产生了“支付方式 + 目标 + Session”一类交叉命名的 workflow 变体。新增 Agent Identity 后，如果继续沿用这个结构，新的目标、支付方式和交付方式会继续形成笛卡尔积，配置迁移、侧栏显隐、步骤恢复和自动运行都难以维护。

参考项目 `FlowPilot新功能` 已验证 Agent Identity 的核心协议可行，但原型把它实现成 SUB2API 私有导入字段，并把密钥生成与 OpenAI Agent 注册逻辑放进 `background/sub2api-api.js`。该实现可作为协议样本，不能直接复制到正式项目。

## 2. 目标与非目标

### 2.1 目标

1. 将账号交付从 Plus 中彻底解耦，成为 OpenAI flow 的独立领域能力。
2. 支持三种通用账号交付方式：
   - `oauth`
   - `session`
   - `agent_identity`
3. 按目标保存交付偏好，切换目标后恢复该目标自己的选择。
4. 将 OpenAI workflow 改为“注册阶段 + 可选支付阶段 + 账号交付阶段”的组合模型，删除支付与交付的组合变体。
5. 让 target capability 成为可选交付方式、默认值和 route 的唯一事实源。
6. 复用统一 ChatGPT 会话读取器，移除 CPA/SUB2API 步骤内的重复标签选择与会话读取代码。
7. 将 Agent Identity 的 token 解析、Ed25519 密钥生成和 OpenAI Agent 注册放在独立 OpenAI 模块中。
8. 保持 Plus 当前不可用：UI 继续隐藏，配置和后台入口继续强制关闭；只保留可恢复的支付阶段实现。
9. 为配置、步骤、运行、日志、UI 和文档建立逐阶段自检门禁。

### 2.2 非目标

- 不恢复 Plus 开关。
- 不重写 PayPal、PayPal Hosted 或 `none` 的支付协议实现。
- 不改变 CPA、SUB2API、Codex2API、webchat、ChatGPT2API 的现有远端 API 协议，Agent Identity 新协议除外。
- 不把 Kiro、Grok 的凭据上传强行纳入 OpenAI 的账号交付枚举。
- 不新增第三方依赖。
- 不持久化 ChatGPT accessToken、Agent Identity 私钥或完整 `auth.json`。

## 3. 方案比较

### 3.1 方案 A：沿用 SUB2API 私有导入字段

只给 SUB2API 增加 `oauth / agent_identity`，并在 workflow 末尾替换节点。

优点是初始改动少；缺点是 CPA Session 仍留在 Plus 下，SUB2API 又形成第二套模式字段，UI 和 workflow 会同时存在两套交付概念。该方案拒绝。

### 3.2 方案 B：只把旧 Plus 选择器移出 UI

继续保留全局 Plus 专属交付字段，仅改文案和显隐。

这会把历史耦合从界面移动到配置和后台，无法按目标保存选择，也不能消除 workflow 组合变体。该方案拒绝。

### 3.3 方案 C：按目标注册账号交付能力并组合 workflow

建立通用 `accountDeliveryMode`，由目标注册表声明支持项、默认项和 route；配置按目标保存；workflow 按阶段组合。

该方案需要一次结构迁移，但后续新增目标或交付方式只需扩展注册表、route 和执行器，不再增加支付组合分支。采用此方案。

## 4. 领域模型

OpenAI flow 后续按四个互不代替的维度解析：

| 维度 | 权威来源 | 作用 |
| --- | --- | --- |
| `signupMethod` | `settingsState.flows.openai.signup` | 决定邮箱或手机号注册阶段 |
| `plusModeEnabled` / `plusPaymentMethod` | `settingsState.flows.openai.plus` | 决定是否插入支付阶段；当前强制关闭 |
| `targetId` | `settingsState.flows.openai.selectedTargetId` | 决定交付目标及目标配置 |
| `accountDeliveryMode` | `settingsState.flows.openai.targets.<targetId>` | 决定账号交付 route |

### 4.1 交付方式语义

- `oauth`：通过 OAuth 授权和 localhost callback 在目标系统创建账号。
- `session`：读取当前 ChatGPT 登录会话，由目标发布器转换成目标协议。目标可能上传完整会话，也可能只投影 accessToken；这属于 publisher 的 wire format，不再另造 UI 模式。
- `agent_identity`：读取当前 ChatGPT accessToken，在本地生成 Ed25519 密钥，向 OpenAI 注册 Agent，再把不含原始 accessToken 的 Agent Identity `auth.json` 导入目标系统。

### 4.2 目标能力矩阵

| 目标 | 支持方式 | 默认方式 | UI |
| --- | --- | --- | --- |
| CPA | `oauth`, `session` | `oauth` | 显示选择器 |
| SUB2API | `oauth`, `session`, `agent_identity` | `oauth` | 显示选择器 |
| Codex2API | `oauth` | `oauth` | 隐藏固定选择器 |
| webchat | `session` | `session` | 隐藏固定选择器 |
| ChatGPT2API | `session` | `session` | 隐藏固定选择器，publisher 仍只上传 token |

交付方式不再依赖 Plus，也不因 `signupMethod` 是邮箱或手机号而自动回退。只有目标 capability、贡献模式锁和运行锁可以改变有效值。

## 5. 注册表与能力解析

### 5.1 单一事实源

`flows/openai/index.js` 的 target capability 扩展为：

```js
{
  supportedAccountDeliveryModes: ['oauth', 'session'],
  defaultAccountDeliveryMode: 'oauth',
  accountDeliveryRouteByMode: {
    oauth: 'oauth',
    session: 'cpa-session',
  },
}
```

SUB2API 的 `agent_identity` 映射到 `sub2api-agent-identity`；webchat 和 ChatGPT2API 的 `session` 分别映射到自己的 publisher route。注册表测试必须保证：

1. 默认方式包含在支持列表中。
2. 每个支持方式都有 route。
3. route 在 workflow route registry 中存在。
4. 单一方式目标不显示选择器。

全局交付方式的 ID、标签和说明由新增纯模块 `flows/openai/account-delivery.js` 统一输出。`sidepanel.js`、`background.js` 和 workflow 不再各自维护字符串映射。

### 5.2 capability 输出

`core/flow-kernel/flow-capabilities.js` 输出：

- `requestedAccountDeliveryMode`
- `availableAccountDeliveryModes`
- `effectiveAccountDeliveryMode`
- `effectiveAccountDeliveryRouteId`
- `canShowAccountDeliveryControl`
- `canEditAccountDeliveryMode`

`stepDefinitionOptions` 只携带已经解析的 `targetId`、`accountDeliveryMode` 和 `accountDeliveryRouteId`。workflow 不接受旧策略字段。

贡献模式当前只能走 CPA OAuth。进入贡献模式时，capability 将有效方式锁定为 `oauth`，但不覆盖 CPA 原先保存的偏好；退出贡献模式后恢复原偏好。

自动运行或节点正在执行时，UI 禁止修改交付方式；后台也必须拒绝直接消息绕过，避免在运行中替换尾链。

## 6. 配置模型与迁移

### 6.1 权威配置

```text
settingsState.flows.openai.targets.<targetId>.accountDeliveryMode
```

示例：

```js
{
  settingsState: {
    schemaVersion: 6,
    flows: {
      openai: {
        targets: {
          cpa: { accountDeliveryMode: 'session' },
          sub2api: { accountDeliveryMode: 'agent_identity' },
          codex2api: { accountDeliveryMode: 'oauth' },
          webchat: { accountDeliveryMode: 'session' },
          chatgpt2api: { accountDeliveryMode: 'session' },
        },
      },
    },
  },
}
```

允许在读取视图中提供当前目标的派生字段 `accountDeliveryMode`，便于现有消息和 UI 接线；它不是第二份持久状态。所有保存都必须回写当前目标的嵌套字段。

保存消息必须同时携带显式 `targetId`。后台按消息中的目标写入，不在异步保存结束时重新读取“当前目标”，避免用户快速切换目标时把选择写进错误配置。

### 6.2 迁移优先级

迁移只在 `core/flow-kernel/settings-schema.js` 的纯迁移函数中完成，优先级如下：

1. 已存在的 canonical `targets.<targetId>.accountDeliveryMode`
2. 参考原型遗留的 SUB2API Agent Identity 导入值
3. 旧 Plus 专属交付值
4. 当前目标 capability 默认方式

旧值映射由迁移器常量和专用迁移回归夹具共同锁定：旧 SUB2API/CPA 会话值分别映射到对应 target 的 `session`，原型 Agent Identity 值映射到 SUB2API `agent_identity`，OAuth 与未知值按 target capability 默认方式归一。

迁移要求：

- schema 版本从 5 升到 6。
- 旧字段只能由迁移器读取一次，不能被运行源码继续消费。
- 写入 canonical `settingsState` 成功后，从平铺 storage 删除所有旧 Plus 交付字段和原型私有导入字段。
- 重写 `settingsState` 时移除 Plus 命名空间和 target 内的全部旧交付字段。
- 导入配置执行相同迁移；导出只包含 canonical 字段。
- Plus 配置只保留当前 dormant 支付字段，`plusModeEnabled` 继续强制为 `false`。
- 旧序列化值只允许出现在迁移器常量和迁移回归测试夹具中。

## 7. Workflow 组合模型

### 7.1 阶段结构

`flows/openai/workflow.js` 不再通过支付和交付组合名选择完整变体，而是组合三个阶段：

```text
registration stage
  -> optional payment stage
  -> account delivery stage
```

1. 注册阶段根据 `signupMethod` 和现有手机号重登设置选择节点，并以 `wait-registration-success` 作为稳定边界。
2. 支付阶段只有在经过 capability 校验的 Plus 真正启用时插入；当前运行入口永远为空阶段。
3. 交付阶段只根据 `effectiveAccountDeliveryRouteId` 选择 route。
4. 最后统一重排 `displayOrder`，节点 ID 保持稳定。

### 7.2 交付 route

| route ID | 节点 |
| --- | --- |
| `oauth` | `oauth-login -> fetch-login-code -> 按注册方式解析的手机号/绑定邮箱节点 -> confirm-oauth -> platform-verify` |
| `cpa-session` | `cpa-session-import` |
| `sub2api-session` | `sub2api-session-import` |
| `sub2api-agent-identity` | `sub2api-agent-identity-import` |
| `webchat-session` | `openai-upload-session-to-webchat` |
| `chatgpt2api-session` | `openai-upload-session-to-chatgpt2api` |

删除所有支付方式、目标与 Session 交叉命名的组合变体。支付 route 与交付 route 彼此不知道对方的具体类型。

### 7.3 状态与恢复

- `nodeStatuses` 继续是步骤完成状态的唯一权威来源，不新增平行的“交付状态机”。
- 切换目标或交付方式时，保留仍存在的注册节点状态，删除旧交付 route 的节点状态，新 route 节点初始化为 `pending`。
- 运行中禁止切换，因此不会迁移 `running` 节点。
- 最终成功节点通过 workflow engine 的最终节点解析，不再维护“Plus 最终步骤”硬编码表。
- OAuth 重试只作用于标记为 OAuth retry group 的节点；Session 和 Agent Identity 失败不应被自动误拉回 `oauth-login`。
- 手动执行、手动跳过、自动执行、完成信号、保存进度和执行范围都消费同一份组合 workflow。
- `stepExecutionRangeByFlow` 继续按当前可见顺序生效；workflow 变短时运行视图钳制到实际节点数，不破坏用户切回较长 workflow 后的原设置。

## 8. 通用 ChatGPT 会话读取

### 8.1 内容脚本协议

新增只读内容脚本 `flows/openai/content/chatgpt-session.js`，只负责：

1. 请求当前页面 `/api/auth/session`。
2. 返回 `session` 和 `accessToken`。
3. 响应通用消息 `OPENAI_SESSION_GET_CURRENT`。

它不加载操作延迟模块，不包含 checkout DOM、支付方式或地址逻辑。

`flows/openai/index.js` 同时注册 `openai-session` runtime source 与对应 driver。来源匹配必须保证 `/checkout/*` 仍由更具体的 `plus-checkout` 接管，普通 ChatGPT 页面才归到 `openai-session`；定向测试覆盖同域 source 的匹配优先级。

`PLUS_CHECKOUT_GET_STATE` 只允许继续服务 dormant Plus checkout 状态读取。所有非支付调用迁移到通用协议，运行源码中的 session reader、CPA/SUB2API 导入和两个远程 publisher 不再引用 Plus 命名。

### 8.2 后台读取器

保留并重构 `flows/openai/background/session-reader.js`：

- source 改为通用 `openai-session`。
- 存在 `automationWindowId` 时，只能在该窗口内选择已登记或活动的 ChatGPT 标签页，不允许跨窗口回退；没有窗口锁时，才按当前窗口和既有 host 优先级做兼容回退。
- 统一完成页面等待、内容脚本注入、消息发送、结果校验和错误文案。
- CPA Session、SUB2API Session、Agent Identity、webchat 和 ChatGPT2API 全部依赖该读取器。

读取器接受调用方声明的必需字段，不把所有发布器强制成同一种会话契约：

- CPA Session、SUB2API Session 和 webchat 请求完整 `session`。
- Agent Identity 和 ChatGPT2API 显式要求 `accessToken`。
- 返回对象可以同时包含 `session` 与 `accessToken`，但缺少调用方要求字段时必须继续等待或明确失败。

会话就绪采用有界重试：首次读取前等待 1 秒，未就绪时每 2 秒重试一次，最多读取 11 次。只有“session 尚未就绪”或“accessToken 尚未就绪”属于可重试状态；用户 Stop、标签页关闭、URL 不受支持、配置错误、脚本注入失败和消息协议错误立即失败。调用方不得在读取器外再包一层无条件整步重试。

`cpa-session-import.js` 和 `sub2api-session-import.js` 删除各自复制的 URL 判断、标签选择、注入和 session 读取实现，只保留“读会话 -> 调目标 API -> 完成节点”的编排。

## 9. Agent Identity 模块

### 9.1 模块边界

新增 `flows/openai/background/agent-identity.js`，负责：

- 解析 ChatGPT accessToken claims。
- 校验 `account_id`、`user_id` 等必要字段。
- 用 Web Crypto 生成 Ed25519 密钥对。
- 把 public key 编码为 OpenSSH `ssh-ed25519` 格式。
- 调用 `https://auth.openai.com/api/accounts/v1/agent/register`。
- 生成 Agent Identity `auth.json` 对象。

新增 `flows/openai/background/steps/sub2api-agent-identity-import.js`，负责：

1. 通过通用 session reader 获取 accessToken。
2. 调用 Agent Identity 模块生成 `auth.json`。
3. 调用 SUB2API API 模块导入该对象。
4. 写入结构化日志并完成节点。

`background/sub2api-api.js` 只负责登录、分组、代理和 `/api/v1/admin/accounts/import/codex-session` 协议。它可以接收已经构造好的 `auth.json`，但不得生成密钥、解析 OpenAI claims 或调用 OpenAI Agent 注册接口。

SUB2API 的登录、目标分组解析和代理解析必须在生成密钥、调用 OpenAI Agent 注册之前完成预检。Session 与 Agent Identity 共用同一个 SUB2API 导入载荷构造器、warnings 归一化、成功/失败计数和响应解析器，避免两个执行器逐渐形成不同协议。

### 9.2 协议数据流

```text
ChatGPT /api/auth/session
  -> accessToken（内存）
  -> 解析 claims
  -> 本地生成 Ed25519 key pair
  -> OpenAI agent/register（Bearer accessToken + public key）
  -> agent_runtime_id
  -> 生成 Agent Identity auth.json（含 private key，不含 accessToken）
  -> SUB2API codex-session import
```

OpenAI Agent 注册请求体固定为：

```js
{
  abom: {
    agent_version: AGENT_VERSION,
    agent_harness_id: 'codex-cli',
    running_location: 'local',
  },
  agent_public_key: '<OpenSSH ssh-ed25519 public key>',
}
```

`AGENT_VERSION` 第一版使用已验证协议值 `0.138.0-alpha.6`，只在 Agent Identity 模块中定义一次，后续协议升级不得在执行器或 SUB2API 模块复制版本字符串。

生成的对象结构固定为：

```js
{
  auth_mode: 'agent_identity',
  agent_identity: {
    agent_runtime_id: '<OpenAI response>',
    agent_private_key: '<Base64 PKCS#8 private key>',
    account_id: '<chatgpt_account_id>',
    chatgpt_user_id: '<chatgpt_user_id | user_id | sub>',
    email: '<profile email | session email>',
    plan_type: '<chatgpt_plan_type | free>',
    chatgpt_account_is_fedramp: false,
  },
}
```

SUB2API API 模块把该对象 `JSON.stringify` 后放入既有 `content` 字段，并继续复用 `group_ids`、`name`、`priority`、`proxy_id`、`auto_pause_on_expired` 和 `update_existing` 规则；Agent Identity 没有可靠会话过期时间时不构造 `expires_at`。

### 9.3 安全约束

- accessToken 只存在于当前执行内存和发往 OpenAI 的 Authorization header。
- 提交给 SUB2API 的内容不得包含原始 accessToken。
- 私钥和完整 `auth.json` 不写入 `chrome.storage`、日志、错误文本或完成状态。
- 日志只允许记录阶段、目标、计数和脱敏错误。
- OpenAI 或 SUB2API 响应错误在展示前必须经过现有错误归一化，不能拼出请求头或 payload。
- Agent Identity 模式失败时不得静默降级为 Session，以免意外发送 accessToken。
- Web Crypto 或 Ed25519 不可用时输出明确错误并停止当前节点。
- 每个异步边界前后继续执行 Stop 检查；不可中断的密钥生成结束后立即再次检查。
- OpenAI Agent 注册是不可逆边界。注册成功后，后续 SUB2API 导入若发生可重试错误，只能复用当前执行内存中的同一份 `auth.json`，不得重新生成密钥或重新注册 Agent。
- 禁止对 Agent Identity 整个步骤做无条件自动重试；否则网络抖动会生成孤立 Agent。重试策略必须按“注册前”和“注册后”分界，并由步骤内部显式控制。
- `agent_identity` 对应的方法、Web Crypto 能力或目标 route 不存在时必须立即失败，绝不能回退到 `session`。

## 10. Sidepanel 设计

### 10.1 布局与显隐

- 将“账号接入方式”移出 `openai-plus` 设置组，放在 OpenAI 来源选择之后、目标凭据配置之前。
- CPA 和 SUB2API 显示选择器。
- Codex2API、webchat、ChatGPT2API 因只有一个有效方式而隐藏选择器。
- Plus 开关和支付配置继续隐藏。
- 贡献模式隐藏交付选择器并由 capability 锁定 OAuth。

### 10.2 UI 模块边界

新增 `sidepanel/account-delivery-control.js`，负责：

- 根据 capability 输出生成 `<option>`。
- 渲染当前方式和说明。
- 处理禁用、隐藏和 change 事件。
- 把选择变化交给 sidepanel 现有设置保存入口。

该模块不读取 storage、不决定目标支持项、不构造 workflow。`sidepanel.js` 只负责提供状态、调用渲染和接收变更回调，不再出现 CPA/SUB2API 的交付方式映射或说明分支。

## 11. 错误、日志与敏感数据

统一错误边界：

- 配置中的未知模式：迁移或归一化到目标默认值，不进入执行器。
- 运行中直接消息切换模式：拒绝并保留当前 workflow。
- 找不到 ChatGPT 标签页：提示先打开已登录页面，并包含当前可见步骤。
- session 或 accessToken 缺失：在调用目标 API 前失败。
- Agent 注册失败：保留 HTTP 状态和脱敏服务端消息，不输出 token。
- SUB2API 导入失败：复用标准导入结果计数和错误归一化。
- Stop：原样向上抛出，不包装为普通业务失败。

日志继续使用 `{ step, stepKey }`。新增 Agent Identity 节点固定使用 `stepKey = sub2api-agent-identity-import`，日志正文不承担步骤识别。

## 12. 分阶段开发与自检门禁

所有代码阶段共用以下提交门禁：修改过的 JavaScript 全部执行 `node --check`，运行本阶段定向测试和完整 `npm test`，严格 UTF-8 解码并扫描可见乱码，执行 `git diff --check`，最后确认 `git status --short` 没有混入无关文件。任一项失败都不能提交该阶段。

### 阶段 0：设计规范

- 写入当前设计并同步文件结构索引。
- 检查无未完成占位标记、互相矛盾的默认值和未定义 route。
- 用 UTF-8 读取新增/修改文档，检查 Unicode 替换字符、错码和可见乱码。
- 运行 `git diff --check`。
- 单独提交设计文档阶段。

### 阶段 1：账号交付领域注册表

- 先写失败测试，覆盖 mode 定义、目标矩阵、默认方式和 route 完整性。
- 新增 `flows/openai/account-delivery.js`，在 OpenAI target capability 中声明完整交付元数据。
- 该阶段只增加纯定义和解析能力，不改持久配置、不切换 workflow、不暴露 UI。
- 阶段通过后提交。

### 阶段 2：通用 session 协议与读取器收敛

- 先写通用 session 内容脚本、source 匹配、窗口锁和 session reader 失败测试。
- 新增通用 ChatGPT session 内容脚本，重构 CPA/SUB2API Session 和两个远程 publisher。
- 删除非支付代码中的 Plus source/message 命名与重复会话读取实现。
- 定向 `rg` 检查非支付代码无 `PLUS_CHECKOUT_GET_STATE`、`PLUS_CHECKOUT_SOURCE`。
- 阶段通过后提交。

### 阶段 3：Agent Identity 协议模块

- 先写 Agent Identity 模块、步骤和 SUB2API 导入契约失败测试。
- 实现独立 OpenAI Agent 协议模块和 SUB2API 编排步骤。
- 用 fake crypto/fetch 精确验证 OpenSSH public key 编码、PKCS#8 Base64、claims、register payload、Agent 注册响应和 auth JSON。
- 断言发往 SUB2API 的序列化内容不包含 accessToken，日志和持久状态不含 token/私钥。
- 验证 Stop、超时、Ed25519 不支持和远端错误分支。
- 验证 SUB2API 预检发生在 Agent 注册之前；注册后的导入重试复用同一份内存 `auth.json`，且不会第二次注册 Agent。
- 该阶段先完成独立模块、SUB2API 通用导入接口和步骤测试，不注册可运行 route。
- 阶段通过后提交。

### 阶段 4：Schema、workflow 与后台原子切换

- 先写 schema v6、旧字段迁移、导入导出、storage 清理、workflow 组合矩阵和后台执行器失败测试。
- 在同一阶段切换 settings schema、capability 输出、三阶段 workflow builder、执行器注册和消息防绕过，避免新配置指向尚未存在的 route。
- 接通 CPA/SUB2API Session 与 SUB2API Agent Identity，删除支付 × 交付组合变体和旧 workflow 选择逻辑。
- UI 仍不开放新选择器；阶段结束时后台和迁移链路已经完整可执行。
- 检查运行源码不再根据旧配置字段选择 workflow，旧值只留在迁移器和迁移测试。
- 阶段通过后提交。

### 阶段 5：Sidepanel 开放与跨目标回归

- 先写 UI、显式 `targetId` 保存、运行锁和后台状态更新失败测试。
- 新增独立 account delivery control，移出 Plus 设置组；到此阶段才向用户开放选择器。
- 验证目标切换能恢复各自偏好、单选目标隐藏、贡献/运行锁不可绕过、后台状态更新不会错误重显。
- 覆盖自动/手动执行、跳过、完成信号、进度、执行范围、OAuth retry group、模式切换后的状态迁移和最终成功记录。
- 保留并运行 CPA/SUB2API OAuth、CPA/SUB2API Session、SUB2API Agent Identity、Codex2API、webchat、ChatGPT2API 与普通注册链路测试。
- 确认 `background.js` 只新增 importScripts、依赖注入和执行器注册，没有新增领域实现。
- 检查 HTML、JS、静态国际化和脚本加载顺序。
- 阶段通过后提交。

### 阶段 6：清理、文档与最终验收

- 删除失效 Plus 交付文案、旧测试和旧组合变体。
- 更新 README、使用教程、文件结构、完整链路和架构边界文档。
- 定向 `rg` 检查旧运行标识、旧域模型和 Agent Identity 敏感字段。
- 对全部修改 JS 执行 `node --check`。
- 运行 `git diff --check` 和完整 `npm test`，要求零失败。
- 检查 `git status --short` 只包含本任务内容，再提交最终文档收口。

## 13. 验收标准

1. Plus 关闭时，CPA/SUB2API 仍可选择并执行 Session；SUB2API 可选择并执行 Agent Identity。
2. 交付方式按目标独立保存，切换目标不会互相覆盖。
3. 手机号和邮箱注册都不会因交付方式被无依据回退。
4. workflow 中不存在支付 × 交付组合变体。
5. Codex2API、webchat、ChatGPT2API 使用固定 route 且不显示无意义选择器。
6. Agent Identity 导入 payload 不含原始 accessToken，敏感内容不落 storage 和日志。
7. 旧配置可无损迁移，迁移后 storage 不再保留旧字段。
8. 直接消息、导入配置和旧状态不能绕过 capability 产生不支持的 mode/route。
9. 自动、手动、恢复、跳过、完成、日志和执行范围都以同一组合 workflow 为准。
10. 运行源码和正式文档不再把账号交付描述成 Plus 专属能力。
11. 所有定向测试与完整 `npm test` 通过，`node --check`、乱码检查和 `git diff --check` 通过。

## 14. 回滚策略

每个阶段独立提交，使用 `git revert <阶段提交>` 回滚，不覆盖后续用户改动。配置迁移提交回滚时仍需保留对 schema v6 的读取兼容，不能把已经写入的 canonical `accountDeliveryMode` 当成未知字段丢弃；因此一旦 schema v6 发布，回滚应优先做前向兼容修复，而不是降回只认识旧 Plus 字段的版本。
