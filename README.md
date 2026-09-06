# Hospital Platform

医院小程序平台的全新 TypeScript/Bun 重构仓库。

## 技术基线

- `pnpm` 管理 monorepo
- `Turbo` 编排 workspace 任务
- `Bun + Elysia` 承载 API 服务
- `Biome` 负责格式化与静态检查
- 原生微信小程序：WXML、WXSS、TypeScript 源码（构建后生成微信运行所需的 JavaScript）
- MySQL、Redis 和医保/HIS/微信支付适配层保持独立边界

## 当前状态（2026-09-06）

> 当前状态以本地 checkout 为准：分支为 `main`，HEAD 为 `da087be0c4d42a7ac5b62eec33f10f9692153333`，本地比 `origin/main` 超前 5 个提交；本次同步前工作区已有 6 个已跟踪文件存在未提交改动。本 README 更新不会替这些改动执行 commit，也不代表代码已经 push 完成。
>
> 本次只同步文档，不执行服务器部署、服务重启、数据库迁移或真实 Provider/医保/微信请求。线上 `test-hp.meiyi.pro` 的实际版本必须通过 `3090-local` 上的 release、systemd、公网 readiness 和业务日志证据单独确认，不能由 Git 状态推断。

当前仓库已经从“只读骨架”进入“统一支付核心 + 受控业务入口”阶段。最新代码已落地主小程序的预约写入、取消、详情和患者手动添加/绑定入口；新版 API 也注册了挂号自费、医保授权/费用/结算、医保混合支付和门诊费用只读接口。这里的“已落地/已注册”只表示代码和契约存在，不等于 Provider、数据库 schema、商户权限、线上 release 或真机业务已经验收；缺少证据时继续 fail-closed。

### 当前可用代码边界

| 模块 | 当前实现 | 当前限制 |
| --- | --- | --- |
| `apps/api` | Bun + Elysia API、会话、患者目录/同步/手动绑定入口、预约目录/排班、预约写入/取消/详情、挂号自费、医保支付、门诊费用只读、报告和结构化日志 | 生产可用性以运行时 gate、实际数据库/schema、Provider 合同、商户权限、回调和线上 release 证据为准；路由注册不代表业务已验收 |
| `apps/miniprogram` | 43 个原生微信页面；微信登录、会话恢复、就诊人选择/同步、患者绑定表单、预约目录/排班、主小程序预约写入/取消/详情、挂号记录、门诊费用列表/详情等链路 | 患者 Provider 查档/建档/绑卡、临床 Provider、实时叫号、未确认内容和主项目内支付入口仍按各自 gate 处理；支付由独立测试小程序承载 |
| `apps/miniprogram-pay` | 挂号支付测试端：固定“内科风湿 + 后天优先/大后天顺延 + 上午 + 可用号源”，支持医保支付、医保混合支付、自费支付三条分支 | 真实医保/微信支付是否可调用由服务端配置和 Provider 验收决定；用户取消支付时保留预约和待支付上下文，不重复挂号 |
| `apps/miniprogram-outpatient-pay` | 门诊支付测试端：登录、选择就诊人、读取待缴/已缴费用列表和已核对的摘要详情 | 当前只读，不创建门诊支付订单，不调用医保结算；门诊支付写入需先冻结正式 contract |
| `apps/worker` | 医保订单/微信通知 outbox 的查单与补偿执行骨架、生产日志和 schema 前置检查 | 是否在线运行、是否接管生产订单必须通过服务器上的 systemd 和日志证据确认 |

### 挂号支付测试端的实际流程

`miniprogram-pay` 不使用“一条窄的快速挂号编排接口”，而是按业务阶段调用新版平台 API：

```text
POST /appointments/holds
  → POST /appointments/registrations
  → 医保授权小程序回跳 authCode（医保/混合支付）
  → POST /payments/medical-insurance/authorize
  → POST /payments/medical-insurance/orders/{orderId}/fees
  → POST /payments/medical-insurance/orders/{orderId}/settle
  → 需要自费时 POST /payments/medical-insurance/orders/{orderId}/wechat-pay
  → 纯自费时 POST /payments/appointments/{appointmentId}/self-pay
  → 服务端查单确认最终状态
```

