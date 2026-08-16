# 患者 provider 引用映射说明

## 为什么必须拆分

旧小程序的患者选择流程并不是把患者目录接口返回的 `thirdPatientId` 直接当作临床患者号使用。它先读取目录，再通过：

```text
GET /msun-middle-aggregate-patient/v1/patInfosFind
    type=3&cardNo=<medicalCardNo>&patName=<patientName>
```

取得档案接口返回的 `patId`，随后预约历史、报告和门诊费用接口都使用这个 `patId`。

线上只读验证已经证明两者不能混用：预约历史接口直接接收目录 `thirdPatientId` 时返回
`smcAppointment@1301 / 患者信息不存在`；使用档案查询得到的 `patId` 可以形成有效档案响应。

因此，新平台的外部身份边界如下：

| 引用用途 | 来源 | 持久化位置 | 是否进入小程序响应 |
| --- | --- | --- | --- |
| `directory` | `patientInfoByUnionId.thirdPatientId` | `hp_patients.provider_patient_id` | 否 |
| `his-patient` | `patInfosFind.data.patId` | `hp_patient_provider_references` | 否 |

`PatientRecord.id` 始终是平台内部 opaque `patientId`。小程序只能提交这个内部值，服务端按
`ownerUserId + patientId + provider + referenceKind` 查询外部引用。

## 代码边界

- `packages/adapters/src/zhongyang-patients.ts` 负责按旧端真实契约查询档案，并把 `patId` 收窄为 `his-patient` 引用。
- `packages/domain/src/patients.ts` 用 `PatientProviderReferenceKind` 明确目录引用和临床引用的用途。
- `packages/persistence/migrations/0012_patient_provider_references.sql` 新增独立映射表，并使用 owner-scoped 复合主键和外键。
- 预约历史、报告、门诊费用服务必须显式传入 `referenceKind: "his-patient"`；不得恢复为默认目录映射。
- provider 患者号只在一次服务端调用栈中交给 adapter，不进入日志、API contract 或小程序缓存。
- 首页恢复已有微信会话、重新登录或直接打开就诊人选择页时，会主动触发一次患者目录同步，兼容迁移前已经落库但尚未拥有 `his-patient` 引用的旧患者记录。
- 同一账号连续发起同步时，快照时间在 provider 请求发出前记录；旧请求晚返回也不能覆盖更新的 `his-patient` 映射，
  或把更新快照已经停用的患者重新激活。

## 发布与回填顺序

1. 先在 staging/受控数据库应用 migration `0012_patient_provider_references`。
2. 运行 schema probe，确认新表、唯一索引和 owner 外键完整。
3. 发布 API；旧 Python 服务只使用 legacy 表，不读取新表，继续保持原端口和旧路由。
4. 新小程序执行 `POST /api/v1/patients/sync`。同步会再次调用目录和档案接口，为当前账号写入 `his-patient` 映射。
5. 在 provider、公网 API 和真机三层验证预约历史、报告和门诊费用；没有临床映射时必须 fail-closed，不能用目录 ID 兜底。

截至 2026-08-16，生产已完成第 1～3 步：release `b1b84d7` 提供 `0012_patient_provider_references`，
随后 release `ca3a877` 已成功应用 `0013_patient_directory_snapshot`，schema probe 为 `ready`，旧服务 `8001`
保持监听。第 4～5 步仍需当前微信账号重新同步并完成公网业务/真机证据；患者目录的失效/恢复语义现在可以
在真实测试账号上单独验收，但不能仅凭 schema 完成宣称业务完成。

已有 `hp_patients` 记录不能仅凭脱敏卡号自动回填临床引用。没有重新经过 provider 档案查询前，旧记录只能继续展示患者目录，临床查询保持“映射不可用”。

## 观测与故障处理

患者同步日志增加 `hisPatientReferenceCount`，只记录数量，不记录卡号、姓名、目录 ID 或档案 ID。

- `patient-archive` 请求失败：同步失败并保留 `traceId`、provider request id 和错误类型；不写入不完整的成功映射。
- 临床业务没有映射：在调用 provider 前返回对应的患者不可用错误；不得发送目录 `thirdPatientId`。
- 档案 ID 发生变化：下一次同步按同一内部患者更新 `hp_patient_provider_references`，不更换平台 `patientId`。
- 新 migration 失败：保持 `PERSISTENCE_SCHEMA_READY=false`，不得让新 API 使用半成品仓储；旧 Python 服务不受影响。

## 验收证据

- adapter 单元测试验证档案查询 URL、`type=3`、卡号+姓名参数和 `patId` 白名单映射。
- persistence 测试验证用途专用查询、owner 隔离和旧目录映射不被覆盖。
- API 测试验证预约/报告使用 `his-patient`，且外部 ID 不出现在公共响应。
- 线上验收需要保存：release commit、migration 状态、内部 `patientId`、traceId、provider request id、API 响应摘要和真机页面证据。
