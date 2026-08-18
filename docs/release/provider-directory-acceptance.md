# 众阳目录发布验收手册

本手册适用于患者目录、预约目录、预约历史、LIS/PACS/ECG 报告摘要和 gated LIS 报告详情。它把“代码通过”“服务可运行”“provider 真实可读”和“小程序设备链路可用”分开记录；任何一层没有对应证据，都不能把对应 gate 标记为 ready。

## 当前能力边界

| 能力 | API | 当前允许的 provider 操作 | 明确不在本阶段 |
| --- | --- | --- | --- |
| 普通资料只读 | `GET /api/v1/me/profile` | 按当前 Bearer 会话读取昵称、性别、年龄、邮箱和版本的类型/版本事实；smoke 不输出资料正文 | `PUT` 写入、409 冲突、头像、手机号、实名资料和微信身份 |
| 患者目录 | `POST /api/v1/patients/sync`、`GET /api/v1/patients` | 服务端使用已绑定身份读取目录，并分别保存目录引用与临床 `his-patient` 引用 | 建档、绑卡、修改患者、把 unionId/provider 患者号交给小程序 |
| 预约目录 | `GET /api/v1/appointments/departments`、`GET /api/v1/appointments/schedules` | 读取科室、排班和号源数量 | 锁号、预约写入、取消、挂号费和支付 |
| 预约历史 | `GET /api/v1/appointments/records` | 按内部 patientId 读取有限日期范围内的脱敏记录摘要 | 详情、取消、重试写入、挂号费、支付状态和 HIS 回写 |
| 报告目录 | `GET /api/v1/reports` | 读取 LIS/PACS/ECG 摘要 | 体检报告、LIS 详情、诊断全文、解读、文件下载、门诊病历 |
| LIS 报告详情 | `GET /api/v1/reports/:reportId` | 通过服务端短期 opaque 引用读取白名单检测项 | 真实详情资源授权、文件下载、解读、PACS/ECG/体检详情 |
| 门诊费用目录 | `GET /api/v1/payments/outpatient/records` | 按内部 patientId 分别读取 `unpaid`/`paid` 费用展示目录 | 创建支付订单、微信调起、医保授权/结算、退款和 HIS 回写 |

`ZHONGYANG_PATIENT_DIRECTORY_READY`、`ZHONGYANG_APPOINTMENT_DIRECTORY_READY`、
`ZHONGYANG_APPOINTMENT_RECORDS_READY`、`ZHONGYANG_REPORT_DIRECTORY_READY` 和
`ZHONGYANG_REPORT_DETAIL_READY`、`ZHONGYANG_OUTPATIENT_PAYMENT_READY` 是六个独立 gate。
共享连接地址不代表共享验收结果。

### 当前线上基线（2026-08-17）

当前生产 `current` 为 `0b6f38f`，对应新 API `hospital-platform-api-v2.service`；旧 Python
服务仍由原端口独立提供，未被本次发布替换。`0b6f38f` 发布后的 SSH、候选启动、公网健康检查、
认证边界和旧服务共存证据，统一见 [`0b6f38f-production-acceptance-2026-08-17.md`](0b6f38f-production-acceptance-2026-08-17.md)。

截至 `0b6f38f` 切换窗口结束，当前 release 取得了服务启动、schema migration、健康探针、system-ping 和未登录边界请求，
但尚未在该版本取得新的微信登录、患者目录、预约、报告或门诊费用业务请求。`ca5a372` 及更早 release 的真实微信登录、患者同步、
预约科室和排班读取属于历史证据，不能直接标记当前 `0b6f38f` 的业务 gate；后续真机或公网业务验收必须重新记录当前 release、`traceId`、`requestId` 和脱敏响应摘要。

