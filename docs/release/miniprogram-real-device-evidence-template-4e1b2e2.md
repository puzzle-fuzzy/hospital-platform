# 小程序当前候选真机三层证据记录模板（`4e1b2e2`）

> 当前服务端 release 为 `7181e99e3a352244102f5591279528b3b66332c9`；小程序完整运行包来源为
> `4e1b2e224964797c103eba832323ee7074c7ad2b`。空白模板不代表真机或业务验收通过。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `7181e99e3a352244102f5591279528b3b66332c9` |
| 小程序提交 | `4e1b2e2` |
| 完整运行包来源 | `4e1b2e224964797c103eba832323ee7074c7ad2b` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 当前二维码状态 | 已在正确项目中重新生成，界面显示有效至 `2026-08-22 06:15 CST`；尚未扫码 |

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

### `profileReadonlyWrite` 的双请求证据格式

普通资料不是一次请求即可通过的域，必须分别记录：

- `client.read`：`GET /api/v2/me/profile`，带该次请求的 `requestId` 和 HTTP 状态；
- `client.update`：`PUT /api/v2/me/profile`，带另一条请求的 `requestId` 和 HTTP 状态；
- `server.read`、`server.update`：各自来自 `p0-log-aggregate` 的低敏关联摘要，分别包含
  `auditPassed`、`correlationFingerprint`、`requested`、`succeeded`、`http2xx` 和 `failed`。

只有读取和更新两条链都满足 `requested >= 1`、`succeeded >= 1`、`http2xx >= 1`、`failed = 0`，
并且两条客户端请求均为 2xx，`profileReadonlyWrite` 才能标记为 `passed`。读取成功不能替代更新成功，
409 冲突也不能记录为更新成功。

支付、医保、预约写入、患者绑定、报告详情 Provider 和 HIS 回写继续使用各自 contract
与真实授权门禁，不在本模板中标记完成。
