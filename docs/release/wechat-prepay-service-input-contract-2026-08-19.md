# 微信预支付服务层输入边界（2026-08-19）

## 目的

预支付 HTTP 路由由 Elysia 校验路径参数和幂等请求头，但 `WechatPrepayService.create/read` 也可能被组合根、回放任务或未来
Worker 直接调用。服务层不能把 TypeScript 输入类型当作运行时事实。

## 固定规则

- `ownerUserId`、`orderId`、`idempotencyKey`、`traceId` 必须是非空、无控制字符且不超过平台 opaque 标识上限的字符串；
- 创建输入的 `context` 必须是非数组对象，并且包含合法的 `traceId` 与 `idempotencyKey`；
- 读取输入和创建输入都必须在访问订单仓储前完成校验；
- 畸形输入复用既有 `PaymentOrderInputError`，公共响应保持 `400 payment-order-invalid`；
- 该校验不代表订单允许现金支付，不代表微信支付成功，也不打开医保、结算、回调或 HIS 回写。

## 为什么支付服务也要校验

HTTP schema 只能保护 HTTP 入口。内部调用若传入 `null` 或数组，直接读取 `input.ownerUserId` 会产生未映射的 TypeError/500；
异常幂等键或链路字段若进入仓储，还可能污染支付尝试的唯一键和日志关联。服务层先收敛形状，后续仍按订单状态、服务端身份、金额和 Provider gate
逐层 fail-closed。

## 证据与边界

- 回归验证畸形创建/读取输入返回 `PaymentOrderInputError`；
- 回归验证订单仓储和微信 Provider 调用次数均为 0；
- 本次没有改变支付状态机、金额来源、微信签名、医保授权、查单、回调或线上 release；真实支付仍按路线图最后处理。
