# 候选 `86cae9a` 生产环境临时端口 Smoke（2026-08-16）

> 本文记录候选运行和认证边界证据，不代表已经切换公网，也不代表真实微信、provider 或真机业务已经验收。

## 1. 候选来源

- 候选 commit：`86cae9a`；
- 候选目录：`/home/ps/code/hospital-platform/releases/86cae9a`；
- 验证期间生产 `current` 始终为 `/home/ps/code/hospital-platform/releases/55fce6c`；
- API bundle SHA-256：`cc8159314a67e168686ae168ae3eb48ceb16bc9657d2b1fe1ed4956acb608b2d`；
- Worker bundle SHA-256：`c3cd465fc8eec3f9330981efcad374241a29707a02b942ef39d1aaed758e1f79`；
- 依赖使用服务器既有生产 release 的运行时目录，本地构建 bundle 后上传，未在服务器临时安装依赖。

## 2. 生产环境临时运行

候选使用服务器已有 `shared/api.env`，只覆盖 `PORT=18082`。没有修改共享 env、没有执行 migration、
没有启动 worker，也没有发起真实 provider、患者或支付请求。

启动日志确认 `runtimeMode=production`，`persistenceDatabaseProbe`、`persistenceRedisProbe`、
`persistenceSchemaProbe` 均为 `ok`，认证运行时为 `ready`；患者目录、预约目录、预约记录和门诊费用
配置为 `configured`，微信支付和报告 gate 仍为关闭。

| 请求 | 结果 |
| --- | --- |
| `GET /health/live` | HTTP 200，`status=ok`，响应含 `Cache-Control: no-store` |
| `GET /health/ready` | HTTP 200，`status=ready`，database/redis/schema 均为 `ok`，响应含 `Cache-Control: no-store` |
| `GET /api/v1/system/ping` | HTTP 200，返回 `hospital-api` |

## 3. 未登录认证边界

以下请求均使用合法的最小输入，不携带 `Authorization`，全部返回 HTTP 401 和稳定错误码
`unauthorized`，没有进入 provider 查询：

- `/api/v1/me`；
- `/api/v1/patients`；
- `/api/v1/appointments/departments`；
- `/api/v1/appointments/records?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02`；
- `/api/v1/reports?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02`；
- `/api/v1/payments/outpatient/records?patientId=runtime-smoke-patient&status=unpaid`。

注意：如果报告或预约历史缺少必填 query，Elysia 会先返回 `validation`；这属于输入校验门禁，不能
替代未登录 401 验收。运行时 Smoke 已固定使用合法最小 query，避免混淆两类结果。

临时进程验证结束后已清理，`18082` 确认为 down；`18081` 和旧 Python `8001` 仍在监听，`current`
未改变。公网 `/api/v2` no-store 和原子切换仍需实际 Nginx 配置及窄权限 systemd 验收。

