---
type: evidence
area: api
title: API 组合根证据
status: static
---

# API 组合根证据

API 组合根位于 [apps/api/src/app.ts](../../../apps/api/src/app.ts)。所有业务模块都挂在 `/api/v1` 分组下；因此接口目录里的模块路径要与此前缀拼接后才是应用完整路径。

## 当前挂载

| 模块 | 挂载方式 | 额外条件 |
| --- | --- | --- |
| system | 始终挂载 | 无患者门禁 |
| auth | 始终挂载 | 登录接口为公共入口；其他会话解析仍受认证规则控制 |
| patients | 始终挂载 | 读写按当前 principal |
| profile | `services.profile` 存在时挂载 | 未配置时使用 `profile-not-configured` 空模块 |
| appointments | 始终挂载 | 依赖 appointment service 配置，接口可能返回依赖未配置错误 |
| reports | 始终挂载 | 依赖报告 service，要求用户和患者范围 |
| outpatient-payments | `services.outpatientPayments` 存在时挂载 | 未配置时使用 `outpatient-payments-not-configured` 空模块 |
| payments | 始终注册 payment module | 还受 `wechatPaymentEnabled === true`、订单/预支付/通知服务配置影响 |
| health | 在 API 分组外/组合根层 | readiness、数据库/Redis/schema 状态 |

## 组合根不等于运行可用

`app.ts` 只能证明路由模块被组合；需要继续看模块 schema、service 配置、provider 和部署环境，才能判断真实请求是否可用。特别是：

- profile/门诊费用可能因为服务未配置而返回依赖错误。
- payments 即使路由注册，也可能因微信支付开关关闭或 provider 不完整而不可用。
- reports、appointments、patients 的成功读模型还依赖外部适配器。
- 前端患者门禁是用户体验层保护，服务端 principal/患者归属校验仍必须存在。

源码：[app.ts](../../../apps/api/src/app.ts)、[auth/index.ts](../../../apps/api/src/modules/auth/index.ts)、[patients/index.ts](../../../apps/api/src/modules/patients/index.ts)、[payments/index.ts](../../../apps/api/src/modules/payments/index.ts)。