所有患者作用域能力都必须经过同一条 owner 目录门禁：smoke 先用当前平台 Bearer
读取 `GET /patients`，只接受响应 `data.items[].id` 中的内部患者 ID；只有
`HOSPITAL_PATIENT_ID` 出现在这次会话目录中，才允许继续请求预约记录、门诊费用或报告。
若同时启用 `patient-sync`，必须先完成同步和同 key replay，再重新读取患者目录。目录归属
失败会在平台 API 层短路，不会把未归属患者 ID 发送给众阳或其他 provider。

普通资料只读能力不属于患者作用域，不要求 `HOSPITAL_PATIENT_ID`；它只校验当前 Bearer owner
返回的资料结构，且只执行 `GET`。资料读取成功不能替代患者归属、实名身份或微信资料写入验收。

截至 2026-08-16，服务器到真实 provider 的预约科室/排班只读回归已通过；线上实测确认目录
`thirdPatientId` 调用记录接口会返回 `smcAppointment@1301 / 患者信息不存在`，而旧端的
`patInfosFind(type=3, cardNo, patName)` 可以返回临床 `patId`。用途隔离代码已随 release
`b1b84d7` 发布，生产 migration `0012_patient_provider_references` 已成功应用；随后受控发布
`ca3a877` 又完成了 `0013_patient_directory_snapshot` 及其 schema probe；这些版本的业务日志是
历史回归证据。真实账号重新同步、预约历史 provider 只读、公网业务 smoke 和真机证据仍未在
当前 `0b6f38f` 验收窗口尚未取得预约历史业务请求，因此预约历史不得标记为完整验收。

### 2026-08-16 真实账号与预约目录只读证据

- 23:08:55 的微信登录一次性因持久化暂时不可用返回 503；23:09:08 重试成功，随后 `/me`、患者目录和完整同步均返回 200；单患者结果、会话恢复和同步证据详见 [`wechat-patient-sync-production-acceptance-2026-08-16.md`](wechat-patient-sync-production-acceptance-2026-08-16.md)。
- 23:37:56-23:37:57 在 `a11f117` 上首次观察到微信开发者工具预约目录读取，科室 62 条、排班 1 条返回 200，但排班快照暂时不可用；该情况已记录在 [`wechat-patient-sync-production-acceptance-2026-08-16.md`](wechat-patient-sync-production-acceptance-2026-08-16.md)。
- 23:50:17-23:50:18 在 `41c9c18` 上重新打开预约目录，科室 62 条、排班 1 条返回 200，并出现 `appointment.schedule_snapshots.persisted` 与 `snapshotPersistenceStatus=persisted`；本次没有点击锁号、预约、取消或支付动作。该证据见 [`41c9c18-production-acceptance-2026-08-16.md`](41c9c18-production-acceptance-2026-08-16.md)。
- 尚未完成 Redis 实际 TTL、多患者切换/失效恢复、预约历史、报告、门诊费用、公网页面网络和真机完整证据；支付、医保、退款与 HIS 回写继续关闭。

### 2026-08-16 线上发布证据（历史记录）

- 迁移阶段 release：`b1b84d7`、`ca3a877`；当日历史生产 release：`b186098`。该段记录用于解释
  当日迁移过程，不代表当前生产版本；当前版本请以本文件“当前线上基线”和
  [`daee96d-production-acceptance-2026-08-17.md`](daee96d-production-acceptance-2026-08-17.md)为准。
- 生产 schema：`0012_patient_provider_references`、`0013_patient_directory_snapshot`、`0014_user_profiles` 和
  `0015_patient_directory_sync_operations` 均已迁移；最新 schema probe 返回 `ready`，目标 migration、表/列、索引和 owner 外键均通过。
- 新 API：`http://10.0.0.3:18081/health/live`、`/health/ready` 均返回 200；公网
  `https://test-hp.meiyi.pro/api/v2/health/live`、`/api/v2/health/ready` 均返回 200。
