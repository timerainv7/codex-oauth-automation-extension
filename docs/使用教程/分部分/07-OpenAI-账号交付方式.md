# 第七部分：OpenAI 账号交付方式

## 部分信息

- `section_slug`: `openai-account-delivery`
- `适用主题`: `CPA`、`SUB2API`、`OAuth`、`ChatGPT Session`、`Agent Identity`
- `维护方式`: `直接更新本文件`

## 适用场景

本部分说明扩展中 OpenAI 注册完成后，如何选择账号交付到目标平台。账号交付是 OpenAI flow 的独立能力，不依赖 Plus 开关。

当前支持矩阵：

| 目标 | 可选方式 |
| --- | --- |
| `CPA` | `OAuth`、`ChatGPT Session` |
| `SUB2API` | `OAuth`、`ChatGPT Session`、`Agent Identity` |
| `Codex2API` | 固定 `OAuth` |
| `webchat` | 固定 `ChatGPT Session` |
| `ChatGPT2API` | 固定 `ChatGPT Session` |

## 准备内容

- 已加载本地扩展，并能打开侧边栏。
- 已配置当前目标需要的管理地址、账号、密钥、分组或代理。
- 使用 `ChatGPT Session` 或 `Agent Identity` 时，浏览器中必须有已登录的 ChatGPT 页面。
- 使用 `Agent Identity` 时，SUB2API 的登录、分组和代理配置必须先能通过预检。

## 操作步骤

### 第一步：选择 flow 和目标

打开侧边栏，在顶部选择：

1. `注册`：选择 `Codex / OpenAI`。
2. `来源`：选择 `CPA`、`SUB2API`、`Codex2API`、`webchat` 或 `ChatGPT2API`。

选择来源后，扩展会根据目标能力显示或隐藏 `账号交付` 控件。只有支持多种方式的目标才会显示下拉框。

### 第二步：选择交付方式

- `OAuth`：注册完成后打开授权页，完成登录、验证码、同意页和目标平台回调。
- `ChatGPT Session`：注册完成后读取当前 ChatGPT 登录会话，直接导入或上传，不经过 OAuth 回调。
- `Agent Identity`：仅 `SUB2API` 可选。扩展会先检查 SUB2API 配置，再生成本地 Agent 身份并导入。

方式会按目标分别保存。先在 `CPA` 选择的方式不会覆盖 `SUB2API` 的选择；切换回目标时会恢复上次保存的值。

### 第三步：运行注册流程

先用手动按钮验证前几步，再使用 `Auto` 完成整条链路。手动执行、自动执行、跳过节点和执行范围限制都会使用同一份 workflow，因此交付方式不会在中途被另一套步骤覆盖。

运行期间或设置被锁定时，账号交付控件会暂时禁用。保存完成后，步骤列表会按新的 route 重建；如果保存失败，扩展会恢复之前的目标偏好。

### 第四步：确认结果

- OAuth 成功后，日志会显示目标平台创建或绑定成功。
- ChatGPT Session 成功后，日志会显示会话导入或远程上传完成。
- Agent Identity 成功后，日志只显示脱敏结果和导入计数，不显示 access token、私钥或完整 `auth.json`。

## 安全与边界

- Session reader 只在启动时锁定的自动化窗口中查找候选 ChatGPT 标签页，避免误读其他浏览器窗口。
- Agent Identity 的私钥和完整认证载荷只在内存中使用；不会写入扩展设置、运行记录或普通日志。
- Agent Identity 预检或导入失败时不会静默降级到 ChatGPT Session。
- Plus 当前暂时不可用，侧边栏没有 Plus 开关或支付入口。PayPal、Hosted 和免支付实现只是后台 dormant 代码，不影响账号交付选择。

## 常见问题

### 为什么没有看到账号交付下拉框？

当前目标只有一种有效方式时，扩展会隐藏选择器。例如 `Codex2API` 固定使用 OAuth，`webchat` 和 `ChatGPT2API` 固定使用 ChatGPT Session。

### 为什么切换来源后方式变回去了？

方式按 target 独立保存。请切回原 target 查看其偏好；运行期间的切换会被锁定，避免改变当前 workflow。

### Agent Identity 为什么需要当前 ChatGPT 页面？

扩展需要读取当前会话中的 access token，并在本地生成 Agent 身份。该 token 只用于本次内存协议，不会作为明文写入目标导入载荷或日志。
