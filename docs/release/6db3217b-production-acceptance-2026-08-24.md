> 当前服务端发布更新（2026-08-24）：服务端 release 已切换为 `6db3217bd3c990b009571ffd85b7da55d9ea7338`；小程序运行包来源仍为 `4ba492a3fdae8283409bd2ab4a0a45247c46600c`（提交 `4ba492a`）。

# `6db3217b` 新 API 生产共存发布验收记录（2026-08-24）

> 本记录证明新 Bun/Elysia API 已完成原子切换、生产依赖探针、内外网运行时验收和旧 Python 共存复核；不把健康检查或运行时 smoke 当作真实微信、患者、预约、门诊费用或真机业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `6db3217bd3c990b009571ffd85b7da55d9ea7338` |
| 小程序客户端 | `4ba492a` |
| 小程序构建来源 | `4ba492a3fdae8283409bd2ab4a0a45247c46600c` |
| 发布时间 | 2026-08-24 09:49 CST |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | inactive，未启动 |

## 切换结果

- `current` 已原子切换到 `/home/ps/code/hospital-platform/releases/6db3217bd3c990b009571ffd85b7da55d9ea7338`。
- `hospital-platform-api-v2.service` 为 `active (running)`，Main PID 为 `466077`。
- 新 API 进程启动命令使用 `current/apps/api/dist/index.js`，启动时间为 2026-08-24 09:49:11 CST。
- 旧 Python Gunicorn 主进程 `3687390` 和 4 个 worker `3687419`–`3687422` 仍在运行，启动时间未变化。
- `18082` 临时 smoke 端口已释放。
- 未执行数据库 migration、支付、医保、退款、HIS 写回或 Worker 启动。

## 生产启动日志

启动日志明确记录：

- `environment=production`
- `runtimeMode=production`
- `persistenceDatabaseProbe=ok`
- `persistenceRedisProbe=ok`
- `persistenceSchemaProbe=ok`
- `persistenceRepositories=enabled`
- `authRuntimeStatus=ready`
- `authIdentityGateway=injected`
- `authSessionStore=injected`
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置为 `configured`
- 微信支付为 `disabled` 且 `wechatPaymentRuntime=fail_closed`
- 报告目录和报告详情为 `disabled`

## 内网和公网运行时验收

内网实际监听地址是 `10.0.0.3:18081`，不是 loopback 地址；以下检查均通过：

| 检查 | 结果 |
| --- | --- |
| 内网 `/health/live` | `200` |
| 内网 `/health/ready` | `database/redis/schema=ok` |
| 内网 `/api/v1/system/ping` | `200` |
| 公网 `/api/v2/health/ready` | `200`，`database/redis/schema=ok` |
| 公网 runtime smoke live | `200` |
| 公网 runtime smoke ready | 连续 `3/3` 为 `200` |
| 公网 runtime smoke system ping | `200` |
| 公网未登录认证边界 | `401` |
| 公网关闭能力边界 | `404` |

公网 smoke 使用当前 release 的 `current/apps/worker/dist/api-runtime-smoke.js`，没有携带 Bearer、患者标识、微信 code、支付参数或 Provider 原始报文。

## 日志与回滚边界

本次服务重启产生了清晰的 `service.stop.requested`、`service.stopped` 和新的 `service.started` 结构化日志；健康请求也带有 `requestId`、`traceId`、HTTP 状态码和耗时。旧 Python 服务没有重启、停止或切换流量。

如果后续真实业务出现未解释错误，只允许把 `current` 原子回滚到切换前 release 并只重启 `hospital-platform-api-v2.service`；不得停止旧 Python、删除旧 release、执行 Redis 清库或运行数据库 migration。

## 业务验收状态

当前仍缺少同一服务端 release、同一小程序运行包、真机页面、客户端 requestId 和服务端业务成功日志组成的三层证据。因此微信登录、患者显式切换、预约历史、门诊费用和普通资料仍需真机分域验收；支付、医保、退款、报告 Provider 和 HIS 写回继续保持关闭。
