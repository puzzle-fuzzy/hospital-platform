# 当前共享 Tab 运行包复核（2026-08-24）

## 结论

针对真机仍出现的“底部 Tab 切换闪动、四项没有选中效果”，本轮将主导航收敛为微信官方 `custom-tab-bar` 共享组件：四个主 Tab 只保留一套底栏，页面自身不再复制底栏，选中项由组件首次渲染时按当前页面路由直接计算。

这次不是继续修补原生 `tabBar` 的颜色配置。原生配置和资源在源码中虽然完整，但现场仍出现选中态丢失；继续保留原生底栏会让运行时缓存、页面生命周期和选中图标继续存在两套事实来源。当前实现把路由、图标、选中态和固定定位统一到 `custom-tab-bar`，并在构建阶段阻止回退到 `custom: false`。

## 本轮代码变更

- `src/constants/legacy-tabbar.ts`：四个主 Tab 的路由、标题、普通图标和选中图标唯一事实来源；
- `src/custom-tab-bar/index.ts|wxml|wxss|json`：共享底栏组件，首次 `data` 直接调用 `resolveSelectedTab()`，当前项不变时跳过 `setData`；
- `src/app.json`：显式使用 `"custom": true`；
- `src/app.wxss`：统一给主 Tab 内容 `scroll-view` 预留 `130rpx + safe-area`，只有内容区域滚动；
- `scripts/build.ts`：将共享组件、资源和运行脚本纳入构建硬门禁，阻断原生 TabBar 回退；
- `src/app.ts`：启动日志明确打印“共享 custom-tab-bar”和运行包完整 revision，便于真机确认没有加载旧包。

主 Tab 的程序化跳转仍必须经过 `src/services/patient-navigation.ts` 的 `switchToPrimaryTab`，内部统一使用 `wx.switchTab`；普通业务页仍使用 `wx.navigateTo`，两类页面不能混用。

## 当前运行包证据

| 项目 | 结果 |
| --- | --- |
| 来源提交 | `75993e82`（完整 revision 由构建包写入） |
| 页面入口 | 16 个页面脚本完整 |
| TabBar 模式 | `custom=true`，由共享 `custom-tab-bar` 渲染 |
| Tab 数量 | 4 项：医疗服务、就诊、互联网医院、我的 |
| 选中资源 | 4 对独立普通态/选中态图标，组件按 route 切换 |
| 运行包组件 | `dist/custom-tab-bar/index.js|json|wxml|wxss` 均存在 |
| 测试脚本 | `dist/` 不包含 `*.test.js` 或 `*.spec.js` |
| 小程序回归 | 238 pass / 0 fail，1904 个断言 |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |
| 线上/旧服务 | 未部署，未修改旧 Python、服务器、数据库或 Redis |

## 开发者工具与真机验收

运行包已经在本地生成，但本轮不能把源码测试当作真机验收。必须从唯一工程根目录打开并执行一次普通编译：

```powershell
Set-Location 'E:\__Super_Core__\hospital-platform\apps\miniprogram'
& 'D:\software\微信web开发者工具\cli.bat' quit --port 25799
& 'D:\software\微信web开发者工具\cli.bat' cache --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --clean compile --port 25799
& 'D:\software\微信web开发者工具\cli.bat' reset-fileutils --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
& 'D:\software\微信web开发者工具\cli.bat' open --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram' --port 25799
```

控制台应出现：

```text
[医院小程序] 运行包来源：共享 custom-tab-bar；revision=75993e82...
```

随后依次点击四个主 Tab，必须确认：

1. 窗口底部只有一套 `医疗服务 / 就诊 / 互联网医院 / 我的`；
2. 当前项图标和文字为蓝色，其他三项为灰色；
3. 切换时底栏不先消失、不叠加第二套、不先错误选中“医疗服务”；
4. 内容长时只有内容 `scroll-view` 滚动，底栏保持固定；
5. 进入患者选择、预约记录等普通业务页时底栏按微信规则隐藏，返回主 Tab 后仍只有一套共享底栏。

如果控制台 revision 不是 `75993e82...`，或者出现旧 `static/tabbar`、原生底栏残留、缺失页面脚本或测试脚本路径，应停止验收，先关闭错误工程和旧二维码。