- 本轮只读复核中公网 `ready` 曾短暂返回 `database/schema unavailable`；直连
  `10.0.0.3:18081` 立即返回 `ready/database=ok/redis=ok/schema=ok`，随后公网复测恢复为同样结果。
  当前没有据此重启或修改服务；后续应继续观察 ready 探针和数据库连接池日志，避免把瞬态依赖抖动误报为业务迁移完成。
- 启动日志：`runtimeMode=production`，数据库、Redis、schema 探针均为 `ok`；患者目录、预约目录、预约记录和门诊缴费配置为 `configured`；报告 gate 继续关闭。患者目录现在可以进入真实 active/inactive 失效与恢复数据验收。
- `a11f117` 切换后 22:37:19-22:37:40 CST 连续 10 次 readiness 均为 `ready`，没有新的 persistence 探针抖动；这只解除真实业务验收的运行时前置，不代表任何患者/预约/费用 Provider 业务已经通过。
- 旧服务隔离：`8001` 仍在监听，未重启、未切换旧 Python 服务。
- SSH 在 2026-08-16 22:31 CST 的早期只读复核确实只看到健康探针和未登录边界请求；该历史快照已被后续真实业务证据补充，不能继续用它代表当前 release 的全部状态。
- 尚缺证据：Redis 实际 TTL、同 key replay 的 operation 日志、多患者切换/失效恢复、预约历史真实响应、报告和门诊费用真实响应、真机截图/网络记录和对应 traceId。
- `93373d9` 仅作为未切换候选完成了 bundle checksum、真实生产 env preflight 和公网 runtime 复测；其中一次
  readiness 瞬态探针失败后恢复，详见 [`candidate-93373d9-preproduction-smoke-2026-08-16.md`](candidate-93373d9-preproduction-smoke-2026-08-16.md)。
- 最新候选 `411cd31` 在 `127.0.0.1:18084` 使用真实生产依赖完成 production mode、live/ready 和正常停止验收；
  该候选仍未切换 `current`，持久化探针低敏错误码增强和候选证据见
  [`candidate-411cd31-preproduction-smoke-2026-08-16.md`](candidate-411cd31-preproduction-smoke-2026-08-16.md)。
- 最新候选 `d8f14f1` 在 `127.0.0.1:18087` 完成患者归属门禁代码验收、真实生产 env preflight、
  production mode、live/ready、system-ping、未登录认证边界和正常停止验收；该候选仍未切换
  `current`，详见 [`candidate-d8f14f1-preproduction-smoke-2026-08-16.md`](candidate-d8f14f1-preproduction-smoke-2026-08-16.md)。

### 2026-08-16 数据层迁移与复核

通过 SSH 先执行只读检查，再按生产迁移 runbook 执行受控变更；旧 Python 服务、旧端口和旧表均未切换：

- 迁移前 `current` 指向 `/home/ps/code/hospital-platform/releases/b1b84d7`；其 preflight 只验证到
  `expected:0012_patient_provider_references`，MySQL/Redis 通过，整体退出码为 1 的原因是支付仍缺少
  `PAYMENT_DATA_ENCRYPTION_KEY` 和 `WECHAT_PAYMENT_READY`；
- 迁移前只读 SQL 确认 `hp_schema_migrations` 最后为 `0012_patient_provider_references`，`hp_patients` 只有 1 条记录；
- 迁移候选 `ca3a877` 独立安装并构建成功；显式启用生产 migration 安全开关后，仅执行
  `0013_patient_directory_snapshot`，日志出现 `persistence.migration.started` 和 `persistence.migration.succeeded`；
- 迁移阶段 `db:schema` 曾返回 `status=ready`、`schemaStatus=verified`、`expectedMigrationId=0013_patient_directory_snapshot`；
  后续 `0014` 与 `0015` 已由生产候选完成，当前目标 migration 为 `0015_patient_directory_sync_operations`，
  `missingMigrationIds=[]`、`missingSchemaObjects=[]`；
