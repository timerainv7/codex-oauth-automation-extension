# OpenAI SUB2API 与 ChatGPT2API 双交付设计

日期：2026-07-23  
状态：已确认，待实现

## 目标

当 OpenAI 来源为 `SUB2API`，且账号交付方式为 `Session` 或 `Agent Identity` 时，提供一个“同时导入 ChatGPT2API”开关。开启后，同一账号先完成既有的 SUB2API 交付，再追加一次 ChatGPT Session 到 ChatGPT2API 的上传。

该功能复用现有 ChatGPT2API 上传器和既有的 SUB2API 交付驱动，不新增远程接口、后台命令或 ChatGPT2API 配置控件。

## 边界

- `OAuth`、其他 OpenAI 来源、Grok 和 Kiro 流程不参与该开关。
- ChatGPT2API 的地址和 Admin Key 仍只在来源切换到 `ChatGPT2API` 时显示和编辑。
- 在 SUB2API 页面不显示 ChatGPT2API 配置、状态行或额外输入框，只显示一个开关。
- 开关关闭时，现有所有步骤、校验和来源行为不变。

## 状态模型

配置保存到目标作用域，而不是侧栏临时状态：

```text
flows.openai.targets.sub2api.chatgpt2apiUploadEnabled: boolean
```

默认值为 `false`。旧配置在 settings schema 归一化时自动得到 `false`，不需要迁移或清理旧字段。扁平侧栏视图使用明确的投影字段 `openaiSub2apiChatgpt2ApiUploadEnabled`，避免与“当前来源就是 ChatGPT2API”这一既有语义混淆。

开关值可以在用户临时切换到 OAuth 或其他来源时保留，但 workflow 与 capability 层均要求以下三个条件同时成立才会启用双交付：

1. flow 为 `openai`；
2. 来源为 `sub2api`；
3. 有效账号交付 route 为 `sub2api-session` 或 `sub2api-agent-identity`。

因此旧状态、直接消息或手工构造的 workflow 参数都无法在不支持的 route 上追加 ChatGPT2API 上传。

## Workflow

OpenAI workflow 保持“注册阶段 + 支付阶段 + 主账号交付阶段”的组合方式。新增一个受条件保护的附加交付阶段：

```text
注册成功
  -> SUB2API Session / Agent Identity 导入
  -> ChatGPT2API Session 上传（仅开关开启）
```

ChatGPT2API 上传步骤复用 `openai-upload-session-to-chatgpt2api` 和既有 publisher。它追加在主 SUB2API 交付之后，使用户选择的主目标优先完成；附加上传失败会使该轮任务在该节点失败，但不会回滚已经成功的 SUB2API 交付。

## Capability 与校验

capability 解析需要同时输出：

- 是否可以显示或编辑该开关；
- 是否实际要求 ChatGPT2API 上传；
- ChatGPT2API 配置是否完整。

自动运行开始前，若双交付实际生效但 ChatGPT2API 地址或 Admin Key 缺失，直接阻止启动并提示配置缺失。正常的 `ChatGPT2API` 来源也保留现有相同校验。

## 侧栏行为

开关所在行由以下条件控制：`openai + sub2api + (session | agent_identity)`。用户修改开关后，侧栏立即重新计算步骤列表、节点状态和按钮可用性，并静默保存。

切换来源或账号交付方式后，侧栏通过 capability 重新渲染；隐藏开关不等同于清除保存值，但也不会让流程额外执行步骤。

## 测试

- schema：默认值、持久化、旧配置归一化和扁平视图投影；
- capability：仅支持的 flow、来源与交付 route 可以启用，错误状态不能绕过；
- workflow：Session 和 Agent Identity 各自追加一个 ChatGPT2API 步骤，OAuth 和其他来源不追加；
- sidepanel：开关可见性、变更后的步骤同步、配置行持续隐藏；
- validation：双交付开启且 ChatGPT2API 配置缺失时不能启动；
- 回归：既有 ChatGPT2API 单目标、SUB2API 单目标和 Grok 双发布测试继续通过。

## 非目标

- 不新增 ChatGPT2API 凭据字段、上传 API 或后台驱动；
- 不把双交付建成新的来源或账号交付方式；
- 不改变已有 ChatGPT2API 来源的独立上传行为；
- 不改动 Plus、PayPal、GPC/Auto 清理的既有边界。
