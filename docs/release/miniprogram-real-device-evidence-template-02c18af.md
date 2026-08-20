# 小程序历史候选真机三层证据记录模板（`02c18af`）

> 历史模板：当前候选已推进到 [`miniprogram-real-device-evidence-template-6ce1272.md`](miniprogram-real-device-evidence-template-6ce1272.md)，本文件不再用于当前真机记录。

> 用途：记录当前候选真实微信设备上的页面、客户端 HTTP 和服务端低敏日志三层证据。
> 本文件是空白记录模板，不代表任何业务已验收；没有实际页面操作和同一时间窗口的请求链，
> 不得把表格填写成“通过”。
>
> 当前服务端 release：`5a31427`
> 当前小程序候选：`02c18af`
> 运行包来源：以 `apps/miniprogram/dist/build-info.json.sourceRevision` 现场读取的完整 40 位 SHA 为准，必须以 `02c18af` 开头
> 运行根目录：`apps/miniprogram/dist/`
> 旧 Python 服务：`8001`，本次验收不得修改或重启

## 1. 填写规则

1. 扫码前关闭旧真机调试会话，普通编译当前 `dist/`，并核对完整 `sourceRevision`。
2. 每一条业务记录必须来自同一候选、同一微信会话、同一患者和相邻时间窗口。
3. 客户端只记录脱敏路径、HTTP 状态码、`traceId/requestId`；服务端只记录 P0 聚合输出中的事件计数、关联链指纹和状态计数。
4. 禁止写入微信 code、accessToken、session_key、openid、AppSecret、姓名、完整卡号、身份证号、手机号、HIS `patId`、Provider 原文或支付凭证。
5. 页面结果必须附截图或开发者工具中可复核的页面描述；只有日志没有页面，不算真机页面证据。
6. 任一患者归属、状态、金额、日期、HTTP 状态或事件链不一致，立即停止当前业务域并标记为 `blocked`，不能用重试后的另一条链覆盖。

## 2. 扫码前固定事实

| 项目 | 实际记录 |
| --- | --- |
| 验收日期/时区 | `YYYY-MM-DD HH:mm（Asia/Shanghai）` |
| 设备/系统 | `iOS/Android + 版本` |
| 微信基础库 | `版本` |
| 开发者工具真机窗口 | `新窗口/窗口标识` |
| `dist/build-info.json.sourceRevision` | 必须以现场读取的完整 40 位 SHA 为准，且以 `02c18af` 开头 |
| 扫码时间 | `YYYY-MM-DD HH:mm:ss` |
| 是否使用历史二维码 | 必须为“否” |

## 3. 业务操作记录

状态只能填写：`passed`、`failed`、`blocked`、`not-run`。`passed` 必须同时具备页面、HTTP 和服务端三层证据。

| 业务域 | 页面实际操作 | 页面证据位置/描述 | 客户端路径与状态 | `traceId/requestId` | 服务端事件链摘要 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 微信登录 | 扫码后进入首页并完成登录 | `待填写` | `待填写` | `待填写` | `auth requested → succeeded → HTTP 2xx` | `not-run` |
| 患者目录同步 | 点击刷新就诊人，等待同步结束 | `待填写` | `待填写` | `待填写` | `patient directory requested → synced → HTTP 2xx` | `not-run` |
| 患者显式切换 | 选择另一位就诊人，返回首页 | `待填写` | `待填写` | `待填写` | 目录读取/同步同链，不能出现旧患者提交 | `not-run` |
| 我的挂号 | 进入“我的挂号”，核对患者卡片和记录 | `待填写` | `待填写` | `待填写` | `appointment.records requested → synced → HTTP 2xx` | `not-run` |
| 爽约记录 | 从“我的”进入爽约记录 | `待填写` | `待填写` | `待填写` | 预约历史链存在，页面仅展示 `missed` | `not-run` |
| 门诊费用-待缴 | 进入门诊费用并选择待缴 | `待填写` | `待填写` | `待填写` | `outpatient payment requested → loaded → HTTP 2xx` | `not-run` |
| 门诊费用-已缴 | 切换已缴标签 | `待填写` | `待填写` | `待填写` | 独立查询链成功，金额只核对展示模型 | `not-run` |
| 普通资料读取 | 进入个人资料页 | `待填写` | `待填写` | `待填写` | `profile requested → loaded → HTTP 2xx` | `not-run` |
| 普通资料更新 | 修改允许字段并保存 | `待填写` | `待填写` | `待填写` | `profile.update requested → updated` 或明确 `409` | `not-run` |

## 4. 运行包命令

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
Get-Content apps/miniprogram/dist/build-info.json -Encoding utf8
```

生产日志仍只能先由当前 release 的 P0 聚合器生成安全 JSON，再交给业务证据审计；不要把原始 journald、请求头、患者标识或 Provider 原文写入本文件。

## 5. 关闭和复核

- 当前候选来源不一致：立即停止，不打开二维码。
- 页面显示上一位患者、患者切换后请求仍使用旧上下文、或服务端关联链与客户端 trace 对不上：该域标记为 `blocked`。
- 只有 `requested`、业务成功事件、同链 HTTP `2xx`、`parseErrors=0` 且无 systemd 警告，才允许进入页面结果复核。
- 任何空列表都必须同时确认 Provider 查询成功；不能把 `401`、`403`、`503`、依赖未配置或映射缺失写成“没有数据”。
- 本模板不适用于报告 Provider、患者绑定、二维码、微信支付、医保结算、退款或 HIS 写回；这些能力继续遵守各自 contract gate。
