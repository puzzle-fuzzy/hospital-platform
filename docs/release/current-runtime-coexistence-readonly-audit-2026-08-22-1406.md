# 当前运行层与公网前缀只读复核（2026-08-22 14:06）

> 本记录只保存一次只读运行观察，不修改服务、数据库、Redis、Nginx 或旧项目。当前候选仍为服务端 `9f479c9a`、小程序来源 `41c708e1adf864ef6fef1f788e97aa8fb4371227`。

## 1. 复核范围

本次通过 SSH 读取服务器进程/监听状态，并访问公开 HTTPS 入口。没有执行重启、发布、migration、清理、业务写入或 Provider 请求。

| 项目 | 观察结果 |
| --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service` 为 `active` |
| 新 API 内网监听 | `10.0.0.3:18081` |
| 旧 Python 服务 | `0.0.0.0:8001` 仍在监听；本次未修改、未停止、未重启 |
| 新 Worker | 本次未触碰 |
| 复核时间 | 服务器时间 `2026-08-22 14:06:05 CST` |

## 2. 探针结果

### 2.1 新 API 内网地址

以下请求使用实际监听地址 `10.0.0.3:18081`：

| 请求 | HTTP |
| --- | ---: |
| `GET /health/live` | `200` |
| `GET /health/ready` | `200` |

直接请求 `127.0.0.1:18081` 失败并不表示服务停止：当前服务明确绑定在 `10.0.0.3`，而不是 loopback 地址。后续服务器维护探针必须使用 systemd 配置的实际监听地址，或者直接使用公网入口。

### 2.2 公网 HTTPS 入口

| 请求 | HTTP |
| --- | ---: |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | `200` |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | `200` |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | `200` |
| `GET https://test-hp.meiyi.pro/api/v2/medical-records` | `404` |

`medical-records` 的 `404` 是当前病历能力保持关闭的预期结果，不应改成占位成功或转发旧接口。

## 3. 路径边界说明

Elysia 在服务内部注册业务路径 `/api/v1/*`，公网 Nginx 对外提供版本化入口 `/api/v2/*` 并完成前缀映射；健康检查是公网映射到根路径的例外。

因此：

1. 线上业务验收使用 `https://test-hp.meiyi.pro/api/v2/*`；
2. 服务器进程内探针使用 `http://10.0.0.3:18081/health/*`，业务内部调试才使用 `/api/v1/*`；
3. 不要把 `http://127.0.0.1:18081` 或内部 `/api/v2/*` 的失败误判为公网服务故障；
4. 这条前缀映射不改变旧 Python `8001` 的路由和进程，不需要修改旧服务。

## 4. 启动日志中的能力闸门

同一服务器上读取到的最新 `service.started` 低敏字段仍保持以下状态：

| 能力 | 当前状态 | 结论 |
| --- | --- | --- |
| 运行模式 | `production` | 当前进程不是开发模式实例 |
| MySQL / Redis / schema | `ok` / `ok` / `ok` | repository 与 Redis 会话已注入 |
| 微信身份 | `configured` / `authRuntimeStatus=ready` | 允许继续做微信会话真实验收 |
| 患者目录 | `configured` | 允许继续做患者目录真实验收 |
| 预约科室/排班 | `configured` | 允许继续做预约目录只读真实验收 |
| 预约历史 | `configured` | 允许继续做预约历史/爽约只读真实验收 |
| 门诊费用目录 | `configured` | 仅允许做门诊费用只读真实验收 |
| 微信支付 | `disabled` | 不调起支付，不修改支付 gate |
| 报告目录/详情 | `disabled` / `disabled` | 不调用报告 Provider，不把代码骨架当作可用能力 |

`configured` 只表示启动配置字段完整并完成依赖注入，不等于 Provider 业务或真机已成功；真实完成仍需页面、客户端请求和服务端同链日志三层证据。`disabled` 是明确的 fail-closed 状态，不应通过补环境变量或前端跳转绕过。

## 5. 业务结论

本次只证明新旧服务的运行层共存和公网路由边界正常，不能替代微信会话、患者显式切换、预约历史/爽约、门诊费用、报告 Provider 或真机三层业务证据。支付、医保授权、退款、预约写入和 HIS 回写继续保持最后处理。

下一步仍需取得同一小程序候选下的：页面结果、客户端 requestId/HTTP 结果、服务端 Pino 同链事件；没有这三层证据，不把只读业务标记为真实完成。
