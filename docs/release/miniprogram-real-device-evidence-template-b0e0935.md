# 小程序当前候选真机三层证据记录模板（`b0e0935`）

> 当前服务端 release 为 `2a2acd9bcc89c35988b75fc03304dbd48078c9d5`；小程序完整运行包来源为
> `b0e093565493285e07fe549879f8b87eda649cc7`。空白模板不代表真机或业务验收通过。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 小程序客户端 | `b0e0935` |
| 小程序构建来源 | `b0e093565493285e07fe549879f8b87eda649cc7` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 当前二维码状态 | 待从当前候选重新普通编译并生成；未取得当前 release 的业务请求证据 |

## 验收记录

每个域都必须同时具备页面结果、客户端无敏感查询参数的 `/api/v2/` 请求、有限的
`requestId/traceId` 和服务端低敏同链日志。缺少任一层，状态保持 `pending`。

单请求域还必须命中对应的真实入口：`auth` 使用 `POST /api/v2/auth/wechat`，
`patientDirectory` 与 `patientSelection` 使用 `GET /api/v2/patients`，
`patientDirectorySync` 使用 `POST /api/v2/patients/sync`，
`appointmentRecords` 与 `missedAppointments` 使用 `GET /api/v2/appointments/records`，
`outpatientPayment` 使用 `GET /api/v2/payments/outpatient/records`。
证据文档不记录查询参数；服务端摘要仍必须证明请求属于对应业务域，不能用 `/me` 或其它 200 响应替代目标接口。

每个服务端摘要还必须填写与 `p0-business-evidence-audit` 一致的 `businessDomain`：患者目录为 `patientRead`，
患者同步为 `patientSync`，预约记录为 `appointmentRecords`，门诊费用为 `outpatientPaymentRecords`。

| 域 | 状态 | 页面证据 | 客户端 requestId | 服务端 traceId/低敏日志 | 备注 |
| --- | --- | --- | --- | --- | --- |
| auth | pending |  |  |  |  |
| patientDirectory | pending |  |  |  |  |
| patientDirectorySync | pending |  |  |  |  |
| patientSelection | pending |  |  |  |  |
| appointmentDirectory | pending |  |  |  |  |
| appointmentRecords | pending |  |  |  |  |
| missedAppointments | pending |  |  |  |  |
| outpatientPayment | pending |  |  |  |  |
| profileReadonlyWrite | pending |  |  |  |  |

双请求域的客户端 requestId/traceId 和服务端 `correlationFingerprint` 必须分别不同；计数相同不能证明是两条业务链。
支付、医保、预约写入、患者绑定、报告详情 Provider 和 HIS 回写不在本模板中标记完成。

