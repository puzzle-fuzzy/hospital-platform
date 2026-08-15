# Hospital Platform Architecture

## 目标

把旧项目中的患者端、管理端、外部医院系统适配、医保支付和 AI 能力拆成清晰边界，先保证真实支付链路的可验证性，再逐步替换页面和后台能力。

## 边界

```text
Native Mini Program
        |
        v
Elysia API / contracts
        |
  domain services
  /    |      \
 DB  Redis   workers
        |
 adapters: Zhongyang / Medical Insurance / WeChat Pay / YunHealth / AI
```

- 小程序不持有商户私钥、APIv3 密钥、医保转发凭证或外部系统授权。
- 外部系统的请求格式、签名、加密和重试都收敛到 adapter。
- domain 不依赖 Elysia、数据库或具体供应商，便于用状态机测试。
- API 只负责鉴权、输入校验、调用 domain、返回契约化结果。
- 回调、查单、重试和 HIS 回写必须支持幂等；未知状态不能自动判定失败。
- 只读 provider 结果若将来参与写入前置校验，必须先落成带 TTL 的服务端快照；快照本身不等于写入授权。

## 目标代码布局

```text
apps/
  api/
    src/
      modules/       # 按患者、支付、管理等业务域拆分的 Elysia controller
      infrastructure/ # readiness、日志、数据库和缓存组合
      plugins/       # request context、auth、错误、OpenAPI 等横切能力
  worker/            # outbox、回调、查单和补偿任务
  miniprogram/       # 原生小程序，不承载 provider 凭证
packages/
  contracts/         # TypeBox schema、响应和跨端契约
  domain/            # 状态机、金额规则和业务 service
  adapters/          # 外部协议实现，不让 provider 污染 domain
  persistence/       # MySQL/Redis port 与实现
```

Elysia 实例之间显式声明依赖：业务模块通过工厂函数接收 service/port，不能从路由文件直接创建数据库连接或读取 provider secret。HTTP controller 只做路由、校验、鉴权和响应映射，状态迁移放在 domain service。

当前已完成的患者端纵向切片：

```text
POST /api/v1/auth/wechat
  -> WechatIdentityGateway
  -> UserIdentityRepository
  -> SessionTokenService

GET /api/v1/patients
  -> Bearer session
  -> PatientRepository.listByOwner(serverUserId)
  -> 脱敏 PatientListResponse

GET /api/v1/me
  -> Bearer session
  -> 只返回平台内部 userId，不返回 provider subject
```

默认组合根使用 fail-closed adapter/repository；只有显式注入 fixture 或真实实现时才允许登录和患者数据链路返回业务成功。这样本地演示可以独立测试，生产环境也不会因为缺少 provider 配置而生成假 token 或假患者数据。

支付订单的第一阶段只建立内部事实，不提前连接 provider：金额以分为单位并校验 `totalFen = insuranceFen + cashFen`；创建使用 `ownerUserId + idempotencyKey` 重放；每次状态变更递增 `version`，持久层需用条件更新避免并发覆盖。医保、查单、通知和 HIS 回写仍由 worker 驱动；微信 JSAPI 预支付是一个受控的同步例外，因为小程序必须即时拿到服务端签名参数，但它只能读取 `cash_pending` 订单、使用独立幂等键、受 provider 闸门保护，绝不把调起成功写成业务成功。

当前已开放的内部订单 API：

