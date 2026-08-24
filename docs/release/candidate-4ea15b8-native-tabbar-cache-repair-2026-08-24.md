# 原生 TabBar 缓存修复验收记录（2026-08-24）

## 结论

本轮未修改旧 Python 服务、旧小程序项目、服务器、数据库或 Redis。

仓库源码和运行包本身已经使用微信原生 `tabBar`：

- `apps/miniprogram/src/app.json` 的 `tabBar.custom=false`；
- 四个主页面只通过 `tabBar.list` 注册，页面 WXML 没有第二套固定底栏；
- 页面级程序化跳转通过 `switchTab`，普通业务页面才使用 `navigateTo`；
- `project.config.json` 与本机 `project.private.config.json` 均指向 `dist/`，并关闭热重载；
- 四组普通图标和选中图标均存在，选中图标与未选中图标不是同一文件。

## 实际问题

开发者工具本机曾同时保留新项目的多个工作区和增量编译图，其中既有旧的
`static/tabbar` 资源，也有新运行包的 `assets/legacy-home` 资源。此时工具可能把
旧页面图与新 `dist` 混合展示，表现为：

1. 页面切换时底部区域闪动；
2. 四个底栏项看起来都未选中；
3. 页面内容已经是新版本，但底栏仍像旧版本；
4. 真机调试或刷新时出现与当前 `dist` 不一致的页面状态。

这不是把四个主页面分别绘制底栏可以解决的问题；那会重新引入重复底栏和选中态竞态。

## 处理动作

只针对新项目执行开发者工具文件缓存重置，然后重新打开：

```powershell
& 'D:\software\微信web开发者工具\cli.bat' reset-fileutils --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
& 'D:\software\微信web开发者工具\cli.bat' open --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
```

再执行一次普通编译。该动作不删除仓库文件，不修改旧项目和线上服务。

## 本地视觉核对

在当前开发者工具模拟器中依次切换“医疗服务”“我的”“就诊”：

- 四个页面始终只有一份底栏；
- 底栏固定在模拟器窗口底部，页面内容滚动不带动底栏；
- 当前页面的图标和文字显示为蓝色，其余项显示为灰色；
- 首页和“我的”页的页面内容不会再额外绘制 `legacy-tabbar`。

这属于开发者工具模拟器证据，不替代微信真机验收。真机验收前仍需普通编译并核对
`dist/build-info.json.sourceRevision`，再记录四个 Tab 的实际切换结果。

## 后续门禁

如果问题再次出现，按以下顺序处理：

1. 确认工具打开的是 `apps/miniprogram/`，不是 `src/`、`dist/` 或旧 `G:\fuck\hospital` 项目；
2. 执行 `runtime:verify`，确认 `dist` 页面脚本完整；
3. 只重置当前项目的 `fileutils` 缓存并重新普通编译；
4. 仍失败时收集工具窗口标题、项目根目录和 `build-info.json`，不要恢复自绘底栏。

