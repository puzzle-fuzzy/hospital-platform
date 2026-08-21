# 历史小程序候选真机三层证据记录模板（`c08378b`）

> 本模板已被当前候选 `6677671` 替代，不得用于当前真机验收。

> 本文件是空白记录模板，不代表任何业务已验收。每条 `passed` 必须同时具备真机页面、客户端 HTTP 和服务端低敏日志三层证据。
>
> 服务端 release：`5a31427`
> 小程序候选：`c08378b`
> 运行包来源：必须现场核对 `c08378bebed493b6f3094d30d8ad4e27031e7037`
> 运行根目录：`apps/miniprogram/dist/`
> 旧 Python 服务：`8001`，本次验收不得修改或重启

## 1. 填写规则

1. 关闭旧真机调试会话，普通编译当前 `dist/`，现场核对完整 `sourceRevision` 后再生成二维码。
2. 每条业务记录必须来自同一候选、同一微信会话、同一患者和相邻时间窗口。
3. 客户端只记录脱敏路径、HTTP 状态码和 `traceId/requestId`；服务端只记录低敏事件链和状态计数。
4. 禁止写入微信 code、accessToken、session_key、openid、AppSecret、姓名、完整卡号、身份证号、手机号、HIS `patId`、Provider 原文或支付凭证。
5. 页面结果必须附截图或可复核的真机描述；只有日志没有页面，不算真机页面证据。
6. 任一患者归属、状态、金额、日期、HTTP 状态或事件链不一致，立即停止当前业务域，不能用重试后的另一条链覆盖。

## 2. 扫码前事实

| 项目 | 实际记录 |
| --- | --- |
| 验收日期/时区 | `YYYY-MM-DD HH:mm（Asia/Shanghai）` |
| 设备/系统 | `iOS/Android + 版本` |
| 微信基础库 | `版本` |
| 开发者工具真机窗口 | `新窗口/窗口标识` |
| `dist/build-info.json.sourceRevision` | 必须等于 `c08378bebed493b6f3094d30d8ad4e27031e7037` |
| 扫码时间 | `YYYY-MM-DD HH:mm:ss` |
| 是否使用历史二维码 | 必须为“否” |

## 3. 业务操作记录

状态只能填写：`passed`、`failed`、`blocked`、`not-run`。`passed` 必须具备三层证据。

| 业务域 | 页面实际操作 | 页面证据 | 客户端路径/状态 | `traceId/requestId` | 服务端事件链摘要 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 微信登录 | 扫码后进入首页并完成登录 | `待填写` | `待填写` | `待填写` | `auth requested → succeeded → HTTP 2xx` | `not-run` |
| 患者目录同步 | 点击刷新就诊人并等待完成 | `待填写` | `待填写` | `待填写` | `patient directory requested → synced → HTTP 2xx` | `not-run` |
| 患者显式切换 | 选择另一位就诊人并返回首页 | `待填写` | `待填写` | `待填写` | 切换前后不能出现旧患者提交 | `not-run` |
| 我的挂号 | 进入“我的挂号”并核对患者和记录 | `待填写` | `待填写` | `待填写` | `appointment.records requested → succeeded → HTTP 2xx` | `not-run` |
| 爽约记录 | 进入爽约记录并核对 `missed` | `待填写` | `待填写` | `待填写` | 预约历史链存在，页面只展示明确 `missed` | `not-run` |
| 门诊费用-待缴 | 进入门诊费用并选择待缴 | `待填写` | `待填写` | `待填写` | `outpatient payment requested → loaded → HTTP 2xx` | `not-run` |
| 门诊费用-已缴 | 切换已缴标签 | `待填写` | `待填写` | `待填写` | 独立查询链成功，金额只核对展示模型 | `not-run` |
| 普通资料读取 | 进入个人资料页 | `待填写` | `待填写` | `待填写` | `profile requested → loaded → HTTP 2xx` | `not-run` |
| 普通资料更新 | 修改允许字段并保存 | `待填写` | `待填写` | `待填写` | `profile.update requested → updated` 或明确 `409` | `not-run` |

## 4. 运行包命令

```powershell
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify
```

生产日志只能使用当前 release 的低敏聚合结果，不要把原始 journald、请求头、患者标识或 Provider 原文写入本文件。

## 5. 立即停止条件

- `sourceRevision` 不一致、出现 `persistence-temporarily-unavailable`、`protocol-connection-lost` 或 readiness 异常；
- 患者切换后卡片、请求或列表仍属于上一位患者；
- 只有 HTTP 成功而没有业务成功事件，或同链出现失败；
- 页面或日志出现患者号、身份证、token、原始 JSON 或费用敏感字段；
   - 任意入口调起支付、医保授权、退费、预约写入、HIS 写入或报告未配置 Provider 后返回伪成功。
