# `fd9b0ca6` 原生 TabBar 修正候选记录（2026-08-24）

> 本文只记录本地重制小程序候选，不代表已经替换线上小程序、完成微信真机业务验收或开放支付/医保能力。旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 1. 本轮修正

上一轮使用 `custom-tab-bar` 后，真机仍观察到主 Tab 切换闪动、选中图标不稳定。原因不是颜色或 CSS，而是把微信主导航交给了自定义组件生命周期。当前恢复为微信原生 `tabBar`：

- `app.json.tabBar.custom=false`，并显式声明 `position=bottom`；
- 四项路由、文案、普通图标和选中图标只保留在 `app.json.tabBar.list`；
- 删除 `src/custom-tab-bar/` 和无调用方的 `constants/legacy-tabbar.ts`；
- 四个主 Tab 页面只负责自己的内容，普通业务页不显示这组底栏；
- `disableScroll=true` 配合独立 `scroll-view`，页面整体不滚动，底栏由微信固定在窗口底部。

原生 TabBar 由微信统一维护页面生命周期和 selectedIconPath，不再通过页面组件首次读取 route、异步 `setData` 或自绘 fixed 元素实现选中态，因此更符合旧端原生 TabBar 策略，也能消除两套底栏并存的结构性风险。

## 2. 来源与运行包证据

| 项目 | 值 |
| --- | --- |
| 页面代码候选 | `fd9b0ca62d57111f2905be05a16c9b25b1e0ea30` |
| 运行包目录 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| 页面数量 | 16 |
| 原生主 Tab | 医疗服务、就诊、互联网医院、我的 |
| 构建命令 | `pnpm --filter @hospital/miniprogram build` |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` |

构建后确认：

- `dist/app.json` 的 `tabBar.custom` 为 `false`，`position` 为 `bottom`；
- 四项均声明不同的 `iconPath` 和 `selectedIconPath`，图标资源已复制到运行包；
- `dist/custom-tab-bar/` 不存在；
- 运行包没有 `*.test.js` 或 `*.spec.js`；
- 小程序测试为 `234 pass / 0 fail / 1873 expect()`。

## 3. 真机交接要求

开发者工具必须关闭当前小程序窗口和真机调试会话，再重新打开：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram
```

确认 `miniprogramRoot=dist/`，执行一次完整编译后重新扫码。依次点击四个主 Tab，必须看到：底栏只有一份、当前项使用蓝色选中图标、内容滚动时底栏固定、从普通业务页返回时不会产生第二套底栏。若仍显示旧自定义底栏，停止验收并关闭开发者工具旧项目缓存，不要向 `dist/` 手工复制组件。

支付、医保授权、预约写入、取消、HIS 回写、患者新增绑定及外部 WebView 仍保持关闭态。
