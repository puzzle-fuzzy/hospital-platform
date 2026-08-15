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

当前仓库进入 Phase 5B-2：在 Phase 5A-2 的 MySQL/Redis 真实持久化验收和 Phase 5B-1
的 provider 审计、微信身份 adapter 之上，已完成微信支付 APIv3 的请求签名、响应验签、
JSAPI 下单、订单查询和通知 AES-256-GCM 解密边界。支付 adapter 尚未接入默认组合根，
因此不会产生真实支付副作用；医保和 HIS provider 继续 fail-closed，不复制旧项目的
前端医保参数拼装、估算金额或 mock 成功状态。

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

API 默认运行在 `http://localhost:3000`：

- `GET /health/live`：存活检查
- `GET /health/ready`：依赖就绪检查（`not_configured` 或 `unavailable` 不会伪装成 ready）
- `GET /api/v1/system/ping`：API 版本检查
- `GET /openapi`：OpenAPI 文档

## 重构边界

患者端只访问本 API；医保、众阳、云健康、微信支付和 AI 服务均通过后端 adapter 访问。支付最终状态以服务端回调/查单/HIS 回写证据为准，前端调起支付成功不等于业务完成。
