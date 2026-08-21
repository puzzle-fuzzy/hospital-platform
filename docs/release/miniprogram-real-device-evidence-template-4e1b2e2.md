# 小程序当前候选真机三层证据记录模板（`4e1b2e2`）

> 当前服务端 release 为 `7181e99e3a352244102f5591279528b3b66332c9`；小程序完整运行包来源为
> `4e1b2e224964797c103eba832323ee7074c7ad2b`。空白模板不代表真机或业务验收通过。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `7181e99e3a352244102f5591279528b3b66332c9` |
| 小程序提交 | `4e1b2e2` |
| 完整运行包来源 | `4e1b2e224964797c103eba832323ee7074c7ad2b` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 当前二维码状态 | 已在正确项目中重新生成，界面显示有效至 `2026-08-22 06:36 CST`；尚未观察到手机业务请求 |

## 验收记录

每个域都必须同时具备页面结果、客户端无敏感查询参数的 `/api/v2/` 请求、有限的
`requestId/traceId` 和服务端低敏同链日志。缺少任一层，状态保持 `pending`。

单请求域还必须命中对应的真实入口：`auth` 使用 `POST /api/v2/auth/wechat`，
`patientDirectory` 与 `patientSelection` 使用 `GET /api/v2/patients`，
`patientDirectorySync` 使用 `POST /api/v2/patients/sync`，
`appointmentRecords` 与 `missedAppointments` 使用 `GET /api/v2/appointments/records`，
`outpatientPayment` 使用 `GET /api/v2/payments/outpatient/records`。
证据文档不记录查询参数，但服务端同链摘要仍必须证明该请求属于对应业务域；
不能用 `/me` 或其它 200 响应替代目标接口。

每个服务端摘要还必须填写与 `p0-business-evidence-audit` 一致的
`businessDomain`：患者目录读取为 `patientRead`，患者同步为 `patientSync`，
预约记录为 `appointmentRecords`，门诊费用为 `outpatientPaymentRecords`；
预约目录的科室/排班分别为 `appointmentDepartments`/`appointmentSchedules`，
普通资料读取/更新分别为 `profileRead`/`profileUpdate`。计数相同但 contract 不同，不能互相替代。

双请求域的两条客户端请求必须使用不同的 `requestId/traceId`，两条服务端摘要也必须使用不同的
`correlationFingerprint`。这不是格式要求，而是为了防止把同一条请求或同一条服务端关联链复制到两个栏位，
误报为“读取后更新”或“科室后排班”已经完成。

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

`patientDirectory` 与 `patientDirectorySync` 必须分开记录：前者证明当前 owner 能读取
服务端白名单目录，后者证明当前登录会话确实完成了患者同步及临床映射刷新。目录读取成功
不能替代同步成功；同步失败时，预约、报告和门诊费用等患者范围页面仍必须保持 fail-closed。

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

### `appointmentDirectory` 的双请求证据格式

预约目录必须分别记录两条只读链：

- `client.departments`：`GET /api/v2/appointments/departments`；
- `client.schedules`：`GET /api/v2/appointments/schedules`，日期、科室和医生参数不写入证据文档；
- `server.departments`、`server.schedules`：各自来自低敏日志聚合的同链摘要。

两条客户端请求都必须为 2xx，且两条服务端摘要都必须具备
`requested >= 1`、`succeeded >= 1`、`http2xx >= 1`、`failed = 0`。
科室目录成功不能替代排班成功，排班成功也不能证明科室目录链完整；该域仍然是只读观察，
不代表锁号、预约写入、取消或支付已经开放。
