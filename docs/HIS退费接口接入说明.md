# HIS 退费接口接入说明

版本：2026-09-29

本文用于 HIS 测试环境联调，只覆盖按医保 `payOrdId` 与微信 `outTradeNo` 发起的两条单腿退费接口。

## 1. 已确认联调地址

测试环境基地址：

```text
https://test-hp.meiyi.pro/api/v2
```

HIS 固定出口 IP：`124.164.248.83`

生产地址、出口 IP 白名单和密钥须由平台另行书面确认。不得将本测试环境地址直接用于生产调用。

平台网关按 TCP 连接的实际来源地址执行白名单校验，并写入转发给应用的 `X-Real-IP`。HIS 只需从上述固定出口发起 HTTPS 请求，**不得自行传入、伪造或依赖 `X-Real-IP` 请求头**。

| 退费腿 | 查找键 | 发起接口 | 查询接口 |
| --- | --- | --- | --- |
| 医保 | `payOrdId` | `POST /his/medical-insurance-leg-refunds/by-pay-ord-id` | `GET /his/medical-insurance-leg-refunds/{refundNo}` |
| 微信现金 | `outTradeNo` | `POST /his/wechat-leg-refunds/by-out-trade-no` | `GET /his/wechat-leg-refunds/{refundNo}` |

表中的 `/his/...` 是相对路径。完整 URL = 上述联调基地址 + 相对路径。

### 1.1 2.27.2.32 结算回传关联号

HIS 已确认：平台在 `2.27.2.32` 结算写回时，将平台 `medicalOrderId`（即兼容接口中的 `orderId`）传入 `outNetworkSettleMain.settleBackNo`。HIS 必须持久化该值，用于按平台订单号的兼容退费入口和结算后对账。

`settleBackNo` 仅是平台订单关联号，不替代本手册两条新接口所需的医保 `payOrdId` 或微信 `outTradeNo`，也不替代 `refundNo`、`out_refund_no`、`transaction_id` 或 HIS 负结算关联字段 `relationId`。

### 1.2 2.27.2.29 自费支付登记关联号

HIS 已确认：平台调用 `2.27.2.29` 自费支付登记接口时，请求字段 `thirdPartPayRecordId` 必须传入根平台订单 `medicalOrderId`（即平台 `orderId`）。HIS 应按该值记录平台订单关联，供支付、结算后的关联和对账使用。

`thirdPartPayRecordId` 不是 HIS 调用本手册医保或微信单腿退费入口的请求参数，不替代医保 `payOrdId`、微信 `outTradeNo`、平台 `refundNo`、微信 `out_refund_no` 或其他退款单号。HIS 在 `2.27.2.29` 返回的 `thirdPartPayRecordId` 回执仅用于平台确认该支付登记已成功、持久化成功断点并避免重放 `2.27.2.29`；不得把该回执当作退费查找键或退款身份。

## 2. 调用前置条件

1. HIS 必须在原支付或结算链路中保存对应外部号：医保单腿退费使用 `payOrdId`，微信现金单腿退费使用 `outTradeNo`。
2. 这两个字段只用于平台查找订单。退费接口不会生成、补全或猜测它们；字段缺失时，请联系平台确认交接链路，不要改用其他业务号。
3. 仅持有外部号不代表可退费。平台会校验原支付、结算事实、金额及当前退费状态。
4. HIS 须在服务端受控保存平台交付的 Token 与 HMAC 密钥，并保持服务器时间同步。密钥、签名、nonce 和支付凭证不得进入前端、业务日志、工单正文或截图。

## 3. 公共请求头

所有 POST 和 GET 请求均须携带以下请求头：

| 请求头 | 要求 |
| --- | --- |
| `X-HIS-Refund-Token` | 平台提供的 HIS 退费 Token |
| `X-HIS-Timestamp` | Unix 时间戳，单位为秒；与平台时间相差不超过 5 分钟 |
| `X-HIS-Nonce` | 每次请求唯一；字符集 `[A-Za-z0-9._:-]`，长度 16 至 128；平台保留 10 分钟防重放 |
| `X-HIS-Signature` | HMAC-SHA256 签名，64 位十六进制字符串 |
| `X-Request-Id` | HIS 请求流水号；字符集 `[A-Za-z0-9._:-]`，长度 1 至 128 |
| `Content-Type` | 固定为 `application/json`，包括 GET |

Token 与 HMAC 密钥是两个不同的值。请求未从 `124.164.248.83` 发出时，平台返回 `403`。

## 4. 签名算法

