# 小程序候选 `457d9ae` 本地构建记录（2026-08-20）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `457d9ae` |
| 小程序构建来源 | `457d9aee567bc77c33279a9b61db921e3011f1c1` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 本候选变更

本候选只完善患者选择页 `onSyncPatients` 的中文并发边界注释，没有改变 TypeScript
运行逻辑、接口、Provider、数据库、Redis 或页面视觉行为。由于小程序源码发生了
提交变化，仍重新构建运行包并更新来源指纹，避免真机继续使用旧候选的二维码。

患者同步的业务不变量保持不变：页面级 single-flight 只共享在途 Promise，不重放业务
命令；每个页面调用方仍必须使用自己的 `loadToken/syncToken` 验证回写资格；WXML
事件对象不能直接作为内部数字加载 token；完整临床映射确认前不能切换患者进入预约、
报告或门诊费用查询。

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- 小程序完整测试：169 项通过，0 项失败，1335 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `pnpm check`：通过，架构 67 条、工具测试 31 项、9 个 workspace 类型检查/测试/构建均通过；文档审计 283 篇无断链。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0。
- `dist/build-info.json.sourceRevision` 已核对为上表完整来源。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，因此扫码登录不会
弹出头像/昵称授权框。旧候选二维码和开发者工具旧增量缓存不属于本候选；真机验收前必须重新编译当前 `dist/`
并生成二维码，先核对本记录的完整 `sourceRevision`。

本记录只证明本地代码和运行包门禁通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入
已经在真机完成。每个业务域仍需页面结果、客户端 `requestId/traceId` 和服务端低敏日志三层同链证据。
