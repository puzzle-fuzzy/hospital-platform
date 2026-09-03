# API 与 Worker 运行告警策略

更新时间：2026-08-31

## 1. 当前完成范围

仓库现在提供统一的低敏告警判定函数：`@hospital/observability` 的
`evaluateOperationalAlerts`。它只接收 API readiness、Worker 状态、outbox 聚合计数、支付查单聚合计数和 Provider 聚合性能指标，不接收患者、用户、订单号、Provider 原文或凭据。

这份策略解决“不同日志平台各自猜阈值”的代码漂移问题，但不代表生产监控已经安装。指标采集、Prometheus/日志平台规则、通知渠道、值班人和告警演练仍属于部署环境工作，继续保留在 `TODO.md`。

## 2. 规则基线

| 告警代码 | 级别 | 触发条件 | 处置方向 |
| --- | --- | --- | --- |
| `api-readiness-not-ready` | critical | API readiness 不是 `ready` | 停止接收新业务流量，检查 database/redis/schema |
| `worker-not-ready` | critical | 计划运行的 Worker 不是 `ready` | 检查依赖探针和启动日志，不能继续 Provider 循环 |
| `worker-not-configured` | critical | Worker 被要求运行但为 `not_configured` | 补齐配置或撤销运行计划，不能半开通 |
| `outbox-manual-review` | critical | 人工复核数量大于 0 | 使用人工复核手册逐条核对 |
| `outbox-retry-backlog` | warning | 自动重试数量不少于 10 | 检查 handler、Provider 延迟和失败阶段 |
| `outbox-stale-pending` | warning | 存在待处理事件且最老记录至少 15 分钟 | 检查 Worker 是否运行和数据库 claim lease |
| `payment-query-manual-review` | critical | 查单人工复核数量大于 0 | 对账、冻结并人工确认最终状态 |
| `payment-query-stale-pending` | warning | 存在待查单且最老记录至少 15 分钟 | 检查微信查单、版本冲突和退避计划 |
| `provider-error-rate-high` | critical | 至少 20 次请求且失败率不少于 20% | 按 failure stage、transport code 和 Provider request id 排查 |
| `provider-latency-high` | warning | Provider P95 延迟至少 3 秒 | 检查网络、TLS、上游排队和超时设置 |
| `recovery-failure` | critical | 恢复/回写失败数量大于 0 | 停止扩大支付/HIS 范围，进入人工处置 |

没有请求量时不计算 Provider 错误率，避免低流量窗口把 `0/0` 误判为故障。`not_configured` 只有在部署声明该 Worker 应运行时才告警，开发环境可以明确关闭运行期望。

## 3. 接入要求

生产接入必须把下列低敏字段映射为监控指标或聚合日志：

- `api readiness status` 和 `database/redis/schema` 依赖状态；
- Worker `status` 与“是否计划运行”配置；
- outbox 的 pending、retry scheduled、manual review 数量和最老待处理年龄；
- 支付查单 pending、manual review 数量和最老待确认年龄；
- Provider 请求量、失败量、P95 延迟，以及有限枚举的失败阶段/传输错误码；
- 恢复失败数量。

不得把 `Authorization`、token、患者标识、身份证、卡号、Provider 原始响应或完整 URL 作为指标 label。告警通知只携带规则代码、级别、实例和时间窗口，详细排障通过 `requestId`/`traceId` 检索低敏日志。

## 4. 尚未完成的外部证据

以下事项不能由本地单元测试替代：

1. 生产监控平台规则已经安装并与 API/Worker 指标采集相连；
2. 告警通知到值班渠道的连通性和去重；
3. readiness、Provider 失败、outbox 积压、支付长期 pending 和恢复失败的实际触发/恢复演练；
4. 生产值班责任人、响应时限和变更审批记录。

