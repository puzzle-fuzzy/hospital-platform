# HIS 退费接口

更新时间：2026-09-21

## 1. 接口地址

平台服务地址：

```text
https://test-hp.meiyi.pro
```

HIS 专用接口：

```http
POST https://test-hp.meiyi.pro/api/v2/his/medical-insurance-refunds
GET  https://test-hp.meiyi.pro/api/v2/his/medical-insurance-refunds/{refundNo}
```

HIS 只调用平台接口。平台根据已落库的支付事实，一次编排整笔退费：

1. 医保 6203：`/org/local/api/hos/refund_Order`
2. 微信 APIv3 自费退款：`/v3/refund/domestic/refunds`

HIS 不直接调用上述两个 Provider 接口，也不能选择只退医保或只退微信。

固定来源白名单：`124.164.248.83`。请求必须从该医院方公网地址发出；其他来源会被网关拒绝。

## 2. 安全请求头

以下请求头全部必填：

| Header | 必填 | 内容 |
| --- | --- | --- |
| `X-HIS-Refund-Token` | 是 | 平台单独提供给 HIS 的退费令牌；不使用 `X-Admin-Refund-Token`，不得写入代码、日志或文档 |
| `X-HIS-Timestamp` | 是 | Unix 时间戳，单位秒；平台只接受当前时间前后 5 分钟 |
| `X-HIS-Nonce` | 是 | 每次请求唯一的随机字符串，16—128 位；重复使用会被拒绝 |
| `X-HIS-Signature` | 是 | 规范化签名串的 HMAC-SHA256 十六进制小写结果 |
| `X-Request-Id` | 是 | HIS 生成的请求流水号，1—128 位，只能使用 `A-Z a-z 0-9 . _ : -` |
| `Content-Type` | 是 | `application/json` |

平台另行提供的 HMAC 密钥与 Token 不是同一个值。两个值只放在 HIS 服务端安全配置中，不返回前端，不打印日志。

## 3. 签名规则

签名使用 HMAC-SHA256。规范化签名串由以下 6 行组成，行之间使用单个换行符，不追加额外空格：

```text
HTTP_METHOD
ROUTE_PATH
X-HIS-Timestamp
X-HIS-Nonce
X-Request-Id
BODY_SHA256
```

`ROUTE_PATH` 不包含域名和 `/api/v2` 前缀：

```text
POST /his/medical-insurance-refunds
GET  /his/medical-insurance-refunds/{refundNo}
```

`BODY_SHA256` 的计算方式：

- POST：对请求 JSON 按对象键名 ASCII 升序递归排序，使用无空格 JSON 序列化，再计算 UTF-8 字节的 SHA-256 小写十六进制值。
- GET：请求体为空，计算空字符串的 SHA-256，即 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

最后计算：

```text
lowercase(hex(HMAC-SHA256(his_hmac_secret, canonical_string)))
```

## 4. 发起整笔退费

### 请求体

```json
{
  "orderId": "平台医保订单ID",
  "reason": "HIS撤销收费"
}
```

| 字段 | 类型 | 必填 | 内容 |
| --- | --- | --- | --- |
| `orderId` | string | 是 | 平台医保订单 ID，即平台支付接口返回的 `data.orderId` |
| `reason` | string | 否 | 退费原因，最长 80 字节 |

当前接口固定按订单已落库金额整笔退费。以下字段不能传入：

```text
refundType
refundFen
personalAccountRefundFen
fundRefundFen
payOrdId
payAuthNo
ecToken
out_trade_no
out_refund_no
```

`orderId` 不是医保 `payOrdId`、微信商户订单号或退款单号。

### 处理规则

平台内部只发起一次聚合退费，并用订单绑定的幂等键防止重复退费。HIS 重试时必须复用原请求流水号语义并优先查询已返回的 `refundNo`；不能自行生成退款单号，也不能因为 HTTP 超时再次盲目发起。

## 5. 成功响应

```json
{
  "success": true,
  "data": {
    "orderId": "平台医保订单ID",
    "refundNo": "RFMIxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "status": "succeeded",
    "medicalStatus": "success",
    "wechatStatus": "success",
    "amounts": {
      "totalFen": 17600,
      "cashFen": 11561,
      "personalAccountFen": 0,
      "fundFen": 6039
    }
  }
}
```

金额单位为人民币分，`17600` 表示 `176.00 元`。`amounts` 是同一笔聚合退费的分项，不是两笔独立订单。

| 字段 | 内容 |
| --- | --- |
| `status=succeeded` | 医保与微信两部分均成功 |
| `status=processing` | 已受理，仍有部分处理中；保存 `refundNo` 后查询 |
| `status=failed` | 平台明确判定失败 |
| `status=manual_review` | 结果未知、医保返回 `EXP` 或需要人工核验；停止自动重试 |
| `medicalStatus` | `success`、`failed`、`unknown` |
| `wechatStatus` | `success`、`processing`、`failed`、`unknown`、`not_required` |

只有 `status=succeeded` 才能在 HIS 标记整笔退费成功。

## 6. 查询退费

```http
GET https://test-hp.meiyi.pro/api/v2/his/medical-insurance-refunds/{refundNo}
```

查询也必须携带本说明第 2 节的全部安全请求头，并按 GET 路径和空请求体计算签名。响应中的 `data` 结构与发起退费响应一致。

HIS 处理规则：

1. 发起请求返回 `succeeded`：结束处理。
2. 返回 `processing`：保存 `refundNo`，查询最终状态。
3. 返回 `manual_review`：停止自动重试，转人工核验。
4. 请求超时或连接中断：不能判断为失败，使用已保存的 `refundNo` 查询。
5. 查询不到 `refundNo`：核对是否使用平台原样返回的退款单号。

## 7. HTTP 响应

| HTTP 状态 | 含义 | HIS 处理 |
| --- | --- | --- |
| `200` | 请求已处理，具体结果看 `data.status` | 按聚合状态处理 |
| `400` | 参数错误或订单不满足退费条件 | 修正参数或人工处理 |
| `401` | Token、时间戳或 HMAC 签名无效 | 检查服务端安全配置和系统时间 |
| `403` | 来源 IP 不是 `124.164.248.83` | 检查医院出口公网 IP |
| `409` | nonce 重复或退费幂等冲突 | 不重复发起，按原退款单查询 |
| `429` | 超过每分钟 10 次接口限流 | 稍后查询，不立即循环重试 |
| `503` | 平台安全状态、退费依赖或配置暂不可用 | 稍后查询，不生成新退款请求 |

## 8. HIS 必须保存的字段

HIS 服务端必须保存：

1. 平台订单接口返回的 `data.orderId`。
2. 发起退费接口返回的 `refundNo`。
3. `X-Request-Id` 与平台响应的关联关系。
4. `status`、`medicalStatus`、`wechatStatus` 和金额分项。

Token、HMAC 密钥和完整请求签名不能写入业务日志；日志只记录请求流水号、退款单号和低敏状态。
