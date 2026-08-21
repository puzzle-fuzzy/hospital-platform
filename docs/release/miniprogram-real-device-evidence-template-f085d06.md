# 小程序当前候选真机三层证据记录模板（`f085d06`）

> 当前服务端 release 为 `5a31427`；小程序完整运行包来源为 `f085d06d8e4b9695274f93b5a6b56f2af3faac91`。空白模板不代表真机或业务验收通过。

## 候选边界

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序提交 | `f085d06` |
| 完整运行包来源 | `f085d06d8e4b9695274f93b5a6b56f2af3faac91` |
| 运行包目录 | `apps/miniprogram/dist/` |

六个 P0 业务域必须严格记录 `auth`、`patientDirectory`、`patientSelection`、`appointmentRecords`、`missedAppointments`、`outpatientPayment`。审计工具要求 `domains` 恰好覆盖这六项，不能把普通资料域追加到同一个 JSON，否则会被拒绝。
每个 P0 域只能填写 `pending`、`passed` 或 `failed`；`passed` 必须同时具备页面截图、客户端无查询参数的 `/api/v2/` 请求、UUID requestId/traceId、HTTP 状态和服务端低敏同链统计。

普通资料的 `GET`、首次 `PUT` 和旧版本 `409` 使用 [`user-profile-readonly-device-acceptance-2026-08-18.md`](user-profile-readonly-device-acceptance-2026-08-18.md) 单独记录；它们不属于当前六域 P0 JSON，避免把普通资料写入证据误算成患者/费用业务已完成。

请使用工具审计脱敏清单：

```powershell
pnpm device:evidence:audit -- --file .\path\to\redacted-device-evidence.json
```

工具拒绝 token、Bearer、身份证、完整卡号、Provider 患者号、原始报文和敏感查询参数，并只输出安全摘要。退出码 `0` 才表示全部域通过；`1` 表示仍有 pending/failed，`2` 表示格式或脱敏门禁失败。