- 迁移阶段 `current` 曾原子切换到 `ca3a877`，API unit 重启后为 `active`；随后 `d177991` 又完成了
  当前 release 切换；`GET http://10.0.0.3:18081/health/ready` 和公网
  `https://test-hp.meiyi.pro/api/v2/health/ready` 均返回 `200`，database、Redis 和 schema 均为 `ok`；
- 启动日志明确为 `runtimeMode=production`、`persistenceSchemaProbe=ok`、支付和报告 gate 关闭；
- `10.0.0.3:18081` 与旧服务 `0.0.0.0:8001` 同时监听，旧服务未被切换。

因此当前数据层状态应记录为：生产已完成 `0013` migration 和 schema probe；真实失效/恢复业务数据验收、
真实账号重新同步、provider 预约历史、公网业务 smoke 和真机证据仍待执行。即使 `PERSISTENCE_SCHEMA_READY=true`
或 `/health/ready=200`，也不能把它们当作患者目录业务验收已经完成。

## A. 代码层证据

在提交目标 release 后执行：

```powershell
pnpm check
```

必须确认：

- Biome format/lint、所有 workspace typecheck、test 和 build 全部通过；
- adapter 测试覆盖数组/包装响应、业务失败、档案查询的卡号+姓名参数、临床 patId 白名单、科室与排班日期参数、字段白名单和 provider 请求 id；
- 排班服务测试证明只读结果会写入带 `providerRequestId` 和 `expiresAt` 的短期服务端快照；快照不会自动开放预约写入；
- API 测试证明公共 `scheduleId` 是平台 opaque 引用，provider `hisScheduleId` 不进入 response；服务端生成的
  `scheduleId` 还会拒绝空白/控制字符和同批次重复值，避免列表节点复用或短期快照覆盖；
- 预约记录测试证明服务端先读取用途为 `his-patient` 的 owner-scoped 映射，再固定 `requestChannel=3`、`isMzFlag=1`、`dateFlag=1`，并丢弃预约号、患者身份、电话、费用和支付字段；
- API 测试证明会话 owner 隔离，且 provider 患者号不会进入 API 响应；
- Provider smoke 测试证明患者同步后会重新读取当前会话目录，未归属的内部 patientId 会在
  `patient-owner` 检查失败并停止，provider 不会收到后续患者作用域请求；
- Provider smoke 测试证明 `profile-read` 只请求 `GET /me/profile`，只校验普通资料字段类型和
  非负版本，不输出昵称/邮箱，不执行资料写入；资料域异常也不会被误记为患者域证据；
- 原生小程序 acceptance test 证明只调用 Hospital API，不包含众阳 provider URL；
- Pino 日志测试证明 `providerPatientId`、`provider_patient_id` 和 `providerSubject` 会被脱敏；
- 报告测试不把 provider 报告号、患者姓名、完整卡号、身份证号、报告明细、文件 URL 或 provider 原始对象带出 adapter。
- LIS 详情测试证明 provider 报告号只用于 adapter 请求，响应只包含白名单检测项；报告引用测试证明 owner/patient/TTL 失败时不会读取详情。
- 门诊费用服务测试必须使用带时区含义的固定 `Date`，证明最近 30 个 `Asia/Shanghai` 日历日不会随部署机器本地时区变化。
- 门诊费用 service 测试还必须证明 owner-scoped 仓储返回的患者引用会在 Provider 调用前再次校验：非法结构、控制字符和跨患者/Provider 范围的 HIS `patId` 均 fail-closed，只记录有限原因，不把外部患者号写入日志或公共响应。
- 门诊费用 smoke 必须分别读取 `unpaid` 和 `paid`，验证响应状态与请求状态一致，并确认不会触发支付、医保或结算写入。

## B. API 层只读 smoke

真实环境验收使用平台 API smoke，不允许验收脚本绕过 API 直接请求众阳。默认能力只执行
`GET`；只有显式加入 `patient-sync` 能力时才执行一轮带幂等键的 `POST /patients/sync`，
该能力包含首轮同步和同 key、不同 traceId 的 replay 请求。
所有请求默认要求 HTTPS，并检查平台响应不能包含 provider 患者号、排班/预约/provider 报告引用、费用、支付或原始字段；服务端生成的 opaque reportId 允许存在：

