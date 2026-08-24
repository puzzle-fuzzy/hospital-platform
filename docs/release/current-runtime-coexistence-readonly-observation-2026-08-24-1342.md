# 当前线上共存只读观察（2026-08-24 13:42 CST）

> 本记录只描述一次通过内网 SSH 和公网 HTTPS 完成的只读观察，不代表微信真机、患者、预约、门诊费用、
> 报告、支付、医保或 HIS 业务已经验收。当前服务端 release 为
> `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，当前小程序运行包来源为
> `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。

## 运行层结果

| 检查 | 结果 |
| --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| Worker systemd | `hospital-platform-worker-v2.service=inactive` |
| 当前 release | `/home/ps/code/hospital-platform/releases/28a5c0c131794ce9dcc5f94bd3809402188ac87a` |
| 新 API 监听 | `10.0.0.3:18081`，Bun 进程正常监听 |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn 仍正常监听 |
| 内网 readiness | `200`；`database=ok`、`redis=ok`、`schema=ok` |

本次只读检查没有停止、重启、上传、切换 release、修改旧 Python、写入 MySQL/Redis 或执行 migration。

## 公网探针

当前公网入口 `https://test-hp.meiyi.pro/api/v2` 的以下只读探针均返回 `200`：

- `/health/live`
- `/health/ready`
- `/system/ping`

`/health/ready` 返回的依赖状态为 `database=ok`、`redis=ok`、`schema=ok`。这些探针只证明运行层可用，
不能替代带有效微信会话的患者业务请求。

## 近期低敏日志窗口

通过服务器端聚合最近 60 分钟 API journald，只输出事件名称和计数，不输出原始日志正文、请求头、患者字段、
Provider 响应或凭证：

| 事件 | 次数 |
| --- | ---: |
| `http.request.completed` | 9 |
| `http.request.failed` | 15 |
| `service.started` | 1 |
| `service.stop.requested` | 1 |
| `service.stopped` | 1 |

该窗口没有 `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*`、`report.*` 或 Provider 业务
事件。因此当前仍缺同一小程序候选下的“手机页面 → 客户端 requestId → 服务端 Pino 业务事件”三层证据，不能把
运行层正常误记为业务迁移完成。

## 下一步

继续使用 [`current-13f-real-device-acceptance-runbook-2026-08-24.md`](current-13f-real-device-acceptance-runbook-2026-08-24.md)
中的新二维码，先完成微信登录、患者目录和显式切换，再依次采集预约历史、爽约、门诊费用和普通资料的业务证据。
每一域必须逐步核对页面、客户端 HTTP requestId 和服务端低敏事件；没有手机业务请求产生前，不修改 Provider
适配器，也不打开报告、支付、医保或 HIS 写回。
