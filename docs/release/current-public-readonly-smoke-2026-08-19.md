# 2026-08-19 重启后公网只读运行复核

更新时间：2026-08-19 02:04 CST

本记录用于补充一次本地重启后的公网只读观察。它只证明当前公网 `/api/v2` 入口仍能到达新
Bun/Elysia API，并不能替代服务器 SSH 进程核对、真实微信会话、Provider 业务或真机页面验收。

## 1. 请求结果

| 请求 | 结果 | 说明 |
| --- | --- | --- |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | `200` | 服务存活；响应带 `Cache-Control: no-store` |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok`；响应带 `Cache-Control: no-store` |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | `200` | 系统探针可达 |
| `GET https://test-hp.meiyi.pro/api/v2/me` | `401 unauthorized` | 未携带 Bearer 时认证边界正常 |

本轮没有携带微信会话、患者标识或 Provider 参数，没有执行 MySQL/Redis 写入、同步、预约、
报告、费用、支付、医保或 HIS 操作。

## 2. SSH 进程边界

本轮第一次使用无密钥批处理 SSH 时服务器返回 `publickey`；随后使用既有账号的密码认证完成了
只读检查。没有修改 SSH 配置，也没有执行切换、重启、迁移或业务写入。

### 2.1 初次无密钥尝试

第一次 SSH 没有建立会话，因此该次尝试本身不产生服务器状态结论；后续只读结果以 2.2 为准。

### 2.2 当前只读 SSH 复核（2026-08-19 06:54 CST）

| 检查 | 结果 |
| --- | --- |
| `current` 指针 | `/home/ps/code/hospital-platform/releases/b7c9451` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081`，Bun 进程 |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn 进程仍在监听 |
| 最近 API 日志 | 采样命中两条未携带会话访问 `/me` 的预期 `401/unauthorized`；未命中 `unavailable`、解析错误或 systemd warning |

本次 SSH 仅读取 release 指针、进程监听和低敏日志摘要，没有触碰旧 Python 服务、数据库、Redis、
Worker 或任何业务数据。该结果确认新旧服务共存和运行层稳定，不增加真实微信、患者切换、Provider、
真机、支付或医保验收结论。

## 2.1 后续只读复核（2026-08-19 06:42 CST）

在没有 Bearer、openid、患者参数或写入操作的前提下再次从公网复核：`health/live`、`health/ready`
和 `system/ping` 均返回 `200`，`health/ready` 的 `database/redis/schema` 均为 `ok`；`GET /me`
返回预期 `401 unauthorized`。本次 `/me` 响应的低敏 `x-request-id` 为
`7d4373db-3cf1-4ed6-b2b9-e913a5a80b7a`，未保存响应以外的会话或身份信息。

这次复核仍只证明公网运行层和未登录认证边界，不证明线上 release 指针、旧 Python 共存、Provider、
微信真机或任何患者/费用业务已经验收。

## 2.3 当前公网只读复核（2026-08-19 07:07 CST）

本轮只从公网请求健康探针和未登录 `/me`，没有携带 Bearer、openid、患者参数或 Provider 参数，也没有执行
数据库、Redis 或业务写入。结果如下：

| 请求 | 结果 | 低敏说明 |
| --- | --- | --- |
| `GET /api/v2/health/live` | `200` | `status=ok` |
| `GET /api/v2/health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok` |
| `GET /api/v2/system/ping` | `200` | 新 API 路由可达 |
| `GET /api/v2/me` | `401 unauthorized` | 未携带 Bearer 时认证门禁正常，`x-request-id=1c49a006-9789-4f8b-a6f5-588ba0c8c31f` |

这次结果只补充公网入口和未登录认证边界；SSH 双服务共存、真实微信会话、患者切换、Provider、真机、
费用、支付和医保仍以各自的独立证据为准。

## 2.4 当前公网只读复核（2026-08-19 07:20 CST）

本轮再次只请求公网健康探针和未登录 `/me`，没有携带 Bearer、openid、患者参数或 Provider 参数，
也没有执行数据库、Redis 或业务写入。最终 HTTP 结果如下：

| 请求 | 结果 | 低敏说明 |
| --- | --- | --- |
| `GET /api/v2/health/live` | `200` | `status=ok`，响应带 `Cache-Control: no-store`，`x-request-id=e137e949-98e3-41af-b43d-826d1e3a5975` |
| `GET /api/v2/health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok`，响应带 `Cache-Control: no-store`，`x-request-id=74de7833-79d0-427c-9582-82e008bc45fd` |
| `GET /api/v2/system/ping` | `200` | 新 API 路由可达，`x-request-id=f56cc61a-cdc4-4836-bf7a-938adc1f26ad` |
| `GET /api/v2/me` | `401 unauthorized` | 未携带 Bearer 时认证门禁正常，`x-request-id=e71926f1-b940-4412-93e8-7fa095896f56` |

该复核只更新公网运行层和未登录认证证据，不增加 SSH 双服务共存、真实微信会话、多患者切换、
Provider、真机、费用、支付或医保结论。

## 2.5 当前公网只读复核（2026-08-19 09:13 CST）

本轮从公网再次只请求运行层探针和未登录 `/me`，没有携带 Bearer、openid、患者参数或 Provider 参数，
也没有执行数据库、Redis 或业务写入。结果如下：

| 请求 | 结果 | 低敏说明 |
| --- | --- | --- |
| `GET /api/v2/health/live` | `200` | `status=ok` |
| `GET /api/v2/health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok`，响应带 `Cache-Control: no-store` |
| `GET /api/v2/system/ping` | `200` | 新 API 路由可达 |
| `GET /api/v2/me` | `401 unauthorized` | 未携带 Bearer 时认证门禁正常 |

本轮尝试使用无密钥批处理 SSH 只读连接时被服务器以 `publickey,password` 拒绝，因此没有新增
`current` 指针、systemd、`18081/8001` 监听或 journald 结论；服务器进程边界继续以本文件 2.2
和路线图顶部最近一次成功 SSH 复核为准。公网结果也不增加真实微信、多患者切换、Provider、真机、
费用、支付或医保验收结论。

## 3. 后续动作

继续按当前路线图执行：先取得可验证的真实微信会话和多就诊人切换证据，再分别验收预约历史、
门诊费用和报告只读链路。二维码、全部挂号、预约写入、支付、医保和 HIS 继续保持关闭，直到
取得对应的 Provider contract、脱敏样例、错误语义和真机证据。
