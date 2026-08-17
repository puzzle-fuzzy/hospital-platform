# 52e9624 生产候选切换与共存验收记录

> 验收时间：2026-08-18 01:26-01:32（中国标准时间）
> 候选提交：`52e9624`
> 目标服务器：`ps@192.168.112.172`
> 结论：发布运行边界通过；真实微信业务、预约历史和门诊费用业务仍未完成验收。

## 1. 发布范围

本次部署的是当前 `main` 的服务端 bundle。小程序页面资源不会由本次 API release 代替上传，开发者工具/真机仍需使用同一提交对应的 `apps/miniprogram/dist` 运行包。

本次没有执行数据库 migration、Provider 写入、支付、医保、退款、HIS 回写或 Worker 启动；旧 Python 服务也没有重启。

## 2. 本地产物与远端校验

候选在本地已经通过 `pnpm check`，随后上传到独立的
`/home/ps/code/hospital-platform/releases/52e9624`。服务器没有发现同名 release，且切换前
`current.next` 不存在。以下 SHA-256 与本地产物一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `2d2f55b1964b366db7e6e0352abc1f67d08b72f6219ff763b4f4cc5e83bf3901` |
| `apps/worker/dist/index.js` | `29fc3615546a7840c649cb2e846de4ac218c7201a2a3dbc8732ba60fa082be68` |
| `apps/worker/dist/preflight.js` | `6925ad0c1a6daedcc6b537a9608f6553c60efb3b7c7431a731ef07337ead7ef7` |
| `apps/worker/dist/provider-directory-smoke.js` | `e2a5fdc85d59b2bfb6e8ec99d3480bf27f7f33d84f324c8bb0b2d83810d90046` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |
| `apps/worker/dist/p0-log-aggregate.js` | `98b3b857246259dd4a07bdf102e4245bfbb7faa0005c4acb449532677ada2327` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `e4b22e9e32e04cef38714b8fd64e493e7118128f323a932b62b8dee9f2355ec5` |

生产 `shared/api.env` 权限检查结果为 `600`。候选 preflight 输出确认：

- `environment=production`；
- MySQL、Redis、schema 均为 `passed/ok`；
- schema 版本为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约历史、门诊费用配置为 `configured`；
- 微信支付、报告目录和报告详情保持 `disabled`。

## 3. 隔离候选验收

候选只在 `127.0.0.1:18082` 启动，未接收公网流量。使用同一 release 的
`api-runtime-smoke.js` 完成：

- live：HTTP 200；
- ready：连续 3 次 HTTP 200，database/redis/schema 均为 `ok`；
- `/api/v1/system/ping`：HTTP 200；
- 未登录认证边界：HTTP 401，错误码 `unauthorized`。

验收结束后候选进程收到 SIGTERM，并确认 `18082` 已释放。

## 4. 原子切换与新旧服务共存

切换前 `current` 为 `b3c9a99`。通过同目录软链接和原子 `mv -Tf` 切换到
`52e9624`，再只重启 `hospital-platform-api-v2.service`。服务器的窄权限 `sudo -n` 当前仍要求密码，
因此按既有发布 runbook 使用交互式 sudo；这不改变旧服务边界。

切换后复核结果：

| 检查项 | 结果 |
| --- | --- |
| `hospital-platform-api-v2.service` | `active` |
| `current` | `/home/ps/code/hospital-platform/releases/52e9624` |
| 新 API | `10.0.0.3:18081` 监听 |
| 旧 Python | `0.0.0.0:8001` 仍监听，未重启 |
| 内网 `/health/live` | 成功 |
| 内网 `/health/ready` | 成功，database/redis/schema 为 `ok` |
| 公网 `/api/v2/health/ready` | 成功 |

启动日志明确记录 `environment=production`、`runtimeMode=production`、`persistenceRepositories=enabled`，
并记录微信支付、报告目录和报告详情仍为关闭状态。

## 5. 当前业务证据边界

切换后窗口的 `p0-log-aggregate --json` 结果为：`parseErrors=0`、`parsedRecords=6`、
`http.request.completed=3`、`service.started=1`，没有 `auth.wechat.*`、`patient.directory.*`、
`appointment.records.*` 或 `outpatient.payment.*` 事件。

因此本记录只能证明当前 release 的运行时、生产依赖、认证边界和新旧服务共存正确，不能证明：

- 有效微信会话已经在当前 release 登录；
- 患者同步/切换已经取得真实账号证据；
- “我的挂号”已完成 Provider、公网 HTTPS 和真机三层业务验收；
- 门诊费用读取、费用详情、微信支付、医保授权、结算、退费或 HIS 回写已开放。

下一步必须使用当前 `52e9624` 对应的小程序运行包，在有效微信会话中按“登录 → 患者同步/切换 → 我的挂号 → 门诊费用”的顺序触发请求，并同时保存页面、HTTP、traceId 和脱敏日志证据。
