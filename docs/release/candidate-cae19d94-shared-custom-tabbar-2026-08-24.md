# `cae19d94` 共享 custom-tab-bar 候选记录（已被 `fd9b0ca6` supersede）

> 历史候选记录：该方案已因真机仍观察到切换闪动和选中态不稳定而撤回，当前候选恢复为微信原生 `tabBar`，请以 [`candidate-fd9b0ca6-native-tabbar-2026-08-24.md`](candidate-fd9b0ca6-native-tabbar-2026-08-24.md) 为准。本文件保留当时的验证证据，不再作为验收入口。

## 结论

本地未发布小程序候选已将四个主 Tab 改为微信官方 `custom-tab-bar` 共享组件，针对真机观察到的“底栏切换闪动、选中态消失”进行收敛：

- 底栏只在 `apps/miniprogram/src/custom-tab-bar/` 渲染，首页、就诊、互联网医院和“我的”页面不再复制底栏 WXML；
- 组件初始 `selected` 直接从 `getCurrentPages()` 当前 route 推导，不先显示首页激活态再纠正；
- `onShow` 只在激活项真正改变时调用 `setData`，避免每次页面恢复都重绘图标；
- 主 Tab 点击和程序化跳转统一使用 `wx.switchTab`，普通业务页仍使用 `wx.navigateTo`；
- 底栏固定高度为 `130rpx + env(safe-area-inset-bottom)`，四个主页面的内容 `scroll-view` 预留相同底部空间；
- 所有激活图标继续复用旧端 `tab-01..04-active.png`，不引入新的视觉设计。

## 候选与运行包来源

| 项目 | 值 |
| --- | --- |
| Git 提交 | `cae19d941110b2ba45e65b39d45ef466521c64e1` |
| 运行包来源 | `dist/build-info.json.sourceRevision = cae19d941110b2ba45e65b39d45ef466521c64e1` |
| 运行包路径 | `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist` |
| 页面数量 | 16 |
| 线上服务端 | `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，本轮不切换 |
| 线上小程序 | `13f597e`，本地候选尚未发布 |
| 旧 Python 服务 | `8001`，本轮未修改、未停止、未重启 |

## 已完成校验

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram test`：234 pass / 0 fail，1876 个断言；
- `pnpm --filter @hospital/miniprogram build`：通过，运行包来源为本候选完整提交；
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过，16 个页面和共享底栏运行文件齐全；
- `dist/custom-tab-bar/index.js|json|wxml|wxss`：存在；
- `dist/`：不包含 `*.test.js` 或 `*.spec.js`；
- 代码与文档已推送到 `origin/main`，提交信息为 `修复主Tab共享底栏闪动与选中态`。

## 开发者工具 / 真机步骤

1. 关闭旧的小程序项目窗口和真机调试会话；
2. 在微信开发者工具中导入 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，不要导入 `src/`；
3. 确认项目配置的 `miniprogramRoot` 为 `dist/`，执行一次普通编译，不使用热重载结果作为证据；
4. 从首页依次点击“医疗服务、就诊、互联网医院、我的”，确认始终只有一套固定底栏；
5. 观察每次切换时当前图标是否直接保持蓝色激活态，不应先显示“医疗服务”激活图标后再跳变；
6. 再进入“我的挂号”等普通业务页，确认这些页面不显示四项主 Tab；返回主 Tab 后，底栏仍只有共享的一套；
7. 页面截图、客户端 `requestId`、服务端 Pino `traceId` 和 Provider 低敏请求号仍需按真实设备手册采集，代码测试不能替代真机业务验收。

本候选只修正小程序导航与视觉层，不打开预约写入、支付、医保授权、患者绑定、HIS 写回或外部 WebView，也不触碰旧服务、线上配置、数据库和 Redis。
