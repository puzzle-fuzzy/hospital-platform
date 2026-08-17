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
如果失败类型是 `PersistenceUnavailableError`，还可记录 `persistenceOperation`
和允许列表中的规范化 `persistenceErrorCode`，用于判断连接丢失、重置或超时；
驱动或包装层返回的小写、短横线形式会先统一为固定的大写下划线码；这两个字段
不包含 SQL、连接串、账号、参数或原始错误消息。
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
| `runtime.smoke.check.passed` / `runtime.smoke.check.warning` / `runtime.smoke.check.failed` | API runtime smoke 单项检查 | 记录检查名、HTTP 状态码（没有收到 HTTP 响应时为 `0`）、错误类型和请求 `traceId`；不记录 URL、请求头、请求体或原始响应 |
| `runtime.smoke.completed` / `runtime.smoke.failed` | API runtime smoke 汇总 | 记录所有检查的安全摘要；每个失败项必须能通过其 `traceId` 关联反向代理和 API 日志，不能用重试次数掩盖 readiness 瞬态故障 |
| `persistence.schema.checked` / `persistence.schema.failed` | 独立 `db:schema` 只读检查 | 只记录 schema 状态、migration/结构缺失和错误类型；不执行 migration、不记录连接串 |
| `persistence.probe.unavailable` / `persistence.probe.recovered` | API/worker persistence readiness 探针 | 仅在数据库、Redis 或 Schema 从正常变为不可用、或从不可用恢复时记录依赖名、有限操作名、错误类型；两类事件都可记录本次只读探针的 `attempts`、`durationMs`，Schema 还记录状态和缺失数量；不记录连接串、原始异常、SQL、参数或第三方报文 |
| `persistence.migration.target_rejected` | migration CLI 安全闸门 | 记录远程/生产目标未通过显式确认；不记录 DATABASE_URL |
| `persistence.integration.dependencies` / `persistence.integration.schema_probe` / `persistence.integration.succeeded` / `persistence.integration.failed` / `persistence.integration.cleanup_failed` | 本地真实 MySQL/Redis 集成验收 | 记录依赖状态、schema 缺失、验收检查名和清理错误类型；不记录连接串、token 或 provider 原始报文 |
| `http.request.completed` | API 请求生命周期 | 查询成功请求、状态码和耗时 |
| `http.request.failed` | API 请求生命周期 | 查询异常请求、错误类型和耗时 |
| `persistence-temporarily-unavailable` | API 持久化错误响应 | MySQL 连接/传输层短暂异常；幂等读会在连接池内重试一次，写入和事务不会盲目重试；响应只返回 503 安全错误码，日志最多增加 `persistenceOperation` 和允许列表中的 `persistenceErrorCode`，不记录原始协议报文 |
| `auth.wechat.login.requested` | 微信授权登录应用服务 | 记录登录开始、traceId、provider 和是否携带幂等键；不记录 code |
| `auth.wechat.login.succeeded` | 微信授权登录应用服务 | 记录内部 userId、provider request id 和会话 TTL；不记录 openid、unionId 或 access token |
| `auth.wechat.login.failed` | 微信授权登录应用服务 | 记录错误类型和是否可重试；不记录 provider message、code 或原始响应 |
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
| `patient.directory.operation.started` / `patient.directory.operation.lease_taken_over` | 患者目录同步操作台账 | 记录内部 operationId、attemptCount、provider 和 trace；不记录幂等键原文 |
| `patient.directory.operation.replayed` | 患者目录同步操作台账 | 记录内部 operationId、attemptCount 和 trace，确认没有再次访问 provider |
| `patient.directory.operation.in_progress` | 患者目录同步操作台账 | 记录内部 operationId、attemptCount、固定的 `conflictScope` 和 trace，表示返回 409；不记录幂等键或租约原文 |
| `patient.directory.synced` | 患者目录同步应用服务 | 记录 provider、trace、provider request id、内部 operationId、attemptCount、目录数量、active 数量和失效数量，不记录 unionId 或 provider 患者号 |
| `patient.directory.failed` | 患者目录同步应用服务 | 记录失败类型、provider、trace 和内部 operationId，不记录第三方原始错误报文 |
| `user.profile.requested` | 普通个人资料读取 | 记录 trace 和读取开始，不记录 userId、资料字段或请求正文 |
| `user.profile.loaded` | 普通个人资料读取 | 记录 trace 和是否存在持久化资料行；默认值与已落库资料可区分，不记录 userId 或资料正文 |
| `user.profile.read_failed` | 普通个人资料读取 | 记录 trace 和错误类型，不记录 userId、资料字段或底层错误消息 |