```powershell
$env:HOSPITAL_API_BASE_URL = "https://<hospital-api-host>"
# 公网代理入口是 /api/v2；内网直接访问 Elysia 端口时才使用 /api/v1。
$env:HOSPITAL_API_PREFIX = "/api/v2"
$env:HOSPITAL_ACCESS_TOKEN = "<platform-access-token>"
$env:HOSPITAL_PATIENT_ID = "<internal-patient-id>"
$env:HOSPITAL_SMOKE_CAPABILITIES = "session,profile-read,patient-sync,patients,appointment-directory,appointment-records,reports,outpatient-payments"
$env:HOSPITAL_PROVIDER_READINESS_SAMPLES = "6"
$env:HOSPITAL_PROVIDER_READINESS_INTERVAL_MS = "2000"
pnpm provider:smoke
```

候选 release 已将该 smoke 独立打包为 `apps/worker/dist/provider-directory-smoke.js`，服务器没有
workspace `@hospital/*` 链接时也必须使用这个 bundle，而不是直接执行 `src/provider-directory-smoke.ts`：

```bash
set -a
. /home/ps/code/hospital-platform/shared/worker.env
set +a
HOSPITAL_API_BASE_URL="https://test-hp.meiyi.pro" \
HOSPITAL_API_PREFIX="/api/v2" \
HOSPITAL_SMOKE_CAPABILITIES="session,profile-read,patients,appointment-directory,appointment-records,outpatient-payments" \
/home/ps/.bun/bin/bun "/home/ps/code/hospital-platform/releases/<sha>/apps/worker/dist/provider-directory-smoke.js"
```

真实 `HOSPITAL_ACCESS_TOKEN` 和 `HOSPITAL_PATIENT_ID` 只能由受控验收环境临时注入；上面的 bundle 仍只
访问平台只读 API，`patient-sync` 是唯一允许的幂等目录同步 POST，不会触发预约、支付、医保、退款或 HIS 回写。

`outpatient-payments` 只读取 `/payments/outpatient/records` 的 `status=unpaid` 和 `status=paid` 两种目录，
用于验证门诊费用 owner 映射、金额脱敏和空列表语义；它不会创建支付订单、调起微信、请求医保或执行结算回写。

`HOSPITAL_ACCESS_TOKEN` 和 `HOSPITAL_PATIENT_ID` 只从受控环境注入，命令输出不会打印其值。
`patient-sync` 会让服务端重新读取当前微信身份对应的患者目录，并在首轮成功后用同一个幂等键执行
第二次 replay；它不会接受 provider 患者号，
也不会把同步结果中的临床引用返回给脚本。同步完成后，从平台 `GET /patients` 响应中取得内部
`patientId`，再通过环境变量运行预约历史/报告 smoke；同时用同步请求的 `traceId` 检索服务端
`patient.directory.synced` 日志，确认 `hisPatientReferenceCount`，不能只看脚本的 HTTP 200。
第二次请求必须使用不同的 `traceId` 但相同的 `Idempotency-Key`，应看到同一内部 `operationId` 的
`patient.directory.operation.replayed`，并确认 provider 没有第二次请求；脚本会比较两次平台读模型，
防止 replay 生成新的内部 `patientId`。
本地 HTTP 仅可在明确设置 `HOSPITAL_ALLOW_LOCAL_HTTP=true` 后用于本机调试；公网 smoke
仍必须使用 HTTPS。工具输出使用 Pino 结构化事件：

```text
provider.smoke.capability.passed / failed
provider.smoke.completed / failed
```

