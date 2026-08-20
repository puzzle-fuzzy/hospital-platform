# 当前公网只读边界复核（2026-08-21 05:47 CST）

> 本文只记录 `https://test-hp.meiyi.pro` 的公网 HTTPS 只读探针，不代表微信、Provider、真机或任何业务已经完成验收。
> 本次没有携带 Bearer 会话，没有提交患者数据，没有调用 Provider，也没有写入 MySQL/Redis 或修改旧 Python 服务。

## 1. 当前候选

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序候选 | `6677671` |
| 小程序完整来源 | `667767123efdb5b3a0bedbe423ab1797f16b1247` |
| 公网地址 | `https://test-hp.meiyi.pro` |
| 旧 Python | `8001`，不属于本次改动范围 |

## 2. 公网响应边界

| 请求 | HTTP | Cache-Control | 结论 |
| --- | ---: | --- | --- |
| `GET /api/v2/health/live` | `200` | `no-store` | 运行层可达 |
| `GET /api/v2/health/ready` | `200` | `no-store` | 公网 readiness 可达；不等于业务完成 |
| `GET /api/v2/system/ping` | `200` | 未返回 | 系统探针可达 |
| `GET /api/v2/me` | `401` | — | 未登录访问被正确拒绝 |
| `GET /api/v2/patients` | `401` | — | 未登录访问被正确拒绝 |
| `GET /api/v2/appointments/records` | `401` | — | 未登录访问被正确拒绝 |
| `GET /api/v2/payments/outpatient/records?status=unpaid` | `401` | — | 未登录访问被正确拒绝 |
| `GET /api/v2/medical-records` | `404` | — | 门诊病历 route 继续关闭 |
| `GET /api/v2/payments/insurance/authorization` | `404` | — | 医保授权 route 继续关闭 |
| `GET /api/v2/appointments` | `404` | — | 预约写入 route 继续关闭 |

## 3. 结论与下一步

当前公网代理、认证边界和关闭能力符合 fail-closed 预期；这只能证明路由层边界，不能证明患者归属、Provider 字段、
预约历史、门诊费用、普通资料或真机页面正确。下一步必须在当前小程序候选重新扫码，按页面、客户端 `traceId/requestId`
和服务端低敏业务事件三层取证；支付、医保、预约写入、病历、绑定和 HIS 回写继续保持关闭。
