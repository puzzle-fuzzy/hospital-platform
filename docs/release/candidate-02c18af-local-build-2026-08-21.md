# 小程序候选 `02c18af` 本地构建记录（2026-08-21）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `02c18af` |
| 小程序构建来源 | `02c18af2e658507a0fa5182368235cf62cd348c7` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 小程序否；服务端已切换 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

> 构建后的 `dist/build-info.json.sourceRevision` 为完整提交号：
> 完整值为 `02c18af2e658507a0fa5182368235cf62cd348c7`，扫码前仍须以本地 `git rev-parse 02c18af^{commit}` 和运行包文件复核。

## 本候选变更

本候选修复首页患者目录读取的并发语义：当旧目录请求已经被新的页面读取或生命周期淘汰时，读取链返回显式的 `superseded`，而不是 `[]`；只有当前请求确实写回页面后才返回 `loaded`。登录恢复和主动登录链仅在 `loaded` 时继续 `onSyncPatients()`，避免把旧请求淘汰误判为成功空目录，制造重复 Provider 请求和同步租约竞争。

本候选没有修改 Provider 请求参数、支付/医保、患者新增绑定、旧 Python 服务、线上配置、数据库表结构或众阳自动化获取任务。

## 构建与门禁

- 小程序测试：169 项通过，0 项失败，1354 个断言。
- TypeScript 类型检查：通过。
- Biome：通过。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0，`single-flight.test.js` 不存在。
- `dist/build-info.json.sourceRevision`：`02c18af2e658507a0fa5182368235cf62cd348c7`。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，不会额外索取头像、昵称等无关资料授权。

本记录只证明本地代码、构建产物和运行包边界通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入已经在真机完成。真机必须重新普通编译、重新生成二维码，并同时保存页面、客户端请求号和服务端低敏日志三层证据；支付、医保、报告 Provider、患者绑定和 HIS 写回继续保持关闭。
