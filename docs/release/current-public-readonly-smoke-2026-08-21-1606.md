# 当前公网只读运行层复核（2026-08-21 16:06 CST）

## 范围

本次只访问新服务的公网版本前缀 `https://test-hp.meiyi.pro/api/v2`，不携带
Bearer 会话、不提交业务命令、不访问 Provider，不修改旧 Python 服务、数据库或 Redis。
该记录只证明当前公网路由、依赖 readiness 和未登录/关闭边界，不能替代真机、患者
归属、众阳业务或支付验收。

## 结果

| 请求 | HTTP | 结果摘要 |
| --- | ---: | --- |
| `GET /health/live` | 200 | `success=true`，`status=ok`，`service=hospital-api` |
| `GET /health/ready` | 200 | `status=ready`，`database/redis/schema=ok` |
| `GET /system/ping` | 200 | `success=true`，服务为 `hospital-api` |
| `GET /patients`（无会话） | 401 | `error.code=unauthorized` |
| `GET /appointments/records?...`（无会话） | 401 | `error.code=unauthorized` |
| `GET /payments/outpatient/records?...`（无会话） | 401 | `error.code=unauthorized` |
| `GET /medical-records` | 404 | `error.code=not-found`，病历路由保持关闭 |

## 结论

当前公网新服务运行层和未登录鉴权边界正常；没有产生微信登录、患者、预约、门诊
费用、报告或普通资料业务证据。下一步仍是使用来源匹配的 `9c582a1` 小程序候选，
采集真实设备页面、客户端 `requestId` 和服务端低敏同链日志三层证据。
