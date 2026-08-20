# 小程序候选 `7f157d4` 本地构建记录（2026-08-20）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `7f157d4` |
| 小程序构建来源 | `7f157d4cca02fa857612daec0b6aa56e328e0083` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 本候选变更

本候选修正患者关系语义：Provider 明确返回 `other/其他` 才映射为 `other`；关系缺失或暂时无法识别时映射为
`unknown`，小程序选择页分别显示“其他”和“关系未提供”。这避免把资料缺失误报成真实家庭关系分类。

本候选没有修改 Provider 请求参数、真实支付/医保、患者新增绑定、旧 Python 服务、线上配置或数据库表结构；`unknown`
属于既有有限字符串字段的合法值，无需 schema migration。运行包仍禁止包含测试脚本。

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- 小程序完整测试：169 项通过，0 项失败，1338 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `pnpm check`：通过，架构 67 条、工具测试 31 项、9 个 workspace 类型检查/测试/构建均通过；文档审计 285 篇无断链。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0。
- `dist/build-info.json.sourceRevision`：`7f157d4cca02fa857612daec0b6aa56e328e0083`。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，因此扫码登录不会
弹出头像/昵称授权框。真机验收前必须关闭旧调试会话、普通编译当前 `dist/`，并重新生成二维码；扫码前核对上表完整
`sourceRevision`。

本记录只证明本地代码和运行包门禁通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入
已经在真机完成。每个业务域仍需页面结果、客户端 `requestId/traceId` 和服务端低敏日志三层同链证据。支付、医保、报告 Provider、
患者绑定和 HIS 写回继续保持关闭。
