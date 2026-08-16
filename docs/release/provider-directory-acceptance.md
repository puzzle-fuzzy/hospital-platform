# 众阳目录发布验收手册

本手册适用于患者目录、预约目录、预约历史、LIS/PACS/ECG 报告摘要和 gated LIS 报告详情。它把“代码通过”“服务可运行”“provider 真实可读”和“小程序设备链路可用”分开记录；任何一层没有对应证据，都不能把对应 gate 标记为 ready。

## 当前能力边界

| 能力 | API | 当前允许的 provider 操作 | 明确不在本阶段 |
| --- | --- | --- | --- |
| 患者目录 | `POST /api/v1/patients/sync`、`GET /api/v1/patients` | 服务端使用已绑定身份读取目录，并分别保存目录引用与临床 `his-patient` 引用 | 建档、绑卡、修改患者、把 unionId/provider 患者号交给小程序 |
| 预约目录 | `GET /api/v1/appointments/departments`、`GET /api/v1/appointments/schedules` | 读取科室、排班和号源数量 | 锁号、预约写入、取消、挂号费和支付 |
| 预约历史 | `GET /api/v1/appointments/records` | 按内部 patientId 读取有限日期范围内的脱敏记录摘要 | 详情、取消、重试写入、挂号费、支付状态和 HIS 回写 |
| 报告目录 | `GET /api/v1/reports` | 读取 LIS/PACS/ECG 摘要 | 体检报告、LIS 详情、诊断全文、解读、文件下载、门诊病历 |
| LIS 报告详情 | `GET /api/v1/reports/:reportId` | 通过服务端短期 opaque 引用读取白名单检测项 | 真实详情资源授权、文件下载、解读、PACS/ECG/体检详情 |

`ZHONGYANG_PATIENT_DIRECTORY_READY`、`ZHONGYANG_APPOINTMENT_DIRECTORY_READY`、
`ZHONGYANG_APPOINTMENT_RECORDS_READY`、`ZHONGYANG_REPORT_DIRECTORY_READY` 和
`ZHONGYANG_REPORT_DETAIL_READY` 是五个独立 gate。
共享连接地址不代表共享验收结果。

截至 2026-08-16，服务器到真实 provider 的预约科室/排班只读回归已通过；线上实测确认目录
`thirdPatientId` 调用记录接口会返回 `smcAppointment@1301 / 患者信息不存在`，而旧端的
`patInfosFind(type=3, cardNo, patName)` 可以返回临床 `patId`。用途隔离代码已随 release
`b1b84d7` 发布，生产 migration `0012_patient_provider_references` 已成功应用；随后受控发布
`ca3a877` 又完成了 `0013_patient_directory_snapshot` 及其 schema probe。真实账号重新同步、预约历史
provider 只读、公网业务 smoke 和真机证据仍未完成，因此预约历史不得标记为完整验收。

### 2026-08-16 线上发布证据

- 旧一阶段 release：`b1b84d7`；随后新 release：`ca3a877`。`hospital-platform-api-v2.service` 已切换到 `ca3a877` 并重启。
- 生产 schema：`0012_patient_provider_references` 与 `0013_patient_directory_snapshot` 均迁移成功；最新 schema probe 返回 `ready`，目标 migration、表/列、索引和 owner 外键均通过。
- 新 API：`http://10.0.0.3:18081/health/live`、`/health/ready` 均返回 200；公网
  `https://test-hp.meiyi.pro/api/v2/health/live`、`/api/v2/health/ready` 均返回 200。
- 本轮只读复核中公网 `ready` 曾短暂返回 `database/schema unavailable`；直连
  `10.0.0.3:18081` 立即返回 `ready/database=ok/redis=ok/schema=ok`，随后公网复测恢复为同样结果。
  当前没有据此重启或修改服务；后续应继续观察 ready 探针和数据库连接池日志，避免把瞬态依赖抖动误报为业务迁移完成。
- 启动日志：`runtimeMode=production`，数据库、Redis、schema 探针均为 `ok`；患者目录、预约目录、预约记录和门诊缴费配置为 `configured`；报告 gate 继续关闭。患者目录现在可以进入真实 active/inactive 失效与恢复数据验收。
- 旧服务隔离：`8001` 仍在监听，未重启、未切换旧 Python 服务。
- 尚缺证据：当前微信账号重新同步后的 `hisPatientReferenceCount`、预约历史真实响应、真机截图/网络记录和对应 traceId。

### 2026-08-16 数据层迁移与复核

通过 SSH 先执行只读检查，再按生产迁移 runbook 执行受控变更；旧 Python 服务、旧端口和旧表均未切换：

- 迁移前 `current` 指向 `/home/ps/code/hospital-platform/releases/b1b84d7`；其 preflight 只验证到
  `expected:0012_patient_provider_references`，MySQL/Redis 通过，整体退出码为 1 的原因是支付仍缺少
  `PAYMENT_DATA_ENCRYPTION_KEY` 和 `WECHAT_PAYMENT_READY`；
- 迁移前只读 SQL 确认 `hp_schema_migrations` 最后为 `0012_patient_provider_references`，`hp_patients` 只有 1 条记录；
- 新 release `ca3a877` 独立安装并构建成功；显式启用生产 migration 安全开关后，仅执行
  `0013_patient_directory_snapshot`，日志出现 `persistence.migration.started` 和 `persistence.migration.succeeded`；
- 迁移后的 `db:schema` 返回 `status=ready`、`schemaStatus=verified`、`expectedMigrationId=0013_patient_directory_snapshot`、
  `missingMigrationIds=[]`、`missingSchemaObjects=[]`；
