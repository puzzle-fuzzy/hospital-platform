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
如果会话存储或可替换的 `SessionTokenService` 返回了异常 principal，统一请求日志还可记录固定的
`readModelViolation=user-id-invalid`；该字段只说明会话读模型不符合 contract，不记录原始 `userId`、token
或 Redis 键。该错误公共响应为 `persistence-invalid`，不能记录成普通 401，否则会让客户端把数据损坏误判为
会话过期并反复登录。
Provider 只读 gateway 的 trace 也必须先经过 service 二次投影；若 `provider`、`operation` 或 `requestId` 越过
形状边界，或 Provider 不属于当前已配置渠道，请求日志只记录固定的 `readModelViolation`（例如
`request-id-invalid`、`provider-mismatch`），不记录原始字符串。这样 `provider-response-invalid` 仍然可以通过
`traceId` 关联 Provider 失败，而不会把可控文本注入日志字段。
原生小程序为每个 `wx.request` 生成一次性的 `x-request-id`，服务端会校验后写入响应头
和 Pino HTTP 日志；小程序读取响应头时按 HTTP 规范进行大小写无关匹配，避免代理或运行时
改写 `X-Request-Id` 的拼写后丢失服务端链路。服务端错误返回的 request id 会保留在 `ApiError`
中，便于用户反馈“请求失败”时从日志平台反查链路。该 id 只用于关联，不是 token、幂等键或患者标识。
Outbox worker 还应记录 `eventId`、`eventName`、`aggregateId` 和 `attempts`。这些字段用于按请求、订单或异步事件还原一条完整故障链。

## 当前事件名