smoke 会先验证 `health/live.data.status=ok`，再按
`HOSPITAL_PROVIDER_READINESS_SAMPLES` 和 `HOSPITAL_PROVIDER_READINESS_INTERVAL_MS` 连续验证
`health/ready.data.status=ready`；任一采样失败时立即停止，不再请求患者、预约或报告 provider 能力。
正式验收不要只做一次 ready 请求，具体上限和证据规则见
[`readiness-stability-gate.md`](readiness-stability-gate.md)。
如果能力列表包含 `session`（默认 CLI 配置已包含），健康检查通过后会先调用带 Bearer 的
`GET /me`，确认返回的是当前平台内部用户结构；会话无效或响应字段不符合 contract 时立即停止，
不会继续访问患者、预约、报告或门诊费用接口。`session` 检查不把内部 userId 写入 smoke 结果，
只保留 traceId 供服务端日志关联。

默认 CLI 能力还包含 `profile-read`。它在健康检查后请求一次 `GET /me/profile`，只校验
`displayName`、`gender`、`age`、`email` 和非负 `version` 的类型，不执行 `PUT`，不输出昵称/邮箱，
也不会把资料读取成功误记为资料写入或真机编辑验收。资料域是独立的普通 owner 资料域；即使资料
读取失败，也不能因此跳过或伪造患者目录的 owner 归属门禁。

当能力列表包含任一患者作用域能力时，工具会自动补充一次 `patients` 和一次
`patient-owner` 检查，即使调用方没有显式写入 `patients`。`patient-owner` 使用当前会话目录
中刚读取的内部 ID 集合做精确匹配；它不是对患者号格式的校验，也不是 provider 的可用性探测。
因此“患者 ID 看起来合法”不能替代“患者属于当前登录用户”的证明。

## C. 运行层证据

先在部署密钥系统或受控 staging 环境注入配置，不把 token 写入 shell 历史、仓库或日志：

```powershell
$env:ZHONGYANG_PATIENT_DIRECTORY_READY = "true"
$env:ZHONGYANG_APPOINTMENT_DIRECTORY_READY = "true"
$env:ZHONGYANG_APPOINTMENT_RECORDS_READY = "true"
$env:ZHONGYANG_REPORT_DIRECTORY_READY = "true"
$env:ZHONGYANG_REPORT_DETAIL_READY = "true"
$env:ZHONGYANG_OUTPATIENT_PAYMENT_READY = "true"
$env:ZHONGYANG_BASE_URL = "https://<provider-host>"
# 如 provider 合同要求，再注入服务端 token
$env:ZHONGYANG_AUTHORIZATION_TOKEN = "<secret-from-secret-store>"
pnpm runtime:preflight
```

preflight 必须显示：

- `provider-configuration` 中六个众阳 gate 为 `configured`；
- MySQL、Redis、目标 migration 和关键 schema invariants 通过；
- `PERSISTENCE_SCHEMA_READY` 已由部署流程显式确认；
- 输出只包含 `configured/disabled/incomplete`、环境变量名和错误类型，不包含 URL 实际值、token 或 provider 原始报文。

运行后再确认：

```text
GET /health/live  -> 200：只证明进程能响应
GET /health/ready -> 200 且 data.status=ready：证明基础设施、schema gate 和关键 schema invariants 通过
```

HTTPS 是硬条件：三个众阳 gate、微信身份和微信支付的自定义 provider base URL 都必须是 HTTPS；HTTP 不能通过配置状态检查。真实 provider 请求前，不得为了“先试一下”关闭 gate 或把 URL 写入小程序配置。

## D. provider 只读证据

使用 provider 书面授权的 staging/测试身份和测试患者，按以下顺序留证：

