# 当前微信共享 custom-tab-bar 运行包复核（2026-08-25）

## 当前结论

上一轮自定义底栏在切换期间没有阻止旧页面路由回写：`switchTab` 过渡时，旧页面的 `show` 生命周期会把 selected 状态覆盖回旧项，现场因此出现底栏闪动和选中态丢失。

本轮保留微信官方 `custom-tab-bar`，但把 selected 状态收口到共享组件，并增加切换锁：

- `app.json.tabBar.custom=true`、`position=bottom`；
- 四个主入口和图标只由 `custom-tab-bar/index.ts` 的唯一数据源渲染；
- 页面不渲染第二份底栏，也不维护页面级 selected；
- 点击后先更新共享组件选中态，再锁定切换过程；旧页面路由在锁定期间不得覆盖新选中态；
- 主 Tab 的程序化跳转仍统一经过 `switchTab`，普通业务页仍使用 `navigateTo`；
- 共享组件固定在窗口底部，页面内容通过统一安全区占位避免被遮挡；
- `dist/` 只包含一套 `custom-tab-bar/`，不保留旧的页面级底栏。

这是针对当前用户现场反馈的架构修正，不是仅替换图标或增加延时。支付、医保、患者绑定、二维码、预约写入和 HIS 回写仍保持原有关闭边界。

## 运行包证据

| 项目 | 当前值 |
| --- | --- |
| 修正提交 | `7fc22fae975d207d66cd248de01ac0287492f800` |
| 运行包目录 | `apps/miniprogram/dist/` |
| `dist/build-info.json.sourceRevision` | `7fc22fae975d207d66cd248de01ac0287492f800` |
| 页面数量 | 16 |
| TabBar | `custom=true`、`position=bottom`、四项共享路由 |
| `dist/custom-tab-bar/` | 存在且只包含一套组件 |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均不存在 |
| 小程序测试 | 240 pass、0 fail、1933 assertions |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |
| 预览二维码 | `.local/hospital-miniprogram/tabbar-native-preview-7fc22fa.png` |

## 真机验收

请直接在微信开发者工具打开下面的独立运行工程，不要打开父目录、`src/` 或历史 `dist/`：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram\dist
```

普通编译后依次点击“医疗服务、就诊、互联网医院、我的”，确认：

1. 底部始终只有一套四项导航；
2. 当前项显示蓝色图标和文字，其余项保持灰色；
3. 切换过程中底栏不消失、不叠加、不回到“医疗服务”；
4. 底栏固定在窗口底部，只有页面内容 `scroll-view` 滚动；
5. 进入普通业务页后底栏按微信 custom-tab-bar 规则隐藏，返回主 Tab 后仍由同一套共享组件恢复。

验收时可核对 `dist/build-info.json` 的完整 revision。若仍加载旧底栏或旧选中态，先关闭历史微信工程、清理当前工程缓存并重新普通编译，不要恢复页面级底栏。

## 影响范围

本轮只修改新项目的小程序导航源码、构建门禁、测试和文档；没有修改旧 Python 服务、线上服务、服务器、MySQL、Redis 或另一会话负责的众阳自动化。
