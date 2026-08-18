# c26e696 生产切换与新旧服务共存验收

更新时间：2026-08-18 22:52–22:57 CST

## 1. 发布范围

- 服务端 release：`/home/ps/code/hospital-platform/releases/c26e696`；
- 本次包含 `6a70fc9` 的只读 Provider trace 二次投影和中文文档观察记录；
- 只切换并重启 `hospital-platform-api-v2.service`，旧 Python `8001` 全程未停止、未重启、未修改；
- 没有执行 migration，没有写入 MySQL/Redis，没有启动 Worker；支付、医保、退款、预约写入、报告 gate 和 HIS 写回继续关闭；
- 原生小程序没有重新上传，继续使用完整来源指纹
  `01b184d9a6e37f7045b0cf62ecbf685cf0fc482c`。

## 2. 本地候选和产物

服务端代码在 `6a70fc9` 已通过全仓 `pnpm check`；本次 `c26e696` 只增加发布观察文档，随后重新执行了
`pnpm build`、文档链接审计和发布基线审计。候选 bundle 的 SHA-256 已在上传后逐项复核：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `a3caab446e9922f1322e6a797be2bbf4f7ea808d73b5f898a6faa8c468ad3cfd` |
| `apps/worker/dist/index.js` | `28ed16524fc2ad021d4406528b794a434b928156b102545a973c5c89f0fbff65` |
| `apps/worker/dist/preflight.js` | `63d6f7658620fcce3bfea146990c42d6a0b7edb742798af351aefdd6eae57859` |
| `apps/worker/dist/provider-directory-smoke.js` | `8486a5668b6155a7523fe2dcbe4d285c028ac5d013108d80898b03172b7a01fe` |
| `apps/worker/dist/api-runtime-smoke.js` | `ee24f42c4b667b1d8e08bab341c1d34d409e0baf7a1896c446d0261d8e76abff` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `08e0406e23be04c7f266b67d5a4327827fc347433a90e6b7e137ac0a1ad60127` |

## 3. 生产环境 preflight 和隔离 smoke

候选仍未接收公网流量，使用服务器真实 `shared/api.env` 完成 preflight：

- `environment=production`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用为 `configured`；
- 微信支付、报告目录、报告详情为 `disabled`；
- MySQL、Redis、schema 均为 `ok`；schema marker 为
  `0016_patient_directory_sync_owner_index`；
- preflight 没有 migration、业务写入或 Redis 写入。

候选在 `127.0.0.1:18082` 以 production mode 独立启动，随后使用同一候选的 runtime smoke：

| 检查 | 结果 |
| --- | --- |
| live | HTTP 200 |
| ready | 连续 3/3，HTTP 200，database/redis/schema 均通过 |
| system-ping | HTTP 200 |
| 未登录受保护路由 | 7/7 返回 HTTP 401、`unauthorized` |
| 进程回收 | 收到 SIGTERM 后正常停止，`18082` 已释放 |

smoke 日志只保留固定检查名、状态码和 traceId，没有输出原始异常消息。

## 4. 原子切换与共存

切换前的 `current` 为 `releases/687690e`；新 API 监听 `10.0.0.3:18081`，旧 Python 继续监听
`0.0.0.0:8001`，Worker 为 `inactive`。按照同文件系统的 `current.next -> current` 原子替换，随后只重启
`hospital-platform-api-v2.service`。

切换后确认：

- `current -> releases/c26e696`；
- `hospital-platform-api-v2.service=active`；
- 新 API 仍监听 `10.0.0.3:18081`；
- 旧 Python 仍监听 `0.0.0.0:8001`；
- Worker 仍为 `inactive`，没有 `18082` 残留监听；
- 启动日志记录 `environment=production`、`runtimeMode=production`，MySQL/Redis/schema 均为 `ok`。

## 5. 切换后内网和公网验证

内网直连 `10.0.0.3:18081`：

- `/health/live`：HTTP 200，`status=ok`；
- `/health/ready`：HTTP 200，`status=ready`，`database/redis/schema=ok`；
- `/api/v1/system/ping`：HTTP 200；
- 未登录 `/api/v1/patients`：HTTP 401，`unauthorized`。

公网入口 `https://test-hp.meiyi.pro/api/v2`：

- `/health/live`：HTTP 200；
- `/health/ready`：HTTP 200；
- `/system/ping`：HTTP 200；
- 未登录 `/patients`：HTTP 401；
- `Cache-Control: no-store` 仍存在于 readiness 响应。

## 6. 证据边界和回滚

本记录证明的是 `c26e696` 的 bundle、生产依赖、隔离 smoke、原子切换、新旧服务共存和 runtime/public
健康边界；它不证明真实微信设备、第二位患者切换、预约/报告/门诊费用 Provider 字段、Redis TTL、支付、医保、
退款、HIS 或真机页面已经验收。当前业务只读三层验收仍须使用同一服务端 release 和配套小程序来源指纹完成。

如果新 API readiness、公网入口、旧 `8001` 或后续只读业务出现未解释异常，只允许把 `current` 原子切回
`releases/687690e` 并只重启新 API；禁止停止旧 Python、删除旧 release、清空 Redis 或回滚数据库 schema。
