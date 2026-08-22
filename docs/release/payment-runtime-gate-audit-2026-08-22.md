# 支付运行时闸门审计（2026-08-22）

## 结论

本轮发现并修复了一个会扩大支付边界的逻辑缺口：此前微信预支付入口由未配置 gateway
fail-closed，但 `POST /payments/orders` 仍可能在支付配置关闭时读取报价并写入订单/outbox。
这会留下无法完成微信支付、医保结算或 HIS 回写的半成品订单，属于业务状态被提前推进，不能接受。

当前新 API 已将以下入口统一纳入 `wechatPaymentEnabled` 运行时闸门：

- `POST /api/v2/payments/orders`
- `GET /api/v2/payments/orders/{orderId}`
- `GET/POST /api/v2/payments/orders/{orderId}/wechat-prepay`
- `POST /api/v2/payments/wechat/notifications`

闸门关闭时，受保护路由先完成会话认证，再在任何支付仓储/provider 操作前返回
`503 dependency-not-configured`；通知入口则在读取原始 body、验签、解密和通知去重写入前返回。
因此“闸门关闭”不会创建订单或预支付尝试，也不会把支付通知写入 outbox。

## 放行规则

生产组合根只有在以下条件同时满足时才传入 `wechatPaymentEnabled=true`：

1. `WECHAT_PAYMENT_READY=true` 且微信支付商户配置完整；
2. 真实微信支付 APIv3 adapter 已注入；
3. APIv3 通知签名/解密器已注入；
4. 通知入站、查单补偿、金额/状态机、真机和真实环境验收均已完成。

配置字段完整本身不等于支付链路已验收；当前仍按用户要求将真实支付、医保授权、结算、退款和 HIS
写回放在迁移最后处理。

## 代码与测试证据

| 项目 | 证据 |
| --- | --- |
| 统一闸门 | `apps/api/src/modules/payments/index.ts` 的 `ensureWechatPaymentEnabled` |
| 生产放行 | `apps/api/src/index.ts` 仅在真实支付 adapter 与通知解密器同时存在时传入 true |
| 关闭状态无订单副作用 | API 测试验证报价查询次数为 0、订单未写入、创建和读取均为 503 |
| 预支付关闭边界 | API 测试验证未配置状态返回 503 |
| 运行验证 | `pnpm --filter @hospital/api typecheck` 通过；API `210 pass / 0 fail / 865 expect()` |

OpenAPI 仍保留这些路径，是为了冻结客户端契约和未来验收入口，不表示当前线上已开放真实支付。
严禁通过复制旧端字段、客户端金额、provider 单号或临时打开环境变量绕过该闸门。