患者目录 `in_progress` 事件的 `conflictScope` 只允许两个固定值：`same-key` 表示同一幂等键的
网络重试，`owner-provider` 表示同一 owner/provider 的另一条幂等键正在占用租约。它只用于区分
重复请求和跨页面并发，不是客户端可见的业务数据。
| `user.profile.updated` | 普通个人资料更新 | 记录 trace、修改字段数量和新版本，不记录 userId、昵称、邮箱或请求正文 |
| `user.profile.conflict` | 普通个人资料版本冲突 | 记录 trace 和固定错误类型，保留 409 并发事实的可检索性；不记录 userId、版本值、字段值或请求正文 |
| `user.profile.update_failed` | 普通个人资料更新失败 | 记录 trace 和错误类型，不记录 userId、资料字段或底层错误消息 |
| `appointment.directory.departments.requested` | 预约科室目录读取 | 记录读取开始、provider 和 trace |
| `appointment.directory.departments.synced` | 预约科室目录读取 | 记录 provider request id 和科室数量 |
| `appointment.directory.schedules.requested` | 预约排班目录读取 | 记录日期范围、provider 和 trace，不记录患者信息 |
| `appointment.directory.schedules.synced` | 预约排班目录读取 | 记录 provider request id、排班数量和 `snapshotPersistenceStatus`；该字段区分只读 Provider 结果与未来写入前的快照事实 |
| `appointment.directory.departments.failed` / `appointment.directory.schedules.failed` | 预约目录读取 | 记录错误类型，不记录 provider 原始错误报文 |
| `outpatient.payment.records.requested` | 门诊费用只读查询 | 仅在 patientId 通过服务层非空校验后记录内部 patientId、查询状态和 trace；不记录 provider 患者号、订单号或原始报文 |
| `outpatient.payment.records.loaded` | 门诊费用只读查询 | 记录 provider request id、状态和返回数量；金额只保留服务端读模型，不记录完整费用明细 |
| `outpatient.payment.records.failed` | 门诊费用只读查询 | 覆盖输入校验、owner 映射、持久化和 provider 失败；记录错误类型和内部 patientId，不记录 provider 原始错误、支付凭证或医保字段 |
| `http.request.failed`（provider 失败时） | API 请求统一观测 | 额外记录 `provider`、`providerOperation`、`providerRequestId`、`providerStatusCode`、`providerRetryable`；不记录 URL、请求体或响应体 |
| `appointment.schedule_snapshots.persisted` / `appointment.schedule_snapshots.failed` | 排班只读快照 | 记录 provider request id、数量、过期时间或错误类型；不记录 provider 身份和原始响应 |
| `report.directory.requested` | 报告目录读取 | 记录内部 patientId、日期范围、来源筛选和 trace，不记录 provider 患者号 |
| `report.directory.synced` | 报告目录读取 | 记录 provider request id 和摘要数量，不记录 provider 患者号或原始报告 |
| `report.directory.failed` | 报告目录读取 | 记录错误类型和内部 patientId，不记录 provider 患者号或原始报告 |
| `report.detail.requested` | LIS 报告详情读取 | 记录 opaque reportId 和 trace，不记录 provider 报告号 |
| `report.detail.synced` | LIS 报告详情读取 | 记录 provider request id 和检测项数量，不记录详情原文 |
| `report.detail.failed` | LIS 报告详情读取 | 记录 opaque reportId 和错误类型，不记录 provider 原始错误 |