1. 登录和患者同步：确认 unionId 只来自服务端身份表；记录内部 `userId`、内部 `patientId`、traceId 和 provider request id，不记录 provider 患者号；确认同步日志的 `hisPatientReferenceCount` 与测试账号患者数一致。生产 migration 已完成，当前只等待真实账号重新同步。
2. 患者列表：确认响应只有内部 id、脱敏姓名/关系/卡号和 source。
3. 预约科室和排班：确认服务端固定 `requestChannel=4`；科室请求由服务端补齐未来 7 天日期窗口，排班日期范围和筛选字段只来自平台 query 白名单。
4. 患者归属：使用另一个账号的内部 patientId 做 smoke，确认 `patient-owner` 失败且请求列表中没有预约、报告或费用 provider 请求；不能只验证 ID 格式。
5. 预约历史：确认服务端以内部 patientId 查询 `his-patient` 映射，固定 `requestChannel=3`、`isMzFlag=1`、`dateFlag=1`；确认响应没有 `appointmentInfoId`、患者身份、电话、费用、支付和 HIS 字段；用只有目录映射的测试患者确认不会错误调用 provider。
6. 报告目录：确认服务端以内部 patientId 查映射后分别读取 LIS/PACS/ECG；确认响应只有来源、标题、时间、状态和附件存在性。
7. LIS 报告详情：先从报告目录取得 opaque `reportId` 和当前内部 `patientId`，再通过当前公网入口请求 `GET /api/v2/reports/:reportId?patientId=...`（内网直连时才使用 `/api/v1`）；确认服务端按 owner、patient 和 TTL 查询，响应没有 provider 报告号、患者字段、文件 URL 或原始 JSON。
8. provider 业务失败、超时和 malformed response：确认 API 返回统一安全错误，日志保留 trace、provider request id 和错误类型，不保留 provider 原始错误内容。
9. 使用错误 owner 的内部 patientId/reportId，或使用同一 owner 另一就诊人的 patientId/reportId 组合：确认服务端在 provider 请求前返回预约记录或报告的隔离错误。

必须出现的结构化日志事件：

```text
patient.directory.requested / synced / failed
appointment.directory.departments.requested / synced / failed
appointment.directory.schedules.requested / synced / failed
appointment.records.requested / synced / failed
report.directory.requested / synced / failed
report.detail.requested / synced / failed
```

这些日志只用于诊断，不替代数据库患者映射、订单状态或 provider 侧证据。`patient-sync` 的 POST
只用于受控验收，不代表已经开放患者建档、绑卡或修改接口。

## E. 原生小程序与设备证据

在微信开发者工具和真机分别执行：

- `wx.login` 只向 Hospital API 发送临时 code；网络列表中不出现众阳 host；
- 登录后同步患者，页面只显示平台脱敏模型；
- 读取预约目录，页面只显示科室/排班安全字段；
- 读取当前日前后各 90 天预约历史，页面只显示脱敏摘要，不出现 provider 预约号、患者号、电话、费用或支付字段；爽约记录另只读取过去 90 天并筛选服务端 `status=missed`；
- 选择内部 patientId 读取近 30 天报告，页面只显示摘要，不显示 provider 患者号或原始 JSON；
- 若详情 gate 已通过，从目录返回的 opaque reportId 打开 LIS 详情，页面只显示白名单检测项，不显示 provider 报告号、患者字段或文件 URL；
- 将 API base URL 改为公网 HTTP，客户端必须拒绝请求；本机 HTTP 只允许 localhost/127.0.0.1；
- 记录开发者工具/真机网络、页面截图和服务端 traceId，不能只凭页面“加载成功”判断 provider 通过。

## 证据记录模板

```text
release commit:
environment:
provider contract/version:
started at:
API base URL scheme: HTTPS / rejected HTTP
internal userId:
internal patientId:
traceId:
provider request ids:
commands:
result by capability:
log events:
provider console or response evidence:
mini-program screenshots/network evidence:
remaining gaps:
```

## 未完成项

在上述四层证据完成前，以下状态保持未验收：真实 provider 生产权限、生产 HTTPS/反向代理、真机网络和页面验收、预约写入/锁号/取消/详情、挂号费和支付、LIS 详情真实资源授权、报告解读/下载、PACS/ECG/体检详情、医保 FSI crypto 和 HIS 写回。
