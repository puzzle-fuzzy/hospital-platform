# `5c4e7cf` 生产切换与 MySQL 只读恢复验收（2026-08-17）

> 本文记录 `5c4e7cf` 对新 Elysia API 的候选验证和生产切换。修复目标是处理云 MySQL
> 连接池遇到 `PROTOCOL_CONNECTION_LOST` 时的幂等只读恢复；不扩大任何写入、事务、Provider、支付、
> 医保或 HIS 的重试边界。旧 Python `8001` 全程保持运行。

## 1. 修复内容与边界

- MySQL 连接池上的 `SELECT/SHOW/DESCRIBE/EXPLAIN` 失败后，最多执行初始请求加两次短退避恢复尝试，间隔为 `25ms`、`100ms`。
- `WITH` 不再仅按语句前缀判定为只读，因为 CTE 也可以包裹 `INSERT/UPDATE/DELETE`；当前仓储没有依赖 CTE。
- 写入、事务连接和 Provider 调用仍然 fail-closed，不因网络错误自动重放。
- 没有执行 migration、Redis 清理、业务写入或旧服务重启。

## 2. 本地门禁

提交 `5c4e7cfad5b24aa5de0b027a4f0300c731e1bfe2` 已完成：

- 持久化测试 `68 pass / 0 fail`；
- 全量 workspace 测试 `9/9` 通过；
- 全量 typecheck、Biome format/lint、Markdown 链接审计通过；
- Bun/Turbo 全量构建通过；
- 原生小程序构建生成 14 个页面运行脚本。

新增回归覆盖：两次连续连接断开后第三次只读恢复成功，以及三次均失败时返回安全的
`PersistenceUnavailableError(read)`，不会进入写入重试。

## 3. 候选 bundle 证据

候选已上传到服务器 `/home/ps/code/hospital-platform/releases/5c4e7cf`，五个文件的 SHA-256 与本地产物一致：

| bundle | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `d958eb9f2b43a0bfbe9ae9d4c74074c9b3dfac99c0aac7bb32bac03868052a37` |
| `apps/worker/dist/index.js` | `72cc6ac7cd467e53cd15b863c0b773f9c359d931d090582ab09dcf3170b949c7` |
| `apps/worker/dist/preflight.js` | `f9e8e350db6806ec2212cd2818630755bd1b6787ed1ec7631686df740c7a40ff` |
| `apps/worker/dist/provider-directory-smoke.js` | `dd22c5d402ba63eccc7f6962e2e89cc17736eea35f84da107d586d6bcf21eb00` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

使用服务器 `shared/api.env` 的真实配置执行 preflight，结果为：

- runtime configuration、微信身份和众阳患者/预约/预约记录/门诊费用配置通过；
- MySQL、Redis、`0016` schema probe 均通过；
- 微信支付、报告目录和报告详情 gate 仍为 disabled。

候选在服务器 `127.0.0.1:18082` 启动后，runtime smoke 的 live、ready 连续 3 次、system ping 和未登录认证边界均通过。

## 4. 原子切换与共存验收

| 项目 | 结果 |
| --- | --- |
| 切换前 | `current -> releases/6d58c9c` |
| 切换后 | `current -> releases/5c4e7cf` |
| 新 API | `10.0.0.3:18081`，systemd active，production mode |
| 旧 API | `0.0.0.0:8001` 仍由原 Python 进程监听 |
| 数据库 schema | 保持 `0016`，本次没有新增 migration |
| 公网 runtime smoke | live 200、ready 连续 6 次通过、system ping 200、未登录认证 401 |

切换启动日志确认 `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、
`persistenceSchemaProbe=ok`、`authRuntimeStatus=ready`，以及支付/报告 gate 没有被意外打开。

## 5. 真实故障与修复证据边界

切换前当前版本曾出现一次真实患者目录读失败：2026-08-17 13:06:06 CST，
`GET /api/v1/patients` 返回 503，低敏日志为 `PersistenceUnavailableError`、
`persistenceOperation=read`、`persistenceErrorCode=PROTOCOL_CONNECTION_LOST`；随后服务仍可恢复读取，
并非患者映射或 Provider 字段错误。服务器只读核对确认 `hp_patients` 当前只有 1 条有效
`hospital-his/zhongyang` 记录，没有 `legacy-record` 混入选择目录。

这次发布通过本地连续断线回归和候选/公网 runtime smoke，证明重试边界与部署边界正确；
它不等于云网络以后不会再有断线，也不替代真实微信会话、Redis TTL、患者切换和 Provider 业务验收。
若再次出现 503，仍需保存 requestId/traceId 并检查 MySQL/网络日志，不能通过无限重试掩盖基础设施故障。

## 6. 仍未开放的业务

当前继续按 P0 手册完成真实微信会话、Redis TTL、多患者切换、预约历史/爽约和门诊费用只读验收。
报告、患者新增/绑卡、病历、预约写入、微信支付、医保授权与 6201/6202/6301/6203/6401、退款和 HIS 回写
继续冻结，直到各自 Provider contract、脱敏 fixture、金额/状态/回写证据完整。
