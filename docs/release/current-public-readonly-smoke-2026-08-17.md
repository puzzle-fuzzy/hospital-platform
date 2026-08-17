# 2026-08-17 公网只读运行复核

> 当前线上 release 已在后续窗口切换为 `131fb5a`；本文件保留早期只读观察，最新发布、认证边界和
> 新旧服务共存证据见 [`131fb5a-production-acceptance-2026-08-17.md`](131fb5a-production-acceptance-2026-08-17.md)。

> 本文记录一次从开发机发起的公网只读观察，不执行登录、患者同步、Provider 请求、支付、写入、重启或发布。
> 它只证明当前公网入口的运行状态和关闭边界，不能替代真实微信、患者 Provider、预约/报告/费用业务和真机验收。

## 1. 复核范围

| 项目 | 值 |
| --- | --- |
| 复核日期 | 2026-08-17（中国标准时间） |
| 公网入口 | `https://test-hp.meiyi.pro/api/v2` |
| 请求方式 | `GET`，未携带用户会话 |
| 变更范围 | 无；只读公网请求 |
| 代理/网关 | HTTPS 公网入口，响应由 `nginx/1.18.0 (Ubuntu)` 返回 |

## 2. 结果

| 请求 | HTTP | 关键响应 | requestId |
| --- | ---: | --- | --- |
| `GET /api/v2/health/live` | 200 | `success=true`、`data.status=ok`、`service=hospital-api`、`Cache-Control: no-store` | `ebe0511f-2af4-4f66-8d65-f49941322fdc` |
| `GET /api/v2/health/ready` | 200 | `success=true`、`data.status=ready`；`database=ok`、`redis=ok`、`schema=ok`；`Cache-Control: no-store` | `a8ab1e68-b8fa-4e40-b8f5-fb8e4ad3fcee` |
| `GET /api/v2/system/ping` | 200 | `success=true`、`service=hospital-api`、`apiVersion=0.1.0` | `0c6a872b-09e4-482d-a0a6-be93f5a4c616` |
| `GET /api/v2/medical-records` | 404 | `success=false`、`error.code=not-found` | `18d36cd3-ae92-49f7-9ff5-aaf5a7230e36` |

## 2.1 最新公网复核（2026-08-17 01:53 CST）

本次仍从开发机发起无会话 GET，只验证当前公网路由和基础依赖，没有读取环境变量、数据库、患者、Provider
或业务写入。响应 `Date` 为 UTC，已换算为中国标准时间；`x-request-id` 为网关/API 返回的关联标识。

| 请求 | HTTP | 关键响应 | `x-request-id` |
| --- | ---: | --- | --- |
| `GET /api/v2/health/live` | 200 | `success=true`、`data.status=ok`、`Cache-Control: no-store` | `a3546e98-a73a-474d-997f-7790655ea33f` |
| `GET /api/v2/health/ready` | 200 | `success=true`、`data.status=ready`；`database=ok`、`redis=ok`、`schema=ok`；`Cache-Control: no-store` | `3857d4af-62f7-4c1c-8c3b-436c7b8d2640` |
| `GET /api/v2/system/ping` | 200 | `success=true`、`service=hospital-api`、`apiVersion=0.1.0` | `969a54a4-be5f-461e-9ba6-7b7621459676` |
| `GET /api/v2/me` | 401 | `success=false`、`error.code=unauthorized` | `8e6ddc0f-1ffc-475d-8cb6-9ca258a9db74` |

这次复核支持“公网运行边界仍正常”的结论，但不能证明 `bab0ce2` 的真实微信会话、患者目录、预约历史、
门诊费用、报告 Provider 或真机页面业务已经完成；当前仍缺少认证会话和患者作用域请求证据。

## 2.2 最新公网 runtime smoke（2026-08-17 03:26:24-03:26:27 CST）

