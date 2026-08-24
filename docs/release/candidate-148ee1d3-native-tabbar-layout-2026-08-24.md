# `148ee1d3` 原生 TabBar 共享布局候选记录（2026-08-24）

> 本文只记录本地重制小程序候选，不代表已经替换线上小程序、完成微信真机业务验收或开放支付/医保能力。旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 1. 本轮修正

此前候选已经移除 `custom-tab-bar/`，但原生模式仍使用默认省略配置，四个主 Tab 还保留了旧自定义底栏的底部占位。为避免开发者工具热编译继续保留旧模式，本轮把 `app.json.tabBar.custom` 显式固定为 `false`，并声明 `position: bottom`。

四个主 Tab 的页面配置新增 `disableScroll: true`，根节点继续使用统一的 `tab-page-scroll`。这样页面整体不会参与滚动，只有内容 `scroll-view` 承担滚动；四个页面也移除了旧自定义底栏对应的 150–160rpx 底部占位。微信原生 TabBar 的选中图标仍由 `selectedIconPath` 管理，页面不再维护选中索引。

同时收紧患者范围错误态：预约记录页面只有收到明确的患者上下文错误码时才展示错误态“选择就诊人”；网络、Provider、持久化和依赖配置故障只保留“重新加载”，避免服务异常把用户错误地引导到换人流程。爽约页面仍不自动嵌入或跳转患者选择页。

## 2. 来源与运行包证据

| 项目 | 结果 |
| --- | --- |
| 页面代码来源 | `148ee1d336dd8b0e22a30aeea560510ddc6b35c0` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面数量 | 16 |
| 原生主 Tab | 医疗服务、就诊、互联网医院、我的 |
| 构建命令 | `pnpm --filter @hospital/miniprogram build` |
| 运行包校验 | `pnpm --filter @hospital/miniprogram runtime:verify` |

构建后确认：

- `dist/app.json` 的 `tabBar.custom` 为 `false`，`position` 为 `bottom`；
- 四项均声明不同的 `iconPath` 和 `selectedIconPath`，且图标资源已复制到运行包；
- `dist/custom-tab-bar/` 不存在；
- 四个主 Tab 的 `.json` 均为 `disableScroll:true`；
- 运行包没有 `*.test.js` 或 `*.spec.js`。

## 3. 验证结果

- 小程序定向测试：`232 pass / 0 fail`，`1779 expect()`；
- 小程序 TypeScript 类型检查：通过；
- Biome 格式检查与 Lint：通过；
- 构建和 `runtime:verify`：通过。

## 4. 真机交接要求

由于 `app.json` 的 `custom` 模式变化不能只依赖热编译，开发者工具必须关闭当前小程序窗口和真机调试会话，再重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，确认项目配置的 `miniprogramRoot` 为 `dist/`，执行完整编译后重新扫码。验收时依次点击四个主 Tab：底栏只能有一份，当前项使用蓝色选中图标，内容滚动时底栏固定且不参与滚动。

这一步只证明导航与布局候选，不等价于微信登录、患者同步、预约写入、支付、医保授权、HIS 写回或生产发布成功。
