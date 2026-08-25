# 已废止：微信 custom-tab-bar 运行包复核（2026-08-25）

> 本文是上一候选的失败记录，不是当前真机验收入口。用户在真机扫码后观察到底部导航完全不呈现，
> 因此 `4ae9c296` 的 custom-tab-bar 方案已撤回；当前候选改用微信原生 `tabBar`。

## 当前结论

用户在上一份微信原生 `tabBar` 运行包上仍观察到：四个底栏像随页面重新创建一样闪动，且当前项没有明显选中效果。源码和运行包虽然只有一份原生底栏声明，但现场表现已经否定了“只换原生图标路径即可收口”的假设。

本轮改回微信官方 `custom-tab-bar`，但不是把底栏复制进四个页面：

- `app.json.tabBar.custom=true`，四个主入口仍只声明一次；
- `src/custom-tab-bar/` 是四个主 Tab 的唯一底栏组件，普通业务页不渲染它；
- 页面仍只能通过 `wx.switchTab` 切换主 Tab，不能用 `navigateTo` 压入普通页面栈；
- 点击时先在唯一组件实例中更新选中图标，路由成功后由当前页面 route 再校正；
- 四个主 Tab 的 `onShow` 都通过 `getTabBar().syncSelectedTab()` 再同步一次完整菜单模型，
  不只更新一个数字字段，避免 active 图标仍停留在上一项；
- 读取页面栈失败时不再错误回退到“医疗服务”，避免选中态在切换中间帧消失；
- 路由失败才回滚上一次选中项，点击锁释放后不主动覆盖目标页的 selected 状态；
- 四个页面自身没有 `legacy-tabbar`，页面滚动区仍只预留一份固定底栏高度。

这条方案解决的是“底栏视觉实例和 selected 状态”的问题，不开放任何支付、医保、患者绑定、二维码或 HIS 写回能力。

## 当前候选与运行包证据

- 源码提交：`4ae9c29663eafa757df39c23a11007b3040ccb96`，已提交到 `main`；
- 运行包：`apps/miniprogram/dist/`；
- 本轮没有生成预览二维码，请直接打开 `apps/miniprogram/dist/`；
- `dist/build-info.json.sourceRevision=4ae9c29663eafa757df39c23a11007b3040ccb96`；
- `dist/app.json.tabBar.custom=true`、`position=bottom`；
- `dist/custom-tab-bar/index.js/index.json/index.wxml/index.wxss` 均存在；
- 16 个页面脚本存在，`*.test.js` 和 `*.spec.js` 为 0；
- `pnpm --filter @hospital/miniprogram runtime:verify` 已通过；
- 小程序 241 个测试通过，0 个失败，1934 个断言；
- 构建时开发者工具曾锁住旧 `dist`，候选先保存在 `.local/hospital-miniprogram/pending`，关闭开发者工具后台进程后通过 `runtime:publish-pending` 原子发布；旧完整运行包不会在构建中被清空。

## 真机验收要求

本轮仍未把代码测试写成真机完成。必须直接打开以下工程并普通编译：

```text
E:\__Super_Core__\hospital-platform\apps\miniprogram\dist
```

启动日志应包含：

```text
[医院小程序] 运行包来源：微信 custom-tab-bar；revision=4ae9c29663eafa757df39c23a11007b3040ccb96
```

依次点击“医疗服务、就诊、互联网医院、我的”，记录以下结果：

1. 任意时刻底部只有一套四项导航；
2. 当前项图标和文字为蓝色，其余项为灰色；
3. 点击时选中态立即变化，切换期间底栏不消失、不叠加、不回到首页；
4. 底栏固定在窗口底部，只有内容 `scroll-view` 滚动；
5. 进入普通业务页时底栏按微信规则隐藏，返回主 Tab 后仍恢复同一套组件。

如果仍闪动，必须同时记录当前 route、启动 revision、基础库版本和录屏；在没有这些证据前，不再来回切换第三套底栏实现。

## 影响范围

本轮只修改新项目的小程序导航源码、构建门禁、测试和文档，没有修改旧 Python 服务、线上服务、服务器、MySQL、Redis 或另一会话负责的众阳自动化。