本次使用仓库内 `runtime:smoke` 入口，从开发机对同一公网 `/api/v2` 发起只读请求，运行环境为 `production`，
连续 readiness 采样 3 次，间隔 250ms。没有携带 access token、患者号或 Provider 凭证，也没有执行登录、同步、
预约、报告、费用、支付或任何写入。该 smoke 证明当前公网边界在本次观察窗口通过，不证明本地 `main` 或某个
指定 commit 已部署到公网；release provenance 仍以服务器侧发布证据为准。

| 检查 | 结果 | trace/request 证据 |
| --- | --- | --- |
| `health-live` | 200，`status=passed` | `7de0709a-f62b-4190-9e98-1227357f5528` |
| `health-ready` | 200，`status=passed`，连续 3/3 | `1c135557-cf88-4d1f-8215-05aa7752d102`、`e12994b9-8b4a-49a2-ac05-94fd291b389d`、`9b2dedcc-0e5b-48cb-9e7b-5ab119687dff` |
| `system-ping` | 200，`status=passed` | `04810a32-d9f9-4967-8f1a-045bc2d458b0` |
| `auth-boundary` | 401，`status=passed` | `e61ee25c-df2b-46c5-a80c-8d9b650af6d1` |

本次 smoke 只更新公网基础运行证据，不更新任何 P0 业务领域的验收状态；真实微信会话、Redis TTL、患者切换/失效
恢复、预约历史、报告和门诊费用仍必须按 P0 手册分别取得 Provider、平台公网、真机和服务端日志证据。

## 2.3 最新公网 runtime smoke（2026-08-17 09:17 CST）

本次继续使用仓库内 `runtime:smoke` 入口从开发机发起公网只读请求，目标为 `/api/v2`；连续 readiness
采样 3 次，间隔 500ms，要求 readiness 为 ready。运行器本身为 development 环境，但目标是公网线上地址；
没有携带 access token、患者号或 Provider 凭证，也没有执行登录、同步、预约、报告、费用、支付或任何写入。

| 检查 | 结果 | trace/request 证据 |
| --- | --- | --- |
| `health-live` | 200，`status=passed` | `9b32bb43-9fd4-4603-a8f6-b72a3bcf1642` |
| `health-ready` | 200，`status=passed`，连续 3/3 | `de38918d-b2c5-4dfa-bf3e-7600235bc419`、`eb3398e5-bea4-4d57-8ab5-bf372e8ea439`、`d58bdb7b-bb8d-4b7a-9fdb-7e52fa89de46` |
| `system-ping` | 200，`status=passed` | `d611fc9c-98cc-4208-a484-5992b91f15ee` |
| `auth-boundary` | 401，`status=passed` | `17403d13-3b06-4cd0-a729-9a6c494e4fe1` |

本次只更新公网运行边界证据，不能证明本地 `main` 的 `58e342f` 已部署，也不能更新微信会话、Redis TTL、
多患者切换、预约历史、报告或门诊费用的 P0 验收状态；服务器 release provenance 和业务日志仍需通过受控
SSH 单独取得。

## 3. 结论与限制

- 当前公网 API 进程可响应，数据库、Redis 和 schema readiness gate 均通过。
- 健康探针保留 `Cache-Control: no-store`，本次观察没有发现缓存健康状态的证据。
- `/api/v2/medical-records` 仍是关闭边界；病历未取得独立 Provider/HIS contract 前，不应因为健康检查正常而注册该路由。
- 本次没有携带会话，因此没有证明微信登录、患者映射、多就诊人切换、预约历史、报告或门诊费用的真实结果。
- 本次没有查询服务器进程、systemd、旧 Python `8001` 或新 API `18081`，因此不能用本文单独证明新旧服务仍在服务器上共存；该结论必须引用服务器侧验收证据。

## 4. 下一步

1. 使用受控微信账号完成患者同步和第二条患者的切换/失效恢复，并保存服务端日志与真机网络证据。
2. 在同一发布版本上分别完成预约历史、报告目录和门诊费用的 Provider、内网 API、公网 HTTPS、开发者工具/真机四层证据。
3. 新 Provider 文档到达后，先更新 intake 指纹、字段白名单、状态机和公开 API contract，再实现代码；本证据不能作为任何写入、支付或医保能力的授权。
