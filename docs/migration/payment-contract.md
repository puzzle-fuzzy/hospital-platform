# 支付与医保目标契约

## 1. 两条旧业务流程必须分开

### 门诊待支付流程

```text
待支付列表
  → 医保授权
  → 1101 人员信息
  → 2.6.65.1 发起结算
  → 2.27.2.27 获取真实费用明细
  → 6201 费用上传
  → 6202 医保结算
  → 按真实 ownPayAmt 选择现金支付分支
  → 等待真实结果
  → 2.27.2.32 回写
```

### 预约挂号医保支付流程

```text
预约登记（tradeTypeCode=10）
  → 2.6.65.1 挂号结算
  → 2.6.65.2 挂号支付入口
  → 医保授权回跳
  → 2.4.2 获取 pay_auth_no
  → 1101
  → 2.27.2.27
  → 6201
  → 6202
  → 真实现金分支（如果有）
  → 真实医保结果
  → 2.27.2.32
  → 2.6.65.5 完成结算
```

两条流程可以共享 provider adapter，但不能共享未经区分的入口参数、金额来源或业务编码。

## 1.1 挂号支付状态接口不是微信预支付

Provider 文档中的 2.10.4.2 “支付挂号接口”是院内预约记录的支付状态更新接口，依赖 2.10.4.1 执行预约产生的
`appointmentInfoId`。它与平台微信订单的“创建预支付参数”、微信支付通知和医保结算不是同一个事实：

1. 平台先保存自己的订单、金额快照和幂等事实，再决定是否调用 Provider 的支付状态更新；
2. `payState=3` 代表“支付成功、院内处理中”，只能进入院内确认中的状态，不能直接映射为 `cash_paid`、`completed` 或 `booked`；
3. `payState=5` 代表 Provider 文档中的已退款，但仍必须关联平台订单、退款事实和权威查单，不能由小程序自行提交或推断；
4. Provider 响应返回 `hisRegisterId`、`outSettleMainId`、`outInvoiceMainId` 等院内标识时，只能作为服务端内部映射，不能进入公共 response、URL 或日志。

这条边界必须与 [`../appointment-write-contract-v1.md`](../appointment-write-contract-v1.md) 和
[`../provider-intake/2026-08-16-appointment-registration-payment-refund.md`](../provider-intake/2026-08-16-appointment-registration-payment-refund.md)
一起维护；缺少执行预约、状态查询、金额单位和失败样例前，不开放支付挂号 adapter。

## 2. 目标内部状态

```text
created
  → authorized
  → pre_settled
  → insurance_submitted
  → insurance_settled
  → cash_pending
  → cash_paid
  → his_written_back
  → completed
```

异常状态：`awaiting_confirmation`、`failed`、`cancelled`。未知结果进入待确认，不自动判定失败，不执行高风险撤销。

## 3. 金额权威边界

| 金额来源 | 可以做什么 | 不能做什么 |
| --- | --- | --- |
| 前端提交金额 | 展示/请求校验的输入 | 不能作为结算或回写权威 |
| 2.6.65.1 `getAmount` | 启动结算所需的业务金额 | 不能替代医保真实结算结果 |
| 6201/6202 返回 | 记录医保订单、费用和现金分支 | 缺字段时不能用旧缓存或挂号金额补造 |
| 医保机构真实结果 | 决定医保与现金最终金额 | 必须验签/校验来源并关联原订单 |
| 2.27.2.32 与 2.6.65.5 | HIS 回写/完成结算结果 | 不能由页面支付调起成功代替 |

内部金额统一使用整数分；provider 元字段只在 adapter 边界显式转换并记录来源。

## 4. 目标服务契约

患者端只需要高层接口，例如：

- `POST /api/v1/payments/medical/preview`
- `POST /api/v1/payments/medical/start`
- `GET /api/v1/payments/:orderId`
- `POST /api/v1/payments/:orderId/cancel`

内部 adapter 负责：

- provider schema 校验
- 签名、加密和解密
- 超时、重试、断路和幂等键
- provider 单号与内部订单映射
- 原始报文摘要、trace id 和审计事件

## 5. 回调和异步处理

1. 回调先验签/解密，再以 provider event id 或 payload hash 去重。
2. 回调只负责快速落事件和唤醒 Worker，不在 HTTP 请求中串行执行全部补偿链路。
3. Worker 按订单锁读取当前状态，执行合法状态迁移。
4. 没有最终确定性结果时进入 `awaiting_confirmation`，由查单、人工对账或 provider 重试推进。
5. 每个外部调用保存请求摘要、响应摘要、provider 单号、错误类别和重试次数，禁止记录真实密钥和 Authorization。

## 6. 当前未完成的真实能力

- 医保 6202 查单与真实结果回写的完整闭环尚未在新项目实现。
- 微信医保混合支付的 provider 查单、通知和退款协议尚未迁移。
- 2.27.2.32 成功后的撤销分支缺少完整字段文档。
- 新项目当前只有 domain 状态机和 port，没有任何真实 provider 成功声明。