| 事件名 | 产生位置 | 用途 |
| --- | --- | --- |
| `service.started` | API / worker 入口 | 确认进程已启动、schema gate、实际 schema probe、repository 注入状态和 provider 配置状态；缺失项只记录环境变量名 |
| `service.stop.requested` / `service.stopped` | API / worker 进程生命周期 | 记录收到停机信号和依赖关闭完成 |
| `service.stop.failed` | API 进程生命周期 | 记录优雅停机失败的错误类型，触发部署侧人工关注 |
| `service.start.skipped` / `service.start.failed` | worker 启动探针 | 区分配置不完整与 MySQL/schema 不可用；记录 `runtimeMode` 便于确认 development/test/production；未通过时不进入 provider 循环 |
| `runtime.preflight.succeeded` / `runtime.preflight.failed` | 发布前只读 preflight | 记录 MySQL、Redis、schemaStatus、缺失 migration/结构对象和 provider 配置状态；不记录连接串或密钥 |
| `runtime.smoke.check.passed` / `runtime.smoke.check.warning` / `runtime.smoke.check.failed` | API runtime smoke 单项检查 | 记录检查名（包括 `auth-boundary` 和 `closed-boundary`）、HTTP 状态码（没有收到 HTTP 响应时为 `0`）、错误类型和请求 `traceId`；不记录 URL、请求头、请求体或原始响应 |
| `runtime.smoke.completed` / `runtime.smoke.failed` | API runtime smoke 汇总 | 记录所有检查的安全摘要；每个失败项必须能通过其 `traceId` 关联反向代理和 API 日志，不能用重试次数掩盖 readiness 瞬态故障 |
| `provider.smoke.configuration.failed` | Provider 只读 smoke 启动配置 | 只记录错误类型和固定的 `configurationReason`（例如 `access-token-missing`、`patient-id-missing`、`base-url-https-required`）；不记录 token、患者 ID、URL 原文、环境变量值或异常消息 |
| `provider.smoke.capability.passed` / `provider.smoke.capability.failed` | Provider 只读 smoke 业务能力 | 记录能力名、错误类型、低敏数量和请求 `traceId`；不记录患者凭证、Provider 原始响应或完整请求 URL |
| `provider.smoke.completed` / `provider.smoke.failed` | Provider 只读 smoke 汇总 | 记录各能力的安全结果；配置未通过时不发送任何业务请求，也不能把配置失败计为 Provider 拒绝 |
| `persistence.schema.checked` / `persistence.schema.failed` | 独立 `db:schema` 只读检查 | 只记录 schema 状态、migration/结构缺失和错误类型；不执行 migration、不记录连接串 |
| `persistence.probe.unavailable` / `persistence.probe.recovered` | API/worker persistence readiness 探针 | 仅在数据库、Redis 或 Schema 从正常变为不可用、或从不可用恢复时记录依赖名、有限操作名、错误类型；两类事件都可记录本次只读探针的 `attempts`、`durationMs`，Schema 还记录状态和缺失数量；不记录连接串、原始异常、SQL、参数或第三方报文 |
| `persistence.migration.target_rejected` | migration CLI 安全闸门 | 记录远程/生产目标未通过显式确认；不记录 DATABASE_URL |
| `persistence.integration.dependencies` / `persistence.integration.schema_probe` / `persistence.integration.succeeded` / `persistence.integration.failed` / `persistence.integration.cleanup_failed` | 本地真实 MySQL/Redis 集成验收 | 记录依赖状态、schema 缺失、验收检查名和清理错误类型；不记录连接串、token 或 provider 原始报文 |
| `http.request.completed` | API 请求生命周期 | 查询成功请求、状态码和耗时 |
| `http.request.failed` | API 请求生命周期 | 查询异常请求、错误类型和耗时 |
| `persistence-temporarily-unavailable` | API 持久化错误响应 | MySQL 连接/传输层短暂异常；连接池内的幂等读最多执行初始请求加两次短退避恢复尝试（25ms、100ms），写入和事务不会盲目重试；响应只返回 503 安全错误码，日志最多增加 `persistenceOperation` 和允许列表中的 `persistenceErrorCode`，不记录原始协议报文 |
| `auth.wechat.login.requested` | 微信授权登录应用服务 | 记录登录开始、traceId、provider 和是否携带幂等键；不记录 code |
| `auth.wechat.login.succeeded` | 微信授权登录应用服务 | 记录内部 userId、provider request id 和会话 TTL；不记录 openid、unionId 或 access token |
| `auth.wechat.login.failed` | 微信授权登录应用服务 | 记录错误类型和是否可重试；不记录 provider message、code 或原始响应 |
| `patient.directory.failed` | 患者目录同步未提交成功 | 记录固定 `errorType`；若为 `PatientDirectorySnapshotUnsafeError`，表示空目录在已有医院患者时被安全拒绝，不记录患者正文或 provider 原始字段 |
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
| `patient.directory.snapshot.stale` | 患者目录同步并发保护 | 记录内部 operationId、attemptCount、provider 和 trace，表示旧快照被更新快照拒绝；不记录患者正文、幂等键或 provider 原始响应 |
| `patient.directory.snapshot.committed` | 患者目录同步快照事务 | 记录快照事务已返回、domain 已校验的 `providerRequestId` 及可选有界 `providerRequestIds`、内部 operationId、attemptCount 和 Provider 目录数量；不把仓储返回的 active 读模型当作已验证成功 |
| `patient.directory.synced` | 患者目录同步应用服务 | 记录 provider、trace、domain 已校验的 `providerRequestId` 及可选有界 `providerRequestIds`、内部 operationId、attemptCount、目录数量、active 数量和失效数量，不记录 unionId 或 provider 患者号 |
| `patient.directory.failed` | 患者目录同步应用服务 | 记录失败类型、provider、trace、内部 operationId，以及安全白名单中的 `providerOperation`、`providerRequestId`、`providerStatusCode`、`providerRetryable`（有值时）；不记录第三方原始错误报文、请求 URL、查询卡号或姓名 |
| `patient.directory.read.requested` / `patient.directory.read.loaded` | 患者目录读模型读取 | 记录读取开始和有效患者数量；不记录 userId、患者正文或 provider 患者号 |
| `patient.directory.read.failed` | 患者目录读模型读取 | 记录读取错误类型和 trace；不记录 userId、患者正文或 provider 患者号 |
| `user.profile.requested` | 普通个人资料读取 | 记录 trace 和读取开始，不记录 userId、资料字段或请求正文 |
| `user.profile.loaded` | 普通个人资料读取 | 记录 trace 和是否存在持久化资料行；默认值与已落库资料可区分，不记录 userId 或资料正文 |
| `user.profile.read_failed` | 普通个人资料读取 | 记录 trace 和错误类型，不记录 userId、资料字段或底层错误消息 |
| `user.profile.update.requested` | 普通个人资料更新开始 | 记录 trace 和更新服务已接收请求，不记录 userId、版本、资料字段或请求正文 |
| `user.profile.updated` | 普通个人资料更新 | 记录 trace、修改字段数量和新版本，不记录 userId、昵称、邮箱或请求正文 |
| `user.profile.conflict` | 普通个人资料版本冲突 | 记录 trace 和固定错误类型，保留 409 并发事实的可检索性；不记录 userId、版本值、字段值或请求正文 |
| `user.profile.update_failed` | 普通个人资料更新失败（包括输入校验拒绝） | 记录 trace 和错误类型，不记录 userId、资料字段或底层错误消息 |

