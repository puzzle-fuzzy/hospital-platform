# Hospital Platform

医院小程序平台的全新 TypeScript/Bun 重构仓库。

## 技术基线

- `pnpm` 管理 monorepo
- `Turbo` 编排 workspace 任务
- `Bun + Elysia` 承载 API 服务
- `Biome` 负责格式化与静态检查
- 原生微信小程序：WXML、WXSS、JavaScript
- MySQL、Redis 和医保/HIS/微信支付适配层保持独立边界

## 当前阶段

当前仓库进入 Phase 7D：已建立 Phase 5A-2 的 MySQL/Redis 真实持久化验收脚本，并在其上完成
Phase 5B-1 的 provider 审计、微信身份 adapter，以及微信支付 APIv3 的请求签名、响应验签、
JSAPI 下单、订单查询和通知 AES-256-GCM 解密边界，并开始固化医保 6201/6202/6203/6301/6401
的路由、金额和退款 contract。微信支付 adapter 已有“完整配置 + 显式闸门”的组合根注入
路径，但默认关闭且缺配置时 fail-closed；医保 crypto 已有严格 port 但尚无真实实现，HIS
provider 继续 fail-closed。
原生小程序已经完成健康检查、微信登录、会话恢复、服务端归属患者列表、预约/报告只读工作台，
并将会话生命周期和日期/读模型编排拆到独立 service；gated LIS opaque report detail 页面也已接入。
微信授权登录现在已经形成可部署的首个业务闭环：小程序只提交 `wx.login` code，服务端完成 code2session、
内部用户幂等映射和 Redis TTL 会话；生产是否可登录仍需真实 AppID/AppSecret、schema、Redis、合法域名和真机证据。
详细启用、日志和回滚步骤见 [`docs/wechat-auth-login.md`](docs/wechat-auth-login.md)。真实微信开发者工具/真机验收仍未完成。
6B 已建立服务端微信预支付参数边界，6C 已为预支付尝试建立
独立幂等记录和受控密文存储，6D 又加入同一幂等键下的服务端状态读模型，6E-1 又加入
微信支付通知的 APIv3 验签、解密、白名单映射、通知去重和入站 outbox；6E-2 又加入
预支付尝试的持久化查单调度、金额二次校验、版本化订单状态迁移、通知 outbox handler 和可注入查单 worker；
API/worker 现已共用 `@hospital/config`，worker 还会在进入循环前核对 MySQL 与目标 schema；预约目录、预约历史和 LIS/PACS/ECG 报告摘要也已建立独立 gate，但
`WECHAT_PAYMENT_READY` 默认关闭，不复制旧项目的前端医保参数拼装、估算金额或 mock 成功状态。
预约只读排班现在由 API 生成 opaque 平台 `scheduleId`，并写入带 provider request id、观察时间
和 TTL 的服务端快照，作为未来锁号/预约写入前的必要事实；这不等于已经取得 provider 写入
合同，也没有注册任何预约写入 API。

```text
apps/
  api/                 Elysia API 服务
  miniprogram/         原生微信小程序壳
  worker/              异步任务与回调处理进程（骨架）
packages/
  contracts/           HTTP/API 契约与 TypeBox schema
  domain/              与框架无关的领域状态机和端口
  adapters/            provider contract、HTTP 边界与可替换外部适配器
  persistence/         MySQL/Redis 端口、migration、事务 repository 与集成验收
```

## 开发

```bash
pnpm install
pnpm dev
pnpm check
```

`pnpm architecture:audit` 会在完整校验前检查不可妥协的架构边界：Pino 日志入口、schema
gate、fail-closed 组合根、预约只读路线以及原生小程序 provider 隔离。它是静态漂移检查，
不能替代 `db:integration`、provider smoke、开发者工具或真机验收。

本地真实持久化验收：

```powershell
pnpm infra:up
$env:DATABASE_URL = "mysql://hospital:hospital_dev_password@127.0.0.1:3307/hospital_platform"
$env:REDIS_URL = "redis://127.0.0.1:6380"
pnpm db:migrate
pnpm db:schema
pnpm db:integration
pnpm infra:down
```

完整的层级边界、结构化日志事件、失败恢复和证据记录模板见
[`docs/release/persistence-acceptance.md`](docs/release/persistence-acceptance.md)。

`db:integration` 只允许 localhost，且会清理随机前缀的本地验收数据；它不替代 staging、
微信、医保、HIS、支付回调或真实设备验收。

`db:schema` 是只读 schema probe，只核对 migration history、关键表/列/索引和 owner 外键；
它不执行 migration、不修改 schema gate，也不检查 provider 配置。

`runtime:preflight` 是发布前只读检查，验证运行配置、基础设施连接、migration manifest 和关键 schema invariants；它不会
执行 migration 或发起真实 provider 请求。

API 进程自身的最小运行 smoke：

