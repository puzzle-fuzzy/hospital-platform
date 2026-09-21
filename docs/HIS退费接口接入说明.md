# HIS 退费接口接入说明

版本：2026-09-21

## 1. 接口地址

平台地址：

```text
https://meiyi.pro
```

公网接口前缀：`/api/v2`

HIS 固定出口 IP：`124.164.248.83`

| 功能 | 请求地址 | 查询地址 |
| --- | --- | --- |
| 医保单独退费 | `POST /api/v2/his/medical-insurance-leg-refunds` | `GET /api/v2/his/medical-insurance-leg-refunds/{refundNo}` |
| 微信单独退费 | `POST /api/v2/his/wechat-leg-refunds` | `GET /api/v2/his/wechat-leg-refunds/{refundNo}` |
| 医保 + 微信整笔退费（旧接口） | `POST /api/v2/his/medical-insurance-refunds` | `GET /api/v2/his/medical-insurance-refunds/{refundNo}` |

本次 HIS 拆分调用使用前两组接口。旧整笔接口保留兼容，不要和单腿接口混用同一笔订单。

## 2. 必填请求头

以下请求头每次请求都必须传入：

| 请求头 | 要求 |
| --- | --- |
| `X-HIS-Refund-Token` | 平台提供的 HIS 退费 Token |
| `X-HIS-Timestamp` | Unix 时间戳，单位为秒；与平台时间相差不能超过 5 分钟 |
| `X-HIS-Nonce` | 每次请求唯一，长度 16—128 位 |
| `X-HIS-Signature` | HMAC-SHA256 签名，64 位十六进制字符串 |
| `X-Request-Id` | HIS 请求流水号，只允许字母、数字、`.`、`_`、`:`、`-` |
| `Content-Type` | 固定为 `application/json` |

请求必须从 `124.164.248.83` 发出，否则返回 `403`。

Token 和 HMAC 密钥是两个不同的值，均只配置在 HIS 服务端，不传给前端，不写入业务日志。

## 3. 签名算法

签名原文由以下 6 行组成，每行之间使用一个换行符：

```text
HTTP_METHOD
ROUTE_PATH
X-HIS-Timestamp
X-HIS-Nonce
X-Request-Id
BODY_SHA256
```

计算方法：

```text
X-HIS-Signature = lowercase(hex(HMAC-SHA256(HIS_HMAC_SECRET, 签名原文)))
```

`ROUTE_PATH` 不包含域名和 `/api/v2`，例如：

```text
/his/medical-insurance-leg-refunds
/his/wechat-leg-refunds
/his/medical-insurance-leg-refunds/RFMIxxxxxxxx
/his/wechat-leg-refunds/RFHISxxxxxxxx
```

`BODY_SHA256` 规则：

- POST：对 JSON 对象的键名按 ASCII 升序递归排序，去掉空格后序列化，再计算 UTF-8 SHA-256 小写十六进制值。
- GET：请求体为空，固定使用空字符串 SHA-256：

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

签名中的 HTTP 方法必须使用大写，例如 `POST`、`GET`。

## 4. 医保单独退费

请求：

```http
POST https://meiyi.pro/api/v2/his/medical-insurance-leg-refunds
Content-Type: application/json
```

请求体：