低敏分布统计可以记录固定枚举值的数量（例如预约成功结果中的 `statusCounts`），用于解释筛选、分页或状态转换；
这类字段只能是服务端白名单枚举到整数的聚合结果，不得包含逐条业务标识、患者标识、Provider 原始文本或任意调用方原值。

患者目录 `in_progress` 事件的 `conflictScope` 只允许两个固定值：`same-key` 表示同一幂等键的
网络重试，`owner-provider` 表示同一 owner/provider 的另一条幂等键正在占用租约。它只用于区分
重复请求和跨页面并发，不是客户端可见的业务数据。

| `appointment.directory.departments.requested` | 预约科室目录读取 | 记录读取开始、provider 和 trace |
| `appointment.directory.departments.synced` | 预约科室目录读取 | 记录已校验的 `providerRequestId`、可选有界 `providerRequestIds` 和科室数量 |
| `appointment.directory.schedules.requested` | 预约排班目录读取 | 记录日期范围、provider 和 trace，不记录患者信息 |
| `appointment.directory.schedules.synced` | 预约排班目录读取 | 记录已校验的 `providerRequestId`、可选有界 `providerRequestIds`、排班数量和 `snapshotPersistenceStatus`；该字段区分只读 Provider 结果与未来写入前的快照事实 |
| `appointment.directory.departments.failed` / `appointment.directory.schedules.failed` | 预约目录读取 | 覆盖服务端日期生成、输入校验、依赖和 Provider 失败；若 trace 已通过校验但后续读模型失败，同时保留主请求号和有界请求号列表；Provider 失败额外记录低敏 operation/request id/HTTP 状态/retryable，不记录原始错误报文 |
| `appointment.records.requested` / `appointment.records.synced` | 预约历史只读查询 | 记录内部 patientId、有限日期范围、已校验的 provider request id 及可选有界列表和返回数量；空数组成功必须保留 `synced`，不记录 provider 患者号 |
| `appointment.records.failed` | 预约历史只读查询 | 覆盖日期校验、依赖未配置、owner 映射和 Provider 失败；若 trace 已通过校验则保留完整低敏请求号列表，另记录错误类型、内部 patientId 以及 Provider 低敏诊断字段，不记录 provider 原始报文 |
| `outpatient.payment.records.requested` | 门诊费用只读查询 | 仅在 patientId 通过服务层非空校验后记录内部 patientId、查询状态和 trace；不记录 provider 患者号、订单号或原始报文 |
| `outpatient.payment.records.loaded` | 门诊费用只读查询 | 记录已校验的 provider request id、可选有界请求号列表、状态和返回数量；金额只保留服务端读模型，不记录完整费用明细 |
| `outpatient.payment.records.failed` | 门诊费用只读查询 | 覆盖输入校验、owner 映射、持久化和 provider 失败；若 trace 已通过校验则保留完整低敏请求号列表，另记录错误类型、内部 patientId 以及 Provider 低敏诊断字段，不记录 provider 原始错误、支付凭证或医保字段 |
| `http.request.failed`（provider 失败时） | API 请求统一观测 | 额外记录 `provider`、`providerOperation`、`providerRequestId`、`providerStatusCode`、`providerRetryable`；不记录 URL、请求体或响应体 |
| `appointment.schedule_snapshots.persisted` / `appointment.schedule_snapshots.failed` | 排班只读快照 | 记录已校验的 provider request id、可选有界请求号列表、数量、过期时间或错误类型；不记录 provider 身份和原始响应 |
| `report.directory.requested` | 报告目录读取 | 记录内部 patientId、日期范围、来源筛选和 trace，不记录 provider 患者号 |
| `report.directory.synced` | 报告目录读取 | 记录 provider request id 和摘要数量，不记录 provider 患者号或原始报告 |
| `report.directory.failed` | 报告目录读取 | 覆盖日期校验、owner 映射、依赖和 Provider 失败；记录错误类型、内部 patientId 以及 Provider 低敏诊断字段，不记录 provider 患者号或原始报告 |
| `report.detail_reference.failed` | 报告目录中的详情引用建立 | 单条短期引用持久化失败时记录 trace、provider request id、内部 patientId 和错误类型；该事件表示详情入口被隐藏，摘要仍保留，不记录 provider 报告号或原始异常 |
| `report.detail.requested` | LIS 报告详情读取 | 记录内部 patientId、opaque reportId 和 trace，不记录 provider 报告号 |
| `report.detail.synced` | LIS 报告详情读取 | 记录 provider request id 和检测项数量，不记录详情原文 |
| `report.detail.failed` | LIS 报告详情读取 | 覆盖详情依赖未配置、owner/patient/TTL 查询和 Provider 失败；记录内部 patientId、opaque reportId、错误类型以及 Provider 低敏诊断字段，不记录 provider 原始错误 |

