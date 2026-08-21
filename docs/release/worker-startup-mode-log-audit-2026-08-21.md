# Worker 启动模式日志边界审计（2026-08-21）

> 本文记录新项目 Worker 的启动日志修正和本地验证，不代表支付 Worker 已在生产运行，也不代表旧 Python 服务、微信支付或医保流程发生变化。

## 1. 发现的问题

Worker 正常进入轮询时已经记录 `service.started` 和 `runtimeMode`。但在以下启动失败路径中，进程会在进入 provider 循环前退出：

- 支付配置不完整，启动状态为 `not_configured`；
- MySQL 或 schema 只读探针未通过，启动状态为 `not_ready`。

这两条路径原本只记录 `service.start.skipped` 或 `service.start.failed`、依赖状态和缺失配置，未记录运行模式。生产排障时如果开发、测试和生产日志汇聚到同一个入口，就无法仅凭启动失败事件确认日志来源环境。

## 2. 修正内容

`apps/worker/src/runtime.ts` 的启动失败/跳过日志现在统一增加：

```json
{
  "event": "service.start.failed",
  "runtimeMode": "production",
  "status": "not_ready"
}
```

`runtimeMode` 只允许配置解析后的 `development`、`test` 或 `production`，不会记录连接串、支付密钥、原始异常或 Provider 报文。正常启动日志继续保留相同字段，确保 Worker 的所有启动结果都能按环境筛选。

## 3. 验证证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/worker test` | 53 pass / 0 fail / 148 expects |
| `pnpm --filter @hospital/worker typecheck` | 通过 |
| `pnpm exec biome check apps/worker/src/runtime.ts apps/worker/src/runtime.test.ts` | 通过 |
| Worker 失败启动回归 | 明确传入 `production`，断言 `service.start.failed.runtimeMode=production` |

## 4. 运行边界

本次只修改新项目 Worker 的日志字段、回归测试和文档：

- 未启动或重启支付 Worker；
- 未调用微信支付、医保或 HIS；
- 未修改旧 Python 服务、服务器配置、MySQL 或 Redis；
- 未把配置值、密钥、token 或 Provider 原始报文写入日志。

下一次部署候选时，需在真实 journald/集中日志中分别观察正常启动、配置跳过和依赖失败三类事件，并核对 `service`、`environment`、`runtimeMode` 一致；本地测试不能替代这项线上证据。
