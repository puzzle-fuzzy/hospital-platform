# 请求日志稳定错误码投影（2026-08-27）

## 背景

本轮线上只读日志复核发现：部分已经被统一错误处理器识别的业务异常，在 Elysia
`onError` 生命周期里仍然收到 `code=UNKNOWN`。HTTP 响应本身已经返回稳定的公开错误码，
但请求日志保留 `UNKNOWN` 会让维护人员无法直接按 `unauthorized`、
`provider-temporarily-unavailable` 等错误码检索和聚合。

这属于可观测性问题，不是让客户端重新定义错误协议，也不是 Provider 业务失败的修复。

## 处理方式

`apps/api/src/plugins/request-logging.ts` 新增稳定错误码投影：

- `HttpError` 直接使用统一错误处理器定义的 `error.code`；
- 可重试的 `ProviderRequestError` 记录为 `provider-temporarily-unavailable`；
- Provider 响应结构非法记录为 `provider-response-invalid`；
- 其他主动拒绝的 Provider 请求记录为 `provider-request-rejected`；
- 未覆盖的异常仍回退到 Elysia 生命周期 code，不改变已有日志行为。

投影只读取错误类型和已存在的分类字段，不读取 message、请求体、患者标识、凭证或
Provider 原始报文；HTTP 响应格式、业务状态机和 Provider 调用策略均不改变。

## 验证

本地已完成：

- `pnpm --filter @hospital/api test src/plugins/request-logging.test.ts src/plugins/error-handler.test.ts`：30 项通过；
- `pnpm --filter @hospital/api test`：218 项通过；
- `pnpm --filter @hospital/api typecheck`：通过；
- 变更文件 Biome format/lint：通过；
- `pnpm logging:audit`：84 个静态日志事件通过；
- `pnpm error:contract:audit`：33 个公开错误契约通过；
- `pnpm --filter @hospital/api build`：通过。

## 发布边界

本文件与代码提交后，必须按照 [`infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)
制作候选 release，并只切换 `hospital-platform-api-v2.service`。发布完成前，线上日志仍可能显示旧
release 的 `errorCode=UNKNOWN`，不能把本地测试结果当成线上已生效。

发布后的验收需要同时确认：新 API readiness、公网 `/api/v2/health/ready`、启动日志中的
`runtimeMode=production`、新 API `18081`、旧 Python `8001` 和 worker inactive；本次不执行
数据库 migration、Redis 清理、支付、医保、HIS 写回或 Provider 业务调用。
