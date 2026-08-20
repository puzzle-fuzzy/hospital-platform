# `5a31427` 新 API 生产切换与只读日志链验收

> 本文记录 2026-08-21 03:52–03:54 CST 在阿里云中转内网服务器上的真实发布证据。
> 本次只切换新 Bun/Elysia API 的日志字段修正；旧 Python 服务、旧端口、数据库 schema、Redis namespace、支付、医保、报告和 HIS 写回均不在变更范围内。
> 预约、排班、预约历史和门诊费用仍然是只读业务；本次没有借发布窗口打开预约写入或费用支付。

## 1. 版本与共存边界

| 项目 | 切换前 | 切换后 |
| --- | --- | --- |
| 新 API release | `6038560` | `5a314275e9bae43730eab5b32638a8baecda5869` |
| 新 API 监听 | `10.0.0.3:18081` | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` | `0.0.0.0:8001`，切换前后均监听 |
| Worker unit | `inactive` | `inactive`，未启动 |
| 小程序候选 | 本地 `6e6604f` | 仍为本地候选，未上传线上 |

切换前只读基线确认 `current -> releases/6038560`、新旧两个端口均监听、内网和公网
`/health/ready` 均返回 200，且 `hospital-platform-api-v2.service=active`。

切换使用同目录 `current.next -> current` 原子替换，并只重启
`hospital-platform-api-v2.service`。没有对旧 Python unit 执行停止、重启或配置修改命令。

## 2. 本次代码变化

预约目录、排班、预约历史、快照和门诊费用只读 service 现在会保留 gateway 返回且通过统一
校验的有界 `providerRequestIds`，同时继续写入兼容主字段 `providerRequestId`。这样一次
业务读取拆成多个 Provider 请求时，成功和失败业务日志仍可与所有真实外部请求关联；日志只保留
请求号，不记录 token、患者证件号、Provider 原文或费用明细。

本次不改变 Provider 请求参数、患者 owner 映射、预约状态、金额精度、支付、医保、预约写入
或 HIS 写回语义。另一个会话维护的众阳自动化 adapter 没有被修改。

本地门禁已通过：API 全量 `188 pass / 0 fail`，小程序全量 `169 pass / 0 fail`，全仓
typecheck、Biome lint/format、文档、迁移、provider、架构和 release baseline 审计均通过。

## 3. 产物校验与 production preflight

候选目录为 `/home/ps/code/hospital-platform/releases/5a31427`。上传归档解包后，远端 SHA-256
与本地产物一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `4fde34f76652edd56ebb9ae1053f1928c72746ea503b5b204af9756d7a4124d5` |
| `apps/worker/dist/index.js` | `ce3ad1be4c1a81e3ea856f729cd9c57c9142776904856fa057936ce608de77f1` |
| `apps/worker/dist/preflight.js` | `55f5cdba0ed529c00c8eb1b31cc1b2edad8ac43a82f5de998b8724f8f31a0a45` |
| `apps/worker/dist/provider-directory-smoke.js` | `22e9c529c65a1d746de5003fdb32499b2a4d39e046bf05615e7ca666d942788` |
| `apps/worker/dist/api-runtime-smoke.js` | `e19f87cd24683064ad937697a4bffb7b17cf1d12a4bee2bc382851fdd26ac222` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746b` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `78429854278cb5ea54a7d850a28bbcdb2aff6069206e05cbdffc0409f372ad19` |

2026-08-21 03:51 CST 使用服务器既有 `shared/api.env` 执行候选 production preflight，结果为
`runtime.preflight.succeeded`：

- runtime environment 为 production；
- MySQL、Redis、schema 均为 `ok`，schema 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用配置为 configured；
- 微信支付、报告目录和报告详情保持 disabled。

preflight 只读，不执行 migration、不启动 Worker、不调用 Provider、不创建患者或费用业务数据。

## 4. 隔离 runtime smoke

候选使用真实 production env 在 `127.0.0.1:18082` 独立启动，未接收公网流量。使用同一 release
的 smoke bundle 完成：

| 检查 | 结果 |
| --- | --- |
| `health-live` | `200 / passed` |
| `health-ready` | `200 / passed`，连续 `3/3` |
| `system-ping` | `200 / passed` |
| `auth-boundary` | `401 / passed`，`unauthorized` |
| `closed-boundary` | `404 / passed`，`not-found` |

smoke 完成后只回收候选 PID，`18082` 已释放；`18081`、旧 Python `8001` 和 Worker 状态在
候选期间没有改变。

## 5. 切换后运行验收

切换后 SSH 只读核对结果：

- `current -> /home/ps/code/hospital-platform/releases/5a31427`；
- `hospital-platform-api-v2.service=active`；
- 新 API 日志打印 `runtimeMode=production`，启动时 database/Redis/schema 探针均为 `ok`；
- 内网 `http://10.0.0.3:18081/health/ready` 返回 200；
- 公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 200；
- 新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听。

本次发布没有发送微信登录、患者同步、预约、门诊费用、医保或支付业务请求；因此多请求
`providerRequestIds` 的真实 Provider 三层业务证据仍待下一次真机业务操作产生，不能把本次
runtime smoke 解释为预约或费用业务已验收。

## 6. 回滚边界与下一步

若只回滚本次新 API，使用既有 `releases/6038560` 原子恢复 `current`，然后只重启
`hospital-platform-api-v2.service`；旧 Python `8001` 不参与回滚。发布 runbook 见
[`infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)。

小程序仍必须使用 `6e6604f8089e45ceeaaf4bcbbd57065174a59a31` 运行包；微信开发者工具若再次报告
`dist/services/single-flight.test.js`，按 [`miniprogram-runtime-enoent-recovery-2026-08-20.md`](miniprogram-runtime-enoent-recovery-2026-08-20.md)
关闭旧真机调试、重开 `apps/miniprogram/`、普通编译后重新生成二维码，不得把测试文件复制到 `dist/`。
支付、医保、退款、报告 Provider、患者绑定和 HIS 写回继续保持关闭。