基础设施与运维能力迁移时，日志事件还必须区分以下事实：

| 事件范围 | 最小可检索字段 | 禁止字段与原因 |
| --- | --- | --- |
| Redis 会话 | `namespace`、`operation`、`ttlSeconds`、`outcome`、`traceId` | token、完整 Redis key、旧服务 token 值；避免凭证和跨服务 key 泄露 |
| outbox/任务租约 | `eventId`/`jobId`、`attempts`、`leaseState`、`outcome`、`nextRunAt` | job args、患者号、provider 原文；任务参数可能包含敏感信息 |
| 文件资源 | `resourceId`、`resourceType`、`ownerScope`、`sizeBytes`、`outcome` | 本地绝对路径、永久 URL、文件正文、原始文件名中的身份信息 |
| WebSocket/AI | `sessionId`、`messageId`、`protocolVersion`、`ownerScope`、`outcome` | access token、provider 患者号、对话正文、音频内容和 prompt |
| Admin/RBAC | `adminRequestId`、`permission`、`resourceType`、`outcome` | 管理员 token、完整权限载荷、患者数据和批量导出正文 |

这些事件只有在对应能力正式迁移并开放时才实现；当前“未迁移”能力不应通过日志伪造运行成功。
Redis 的 namespace 记录应使用经过允许列表的逻辑名称（例如 `new-session`、`legacy-readonly-audit`），
不要把完整 key 或连接配置写入日志。

便民服务的日志事件已提前冻结在 [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md)。
实现时至少覆盖 `convenience.feedback.*`、`convenience.questionnaire.*`、`convenience.doctor_relation.*`
和 `convenience.idempotency.replayed` 的 requested/succeeded/failed 或 replayed 阶段；当前这些事件只有规范，
不代表运行时代码已经开放。问卷答案、表扬信正文、患者姓名、原始 `pat_id`、医生联系方式和 provider 原始报文仍禁止写入日志。

