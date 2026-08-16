# `131fb5a` 持久化错误码标准化生产验收

## 1. 发布范围与安全边界

本次只修正持久化瞬态错误码在驱动包装层之间的格式差异：小写、短横线和下划线形式会统一为固定的
大写下划线诊断码，未知或包含主机/连接串/SQL 片段的 code 仍会被丢弃。

本次没有修改公共业务 response、患者/预约/费用数据模型、Provider 请求、数据库 schema 或共享 env；
没有增加写入/事务重试，没有启动 Worker，也没有触碰旧 Python 服务、旧端口 `8001`、旧 Redis DB1、
微信支付、医保、退款或 HIS gate。

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `131fb5a9fa2b7ad215b924ba30524baf1a98297e` |
| 新 API release | `/home/ps/code/hospital-platform/releases/131fb5a` |
| 切换前 release | `/home/ps/code/hospital-platform/releases/527d163` |
| 切换后 release | `/home/ps/code/hospital-platform/current -> releases/131fb5a` |
| 新 API | `hospital-platform-api-v2.service`，`10.0.0.3:18081`，active |
| 旧 API | Python PID `636918`，`0.0.0.0:8001`，继续运行 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 候选端口 | `127.0.0.1:18082`，验收后已停止并释放 |

## 2. 本地门禁

`pnpm check` 全部通过：

- architecture / migration / provider intake 审计通过；
- Biome format/lint 通过；
- 9 个 workspace typecheck、test 和 build 通过；
- API 76 项、持久化 66 项、小程序 53 项、Worker 45 项测试通过；
- 新增错误码测试覆盖大小写/连接符归一化和敏感自定义 code 拒绝。

## 3. bundle 指纹与生产 preflight

本地构建产物上传服务器后，SHA-256 校验一致：

| bundle | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `299a33248c30b21a57cd8542e290b0b6d3d0fb54fbd7b2d5dca19c09b3c23960` |
| `apps/worker/dist/index.js` | `e7348818ae17fe298aa578597d2631f9da208ed9eadfc9a7f70e007f484e7368` |
| `apps/worker/dist/preflight.js` | `97782907d1defd1ffa8f58938a2c7f57dbe54b2aecab223b1ddf7821ee9dc7af` |
| `apps/worker/dist/provider-directory-smoke.js` | `dd22c5d402ba63eccc7f6962e2e89cc17736eea35f84da107d586d6bcf21eb00` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

2026-08-17 `02:51:26 CST` 使用服务器既有 `shared/api.env` 执行生产 preflight，结果为
`runtime.preflight.succeeded`：MySQL、Redis 和 schema 均通过，schema 为 `verified`，目标 migration
为 `0015_patient_directory_sync_operations`；微信身份、患者目录、预约目录、预约记录和门诊费用为
`configured`，支付与报告 gate 仍为 `disabled`。

## 4. 候选隔离验收

候选使用生产 env，只覆盖 `HOST=127.0.0.1`、`PORT=18082` 和 `NODE_ENV=production`。启动日志确认
production mode，MySQL/Redis/schema 为 `ok`。

第一次候选后台启动未在 SSH 会话关闭后保持，临时 smoke 因此得到网络失败；线上 `current` 当时仍是
`527d163`，没有切换。随后改用 `setsid` 保持候选进程，并显式打开本机 HTTP smoke 开关，runtime
smoke 通过：

| 检查 | 结果 |
| --- | --- |
| `health-live` | 200 |
| `health-ready` | 200，连续 3/3 |
| `system-ping` | 200 |
| `auth-boundary` | 通过，受保护路径均为 401/`unauthorized` |

候选日志和端口在切换前已清理，`18082` 没有残留监听。

## 5. 原子切换与公网验收

2026-08-17 `02:56:07 CST` 在同一父目录通过 `current.next -> current` 原子替换，只重启
`hospital-platform-api-v2.service`。启动日志确认：

- `environment=production`、`runtimeMode=production`；
- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`；
- `persistenceRepositories=enabled`、`authRuntimeStatus=ready`；
- 旧 Python PID `636918` 和 `8001` 监听保持不变；Worker 仍 inactive。

公网 `https://test-hp.meiyi.pro/api/v2` 于 `02:56:20-02:56:26 CST` 完成 runtime smoke：

| 检查 | 结果 | trace/request 证据 |
| --- | --- | --- |
| `health-live` | 200 | `ffe5421d-5ed3-46c8-a7ab-d30b9045bfc6` |
| `health-ready` | 200，连续 6/6 | `a2466911`、`3758513f`、`a0ecd3fd`、`bf02fc03`、`8ffb7c0d`、`c695c0d7` |
| `system-ping` | 200 | `1b6c875e-6db4-4a9e-a9b8-b82a0eafbe9a` |
| `auth-boundary` | 通过，401/`unauthorized` | `e2e9a765-dec6-4339-89b2-05db65445b01` |

切换后的 API journald 只出现启动、健康探针、system ping 和未登录认证边界；没有把这些 runtime 请求
记录为微信登录、患者同步、预约历史或门诊费用成功。本次发布没有新的真实业务证据。

## 6. 业务边界与下一步

本次只能证明持久化错误诊断边界和新旧服务共存运行正常，不能宣称以下内容完成：Redis 实际 TTL、
多患者切换/inactive recovery、预约历史、门诊费用、报告真实 Provider 读取、普通资料读写，以及任何
预约写入、支付、医保、退款或 HIS 回写。

下一步仍按 `真实微信会话/TTL → 多患者切换与失效恢复 → 预约历史 → 门诊费用 → 普通资料` 推进；
每一步都必须保存 Provider、平台公网、真机页面和低敏日志四层证据。新的 Provider 文档必须先进入
intake 并冻结 contract，不能根据旧页面猜测字段或状态。
