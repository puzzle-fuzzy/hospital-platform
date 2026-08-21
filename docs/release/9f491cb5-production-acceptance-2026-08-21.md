# `9f491cb5` 新 API 生产切换与共存验收（2026-08-21）

> 本记录只证明新 Bun/Elysia API 的候选发布、依赖探针、旧服务共存和公网运行层状态；不把健康检查或未登录边界误写成微信、患者、Provider、支付或医保业务成功。

## 1. 发布范围

| 项目 | 结果 |
| --- | --- |
| 服务端候选 | `9f491cb5ac813acf89ed1f2f4afb361517e82324` |
| 原线上 release | `c8eef370` |
| 发布目录 | `/home/ps/code/hospital-platform/releases/9f491cb5ac813acf89ed1f2f4afb361517e82324` |
| 新 API | `10.0.0.3:18081`，systemd `hospital-platform-api-v2.service` |
| Worker | `hospital-platform-worker-v2.service`，保持 inactive |
| 旧 Python API | `0.0.0.0:8001`，本轮未修改、未重启 |
| 小程序配套候选 | `13b86a5a400ca0ccbee67abdfed726476a4749d4`（本地构建，未上传线上） |

本次只上传服务端运行 bundle 和候选目录，不上传 env、密钥或 Provider 原始报文；没有执行数据库迁移、Redis 清理、业务写入或 Provider 命令。

## 2. 构建与完整性证据

本地 `pnpm check` 通过：架构、迁移清单、Provider intake、文档断链、Biome、工具测试、9 个 workspace 的类型检查/测试/构建均通过。服务端 bundle SHA-256 为：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `D6FDADE41CD89B60E82B49565BD87553E176FAB33B61F9DE45310A77C192A38A` |
| `apps/worker/dist/index.js` | `CB78C83722F46B6A1C1D0564F22A2A0E0CB8405D2FB0E6B9048DFF4BC8572828` |
| `preflight.js` | `AE36C8E7D47E43E77F698F08F42B1D24DA84E75A48C3451DB1B9861AC891CAE5` |
| `provider-directory-smoke.js` | `1230A3B0DF2D791208ACA7F54670565EC4E6ADD8A0104B990D9E6AD23234ADF` |
| `api-runtime-smoke.js` | `82FDE0F81E4DC5783EB50DC6F08DFD8A8CF0706A9F914BE2115961FED098D295` |
| `p0-log-aggregate.js` | `280B175341C2794290AB61BF6175295922C79BD588972732F05CAEFA0BD54746` |
| `p0-business-evidence-audit.js` | `AFA687B6E52021237F275E808466800433BD8D48A344C7C879F944E5A2A1EB9E` |
| `redis-session-ttl-audit.js` | `81C306E52038991DDC5E4F0A33359110FAAD57ED653F21466F39F07FE63D04EE` |

候选压缩包 SHA-256：`C1AB7307E2954AA8B3311F3EABAAAB1F43BD70E9310CBE6E23F2835A214BC032`。

## 3. 生产 preflight 与隔离 smoke

使用服务器现有生产环境变量执行候选 preflight，结果为：

- `environment=production`；
- MySQL、Redis、schema probe 均为 `ok`，schema 已验证到 `0016_patient_directory_sync_owner_index`；
- 微信身份、众阳患者目录、预约目录、预约记录、门诊费用均为 `configured`；
- 微信支付、报告目录、报告详情保持 `disabled`；
- 没有执行 migration、Provider 请求或 Worker 启动。

随后使用 `127.0.0.1:18082` 隔离启动候选并执行 runtime smoke，health live、health ready、system ping、未登录认证边界和关闭路由边界全部符合预期；候选进程结束后 `18082` 已释放。

## 4. 原子切换与新旧服务共存

当前 symlink 已从 `c8eef370` 原子切换到 `9f491cb5ac813acf89ed1f2f4afb361517e82324`，只重启新 API。切换后复核结果：

- `hospital-platform-api-v2.service=active`，新 API PID 为 `2473106`，`10.0.0.3:18081` 正常监听；
- 启动日志明确记录 `environment=production`、`runtimeMode=production`，MySQL/Redis/schema 均为 `ok`；
- 旧 Python `8001` 仍由原 Gunicorn PID `3687390/3687419/3687420/3687421/3687422` 监听，PID 集合未变化；
- Worker 仍为 inactive，没有因本次发布意外启动支付或其他后台副作用任务。

## 5. 公网运行层证据

切换后通过 `https://test-hp.meiyi.pro/api/v2` 完成公网 smoke：

| 请求 | 结果 |
| --- | --- |
| `/health/live` | `200`，`Cache-Control: no-store` |
| `/health/ready` | `200`，database/redis/schema 均 ready |
| `/system/ping` | `200` |
| 未登录受保护接口 | `401` |
| 未注册关闭接口 | `404` |

公网完整 runtime smoke 已全部通过。该结果只证明域名、反向代理、新 API 和基础依赖链路，不证明真实微信会话或业务 Provider 成功。

## 6. 日志观察与业务证据状态

切换窗口低敏 journald 聚合：`inputLines=32`、`parsedRecords=26`、`parseErrors=0`、`systemdWarningCount=0`；HTTP `200=8`、`401=8`、`404=7`，事件为基础设施请求和服务启动/停止记录，`providerRequestIdCount=0`。没有新的微信登录、患者同步、预约历史、门诊费用或普通资料业务事件。

因此业务证据审计没有通过不是发布故障，而是本轮只做了运行层 smoke，没有用真实微信会话制造业务流量。下一步必须在当前小程序候选 `13b86a5` 中重新普通编译并扫码，按页面、客户端请求、服务端低敏日志三层取得微信登录、患者同步和显式患者选择证据；支付、医保、报告、二维码、患者绑定和预约写入继续后置或关闭。

## 7. 回滚手册（本轮未执行）

若新 API 出现启动或公网运行层回归，只允许按无损 runbook 将 `current` 指回上一份完整 release `c8eef370`，只重启 `hospital-platform-api-v2.service`，然后重新执行 preflight、ready、旧 Python `8001` 监听和公网 smoke。不得停止旧 Python、删除数据库/Redis 数据或用业务请求验证回滚。