```powershell
$env:HOSPITAL_API_BASE_URL = "http://127.0.0.1:3000"
$env:HOSPITAL_ALLOW_LOCAL_HTTP = "true"
pnpm runtime:smoke
```

它只访问 `health/live`、`health/ready` 和 `system/ping`，不需要平台 token，也不触碰业务写入。
开发观察模式下 `ready=not_ready` 会记录 warning；发布验收设置
`$env:HOSPITAL_RUNTIME_REQUIRE_READY = "true"`，此时未 ready 会返回失败。

真实 provider 只读验收通过平台 API smoke 执行：

```powershell
$env:HOSPITAL_API_BASE_URL = "https://<hospital-api-host>"
$env:HOSPITAL_ACCESS_TOKEN = "<platform-access-token>"
$env:HOSPITAL_PATIENT_ID = "<internal-patient-id>"
# 可选：报告详情验收会先读取目录，再使用返回的 opaque reportId 读取 LIS 详情。
# $env:HOSPITAL_SMOKE_CAPABILITIES = "reports,report-detail"
pnpm provider:smoke
```

smoke 只执行 GET、默认要求 HTTPS，并使用 Pino 输出结构化验收日志。

支付发布验收按代码、运行、provider 和设备四层区分，执行前请阅读
[`docs/release/payment-acceptance.md`](docs/release/payment-acceptance.md)；本地单测和
`runtime:preflight` 不等于真实微信支付已上线。

众阳患者/预约/报告目录的四层验收请阅读
[`docs/release/provider-directory-acceptance.md`](docs/release/provider-directory-acceptance.md)；
provider gate 配置完整不等于真实 provider 已授权或真机可用。

预约写入、锁号、取消和挂号费仍处于合同冻结状态，目标边界见
[`docs/appointment-write-contract-v1.md`](docs/appointment-write-contract-v1.md)；当前不会
把旧小程序的 provider 身份、金额或支付字段重新包装成新 API。

API 默认运行在 `http://localhost:3000`：

- `GET /health/live`：存活检查
- `GET /health/ready`：依赖与 schema gate 就绪检查（`not_configured` 或 `unavailable` 不会伪装成 ready）
- `GET /api/v1/system/ping`：API 版本检查
- `GET /api/v1/me`：验证当前平台会话，只返回内部用户 ID
- `POST /api/v1/payments/orders/:orderId/wechat-prepay`：仅在订单为 `cash_pending` 且微信支付闸门打开时返回服务端签名参数
- `GET /api/v1/payments/orders/:orderId/wechat-prepay`：读取 `not_started/pending/ready/unknown` 预支付尝试状态
- `POST /api/v1/payments/wechat/notifications`：接收已验签的微信支付成功通知并返回 provider ack
- `GET /api/v1/appointments/departments`：读取服务端白名单后的预约科室目录
- `GET /api/v1/appointments/schedules`：按最多 31 天范围读取服务端白名单后的排班目录
- `GET /api/v1/appointments/records`：按内部 `patientId` 和最多 366 天范围读取脱敏预约历史摘要
- `GET /api/v1/payments/outpatient/records`：按内部 `patientId` 读取门诊待缴/已缴费用摘要；当前只读，不启动支付或医保结算
- `GET /api/v1/reports`：按内部 `patientId` 和最多 366 天范围读取 LIS/PACS/ECG 报告摘要目录
- `GET /api/v1/reports/:reportId`：读取服务端短期引用对应的 LIS 白名单详情；独立 gate 默认关闭
- `GET /openapi`：OpenAPI 文档

本地 API 直接使用 `/api/v1`；公网新服务通过阿里云 Nginx 使用 `/api/v2`，并映射到新 API 的 `/api/v1`。
原生小程序生产配置使用 `apiBaseUrl=https://test-hp.meiyi.pro` 和 `apiPrefix=/api/v2`，不要把两个前缀重复拼接。

worker 进程组合和通知 outbox 消费核心已经接入，但真实数据库/provider 配置运行、微信开发者工具/公网
回调和真机支付验收仍未完成；这些边界在没有真实证据前不会标记为 ready。

部署、日志和回滚入口：

- [`docs/wechat-auth-login.md`](docs/wechat-auth-login.md)：微信授权登录唯一实施与验收手册
- [`docs/logging.md`](docs/logging.md)：Pino 事件、脱敏和 journald 检索规范
- [`infra/systemd/README.md`](infra/systemd/README.md)：新服务 systemd 部署边界
- [`infra/nginx/test-hp.meiyi.pro.conf.example`](infra/nginx/test-hp.meiyi.pro.conf.example)：公网 v2 路由模板

## 重构边界

患者端只访问本 API；医保、众阳、云健康、微信支付和 AI 服务均通过后端 adapter 访问。支付最终状态以服务端回调/查单/HIS 回写证据为准，前端调起支付成功不等于业务完成。