### 只读查询事件的生命周期约定

预约历史和门诊费用的 `requested` 不是“收到任意 HTTP 请求”的通用入口日志，而是“已通过基础输入校验，
即将进入 owner-scoped 映射或 Provider 链路”的业务事件。这样可以把客户端/路由参数错误与真正进入外部依赖
的请求区分开来：

- `appointment.records.failed`：日期格式、日期范围、空白 `patientId`、依赖未配置、owner 映射失败或 Provider
  失败都必须记录；这些早期失败可能没有对应的 `appointment.records.requested`。
- `appointment.records.requested`：只在日期和内部 `patientId` 基础校验通过后记录；它不代表 Provider 已经收到请求，
  Provider request id 只在后续 `synced` 或统一 `http.request.failed` 中出现。
- `appointment.records.synced`：只表示 Provider 返回已成功解析的读模型，空数组也必须记录 `itemCount=0`；它不表示
  患者有预约，也不表示预约可以取消、支付或写回 HIS。
- `outpatient.payment.records.failed`：空白 `patientId`、owner 映射、依赖、持久化或 Provider 失败都必须记录；
  空白输入同样可能没有对应的 `outpatient.payment.records.requested`。
- `outpatient.payment.records.requested`：只在非空内部 `patientId` 和状态值通过服务层校验后记录；它不代表费用已返回、
  已结算或允许支付。
- `outpatient.payment.records.loaded`：只表示 Provider 返回已通过 adapter 白名单和状态校验的读模型，`itemCount=0`
  代表明确的成功空结果；它不表示支付、医保结算或 HIS 回写成功。

门诊费用的 `status` 是运行时白名单字段。未知值在 service 和 adapter 边界都会 fail-closed；失败日志只记录
`status=invalid`，不记录调用方传入的任意原始字符串，也不产生 Provider 请求。这样日志能证明拒绝发生，
但不会把错误输入继续扩散为“已支付”查询语义。

报告目录的 `kind` 同样是运行时白名单字段；未知来源只记录 `report.directory.failed` 和稳定错误类型，
不会产生 `report.directory.requested`，也不会把错误查询降级成 ECG Provider 请求。

患者目录同步和读模型读取必须按提交边界区分：

患者同步 trace 的 `providerRequestIds` 是可选的多请求关联列表。它必须在 domain
重投影时逐项校验、限制数量并包含主 `providerRequestId`；service 只把这组已校验的
低敏请求号写入日志。当前具体 Provider 是否能返回所有档案请求号，仍由对应 adapter
contract 决定；不能用日志字段存在推断 Provider 已返回完整链。

P0 日志聚合器会同时读取单个 `providerRequestId` 和有界 `providerRequestIds`，再做去重后
输出 `providerRequestIdCount`；该数字是关联请求号数量，不是业务请求次数，也不证明
Provider 结果或页面展示已经成功。

