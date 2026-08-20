# 小程序候选 `1b9b4b0` 本地构建记录（2026-08-21）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `1b9b4b0` |
| 小程序构建来源 | `1b9b4b0d101dfcd5011845f7797c9523676cc987` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 小程序否；服务端已切换，详见 [`5a31427-production-acceptance-2026-08-21.md`](5a31427-production-acceptance-2026-08-21.md) |
| 旧服务 | Python `8001`，本次未修改、未重启 |

服务端 `5a31427` 已完成新 API 生产切换，详见 [`5a31427-production-acceptance-2026-08-21.md`](5a31427-production-acceptance-2026-08-21.md)。

## 本候选变更

本候选在前一小程序候选的运行包边界基础上，修正 API 客户端读取响应
`X-Request-Id` 的大小写处理。HTTP 头名称大小写不敏感，客户端现在会逐项按
小写比较头名称，并只接受字符串值，避免代理或运行时返回混合大小写时丢失服务端
请求关联号、错误回退成客户端请求号，导致真机页面与服务端日志无法对齐。

此前已经完成的患者选择页延迟返回刷新门禁、普通资料页页面栈 `onShow` 和读写互斥、
TypeScript 运行包测试文件隔离仍保留。本候选没有修改 Provider 请求参数、支付/医保、
患者新增绑定、旧 Python 服务、线上配置、数据库表结构或众阳自动化获取任务。

## 构建与门禁

- `pnpm check`：通过；架构、迁移清单、Provider intake、文档链接、发布基线、Biome、lint、类型、测试和构建全部通过。
- 小程序完整测试：169 项通过，0 项失败，1354 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0，`single-flight.test.js` 不存在。
- `dist/build-info.json.sourceRevision`：`1b9b4b0d101dfcd5011845f7797c9523676cc987`。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或
`wx.getUserInfo()`，因此扫码登录不会弹出获取头像、昵称等无关用户资料的授权框。
真机验收前必须关闭旧调试会话、普通编译当前 `dist/`、重新生成二维码，并核对上表
完整 `sourceRevision`。

本记录只证明本地代码、构建产物和运行包边界通过，不证明真实微信登录、患者同步、
多患者切换、预约历史、门诊费用或普通资料写入已经在真机完成。每个业务域仍需页面
结果、客户端 `requestId/traceId` 和服务端低敏日志三层同链证据；支付、医保、报告
Provider、患者绑定和 HIS 写回继续保持关闭。
