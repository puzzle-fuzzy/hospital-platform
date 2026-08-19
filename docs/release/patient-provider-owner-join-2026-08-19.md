# 患者临床映射的 Provider 归属联合校验（2026-08-19）

## 发现的问题

预约历史、报告和门诊费用使用 `hp_patient_provider_references.reference_kind = 'his-patient'` 解析临床患者号。此前 MySQL 查询只校验独立映射表的 `provider_name`，没有同时约束患者主表的 `hp_patients.provider_name`。

在正常写入路径中两者会保持一致，但历史迁移、人工修复或异常数据可能产生交叉记录。如果直接使用这种记录，服务端可能把一个属于其它 Provider 的患者主表与众阳 HIS `patId` 拼成有效调用，绕过了患者目录的 Provider 归属边界。

## 本次修正

- `packages/persistence/src/mysql-repositories.ts`：临床映射查询同时要求主表和映射表的 Provider 一致，并继续要求患者目录 active。
- `packages/persistence/src/mysql-repositories.test.ts`：新增 SQL 联合条件和双 Provider 参数回归断言。
- 代码注释明确说明该条件为什么必须在仓储层完成，避免上层业务重复或遗漏。

## 边界与验证

- 这是仓储归属校验，不新增 Provider 字段、不改变旧 Python 服务、不调用 Provider。
- 只读业务在没有一致的 owner/provider/active 映射时继续 fail-closed，不降级为空列表。
- 本次修正已完成全仓门禁并随线上 `398be8e` 部署；生产切换和回滚边界见 [`398be8e-production-acceptance-2026-08-19.md`](398be8e-production-acceptance-2026-08-19.md)。
