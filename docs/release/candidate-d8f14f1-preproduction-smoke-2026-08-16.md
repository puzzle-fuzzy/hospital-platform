# 候选 `d8f14f1` 患者归属门禁与真实依赖隔离验收（2026-08-16）

本文记录候选 `d8f14f1` 的 bundle checksum、真实生产 env preflight、临时端口 runtime smoke
和新旧服务共存复核。本次没有切换公网 `current`，没有重启 systemd 服务，没有执行 migration，
也没有发起真实微信、患者、预约、报告、门诊费用、支付、医保或 HIS 业务请求。

## 1. 发布边界

| 项目 | 结果 |
| --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/d8f14f1` |
| 当前生产 release | `/home/ps/code/hospital-platform/releases/d177991`，全程未改变 |
| 当前新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081`，未重启 |
| 旧 Python API | 监听 `0.0.0.0:8001`，未重启 |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 候选临时 API | `127.0.0.1:18087`，验收后收到 SIGTERM，端口已释放 |
| 数据库和 Redis | 只通过候选 preflight/runtime 探针读取，未写入业务数据 |

## 2. 本次业务边界修复

患者作用域的 Provider smoke 现在固定执行以下安全顺序：

1. 健康检查通过后，若开启 `session`，先使用 Bearer 调用平台 `GET /me`；
2. 若开启 `patient-sync`，先执行首轮同步，再以不同 traceId 和相同幂等键执行 replay；
3. 同步之后重新读取当前会话的 `GET /patients`，只提取 `data.items[].id`；
4. 只有 `HOSPITAL_PATIENT_ID` 精确出现在本次目录中，才通过 `patient-owner` 门禁；
5. 门禁失败立即结束 smoke，不向预约记录、门诊费用或报告 Provider 发送患者 ID。

这条规则把“ID 格式合法”与“ID 属于当前登录用户”分开，避免验收脚本误用其他用户的内部患者 ID。
预约写入、锁号、取消、支付、医保、退款和 HIS 回写边界未改变，报告 gate 仍保持关闭。

## 3. Bundle checksum

本地 `pnpm check` 已通过；服务器上传后的 SHA-256 与本地产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `8a7206a98916d894fdb4d99f60953d39134a6d71f3453495baadc372cfbe4fbf` |
| `apps/worker/dist/index.js` | `687b4a0709aee184490a8152b58a5a1aee5db16877dec52069d95c1b209740e1` |
| `apps/worker/dist/preflight.js` | `48c37a68cf24dbf6a772075b2f669ac8e48bde64edb3edbc546926cd08b7c37a` |
| `apps/worker/dist/provider-directory-smoke.js` | `591d4c27feecbd8721861d17b21e0b39e35ad6c5dd00912f4b0fd3c067050b1b` |
| `apps/worker/dist/api-runtime-smoke.js` | `eb285ee332a9ea7782e7f539fe784fd8af9083abc6f8c76082197faaf9712dec` |

## 4. 真实生产 env preflight

候选只读取服务器现有 `shared/api.env`，不复制、不打印、不修改。结果为：

- `runtime.preflight.succeeded`，`environment=production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用 gate 为 `configured`；
- 报告目录/详情和微信支付 gate 为 `disabled`；
- MySQL、Redis 通过；
- schema `verified`，目标 migration 为 `0015_patient_directory_sync_operations`。

## 5. 临时端口 runtime smoke

候选 API 使用真实生产 env 启动在 `127.0.0.1:18087`。runtime smoke 结果为：

| 检查 | 结果 | HTTP 状态 |
| --- | --- | ---: |
| `health-live` | passed | 200 |
| `health-ready` | passed | 200 |
| `system-ping` | passed | 200 |
| `auth-boundary` | passed | 401 |

候选 API 的 ready 响应为 `status=ready`，database、redis、schema 均为 `ok`。
启动日志确认 `runtimeMode=production`、`persistenceDatabaseProbe=ok`、
`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`、repositories 为 `enabled`。
验收结束后候选进程收到 SIGTERM 并停止，`18087` 已释放。

## 6. 新旧服务共存复核

- `current` 仍指向 `/home/ps/code/hospital-platform/releases/d177991`；
- `hospital-platform-api-v2.service` 仍为 `active`；
- 新 API `10.0.0.3:18081` 仍监听；
- 旧 Python API `0.0.0.0:8001` 仍监听；
- `hospital-platform-worker-v2.service` 仍为 `inactive`；
- 候选临时端口 `18087` 已关闭。

## 7. 结论与下一步

本候选已通过代码门禁、真实生产依赖 preflight、临时 production runtime 和患者归属单元测试，
具备进入受控真实业务 smoke 的条件，但没有因此切换公网 `current`。下一步必须使用真实微信
登录 session 依次留证：`session` → 患者同步首轮/同 key replay → 当前会话患者目录 → 就诊人切换
→ 预约目录/历史 → 门诊费用只读。每一步保存 traceId、服务端业务事件和安全响应摘要。

在新的 Provider 书面合同、真机 session 和真实 provider 只读证据完成前，继续保持预约写入、
挂号支付、微信支付、医保结算、退款、报告详情和 HIS 回写关闭。
