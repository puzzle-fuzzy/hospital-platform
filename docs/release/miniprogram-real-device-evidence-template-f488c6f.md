# 小程序当前候选真机三层证据记录模板（`f488c6f`）

> 当前服务端 release 为 `c8eef370c82e358205ee032af41ba2b23576af06`；小程序完整运行包来源为
> `f488c6f3270514af10b19fdf3c45a47519e1736b`。空白模板不代表真机或业务验收通过。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `c8eef370c82e358205ee032af41ba2b23576af06` |
| 小程序提交 | `f488c6f3` |
| 完整运行包来源 | `f488c6f3270514af10b19fdf3c45a47519e1736b` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 当前二维码状态 | 待在正确项目中普通编译后重新生成 |

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
| profileReadonlyWrite | pending |  |  |  |  |

支付、医保、预约写入、患者绑定、报告详情 Provider 和 HIS 回写继续使用各自 contract
与真实授权门禁，不在本模板中标记完成。