- `patient.directory.snapshot.committed` 表示快照仓储调用已经返回，事务提交事实已经成立；它只记录 Provider 目录数量，
  不代表仓储返回的 active 读模型已经通过二次校验。
- `patient.directory.synced` 表示完整目录快照事务已经提交，包含 operation ledger 的成功状态，且事务返回的 active 读模型和失效数量
  已通过 domain 二次投影；
  它不保证随后把当前读模型查询返回给客户端的动作一定成功。
- `patient.directory.read.loaded` 表示当前 owner 的脱敏读模型已经从仓储读取并完成返回映射，`itemCount=0`
  是明确的成功空目录，不代表同步过 provider。
- 如果快照已经提交或请求命中 durable replay，之后的仓储读取失败只能记录
  `patient.directory.read.failed`，不能再追加 `patient.directory.failed`；否则会把已成立的同步成功事实误报成
  provider 同步失败。
- 如果 `snapshot.committed` 已记录但事务返回读模型校验失败，则只记录 `patient.directory.read.failed`，不记录
  `patient.directory.synced` 或 `patient.directory.failed`；这样既保留数据库提交事实，也不把未经验证的数量当成同步成功。
- 只有在快照提交前发生身份、租约、完整快照、Provider 或持久化错误时，才记录
  `patient.directory.failed`。处理中冲突仍只记录 `patient.directory.operation.in_progress`。

会话 principal 读模型同样遵循 fail-closed 生命周期：

- Redis 命中但返回的 `userId` 越过形状或列宽边界时，请求日志记录 `errorName=SessionPrincipalReadModelValidationError`
  和固定 `readModelViolation=user-id-invalid`，不记录原始值。
- 该异常表示持久化/运行时边界损坏，不是用户凭证自然过期；公共响应固定为 500 `persistence-invalid`，不得转换成
  401，也不得继续调用患者、预约、报告、门诊费用或支付 service。
- 只有 Redis 没有找到 token 时才返回 401；Redis 连接/传输失败仍保持 503 `dependency-not-configured`，三种事实不能混淆。

Provider trace 读模型也遵循同一条规则：

- 预约、报告和门诊费用 gateway 返回结果后，service 先校验并重新投影 trace，再写 `synced/loaded` 成功事件或把 request id
  交给短期快照/详情引用。
- trace 违反 contract 时只记录固定 `readModelViolation`，公共响应为 502 `provider-response-invalid`；它不能被当作
  Provider 业务拒绝、空列表或持久化故障，也不能把不可信 request id 当作日志关联事实。

以上事件以同一个 `traceId` 关联；失败事件必须保留稳定 `errorType`，成功事件必须保留结果数量或状态。HTTP
请求日志仍然独立记录请求生命周期，不能用 `http.request.completed` 代替业务 `synced/loaded`，也不能用 HTTP 200
推导 Provider 业务成功。

服务层会再次校验 `patientId`、`reportId`、科室和医生过滤标识的非空、长度及控制字符边界，不能因为内部任务绕过
Elysia schema 就把异常标识送入 owner/provider 查询。无效标识不得原样进入业务日志：预约、报告和门诊费用失败事件中
统一使用固定的 `invalid` 标记；只有通过形状校验后的内部 opaque 标识才允许用于链路关联。该校验不代表 owner、TTL 或
provider 映射已经成功，后续仍必须记录对应的映射/Provider 失败事实。

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

Pino 还会集中脱敏 `unionId`、`prepayId`、`payParams`、`paySign`、`nonceStr`、APIv3 key、商户私钥和其他常见密钥字段的大小写变体；众阳档案中的 `patId`、`thirdPatientId`、姓名、卡号、身份证号、手机号、`patCardVOList` 和 `providerReferences` 也被列入最终兜底清单。`providerTransactionId` 保留用于通知排障关联，但不能据此放宽业务代码对原始支付报文的禁止。

