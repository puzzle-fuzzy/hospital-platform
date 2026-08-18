# 37016c4 smoke 日志安全候选验收（2026-08-18）

## 1. 候选边界

`37016c4` 只修正验收 Worker 的日志边界：Provider smoke 和 API runtime smoke 不再把原始
`Error.message` 写入 Pino，只保留固定异常类型、HTTP 状态和 traceId，并用架构审计防止回归。
本候选不改变 API 路由、数据库 schema、Provider gate、支付/医保/HIS，也不操作旧 Python 服务。

| 项目 | 结果 |
| --- | --- |
| Git commit | `37016c4` |
| 候选目录 | `/home/ps/code/hospital-platform/releases/37016c4` |
| 当前线上 release | 仍为 `687690e`，本候选未切换 `current` |
| 新 API | `hospital-platform-api-v2.service` 未重启，仍监听 `10.0.0.3:18081` |
| 旧 API | Python `0.0.0.0:8001` 未操作 |
| Worker | 未启动；只执行独立 bundle 命令 |

## 2. 本地代码证据

- `pnpm check` 全部通过；架构边界规则从 62 条增加到 66 条；
- Worker 测试 `51 pass / 144 expect`，新增 runtime/provider smoke 原始异常消息不落日志测试；
- API 测试 `131 pass / 599 expect`；原生小程序和其它 workspace 类型、测试、构建均通过；
- 生产源码中的 smoke 文件同时禁止 `error.message` 和未审计的 `errorMessage` 字段。

## 3. 产物 SHA-256

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `98eede6f5d8eaf769151a953e6c3eec0373a2b2077a9206a430d6430c4e13bb5` |
| `apps/worker/dist/index.js` | `4c60c4f769d08dcf042580e390b11758490ef5627bdff1639fcb7d567b0c9417` |
| `apps/worker/dist/preflight.js` | `3f2410a94d68ac5432b1f56d2820583a7006afca75d3b0d74248977fda199106` |
| `apps/worker/dist/provider-directory-smoke.js` | `8486a5668b6155a7523fe2dcbe4d285c028ac5d013108d80898b03172b7a01fe` |
| `apps/worker/dist/api-runtime-smoke.js` | `ee24f42c4b667b1d8e08bab341c1d34d409e0baf7a1896c446d0261d8e76abff` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `c2ed56c8f090a3ef43e497188a00231bf3a2002ff92df12c66ef56ec5ad58ce1` |

服务器端 SHA-256 与本地逐项一致；候选文件只上传到新 release 目录，没有覆盖 `current` 或旧 release。

## 4. 真实生产环境 preflight

2026-08-18 21:28 CST 使用候选 `apps/worker/dist/preflight.js` 和服务器生产 env 执行：

- runtime environment 为 `production`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用 gate 为 `configured`；
- 支付、报告目录和报告详情保持 `disabled`；
- MySQL、Redis、schema 均为 `ok`，schema marker 为 `0016_patient_directory_sync_owner_index`；
- 预检只读，没有 migration、数据库写入、Redis 写入或旧服务操作。

## 5. 候选 runtime smoke

使用候选 `api-runtime-smoke.js`，设置 `NODE_ENV=production`，访问当前公网入口
`https://test-hp.meiyi.pro/api/v2`：

| 检查 | 结果 |
| --- | --- |
| live | HTTP 200 |
| ready | 连续 3/3，HTTP 200 |
| system-ping | HTTP 200 |
| auth-boundary | HTTP 401 |
| smoke 日志 | 每条包含 `environment=production`、事件名、检查名、状态码和 traceId；未输出原始异常 message |

这只是候选工具访问平台 runtime 的证据，不增加微信会话、Provider 业务、患者切换、预约、报告、费用或真机验收结论。

## 6. 发布决定

本候选通过代码、产物、生产 preflight 和 runtime smoke，但没有切换生产 `current`，因为本轮没有必要为
验收工具修正重启新 API。后续若要让线上默认 release 携带该 bundle，应按同一无损发布流程创建新的生产
release，并重新核对新旧服务共存；在此之前，`687690e` 仍是当前线上基线。
