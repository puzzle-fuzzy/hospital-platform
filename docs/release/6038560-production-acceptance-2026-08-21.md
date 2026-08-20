# `6038560` 新 API 生产切换与患者临床映射边界验收

> 本文记录 2026-08-21 `6038560` 在阿里云中转内网服务器上的真实发布证据。
> 本次只切换新 Bun/Elysia API；旧 Python 服务、旧端口、数据库 schema、Redis namespace、支付、医保、报告和 HIS 写回均不在变更范围内。
> 患者目录同步新增的 `his-patient` 一对一二次校验已部署，但真实微信患者业务和真机业务仍需单独取得三层证据。

## 1. 版本与共存边界

| 项目 | 切换前 | 切换后 |
| --- | --- | --- |
| 新 API release | `0e360d32edcfaa49128a7c29aaa4947cf739e090` | `6038560`（本地提交完整 SHA 由 Git history 固定） |
| 新 API 监听 | `10.0.0.3:18081` | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` | `0.0.0.0:8001`，切换前后均监听 |
| Worker unit | `inactive` | `inactive`，未启动 |
| 配套小程序 | 本地 `6e6604f` | 仍为本地候选，未上传线上 |

切换使用同目录 `current.next -> current` 原子替换，并只执行
`sudo -n systemctl restart hospital-platform-api-v2.service`。没有对旧 Python unit 执行停止、重启或配置修改命令。

## 2. 本次代码变化与本地门禁

患者目录同步现在由三层共同阻止重复临床映射：

1. 众阳 adapter 拒绝同一响应中重复的 HIS `patId`；
2. domain 在快照事务前再次拒绝不同患者共享同一个 `his-patient` 引用；
3. MySQL 既有唯一约束作为最终持久化防线。

第二层必须存在，是因为 gateway 是可替换的运行时端口，回放器或未来实现不能仅凭 TypeScript 类型绕过临床身份边界。拒绝发生在快照事务前，不会留下部分患者快照；日志只记录固定 `provider-reference-duplicate`，不记录 HIS 患者号或原始响应。

本地 `pnpm check` 已通过；本轮相关定向回归为：API 预约/门诊费用 `35 pass / 0 fail / 139 expects`，众阳预约/门诊费用 adapter `32 pass / 0 fail / 70 expects`，患者 domain、service、persistence 和全仓测试均通过。旧 Python 项目没有修改。

## 3. 产物与远端 preflight

候选目录为 `/home/ps/code/hospital-platform/releases/6038560`。8 个运行产物上传后与本地产物 SHA-256 一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `967a5c357038543f2186dc414852ba17b90cc50e3dbc198fab56e17565406714` |
| `apps/worker/dist/index.js` | `ce3ad1be4c1a81e3ea856f729cd9c57c9142776904856fa057936ce608de77f1` |
| `apps/worker/dist/preflight.js` | `55f5cdba0ed529c00c8eb1b31cc1b2edad8ac43a82f5de998b8724f8f31a0a45` |
| `apps/worker/dist/provider-directory-smoke.js` | `22e9c529c65a1d746de5003fdb32499b2a4d39e046bf05615e7ca666d942788` |
| `apps/worker/dist/api-runtime-smoke.js` | `e19f87cd24683064ad937697a4bffb7b17cf1d12a4bee2bc382851fdd26ac222` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008a3ea05133767c077246ecd5c5de000ca5fea0307a1920b36276da` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `78429854278cb5ea54a7d850a28bbcdb2aff6069206e05cbdffc0409f372ad19` |

2026-08-21 02:41 CST 使用服务器既有 `shared/api.env` 执行同一候选的 production preflight，结果为 `runtime.preflight.succeeded`：

- runtime environment 为 production；
- MySQL、Redis、schema 均为 `ok`；schema 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约历史和门诊费用配置为 configured；
- 微信支付、报告目录和报告详情保持 disabled。

preflight 只读，不执行 migration、不启动 Worker、不调用 Provider、不创建患者或费用业务数据。

## 4. 隔离 runtime smoke

候选使用真实生产 env 在 `127.0.0.1:18082` 独立启动，未接收公网流量。使用同一 release 的 smoke bundle 完成：

| 检查 | 结果 |
| --- | --- |
| `health-live` | `200 / passed` |
| `health-ready` | `200 / passed`，连续 `3/3` |
| `system-ping` | `200 / passed` |
| `auth-boundary` | `401 / passed`，`unauthorized` |
| `closed-boundary` | `404 / passed`，`not-found` |

smoke 完成后只回收候选 PID，`18082` 已释放；线上 `18081`、旧 Python `8001` 和 Worker 状态在候选期间没有改变。

## 5. 切换后运行验收

切换后 SSH 只读核对结果：

- `current -> /home/ps/code/hospital-platform/releases/6038560`；
- `hospital-platform-api-v2.service=active`；
- 内网 `/health/ready` 返回 `200`，database/redis/schema 均为 `ok`；
- 新 API `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听；
- `hospital-platform-worker-v2.service=inactive`。

随后从开发机对公网 `https://test-hp.meiyi.pro/api/v2` 使用 production 标记执行 runtime smoke：

- live `200`；
- ready 连续 `6/6`，`database/redis/schema` 为 `ok`；
- system-ping `200`；
- 未登录认证边界 `401`；
- 支付、医保、报告、预约写入、预约取消、HIS 写回关闭边界 `404`。

该 smoke 没有携带 Bearer、没有创建微信 session、没有调用患者/预约/费用 Provider，也没有写入 MySQL/Redis 业务数据。

## 6. 真机与业务证据边界

本记录证明服务端候选已部署并保持新旧服务共存，不证明以下业务已在当前候选真机完成：

- 微信登录、患者目录同步和第二位患者显式切换；
- 我的挂号、爽约记录、门诊费用待缴/已缴的 Provider 非空样例；
- 页面结果、客户端 `requestId/traceId`、服务端低敏日志三层同链证据。

下一步必须使用小程序运行包来源 `6e6604f8089e45ceeaaf4bcbbd57065174a59a31`，先完成微信会话和患者上下文，再按“预约历史 → 爽约 → 门诊费用”逐域验收。支付、医保、退款、报告 Provider、患者绑定和 HIS 写回继续保持关闭。