签名原文由以下六行组成，每行之间使用一个换行符：

```text
HTTP_METHOD
ROUTE_PATH
X-HIS-Timestamp
X-HIS-Nonce
X-Request-Id
BODY_SHA256
```

```text
X-HIS-Signature = lowercase(hex(HMAC-SHA256(HIS_HMAC_SECRET, 签名原文)))
```

`ROUTE_PATH` 以 `/his` 开始，不包含域名和 `/api/v2`。例如：

```text
/his/medical-insurance-leg-refunds/by-pay-ord-id
/his/wechat-leg-refunds/by-out-trade-no
/his/medical-insurance-leg-refunds/RFMIxxxxxxxx
/his/wechat-leg-refunds/RFHISxxxxxxxx
```

`BODY_SHA256` 规则：

- POST：将 JSON 对象的键名按 ASCII 升序递归排序，去除空格后序列化，再计算 UTF-8 SHA-256 小写十六进制值。
- GET：请求体为空，使用空字符串的 SHA-256：

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

签名必须基于实际发送的完整 JSON 请求体计算。完成签名后，不得修改请求体中的字段、空白或编码。

## 5. 医保单腿退费

发起请求：

```http
POST https://test-hp.meiyi.pro/api/v2/his/medical-insurance-leg-refunds/by-pay-ord-id
Content-Type: application/json
```

请求体：

