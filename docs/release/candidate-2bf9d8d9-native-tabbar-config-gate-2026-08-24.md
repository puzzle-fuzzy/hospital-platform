# `2bf9d8d9` 原生 Tab 运行包配置门禁候选记录（2026-08-24）

> 本候选只用于本地微信开发者工具和真机验收，不代表已经发布线上。线上仍是小程序运行包 `13f597e` 与服务端 release `28a5c0c1`；旧 Python `8001`、线上 API、数据库和 Redis 未修改。

## 本轮修正

上一候选已经把四个主入口切换为微信原生 `tabBar`，但开发者工具的热重载仍可能在 `dist/` 替换或页面重新编译时短暂混入旧页面图，表现为底栏闪动、普通图标覆盖选中图标。上一轮的源码与运行包结构没有发现第二套底栏，因此本轮不再复制任何页面底栏，而是把工具配置和资源完整性纳入构建门禁：

- 公共 `apps/miniprogram/project.config.json` 固定 `setting.compileHotReLoad=false`；
- 本机 `project.private.config.json` 存在时同样必须是 `compileHotReLoad=false` 和 `ignoreDevUnusedFiles=false`；
- 四项原生 Tab 的 `pagePath` 必须注册在 `app.json.pages`，`iconPath` 与 `selectedIconPath` 必须是无目录穿越的相对路径并且真实存在；
- 选中图标仍唯一来自 `app.json.tabBar.list[].selectedIconPath`，页面 WXML 不渲染 `legacy-tabbar`，运行包不包含 `custom-tab-bar`。

## 当前来源

| 项目 | 值 |
| --- | --- |
| Git 提交 | `2bf9d8d9f67521067d761b48cc2bfec449ef1348` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| `build-info.json` | `sourceRevision` 为 `2bf9d8d9f67521067d761b48cc2bfec449ef1348`，页面数 `16` |
| 小程序 DevTools 根目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 实际运行根目录 | `dist/` |
| 线上配套服务端 | `28a5c0c1`，本轮不切换 |

## 已完成验证

- `pnpm --filter @hospital/miniprogram build` 通过；
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过；
- 小程序测试 `234/234` 通过，共 `1882` 个断言；
- 全仓 `pnpm check` 通过，包含架构、迁移、Provider、文档、日志、API、typecheck 和 build；
- 当前 `dist/app.json` 使用原生 `tabBar.custom=false`、`position=bottom`，四项页面和八个图标资源均存在；
- `dist/` 不包含 `custom-tab-bar/`、`*.test.js` 或 `*.spec.js`。

## 2026-08-24 现场工具观察

本次通过微信开发者工具 Stable `2.01.2510290` 打开的项目根目录为
`E:\__Super_Core__\hospital-platform\apps\miniprogram`，模拟器实际页面路径依次观察到
`pages/index/index`、`pages/my/my` 和 `pages/consult/consult`。切换过程中底部始终只有
一份原生 TabBar；“医疗服务”“我的”“就诊”当前项分别显示蓝色选中图标，其余项保持灰色，
未观察到页面级第二套底栏或选中图标丢失。

随后从同一项目重新生成二维码真机调试候选。二维码有效期为 `2026-08-24 19:11`，
这只代表本机候选已重新编译并可供扫码，不代表真机已经完成验收；真机仍需扫码后重复
四项 Tab 切换并记录是否仍然出现闪动。

## 真机导入边界

1. 关闭所有指向旧 `src/`、旧 `mp-weixin` 或线上包的微信开发者工具窗口和真机调试会话；
2. 打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不能打开 `src/` 或直接把旧二维码当作本候选；
3. 执行一次普通“编译”，确认工具资源树的项目根是 `apps/miniprogram`，运行包来源与本候选一致；
4. 分别点击“医疗服务、就诊、互联网医院、我的”，确认底栏只有一份、固定在窗口底部、当前项使用蓝色选中资源；
5. 若页面仍出现 `view.legacy-tabbar`、`src/app.json` 或 `dist/services/*.test.js`，立即停止业务验收：这证明工具仍在运行旧项目/缓存，不是本候选运行结果。

本记录只证明代码、构建和工具边界，不把未重新生成的二维码、线上旧包或服务器健康检查写成真机视觉通过。
