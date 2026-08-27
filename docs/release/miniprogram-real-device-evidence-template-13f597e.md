> 当前配套小程序运行包来源（2026-08-27）：`34f0fd21aac33214e991de561d37dfd7071013bf`（`34f0fd21`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

# 当前线上小程序真机三层证据模板（`13f597e`）
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。
> 当前线上服务端 release（2026-08-27）：`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前小程序配套运行包来源（2026-08-27）：`34f0fd21aac33214e991de561d37dfd7071013bf`（`34f0fd21`）；本文中更早候选和真机窗口仅作历史追溯，当前无真机/开发者工具会话。

> 本模板只对应当前线上已发布的小程序运行包，不适用于本地 pending 候选。
> 当前线上配套服务端 release 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，
> 小程序来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。
> 本模板是记录格式，不代表任何业务域已经完成真实验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 小程序客户端 | `13f597e` |
| 小程序构建来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 微信开发者工具项目 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 运行根目录 | `dist/` |
| 真机二维码生成时间 | 待填写 |
| 手机页面结果 | 待填写 |
| 客户端 requestId/traceId | 待填写 |
| 服务端低敏 Pino 事件 | 待填写 |
| Provider requestId | 待填写或不适用 |

## 记录要求

页面、客户端 HTTP 和服务端日志必须来自同一次扫码会话，并且使用本表声明的两份来源指纹。
空白模板、二维码、模拟器或健康检查不足以完成真实业务验收。不得记录 openid、session_key、
完整身份证、完整卡号、token、支付密钥或 Provider 原始报文。

业务域的成功、空结果、未授权、依赖故障、患者切换和版本冲突等场景，以
[`device-evidence-audit.mjs`](../../tools/device-evidence-audit.mjs) 的固定场景集合为准。
只有页面结果、客户端 requestId、服务端同链事件和 Provider 低敏 requestId 同时一致，才能将域标记为
`passed`；否则保持 `pending` 或 `failed`。

## 与 pending 候选的边界

本地最新源码候选 `7f7a7a18` 使用独立的
[`candidate-7f7a7a18-miniprogram-runtime-2026-08-25.md`](candidate-7f7a7a18-miniprogram-runtime-2026-08-25.md)
和 [`device-evidence-7f7a7a1-pending.json`](device-evidence-7f7a7a1-pending.json)。
在 pending 候选完成构建发布、服务端配套发布和来源一致性审计前，不能把其页面或 requestId 填入本模板。
> 当前统一发布基线补充（2026-08-27）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `34f0fd21aac33214e991de561d37dfd7071013bf`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