```json
{
  "payOrdId": "医保中心支付订单号",
  "reason": "HIS撤销医保结算"
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `payOrdId` | 是 | 医保中心支付订单号；长度 1 至 64；仅用于定位平台订单 |
| `reason` | 否 | 可省略；若提供，使用不含首尾空白的非空文本，UTF-8 不超过 80 字节，且不含控制字符 |

请求体只允许 `payOrdId` 和可选的 `reason`。HIS 不得提交金额、退款编号、支付凭证或其他医保参数。

成功响应示例：

```json
{
  "success": true,
  "data": {
    "orderId": "平台规范医保订单ID",
    "refundNo": "RFMIxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "status": "succeeded",
    "medicalStatus": "success",
    "wechatStatus": "not_required",
    "amounts": {
      "totalFen": 6039,
      "cashFen": 0,
      "personalAccountFen": 0,
      "fundFen": 6039
    }
  }
}
```

查询请求：

```http
GET https://test-hp.meiyi.pro/api/v2/his/medical-insurance-leg-refunds/{refundNo}
```

## 6. 微信现金单腿退费

`outTradeNo` 是原微信支付的商户订单号，不是微信退款单号 `out_refund_no`，也不是微信支付订单号 `transaction_id`。

发起请求：

```http
POST https://test-hp.meiyi.pro/api/v2/his/wechat-leg-refunds/by-out-trade-no
Content-Type: application/json
```

请求体：

```json
{
  "outTradeNo": "微信原支付商户单号",
  "reason": "HIS撤销微信自费"
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `outTradeNo` | 是 | 已由平台确认并保存的微信原支付商户订单号；长度 1 至 32；仅用于定位平台订单 |
| `reason` | 否 | 可省略；若提供，使用不含首尾空白的非空文本，UTF-8 不超过 80 字节，且不含控制字符 |

请求体只允许 `outTradeNo` 和可选的 `reason`。HIS 不得提交金额、`out_refund_no`、`transaction_id`、退款编号、支付凭证或退款资金参数。

成功或处理中响应示例：

```json
{
  "success": true,
  "data": {
    "orderId": "平台规范医保订单ID",
    "refundNo": "RFHISxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "status": "processing",
    "wechatStatus": "processing",
    "amounts": {
      "totalFen": 11561,
      "cashFen": 11561,
      "personalAccountFen": 0,
      "fundFen": 0
    }
  }
}
```

查询请求：

```http
GET https://test-hp.meiyi.pro/api/v2/his/wechat-leg-refunds/{refundNo}
```

HIS 不直接向微信支付查询退款，也不使用 `out_refund_no` 作为平台查询路径。

## 7. 状态与重试

`data.status` 的可能值及处理方式：

| 状态 | HIS 处理方式 |
| --- | --- |
| `requested` | 已记录但未形成最终结果；保存 `refundNo` 后查询 |
| `processing` | 平台或渠道正在处理；使用原 `refundNo` 查询 |
| `succeeded` | 该退费腿成功；完成该腿对账 |
| `failed` | 该退费腿明确失败；不要据此改变另一条退费腿 |
| `manual_review` | 结果未知或需要人工核验；停止自动重发并联系平台 |

医保腿可返回 `medicalStatus`；微信腿可返回 `wechatStatus`。微信的 `unknown`、`closed`、`abnormal` 不代表可以重新创建退款，必须保留原 `refundNo` 查询或转人工核验。

1. HTTP 超时或连接中断时，不能直接认定退费失败。
2. 已取得 `refundNo` 时，优先调用对应查询接口，不要再次发起 POST。
3. 未取得响应时，可使用同一个查找键重试同一接口；每次必须使用新的 `X-HIS-Timestamp`、`X-HIS-Nonce`、`X-Request-Id` 和签名。
4. 医保和微信是独立退费腿。平台不会因为一条腿成功、失败或未知而自动回滚另一条腿。
5. 同一订单不得将本手册的新接口与既有退费调用并发或交替使用。

## 8. 错误响应

失败响应使用统一封套：

```json
{
  "success": false,
  "error": {
    "code": "validation",
    "numericCode": 10100,
    "message": "请求参数不合法"
  }
}
```

HIS 应以 HTTP 状态码和字符串 `error.code` 决策；`numericCode` 仅用于定位，不应作为业务分支条件。

| HTTP | 常见 `error.code` | HIS 处理 |
| --- | --- | --- |
| `400` | `validation` | 修正字段、订单状态或接口选择后再调用 |
| `401` | `his-unauthorized`、`his-request-expired`、`his-signature-invalid` | 核对 Token、时间戳、相对签名路径、规范 JSON；重新生成时间戳、nonce 与签名 |
| `403` | `his-source-not-allowed` | 确认固定出口 IP 已由平台白名单放行；不要伪造 `X-Real-IP` |
| `404` | `not_found` | 查找键或 `refundNo` 未命中；核对字段交接，不要猜测其他业务号 |
| `409` | `his-replay-detected`、`idempotency_conflict`、`refund_amount_exceeded` | 先查询已有退款；已用 nonce 不可复用 |
| `429` | `his-rate-limited` | 降低频率；后续请求使用新的 nonce、请求号、时间戳与签名 |
| `502` | `provider-request-rejected`、`provider-response-invalid` | 保留关联信息并联系平台处理 |
| `503` | `his-security-unavailable`、`dependency-not-configured`、`provider-temporarily-unavailable` | 依赖暂不可用；如已有 `refundNo`，先查询 |
| 其他 `5xx` | 未预期错误 | 不要盲目重发；保留查找键、`refundNo`（如有）与 `X-Request-Id`，联系平台核验 |

## 9. 联调验收清单

- 平台已确认测试环境路由、HIS 固定出口 IP 白名单、Token 与 HMAC 密钥交付，以及退费安全服务配置。
- HIS 已使用签名自检向量验证 HMAC、UTF-8、规范 JSON 与相对路径处理。
- 医保 `payOrdId` 与微信 `outTradeNo` 均可通过签名校验并返回业务响应。
- 错误签名、过期时间戳、重复 nonce、额外请求字段均被正确拒绝。
- 未命中的 `payOrdId`、`outTradeNo` 与 `refundNo` 均按 `404` 处理；HIS 不猜测替代值。
- 同一查找键在超时后重试不会产生第二个退款身份。
- `processing`、`requested`、`unknown` 等非最终状态能使用原 `refundNo` 查询。
- 日志、工单和截图不包含 Token、HMAC 密钥、签名、nonce、支付凭证或患者隐私数据。

## 10. 术语

| 术语 | 含义 |
| --- | --- |
| `payOrdId` | 医保中心支付订单号；本手册的医保退费查找键 |
| `outTradeNo` | 微信原支付商户订单号；本手册的微信退费查找键 |
| `orderId` | 平台规范医保订单 ID；在成功响应中返回，不是新接口的请求查找键 |
| `refundNo` | 平台退款编号；HIS 后续查询和对账使用该值 |
| `out_refund_no` | 微信商户退款单号；由平台内部管理，HIS 不得传入或用于平台查询路径 |
| `transaction_id` | 微信支付订单号；不能替代 `outTradeNo` |
| `settleBackNo` | `2.27.2.32` 结算写回中的平台订单关联号；平台传入 `medicalOrderId`，HIS 保存后可对应兼容接口的 `orderId` |
| `thirdPartPayRecordId` | `2.27.2.29` 自费支付登记请求中的平台订单关联号；平台传入根 `medicalOrderId`（`orderId`），其回执仅作成功断点与不可重放控制，不是退费查找键 |
