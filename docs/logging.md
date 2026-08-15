# 日志规范

本项目使用 [Pino](https://github.com/pinojs/pino) 作为唯一日志实现。业务代码不自行拼接文本日志，也不直接输出请求体、令牌或第三方原始报文。Pino 负责 JSONL 输出、日志级别、时间戳、子 logger 和敏感字段脱敏；项目只负责补充业务事件字段。

## 输出协议

所有服务默认向标准输出写入一条一行的 JSON 记录，交由容器、进程管理器或云日志采集器收集。每条可检索日志应尽量包含以下字段：

- `time`：Pino 生成的 ISO 时间戳。
- `level`：Pino 数值级别。
- `service`：服务名，例如 `hospital-api`、`hospital-worker`。
- `environment`：运行环境，例如 `development`、`test`、`production`。
- `event`：稳定的机器可检索事件名，使用 `资源.动作` 命名。
- `traceId` / `requestId`：请求链路标识；没有上游标识时由 API 生成。
- `msg`：面向人阅读的简短说明，不承载唯一业务数据。

API 请求还应记录 `method`、`path`、`statusCode`、`durationMs`；失败请求额外记录
低敏的 `errorName`，必要时记录 Elysia 生命周期 `errorCode`，但不记录错误消息。
原生小程序为每个 `wx.request` 生成一次性的 `x-request-id`，服务端会校验后写入响应头
和 Pino HTTP 日志；服务端错误返回的 request id 会保留在 `ApiError` 中，便于用户反馈
“请求失败”时从日志平台反查链路。该 id 只用于关联，不是 token、幂等键或患者标识。
Outbox worker 还应记录 `eventId`、`eventName`、`aggregateId` 和 `attempts`。这些字段用于按请求、订单或异步事件还原一条完整故障链。

## 当前事件名

| 事件名 | 产生位置 | 用途 |
| --- | --- | --- |
| `service.started` | API / worker 入口 | 确认进程已启动、schema gate、实际 schema probe、repository 注入状态和 provider 配置状态；缺失项只记录环境变量名 |
| `service.stop.requested` / `service.stopped` | API / worker 进程生命周期 | 记录收到停机信号和依赖关闭完成 |
| `service.stop.failed` | API 进程生命周期 | 记录优雅停机失败的错误类型，触发部署侧人工关注 |
| `service.start.skipped` / `service.start.failed` | worker 启动探针 | 区分配置不完整与 MySQL/schema 不可用；未通过时不进入 provider 循环 |
| `runtime.preflight.succeeded` / `runtime.preflight.failed` | 发布前只读 preflight | 记录 MySQL、Redis、schemaStatus、缺失 migration/结构对象和 provider 配置状态；不记录连接串或密钥 |
| `persistence.schema.checked` / `persistence.schema.failed` | 独立 `db:schema` 只读检查 | 只记录 schema 状态、migration/结构缺失和错误类型；不执行 migration、不记录连接串 |
| `persistence.migration.target_rejected` | migration CLI 安全闸门 | 记录远程/生产目标未通过显式确认；不记录 DATABASE_URL |
| `persistence.integration.dependencies` / `persistence.integration.schema_probe` / `persistence.integration.succeeded` / `persistence.integration.failed` | 本地真实 MySQL/Redis 集成验收 | 记录依赖状态、schema 缺失和验收检查名；不记录连接串、token 或 provider 原始报文 |
| `http.request.completed` | API 请求生命周期 | 查询成功请求、状态码和耗时 |
| `http.request.failed` | API 请求生命周期 | 查询异常请求、错误类型和耗时 |
| `worker.outbox.claimed` | Outbox worker | 确认事件被领取及当前重试次数 |
| `worker.outbox.processed` | Outbox worker | 确认事件处理完成 |
| `worker.outbox.retry_scheduled` | Outbox worker | 查询重试原因和下一次尝试前的状态 |
| `payment.wechat_prepay.requested` | 微信预支付应用服务 | 确认某个内部订单开始申请服务端调起参数 |
| `payment.wechat_prepay.created` | 微信预支付应用服务 | 确认参数生成成功及 provider request id |
| `payment.wechat_prepay.replayed` | 微信预支付应用服务 | 确认幂等重试复用已持久化的参数 |
| `payment.wechat_prepay.read` | 微信预支付读模型 | 查询 pending/ready/unknown 等可恢复状态 |
| `payment.wechat_prepay.failed` | 微信预支付应用服务 | 记录失败类型，便于区分配置、网络和 provider 错误 |
| `payment.wechat_notification.recorded` | 微信支付通知入站 | 记录通知事实已插入或已去重，不记录原始 resource |
| `payment.wechat_notification.rejected` | 微信支付通知入站 | 记录验签、解密或白名单校验失败 |
| `worker.payment.wechat_query.reconciled` | 微信支付查单 worker | 记录已验签的 provider 状态、金额校验结果和是否继续查单 |
| `worker.payment.wechat_query.retry_scheduled` | 微信支付查单 worker | 记录可恢复查单错误和下一次调度元数据 |
| `worker.payment.wechat_notification.reconciled` | 微信支付通知 outbox handler | 记录安全通知事实经过金额和版本校验后的订单结果 |
| `patient.directory.requested` | 患者目录同步应用服务 | 记录同步开始、provider 和 trace，不记录身份或请求内容 |
| `patient.directory.synced` | 患者目录同步应用服务 | 记录 provider、trace、provider request id 和同步数量，不记录 unionId 或 provider 患者号 |
| `patient.directory.failed` | 患者目录同步应用服务 | 记录失败类型、provider 和 trace，不记录第三方原始错误报文 |
| `appointment.directory.departments.requested` | 预约科室目录读取 | 记录读取开始、provider 和 trace |
| `appointment.directory.departments.synced` | 预约科室目录读取 | 记录 provider request id 和科室数量 |
| `appointment.directory.schedules.requested` | 预约排班目录读取 | 记录日期范围、provider 和 trace，不记录患者信息 |
| `appointment.directory.schedules.synced` | 预约排班目录读取 | 记录 provider request id 和排班数量 |
| `appointment.directory.departments.failed` / `appointment.directory.schedules.failed` | 预约目录读取 | 记录错误类型，不记录 provider 原始错误报文 |
| `appointment.schedule_snapshots.persisted` / `appointment.schedule_snapshots.failed` | 排班只读快照 | 记录 provider request id、数量、过期时间或错误类型；不记录 provider 身份和原始响应 |
| `report.directory.requested` | 报告目录读取 | 记录内部 patientId、日期范围、来源筛选和 trace，不记录 provider 患者号 |
| `report.directory.synced` | 报告目录读取 | 记录 provider request id 和摘要数量，不记录 provider 患者号或原始报告 |
| `report.directory.failed` | 报告目录读取 | 记录错误类型和内部 patientId，不记录 provider 患者号或原始报告 |
| `report.detail.requested` | LIS 报告详情读取 | 记录 opaque reportId 和 trace，不记录 provider 报告号 |
| `report.detail.synced` | LIS 报告详情读取 | 记录 provider request id 和检测项数量，不记录详情原文 |
| `report.detail.failed` | LIS 报告详情读取 | 记录 opaque reportId 和错误类型，不记录 provider 原始错误 |

新增事件前先确认它是否能帮助定位状态转换、外部依赖或数据一致性问题。事件名一旦进入监控或告警规则，后续应保持稳定；字段扩展优先于改名。

## 脱敏边界

禁止记录以下内容：

- `Authorization`、Cookie、access token、refresh token、密码、密钥、openid、unionid、provider subject；
- 请求 body、医保/HIS 凭证、签名原文和第三方 provider 原始响应；
- 患者身份证号、完整就诊卡号、完整手机号等可直接识别个人的信息。
- provider 患者号；它只能在服务端 lookup 与 adapter 调用的短生命周期内存在。

Pino 还会集中脱敏 `unionId`、`prepayId`、`payParams`、`paySign`、`nonceStr`、APIv3 key、商户私钥和其他常见密钥字段的大小写变体；`providerTransactionId` 保留用于通知排障关联，但不能据此放宽业务代码对原始支付报文的禁止。

请求日志只记录 `idempotencyKeyPresent`，不记录幂等键本身。需要关联支付或医保排障时，记录内部 `orderId`、`eventId`、`providerRequestId` 等不可直接还原凭证的标识。Pino 的 `redact` 是最终兜底，不是业务代码记录敏感数据的许可。

查单日志可以记录 `attemptId`、`queryAttempts`、`providerState`、`outcome` 和 `shouldContinue`；通知消费日志可以记录 `eventId`、`notificationId`、`providerTransactionId`、`outcome` 和 `orderState`，但不得记录微信原始响应、签名头、APIv3 key、prepay 参数或完整 provider payload。

## 级别与运行配置

- `debug`：本地开发和短时诊断，允许记录更细的状态元数据，但仍必须遵守脱敏边界。
- `info`：生产默认级别，记录正常生命周期和重要状态转换。
- `warn`：可恢复异常、重试、降级或配置风险。
- `error`：请求失败、任务失败或需要人工介入的异常。
- `silent`：测试默认值，避免测试输出污染；捕获日志的测试显式注入 `info` 或 `debug` logger。

通过 `LOG_LEVEL` 调整级别。生产环境优先保持标准输出采集和集中检索，不在应用层自行实现文件轮转；文件生命周期、保留周期和告警由部署平台负责。

## 维护要求

日志不是审计数据库，也不是业务状态存储。关键业务结果必须落库或进入 outbox，日志只提供可检索的诊断线索。新增支付、医保、HIS 适配器时，至少补充：开始、成功、失败/重试三个阶段的事件，并使用请求链路标识和内部业务 ID 串联；外部请求内容只记录经过筛选的摘要。
