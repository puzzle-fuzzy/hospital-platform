# 候选 `411cd31` 发布前生产依赖复核（2026-08-16）

本文记录 `411cd31` 的持久化探针日志增强、bundle 上传、真实生产 env preflight 和隔离 runtime smoke。
本次没有切换公网 `current`、没有重启 systemd 服务、没有执行 migration，也没有发起真实微信、患者、预约、
报告、费用、支付、医保或 HIS 业务请求。敏感连接串、token、openid、unionId 和患者标识不写入本文。

## 1. 发布边界

| 项目 | 结果 |
| --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/411cd31` |
| 当前生产 release | `/home/ps/code/hospital-platform/releases/d177991`，全程未改变 |
| 当前新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` 仍保留，未重启、未切换 |
| Worker | 未启动，支付/医保/HIS gate 未打开 |
| 临时候选 API | `127.0.0.1:18084`，验证后已正常 SIGTERM 停止，端口已释放 |
| 数据库变更 | 无；只读取真实 schema 和依赖探针 |

## 2. 本次代码边界

`packages/persistence/src/runtime.ts` 的 `persistence.probe.unavailable` 现在会在满足固定机器码格式时记录
低敏 `errorCode`，例如 `PROTOCOL_CONNECTION_LOST`、`ETIMEDOUT`；连接串、SQL、参数和原始错误消息仍被拒绝。
单元测试验证了合法机器码保留、伪造的 `password=...` 错误码丢弃。该候选未进入公网，因此生产日志尚未使用这项增强。

## 3. Bundle checksum

本地 `pnpm check` 已通过；服务器上传后的 SHA-256 与本地构建产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `8a7206a98916d894fdb4d99f60953d39134a6d71f3453495baadc372cfbe4fbf` |
| `apps/worker/dist/index.js` | `d94737543d82fb3f7bf6cf48b05232ed0e5ebafe0018577ea46ced8085ae5c0c` |
| `apps/worker/dist/preflight.js` | `48c37a68cf24dbf6a772075b2f669ac8e48bde64edb3edbc546926cd08b7c37a` |
| `apps/worker/dist/provider-directory-smoke.js` | `feb8047e46c7a2d9d7b108d9c57dc68a3164b26b057ee93a6af0eec44566511d` |
| `apps/worker/dist/api-runtime-smoke.js` | `ad77a116eddea4a681a95769e708cbd995ee491089ee4cfff39a5c1238414987` |

## 4. 真实生产 env preflight

候选只读取服务器现有 `shared/api.env`，不复制、不打印、不修改：

- `runtime.preflight.succeeded`，environment 为 `production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用只读 gate 为 `configured`；
- 报告目录/详情和微信支付为 `disabled`；
- MySQL、Redis 通过；
- schema `verified`，目标 migration 为 `0015_patient_directory_sync_operations`，缺失 migration/schema object 均为空。

## 5. 隔离候选 runtime smoke

候选 API 绑定 `127.0.0.1:18084`，使用真实生产依赖启动，日志确认：

```text
runtimeMode=production
persistenceDatabaseProbe=ok
persistenceRedisProbe=ok
persistenceSchemaProbe=ok
wechatIdentityConfiguration=configured
wechatPaymentConfiguration=disabled
patientDirectoryConfiguration=configured
appointmentDirectoryConfiguration=configured
appointmentRecordsConfiguration=configured
outpatientPaymentConfiguration=configured
reportDirectoryConfiguration=disabled
reportDetailConfiguration=disabled
```

候选 `GET /health/live` 和 `GET /health/ready` 均返回 200，database/redis/schema 均为 `ok`；
验证结束后进程收到 `SIGTERM` 并记录 `service.stopped`，临时端口已释放。该过程未访问公网、未执行 provider
业务请求、未触发患者同步或任何写入。

## 6. 公网现状观察

使用候选里的 runtime smoke bundle 访问仍在运行的 `d177991` 公网 `/api/v2` 时，曾再次观察到
`health-live=200`、`health-ready` 短暂 `not_ready`，随后 ready 恢复；这与前一份 `93373d9` 复核中的现象一致。
该现象已经被记录为持久化探针稳定性观察项，不能用重试掩盖；只有在服务端日志提供低敏 `errorCode` 后，才能继续
判断是连接重置、连接超时、连接数不足还是其他依赖问题。候选没有切换到公网，因此没有对线上作出变更。

## 7. 下一步

1. 真机完成微信登录后，在受控环境临时注入平台 access token，使用本候选的
   `provider-directory-smoke.js` 执行患者同步首轮和同 key、不同 traceId replay；token 不进入仓库、release 或日志。
2. 用服务端的 `patient.directory.synced`、`patient.directory.operation.replayed`、`hisPatientReferenceCount`、
   operationId 和 provider request 计数完成第一层真实业务证据。
3. 再按“就诊人切换 → 预约科室/排班 → 预约历史 → 门诊费用只读”完成公网和真机验收。
4. 在 readiness 抖动根因明确前，不切换支付、医保、HIS 或预约写入；如果业务失败，只回滚新 API release，
   不停止旧 Python `8001`。
