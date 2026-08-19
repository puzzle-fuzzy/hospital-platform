# 患者目录平台 ID 事务边界（2026-08-19）

## 目的

患者目录同步时，Provider 返回的 `providerPatientId` 经过目录 adapter 和领域层校验后，服务端还会为每条患者记录生成平台内部 `patientId`。这个 ID 是小程序列表 key，也是预约、报告和门诊费用通过 owner-scoped 上下文引用就诊人的内部标识。

本次补齐的是服务端生成 ID 的事务前边界，不是新增 Provider 字段，也不是开放新的患者绑定能力。

## 固定规则

- 每个生成的 `patientId` 必须通过平台统一的 bounded opaque identifier 校验。
- 同一份患者快照内的 `patientId` 必须唯一。
- 任一 ID 非法或重复时，必须在 `replaceDirectorySnapshot` 调用前整批失败。
- 具体 ID 值不写入失败日志；只记录 `generatedIdViolation`，取值为 `patient-id-invalid` 或 `patient-id-duplicate`。
- 该错误属于平台内部身份/持久化边界，公共响应固定为 `500 persistence-invalid`，不能伪装成 Provider `502`。

## 为什么必须在事务前校验

快照事务返回后的读模型校验只能证明“写入后读出来的结果不适合返回”，不能撤销已经提交的错误身份。如果重复 ID 先落库，患者选择页可能出现重复 key，下游预约、报告或费用查询也可能把两个患者映射到同一个平台引用。事务前校验可以保证无效批次不会调用持久化快照写入。

## 证据

- `PatientService.sync` 在生成快照输入时执行形状和批次唯一性校验。
- API 单元回归验证重复 ID 不调用快照仓储，并记录固定低敏 `generatedIdViolation`。
- Elysia 错误契约回归验证该内部错误返回 `500 persistence-invalid`。
- 本次没有修改旧 Python 服务、线上服务、数据库、Redis 或 Provider contract；真实微信设备和线上 Provider/HIS 验收仍未完成。