- `current` 已原子切换到 `ca3a877`，API unit 重启后为 `active`；`GET http://10.0.0.3:18081/health/ready` 和公网
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
- API 测试证明公共 `scheduleId` 是平台 opaque 引用，provider `hisScheduleId` 不进入 response；
- 预约记录测试证明服务端先读取用途为 `his-patient` 的 owner-scoped 映射，再固定 `requestChannel=3`、`isMzFlag=1`、`dateFlag=1`，并丢弃预约号、患者身份、电话、费用和支付字段；
- API 测试证明会话 owner 隔离，且 provider 患者号不会进入 API 响应；
- 原生小程序 acceptance test 证明只调用 Hospital API，不包含众阳 provider URL；
- Pino 日志测试证明 `providerPatientId`、`provider_patient_id` 和 `providerSubject` 会被脱敏；
- 报告测试不把 provider 报告号、患者姓名、完整卡号、身份证号、报告明细、文件 URL 或 provider 原始对象带出 adapter。
- LIS 详情测试证明 provider 报告号只用于 adapter 请求，响应只包含白名单检测项；报告引用测试证明 owner/TTL 失败时不会读取详情。
- 门诊费用服务测试必须使用带时区含义的固定 `Date`，证明最近 30 个 `Asia/Shanghai` 日历日不会随部署机器本地时区变化。

## B. API 层只读 smoke

真实环境验收使用平台 API smoke，不允许验收脚本绕过 API 直接请求众阳。默认能力只执行
`GET`；只有显式加入 `patient-sync` 能力时才执行一次带幂等键的 `POST /patients/sync`。
所有请求默认要求 HTTPS，并检查平台响应不能包含 provider 患者号、排班/预约/provider 报告引用、费用、支付或原始字段；服务端生成的 opaque reportId 允许存在：

```powershell
$env:HOSPITAL_API_BASE_URL = "https://<hospital-api-host>"
# 公网代理入口是 /api/v2；内网直接访问 Elysia 端口时才使用 /api/v1。
$env:HOSPITAL_API_PREFIX = "/api/v2"
$env:HOSPITAL_ACCESS_TOKEN = "<platform-access-token>"
$env:HOSPITAL_PATIENT_ID = "<internal-patient-id>"
$env:HOSPITAL_SMOKE_CAPABILITIES = "patient-sync,patients,appointment-directory,appointment-records,reports"
pnpm provider:smoke
```

`HOSPITAL_ACCESS_TOKEN` 和 `HOSPITAL_PATIENT_ID` 只从受控环境注入，命令输出不会打印其值。
`patient-sync` 会让服务端重新读取当前微信身份对应的患者目录；它不会接受 provider 患者号，
也不会把同步结果中的临床引用返回给脚本。同步完成后，从平台 `GET /patients` 响应中取得内部
`patientId`，再通过环境变量运行预约历史/报告 smoke；同时用同步请求的 `traceId` 检索服务端
`patient.directory.synced` 日志，确认 `hisPatientReferenceCount`，不能只看脚本的 HTTP 200。
如请求被重复提交，还应看到同一内部 `operationId` 的
`patient.directory.operation.replayed`，并确认 provider 没有第二次请求。
本地 HTTP 仅可在明确设置 `HOSPITAL_ALLOW_LOCAL_HTTP=true` 后用于本机调试；公网 smoke
仍必须使用 HTTPS。工具输出使用 Pino 结构化事件：

```text
provider.smoke.capability.passed / failed
provider.smoke.completed / failed
```

smoke 会先验证 `health/live.data.status=ok` 和 `health/ready.data.status=ready`；任一健康检查失败时立即停止，不再请求患者、预约或报告 provider 能力。

## C. 运行层证据

先在部署密钥系统或受控 staging 环境注入配置，不把 token 写入 shell 历史、仓库或日志：

```powershell
$env:ZHONGYANG_PATIENT_DIRECTORY_READY = "true"
$env:ZHONGYANG_APPOINTMENT_DIRECTORY_READY = "true"
$env:ZHONGYANG_APPOINTMENT_RECORDS_READY = "true"
$env:ZHONGYANG_REPORT_DIRECTORY_READY = "true"
$env:ZHONGYANG_REPORT_DETAIL_READY = "true"
$env:ZHONGYANG_BASE_URL = "https://<provider-host>"
# 如 provider 合同要求，再注入服务端 token
$env:ZHONGYANG_AUTHORIZATION_TOKEN = "<secret-from-secret-store>"
pnpm runtime:preflight
```

preflight 必须显示：

- `provider-configuration` 中五个众阳 gate 为 `configured`；
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
4. 预约历史：确认服务端以内部 patientId 查询 `his-patient` 映射，固定 `requestChannel=3`、`isMzFlag=1`、`dateFlag=1`；确认响应没有 `appointmentInfoId`、患者身份、电话、费用、支付和 HIS 字段；用只有目录映射的测试患者确认不会错误调用 provider。
5. 报告目录：确认服务端以内部 patientId 查映射后分别读取 LIS/PACS/ECG；确认响应只有来源、标题、时间、状态和附件存在性。
6. LIS 报告详情：先从报告目录取得 opaque `reportId`，再请求 `GET /api/v1/reports/:reportId`；确认服务端按 owner 和 TTL 查询，响应没有 provider 报告号、患者字段、文件 URL 或原始 JSON。
7. provider 业务失败、超时和 malformed response：确认 API 返回统一安全错误，日志保留 trace、provider request id 和错误类型，不保留 provider 原始错误内容。
8. 使用错误 owner 的内部 patientId/reportId：确认服务端在 provider 请求前返回预约记录或报告的 owner 隔离错误。

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
- 读取近 90 天预约历史，页面只显示脱敏摘要，不出现 provider 预约号、患者号、电话、费用或支付字段；
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