```json
{
  "orderId": "平台医保订单ID",
  "reason": "HIS撤销医保结算"
}
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `orderId` | 是 | 平台医保订单 ID，不是 `payOrdId`、微信订单号或退款单号 |
| `reason` | 否 | 退费原因，最多 80 字节 |

平台根据已落库的 6202 金额和授权上下文，调用医保 6203：

```text
POST /org/local/api/hos/refund_Order
```

HIS 不得提交以下字段：`refundType`、`refundFen`、`personalAccountRefundFen`、`fundRefundFen`、`payOrdId`、`payAuthNo`、`ecToken`。

成功响应示例：

```json
{
  "success": true,
  "data": {
    "orderId": "平台医保订单ID",
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

医保退款查询：

```http
GET https://meiyi.pro/api/v2/his/medical-insurance-leg-refunds/{refundNo}
```

## 5. 微信单独退费

请求：

```http
POST https://meiyi.pro/api/v2/his/wechat-leg-refunds
Content-Type: application/json
```

请求体：

```json
{
  "orderId": "平台医保订单ID",
  "reason": "HIS撤销微信自费"
}
```

平台根据医保订单已确认的微信自费金额和真实 `out_trade_no`，调用微信 APIv3 普通退款：

```text
POST /v3/refund/domestic/refunds
```

微信退款金额、`out_trade_no` 和 `out_refund_no` 均由平台生成或读取，HIS 不得提交或覆盖。

成功响应示例：

```json
{
  "success": true,
  "data": {
    "orderId": "平台医保订单ID",
    "refundNo": "RFHISxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "status": "succeeded",
    "wechatStatus": "success",
    "amounts": {
      "totalFen": 11561,
      "cashFen": 11561,
      "personalAccountFen": 0,
      "fundFen": 0
    }
  }
}
```

微信退款查询：

```http
GET https://meiyi.pro/api/v2/his/wechat-leg-refunds/{refundNo}
```

平台查询微信 APIv3 时使用同一个 `refundNo`，不会生成第二个微信退款单号。

## 6. 退费状态

两个单腿接口都返回 `data.status`：

| 状态 | 处理方式 |
| --- | --- |
| `succeeded` | 该退费腿成功 |
| `processing` | 已受理，使用原 `refundNo` 查询 |
| `failed` | 该退费腿明确失败，不能据此修改另一条退费腿的状态 |
| `manual_review` | 结果未知或需要人工核验，停止盲目重试 |

医保单腿另外返回 `medicalStatus`；微信单腿另外返回 `wechatStatus`。金额单位为人民币分。

医保和微信是两条独立退费链路，平台不会自动回滚另一条已成功的退费。HIS 必须分别保存并对账：

- `orderId`
- 医保 `refundNo`、`status`、`medicalStatus`、医保金额分项
- 微信 `refundNo`、`status`、`wechatStatus`、微信现金金额
- 每次请求的 `X-Request-Id`

## 7. 重试规则

1. HTTP 超时或连接断开时，不要直接认定退费失败。
2. 已取得 `refundNo` 时，优先调用对应查询接口。
3. 没有取得响应时，可以重试同一个单腿接口，但必须使用新的 `X-HIS-Timestamp`、`X-HIS-Nonce` 和 `X-Request-Id`。
4. 重试时必须使用同一个 `orderId`，不能自行生成退款单号，平台会按订单保持幂等。
5. 微信 `processing`、`unknown`、`manual_review` 状态必须查询原微信退款单号，不得重新创建退款。
6. 医保 6203 返回 `EXP` 或结果未知时，保留原 `refundNo` 和请求号，转人工核验。

## 8. HTTP 状态码

| HTTP 状态码 | 含义 |
| --- | --- |
| `200` | 请求已处理，具体结果查看 `data.status` |
| `400` | 请求参数或订单状态不符合要求，包括聚合接口与单腿接口混用 |
| `401` | Token、时间戳或签名错误 |
| `403` | 来源 IP 不是 `124.164.248.83` |
| `409` | nonce 重复或幂等冲突 |
| `429` | 超过每分钟 10 次请求限制 |
| `503` | 平台退费依赖或安全服务暂不可用 |

## 9. 平台日志

平台会记录以下 HIS 调用事件：

```text
his.refund.rejected
his.refund.accepted
his.refund.completed
his.refund.failed
```

日志记录操作类型、请求方法、路由、来源 IP、`X-Request-Id`、订单哈希、耗时、结果状态和错误码。

日志不记录：Token、HMAC 密钥、签名、nonce、退费原因、身份证、支付凭证和 Provider 原始报文。
