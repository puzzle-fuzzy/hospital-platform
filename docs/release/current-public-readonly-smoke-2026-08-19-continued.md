# 2026-08-19 当前公网只读复核（继续窗口）

> 本记录只覆盖当前公网入口的运行层和未登录认证边界，不代表微信真机、患者目录、Provider、预约、报告、门诊费用或任何写入能力已经验收。
> 本次没有携带 Bearer、微信 code、患者 ID 或 Provider 参数，也没有修改旧 Python 服务、数据库、Redis 或线上配置。

## 复核对象

- 公网入口：`https://test-hp.meiyi.pro/api/v2`
- 当前服务端基线：`65219e2`
- 请求方式：匿名 HTTPS `GET`
- 复核范围：健康探针、system ping、未登录业务认证边界

## 结果

| 请求 | HTTP | 低敏结果 |
| --- | ---: | --- |
| `/health/live` | 200 | `success=true`，`status=ok`，服务为 `hospital-api` |
| `/health/ready` | 200 | `status=ready`，`database=ok`、`redis=ok`、`schema=ok` |
| `/system/ping` | 200 | `service=hospital-api`，`apiVersion=0.1.0` |
| `/me` | 401 | `unauthorized` |
| `/patients` | 401 | `unauthorized` |
| `/appointments/records?patientId=probe` | 401 | `unauthorized` |
| `/payments/outpatient/records?patientId=probe&status=unpaid` | 401 | `unauthorized` |

## 结论与边界

本次可以确认公网入口仍然指向可用的新 API，且未登录请求不会越过会话认证进入患者范围业务。由于没有有效微信会话，
本次没有读取患者档案、临床 `patId`、预约记录或费用数据，也没有形成 `traceId/requestId + 页面结果 + 低敏服务端日志`
三层业务证据。因此患者同步/切换、预约历史、爽约、门诊费用、报告和普通资料仍不能据此标记为真实完成。

下一步仍需使用与当前候选来源匹配的新小程序包，在受控环境完成微信登录、患者同步和显式切换，再按各业务域分别记录 HTTP
结果、Provider 请求关联和页面结果；支付、医保、退款与 HIS 回写继续最后处理。
