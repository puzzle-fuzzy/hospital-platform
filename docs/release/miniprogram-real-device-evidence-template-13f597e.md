> **当前候选同步（2026-08-28）**：服务端 release `5738a71e0bcddaa8849106754baf5b296427bed7`；本地小程序 live/pending 运行包 sourceRevision `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`；历史段落只作追溯。

> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`（`1bc5bf6`），共 38 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

> 当前配套小程序运行包来源（2026-08-28）：`1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`（`1bc5bf6`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

# 当前线上小程序真机三层证据模板（当前基线 `1bc5bf6`）
> 当前线上服务端 release（2026-08-27）：`5738a71e0bcddaa8849106754baf5b296427bed7`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前小程序配套运行包来源（2026-08-28）：`1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`（`1bc5bf6`）；当前无真机/开发者工具会话，九个真机证据域仍为 `pending`。
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。

> 本模板只对应当前线上已发布的小程序运行包，不适用于本地 pending 候选。
> 历史模板的线上配套服务端 release 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，
> 小程序来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）；
> 当前验收必须使用上方 `5738a71e` / `1bc5bf6` 基线。
> 本模板是记录格式，不代表任何业务域已经完成真实验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |
| 小程序客户端 | `1bc5bf6` |
| 小程序构建来源 | `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916` |
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
> 当前统一发布基线补充（2026-08-28）：服务端 release 为 `5738a71e0bcddaa8849106754baf5b296427bed7`；小程序本地 live 运行包来源为 `1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916`，共 38 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。


> 当前发布基线补充（2026-08-27）：服务端线上 release 为 5738a71e0bcddaa8849106754baf5b296427bed7；本地 live 小程序构建来源仍为 1bc5bf6f7cc4d38fad29fbf7e8aca3f65c46b916。本行只同步当前运行层指纹，文档中的历史发布记录仍保留用于追溯。
