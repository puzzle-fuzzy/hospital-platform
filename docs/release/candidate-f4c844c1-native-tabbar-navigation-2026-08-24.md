# `f4c844c1` 原生 TabBar 防重复切换记录（2026-08-24）

## 本轮处理

用户仍观察到主 Tab 切换闪动。源码审计确认四个主入口已经由微信原生
`app.json.tabBar` 统一管理，没有页面级 `legacy-tabbar`、`custom-tab-bar` 或第二套固定底栏；
普通态/选中态图标也使用了独立的 `*-native` 资源路径。

本轮补上最后一个程序化导航边界：

- 目标已经是当前主 Tab 时，不再重复调用 `wx.switchTab`；
- 跨到其他主 Tab 时仍只调用 `wx.switchTab`；
- 普通业务页继续使用 `wx.navigateTo`，不改变其页面栈语义；
- 微信运行时没有页面栈信息时按未知处理，不因测试替身缺失全局 API 而跳过真实导航。

这样可以避免会话失效回首页、登录恢复或快捷入口重复触发当前 Tab 生命周期，减少低端真机上的内容/底栏闪帧。

## 已验证

| 项目 | 结果 |
| --- | --- |
| 提交 | `f4c844c1c68f9cbe957b3d8fd3627d4ddc241e91` |
| 小程序源码 | `switchToPrimaryTab` 增加当前路由 no-op；新增重复切换回归测试 |
| 类型检查 | `pnpm --filter @hospital/miniprogram typecheck` 通过 |
| 格式检查 | Biome 检查导航源码和测试通过 |
| 小程序测试 | `236 pass / 0 fail / 1898 expect()` |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过，16 个页面脚本存在 |
| 运行包 | `runtime:verify` 通过，`sourceRevision=f4c844c1c68f9cbe957b3d8fd3627d4ddc241e91` |
| 工具状态 | 已对 `apps/miniprogram/` 重置文件缓存、关闭并重新打开 |
| 旧系统 | 未修改旧 Python 服务、服务器、MySQL、Redis 或线上配置 |

## 真机验收边界

本记录只证明源码、运行包和开发者工具工程入口正确，尚未把本轮候选上传微信，
也不替代真机视觉证据。开发者工具必须打开：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram
```

普通编译后确认 `dist/build-info.json.sourceRevision` 为
`f4c844c1c68f9cbe957b3d8fd3627d4ddc241e91`，再依次点击四个主 Tab：只能有一份底栏，当前项的图标和文字应为蓝色，
内容滚动不能带动底栏。若控制台仍显示 `src/app.json` 或旧 revision，应关闭错误工程，
不能继续用旧二维码或在页面中新增第二套底栏。
