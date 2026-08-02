# CPAM 巡检 ReAuth 设计

## 目标

从用户手动指定的 CPAM 巡检运行中读取结果，按返回顺序重新认证所有需要重新登录的 Codex 账号。每个账号复用侧边栏当前的密码和邮箱收码配置，并走现有 CPA OAuth 交付流程。

## 配置

在侧边栏新增独立的 CPAM 巡检配置，不复用 CPA 配置：

- CPAM 服务地址，例如 `https://cpam.example.com`
- CPAM 访问令牌，用于 `Authorization: Bearer <token>`
- 巡检运行 ID，手动填写正整数

CPA 地址与 CPA 管理密钥继续用于生成 OAuth URL 和提交 OAuth 回调。

## 数据读取与筛选

执行时请求：

```text
GET {cpamBaseUrl}/v0/management/codex-inspection/runs/{runId}
```

仅接受同时满足以下条件的 `results` 项：

- `provider === "codex"`
- `statusCode === 401`
- `action === "reauth"`

队列按接口原始返回顺序排列，并按 `fileName + authIndex` 去重。`displayAccount` 是当前项的登录邮箱；缺失或不是有效邮箱的项被跳过并记录原因。

## 执行流程

一次只运行一个账号：

1. 校验 CPA、CPAM、密码和邮箱收码配置。
2. 清理 OpenAI/ChatGPT 登录 Cookie；不得清理 CPAM、CPA 或邮箱服务 Cookie。
3. 以当前项的 `displayAccount` 替换当前登录标识。
4. 从现有 `oauth-login` 节点开始，依次执行登录、验证码、OAuth 确认与平台回调验证。
5. 成功、失败或跳过均记录到 ReAuth 运行摘要，然后继续下一项；用户中止时停止后续项。

Cookie 清理仅覆盖 OpenAI 认证域，包括 `auth.openai.com`、`accounts.openai.com`、`chatgpt.com` 与 `chat.openai.com` 及其必要的 OpenAI 域 Cookie。

## CPA 回调语义

ReAuth 不直接写 CPA 认证文件。现有 CPA OAuth 交付流程是：

1. `GET /v0/management/codex-auth-url` 获取 OAuth URL。
2. 完成登录并捕获 localhost OAuth 回调 URL。
3. 经现有“平台回调验证”流程提交回调 URL；直连接口为：

   ```text
   POST /v0/management/oauth-callback
   { "provider": "codex", "redirect_url": "<localhost callback>" }
   ```

CPA 负责更新其认证状态。CPAM 响应中的 `fileName` 和 `authIndex` 仅作为读取结果的稳定标识、去重键和日志信息，不参与写入。

## 运行状态与错误处理

后台保存当前队列、当前索引和每项结果，以支持侧边栏刷新时恢复显示。不会自动恢复浏览器认证操作；扩展重启或用户停止后，未处理项保持未开始状态，用户可重新发起运行。

单项错误不会中断其余队列。以下情况会跳过该项并记录明确原因：缺少账号邮箱、重复项、CPAM 响应格式无效。配置错误或 CPAM 请求失败会在队列启动前阻止运行。

## 界面与测试

界面提供 CPAM 配置区、运行 ID 输入、开始/停止按钮、待处理数量和运行摘要。不会引入外链、公告或广告内容。

测试覆盖：

- CPAM URL、认证头和响应解析；
- 401 筛选、顺序保持和去重；
- OpenAI Cookie 清理范围；
- 每项从 OAuth 登录节点开始，并继续执行后续回调流程；
- 失败后继续下一项、停止行为和配置校验。
