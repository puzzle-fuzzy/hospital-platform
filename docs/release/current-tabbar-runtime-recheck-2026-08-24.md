# 当前原生 Tab 运行包复核（2026-08-24）

## 结论

针对真机仍出现的“底部 Tab 切换闪动、四项没有选中效果”，本轮将主导航收回微信原生 `tabBar`：四个主 Tab 只保留一套由微信维护的底栏，页面自身不再复制底栏，选中项由 `selectedIconPath` 由框架统一切换。

前一候选错误地引入了 `custom-tab-bar`。自定义底栏即使只有一个源码目录，也会跟随四个 Tab 页的生命周期创建/恢复实例，和“真正共用一套底栏”的需求不一致，且正是闪动与选中态丢失的风险来源。当前实现不再在业务代码中维护 selected 状态或 fixed 底栏，构建阶段强制 `custom: false` 和 `position: bottom`。

## 本轮代码变更

- `src/app.json`：显式使用 `"custom": false` 和 `"position": "bottom"`；
- `src/app.wxss`：不再给内容额外叠加自定义底栏高度，只有内容 `scroll-view` 滚动；
- `scripts/build.ts`：将原生模式、四项路由、普通/选中图标和资源完整性纳入构建硬门禁；
- `src/app.ts`：启动日志明确打印“微信原生 tabBar”和运行包完整 revision，便于真机确认没有加载旧包；
- 删除 `src/custom-tab-bar/` 与 `src/constants/legacy-tabbar.ts`，避免第二套导航事实来源重新进入运行包。

主 Tab 的程序化跳转仍必须经过 `src/services/patient-navigation.ts` 的 `switchToPrimaryTab`，内部统一使用 `wx.switchTab`；普通业务页仍使用 `wx.navigateTo`，两类页面不能混用。

## 当前运行包证据

| 项目 | 结果 |
| --- | --- |
| 来源提交 | `46563fe`（完整 revision 由构建包写入） |
| 页面入口 | 16 个页面脚本完整 |
| TabBar 模式 | `custom=false`、`position=bottom`，由微信原生 `tabBar` 渲染 |
| Tab 数量 | 4 项：医疗服务、就诊、互联网医院、我的 |
| 选中资源 | 4 对独立普通态/选中态图标，由微信按当前 Tab 切换 |
| 运行包组件 | 不包含 `custom-tab-bar/`，并随包生成独立 `project.config.json` |
| 测试脚本 | `dist/` 不包含 `*.test.js` 或 `*.spec.js` |
| 小程序回归 | 238 pass / 0 fail，1903 个断言 |
| 构建 | `pnpm --filter @hospital/miniprogram build` 通过 |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过 |
| 线上/旧服务 | 未部署，未修改旧 Python、服务器、数据库或 Redis |

## 开发者工具与真机验收

运行包已经在本地生成，但本轮不能把源码测试当作真机验收。当前应以构建后生成的二维码文件为准；必须关闭父工程窗口，直接打开 `apps/miniprogram/dist/` 独立工程并执行一次普通编译：

```powershell
Set-Location 'E:\__Super_Core__\hospital-platform\apps\miniprogram\dist'
& 'D:\software\微信web开发者工具\cli.bat' quit --port 25799
& 'D:\software\微信web开发者工具\cli.bat' cache --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram\dist' --clean compile --port 25799
& 'D:\software\微信web开发者工具\cli.bat' reset-fileutils --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram\dist' --port 25799
& 'D:\software\微信web开发者工具\cli.bat' open --project 'E:\__Super_Core__\hospital-platform\apps\miniprogram\dist' --port 25799
```

控制台应出现：

```text
[医院小程序] 运行包来源：微信原生 tabBar；revision=46563fe2e05c49c5899fca93e1dd60831c3d4017
```

随后依次点击四个主 Tab，必须确认：

1. 窗口底部只有一套 `医疗服务 / 就诊 / 互联网医院 / 我的`；
2. 当前项图标和文字为蓝色，其他三项为灰色；
3. 切换时底栏不先消失、不叠加第二套、不先错误选中“医疗服务”；
4. 内容长时只有内容 `scroll-view` 滚动，底栏保持固定；
5. 进入患者选择、预约记录等普通业务页时底栏按微信规则隐藏，返回主 Tab 后仍只有一套共享底栏。

如果控制台 revision 不是当前 `dist/build-info.json` 的完整值，或者出现旧 `static/tabbar`、自定义底栏残留、缺失页面脚本或测试脚本路径，应停止验收，先关闭错误工程和旧二维码。独立运行配置必须保持 `miniprogramRoot=./`、`compileHotReLoad=false`、`ignoreDevUnusedFiles=false`；否则不能把本次结果当作当前候选证据。
