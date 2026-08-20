# 当前公网关闭能力边界复核（2026-08-21）

> 本文只记录当前公网路由的 fail-closed 边界，不代表 Provider、微信真机或任何业务域已经完成真实验收。
> 复核服务端发布基线为 `0e360d3`；配套小程序本地候选为 `7f157d4`。本次请求不携带 Bearer 会话，
> 不提交患者数据，不调用 Provider，不修改数据库、Redis 或旧 Python 服务。

## 1. 公网结果

复核地址：`https://test-hp.meiyi.pro`。

| 请求 | 结果 | 业务含义 |
| --- | ---: | --- |
| `GET /api/v2/health/ready` | `200` | 运行层 readiness 可达；不等于业务完成 |
| `POST /api/v2/patients` | `404` | 患者新增/绑定 contract 未到位，保持未注册 |
| `GET /api/v2/medical-records` | `404` | 门诊就诊记录目录 contract 未到位，保持未注册 |
| `POST /api/v2/payments/insurance/authorization` | `404` | 医保授权保持关闭 |
| `POST /api/v2/appointments` | `404` | 预约写入保持关闭 |
| `GET /api/v2/me/profile` | `401` | 普通资料路由存在且正确要求平台会话 |
| `GET /api/v2/appointments/records` | `401` | 预约历史路由存在且正确要求平台会话 |
| `GET /api/v2/payments/outpatient/records?status=unpaid` | `401` | 门诊费用只读路由存在且正确要求平台会话 |
| `GET /api/v2/reports` | `401` | 报告目录路由存在且正确要求平台会话 |

## 2. 业务解释

`404` 与 `401` 在这里不是同一种失败：

- `404` 表示能力尚未完成独立 Provider/HIS contract，路由刻意不注册，不能通过旧接口转发、空列表或页面入口伪造完成；
- `401` 表示路由已经有平台会话边界，但当前请求没有提供会话，不能据此推断 Provider 已返回数据；
- `200 readiness` 只证明数据库、Redis、schema 和服务运行层探针可用，不证明微信登录、患者切换、预约历史、费用或资料写入。

支付调起、医保授权/结算、退款、预约写入、患者绑定、病历正文、报告详情和 HIS 回写继续按迁移清单保持关闭。

## 3. 复核边界

本次只验证 HTTP 状态码，没有产生业务请求链，也没有读取原始响应正文。后续真实业务仍必须在当前候选包中同时取得页面结果、
客户端 `requestId/traceId` 和服务端低敏日志；旧 Python `8001` 不属于本次变更范围。

## 4. 后续运行时门禁

本地新增的 `apps/worker/src/api-runtime-smoke.ts` 已增加 `closed-boundary` 检查：下一次发布候选的
runtime smoke 会对患者新增、门诊病历目录/详情、医保授权、预约创建/占号/取消共 7 条路径发送空 JSON
或 GET，并要求每条同时返回 HTTP `404` 与平台错误码 `not-found`。这只是防止路由被意外注册的工程门禁，
不替代 Provider/HIS contract、真机页面、微信会话或真实业务验收；本节代码变更尚未声称已重新取得公网运行证据。
