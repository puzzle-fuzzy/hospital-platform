# `3ab0a6c` 患者目录安全边界候选验收（2026-08-17）

## 结论

本次候选 release `3ab0a6c` 已完成本地门禁、真实生产环境依赖预检和隔离端口 runtime smoke，当前记录状态为
`preproduction-smoke`。验收期间没有切换线上 `current`，没有重启旧 Python 服务，没有执行数据库迁移，也没有调用支付、医保、HIS 写入或真实患者业务。

该版本只收紧患者目录同步的一个安全边界：众阳目录请求标记为完成但返回空目录时，如果数据库中已有 HIS 就诊人，不再把空结果解释为“用户没有就诊人”并批量停用旧数据，而是 fail-closed 返回稳定的
`patient-directory-snapshot-unsafe` 错误。新用户确实没有既有 HIS 就诊人时，空目录仍可作为合法快照保存。该语义见
[`migration/patient-sync-idempotency-contract.md`](../migration/patient-sync-idempotency-contract.md)。

## 候选固定信息

| 项目 | 结果 |
| --- | --- |
| Git commit | `3ab0a6cfe28cb15f1915985dccc2d5e2ec98b705` |
| 远端候选目录 | `/home/ps/code/hospital-platform/releases/3ab0a6c` |
| 线上切换前 current | `/home/ps/code/hospital-platform/releases/5c4e7cf` |
| 候选监听地址 | `127.0.0.1:18082`（隔离 smoke，已停止） |
| 新服务生产监听 | `10.0.0.3:18081`（未改变） |
| 旧 Python 服务 | `0.0.0.0:8001`（未改变） |
| Worker | 未启动；本次不扩大 systemd 权限范围 |

候选 bundle 使用 Linux 服务器实际运行文件，并逐个比对 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `d7db46dfe5e0fe08ddea9bcaf0e7a056b2298edd984eb52f7f6e18283ba500f5` |
| `apps/worker/dist/index.js` | `f3e85e0690f55e9899e7ddf921315708b005a7dff49ea52b47c2659c7b2cbdc4` |
| `apps/worker/dist/preflight.js` | `f9e8e350db6806ec2212cd2818630755bd1b6787ed1ec7631686df740c7a40ff` |
| `apps/worker/dist/provider-directory-smoke.js` | `ba1d1c6883f0706e76f57d56e258b0f6a8140f36f12021d2a16ef25485d2330c` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

## 本地门禁

- `pnpm build` 通过，生成 API、worker、preflight、Provider smoke 和 runtime smoke bundle。
- 完整单元测试、类型检查、Biome lint/format、架构边界审计、Provider 审计和文档审计已通过。
- `pnpm migration:audit` 仍被旧项目 `G:\fuck\hospital` 的并行变更阻断：旧 `module_common` 目录实际 34 个模块而基线期望 33 个，整体挂载数实际 191 而期望 190，且旧客户端仍有 2 个未纳入清单的 Provider endpoint。本次没有修改旧项目或降低该门禁。

## 真实生产环境预检

候选使用服务器现有受保护环境文件 `/home/ps/code/hospital-platform/shared/api.env`，未把 secret 写入仓库或日志。2026-08-17 13:54:08（中国标准时间）预检通过：

- runtime mode 为 `production`；
- MySQL 可连接；Redis 可连接；schema marker 为 `0016`；
- 微信身份、众阳患者目录、预约目录、预约记录、门诊费用依赖已配置；
- 微信支付明确为 disabled；报告目录和详情明确为 disabled；
- 没有执行迁移或业务写入。

## 隔离 runtime smoke

候选在 `127.0.0.1:18082` 以 `NODE_ENV=production` 启动，旧服务和当前新服务全程保持运行。以下检查均通过：

1. `/api/v2/health/live` 返回 200 且 `Cache-Control: no-store`；
2. `/api/v2/health/ready` 连续 3 次通过，数据库、Redis、schema 均为可用；
3. `/api/v2/system/ping` 返回 200；
4. 未登录访问受保护路由返回 401 和稳定 `unauthorized` 错误；
5. 启动日志明确记录 `runtimeMode=production`、端口、依赖状态和 capability gate；
6. smoke 没有伪造微信登录、患者同步或 Provider 业务成功。

候选进程已停止并确认 `18082` 不再监听；`18081` 和旧 Python `8001` 仍在监听，线上 `current` 仍指向 `5c4e7cf`。

## 与当前线上真实业务证据的关系

2026-08-17 13:49:28（中国标准时间）曾在当前线上 `5c4e7cf` 观察到真实微信登录成功、会话创建、患者目录读取和 1 位患者的 HIS 映射同步成功。这组证据属于 `5c4e7cf`，不归属于本候选，不能用来宣称 `3ab0a6c` 已完成真机业务验收。

## 下一步门禁

候选具备受控切换条件，但切换后仍必须分层验收：

1. 先确认新 API `18081` 和公网 `/api/v2` 健康检查稳定；
2. 使用同一微信账号完成真实登录、患者目录同步和患者选择页回显；
3. 如账号存在多个就诊人，验证切换、返回首页、历史记录按患者隔离；
4. 只读预约历史和门诊费用必须以真实 Provider 结果为准；
5. 预约写入、微信支付、医保授权、结算回写、退款和 HIS 写入继续保持关闭，直到 provider contract、状态机和真机证据齐全。

若切换后基础运行时或患者只读链路失败，只回滚新 API 的 `current` 到 `5c4e7cf`；不得停止旧 Python `8001`，不得回滚数据库 schema，也不得通过空响应掩盖 Provider 失败。