个人中心和外部入口的票据、患者绑定、协议和跨小程序事件规范见
[`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md)。
实现时应记录命令 ID、内部资源引用、audience、scope、结果状态和 request/trace 标识，不记录身份证、openid、
unionid、access token、签名小程序 extraData、外部 URL 原文或 WebView 页面正文。

新增事件前先确认它是否能帮助定位状态转换、外部依赖或数据一致性问题。事件名一旦进入监控或告警规则，后续应保持稳定；字段扩展优先于改名。

院内导航当前只加载随小程序发布的静态地图资源，不调用 Hospital API、众阳接口或地图路线服务，
公众号说明页和反馈帮助页同样只加载随小程序发布的静态文案、图标或客服电话配置；这三类页面不会新增 Pino 服务端事件，
也不会把患者上下文或地图请求写入服务端日志。未来接入动态医院列表、
楼层定位或实时路线时，必须先新增独立 contract、错误码和日志事件，再开放对应页面能力。

## 脱敏边界

禁止记录以下内容：

- `Authorization`、Cookie、access token、refresh token、密码、密钥、openid、unionid、provider subject；
- 请求 body、医保/HIS 凭证、签名原文和第三方 provider 原始响应；
- 患者身份证号、完整就诊卡号、完整手机号等可直接识别个人的信息。
- provider 患者号；它只能在服务端 lookup 与 adapter 调用的短生命周期内存在。

Pino 还会集中脱敏 `unionId`、`prepayId`、`payParams`、`paySign`、`nonceStr`、APIv3 key、商户私钥和其他常见密钥字段的大小写变体；`providerTransactionId` 保留用于通知排障关联，但不能据此放宽业务代码对原始支付报文的禁止。

请求日志只记录 `idempotencyKeyPresent`，不记录幂等键本身。需要关联支付或医保排障时，记录内部 `orderId`、`eventId`、`providerRequestId` 等不可直接还原凭证的标识。Pino 的 `redact` 是最终兜底，不是业务代码记录敏感数据的许可。

微信授权登录的排障顺序固定为：先用同一个 `traceId/requestId` 查 `http.request.*`，再查对应的
`auth.wechat.login.*` 事件，最后结合 `providerRequestId` 查询 provider 侧记录。禁止用临时 code、openid、
unionId、session_key 或 access token 作为日志检索条件；这些值不应出现在日志中。

runtime smoke 的每个 HTTP 请求都会发送独立的 `x-request-id`，其值就是该检查的 `traceId`。
因此 `health-live`、`health-ready`、`system-ping` 和认证边界的失败结果不能只记录一个共享的
smoke 批次号：网络错误、非法 JSON、HTTP/业务失败和 readiness 不满足都必须保留对应请求的
`traceId`。认证边界逐路检查时，若某一路网络失败，汇总项使用失败请求的 traceId；若只有 HTTP
状态或错误码不符合预期，则仍保留该路收到响应的 traceId。`statusCode=0` 只表示没有收到
HTTP 响应，不是服务端返回的业务状态码。

MySQL 出现连接断开时，优先按 `requestId` 检索 `http.request.failed`，结合 `errorName`、HTTP 503、
`persistenceOperation` 和 `persistenceErrorCode`，再与时间窗口内的数据库服务、网络和连接池状态核对。
幂等查询可以自动恢复一次；支付、预约等写入或事务
遇到断连不会自动重复提交，必须先根据持久化事实确认服务端是否已经执行，再决定补偿或重试。

`persistence.probe.unavailable` 和 `persistence.probe.recovered` 的 `attempts` 只表示本次只读
基础设施探针的尝试次数，不表示业务操作被重放；`durationMs` 是探针从开始到结束的整数毫秒耗时，
用于识别连接池、Redis 握手或 schema 查询的慢故障。它们不能作为预约、支付、医保或其他写入操作
已经执行的证据。恢复事件会带上恢复时最新一轮探针的安全元数据，排障时应与同一时间窗口的
`service.started`、`http.request.*` 和数据库/Redis 平台日志交叉核对。

查单日志可以记录 `attemptId`、`queryAttempts`、`providerState`、`outcome` 和 `shouldContinue`；通知消费日志可以记录 `eventId`、`notificationId`、`providerTransactionId`、`outcome` 和 `orderState`，但不得记录微信原始响应、签名头、APIv3 key、prepay 参数或完整 provider payload。

## 级别与运行配置

- `debug`：本地开发和短时诊断，允许记录更细的状态元数据，但仍必须遵守脱敏边界。
- `info`：生产默认级别，记录正常生命周期和重要状态转换。
- `warn`：可恢复异常、重试、降级或配置风险。
- `error`：请求失败、任务失败或需要人工介入的异常。
- `silent`：测试默认值，避免测试输出污染；捕获日志的测试显式注入 `info` 或 `debug` logger。

通过 `LOG_LEVEL` 调整级别。生产环境优先保持标准输出采集和集中检索，不在应用层自行实现文件轮转；文件生命周期、保留周期和告警由部署平台负责。

API 生产组合根会把同一个 Pino logger 注入认证、患者、预约、报告和支付应用服务；应用服务不得自行创建
第二个 logger。systemd 使用 journald 收集标准输出和标准错误，检索时优先使用 `event`、`traceId`、
`requestId`、`providerRequestId` 和内部业务 ID，不读取包含患者隐私的原始请求日志。

## 维护要求

日志不是审计数据库，也不是业务状态存储。关键业务结果必须落库或进入 outbox，日志只提供可检索的诊断线索。新增支付、医保、HIS 适配器时，至少补充：开始、成功、失败/重试三个阶段的事件，并使用请求链路标识和内部业务 ID 串联；外部请求内容只记录经过筛选的摘要。
