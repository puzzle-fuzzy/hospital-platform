# 当前原生 Tab 运行包复核（2026-08-25）

## 结论

本次反馈的“底部 Tab 仍然闪动、选中效果消失”没有在当前源码中复现出第二套底栏：

- `src/app.json` 和 `dist/app.json` 都是微信原生 `tabBar`，`custom=false`、`position=bottom`；
- 四个主入口只在 `app.json.tabBar.list` 声明一次；
- 四个主入口同时位于 `app.json.pages` 前四项，首屏和 Tab 切换使用同一组根页面注册；
- 页面 WXML、运行包和导航服务都没有 `legacy-tabbar`、`custom-tab-bar` 或页面级固定底栏；
- 主 Tab 的程序化入口只允许 `wx.switchTab`，普通业务页仍使用 `wx.navigateTo`；
- 普通态和选中态图标路径不同，且构建包中的文件字节与源码一致。

因此不能通过重新添加自绘底栏来掩盖现象。自绘底栏会随页面生命周期产生第二套实例，反而会重新制造闪动和 selected 状态竞态。本次按工具缓存/旧增量运行包边界处理。

## 本次现场处理

在不接触旧 Python 服务、服务器、数据库、Redis 或线上小程序的前提下，只对新项目的微信开发者工具执行了以下动作：

1. 针对独立运行根 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` 清理编译缓存；
2. 重置该运行根的 file-utils 索引；
3. 退出后重新打开独立 `dist` 工程；
4. 从当前 `dist` 重新执行预览，预览包大小为 `671087` 字节。

当前运行包来源仍为：

```text
49c641b69b44c1cc40b610a534893346389e2cf9
```

`dist/build-info.json`、`dist/app.json` 和 `dist/project.config.json` 均已现场核对。独立工程的 `miniprogramRoot=./`、`compileHotReLoad=false`、`ignoreDevUnusedFiles=false`，不会主动监听仓库的 TypeScript 源码和测试脚本。

本轮进一步把原生 Tab 图标改为独立的 `*-v2.png` 资源：普通态和选中态保持原视觉内容，统一为 `81×81` PNG，并由构建脚本读取 PNG 的 IHDR 做尺寸门禁。这样可以同时避开开发者工具/真机对旧资源路径的缓存，并符合原生 tabBar 的稳定输入边界；没有重新引入 `custom-tab-bar`。

本轮再收紧页面注册顺序：`pages/index/index`、`pages/consult/consult`、
`pages/hospital/hospital`、`pages/my/my` 固定为 `app.json.pages` 的前四项，
并由验收测试锁定。它不能替代重新普通编译；若启动日志仍不是本候选 revision，
真机看到的仍然是旧运行包。

## 真机验收准入

真机必须在本次重新普通编译后重新预览，不能继续使用旧二维码或旧真机调试会话。启动控制台应出现：

```text
[医院小程序] 运行包来源：微信原生 tabBar；revision=49c641b69b44c1cc40b610a534893346389e2cf9
```

随后依次点击“医疗服务、就诊、互联网医院、我的”，必须同时满足：

1. 底部始终只有一套四项导航；
2. 当前项图标和文字为蓝色，其他三项为灰色；
3. 切换时底栏不先消失、不叠加第二套、不先错误选中“医疗服务”；
4. 长内容只在页面自己的 `scroll-view` 内滚动，底栏固定；
5. 进入普通业务页时底栏按微信规则隐藏，返回主 Tab 后仍恢复为同一套原生底栏。

如果这次重新普通编译、并确认完整 revision 后仍然出现同样现象，下一步应记录真机系统、基础库版本、当前 route、启动 revision 和切换录屏，再判断是否属于微信基础库的原生过渡动画；在取得这组证据前不切换到第二种底栏架构。
