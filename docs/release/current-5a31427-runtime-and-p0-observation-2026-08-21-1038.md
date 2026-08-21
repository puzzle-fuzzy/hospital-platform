# `5a31427` 运行层与 P0 日志观察（2026-08-21 10:38 CST）

> 当前候选：服务端 release `5a31427`；小程序运行包来源 `8d33a27e5aa4c5808449116bd3c3740d7a823e80`（提交 `8d33a27`）。

> 当前基线更新：服务端 `5a31427`；小程序候选 `8d33a27`；完整运行包来源 `8d33a27e5aa4c5808449116bd3c3740d7a823e80`。本文件的运行观察早于该客户端构建，仅作运行层历史观察。

> 本记录来自服务器 `192.168.112.172` 的只读 SSH 检查与同一时间窗口的公网只读 smoke。没有修改配置、重启服务、调用 Provider、写入 MySQL/Redis 或触碰旧 Python 服务。运行层正常不等于微信、患者、预约、门诊费用或真机业务已经验收。

> 当前发布基线补充（2026-08-21）：本地小程序候选为 `9c582a1`，完整运行包来源为 `9c582a1c38b3b3cdecf7145c6b126b185fe474c2`；本文件的 10:38 运行观察早于该次本地构建，不能作为该候选的真机证据。

## 1. 当前发布与新旧服务共存

| 项目 | 结果 |
| --- | --- |
| 服务器时间 | `2026-08-21T10:38:14+08:00` |
| 新 API release | `/home/ps/code/hospital-platform/releases/5a31427` |
| systemd | `hospital-platform-api-v2.service`：`active/running`，`ExecMainStatus=0` |
| 新 API 监听 | `10.0.0.3:18081`，Bun 进程正常 |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn 4 workers 继续监听 |
| Worker | 未启动，本窗口未改变其状态 |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |

启动日志补充核验：通过 `journalctl` 仅提取低敏字段后，能够看到 `service.started`，其 `environment=production`；同一窗口还出现过 `service.stop.requested`、`service.stopped` 和再次启动事件，说明服务曾经历过受控生命周期变化，但当前状态已经回到 `active/running`。业务请求事件的 `runtimeMode` 字段为空，因此这里只确认生产环境，不把空字段推断成其他运行模式。

## 2. 最近 30 分钟低敏日志聚合

服务器使用当前 release 自带的 `apps/worker/dist/p0-log-aggregate.js` 聚合 journald JSONL，结果如下：

| 指标 | 结果 |
| --- | ---: |
| `inputLines` | 11 |
| `parsedRecords` | 10 |
| `parseErrors` | 0 |
| `http.request.completed` | 4 |
| `http.request.failed` | 6 |
| HTTP 200 / 401 / 404 | 4 / 4 / 2 |
| `providerRequestIdCount` | 0 |
| 业务域事件 | 0；10 条均为 `infrastructure` |
| systemd warning | 0 |
| trace chain | 10 条，`missingCount=0`，未截断 |

这说明本窗口只有健康检查、未登录认证边界和关闭路由探针，没有新的 `auth.*`、`patient.*`、`appointment.*` 或 `outpatient.payment.*` 业务请求；不能据此判断 Provider 失败或业务成功。

## 3. 公网只读 smoke（2026-08-21 10:38:41 CST）

公网入口为 `https://test-hp.meiyi.pro/api/v2`，未携带 Bearer、微信身份、患者标识或 Provider 凭证：

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `GET /health/live` | 200 | `status=ok` |
| `GET /health/ready` | 200 | MySQL/Redis/schema 均为 `ok` |
| `GET /system/ping` | 200 | API 基础响应正常 |
| `GET /me`、`GET /patients` | 401 | 未登录按预期拒绝 |
| `GET /appointments/records`、`GET /payments/outpatient/records` | 401 | 未登录按预期拒绝 |
| `GET /medical-records`、`GET /patient-binding/commands` | 404 | 病历与患者绑定 gate 继续关闭 |

## 4. 小程序候选绑定与下一步

10:38 观察窗口早于后续构建；当前发布基线已更新为 `7a6f4df` / `7a6f4df34fac5975c6012a30d2c137953a892059`。该来源只用于当前发布文档一致性，不代表本服务器窗口已经运行小程序或完成真机验收。下一步必须由用户使用该候选重新普通编译并扫码，保留页面、客户端 requestId/traceId 和服务器同链低敏事件；在真实业务请求出现前，不升级任何 P0 业务验收等级。
