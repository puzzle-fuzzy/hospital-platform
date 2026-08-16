# 候选 `3dc6f5f` 发布前真实依赖与隔离运行时验收（2026-08-16）

本文记录候选 `3dc6f5f` 上传到服务器后的 checksum、真实生产 env preflight 和临时端口 runtime smoke。
本次没有切换公网 `current`，没有重启 systemd 服务，没有执行 migration，也没有发起真实微信登录、患者、
预约、报告、门诊费用、支付、医保或 HIS 业务请求。敏感连接串、token、openid、unionId 和患者标识不写入本文。

## 1. 发布边界

| 项目 | 结果 |
| --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/3dc6f5f` |
| 当前生产 release | `/home/ps/code/hospital-platform/releases/d177991`，未改变 |
| 当前新 API | `hospital-platform-api-v2.service`，监听 `10.0.0.3:18081`，未重启 |
| 旧 Python API | 监听 `0.0.0.0:8001`，未重启 |
| 候选临时 API | `127.0.0.1:18085`，验证后已 SIGTERM 停止并释放端口 |
| Worker | 未启动，支付/医保/HIS gate 未打开 |
| 数据库变更 | 无；只读取真实 schema 和依赖探针 |

## 2. 本次代码边界

`0f568c5` 为 runtime smoke 失败追踪修复：网络异常、非法 JSON、HTTP/业务失败、readiness 不满足和
认证边界逐路失败均保留对应请求的 `traceId`。`3dc6f5f` 同步补充了日志契约文档；候选 API/Worker
bundle 由 `3dc6f5f` 构建，未改变业务写入边界。

## 3. Bundle checksum

本地 `pnpm check` 已通过；服务器上传后的 SHA-256 与本地产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `8a7206a98916d894fdb4d99f60953d39134a6d71f3453495baadc372cfbe4fbf` |
| `apps/worker/dist/index.js` | `2ad6dbb24bec954107de8a89957d260c30fc44e67c5a45e40d937b4168ecdf61` |
| `apps/worker/dist/preflight.js` | `48c37a68cf24dbf6a772075b2f669ac8e48bde64edb3edbc546926cd08b7c37a` |
| `apps/worker/dist/provider-directory-smoke.js` | `feb8047e46c7a2d9d7b108d9c57dc68a3164b26b057ee93a6af0eec44566511d` |
| `apps/worker/dist/api-runtime-smoke.js` | `eb285ee332a9ea7782e7f539fe784fd8af9083abc6f8c76082197faaf9712dec` |

## 4. 真实生产 env preflight

候选只读取服务器现有 `shared/api.env`，不复制、不打印、不修改。结果为：

- `runtime.preflight.succeeded`，`environment=production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用只读 gate 为 `configured`；
- 报告目录/详情和微信支付为 `disabled`；
- MySQL、Redis 通过；
- schema `verified`，目标 migration 为 `0015_patient_directory_sync_operations`。

## 5. 临时端口 runtime smoke

候选 API 使用真实生产 env 启动在 `127.0.0.1:18085`，启动日志确认：

```text
runtimeMode=production
persistenceSchemaGate=true
persistenceDatabaseProbe=ok
persistenceRedisProbe=ok
persistenceSchemaProbe=ok
persistenceRepositories=enabled
authRuntimeStatus=ready
wechatIdentityConfiguration=configured
wechatPaymentConfiguration=disabled
patientDirectoryConfiguration=configured
appointmentDirectoryConfiguration=configured
appointmentRecordsConfiguration=configured
outpatientPaymentConfiguration=configured
reportDirectoryConfiguration=disabled
reportDetailConfiguration=disabled
```

候选 `api-runtime-smoke.js` 使用本机 HTTP 显式 opt-in 验收，结果如下：

| 检查 | 结果 | HTTP 状态 |
| --- | --- | ---: |
| `health-live` | passed | 200 |
| `health-ready` | passed | 200 |
| `system-ping` | passed | 200 |
| `auth-boundary` | passed | 401 |

每一项均记录了独立 `traceId`，候选 API 日志同时记录对应的 `http.request.completed` 或安全的
`http.request.failed`。验证后候选进程收到 `SIGTERM`，记录 `service.stop.requested` 和
`service.stopped`，`18085` 已释放。

## 6. 结论与下一步

本候选具备进入下一层验收的运行时条件，但尚未获得真实 session、患者 owner 映射、Provider 业务响应和
真机页面证据，因此不能切换公网 `current`，也不能把 runtime smoke 当作业务迁移完成证明。

下一步顺序保持不变：

1. 使用真机微信登录产生受控 session，并记录平台 API 的 `requestId/traceId`，不索取或记录用户凭证；
2. 在服务器用受控 access token 执行患者同步首轮与同 key replay，确认 durable operation、读模型一致性和 provider 请求次数；
3. 按“就诊人切换 → 预约科室/排班 → 预约历史 → 门诊费用只读”完成公网、服务端和真机三层证据；
4. Provider 新文档未完成确认前，继续保持预约写入、支付、医保、HIS 和 Worker 关闭；线上 readiness 抖动仍需单独稳定性证据。
