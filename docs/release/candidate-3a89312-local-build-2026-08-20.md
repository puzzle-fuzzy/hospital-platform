# 小程序候选 `3a89312` 本地构建记录（2026-08-20）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `3a89312` |
| 小程序构建来源 | `3a89312cd982ee2fc490b75515cdb6c7d58d513e` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- `pnpm --filter @hospital/miniprogram test`：168 项通过，0 项失败，1329 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- 全仓 `pnpm check`：9/9 任务通过；架构门禁 67 条、文档审计 268 个文档、工具测试 31 项通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0。
- `dist/build-info.json.sourceRevision` 与本记录的完整来源一致。

## 微信授权边界

本候选的微信登录只调用 `wx.login()` 获取临时登录凭证，并由服务端完成 code 换取和会话建立；
登录流程不会调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，因此扫码登录本身不会弹出头像/昵称授权框。
如果未来需要用户资料授权，必须单独设计隐私说明、用户主动触发和服务端字段契约，不能把资料授权隐式塞回登录流程。

## 真机调试前置条件

开发者工具必须打开 `apps/miniprogram/`，运行根目录由公共配置固定为 `dist/`；不得直接打开 `src/`。
如果控制台仍出现 `dist/services/single-flight.test.js`，说明开发者工具增量模块图仍引用旧测试产物，
应关闭真机调试和开发者工具，重新执行构建与 `runtime:verify`，再重新导入项目。不能在 `src/` 或 `dist/`
手工创建测试脚本，因为测试脚本不是微信运行时依赖，且构建门禁会拒绝它们进入发布目录。

`candidate-767ed9c-local-build-2026-08-20.md` 及其二维码记录仍保留为历史证据；本记录生成后，旧二维码不再作为
当前候选使用，必须重新编译并现场生成新二维码。当前尚未据此新增微信登录、患者同步或只读业务的真机通过结论。
