# 小程序当前候选真机三层证据记录模板（`c86a788`）

> 当前服务端 release 为 `5a31427`；小程序完整运行包来源为 `c86a788c01760fd5a74ac8c2769871025297a4fc`。空白模板不代表真机或业务验收通过。

## 候选边界

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序提交 | `c86a788` |
| 完整运行包来源 | `c86a788c01760fd5a74ac8c2769871025297a4fc` |
| 运行包目录 | `apps/miniprogram/dist/` |

六个 P0 业务域必须严格记录 `auth`、`patientDirectory`、`patientSelection`、`appointmentRecords`、`missedAppointments`、`outpatientPayment`。审计工具要求 `domains` 恰好覆盖这六项，不能把普通资料域追加到同一个 JSON，否则会被拒绝。

每个 P0 域只能填写 `pending`、`passed` 或 `failed`；`passed` 必须同时具备页面截图、客户端无查询参数的 `/api/v2/` 请求、安全有界的 requestId/traceId、HTTP 状态和服务端低敏同链统计。普通资料的 `GET`、首次 `PUT` 和旧版本 `409` 使用专用手册单独记录。

请使用工具审计脱敏清单：

```powershell
pnpm device:evidence:audit -- --file .\path\to\redacted-device-evidence.json
```

命令行入口会读取仓库当前发布基线，再要求证据中的服务端 release、小程序提交和完整 sourceRevision 三者逐项一致；旧二维码即使三层字段格式完整，也不能通过当前候选审计。工具同时拒绝 token、Bearer、身份证、完整卡号、Provider 患者号、原始报文和敏感查询参数，并只输出安全摘要。退出码 `0` 才表示全部域通过；`1` 表示仍有 pending/failed，`2` 表示格式、候选绑定或脱敏门禁失败。
