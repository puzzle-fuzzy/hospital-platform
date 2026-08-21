# 小程序当前候选真机三层证据记录模板（`d4d65b7`）

> 当前服务端 release 为 `5a31427`；小程序完整运行包来源为
> `d4d65b735da8630e9b6795d9e105192713297474`。空白模板不代表真机或业务验收通过。

## 候选边界

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序提交 | `d4d65b7` |
| 完整运行包来源 | `d4d65b735da8630e9b6795d9e105192713297474` |
| 运行包目录 | `apps/miniprogram/dist/` |

六个 P0 业务域必须严格记录 `auth`、`patientDirectory`、`patientSelection`、
`appointmentRecords`、`missedAppointments`、`outpatientPayment`。每个域都要同时
具备页面结果、客户端无敏感查询参数的 `/api/v2/` 请求、有限的 `requestId/traceId`
和服务端低敏同链日志。

请使用工具审计脱敏清单：

```powershell
pnpm device:evidence:audit -- --file .\path\to\redacted-device-evidence.json
```

工具会读取当前发布基线，拒绝旧候选、token、Bearer、身份证、完整卡号、Provider
患者号、原始报文和敏感查询参数。退出码 `0` 才表示全部域通过；`1` 表示仍有
pending/failed，`2` 表示格式、候选绑定或脱敏门禁失败。

## 验收记录

| 域 | 状态 | 页面证据 | 客户端 requestId | 服务端 traceId/低敏日志 | 备注 |
| --- | --- | --- | --- | --- | --- |
| auth | pending |  |  |  |  |
| patientDirectory | pending |  |  |  |  |
| patientSelection | pending |  |  |  |  |
| appointmentRecords | pending |  |  |  |  |
| missedAppointments | pending |  |  |  |  |
| outpatientPayment | pending |  |  |  |  |

支付、医保、预约写入、患者绑定、报告详情 Provider 和 HIS 回写不属于本模板的通过项，
必须继续使用各自 contract 和真实授权门禁。
