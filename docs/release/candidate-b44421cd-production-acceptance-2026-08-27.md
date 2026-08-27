> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `d4f67485a34195a2e1e392071502cf2a7006dd27`（`d4f6748`），共 40 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

# `b44421cd` 新 API 生产共存发布验收记录（2026-08-27）

> 本记录只证明新 Bun/Elysia API 的候选构建、真实生产依赖、隔离运行、原子切换和公网 HTTPS smoke；不把运行层证据误写成微信真机、Provider、支付或医保业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `b44421cd321ff9ff23eeb49b12641d1772d2bdc1` |
| 小程序客户端 | `d4f6748`（本地 live，独立于服务端发布） |
| 小程序构建来源 | `d4f67485a34195a2e1e392071502cf2a7006dd27` |
| 切换前服务端 release | `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 数据库 schema | `0016_patient_directory_sync_owner_index`，未执行 migration |

## 候选与切换验证

- `pnpm check:candidate`、真实 production env preflight 和 8 个 bundle SHA-256 对照通过。
- 候选在 `127.0.0.1:18082` 以 `runtimeMode=production` 启动；live `200`、ready 连续 `3/3`、system ping `200`、未登录边界 `401`、关闭能力 `404` 全部通过，隔离进程已回收。
- 2026-08-27 16:53 CST 只执行 `current.next -> current` 原子切换，并只重启 `hospital-platform-api-v2.service`。
- 切换后新 API active、`18081` 监听、旧 `8001` 继续监听、Worker inactive，内网和公网 readiness 的 database/redis/schema 均为 `ok`。
- 没有执行 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 当前业务边界

本记录不产生真机业务成功结论。当前无微信开发者工具或真机会话，必须从 `apps/miniprogram/dist/` 重新编译并生成二维码后，逐域采集页面、客户端 requestId、服务端 Pino 和适用 Provider 低敏 requestId。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭；若发生故障，只允许按候选记录把新 API `current` 原子回滚到切换前 release 并重启新 API，旧 Python 服务保持不变。
