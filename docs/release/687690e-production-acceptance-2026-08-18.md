# 687690e 生产切换与新旧服务共存验收

更新时间：2026-08-18 21:08-21:10 CST

## 1. 发布范围

- 服务端 release：`/home/ps/code/hospital-platform/releases/687690e`；
- 服务端代码来源：`687690e`，包含患者 provider 引用在预约历史、报告目录和门诊费用调用前的统一运行时结构/范围校验；
- 数据库没有执行 migration，schema 仍为已验证的 `0016_patient_directory_sync_owner_index`；
- 支付、医保、HIS 写入、预约写入、报告 gate 和 Worker 继续关闭；
- 原生小程序仍使用候选 `01b184d`，完整构建来源为 `01b184d9a6e37f7045b0cf62ecbf685cf0fc482c`，本次没有上传或替换小程序运行包。

## 2. 本地产物和本地门禁

本次服务端代码完成全仓 `pnpm check`：架构 62 条规则、迁移/Provider/文档/发布基线审计通过，9/9 workspace typecheck、
9/9 package 测试、API 131 项/599 个断言、原生小程序 124 项/1059 个断言、9/9 build 通过。

上传到服务器的 8 个 bundle SHA-256 与本地构建产物一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `98eede6f5d8eaf769151a953e6c3eec0373a2b2077a9206a430d6430c4e13bb5` |
| `apps/worker/dist/index.js` | `f3c15ccb2573231da8a2704a9db3cca0ca20dd21afa4f6c515c94e4e99ac06cb` |
| `apps/worker/dist/preflight.js` | `3f2410a94d68ac5432b1f56d2820583a7006afca75d3b0d74248977fda199106` |
| `apps/worker/dist/provider-directory-smoke.js` | `932b3dbd9e0a0fa57989ec772ec63bda85a3c8a0822a05efd587bb5138240f9b` |
| `apps/worker/dist/api-runtime-smoke.js` | `1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `c2ed56c8f090a3ef43e497188a00231bf3a2002ff92df12c66ef56ec5ad58ce1` |

## 3. 候选隔离验证

服务器真实 `shared/api.env` 的生产 preflight 通过：

- `runtimeMode=production`；
- 微信身份、患者目录、预约目录、预约历史、门诊费用为 `configured`；
- 微信支付、报告目录、报告详情为 `disabled`；
- MySQL、Redis 和 schema 均为 `ok`，schema 为 `verified`。

候选在 `127.0.0.1:18082` 独立启动，runtime smoke 通过：

- live：200；
- ready：连续 3/3，database/redis/schema 均可用；
- system-ping：200；
- 7 路未登录认证边界：401；
- smoke 完成后候选进程已 SIGTERM 回收，`18082` 已释放。

## 4. 原子切换和共存

切换前 `current` 为 `releases/1b94c46`。先通过同目录 `current.next -> current` 原子切换，随后只重启
`hospital-platform-api-v2.service`。服务器的 `sudo -n` 窄权限规则当时未生效，第一次重启被拒绝并由保护脚本恢复旧指针；
随后使用账号已有的交互式 sudo 重新执行切换，未产生旧服务停机。

切换后确认：

- `current -> releases/687690e`；
- `hospital-platform-api-v2.service=active`；
- 新 API 监听 `10.0.0.3:18081`；
- 旧 Python Gunicorn 继续监听 `0.0.0.0:8001`；
- Worker 未启动，没有执行 migration、支付、医保、HIS 写入或 Redis 清理；
- 启动日志记录 `environment=production`、`runtimeMode=production`，MySQL/Redis/schema 均为 `ok`，并明确支付/报告 gate 状态。

## 5. 公网验证

切换后从开发机访问同一公网入口：

| 请求 | 结果 |
| --- | --- |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | HTTP 200 |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | HTTP 200 |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | HTTP 200 |
| `GET https://test-hp.meiyi.pro/api/v2/me/profile`（无 token） | HTTP 401 |

## 6. 尚未完成的证据

本记录只证明候选 checksum、生产依赖、隔离 smoke、原子切换、新旧服务共存、公网 runtime 和认证边界。
它不证明真实微信会话、第二位患者切换、预约/报告/门诊费用 Provider 字段、Redis TTL、真机截图或业务日志闭环已经验收。
当前 release 的 Redis TTL 只读观察结果和停止条件见
[`687690e-redis-session-ttl-observation-2026-08-18.md`](687690e-redis-session-ttl-observation-2026-08-18.md)：应用 Redis 账号没有 `SCAN` 权限，未临时扩大常驻 ACL。
支付、医保、退款、预约写入、报告详情真实资源和 HIS 写回继续最后处理。

如新 API readiness、公网入口、旧 `8001` 或后续只读业务出现未解释异常，只允许将 `current` 原子切回
`releases/1b94c46` 并重启新 API；禁止停止旧 Python、删除旧 release、清空 Redis 或回滚数据库 schema。
