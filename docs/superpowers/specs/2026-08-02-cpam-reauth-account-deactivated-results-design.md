# CPAM ReAuth：停用账号识别与结果汇总

## 目标

在 CPAM ReAuth 的 OAuth 登录链路中识别 OpenAI 的 `account_deactivated` 页面，将该账户明确记录为失败并继续队列；任务结束后在侧栏完整展示成功、失败、跳过数量及明细。

## 范围

- 仅影响 CPAM ReAuth 队列，不改变普通手动或自动注册流程的重试策略。
- 在密码页提交后和 `https://auth.openai.com/email-verification` 验证码提交后，都识别以下明确停用信号：`account_deactivated`、英文“account has been deleted or deactivated”、中文“账户已被删除或停用”。
- 账号完整邮箱在结果明细中显示。CPAM Access Token、OAuth 回调 URL 和其他敏感数据不得出现在结果、日志或错误消息中。

## 数据流

1. OAuth 登录链路在每次认证页面状态确认后检查当前页面正文与错误元数据；这至少覆盖密码页提交和 `email-verification` 验证码提交后的页面。
2. 发现停用信号时，抛出可识别错误 `ACCOUNT_DEACTIVATED`，其用户原因固定为“账号已被删除或停用（account_deactivated）”。
3. CPAM ReAuth 控制器捕获该错误，将当前项目标记为 `failed`：
   - `step`: 发现页面的实际节点（密码页为 `oauth-login`，邮箱验证码阶段为 `fetch-login-code`）
   - `error`: 固定的用户原因
   - 原始失败节点仍适用于其他 OAuth 节点错误。
4. 控制器继续下一条候选账户；每次状态变更都持久化到 `reauthRuntime` 并广播。
5. 任务的 `completed`、`stopped` 或 `failed` 终态均保留已收集的项目明细。

## 结果模型

每个 ReAuth 项目保留 `email`、`status`、`error` 和可选 `step`。状态含义：

- `succeeded`：OAuth 到 CPA 回调验证完成。
- `failed`：该账号的 Cookie 清理或 OAuth 节点执行失败；记录失败步骤和原因。
- `skipped`：候选提取时的重复项或无效邮箱，或用户停止后未执行的项目；记录跳过原因。

现有运行摘要继续持有 `queued`、`succeeded`、`failed`、`skipped` 和 `items`，无需另建存储。

## 侧栏

CPAM ReAuth 卡片的现有摘要在终态显示总数，并在其下显示“本次结果”区域：

- 汇总：成功 X 个、失败 Y 个、跳过 Z 个。
- 失败列表：完整邮箱、失败步骤的人类可读标签、原因。
- 跳过列表：完整邮箱（可用时）和原因。
- 没有失败或跳过项时不显示对应空列表。
- 运行中仅显示进度计数，不渲染终态明细，以避免不断抖动。

## 错误与停止

- `account_deactivated` 是账号级终态失败，不论发现于密码页还是邮箱验证码页，都不触发 OAuth 重试，也不阻断后续账号。
- 非停用错误沿用当前“记录失败并继续”的队列策略，也会补上当前节点 ID。
- 用户停止时，尚未执行的候选项目为 `skipped`，原因 `stopped`；正在执行的项目按既有停止语义处理。

## 测试

- 认证页面检测：密码页与邮箱验证码页中的代码、英文和中文停用标记均可识别；普通认证错误不误判。
- 控制器：停用错误记录为 `failed`、实际发现节点与固定原因，并继续后续账户；一般节点错误记录实际节点。
- 侧栏：终态渲染完整汇总、失败列表和跳过列表；运行中不展示列表；敏感值不被输出。
