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

### 本次旧接口响应形状复核（2026-08-19）

旧端实际调用的档案接口返回 `success=true`、`data` 为单个患者对象；`data.patId` 是本次同步需要的
HIS 临床患者引用，`patCardVOList`、身份证、手机号、姓名扩展字段等都不是小程序公共读模型。新 adapter
只读取并校验 `data.patId`，其它档案字段不会进入 `PatientDirectoryProfile`、日志或 API 响应；现有 adapter
测试也覆盖了 `data: { patId: ... }` 的对象形状、目录卡号脱敏和敏感字段不泄露。

本次从旧端实际请求样例进一步确认：虽然调用方同时在 `fetch` 中写了 query string 和 GET body，Provider
契约真正依赖的是 `type=3`、`cardNo`、`patName` 这三个查询参数；新 adapter 只使用 query string，不依赖
浏览器对 GET body 的非标准兼容行为。响应中的 `code=0000` 和 `traceId` 是 Provider 包络的附加信息，当前以
明确的 `success=true` 作为档案成功门禁；在 Provider 文档没有冻结 `code` 的全部取值语义前，不把未知附加字段
直接提升为业务成功条件。

当前样例还包含 `invalidFlag`、`deadLockFlag`、`patCardVOList.cardStatus`、`hospitalId` 和 `orgId`。
这些字段对“档案是否可继续用于临床查询”可能有影响，但现阶段没有取得 Provider 对每个枚举值、机构边界、
多卡关系和失效/锁定状态的正式说明，因此 adapter 暂时只把 `patId` 作为已确认的临床引用，不能凭字段名称
自行推导“有效/无效”规则。正式打开预约、报告或门诊费用的真实业务验收前，必须补齐至少以下脱敏样例：
有效档案、作废档案、锁定档案、卡片非正常、医院/机构不匹配、无档案和同卡多档案；之后再决定哪些状态应在
`patInfosFind` 边界 fail-closed。当前不能把缺少这些样例误报成业务已完成，也不能把未知状态降级为空患者。

二维码不能从这条响应形状推导：旧首页二维码源码读取的是目录对象的 `medicalCardNo`，而不是档案响应的
`data.patId`。医院尚未确认扫码字段、签名、TTL 和扫码回执前，二维码继续保持关闭态；不得因为档案接口能返回
`patId` 就把它生成二维码或暴露给小程序。

### 旧端源码行为对照（2026-08-19）

为避免把旧端变量名、注释和实际运行值混为一谈，下面按旧端源码的执行位置固定四个事实：

| 旧端位置 | 实际行为 | 新平台对应边界 |
| --- | --- | --- |
| `hospital-app/src/api/modules/ZY.ts` 的 `getArchivesInfoApi` | 调用 `patInfosFind`，查询参数是 `type=3`、`cardNo` 和 `patName`。 | 由服务端 adapter 调用，不能让小程序直连 Provider。 |
| `hospital-app/src/pagesB/patient/patientChange.vue` 的 `selectPatient` | 选择目录患者后读取档案响应，并把 `archives.patId` 写入旧端本地患者状态。 | `patId` 只进入服务端 `his-patient` 映射，不能作为平台公开患者 ID。 |
| `hospital-app/src/pages/index/index.vue` 首页患者卡片 | 卡片文字 `ID:` 显示的是 `patientInfo.patId`。这是展示行为，不代表二维码也使用该值。 | 平台首页只展示脱敏卡号和平台内部患者摘要，不展示 Provider 引用。 |
| `hospital-app/src/pages/index/index.vue` 的 `patientQrUrl` | 可执行代码实际读取 `patientInfo.medicalCardNo`，再拼接第三方二维码 URL；源码旁的“只需要包含 patId”注释与执行代码不一致。 | 不能把这段第三方 URL 当作医院扫码协议；协议未确认前保持关闭。 |

因此，当前能够确认的是“`patInfosFind.data.patId` 支撑临床查询映射”，而不是“`patId` 是二维码载荷”。旧端已经证明了页面展示值和二维码输入值可以不同；医院扫码端是否要求医疗卡号、HIS 患者号或签名凭证，仍必须以医院/HIS 的正式协议和扫码回执为准。

### 2026-08-19 档案返回身份关联校验

在最小 `success=true + data.patId` 契约之上，新 adapter 增加了兼容性的二次关联：Provider
若返回 `patName`，必须与本次查询姓名一致；若返回顶层卡号或 `patCardVOList`，卡片集合必须
包含本次查询卡号；明确返回空的 `patCardVOList` 或卡片项全部缺少可比卡号时也必须拒绝；若卡片项带有 `patId`，还必须与档案顶层 `patId` 一致。由于正式 Provider
文档尚未冻结，暂不把这些字段设为所有环境的必填项；
但字段一旦出现而不一致，整次同步必须 fail-closed，不能把返回的 `patId` 写入当前患者映射。
这条校验只证明“查询身份和档案身份一致”，不替代 `invalidFlag`、锁定状态、机构归属等尚未
取得正式枚举的业务判断。具体代码和测试证据见
[`patient-archive-identity-correlation-2026-08-19.md`](../release/patient-archive-identity-correlation-2026-08-19.md)。

