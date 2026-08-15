# Provider Contract v1

本文档记录重构阶段已经从旧项目源码和官方资料确认的 provider 边界。
它是 adapter 实现的输入，不是“已经接通生产 provider”的证明。

## 已确认的调用链

| 能力 | 旧项目证据 | 新仓库边界 | 当前状态 |
| --- | --- | --- | --- |
| 小程序登录 | `G:\\fuck\\hospital\\app\\api\\v1\\module_common\\...` 与 `wechat_util.py` | `WechatIdentityGateway.exchangeCode` | 本批已实现真实 HTTP adapter |
| 微信自费 JSAPI | `wechat_medical.py::_build_jsapi_order` | `WechatPaymentGateway.createJsapiOrder` | APIv3 adapter 已实现，默认未接入 |
| 医保费用上传 | `MbsFsiService.forward_6201` | `MedicalInsuranceGateway.uploadFees` | contract/金额校验已实现，密码 adapter 待实现 |
| 医保支付下单 | `MbsFsiService.forward_6202` | `MedicalInsuranceGateway.settle` | contract/金额校验已实现，密码 adapter 待实现 |
| 医保结算查询 | `MbsFsiService.forward_6301` | `MedicalInsuranceGateway.query` | contract/金额校验已实现，密码 adapter 待实现 |
| 医保退款/撤销 | `forward_6203` / `forward_6401` | `legacy-fsi-contract.ts` validators | contract 已拆分，退款状态 port 待补充 |
| HIS 回写 | 旧项目订单服务的回写调用 | `HospitalSettlementGateway.writeBack` | 待实现 |

## 设计不变量

1. 小程序只提交 `wx.login()` 产生的临时 `code`；`openid`、`session_key`、AppSecret 和商户私钥不能由客户端提交或接收。
2. 微信 code2session 返回的 `session_key` 只在 adapter 层短暂存在，不能进入 domain、日志、outbox、数据库业务事件或 API response。
3. provider 请求必须带 trace/idempotency 上下文；响应错误必须区分可重试和不可重试，不能把 HTTP 200 的业务错误当成功。
4. 微信 APIv3 自费下单使用 `/v3/pay/transactions/jsapi`，返回 `prepay_id` 后由后端生成小程序调起参数；前端支付回调不等于业务订单完成。
5. 6202 的 `feeSumamt`、`ownPayAmt`、`psnAcctPay`、`fundPay` 是医保混合支付金额的后端事实来源；不能让客户端金额覆盖已落库结算结果。
6. `/v3/med-ins/orders` 的权限、商户模式和 `channel_no` 必须以当前官方配置确认为准；不能因为旧项目曾经调用过就宣称新环境已授权。

## 本批实现范围

`packages/adapters/src/wechat-identity.ts` 只实现 code2session：

- 默认请求 `https://api.weixin.qq.com/sns/jscode2session`；
- 固定 `grant_type=authorization_code`；
- `40029` 等无效 code 不重试，`-1`/`45011` 分类为可重试；
- 缺少 `openid` 或配置不完整时 fail-closed；
- API 组合根只有在 `WECHAT_IDENTITY_READY=true` 时才注入它，默认仍使用 not-configured gateway。

微信支付 APIv3 的 JSAPI 下单路径、请求签名和响应验签已单独实现，避免把身份、支付、回调和医保加密混成一个不可审计的 adapter。

Phase 5B-2 已实现 `packages/adapters/src/wechat-pay.ts`：

- `POST /v3/pay/transactions/jsapi` 使用 APIv3 RSA-SHA256 请求签名，body 通过 `bodyText` 保证签名字节与发送字节一致；
- 成功响应必须校验 `Wechatpay-Serial`、`Wechatpay-Timestamp`、`Wechatpay-Nonce` 和 `Wechatpay-Signature`，再读取 `prepay_id`；
- 后端用商户私钥生成小程序 `payParams`，小程序只负责调用支付 API，不自行拼装签名；
- 查单路径为 `/v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={mchid}`，只把已验签的明确交易状态映射成内部状态，未知状态 fail-closed；
- 通知入口提供 APIv3 验签和 `AEAD_AES_256_GCM` 解密函数，解密后的 provider payload 仍需 callback mapper 白名单映射，不能直接迁移订单状态；
- 单元测试使用进程内生成的 RSA/AES 材料，证明协议实现和失败分支，不证明商户号、证书、微信产品权限或公网回调已经可用。

医保 5B-3 当前只实现 `legacy-fsi-contract.ts` 的纯规则层：固定五个专用 path、有限层级
响应展开、元转分、6201 明细守恒、6202/6301 结算金额守恒、6203 退款边界和 6401 明确成功。
5B-4 又增加了 `legacy-fsi-crypto.ts` 的严格 envelope port 和 fail-closed 默认实现，但
SM2/SM3/SM4 尚未发送真实请求；正式实现必须先取得 golden vectors，并通过 sidecar 或验证过的
Bun/Node 实现完成双向兼容测试。

参考：[微信支付 JSAPI/小程序下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791856)、[APIv3 请求签名规则](https://pay.wechatpay.cn/doc/v3/merchant/4012365336)。
