# ADR 0001：Bun/Elysia 与 adapter 边界

## 决策

HTTP/API 层使用 Bun/Elysia，所有医院/支付外部协议一律隔离在 port 与 adapter 之后。

## 原因

Elysia 为新 API 提供 Bun 优先的运行时、请求校验、OpenAPI 与端到端类型共享，但它不能替代对旧
Java/FSI 密码实现、Provider 专属签名、重试或回调证据的隔离需求。

## 结果

- 患者客户端只见稳定的应用层 contract，不接触 provider 原始 payload。
- 首轮迁移可以继续使用既有 MySQL/Redis 数据和外部服务。
- Provider adapter 可以用 contract fixture 与回放响应进行测试。
- 在 Bun 无法安全替换既有实现的地方，可以暂时保留 Java/Python sidecar。
