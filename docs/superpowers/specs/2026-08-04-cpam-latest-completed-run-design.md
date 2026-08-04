# CPAM ReAuth: 默认使用最新已完成巡检

## 目标

允许用户不填写 CPAM 巡检运行 ID。此时扩展自动获取最近一次已完成的巡检，并仅使用其 `results` 中 HTTP 401 的账号建立 ReAuth 队列。

## 接口与选择规则

1. 填写运行 ID 时，保持现有精确请求：`GET /v0/management/codex-inspection/runs/{id}`。
2. 未填写运行 ID 时，先请求 `GET /v0/management/codex-inspection/runs?limit=20`。
3. 从 `items` 按服务端返回顺序选择第一条 `status === "completed"` 的记录。CPA-Manager-Plus 按 `started_at_ms DESC, id DESC` 排序，因此这是最新完成巡检。
4. 再用该记录的 ID 请求详情接口，沿用现有候选提取和 401 过滤逻辑。
5. 最新记录若仍在运行，不使用不完整数据；继续寻找较早的已完成记录。
6. 列表为空、无已完成记录、返回数据缺少有效 ID 或详情缺少 `results` 时，显示明确错误且不启动 OAuth 队列。

## 交互与状态

- 巡检运行 ID 输入框改为可选，并将提示文字说明为“留空自动使用最新已完成巡检”。
- 自动选择成功后，运行摘要和日志只显示巡检 ID，例如“已自动使用最新完成巡检：#47”；绝不显示 CPAM Bearer Token。
- 手动填写 ID 的行为、错误和队列顺序保持不变。

## 测试

- 手动 ID 仍向详情接口发起一次请求。
- 空 ID 时先请求 runs 列表，再请求选中 completed run 的详情。
- 首条为 running 时选择下一条 completed run。
- 无 completed run、无效列表项和详情缺少 results 均不启动队列，并返回可读错误。
- 侧边栏提示输入框可选，自动选中信息安全地显示。
