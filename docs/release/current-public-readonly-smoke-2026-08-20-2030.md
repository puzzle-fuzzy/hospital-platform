# 当前公网只读边界复核（2026-08-20 20:30 CST）

## 复核范围

本次只通过公网 HTTPS 访问新 API，不携带 Bearer 会话，不调用 Provider，不写入 MySQL/Redis，
也没有操作旧 Python 服务。目的只是确认真机即将使用的公网路径和未登录认证边界仍然清晰。

| 请求 | HTTP | 结果摘要 |
| --- | ---: | --- |
| `GET /api/v2/health/live` | 200 | `status=ok`，服务名为 `hospital-api` |
| `GET /api/v2/health/ready` | 200 | `status=ready`，`database/redis/schema=ok` |
| `GET /api/v2/system/ping` | 200 | API 进程响应正常 |
| `GET /api/v2/me` | 401 | `unauthorized`，未登录请求被拒绝 |
| `GET /api/v2/patients` | 401 | `unauthorized`，未登录患者目录被拒绝 |

## 结论边界

- 公网 `/api/v2` 路由、HTTPS、readiness 和认证前置门禁正常。
- 未携带会话时不会泄露用户资料或患者目录，也没有进入患者/Provider 业务模块。
- 本次没有产生微信登录、患者目录读取、患者同步、预约、报告、门诊费用或普通资料业务事件，
  因此不提升任何业务域的真机或 Provider 验收等级。
- 当前真机验收仍必须使用对应 `8f80b3e` 候选二维码，按“登录 → 患者同步 → 显式切换 → 只读业务”顺序
  同时采集页面、客户端 HTTP 和服务端低敏日志三层证据。

## 旧服务边界

本次仅访问新服务公网只读路径；旧 Python `8001` 未修改、未重启，旧域名路径未被切换。
