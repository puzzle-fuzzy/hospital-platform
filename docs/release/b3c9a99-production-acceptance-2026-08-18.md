# b3c9a99 生产共存发布验收（2026-08-18）

本文记录 `b3c9a99` 的生产候选、原子切换和新旧服务共存证据。它只证明运行时、依赖和关闭边界，
不把未登录 smoke 当作微信、患者、预约或门诊费用业务成功；支付、医保、预约写入、退款和 HIS 回写继续关闭。

## 1. 发布范围

- Git 提交：`b3c9a99`，提交说明为“收紧预约费用读模型安全边界”。
- 变更内容：Provider 展示文本、预约排班快照引用拒绝控制字符和首尾空白，并补充中文业务注释、domain/adapter/persistence 回归测试；同步修正当前 release 文档入口。
- 未修改：旧 Python 服务、旧表、旧 Redis DB1、支付/医保/HIS gate、预约写入和数据库 schema。
- 线上旧 release：`b823727`。
- 线上新 release：`/home/ps/code/hospital-platform/releases/b3c9a99`。
- 当前指针：`/home/ps/code/hospital-platform/current -> releases/b3c9a99`。
- 新 API：`10.0.0.3:18081`；旧 Python API：`0.0.0.0:8001`。

## 2. Bundle SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `f55948491cffa0c7ffd96f90e50939ef8ea8b8af992907c84b51922809d1305f` |
| `apps/worker/dist/index.js` | `29fc3615546a7840c649cb2e846de4ac218c7201a2a3dbc8732ba60fa082be68` |
| `apps/worker/dist/preflight.js` | `6925ad0c1a6daedcc6b537a9608f6553c60efb3b7c7431a731ef07337ead7ef7` |
| `apps/worker/dist/provider-directory-smoke.js` | `e2a5fdc85d59b2bfb6e8ec99d3480bf27f7f33d84f324c8bb0b2d83810d90046` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |
| `apps/worker/dist/p0-log-aggregate.js` | `98b3b857246259dd4a07bdf102e4245bfbb7faa0005c4acb449532677ada2327` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `e4b22e9e32e04cef38714b8fd64e493e7118128f323a932b62b8dee9f2355ec5` |

远端逐文件 checksum 与本地产物一致。候选文件按 `apps/api/dist` 与 `apps/worker/dist` 原目录上传，
避免 API 和 Worker 同名 `index.js` 覆盖。

## 3. 候选隔离验收

2026-08-18 00:04 CST 使用服务器既有 `shared/api.env` 执行候选 preflight：

- environment：`production`；
- 微信身份：`configured`；微信支付：`disabled`；患者目录、预约目录、预约记录、门诊费用：`configured`；报告：`disabled`；
- MySQL、Redis：`ok`；schema：`verified`，期望 migration 为 `0016_patient_directory_sync_owner_index`；
- `127.0.0.1:18082` 候选启动日志明确记录 `runtimeMode=production`、repositories enabled 和三项依赖 `ok`；
- 候选 runtime smoke：live 200、ready 连续 3/3、system ping 200、未登录受保护路由 401/`unauthorized`；
- smoke 完成后候选收到 SIGTERM，`18082` 已释放。

## 4. 原子切换与共存

2026-08-18 00:05 CST：

- `current` 从 `b823727` 原子切换到 `b3c9a99`；
- 只重启 `hospital-platform-api-v2.service`，服务 active/running；
- 启动日志记录 `environment=production`、`runtimeMode=production`、MySQL/Redis/schema `ok`；
- `wechatPaymentConfiguration=disabled`，报告 gate 关闭，Worker 保持 inactive；
- 新 API `18081` 和旧 Python `8001` 均保持监听。

## 5. 切换后公网验收

- 内网 `/health/live`、`/health/ready`：200；ready 依赖为 `database=ok`、`redis=ok`、`schema=ok`；
- 公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping`：均为 200；
- 公网 runtime smoke：live 200、ready 连续 3/3、system ping 200、6 个未登录受保护路由均返回 401/`unauthorized`；
- 当前 release 启动后只执行了健康检查、系统探针和认证边界 smoke，没有真实微信登录、患者同步、预约 Provider 或门诊费用查询，因此不能更新 P0 业务验收状态。

由于当前 `ps` 会话对 `sudo journalctl` 的无密码读取未通过，切换后使用 `systemctl status` 核对了 production 启动事件和 smoke 请求；没有把无法执行的 P0 聚合伪造为成功。后续真实微信会话应继续按 P0 手册取得页面、HTTP 和低敏日志三层证据。

## 6. 回滚

如新 API readiness、公网路径、旧 `8001` 或真实业务出现无法解释的异常，只把 `current` 回滚到
`b823727` 并重启 `hospital-platform-api-v2.service`；不得停止旧 Python、清空 Redis、回滚 schema 或删除旧 release。

## 7. 下一步

使用最新原生小程序运行包，在有效微信会话下依次验收：登录恢复 → 患者目录/切换 → 我的挂号 → 门诊费用待缴/已缴。
支付、医保、预约写入、退款、报告 gate 和 HIS 写回继续最后处理。