```text
POST /api/v1/payments/orders
  body: { patientId, quoteId }
  header: Authorization + Idempotency-Key

GET /api/v1/payments/orders/:orderId
  -> 只允许当前会话 owner 读取

POST /api/v1/payments/orders/:orderId/wechat-prepay
  -> 服务端读取当前用户的 provider subject
  -> 先写入 hp_payment_prepay_attempts 的 pending 事实
  -> 只把 cashFen 交给 WechatPaymentGateway
  -> 成功后保存加密 payParams 和 prepay_id 摘要，再返回 payParams；不推进订单状态

GET /api/v1/payments/orders/:orderId/wechat-prepay
  -> 以同一 idempotency-key 读取尝试状态
  -> 返回 not_started / pending / ready / unknown
  -> 不调用 provider，不把 unknown 推导成 failed

POST /api/v1/payments/wechat/notifications
  -> 读取原始 body，先校验 APIv3 签名，再解密 AES-256-GCM
  -> callback mapper 只允许 TRANSACTION.SUCCESS + orderId + totalFen + transactionId
  -> hp_wechat_payment_notifications 与 payment.wechat-notification.received outbox 同事务去重
  -> HTTP 只返回微信 provider ack；订单状态由后续 worker 依据金额和版本迁移

PaymentReconciliationWorker（持久化驱动）
  -> claimDueForQuery(nextQueryAt <= now, lease)
  -> WechatPaymentGateway.query（查单响应必须包含已验签金额）
  -> PaymentOrderService.reconcileWechatPayment（金额 + version 条件迁移）
  -> 终态清除 nextQueryAt；未知/待确认按 queryAttempts 指数退避

WechatPaymentNotificationHandler（outbox）
  -> 只读取 API 层已验签解密后的白名单事实
  -> 使用 notificationId/providerTransactionId 作为安全证据索引
  -> 复用 PaymentOrderService 做金额 + version 条件迁移
  -> handler 成功后才标记 outbox processed；失败由通用 outbox lease/退避机制重试
```

outbox 与 worker 目前已经有独立端口、内存实现和指数退避测试；Phase 5A 已加入
MySQL/Redis 真实探针、连接关闭生命周期、目标 schema、订单-outbox 同事务 repository、
Redis session store 和本地集成验收脚本；本次审计环境尚未完成 Docker 依赖下的实际执行。
Phase 5B-1 已加入旧 provider 调用链审计、
contract v1 和微信身份 code2session adapter；Phase 5B-2 又加入微信支付 APIv3 的
请求签名、平台响应验签、JSAPI 下单、查单和通知解密 adapter。Phase 5B-3 已开始固化
医保 6201/6202/6203/6301/6401 的专用路由、整数分金额守恒、订单关联和退款边界，
但 SM2/SM3/SM4 crypto adapter 只有严格 port 和 fail-closed 默认实现，仍等待 golden
vectors。Phase 6A 已把原生小程序健康检查、微信登录、平台会话恢复和服务端归属患者
列表接入现有 API contract。Phase 6B 又加入微信预支付应用服务和原生端调用封装；Phase 6C 已落库
预支付尝试、版本和加密调起参数，Phase 6D 又加入同一幂等键下的服务端状态读模型，Phase 6E-1
又加入通知入站事实与去重 outbox，Phase 6E-2 又加入 `nextQueryAt`、`queryAttempts`、查单金额校验
和版本化订单迁移；微信支付 adapter 只在完整配置和显式 `WECHAT_PAYMENT_READY`
下由组合根注入，`WECHAT_IDENTITY_READY` 也默认关闭，医保和 HIS handler 尚未接入；因此默认运行不会产生真实支付副作用。
Phase 6E-3 又加入通知 outbox handler、共享 `@hospital/config` 和 worker 真实组合根；worker 只有在
持久化 schema、数据库密钥、完整微信支付 APIv3 配置以及 MySQL/schema 启动探针都通过时才进入 `ready`；
配置不完整为 `not_configured`，依赖探针失败为 `not_ready`。
这证明了组合边界和 fail-closed 行为，但不等于已经用真实商户配置运行过 provider。
API `/health/ready` 同时检查 MySQL、Redis、`PERSISTENCE_SCHEMA_READY` 和目标 migration
只读探针；schema probe 除 migration history 外还核对关键表、列、owner-scoped 索引和复合外键。
配置闸门关闭、migration 实际不完整或关键结构缺失时，即使基础设施连接可用也不会对发布平台报告 `ready`。
API 组合根也只有在启动时 schema probe 为 `ok` 才注入 MySQL repositories，避免业务路由使用未完成
migration 的持久化边界。