服务端会在预约写入前检查重复预约；重复时不会再次挂号，用户确认后才调用独立取消接口，再重新读取号源并重试。医保结算返回自费金额时，纯医保分支不会偷偷切换为混合支付，而是提示用户明确选择医保混合支付。详细接口、状态和日志见 [`docs/miniprogram-pay-三个支付按钮业务说明.md`](docs/miniprogram-pay-三个支付按钮业务说明.md) 与 [`docs/医保支付操作流程图.md`](docs/医保支付操作流程图.md)。

### 安全和运行门禁

- 小程序只提交平台 opaque 的会话、患者、排班、预约和订单引用；众阳患者号、医保凭证、身份证、支付签名和商户密钥只在服务端使用。
- 金额只能来自服务端已保存的预约/费用事实；`wx.requestPayment` 或医保支付调起回调本身不等于业务成功，最终状态以服务端通知、查单和回写为准。
- `.env.example` 中的微信支付、医保、众阳和写入 gate 默认关闭；`configured` 只代表字段齐全，不代表 Provider 已授权或真实业务已通过。
- 服务端日志统一记录 `requestId/traceId`、业务阶段、内部 opaque 标识、Provider 请求号和稳定错误码，不记录授权码、完整费用明细、证件号、支付凭证或原始 Provider 报文。
- 新 API 公网入口为 `https://test-hp.meiyi.pro/api/v2`，应用内部路由为 `/api/v1`；线上部署和旧 Python `8001` 的共存状态必须单独验证。