Pino 10 使用的 `@pinojs/redact` 路径通配符是固定层级，不支持 `**.field` 无限递归匹配。
因此 `packages/observability` 同时在 Pino 的 `streamWrite` 输出钩子上递归检查最终单行 JSON，
覆盖普通字段、child binding、数组和 serializer 产生的深层结构；这只是最后一道输出门禁，
不是记录原始请求体或 Provider 响应的许可。该边界的合成深层字段回归测试和审计证据见
[`release/observability-deep-redaction-audit-2026-08-21.md`](release/observability-deep-redaction-audit-2026-08-21.md)。
如果最终 chunk 不是合法 JSON，输出钩子会丢弃原文，只输出固定的 `log.redaction.failed`，
禁止以保留排障原文为理由绕过脱敏边界。

请求日志只记录 `idempotencyKeyPresent`，不记录幂等键本身。需要关联支付或医保排障时，记录内部 `orderId`、`eventId`、`providerRequestId` 等不可直接还原凭证的标识。Pino 的 `redact` 是最终兜底，不是业务代码记录敏感数据的许可。

所有会传播到 HTTP 生命周期的 domain 读模型异常，`http.request.failed` 都会保留其固定
`readModelViolation`；这只用于区分资料、身份、患者、预约、报告和费用读模型的契约失败，
不携带字段原值。业务 service 的成功事件仍必须在完整读模型校验之后记录，不能因为请求日志补充了
违规原因就把 `502/500` 误判为业务成功。

微信授权登录的排障顺序固定为：先用同一个 `traceId/requestId` 查 `http.request.*`，再查对应的
`auth.wechat.login.*` 事件，最后结合 `providerRequestId` 查询 provider 侧记录。禁止用临时 code、openid、
unionId、session_key 或 access token 作为日志检索条件；这些值不应出现在日志中。

runtime smoke 的每个 HTTP 请求都会发送独立的 `x-request-id`，其值就是该检查的 `traceId`。
因此 `health-live`、`health-ready`、`system-ping`、认证边界和关闭能力边界的失败结果不能只记录一个共享的
smoke 批次号：网络错误、非法 JSON、HTTP/业务失败和 readiness 不满足都必须保留对应请求的
`traceId`。认证边界逐路检查时，若某一路网络失败，汇总项使用失败请求的 traceId；若只有 HTTP
状态或错误码不符合预期，则仍保留该路收到响应的 traceId。关闭能力边界除了要求 HTTP `404`，
还要求平台错误码为 `not-found`，避免把代理层的任意 404 误认为应用确实保持了未注册状态。
`statusCode=0` 只表示没有收到 HTTP 响应，不是服务端返回的业务状态码。

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

### P0 只读日志聚合

真机验收或线上排障时，可以把受控时间窗口的 journald JSONL 交给
[`tools/p0-log-aggregate.mjs`](../tools/p0-log-aggregate.mjs)，只输出事件、业务域、结果、HTTP 状态、
错误类型和链路数量的聚合结果：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '2026-08-17 00:00:00' --until '2026-08-17 23:59:59' \
  -o json --no-pager | bun tools/p0-log-aggregate.mjs
```

生产 release 不依赖 workspace 源码；候选发布包必须同时包含
`apps/worker/dist/p0-log-aggregate.js`，服务器上应使用候选 release 的 bundle 执行同样的 stdin 管道：

仓库根目录的 `turbo.json` 已将两个聚合工具登记为全局构建输入。这样修改工具源文件后，Turbo 不会错误复用旧的
`apps/worker/dist` 缓存；发布前仍必须检查 bundle 内容和 SHA-256，而不能只看构建命令退出码。

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '2026-08-17 00:00:00' --until '2026-08-17 23:59:59' \
  -o json --no-pager | \
  /home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-log-aggregate.js"
```

发布前必须对该 artifact 做 SHA-256 校验；不能在 release 目录临时安装依赖，也不能把 token、患者标识或
Provider 原始报文通过参数传给聚合工具。

