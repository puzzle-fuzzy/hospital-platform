# 历史小程序候选 `6ce1272` 本地构建记录（2026-08-21）

> 本记录已被当前候选 `6677671` 替代，仅用于追溯历史运行包，不得作为新的真机验收来源。

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `6ce1272` |
| 小程序构建来源 | `6ce12729c3e112a6cb8333c5132c23713d1cb1ec` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 小程序否；服务端已切换 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 本候选变更

本候选收紧普通资料页的会话代际边界：资料 GET 成功后记录当前会话代际，PUT 发出前和成功响应回写前再次校验；账号切换后不发送旧页面快照，清理旧资料并回到登录入口。同步补充了 TypeScript 类型、中文注释、验收门禁和普通资料 contract。

本候选没有修改支付、医保、二维码、患者绑定、预约写入、Provider 自动化、旧 Python 服务、线上配置、数据库或 Redis。

## 构建与门禁

- 小程序测试：169 项通过，0 项失败，1359 个断言。
- TypeScript 类型检查：通过。
- 本次涉及文件的 Biome 格式检查：通过。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0，`single-flight.test.js` 不存在。
- `dist/build-info.json.sourceRevision`：`6ce12729c3e112a6cb8333c5132c23713d1cb1ec`。

## 微信与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，不会额外索取头像、昵称等无关资料授权。

本记录只证明本地代码、构建产物和运行包边界通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入已经在真机完成。真机必须重新普通编译、重新生成二维码，并同时保存页面、客户端请求号和服务端低敏日志三层证据；支付、医保、报告 Provider、患者绑定和 HIS 写回继续保持关闭。
