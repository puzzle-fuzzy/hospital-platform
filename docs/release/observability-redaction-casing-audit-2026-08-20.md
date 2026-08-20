# 日志脱敏字段大小写与患者身份变体审计（2026-08-20）

## 结论

新项目继续使用 Pino 作为唯一结构化日志实现。本轮发现并修正了一个可确定的维护与安全缺口：Pino 的 redact 路径按字段名区分大小写，原有清单主要覆盖小写 HTTP 头和常见患者字段；如果手工诊断对象或 Provider SDK 使用标准大小写字段，凭证和医疗身份字段可能绕过最终序列化兜底。

本轮只修改 `packages/observability` 的脱敏清单和回归测试，没有调用 Provider、没有修改线上配置、MySQL、Redis 或旧 Python 服务，也没有改变任何业务路由的开放状态。

## 已补齐的边界

| 类别 | 新增兜底 |
| --- | --- |
| HTTP 凭证 | `Authorization`、`Cookie`、`Set-Cookie` 及嵌套标准大小写字段 |
| 幂等键 | `Idempotency-Key`、`IDEMPOTENCY-KEY` 及嵌套字段 |
| 患者身份 | `idCard`、`IDCard`、`IDCardNo`、`identityCard` 及下划线变体 |
| 患者个人信息 | `birthday`、`addr`、`address`、联系证件/电话、居民索引号和母亲信息 |

清单同时保留原有小写字段和一级嵌套通配路径。日志调用方仍然不得直接记录请求体、Provider 原始响应或完整异常消息；redact 只是最后一道序列化兜底，不能替代业务日志白名单。

## 代码与验证

- `packages/observability/src/index.ts`：集中维护大小写敏感的 Pino redact 路径，并用中文注释说明为什么不能依赖 Node 头字段自动小写。
- `packages/observability/src/index.test.ts`：使用合成凭证、患者证件、地址和生日验证顶层与嵌套字段均输出 `[REDACTED]`。
- `bun test packages/observability/src/index.test.ts`：4 项通过，0 项失败。
- `pnpm --filter @hospital/observability typecheck`：通过。
- `pnpm exec biome check packages/observability/src/index.ts packages/observability/src/index.test.ts`：通过。

## 验收边界

本记录只证明新项目本地日志序列化边界，不等于线上 release 已更新，也不等于真实微信、患者、Provider、支付或医保业务已验收。后续切换新 API 时仍需检查启动日志、HTTP 请求链和 journald 聚合；旧 Python `8001` 继续保持不触碰。
