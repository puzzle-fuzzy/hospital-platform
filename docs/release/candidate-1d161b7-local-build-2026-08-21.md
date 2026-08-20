# 小程序历史候选 `1d161b7` 本地构建记录（2026-08-21）

> 历史记录：当前真机入口已推进到 [`candidate-6ce1272-local-build-2026-08-21.md`](candidate-6ce1272-local-build-2026-08-21.md)，本文件不得继续用于生成二维码或真机验收。

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `1d161b7` |
| 小程序构建来源 | `1d161b701384ad8073ed907fe14f611ab3166fcd` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 小程序否；服务端已切换 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

> 本候选的业务 TypeScript 代码沿用 `02c18af` 已验证内容；`1d161b7` 仅补充根目录小程序运行包验证命令和维护文档。
> 由于根目录 `package.json` 属于运行输入，provenance 必须记录完整的最新提交，不能继续使用旧 `02c18af` 运行包指纹。

## 本候选变更

根目录新增 `pnpm runtime:verify` 转发命令，统一执行 `@hospital/miniprogram` 的运行包验证；主 README 补充
真机调试前的构建、验证和 `single-flight.test.js` ENOENT 恢复顺序。没有修改业务路由、Provider 请求、支付/医保、
患者新增绑定、旧 Python 服务、线上配置、数据库表结构或众阳自动化获取任务。

## 构建与门禁

- 小程序测试：169 项通过，0 项失败，1354 个断言。
- TypeScript 类型检查：通过。
- Biome：通过。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm runtime:verify`：通过，根目录转发命令可用。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0，`single-flight.test.js` 不存在。
- `dist/build-info.json.sourceRevision`：`1d161b701384ad8073ed907fe14f611ab3166fcd`。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，不会额外索取头像、昵称等无关资料授权。

本记录只证明本地代码、构建产物和运行包边界通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入已经在真机完成。
真机必须重新普通编译、重新生成二维码，并同时保存页面、客户端请求号和服务端低敏日志三层证据；支付、医保、报告 Provider、患者绑定和 HIS 写回继续保持关闭。
