# 小程序候选 `3a6bf3e` 本地构建记录（2026-08-21）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `3a6bf3e` |
| 小程序构建来源 | `3a6bf3ea3d2b8944e05ffcad254a37afdbca2aab` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 本候选变更

普通资料页增加页面实例级 `onShow` 生命周期门禁：首次展示不重复 `onLoad` 已发起的
读取；页面重新可见时重新经过当前 Bearer/session 校验并读取资料，避免页面栈复用、
热重载或账号切换后继续显示上一轮账号的普通资料。资料失效时仍清理页面状态并回到
登录入口，临时依赖故障不被误判为换号。

本候选没有修改 Provider 请求参数、支付/医保、患者新增绑定、旧 Python 服务、线上配置、
数据库表结构或众阳自动化获取任务。普通资料仍只允许昵称、性别、年龄和邮箱，版本冲突
继续要求重新读取后再提交。

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- 小程序完整测试：169 项通过，0 项失败，1349 个断言。
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
