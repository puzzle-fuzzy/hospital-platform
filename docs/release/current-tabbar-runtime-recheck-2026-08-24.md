# 当前主 Tab 运行包复核（2026-08-24）

## 结论

本轮针对“底部 Tab 切换闪动、四项没有选中效果”的反馈，先复核实际运行边界，没有恢复页面级底栏，也没有重新引入 `custom-tab-bar`。当前方案仍是微信原生 `tabBar`：四项路由、普通图标和选中图标只声明在 `app.json.tabBar.list` 中。

源码和运行包均未发现第二套底栏。原生 TabBar 的选中状态由微信根据当前 `pagePath` 维护；如果运行时仍然出现四项同时未选中或底栏重建，优先说明开发者工具仍在使用旧增量页面图，不能用新增自绘底栏掩盖这个运行包来源问题。

## 本轮实际动作

- 重置 `apps/miniprogram/` 对应的微信开发者工具文件缓存；
- 关闭并重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram` 根工程；
- 复核开发者工具日志时发现，之前 CLI 从 monorepo 根目录启动，工具同时保留了
  `E:\__Super_Core__\hospital-platform` 根目录 watcher；该 watcher 曾把 `src/`、`.turbo/`
  和 README 的变化送入增量编译，这正是“旧页面图混入、底栏闪动、选中资源暂时丢失”的运行层风险；
- 后续重开必须以 `apps/miniprogram` 作为 CLI 工作目录，并先关闭管理页中所有根工程、`src/`
  和 `dist/` 的隐藏窗口，只保留 `apps/miniprogram` 这一套工程；
- 保持 `miniprogramRoot=dist/`、`compileHotReLoad=false`、`ignoreDevUnusedFiles=false`；
- 重新执行小程序 TypeScript 构建和运行包校验；
- 没有修改旧 Python 服务、服务器、数据库、Redis 或线上小程序。

## 运行包证据

| 项目 | 结果 |
| --- | --- |
| 运行包来源 | `39b50d5c4287f54ecc24e8564e2dc811a55c1d1b` |
| 页面入口 | 16 个页面脚本完整 |
| TabBar 模式 | `custom=false`、`position=bottom` |
| TabBar 数量 | 4 项：医疗服务、就诊、互联网医院、我的 |
| 选中资源 | 4 个独立 `*-native-active.png`，均与普通图标不同 |
| 测试脚本 | `dist/` 不包含 `*.test.js` 或 `*.spec.js` |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |

## 现场验收边界

重新打开的根工程必须执行一次“普通编译”，不能直接沿用热重载或旧二维码。控制台应出现完整运行包来源：

```text
[医院小程序] 运行包来源：原生 TabBar；revision=39b50d5c4287f54ecc24e8564e2dc811a55c1d1b
```

随后依次点击四项主 Tab，必须同时满足：

1. 底栏始终只有一套，切换不出现旧页面底栏叠加；
2. 当前项的图标和文字为蓝色，其他三项为灰色；
3. 内容滚动时只有页面 `scroll-view` 滚动，底栏保持在窗口底部；
4. 进入预约记录、患者选择等普通业务页后底栏按微信规则隐藏，回到主 Tab 后不新增第二套底栏。

如果普通编译后的控制台 revision 不是上面的完整值，或仍出现旧 `static/tabbar`、`custom-tab-bar`、测试脚本路径，必须停止真机业务验收，先关闭错误的 DevTools 项目和旧二维码。

PowerShell 重开时固定从小程序目录执行：

```powershell
Set-Location 'E:\__Super_Core__\hospital-platform\apps\miniprogram'
& 'D:\software\微信web开发者工具\cli.bat' quit --port 25799
& 'D:\software\微信web开发者工具\cli.bat' reset-fileutils --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
& 'D:\software\微信web开发者工具\cli.bat' open --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
```

本轮只处理开发者工具运行边界；未将环境 watcher 当成业务代码问题，也没有恢复
`custom-tab-bar`。关闭后重新普通编译并扫码，仍需以控制台完整 `sourceRevision` 和四项
蓝色选中态作为真机验收证据。
