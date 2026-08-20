# 2026-08-20 14:42 公网只读运行层复核

> 本记录只保存公网健康探针和未登录鉴权边界的低敏结果。
> 本次没有调用患者、预约、门诊费用 Provider，没有创建 session，没有写入 MySQL/Redis，
> 没有修改或重启旧 Python 服务，也没有上传小程序。

## 1. 请求窗口

- 复核时间：2026-08-20 14:42 CST；
- 公网入口：`https://test-hp.meiyi.pro/api/v2`；
- 请求方式：公网 HTTPS GET；
- 凭证：健康探针不需要凭证，业务接口均未携带凭证；
- 运行候选文档基线：服务端 `0e360d3`，小程序本地候选 `ce8d68b`。本次公网响应本身不暴露 release hash，不能仅凭响应推断线上 bundle 版本。

## 2. 运行层结果

| 路径 | HTTP | 低敏结果 |
| --- | ---: | --- |
| `/api/v2/health/live` | 200 | `success=true`，服务 `hospital-api`，状态 `ok` |
| `/api/v2/health/ready` | 200 | `success=true`，状态 `ready`，`database/redis/schema=ok` |
| `/api/v2/system/ping` | 200 | `success=true`，服务 `hospital-api`，API 版本 `0.1.0` |

## 3. 未登录边界

以下请求均未携带 Bearer，会在进入业务查询前被统一鉴权拒绝：

| 路径 | HTTP | 结论 |
| --- | ---: | --- |
| `/api/v2/me/profile` | 401 | 预期 `unauthorized` |
| `/api/v2/appointments/records` | 401 | 预期 `unauthorized` |
| `/api/v2/payments/outpatient/records` | 401 | 预期 `unauthorized` |

本组结果只证明认证边界，没有证明有效微信会话、患者映射、Provider 查询或业务数据存在。

## 4. 验收边界

本窗口可以确认：

- 公网 HTTPS 路由可达；
- 新 API 的健康探针和系统 ping 正常；
- ready 依赖状态正常；
- 受保护的普通资料、预约历史和门诊费用入口未绕过认证。

本窗口不能确认：

- 微信真机登录、session TTL 或患者同步；
- 多就诊人显式切换和患者归属；
- 预约/门诊费用 Provider 返回、金额或状态；
- 报告、病历、绑卡、支付、医保、退款或 HIS 回写。

下一步仍需按 [`next-business-gates-2026-08-20.md`](next-business-gates-2026-08-20.md) 使用当前小程序候选取得页面、HTTP 和服务端低敏日志三层证据。
