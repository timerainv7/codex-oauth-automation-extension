# 更新说明

## 2026-08-03 — CPAM ReAuth

- 新增 CPAM 巡检驱动的 ReAuth：手动填写 CPAM 服务地址、访问令牌和巡检运行 ID，按巡检结果原始顺序处理 Codex 的 `401` 且 `reauth` 账户。
- 每个账户在 OAuth 前仅清理 OpenAI / ChatGPT Cookie，保留 CPA、CPAM 与邮箱登录会话；OAuth 重新授权从登录阶段执行到 CPA 回调验证，不覆盖 CPA auth-files。
- 支持串行处理、停止任务、单账户失败后继续下一个账户，以及 CPAM 配置与 CPA 配置独立保存。
- 修复后台巡检 API 实例装配与侧栏启动错误显示；启动前置校验或巡检请求失败会显示脱敏错误并记录活动日志。
- 识别 OpenAI `account_deactivated` 页面：密码提交后或 `email-verification` 验证码提交后发现账号已删除/停用时，立即将该账户标记失败并继续队列。
- ReAuth 终态新增结果汇总：显示成功、失败、跳过数量；完整列出失败邮箱、失败步骤、原因，以及跳过邮箱和原因。
- CPAM 访问令牌与 localhost OAuth 回调 URL 不会出现在运行状态、错误明细或日志中。

## 验证

- `npm test`：1,467/1,467 通过。