```text
apps/
  api/                 Elysia API 服务
  miniprogram/         主项目原生微信小程序壳
  miniprogram-pay/     挂号医保/混合/自费支付测试小程序
  miniprogram-outpatient-pay/  门诊费用只读测试小程序
  worker/              异步查单、outbox 与回调处理进程
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

`pnpm check:candidate` 是不依赖当前线上 release 的候选质量门禁，覆盖结构、迁移、契约、文档、日志、格式、lint、工具测试、类型检查、全量测试和构建。
`pnpm check` 会在候选质量门禁之后追加 `release:baseline:audit`，用于确认线上 release、服务端源码和小程序运行包已经完成一致性切换；因此在正常的“候选尚未发布”阶段，前者应通过，后者可以按预期阻断。

`pnpm architecture:audit` 会在完整校验前检查不可妥协的架构边界：Pino 日志入口、schema
gate、fail-closed 组合根、预约只读路线以及原生小程序 provider 隔离。它是静态漂移检查，
不能替代 `db:integration`、provider smoke、开发者工具或真机验收。

`pnpm docs:audit` 会检查 `docs/` 下所有 Markdown 的本地链接是否仍指向仓库内存在的文件；
它不访问外部网站，不能替代 Provider 文档来源、版本和真实接口可用性验收。

`pnpm logging:audit` 会扫描 API、worker 和 packages 的生产 TypeScript/JavaScript 源码，
确认静态 `event` 字面量均已登记在 [`docs/日志规范.md`](docs/日志规范.md)；插值事件必须在文档中说明稳定前缀或事件表，
该审计不会读取或回显真实日志内容，也不能替代敏感字段和线上采集链路验收。

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
[`docs/发布/持久化验收.md`](docs/发布/持久化验收.md)。

`db:integration` 只允许 localhost，且会清理随机前缀的本地验收数据；它不替代 staging、
微信、医保、HIS、支付回调或真实设备验收。

`db:schema` 是只读 schema probe，只核对 migration history、关键表/列/索引和 owner 外键；
它不执行 migration、不修改 schema gate，也不检查 provider 配置。

`runtime:preflight` 是发布前只读检查，验证运行配置、基础设施连接、migration manifest 和关键 schema invariants；它不会
执行 migration 或发起真实 provider 请求。

小程序真机调试前必须先验证运行包：

```powershell
pnpm runtime:verify
```

该命令由根目录转发到 `@hospital/miniprogram`，检查当前来源指纹、注册页面脚本、根文件以及测试脚本隔离。
如果微信开发者工具报错路径包含 `dist/services/*.test.js`，先重新执行 `pnpm --filter @hospital/miniprogram build` 和
`pnpm runtime:verify`，再关闭旧真机调试、重新打开 `apps/miniprogram/dist/` 并生成二维码；不要把测试脚本复制进 `dist/`。

API 进程自身的最小运行 smoke：

```powershell
$env:HOSPITAL_API_BASE_URL = "http://127.0.0.1:3000"
$env:HOSPITAL_ALLOW_LOCAL_HTTP = "true"
# 内网直连默认使用应用内部的 /api/v1；不设置也会采用该默认值。
$env:HOSPITAL_API_PREFIX = "/api/v1"
pnpm runtime:smoke
```

它会访问 `health/live`、`health/ready`、`system/ping`，检查已注册保护路由的未登录
`401/unauthorized` 边界，并检查未配置 Provider/支付闸门时的 fail-closed 响应。探针不携带平台 token、
患者或订单数据，不调用 Provider，也不触碰业务写入；同时会确认两个健康接口的
`Cache-Control` 保留 `no-store`，防止公网代理缓存 readiness 状态。
开发观察模式下 `ready=not_ready` 会记录 warning；发布验收设置
`$env:HOSPITAL_RUNTIME_REQUIRE_READY = "true"`，此时未 ready 会返回失败。

真实 provider 只读验收通过平台 API smoke 执行：

```powershell
$env:HOSPITAL_API_BASE_URL = "https://<hospital-api-host>"
# 公网域名经阿里云 Nginx 转发时必须验收真实的 /api/v2 路径。
$env:HOSPITAL_API_PREFIX = "/api/v2"
$env:HOSPITAL_ACCESS_TOKEN = "<platform-access-token>"
$env:HOSPITAL_PATIENT_ID = "<internal-patient-id>"
# 默认还会读取门诊费用的 unpaid/paid 两种只读状态；支付调起、医保和结算不会被调用。
# 可选：报告详情验收会先读取目录，再使用返回的 opaque reportId 读取 LIS 详情。
# $env:HOSPITAL_SMOKE_CAPABILITIES = "reports,report-detail,outpatient-payments"
pnpm provider:smoke
```

smoke 只执行 GET、默认要求 HTTPS，并使用 Pino 输出结构化验收日志。

支付发布验收按代码、运行、provider 和设备四层区分，执行前请阅读
[`docs/发布/支付验收.md`](docs/发布/支付验收.md)；本地单测和
`runtime:preflight` 不等于真实微信支付已上线。

众阳患者/预约/报告目录的四层验收请阅读
[`docs/发布/Provider目录验收.md`](docs/发布/Provider目录验收.md)；
provider gate 配置完整不等于真实 provider 已授权或真机可用。

预约写入、锁号、取消、挂号自费和医保支付接口已经形成独立的新版 contract 与服务层，
由 [`apps/miniprogram-pay`](apps/miniprogram-pay/README.md) 作为测试入口；门诊支付小程序仍只读。
真实 Provider、医保、微信支付和 HIS 回写仍必须按 [`docs/发布/支付验收.md`](docs/发布/支付验收.md)
完成配置、部署和业务证据，不能把接口已注册当作生产业务已验收。

API 默认运行在 `http://localhost:3000`：

- `GET /health/live`：存活检查
- `GET /health/ready`：依赖与 schema gate 就绪检查（`not_configured` 或 `unavailable` 不会伪装成 ready）
- `GET /api/v1/system/ping`：API 版本检查
- `GET /api/v1/me`：验证当前平台会话，只返回内部用户 ID
- `POST /api/v1/patients/bind`：提交当前账号的就诊人手动添加/绑定命令；查档、建档、绑卡和最终关系确认受独立 Provider gate 控制
- `POST /api/v1/patients/sync`：同步当前账号已存在的就诊人目录
- `GET /api/v1/patients`：读取当前账号 owner-scoped 的脱敏就诊人目录
- `POST /api/v1/payments/orders/:orderId/wechat-prepay`：仅在订单为 `cash_pending` 且微信支付闸门打开时返回服务端签名参数
- `GET /api/v1/payments/orders/:orderId/wechat-prepay`：读取 `not_started/pending/ready/unknown` 预支付尝试状态
- `POST /api/v1/payments/wechat/notifications`：接收已验签的微信支付成功通知并返回 provider ack
- `GET /api/v1/appointments/departments`：读取服务端白名单后的预约科室目录
- `GET /api/v1/appointments/schedules`：按最多 31 天范围读取服务端白名单后的排班目录
- `POST /api/v1/appointments/holds`：校验号源、读取服务端挂号费并创建短期预约占位
- `POST /api/v1/appointments/registrations`：检查重复预约并写入预约
- `POST /api/v1/appointments/registrations/:appointmentId/cancel`：取消当前账号可操作的预约
- `GET /api/v1/appointments/registrations/:appointmentId`：读取当前账号和就诊人范围内的挂号详情
- `GET /api/v1/appointments/records`：按内部 `patientId` 和最多 366 天范围读取脱敏预约历史摘要
- `POST /api/v1/payments/appointments/:appointmentId/self-pay`：创建挂号普通微信自费支付
- `GET /api/v1/payments/appointments/:appointmentId/self-pay`：查询挂号自费订单最终状态
- `POST /api/v1/payments/medical-insurance/authorize`：接收授权码并创建医保订单
- `POST /api/v1/payments/medical-insurance/orders/:orderId/fees`：上传服务端核对的医保费用
- `POST /api/v1/payments/medical-insurance/orders/:orderId/settle`：发起医保结算
- `POST /api/v1/payments/medical-insurance/orders/:orderId/wechat-pay`：创建医保混合支付调起参数
- `GET /api/v1/payments/medical-insurance/orders/:orderId/wechat-pay`：查询医保混合支付结果
- `GET /api/v1/payments/medical-insurance/orders/:orderId`：查询医保订单最终状态
- `GET /api/v1/payments/outpatient/records`：按内部 `patientId` 读取门诊待缴/已缴费用摘要；当前只读，不启动支付或医保结算
- `GET /api/v1/payments/outpatient/records/:recordId`：读取已核对的门诊费用摘要详情；当前只读
- `GET /api/v1/reports`：按内部 `patientId` 和最多 366 天范围读取 LIS/PACS/ECG 报告摘要目录
- `GET /api/v1/reports/:reportId`：读取服务端短期引用对应的 LIS 白名单详情；独立 gate 默认关闭
- `GET /openapi`：OpenAPI 文档

本地 API 直接使用 `/api/v1`；公网新服务通过阿里云 Nginx 使用 `/api/v2`，并映射到新 API 的 `/api/v1`。
原生小程序生产配置使用 `apiBaseUrl=https://test-hp.meiyi.pro` 和 `apiPrefix=/api/v2`，不要把两个前缀重复拼接。

worker 已接入医保订单/微信通知 outbox 的查单与补偿代码，但是否在线运行、是否接管生产订单必须以服务器
systemd 状态和同链日志为准。真实数据库/provider 配置、微信公网回调和真机支付验收仍需单独完成；这些边界在
没有真实证据前不会标记为 ready。

部署、日志和回滚入口：

- [`docs/微信授权登录.md`](docs/微信授权登录.md)：微信授权登录唯一实施与验收手册
- [`docs/日志规范.md`](docs/日志规范.md)：Pino 事件、脱敏和 journald 检索规范
- [`infra/systemd/README.md`](infra/systemd/README.md)：新服务 systemd 部署边界
- [`infra/nginx/test-hp.meiyi.pro.conf.example`](infra/nginx/test-hp.meiyi.pro.conf.example)：公网 v2 路由模板

## 重构边界

患者端只访问本 API；医保、众阳、云健康、微信支付和 AI 服务均通过后端 adapter 访问。支付最终状态以服务端回调/查单/HIS 回写证据为准，前端调起支付成功不等于业务完成。
