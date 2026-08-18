# 当前运行层新旧服务共存只读复核（2026-08-18 21:36 CST）

本文记录重启后再次通过 SSH 对当前运行层进行的只读复核。它只证明新 API、旧 Python 服务和公网健康路径保持可用，
不证明微信会话、患者切换、预约历史、门诊费用、报告、支付、医保或 HIS 业务已经完成验收。

## 1. 复核范围

本次只执行了以下读取操作：

- 读取 `/home/ps/code/hospital-platform/current` 指针；
- 读取 `hospital-platform-api-v2.service` 的 active 状态；
- 读取新旧 API 监听端口；
- 请求公网 `/api/v2/health/ready`。

本次没有重启服务、切换 release、执行 migration、修改旧 Python 项目、写入 MySQL/Redis 或携带患者/Provider 业务参数。

## 2. 结果

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/687690e` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python API 监听 | `0.0.0.0:8001` |
| 公网 `GET /api/v2/health/ready` | HTTP 200 |
| 公网 ready 依赖 | `database=ok`、`redis=ok`、`schema=ok` |

## 3. 结论边界

新旧服务仍在不同端口共存，当前 release 没有发生漂移；这只解除运行层的重启后检查，不会把旧业务日志、
健康探针或 readiness 结果当成新版本患者业务成功。

下一步仍按 [`miniprogram-readonly-acceptance-candidate-2026-08-18.md`](miniprogram-readonly-acceptance-candidate-2026-08-18.md)
执行：先由新 `miniprogram` 项目建立有效微信设备连接，再采集页面、HTTP trace 和当前 release 低敏日志三层证据。
真实 Provider 字段、多患者切换/失效恢复、Redis TTL、普通资料 PUT/409 及支付/医保/HIS 继续分别验收，不能互相替代。

## 4. 继续工作后的 SSH 只读复核（2026-08-18 21:43 CST）

为确认本轮继续工作期间没有发生运行层漂移，再次执行同范围只读检查：`current` 仍指向
`releases/687690e`，`hospital-platform-api-v2.service` 仍为 `active`，新 API 仍监听
`10.0.0.3:18081`，旧 Python API 仍监听 `0.0.0.0:8001`；公网
`GET /api/v2/health/ready` 仍返回 HTTP 200，`database`、`redis`、`schema` 均为 `ok`。

本次没有重启、release 切换、migration、旧项目修改或 MySQL/Redis 写入；运行层证据仍不能替代新小程序的
真实微信设备连接、患者切换和只读业务三层验收。

## 5. 重启后继续工作的公网只读复核（2026-08-18 21:57 CST）

为确认刚才重启后没有发生运行层漂移，再次执行公网和 SSH 只读复核。当前 release 仍为 `687690e`，
`hospital-platform-api-v2.service` 仍为 `active`，新 API 仍监听 `10.0.0.3:18081`，旧 Python API
仍监听 `0.0.0.0:8001`。

| 检查项 | 结果 | 低敏关联信息 |
| --- | --- | --- |
| `GET /api/v2/health/live` | HTTP 200，`status=ok` | `x-request-id=b5dcc308-36f9-4d9a-887c-d72726da7be1` |
| `GET /api/v2/health/ready` | HTTP 200，`database=ok`、`redis=ok`、`schema=ok` | `x-request-id=7c38300a-7e3a-4d7e-9038-1ebd964ab19a` |
| `GET /api/v2/system/ping` | HTTP 200，服务身份正常 | `x-request-id=ce71fd30-1698-4ab8-9ad1-3651810345ae` |
| 未登录 `GET /api/v2/me` | HTTP 401，`unauthorized` | `x-request-id=f2a00c28-60f4-48c6-9186-339b3d90d2b6` |
| 未登录 `GET /api/v2/patients` | HTTP 401，`unauthorized` | `x-request-id=85e8da32-ddd3-48fe-baf5-271d71bd3670` |

这里的 system ping 正确路径是 `/api/v2/system/ping`；`/api/v2/health/system-ping` 不属于当前新 API
健康路由，返回 404 不能作为服务故障证据。本次没有重启服务、切换 release、执行 migration、修改旧
Python 项目或写入 MySQL/Redis；上述结果只解除重启后的运行层检查，仍不增加微信会话、真机、多患者、
预约、报告、费用、支付、医保或 HIS 业务验收结论。

## 6. 重启后低敏日志窗口（2026-08-18 21:52–22:00 CST）

使用当前 release `687690e` 自带的 `apps/worker/dist/p0-log-aggregate.js`，通过 SSH 账号可读取的
journald 权限对本窗口进行聚合；没有输出原始日志。结果为：`parsedRecords=9`、`parseErrors=0`、
`traceIdCount=9`、`providerRequestIdCount=0`；HTTP 状态计数为 `200=5`、`401=2`、`404=2`。

事件计数只有 `http.request.completed=5` 和 `http.request.failed=4`，没有
`auth.wechat.*`、`patient.*`、`appointment.*`、`report.*` 或 `outpatient.payment.*` 业务事件。
因此本窗口没有形成新微信登录、患者切换、预约历史、报告或门诊费用的业务验收链；前述 200/401/404
只能解释为运行层、未登录边界或探针路径访问，不能替代页面、HTTP trace 和业务成功事件的三层证据。