预约排班只读链路还会把 provider 返回的排班快照写入
`hp_appointment_schedule_snapshots`，保存受限的 provider 引用、provider request id、
观察时间和过期时间。当前快照只用于后续合同审计和写入前复核，不能由小程序直接提交来
授权锁号；真正开放预约写入前仍必须补齐 sourceId、锁号 TTL、费用、幂等、超时查询和取消
状态矩阵，并新增独立 gate。

原生小程序的功能边界：

- `wx.login()` 只把临时 code 发给 `/api/v1/auth/wechat`，小程序不接触 openid、session_key 或 AppSecret；
- access token 只用于 Hospital API，会话失效时最多重新登录一次，避免无限重试；
- 患者列表的 owner 由服务端会话解析，小程序不提交 ownerUserId，也不接受 provider 原始身份字段；
- 原生端页面只负责交互和状态；会话生命周期由 `session-service.js` 管理，预约/报告日期窗口和读模型由
  `dashboard-service.js` 编排，避免页面直接拼接 provider 参数；
- 报告详情只接受服务端生成的 opaque `reportId`，只展示 LIS 白名单检测项；没有详情引用时保持摘要只读；
- 当前首页只证明代码路径和 API contract 可用，不证明真实微信账号、HTTPS 域名、开发者工具或真机网络已验收。

微信支付 adapter 的安全边界如下：

- APIv3 私钥、平台公钥和 APIv3 密钥只通过服务端组合根注入，不允许进入 contracts、日志、outbox 或小程序。
- APIv3 请求签名使用发送前的原始 JSON 字节；响应必须校验证书序列号、时间窗口、nonce 和 RSA-SHA256 签名。
- 通知必须先校验 APIv3 签名，再解密 `AEAD_AES_256_GCM` resource；解密结果还需要由 callback mapper 做业务字段白名单校验。
- `prepay_id` 只代表微信预支付凭证；小程序调起成功、查单成功和业务订单完成仍是不同事实，最终状态必须由回调/查单/HIS 回写编排。
- `POST .../wechat-prepay` 只在完整支付配置显式打开后调用微信下单；默认组合根使用 fail-closed gateway，未配置时返回 503。
- `hp_payment_prepay_attempts` 不把 `prepay_id` 明文写入数据库；`payParams` 使用部署注入的 AES-256-GCM 密钥保护，没有 `PAYMENT_DATA_ENCRYPTION_KEY` 时 repository fail-closed。
- `hp_wechat_payment_notifications` 只保存验签解密后的白名单摘要；同一 `notification_id` 或微信交易号不会重复制造 outbox 事件。
- 查单响应中的 provider `amount.total` 必须与订单 `cashFen` 一致；不一致只能进入 `awaiting_confirmation`，不能标记为已支付。
- 订单状态迁移和查单尝试调度都使用版本条件更新；claim lease 通过数据库 transaction + `SKIP LOCKED` 防止多副本重复领取，并递增 attempt version 隔离过期 worker，进程重启后仍以数据库 `nextQueryAt` 和过期 lease 为准。

Provider 事实与未完成项集中记录在 [provider-contract-v1.md](provider-contract-v1.md)，
避免把身份、支付、医保加密和 HIS 回写混成一个不可审计的“大 adapter”。

## 支付状态机

```text
created
  -> authorized
  -> pre_settled
  -> insurance_submitted
  -> insurance_settled
  -> cash_pending
  -> cash_paid
  -> his_written_back
  -> completed
```

每一步都记录外部单号、请求摘要、响应摘要、幂等键和 trace id。金额的权威来源是医保/支付真实返回，不从前端金额或旧缓存推算。

## 迁移顺序

1. 保留现有 MySQL/Redis，先建立 contracts 和 adapter port。
2. 迁移微信登录、患者和挂号查询。
3. 迁移医保授权、6201/6202、微信支付和 HIS 回写状态机。
4. 以原生小程序替换登录、就诊人、挂号和支付主链路。
5. 迁移报告、健康知识、便民服务和 AI。
6. 最后拆出管理后台与运维接口。

## 明确不在第一阶段做的事

- 不同时替换数据库。
- 不把外部协议字段原样暴露给患者端。
- 不把 mock/估算结果当成真实支付结果。
- 不在 Bun 中盲目重写尚未验收的 Java/医保密码学实现。
