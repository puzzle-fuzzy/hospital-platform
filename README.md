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

当前仓库进入 Phase 6E-3：在 Phase 5A-2 的 MySQL/Redis 真实持久化验收、Phase 5B-1
的 provider 审计、微信身份 adapter 之上，已完成微信支付 APIv3 的请求签名、响应验签、
JSAPI 下单、订单查询和通知 AES-256-GCM 解密边界，并开始固化医保 6201/6202/6203/6301/6401
的路由、金额和退款 contract。微信支付 adapter 已有“完整配置 + 显式闸门”的组合根注入
路径，但默认关闭且缺配置时 fail-closed；医保 crypto 已有严格 port 但尚无真实实现，HIS
provider 继续 fail-closed。
原生小程序首页已经完成健康检查、微信登录、会话恢复和服务端归属患者列表切片，真实
微信开发者工具/真机验收仍未完成。6B 已建立服务端微信预支付参数边界，6C 已为预支付尝试建立
独立幂等记录和受控密文存储，6D 又加入同一幂等键下的服务端状态读模型，6E-1 又加入
微信支付通知的 APIv3 验签、解密、白名单映射、通知去重和入站 outbox；6E-2 又加入
预支付尝试的持久化查单调度、金额二次校验、版本化订单状态迁移、通知 outbox handler 和可注入查单 worker；
API/worker 现已共用 `@hospital/config` 并具备完整配置才启动的 worker 组合根，但
`WECHAT_PAYMENT_READY` 默认关闭，不复制旧项目的前端医保参数拼装、估算金额或 mock 成功状态。

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

本地真实持久化验收：

```powershell
pnpm infra:up
$env:DATABASE_URL = "mysql://hospital:hospital_dev_password@127.0.0.1:3307/hospital_platform"
$env:REDIS_URL = "redis://127.0.0.1:6380"
pnpm db:migrate
pnpm db:integration
pnpm infra:down
```

`db:integration` 只允许 localhost，且会清理随机前缀的本地验收数据；它不替代 staging、
微信、医保、HIS、支付回调或真实设备验收。

`runtime:preflight` 是发布前只读检查，验证运行配置、基础设施连接和 migration manifest；它不会
执行 migration 或发起真实 provider 请求。

支付发布验收按代码、运行、provider 和设备四层区分，执行前请阅读
[`docs/release/payment-acceptance.md`](docs/release/payment-acceptance.md)；本地单测和
`runtime:preflight` 不等于真实微信支付已上线。

API 默认运行在 `http://localhost:3000`：

- `GET /health/live`：存活检查
- `GET /health/ready`：依赖与 schema gate 就绪检查（`not_configured` 或 `unavailable` 不会伪装成 ready）
- `GET /api/v1/system/ping`：API 版本检查
- `POST /api/v1/payments/orders/:orderId/wechat-prepay`：仅在订单为 `cash_pending` 且微信支付闸门打开时返回服务端签名参数
- `GET /api/v1/payments/orders/:orderId/wechat-prepay`：读取 `not_started/pending/ready/unknown` 预支付尝试状态
- `POST /api/v1/payments/wechat/notifications`：接收已验签的微信支付成功通知并返回 provider ack
- `GET /openapi`：OpenAPI 文档

worker 进程组合和通知 outbox 消费核心已经接入，但真实数据库/provider 配置运行、微信开发者工具/公网
回调和真机支付验收仍未完成；这些边界在没有真实证据前不会标记为 ready。

## 重构边界

患者端只访问本 API；医保、众阳、云健康、微信支付和 AI 服务均通过后端 adapter 访问。支付最终状态以服务端回调/查单/HIS 回写证据为准，前端调起支付成功不等于业务完成。
