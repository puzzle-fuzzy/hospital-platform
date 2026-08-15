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

当前仓库只建立新架构与最小运行闭环，不复制旧项目的直连外部接口、前端医保参数拼装、估算金额或 mock 成功状态。

```text
apps/
  api/                 Elysia API 服务
  miniprogram/         原生微信小程序壳
  worker/              异步任务与回调处理进程（骨架）
packages/
  contracts/           HTTP/API 契约与 TypeBox schema
  domain/              与框架无关的领域状态机和端口
  adapters/            外部医院/支付/AI 适配器（骨架）
```

## 开发

```bash
pnpm install
pnpm dev
pnpm check
```

API 默认运行在 `http://localhost:3000`：

- `GET /health/live`：存活检查
- `GET /health/ready`：依赖就绪检查（当前基础骨架默认未就绪）
- `GET /api/v1/system/ping`：API 版本检查
- `GET /openapi`：OpenAPI 文档

## 重构边界

患者端只访问本 API；医保、众阳、云健康、微信支付和 AI 服务均通过后端 adapter 访问。支付最终状态以服务端回调/查单/HIS 回写证据为准，前端调起支付成功不等于业务完成。
