> **当前候选同步（2026-08-28）**：服务端 release `5738a71e0bcddaa8849106754baf5b296427bed7`；本地小程序 live/pending 运行包 sourceRevision `935410473e5a7c1be125a85834f957f53a833d8f`；历史段落只作追溯。

> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `935410473e5a7c1be125a85834f957f53a833d8f`（`9354104`），共 38 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

> 当前配套小程序运行包来源（2026-08-28）：`935410473e5a7c1be125a85834f957f53a833d8f`（`9354104`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

# 当前线上共存只读观察（2026-08-24 13:42 CST）
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。
> 当前线上服务端 release（2026-08-27）：`5738a71e0bcddaa8849106754baf5b296427bed7`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前小程序配套运行包来源（2026-08-28）：`935410473e5a7c1be125a85834f957f53a833d8f`（`9354104`）；本文中更早候选和真机窗口仅作历史追溯，当前无真机/开发者工具会话。

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
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
> 当前统一发布基线补充（2026-08-28）：服务端 release 为 `5738a71e0bcddaa8849106754baf5b296427bed7`；小程序本地 live 运行包来源为 `935410473e5a7c1be125a85834f957f53a833d8f`，共 38 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。


> 当前发布基线补充（2026-08-27）：服务端线上 release 为 5738a71e0bcddaa8849106754baf5b296427bed7；本地 live 小程序构建来源仍为 1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916。本行只同步当前运行层指纹，文档中的历史发布记录仍保留用于追溯。
