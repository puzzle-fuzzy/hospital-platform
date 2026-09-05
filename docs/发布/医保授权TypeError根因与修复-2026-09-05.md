# 医保授权 TypeError 根因与修复记录

> 记录时间：2026-09-05（Asia/Shanghai）。本文只记录排障结论和可复核的代码边界，不记录 token、身份证号、卡号、患者姓名、完整请求体或 Provider 原始报文。

## 现象

线上接口 `POST /api/v1/payments/medical-insurance/authorize` 返回 `500`，小程序展示“服务器内部错误”。
服务端失败事件只有 `errorName=TypeError`、`errorCode=UNKNOWN`，没有产生
`medical-insurance.authorization.requested`，因此失败发生在真正调用医保 6201 之前。

当时 API 和 Worker 均为 `active`，数据库、Redis、Schema readiness 均为 `ok`；众阳患者目录和患者档案查询也能返回合法响应，排除登录、就诊人目录和众阳患者接口不可用。

## 根因

`packages/persistence/src/runtime.ts` 的 MySQL 连接池显式使用了：

```ts
dateStrings: true
```

这意味着 MySQL `DATETIME(3)` 读取结果是字符串。但
`packages/persistence/src/mysql-repositories.ts` 的医保订单映射 `miOrder()` 仍把以下字段当作 `Date`：

- `created_at`
- `updated_at`
- `revs_token_expires_at`

授权流程为了幂等性会先读取已有医保订单；读取到该订单后调用字符串的 `.toISOString()`，于是产生原生 `TypeError`。
异常发生在授权日志和 6201 调用之前，所以前端只能收到通用 `10900`。

## 已处理

已在 `miOrder()` 内统一调用已有的 `mysqlUtcDateTimeToIso()`，并同步修正 `MIRow` 的运行时类型为字符串：

1. `DATETIME(3)` 只在 persistence 边界按 UTC 解释；
2. 领域层继续只接收 ISO 时间字符串；
3. 非法时间值会在 persistence 边界明确失败，不再出现原生类型错误；
4. 已完成 persistence 和 API typecheck，以及 API bundle 构建。

## 复核要点

后续重新测试同一预约时，服务端日志应按以下顺序出现：

```text
medical-insurance.authorization.requested
<医保 adapter 的 6201 请求/响应事件>
medical-insurance.authorization.completed 或明确的 Provider 失败事件
http.request.completed 或带稳定错误码的 http.request.failed
```

如果再次失败，先按同一 `traceId/requestId` 查询服务端 journald；不能只根据小程序的“服务器内部错误”判断为医保机构拒绝。

## 发布复核与运行时补充

本次修复提交 `3defdeed1e390a0cc3bd97c6f0b09a3dae1b368c` 已上传到独立 release，API bundle
SHA-256 为 `85abf12bba3dc60d3d4dc3fa65324da2a5209eda50a23b99a3393c7780e78d15`，并完成原子切换。
切换过程中发现目标机的 systemd 沙箱会让 Bun 默认临时目录不可写；仅设置 `TMPDIR/TMP/TEMP`
无效，必须在生产 `shared/api.env` 增加：

```text
BUN_TMPDIR=/home/ps/code/hospital-platform/shared/tmp
```

该目录已创建并限制为 `0700`。补充后 API 以新 release 稳定启动，`/health/ready` 返回
`database=ok`、`redis=ok`、`schema=ok`，18081 正常监听。该问题属于部署运行时配置，不是本次
医保授权业务代码的根因；后续候选发布必须同时检查 Bun 临时目录，避免把启动失败误判成业务接口错误。
