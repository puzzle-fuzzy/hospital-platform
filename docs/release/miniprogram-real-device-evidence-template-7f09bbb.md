> 当前候选刷新（2026-08-22）：服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序运行包来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`（提交 `171a874`）。本次主动登录 owner 校验修正已进入最新本地候选，真实真机证据仍待。

# 小程序当前候选真机三层证据记录模板（`171a874`）
> 当前服务端发布基线（2026-08-22 18:55 CST）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序来源为 `171a8743185fb4ecc1696851662659c1a0ee7ebf`。模板不把运行层 smoke 当作业务验收。

> 当前服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序完整运行包来源为
> `171a8743185fb4ecc1696851662659c1a0ee7ebf`。空白模板不代表真机或业务验收通过。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` |
| 小程序客户端 | `171a874` |
| 小程序构建来源 | `171a8743185fb4ecc1696851662659c1a0ee7ebf` |
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