## 代码边界

- `packages/adapters/src/zhongyang-patients.ts` 负责按旧端真实契约查询档案，并把 `patId` 收窄为 `his-patient` 引用。
- `packages/domain/src/patients.ts` 用 `PatientProviderReferenceKind` 明确目录引用和临床引用的用途。
- `packages/persistence/migrations/0012_patient_provider_references.sql` 新增独立映射表，并使用 owner-scoped 复合主键和外键。
- 预约历史、报告、门诊费用服务必须显式传入 `referenceKind: "his-patient"`；不得恢复为默认目录映射。
- provider 患者号只在一次服务端调用栈中交给 adapter，不进入日志、API contract 或小程序缓存。
- 患者目录的 `unionId`、`thirdPatientId`、姓名、卡号和档案 `patId` 在 adapter 边界统一拒绝控制字符、空白和超长值；不能依赖 URL 编码、数据库转义或页面渲染来补救。发现控制字符时拒绝整次快照，不静默删除字符或继续写入映射。
- Provider 返回数字形式的引用只在 `Number.isSafeInteger` 范围内兼容；档案 `patId` 常见为 19 位字符串，若错误地作为超出 JavaScript 安全整数范围的 JSON number 返回，adapter 必须拒绝整次同步，因为解析阶段已经无法恢复原始引用，不能把精度损失后的值写入 `his-patient` 映射。
- Provider 目录数组中的每一项还必须是普通对象；`null`、字符串、嵌套数组等非法元素统一归类为 `provider-response-invalid`，并在任何 `patInfosFind` 查询前拒绝整批。不能让原生 `TypeError` 冒充内部 500，也不能只处理前面的有效患者。
- 一次目录响应必须先完成全部患者的目录字段预校验，再开始任何 `patInfosFind` 请求；预校验失败时不得让部分患者先进入档案查询，最后才把整批标记为失败。字段全部通过后才允许并行查询档案，但最终仍需整批通过 HIS 引用唯一性校验。
- 首页恢复已有微信会话、重新登录或直接打开就诊人选择页时，会主动触发一次患者目录同步，兼容迁移前已经落库但尚未拥有 `his-patient` 引用的旧患者记录。
- 同一账号连续发起同步时，快照时间在 provider 请求发出前记录；旧请求晚返回也不能覆盖更新的 `his-patient` 映射，
  或把更新快照已经停用的患者重新激活。
- 完整目录快照中若当前患者没有返回 `his-patient`，持久化事务会删除该患者旧的临床映射；
  目录 `thirdPatientId` 仍保留为目录引用。观察时间更早的旧快照不能执行这次清理。
- 公共患者响应同时返回 `clinicalAccess`：只有存在当前 `his-patient` 映射的记录才是 `ready`；
  迁移遗留的 `legacy-record` 或缺少临床映射的医院目录记录仍可展示，但必须标记为
  `unavailable`，不能在小程序中被选为预约、报告或门诊费用查询上下文。首次没有历史选择时，
  客户端只能默认第一位 `ready` 患者；已有选择变为 `unavailable` 时不得静默切换到另一位患者。

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
- `patient-archive` 缺少 `patId` 目前也按响应非法处理；在 Provider 没有提供可验证的“明确无档案”业务状态前，不能把它降级成 `clinicalAccess=unavailable`，否则临时故障可能被误写成患者解绑。
- 临床业务没有映射：在调用 provider 前返回对应的患者不可用错误；不得发送目录 `thirdPatientId`。
- 客户端收到 `clinicalAccess=unavailable` 时只能展示低敏原因和刷新/重新选择入口；不得把
  `directory` 引用当作临床引用，也不得因为列表中存在记录就把选择页开放为可返回状态。
- 档案 ID 发生变化：下一次同步按同一内部患者更新 `hp_patient_provider_references`，不更换平台 `patientId`。
- 如果未来 Provider contract 能明确区分“档案不存在”与权限/临时/响应异常，adapter 才可以把该患者
  作为缺少 `his-patient` 引用的完整快照事实提交；随后清除旧临床映射，并让预约、报告、门诊费用在
  provider 请求前 fail-closed，不能继续沿用上一次同步的 `patId`。当前众阳 adapter 对缺少 `patId`
  或档案响应异常统一拒绝整次同步，不能把通用错误猜成患者解绑。
- 空患者目录且当前 owner 已有医院目录患者：在 Provider contract 明确空目录语义前，服务层返回
  `patient-directory-snapshot-unsafe`，保留旧患者和旧临床映射，不执行批量失效；首次同步的真实空目录仍可提交。
- 新 migration 失败：保持 `PERSISTENCE_SCHEMA_READY=false`，不得让新 API 使用半成品仓储；旧 Python 服务不受影响。

## 验收证据

- adapter 单元测试验证档案查询 URL、`type=3`、卡号+姓名参数和 `patId` 白名单映射。
- persistence 测试验证用途专用查询、owner 隔离和旧目录映射不被覆盖。
- API 测试验证预约/报告使用 `his-patient`，且外部 ID 不出现在公共响应。
- 线上验收需要保存：release commit、migration 状态、内部 `patientId`、traceId、provider request id、API 响应摘要和真机页面证据。
