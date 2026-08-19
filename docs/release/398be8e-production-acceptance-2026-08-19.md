# `398be8e` 新 API 生产切换与患者映射安全修正验收

> 记录时间：2026-08-19 16:30–16:37 CST
> 状态：新 Elysia API 已从 `968af78` 原子切换到 `398be8e`；旧 Python 服务继续共存。
> 本记录只证明新服务发布、运行层和患者映射安全修正已通过验收，不把 readiness、smoke 或基础路由通过误写成真实微信、HIS、真机或支付业务完成。

配套小程序候选仍为 `48ba22f`，完整构建来源为 `48ba22f16cb0f1d1098895772e660a3ed96761bb`；本次只更新服务端持久化 bundle，没有重建或上传新的小程序候选。

## 1. 本次变更和保护边界

- `b6dadd4` 的患者可用性读模型修正已进入本次 bundle：内存仓储缺少 `his-patient` 映射时，不再错误沿用历史 `ready` 状态。
- `3f413f5` 的提供方归属修正已进入本次 bundle：MySQL 临床映射同时校验患者主表和映射表的 Provider，拒绝跨 Provider 拼接患者引用。
- 旧 Python API `0.0.0.0:8001` 未修改、未停止、未重启；没有执行数据库迁移、清理 Redis、支付、医保、退款或 HIS 写入。
- 生产 `current` 从 `968af78` 原子切换到 `398be8e`，只重启 `hospital-platform-api-v2.service`。
- 新 API 继续监听 `10.0.0.3:18081`，公网入口继续为 `https://test-hp.meiyi.pro/api/v2`。

## 2. 本地门禁

- `pnpm build` 通过：API、Worker 运维脚本和小程序构建均成功。
- 患者映射相关持久化测试为 `77 pass / 0 fail`；API 测试为 `163 pass / 0 fail`。
- 发布前 `pnpm release:baseline:audit` 通过，当时服务端 release 基线为 `968af78`；本次切换后服务端为 `398be8e`，小程序候选仍为 `48ba22f`。
- 用户已有的 `apps/miniprogram/project.config.json` 未修改、未暂存、未提交。

## 3. 生产产物 SHA-256

候选目录为 `/home/ps/code/hospital-platform/releases/398be8eca74d4f0245b88695056061ac43c7f860`，上传后服务器校验结果如下：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `4D278C2888F2E0CB01B908DF0FB684B0C9768A8DA5ACA2FE590C88DD61BBF168` |
| `apps/worker/dist/index.js` | `5E9C62855EB263BD848C5BC7262C5635215100E515CCAC7F03A9A6C50E2FE677` |
| `apps/worker/dist/preflight.js` | `39697CF80B89A666870DC223CE089216FC0C214CA9A3FABA2D5B3880987F6415` |
| `apps/worker/dist/provider-directory-smoke.js` | `950F6C81E4BF3BAE042F208088D5CFA2B003CD2B7B9BF2D0D807FC6602F2D561` |
| `apps/worker/dist/api-runtime-smoke.js` | `694E66DDEEBAA7BDDA3B1ABF5DB42D6B4723A4C328DCB8D702D7CCB8A20E037A` |
| `apps/worker/dist/p0-log-aggregate.js` | `90379210008A3EA05133767C077246ECD5C5DE000CA5FEA0307A1920B36276DA` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `D9105036E23B1807A7A0503C589EA9BBDBA5938D9DFA9218DDD15021FA7F3771` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `ADAA3C716E9D39749442E14F7810BE95867A5008F4545130F28C1921DACF388B` |

## 4. 生产 preflight 与隔离 smoke

使用服务器真实 `shared/api.env` 执行同一 release 的 preflight，结果为：

- `environment=production`；
- MySQL、Redis、schema 均为 `ok`，schema marker 为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；
- 微信支付、报告目录和报告详情继续为 `disabled`。

候选在 `127.0.0.1:18082` 以 production 模式启动，正确的根健康检查路径和 runtime smoke 全部通过：live `200`、ready 连续 `3/3`、system ping `200`、未登录认证边界 `401`，随后进程正常 SIGTERM 回收且没有残留监听。

候选第一次启动等待使用了错误的 `/api/v1/health/live` 路径，得到预期 `404` 后立即回收；源码约定内网健康检查在根路径 `/health/live`，修正路径后 smoke 通过。这次误用没有切换线上 `current`，也没有影响旧服务。

## 5. 切换后复核

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/current -> releases/398be8eca74d4f0245b88695056061ac43c7f860` |
| 新 API unit | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，切换前后均保持监听 |
| 公网 `/api/v2/health/live` | `200` |
| 公网 `/api/v2/health/ready` | `200`，database/redis/schema 均 `ok` |
| 公网 readiness 稳定性 | 连续 `6/6` 通过 |
| 公网 system ping | `200` |
| 公网未登录保护路由 | `401`，错误码 `unauthorized` |
| 日志聚合 | `parsedRecords=19`、`parseErrors=0`、`systemdWarningCount=0` |
| 日志事件范围 | 仅基础设施/健康检查；无真实患者、预约、费用 Provider 业务事件 |
| Worker | 未启动，保持 inactive |

切换过程中只重启了新 API；不能据此宣称真实微信登录、患者同步、多患者切换、预约历史、报告、门诊费用、HIS 或真机业务已经完成。

## 6. 下一步

保持 `398be8e` 服务端和 `48ba22f` 小程序候选，优先用人工扫码取得真实微信 session，再在受控窗口验证患者目录读取、患者切换和只读预约/门诊费用链路。二维码、支付、医保、报告详情、预约写入、HIS 写入继续保持关闭或最后专项验收。

若新 API 出现未解释的 readiness 或业务错误，只将 `current` 回滚到切换前记录的 `968af78` 并重启新 API；旧 Python `8001` 不参与回滚。
