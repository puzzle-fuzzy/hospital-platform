# 当前公网运行层观察记录（2026-08-17 22:49 CST）

## 目的

本记录只保存从公网入口获得的低敏运行证据，确认新 API 的健康、依赖和认证边界是否仍然正常。
它不替代有效微信会话、Provider 业务响应、服务器 journald、页面截图或真机验收。

## 请求范围

- 公网入口：`https://test-hp.meiyi.pro`
- 公共版本前缀：`/api/v2`
- 复核时间：2026-08-17 22:49 CST（HTTP Date 为 2026-08-17 14:49:57 GMT）
- 请求方式：只读 `GET`，没有重启、部署、配置修改或数据库写入
- 观测环境：本地 PowerShell `Invoke-WebRequest` 与 `curl.exe`

## 结果

| 请求 | HTTP | 低敏结果 |
| --- | ---: | --- |
| `/api/v2/health/live` | 200 | `status=ok`，`service=hospital-api`，`Cache-Control=no-store` |
| `/api/v2/health/ready` | 200 | `status=ready`，`database=ok`、`redis=ok`、`schema=ok`，`Cache-Control=no-store` |
| `/api/v2/system/ping` | 200 | `service=hospital-api`、`apiVersion=0.1.0` |
| `/api/v2/appointments/records?...`（无 Authorization） | 401 | `error.code=unauthorized` |
| `/api/v2/payments/outpatient/records?...`（无 Authorization） | 401 | `error.code=unauthorized` |

未登录预约历史请求的关联 ID 为 `0ece6340-b0b3-48df-b4b0-1fea38162f1c`，未登录门诊费用请求的
关联 ID 为 `5edfcea0-06da-4ee5-b3f8-65482524289f`。这些 ID 只用于查找低敏请求链，不包含患者或认证凭证。

## 结论与未完成项

1. 新 API 公网健康和就绪依赖仍可用，且健康响应未被缓存；认证边界仍拒绝无会话的预约历史和门诊费用请求。
2. 本次没有有效微信会话，因此不能证明患者归属、预约历史、门诊费用、Provider 映射或页面数据正确。
3. 本次没有取得服务器 journald，不能补充 `appointment.*` 或 `outpatient.payment.*` 的服务端请求/成功事件。
4. 下一步仍需要有效微信会话下逐页触发，并同时保存页面结果、HTTP `x-request-id`、服务端低敏日志和当前发布版本；
   支付、医保授权、退款、预约写入和 HIS 回写继续保持最后处理。
