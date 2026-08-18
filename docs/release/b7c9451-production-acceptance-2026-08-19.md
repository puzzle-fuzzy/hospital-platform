# `b7c9451` 生产切换与 P0 日志关联门禁验收

更新时间：2026-08-19 00:48–00:50 CST

## 1. 切换范围

本次从 `c26e696` 切换到 `b7c9451`，目标是让线上新 Bun/Elysia 服务使用带有
`traceId/requestId` 同链摘要的 P0 日志工具。候选的 API、preflight、Provider smoke 和
常驻 Worker bundle 与上一候选保持一致；本次实际变化集中在 `p0-log-aggregate` 和
`p0-business-evidence-audit` 的发布产物。

- 只切换 `/home/ps/code/hospital-platform/current`，并只重启 `hospital-platform-api-v2.service`；
- 旧 Python/Gunicorn `8001` 未停止、未重启、未修改；
- `hospital-platform-worker-v2.service` 保持 `inactive`，没有启动 Worker；
- 没有执行数据库 migration、MySQL/Redis 业务写入、Redis 清理或环境文件修改；
- 预约写入、锁号、取消、支付、医保、退款、HIS 回写和报告 Provider gate 继续关闭。

当前验收组合基线：

| 层级 | 固定值 |
| --- | --- |
| 服务端 release | `b7c9451` |
| 小程序客户端 | `07dde51`（当前本地候选，未随本次服务端切换上传） |
| 小程序构建来源 | `07dde51d84888a33a762bcdffa2d74bde62d1064` |

## 2. 切换前边界

切换前通过 SSH 只读确认：

| 项目 | 结果 |
| --- | --- |
| 旧 current | `/home/ps/code/hospital-platform/releases/c26e696` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python | 继续监听 `0.0.0.0:8001` |
| Worker | `inactive` |
| 临时端口 | `18082` 无残留 |
| 内外网 readiness | HTTP `200`，`database/redis/schema=ok` |

候选目录为 `/home/ps/code/hospital-platform/releases/b7c9451`。候选 bundle 已完成本地门禁、
远端 checksum、真实生产配置 preflight 和隔离 runtime smoke；preflight 再次确认运行模式为
`production`，微信身份、患者目录、预约目录、预约历史和门诊费用已配置，支付和报告仍为
`disabled`，MySQL/Redis/schema 均通过，schema 基线为
`0016_patient_directory_sync_owner_index`。

## 3. 原子切换与保护分支

第一次尝试使用 `sudo -n` 时，服务器返回“需要密码”。切换脚本随即将 `current` 精确回指
`c26e696`；只读复核确认旧 current、新 API readiness、公网 readiness 和旧 `8001` 均正常。
这次权限拒绝没有造成旧服务停机，也没有把失败误判为应用版本故障。

随后使用服务器已授权的标准 `sudo -S` 方式重试：同目录创建 `current.next`，执行
`mv -Tf current.next current` 原子替换，再只重启新 API。切换过程没有使用删除 release、
清空 Redis 或回滚 schema 的方式处理。

## 4. 切换后运行验收

切换后 `hospital-platform-api-v2.service` 于约 00:48 CST 恢复为 `active`，当前指针为
`releases/b7c9451`。启动日志确认以下字段均为生产/健康状态：

- `environment=production`；
- `runtimeMode=production`；
- `authRuntimeStatus=ready`、`authIdentityGateway=injected`、`authSessionStore=injected`；
- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`。

切换后复核结果：

| 检查 | 结果 |
| --- | --- |
| 内网 `/health/ready` | HTTP `200`，database/redis/schema 均为 `ok` |
| 公网 `/api/v2/health/live` | HTTP `200` |
| 公网 `/api/v2/health/ready` | HTTP `200`，`Cache-Control: no-store` |
| 公网 `/api/v2/system/ping` | HTTP `200` |
| 公网未登录 `/api/v2/patients` | HTTP `401` |
| 新 API / 旧 Python | `18081` 与 `8001` 同时监听 |
| 临时端口 / Worker | `18082` 无监听，Worker `inactive` |

## 5. P0 日志工具验证

当前 release 的工具 checksum：

| 产物 | SHA-256 |
| --- | --- |
| `apps/worker/dist/p0-log-aggregate.js` | `0b62c36d0a546eacd31b0ed6cb1c0c92412f06868eab4f3475e50bd72de65864` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `75fa9071358ebf29a24ef61055cccf7ef7decd164eacf7a2948cfae699e65500` |

切换后以当前服务启动窗口执行 journald JSONL 聚合，结果为：

| 字段 | 结果 |
| --- | --- |
| `inputLines` / `parsedRecords` | `35` / `19` |
| `parseErrors` | `0` |
| `systemdWarningCount` | `0` |
| `httpStatusCounts` | `200: 10` |
| `traceIdCount` | `10` |
| `correlation.chainCount` | `10` |
| `correlation.truncated` | `false` |

`correlation` 只保留 SHA-256 指纹和事件计数，不输出原始 trace、request、患者标识、token 或
Provider 报文。窗口内的 `correlation.missingCount=9` 来自没有请求链标识的生命周期记录，
不是把业务链强行拼接成功的理由；本窗口也没有预约历史、门诊费用、报告或其他新增业务成功事件。
因此本次只证明日志工具版本和运行层日志质量，不能增加真实微信、患者切换、Provider 或真机业务证据。

## 6. 回滚与后续边界

如新 API readiness、公网入口、旧 `8001` 或后续只读业务出现未解释异常，只允许把
`current` 原子切回 `releases/c26e696` 并只重启新 API；禁止停止旧 Python、删除 release、
清空 Redis 或回滚数据库 schema。

下一步继续按“真实微信会话 → 多就诊人显式切换 → 预约历史/爽约 → 门诊费用 → 报告材料门禁”的
顺序验收。支付、医保授权、退款、HIS 写回和预约写入仍最后处理。
