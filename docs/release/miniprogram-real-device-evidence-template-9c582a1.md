# 小程序当前候选真机三层证据记录模板（`9c582a1`）

> 当前服务端 release 为 `5a31427`；小程序完整运行包来源为
> `9c582a1c38b3b3cdecf7145c6b126b185fe474c2`。空白模板不代表真机或业务验收通过。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序提交 | `9c582a1` |
| 完整运行包来源 | `9c582a1c38b3b3cdecf7145c6b126b185fe474c2` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 验收记录

每个域都必须同时具备页面结果、客户端无敏感查询参数的 `/api/v2/` 请求、有限的
`requestId/traceId` 和服务端低敏同链日志。缺少任一层，状态保持 `pending`。

| 域 | 状态 | 页面证据 | 客户端 requestId | 服务端 traceId/低敏日志 | 备注 |
| --- | --- | --- | --- | --- | --- |
| auth | pending |  |  |  |  |
| patientDirectory | pending |  |  |  |  |
| patientSelection | pending |  |  |  |  |
| appointmentRecords | pending |  |  |  |  |
| missedAppointments | pending |  |  |  |  |
| outpatientPayment | pending |  |  |  |  |

支付、医保、预约写入、患者绑定、报告详情 Provider 和 HIS 回写继续使用各自 contract
与真实授权门禁，不在本模板中标记完成。
