# ADR 0002：Provider adapter contract 与回放 fixture

## 决策

所有医保、微信支付、HIS/众阳、云健康和遗留 FSI 调用必须经过 adapter port。adapter 调用统一接收 `traceId`、`idempotencyKey`、可取消 signal 和 timeout；HTTP 实现统一处理超时、请求头、HTTP 错误和 JSON 解析错误。

新项目提供三种明确语义：

- `createNotConfiguredGateways()`：默认运行时使用，调用时明确失败，不伪造成功。
- `requestJson()`：真实 provider adapter 可复用的 HTTP 边界，不记录敏感请求体。
- `fixtures/replay.ts`：只用于单元/契约测试的合成响应，provider 名称带 `fixture-`，不得注册到生产组合根。

## 原因

旧项目把部分外部请求放在小程序端，并同时存在 Python、Java JAR 和独立 TypeScript 服务。先固定 adapter contract，可以让患者端和支付领域只依赖稳定业务模型，也能在没有真实医保凭证时验证状态迁移、金额守恒、幂等和错误分支。

## 结果

- provider 原始字段、签名、加密和 URL 不会进入 domain。
- 外部请求具备统一的 trace/idempotency/timeout 入口。
- fixture 只能证明代码编排和契约行为，不能证明医保、微信或 HIS 真实成功。
- FSI/Java 加密实现可以暂时保留 sidecar，之后用同一 port 替换。
