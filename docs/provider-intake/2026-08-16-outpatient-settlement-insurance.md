# Provider 文档补充接收记录：门诊结算、支付状态与医保回写

> 接收/复核日期：2026-08-16（Asia/Shanghai）
> 当前状态：`normalized`（已标准化，未确认、未实现、未开放）
> 业务范围：门诊待支付、结算创建、第三方支付、支付查单、关单、取消结算、完成结算和医保结果回写。

## 1. 接收原则

原始材料位于旧项目 `G:\\fuck\\hospital\\hospital-app\\docs`，本记录只保存文件指纹和脱敏后的业务事实，
不复制 HTML、JSON 示例或其中的患者/订单/设备信息到新仓库。文件存在和文档描述不能证明当前医院环境已经授权，
也不能替代受控请求、失败样例、回调验签和真实查单证据。

## 2. 文件证据指纹

| documentId | 原始文件 | 大小 | 原始更新时间 | SHA-256 | 状态 |
| --- | --- | ---: | --- | --- | --- |
| `zhongyang-settle-2.27.2.32-html-20260812` | `2.27.2.32.医保核心服务.html` | 1194462 bytes | 2026-08-12 20:19:06 | `E91B35D6D3AAB5407ECE4C74F7CAE051AB4CB6620B9C75DD093300B7418B8840` | `normalized` |
| `zhongyang-settle-2.27.2.32-md-20260715` | `2.27.2.32.医保核心服务.md` | 40523 bytes | 2026-07-15 16:46:16 | `8DA80CA654875C878C725172C547D1987945D509B9687D8F6ABFC5A71B4BC1B1` | `normalized` |
| `zhongyang-settle-2.6.65.1-20260812` | `2.6.65.1.发起结算.html` | 917179 bytes | 2026-08-12 20:35:29 | `75DBBFCE6ACA488032D32CF90526DC4CFC5455FFB16BAD7D14C55CCCF912B47C` | `normalized` |
| `zhongyang-settle-2.6.65.2-20260812` | `2.6.65.2.发起支付（单一支付方式）.html` | 347062 bytes | 2026-08-12 20:38:55 | `153B7310665413AF28AE283A85FB0F0A909B2EFB8E87A7689A19A759DFD33A55` | `normalized` |
| `zhongyang-settle-2.6.65.3-20260811` | `2.6.65.3.发起支付（多支付方式）.md` | 6248 bytes | 2026-08-11 17:08:14 | `39185BC6B39C22436119EA550AD6BE14352BA257C62CFD1C339195B48FED0910` | `normalized` |
| `zhongyang-settle-2.6.65.4-20260812` | `2.6.65.4.支付结果查询.html` | 108199 bytes | 2026-08-12 18:34:52 | `39C25EA245C79F7E0F8482CFCEBE748D53DD7C94149286D904109CC150CA30A2` | `normalized` |
| `zhongyang-settle-2.6.65.5-20260812` | `2.6.65.5.完成结算.html` | 115409 bytes | 2026-08-12 18:35:31 | `EE2F8A8A1389E561C1CDBDCA9DCDC1BD6A2A93D47AA6EDB7E734ED765781BD7D` | `normalized` |
| `zhongyang-settle-2.6.65.6-20260812` | `2.6.65.6.取消结算.html` | 95052 bytes | 2026-08-12 18:36:44 | `1F5DA26630CB4E623A64AF6A6230053AAE19F0AA951B03F2B6117E67181118A9` | `normalized` |
| `zhongyang-settle-2.6.65.7-20260813` | `2.6.65.7.退款（外部系统提供接口）.html` | 107813 bytes | 2026-08-13 09:11:15 | `32B1BFBE004B2704029FFA94C58EBA13575C7D6E69D5609A9F4E9E777B7B4D2D` | `normalized` |
| `zhongyang-settle-2.6.65.11-20260812` | `2.6.65.11.支付关单.html` | 81493 bytes | 2026-08-12 18:37:23 | `CC2620D86ED754D1933EAA2D8BACF0CCC683924A0A63AD3D5B2A332EE9118C1F` | `normalized` |
| `zhongyang-medical-6201-sample-20260716` | `6201返回结果示例.json` | 3461 bytes | 2026-07-16 18:01:19 | `1C93ECA1D40A36C9F8B51A4811AFBD811736AE9888F691FAF5A1AA9EE0C7DDC6` | `normalized` |
| `zhongyang-medical-6202-sample-20260716` | `6202返回结果示例.json` | 3142 bytes | 2026-07-16 18:01:42 | `9E9C15922D27C891802F21A82BF46DA6F4D1428936132D67DA540188DE38AAE2` | `normalized` |
| `hospital-registration-medical-payment-flow-20260815` | `挂号医保支付-全量接口Canvas流程.html` | 86465 bytes | 2026-08-15 05:14:49 | `9256DD5440EB4C8CDEF0CAAFE6E68EE48216AAC013314E3BA307F8DD837E0861` | `normalized` |
| `hospital-registration-medical-payment-current-20260815` | `挂号医保支付-当前业务逻辑.md` | 8139 bytes | 2026-08-15 11:36:04 | `74B001FDD18F3E81E87CADD0446BF0BC0ADF01018C826B0149DBC6E9D6C391A7` | `normalized` |
| `hospital-medical-payment-comparison-20260815` | `医保支付新旧流程对比.md` | 7048 bytes | 2026-08-15 11:33:22 | `9B5ADA03E56D223470D62D86D4C5F3C3321BA0935E89C7076362F30875D765B7` | `normalized` |
| `hospital-medical-payment-audit-20260815` | `医保支付接口流程对比-7月初至今.md` | 4781 bytes | 2026-08-15 18:44:52 | `A428DA17AB0FFE1F872CDB8F4AB4221931A54BFA92E80CFE0631177D24D4565A` | `normalized` |