该工具不是日志采集器，也不会连接数据库、Redis 或 Provider；它只读 stdin（或 `--file` 指定的 JSONL）。生产环境优先使用
`journalctl -o json`：工具会从 journald envelope 的 `MESSAGE` 字段还原 Pino JSON，并把明确白名单内的 systemd 启停提示计入
`ignoredControlLines`，避免 `-o cat` 在终端宽度边界拆分长日志。直接传入 `-o cat` 仍兼容历史窗口；遇到未知的非 JSON 行只增加
`parseErrors`。已识别的 systemd 停止超时、进程 SIGKILL 和 unit timeout 会只增加稳定的
`systemdWarningCounts/systemdWarningCount`，不会回显 PID、进程名或原文。UTF-8 BOM 会计入 `strippedBomLines` 后再解析，
空行计入 `ignoredBlankLines`，不会回显原文。聚合结果刻意不包含
`msg`、URL、请求体、token、openid、
患者标识、金额或第三方原始报文。`payment-frozen` 域只用于确认高风险支付日志是否误入观察窗口，不能证明支付、
医保、退款或 HIS 写回已经成功。若 `parseErrors > 0` 或 `systemdWarningCount > 0`，应在受控环境内排查日志/服务状态，
不能把聚合结果当作完整审计记录。

聚合结果可以继续交给
[`tools/p0-business-evidence-audit.mjs`](../tools/p0-business-evidence-audit.mjs) 做业务事件链门禁：
先使用 `p0-log-aggregate` 的 `--json` 输出纯 JSON，再按业务域检查 `requested` 和明确成功事件是否都出现。
该门禁只证明日志确实进入并完成过某个业务模块，不证明页面字段、患者归属或 Provider 结果正确；仍必须和
HTTP 响应、真机页面及同一时间窗口的低敏 trace 交叉核对。缺少成功事件、`parseErrors > 0`、`systemdWarningCount > 0` 或出现未知业务域时，
门禁必须失败，不能用 readiness、单独的 HTTP 200 或页面存在替代。

2026-08-19 00:48 CST 起的历史运行窗口中，线上新 API 曾使用 `b7c9451` 的关联链 bundle；后续历史窗口曾切换为
`398be8e`，对应记录见 [`release/398be8e-production-acceptance-2026-08-19.md`](release/398be8e-production-acceptance-2026-08-19.md)。
当前新 API release 为 `5a31427`，当前切换记录见
[`release/5a31427-production-acceptance-2026-08-21.md`](release/5a31427-production-acceptance-2026-08-21.md)。
生产审计必须使用当前 release 同版本的 `p0-log-aggregate.mjs` 与 `p0-business-evidence-audit.mjs`，不能把历史窗口的
“当前线上”措辞或旧版本摘要当作当前状态。
从 `b7c9451` 这一版本开始，生产 P0 证据必须由同一 release 的 `p0-log-aggregate.js` 生成 `correlation` 摘要，
再交给同一 release 的 `p0-business-evidence-audit.js` 检查同链业务请求、业务成功、HTTP `2xx` 和失败冲突。
旧 release 生成的没有 `correlation` 字段的摘要不能与新门禁混用；它们只能按历史运行观察理解。

示例（只输出安全计数和缺失项）：

```bash
sudo journalctl -u hospital-platform-api-v2.service \
  --since '2026-08-17 00:00:00' --until '2026-08-17 23:59:59' \
  -o json --no-pager | \
  /home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-log-aggregate.js" \
  --json > /tmp/p0-summary.json

/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentRecords
```

预约目录的科室与排班是两个独立的只读证据域，必须分别执行：

```bash
/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentDepartments

/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/p0-business-evidence-audit.js" \
  --file /tmp/p0-summary.json --domain appointmentSchedules
```

不能把 `appointment.directory.departments.synced` 当作排班成功，也不能因为左栏成功就掩盖右栏排班的
Provider/HTTP 失败；只有两个域分别通过同链请求、成功事件和 HTTP `2xx` 门禁，才能记录预约目录只读链路完整。

`p0-business-evidence-audit` 不读取原始日志，不输出 trace、requestId、患者标识、金额或 Provider 原文；
它也不会把失败请求从统计中删除。输出中的 `failureCount` 大于零时，只能说明该域同时出现过失败，
不能把 `passed=true` 解读成所有请求均成功。

## 维护要求

日志不是审计数据库，也不是业务状态存储。关键业务结果必须落库或进入 outbox，日志只提供可检索的诊断线索。新增支付、医保、HIS 适配器时，至少补充：开始、成功、失败/重试三个阶段的事件，并使用请求链路标识和内部业务 ID 串联；外部请求内容只记录经过筛选的摘要。
