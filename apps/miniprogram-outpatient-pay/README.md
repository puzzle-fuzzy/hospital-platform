# miniprogram-outpatient-pay

独立的门诊缴费小程序示例，使用新版平台 API。本端业务标识固定为
`businessType=outpatient`、`orderType=DiagPay`，对应统一医保核心的门诊入口；但当前只开放真实费用读取，
不会因为客户端显示支付方式就提前创建订单。

统一分层依据见 [医保统一核心与业务入口 ADR](../../docs/架构决策/0005-医保统一核心与业务入口.md)。

使用的新版平台 API：

- 登录：`POST /api/v2/auth/wechat`
- 就诊人：`GET /api/v2/patients`
- 待缴费目录：`GET /api/v2/payments/outpatient/records?patientId=...&status=unpaid`
- 费用摘要详情：`GET /api/v2/payments/outpatient/records/{recordId}?patientId=...&status=unpaid|paid`

当前版本只接入服务端已经开放并有明确合同的门诊费用查询（对应众阳 2.6.33），并支持打开已核对的单笔摘要详情。页面会展示就诊人、门诊项目、账单时间和服务端返回的金额，不接触 provider 患者号、订单号或医保原始字段；项目级费用明细、支付、医保分摊和电子票据没有正式 contract 时保持关闭。

## 支付接口准入边界

参考腾讯文档《门诊缴费医保支付》及仓库内众阳资料，真实支付流程还需要服务端依次确认并开放：

`2.6.65.1 发起结算` → `2.6.65.2 支付下单` → `2.6.65.4 支付查单` → `2.6.65.5 完成结算`

异常分支还涉及 `2.6.65.6 取消结算`、`2.6.65.11 关单` 和 `2.27.2.32 医保结算信息回写`。当前仓库的门诊支付写入门禁尚未通过，因此本项目暂不注册这些 API，也不在客户端猜测旧项目的 `authSysCode`、金额来源、业务号或医保请求参数。

医保收款、自费收款、插件版收款等分支只有在对应服务端合同正式开放后才会出现可点击支付入口。当前页面明确提示“不会提交支付订单”，避免测试人员误把目录查询当成支付成功；因此服务端日志也不会伪造支付方式事件。

支付接口开放后，服务端日志必须按一次业务尝试关联记录：`paymentBranch`、`paymentMethod`、`patientId`（内部 opaque id）、`businessId`（脱敏/哈希）、`traceId`、`providerRequestIds`、`stage` 和稳定错误码。不要记录证件号、医保原文、provider 患者号、支付凭证或完整费用明细。

## 构建

```bash
pnpm --filter @hospital/miniprogram-outpatient-pay build
```

构建产物在 `apps/miniprogram-outpatient-pay/dist`，使用微信开发者工具导入该 `dist` 目录。由于尚未提供新的微信小程序 appid，项目配置暂沿用现有测试 appid `wx4bc833cb3358c8d8`；如要作为独立小程序上传，请先替换 `project.config.json` 中的 appid，并在微信后台配置 `https://test-hp.meiyi.pro` 为合法 request 域名。