## 3. 已标准化的流程事实

| Provider 接口 | path | 已确认的业务含义 | 当前不能确认的内容 |
| --- | --- | --- | --- |
| 2.6.65.1 发起结算 | `POST /msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle` | 创建结算/支付订单；门诊场景先查询待支付列表，再发起结算 | 当前鉴权、完整请求字段、金额单位、幂等和业务错误码 |
| 2.6.65.2 发起单一支付 | `POST /msun-middle-open-settlepay/api/v2/open/payment/pre-order` | 用户选择支付方式后向第三方支付系统发起支付 | 微信/支付宝/医保渠道差异、签名边界、超时后查单 |
| 2.6.65.4 支付结果查询 | `POST /msun-middle-open-settlepay/api/v2/open/payment/pay-query` | 查询支付结果，用于用户展示和后续完成结算 | 哪些结果是终态、重复查单/重试策略和最终权威来源 |
| 2.6.65.5 完成结算 | `POST /msun-middle-open-settlepay/api/v2/open/payment/complete-settle` | 支付成功金额与结算单金额一致后，将结算单置为完成，并触发发票/医嘱/药品状态变化 | 金额精度、状态码、幂等和 HIS 回写失败补偿 |
| 2.6.65.6 取消结算 | `POST /msun-middle-open-settlepay/api/v2/open/settle/cancel-settle` | 用户主动取消、超时或异常时取消结算；若存在支付流水，必须先关支付流水 | 取消是否允许覆盖各终态、医保撤销顺序和重复取消 |
| 2.6.65.11 支付关单 | `POST /msun-middle-open-settlepay/api/v2/open/payment/pay-close` | 产生支付撤销/关单流程，适用于未支付或需要停止继续支付的场景 | 已支付订单的真实撤销结果、退款边界和最终查单 |
| 2.27.2.32 医保核心服务 | `POST /msun-yb-app-miop/outSettle/v2/settle-info/notify` | 将医保局返回的统筹/个账等报销结果写回 HIS，供记录和财务对账 | 回调鉴权、幂等、HIS 失败补偿和最终确认 |

