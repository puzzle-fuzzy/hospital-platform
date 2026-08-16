# 候选 `93373d9` 发布前生产依赖复核（2026-08-16）

本文记录 `93373d9` 的 bundle 上传、真实生产 env preflight 和公网只读 runtime smoke。
本次没有切换 `current`、没有重启任何 systemd 服务、没有执行 migration，也没有发起真实微信、患者、预约、
报告、费用、支付、医保或 HIS 业务请求。敏感连接串、token、openid、unionId 和患者标识不写入本文。

## 1. 发布边界

| 项目 | 结果 |
| --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/93373d9` |
| 当前生产 release | `/home/ps/code/hospital-platform/releases/d177991`，全程未改变 |
| 新 API | `hospital-platform-api-v2.service=active`，`10.0.0.3:18081` 仍运行 `d177991` |
| 旧 Python API | `0.0.0.0:8001` 仍保留，未重启、未切换 |
| Worker | 未启动，支付/医保/HIS gate 未打开 |
| 数据库变更 | 无；只读取真实 schema 和依赖探针 |

候选只新增到独立目录，不能把本文当作公网业务验收或生产切换记录。

## 2. Bundle checksum

本地 `pnpm check` 已通过；服务器上传后的 SHA-256 与本地构建产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `3bc390ae386067ee1ac6dfb4789546a86733b1976bb82c58d921c34d0a9cca38` |
| `apps/worker/dist/index.js` | `5eae40196b4476983d957dd7a212507b8b4ec1da443097ba6c448025684a0c6f` |
| `apps/worker/dist/preflight.js` | `4fcd4722a0246959861be78fa1947d0b11fa96f94f4546c0fbae52b36cc6db76` |
| `apps/worker/dist/provider-directory-smoke.js` | `feb8047e46c7a2d9d7b108d9c57dc68a3164b26b057ee93a6af0eec44566511d` |
| `apps/worker/dist/api-runtime-smoke.js` | `ad77a116eddea4a681a95769e708cbd995ee491089ee4cfff39a5c1238414987` |

## 3. 真实生产 env preflight

候选使用服务器现有 `shared/api.env`，只读取，不复制、不打印、不修改：

- `runtime.preflight.succeeded`，environment 为 `production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用只读 gate 为 `configured`；
- 报告目录/详情和微信支付为 `disabled`；
- MySQL、Redis 通过；
- schema `verified`，目标 migration 为 `0015_patient_directory_sync_operations`，缺失 migration/schema object 均为空。

## 4. 公网只读 runtime smoke

候选 bundle 通过 `https://test-hp.meiyi.pro/api/v2` 访问现有 `d177991`，不代表候选 API 已运行。

首次并发 smoke 在 2026-08-16 20:59:43 CST 观察到一次瞬态 readiness 失败：API 日志同时记录
`persistence.probe.unavailable`（`database`、`schema`），随后在 20:59:53 CST 记录两者恢复；
该现象没有触发重启或修改配置，根因仍未从当前低敏日志确定，不能把一次失败静默忽略。

随后连续 10 次公网 `/api/v2/health/ready` 均返回 `status=ready`、database/redis/schema 为 `ok`；
在 21:00:35 CST 重新执行 runtime smoke，四项均通过：

| 检查 | 结果 |
| --- | --- |
| `health-live` | `200 / passed` |
| `health-ready` | `200 / passed` |
| `system-ping` | `200 / passed` |
| `auth-boundary` | `401 / passed` |

本次只证明当前生产公网基础运行时在复测时恢复正常；如果真机验收期间再次出现 readiness 抖动，必须保留
请求 trace、`persistence.probe.*` 事件和时间窗口，先处理依赖稳定性再继续业务验收。

## 5. 下一步

1. 由真机微信登录产生平台 session 后，在受控环境临时注入 access token，使用本候选的
   `provider-directory-smoke.js` 执行患者同步首轮和同 key、不同 traceId replay；token 不进入仓库、release 或日志。
2. 对照服务端 `patient.directory.synced`、`patient.directory.operation.replayed` 和 provider request 计数，
   确认 owner 映射、`hisPatientReferenceCount`、operationId 和读模型一致性。
3. 再按“患者切换 → 预约科室/排班 → 预约历史 → 门诊费用只读”顺序完成公网和真机证据。
4. 真实业务请求出现失败时，只回滚新 API release；不停止旧 Python `8001`，不打开预约写入、支付、医保或 HIS。
