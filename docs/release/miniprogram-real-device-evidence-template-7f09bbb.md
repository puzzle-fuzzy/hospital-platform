> 历史模板：本文曾用于本地 pending 候选的取证格式。当前线上已发布运行包请使用
> [`miniprogram-real-device-evidence-template-13f597e.md`](miniprogram-real-device-evidence-template-13f597e.md)，
> 最新本地 pending 候选请使用 `candidate-7f7a7a18-miniprogram-runtime-2026-08-25.md` 和对应的 pending 清单。

# 小程序当前候选真机三层证据记录模板（`7f7a7a18`）
> 当前服务端候选：`b42922f4`；小程序来源：`7f7a7a1844f5269c88f814d7d97d805fe4b8aeca`。模板不把运行层 smoke 当作业务验收。

> 服务端与小程序来源有意分层记录：服务端候选尚未部署，小程序候选尚未发布到开发者工具。只有两份来源、页面结果、客户端请求和服务端同链摘要均一致，才可以进入真实验收。

| 项目 | 值 |
| --- | --- |
| 服务端候选 | `b42922f4`（未部署） |
| 小程序客户端 | `7f7a7a18`（pending） |
| 小程序构建来源 | `7f7a7a1844f5269c88f814d7d97d805fe4b8aeca` |
| 微信开发者工具项目 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 运行根目录 | `dist/` |
| 真机二维码生成时间 | 待填写 |
| 手机页面结果 | 待填写 |
| 客户端 requestId/traceId | 待填写 |
| 服务端低敏 Pino 事件 | 待填写 |
| Provider requestId | 待填写或不适用 |

## 记录要求

页面、客户端 HTTP 和服务端日志必须来自同一次扫码会话，并且使用本表声明的两份来源指纹。空白模板、二维码、
模拟器或健康检查不足以完成真实业务验收。不得记录 openid、session_key、完整身份证、完整卡号、token、支付密钥
或 Provider 原始报文。

### 业务场景覆盖要求

通过项还必须填写对应域的完整 `scenarios` 固定场景集合，不能只记录一次成功的 200 响应。当前九个域的场景名称和校验规则以 [`device-evidence-audit.mjs`](../../tools/device-evidence-audit.mjs) 为准；pending 清单使用 `requiredScenarios` 保留未采集待办。

例如，患者目录必须分别覆盖非空、空结果、会话失效和暂时故障；患者切换必须覆盖初始选择、显式切换和旧选择失效。场景名称只用于证明测试范围，不得填写患者号、卡号、token、Provider 原文等敏感数据。