2.6.65.7 外部退款已经在单独记录中登记；2.6.65.3 多支付方式材料只作为流程辅助材料，不能替代每种支付方式的独立 contract。

## 4. 新平台必须保持的状态顺序

```text
待支付目录
  -> settlement_pending
  -> settlement_created
  -> payment_pending
  -> payment_querying
  -> payment_confirmed
  -> settlement_completing
  -> completed
```

异常或无法确认时进入 `awaiting_confirmation`，不得直接进入 `failed` 或 `completed`。取消分支必须遵守：

```text
payment_pending / payment_querying
  -> payment_close_pending
  -> payment_closed_confirmed
  -> settlement_cancel_pending
  -> settlement_cancelled
```

医保撤销或结算取消前，必须先确认支付关单/撤销事实；支付关单成功也不等于医保撤销成功。
2.6.65.5 只能在支付金额与结算金额经过服务端校验且来源可追溯时调用，不能由小程序支付回调直接触发。

## 5. 当前冻结项

- 不注册门诊费用详情、结算创建、支付下单、支付查单、关单、取消结算或医保回写公共 API；
- 不把 2.6.65.4 的“支付查询结果”直接映射为微信支付 `cash_paid`，必须关联平台订单、金额和已验签/可信 Provider 事实；
- 不把 2.6.65.5 完成结算当作普通支付成功，它会改变发票、医嘱和药品状态，属于高风险 HIS 业务命令；
- 不把 2.27.2.32 回写、6202 结果或支付调起成功展示为患者端最终成功；
- 不复制原始 6201/6202 JSON、医保 token、结算单号、患者身份和支付凭证到公共 contract 或日志。

## 6. 必须补齐的确认项

| 编号 | 缺口 | 实现前证据 |
| --- | --- | --- |
| SET-01 | 当前环境地址、鉴权、签名/加密和证书 | Provider 环境确认和安全配置说明 |
| SET-02 | 每个接口的业务成功条件、错误码和 HTTP 200 失败语义 | 成功/业务失败/参数失败 fixture |
| SET-03 | 2.6.65.1/2.6.65.2/2.6.65.4 的订单关联和幂等键 | 重复请求、超时后查单和状态矩阵 |
| SET-04 | 元/分/字符串金额精度及完成结算金额守恒 | 脱敏金额样例和服务端换算确认 |
| SET-05 | 2.6.65.11 对已支付流水的真实行为 | 关单成功、失败、处理中和退款结果样例 |
| SET-06 | 2.6.65.6 与医保撤销、2.27.2.32 回写的顺序 | 取消/撤销/HIS 回写时序图 |
| SET-07 | 2.27.2.32 的调用方向、鉴权、去重和 HIS 失败补偿 | 调用签名、重复调用、重放和失败样例 |
| SET-08 | 门诊支付与预约挂号支付的业务编码、患者映射和金额来源 | 独立流程确认，禁止共用万能参数 |

本记录只证明材料已完成一次字段/流程标准化，不能证明支付、医保或 HIS 已授权、已联调或可生产运行。

## 7. 下一步执行顺序

1. 先由 Provider/院方补齐 SET-01 至 SET-08 的环境、鉴权、金额、状态、回调和补偿确认，并提供脱敏成功、业务失败、超时和重复请求样例。
2. 在不接入患者端的前提下，先建立门诊结算内部状态机、金额守恒测试、查单/关单/取消顺序测试和未知状态的人工处理路径。
3. 取得受控内网权限后，只做 adapter 层联调；所有请求必须使用受控的内部订单和患者映射，不接受小程序提交的金额、医保结果或 HIS 状态。
4. 通过内网、候选 API、公网和真机四层验收，并保存 `traceId`、`providerRequestId`、状态映射、金额校验和回滚证据后，才允许将本文状态从 `normalized` 升级为 `confirmed`。
5. 在上述证据完成前，支付、医保授权/结算、退款和 HIS 回写继续保持 gate 关闭，旧 Python 服务继续承担现有线上能力。
