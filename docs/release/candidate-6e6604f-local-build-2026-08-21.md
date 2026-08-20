# 小程序候选 `6e6604f` 本地构建记录（2026-08-21）

> 历史候选记录：当前真机验收入口已推进到 [`candidate-1b9b4b0-local-build-2026-08-21.md`](candidate-1b9b4b0-local-build-2026-08-21.md)，本文件仅用于追溯，不能继续生成二维码或作为当前 `dist/` 来源。

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `6e6604f` |
| 小程序构建来源 | `6e6604f8089e45ceeaaf4bcbbd57065174a59a31` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 小程序否；服务端已切换，详见 [`5a31427-production-acceptance-2026-08-21.md`](5a31427-production-acceptance-2026-08-21.md) |
| 旧服务 | Python `8001`，本次未修改、未重启 |

服务端 `5a31427` 已完成新 API 生产切换，详见 [`5a31427-production-acceptance-2026-08-21.md`](5a31427-production-acceptance-2026-08-21.md)。

## 本候选变更

患者选择页在选择患者后进入短暂的延迟返回窗口。该窗口内，刷新按钮、下拉刷新和
方法层入口都拒绝再次启动目录同步，避免“选择患者”和“刷新目录”两个命令并发，
也避免即将离开的页面继续创建新的 Provider 同步请求。WXML 负责交互禁用，方法层
继续保留相同门禁，防止未来新增入口绕过视图属性。

普通资料页仍保留页面实例级 `onShow` 生命周期门禁和读写互斥：保存 PUT 或保存成功
后的延迟回跳期间不启动 GET，避免旧读模型覆盖服务端刚返回的 canonical `version`。

本候选没有修改 Provider 请求参数、支付/医保、患者新增绑定、旧 Python 服务、线上配置、
数据库表结构或众阳自动化获取任务。普通资料仍只允许昵称、性别、年龄和邮箱；版本冲突
继续要求重新读取后再提交。

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- 小程序完整测试：169 项通过，0 项失败，1354 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0，`single-flight.test.js` 不存在。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或
`wx.getUserInfo()`，因此扫码登录不会弹出头像/昵称授权框。真机验收前必须关闭旧调试会话、
普通编译当前 `dist/`，重新生成二维码，并核对上表完整 `sourceRevision`。

本记录只证明本地代码、构建产物和运行包边界通过，不证明真实微信登录、患者同步、多患者切换、
预约历史、门诊费用或普通资料写入已经在真机完成。每个业务域仍需页面结果、客户端
`requestId/traceId` 和服务端低敏日志三层同链证据；支付、医保、报告 Provider、患者绑定和
HIS 写回继续保持关闭。
