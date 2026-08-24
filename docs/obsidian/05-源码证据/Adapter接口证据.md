---
type: evidence
area: provider-adapter
title: Adapter 接口证据
status: static
---

# Adapter 接口证据

供应商适配器把外部医院/供应商字段转换为平台领域模型。当前可追踪的关键方法包括：

| 领域动作 | 适配器方法 | 被谁使用 |
| --- | --- | --- |
| 患者同步 | `listByIdentity` | `PatientService.sync` |
| 报告列表 | `listReports` | `ReportService.list` |
| 检验报告详情 | `getLaboratoryDetail` | `ReportService.detail` |
| 预约目录 | 科室/排班目录方法 | `AppointmentService` |
| 门诊费用 | 费用记录方法 | `OutpatientPaymentService` |

报告详情引用、患者归属、供应商错误翻译都应在服务层/领域规则中确认，不能仅凭 adapter 方法名判断权限。

