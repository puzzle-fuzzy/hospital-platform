# HIS 退费接口

更新时间：2026-09-21

## 1. 接口地址

平台服务地址：

```text
https://test-hp.meiyi.pro
```

### 发起退费

```http
POST https://test-hp.meiyi.pro/api/v2/admin/medical-insurance-refunds
```

### 查询退费

```http
GET https://test-hp.meiyi.pro/api/v2/admin/medical-insurance-refunds/{refundNo}
```

HIS 只调用平台接口一次。平台根据订单已落库的支付事实，统一处理：

1. 医保 6203：`/org/local/api/hos/refund_Order`
2. 微信 APIv3 自费退款：`/v3/refund/domestic/refunds`

HIS 不需要直接调用上述两个 Provider 接口。

## 2. 发起退费请求

### 请求头

| Header | 必填 | 内容 |
| --- | --- | --- |
| `X-Admin-Refund-Token` | 是 | 平台提供的接口令牌 |
| `X-Request-Id` | 否 | HIS 生成的请求流水号，最长 128 个字符 |
| `Content-Type` | 是 | `application/json` |
| `Accept` | 否 | `application/json` |

### 请求体

```json
{
  "orderId": "平台医保订单ID",
  "reason": "HIS撤销收费"
}
```

| 字段 | 类型 | 必填 | 内容 |
| --- | --- | --- | --- |
| `orderId` | string | 是 | 平台医保订单 ID，即平台医保订单接口返回的 `data.orderId` |
| `reason` | string | 否 | 退费原因，最长 80 字节 |

当前接口固定执行整笔退费，HIS 不提交退费金额和医保/微信分项金额。平台以已落库订单金额为准。

以下字段不需要、也不能传入：

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

其中 `orderId` 是平台订单 ID，不是医保 `payOrdId`、微信商户订单号或退款单号。

## 3. 成功响应

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

金额单位为人民币分：`17600` 表示 `176.00 元`。

| 字段 | 内容 |
| --- | --- |
| `orderId` | 平台医保订单 ID |
| `refundNo` | 平台生成的聚合退费单号，查询时使用 |
| `status` | 聚合退费总状态 |
| `medicalStatus` | 医保 6203 退费状态 |
| `wechatStatus` | 微信 APIv3 退费状态 |
| `amounts.totalFen` | 本次总退费金额 |
| `amounts.cashFen` | 微信自费退费金额 |
| `amounts.personalAccountFen` | 医保个人账户退费金额 |
| `amounts.fundFen` | 医保统筹基金退费金额 |

## 4. 状态处理

### `status`

| 值 | 含义 | HIS 处理 |
| --- | --- | --- |
| `succeeded` | 医保和微信两部分均已成功 | 标记本地退费成功 |
| `processing` | 已受理，仍有退费部分处理中 | 保存 `refundNo`，继续查询 |
| `failed` | 平台明确判定退费失败 | 标记失败并人工处理 |
| `manual_review` | 结果未知、6203 返回 `EXP` 或需要人工核验 | 不重复发起，转人工处理 |

### 分项状态

| 字段 | 值 | 含义 |
| --- | --- | --- |
| `medicalStatus` | `success` | 医保 6203 退费成功 |
| `medicalStatus` | `failed` | 医保 6203 明确失败 |
| `medicalStatus` | `unknown` | 医保结果未知或需要人工核验 |
| `wechatStatus` | `success` | 微信 APIv3 退费成功 |
| `wechatStatus` | `processing` | 微信退费处理中 |
| `wechatStatus` | `failed` | 微信退费明确失败 |
| `wechatStatus` | `unknown` | 微信结果未知或需要人工核验 |
| `wechatStatus` | `not_required` | 本订单没有微信自费金额 |

只有 `status=succeeded` 时，HIS 才可以把整笔退费标记为成功。

## 5. 查询退费

### 请求

```http
GET https://test-hp.meiyi.pro/api/v2/admin/medical-insurance-refunds/{refundNo}
X-Admin-Refund-Token: 平台提供的接口令牌
X-Request-Id: his-refund-query-20260921-000001
Accept: application/json
```

查询响应与发起退费响应的 `data` 结构相同。

HIS 处理规则：

1. 发起请求返回 `succeeded`：结束处理。
2. 返回 `processing`：保存 `refundNo`，调用查询接口确认最终状态。
3. 返回 `manual_review`：停止自动重试，人工核验。
4. 请求超时或连接中断：不能判断为失败，使用已保存的 `refundNo` 查询。
5. 查询不到 `refundNo`：核对请求是否使用了平台返回的原始退款单号。

## 6. HTTP 响应

| HTTP 状态 | 含义 | HIS 处理 |
| --- | --- | --- |
| `200` | 请求已处理，具体结果看 `data.status` | 按状态处理 |
| `400` | 参数错误、订单不满足退费条件或已有冲突退费记录 | 修正参数或人工处理 |
| `401` | `X-Admin-Refund-Token` 无效 | 检查接口令牌 |
| `404` | 订单或退款单不存在 | 核对 `orderId` 或 `refundNo` |
| `503` | 平台退费依赖或配置未就绪 | 稍后查询，不生成新退款请求 |

## 7. HIS 接入要求

1. HIS 保存平台订单接口返回的 `data.orderId`。
2. HIS 保存发起退费接口返回的 `refundNo`。
3. HIS 不根据 HTTP `200` 直接判断退费成功，必须判断 `data.status`。
4. HIS 不重复生成退款单号，不直接调用微信退款接口或医保 6203。
5. HIS 请求超时后使用原订单和原 `refundNo` 查询，不重新创建退费。
6. `X-Admin-Refund-Token` 只保存在 HIS 服务端配置中，不返回前端，不写入日志。

