---
type: evidence
area: provider-adapter
title: Adapter 接口证据
status: static
---

# Adapter 接口证据

供应商适配器把外部医院/供应商字段转换为平台领域模型。当前可追踪的关键方法和消费方如下：

| 领域动作 | 适配器方法 | 服务层消费方 | 页面/接口 |
| --- | --- | --- | --- |
| 患者同步 | `listByIdentity` | `PatientService.sync` | `POST /patients/sync` |
| 报告列表 | `listReports` | `ReportService.list` | `GET /reports` |
| 检验报告详情 | `getLaboratoryDetail` | `ReportService.detail` | `GET /reports/:reportId` |
| 科室目录 | `listDepartments` | `AppointmentService.listDepartments` | `GET /appointments/departments` |
| 排班目录 | `listSchedules` | `AppointmentService.listSchedules` | `GET /appointments/schedules` |
| 预约记录 | `listRecords` | `AppointmentService.listRecords` | `GET /appointments/records` |
| 门诊费用 | `listRecords` | `OutpatientPaymentService` gateway | `GET /payments/outpatient/records` |

## 证据边界

- 同名 `listRecords` 在预约和门诊费用领域属于不同依赖对象；不能只看方法名判断调用到了哪一个 provider。
- 报告详情引用、患者归属、供应商错误翻译都应在服务层/领域规则中确认，不能仅凭 adapter 方法名判断权限。
- Adapter 方法存在只证明代码 contract 可追踪，不证明当前医院 provider、网络或配置已可用。

源码：[appointments/service.ts](../../../apps/api/src/modules/appointments/service.ts)、[reports/service.ts](../../../apps/api/src/modules/reports/service.ts)、[patients/service.ts](../../../apps/api/src/modules/patients/service.ts)、[outpatient-payments/index.ts](../../../apps/api/src/modules/outpatient-payments/index.ts)。
