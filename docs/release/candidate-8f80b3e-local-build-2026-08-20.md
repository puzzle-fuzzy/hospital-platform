# 小程序候选 `8f80b3e` 本地构建记录（2026-08-20）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `8f80b3e` |
| 小程序构建来源 | `8f80b3e30385fe3655f871673d8616cd2d31faaa` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 本候选变更

患者同步现在先通过只读 `/me` 建立当前 owner 会话证明，再进入
`POST /patients/sync` 的进程级 single-flight。这样在本地 token 缺失或过期时，
安全的 GET 会话恢复不会被同步协调器误判为旧代际；同步命令仍使用服务端 owner、幂等键和持久化租约保护。
详细边界见 [`miniprogram-patient-sync-session-proof-2026-08-20.md`](miniprogram-patient-sync-session-proof-2026-08-20.md)。

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- `pnpm --filter @hospital/miniprogram test`：169 项通过，0 项失败，1331 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- 全仓 `pnpm check`：9/9 任务通过；架构门禁 67 条、文档审计 270 个文档、工具测试 31 项通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0。
- `dist/build-info.json.sourceRevision` 为上表完整来源。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，
因此扫码登录不会弹出头像/昵称授权框。真机验收必须在新的 `miniprogram` 开发者工具窗口中重新编译并生成二维码；
旧 `3a89312` 二维码、旧工具增量缓存和模拟器画面不能作为本候选证据。

本记录只证明本地代码和运行包门禁通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入
已经在真机完成。每个业务域仍需页面结果、客户端 `requestId/traceId` 和服务端低敏日志三层同链证据。
