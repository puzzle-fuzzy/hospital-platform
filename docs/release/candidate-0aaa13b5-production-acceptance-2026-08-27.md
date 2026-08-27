> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为
> `02865d385a9c09876dc51da1ffb71183139a559b`（`02865d3`），共 40 个页面；手机业务证据尚未采集，
> 九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

# `0aaa13b5` 新 API 生产共存发布验收记录（2026-08-27）

> 本记录只证明新 Bun/Elysia API 的候选构建、真实生产依赖、隔离运行、原子切换、公网 HTTPS smoke
> 和稳定错误码日志投影；不把运行层证据误写成微信真机、Provider、支付或医保业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0aaa13b53cb6e21b59b332dbd4e2b982a5aba1e7` |
| 小程序客户端 | `02865d3`（本地 live，独立于服务端发布） |
| 小程序构建来源 | `02865d385a9c09876dc51da1ffb71183139a559b` |
| 切换前服务端 release | `b44421cd321ff9ff23eeb49b12641d1772d2bdc1` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 数据库 schema | `0016_patient_directory_sync_owner_index`，未执行 migration |

## 候选与切换验证

- 真实 production env preflight 通过，MySQL、Redis、schema 为 `ok`，支付和报告 gate 仍关闭。
- 8 个 bundle 已上传到独立 release 目录，并逐项与本地产物 SHA-256 一致。
- 候选隔离运行在 `127.0.0.1:18082`；API 启动日志为 `environment=production`，live `200`、ready 连续 `3/3`、system ping `200`、未登录边界 `401`、关闭能力 `404` 全部通过，临时进程已回收。
- 2026-08-27 19:31 CST 只执行 `current.next -> current` 原子切换，并只重启 `hospital-platform-api-v2.service`。
- 切换后新 API active、`18081` 监听、旧 `8001` 继续监听、Worker inactive，内网和公网 readiness 的 database/redis/schema 均为 `ok`。
- 发送不带会话的公网 `GET /api/v2/me` 后，HTTP `401` 响应和 journald 同链事件均记录公开错误码 `unauthorized`。
- 没有执行 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 当前业务边界

本记录不产生真机业务成功结论。当前本地 live 小程序仍需从 `apps/miniprogram/dist/` 重新普通编译并生成二维码，
再逐域采集页面、客户端 requestId、服务端 Pino 和适用 Provider 低敏 requestId。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭；若发生故障，只允许按本候选记录把新 API `current`
原子回滚到切换前 release 并重启新 API，旧 Python 服务保持不变。
