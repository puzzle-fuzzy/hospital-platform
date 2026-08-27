# 小程序启动阶段 `globalData` 修复记录

## 现象

开发者工具启动小程序时出现：

```text
Cannot read property 'globalData' of undefined
```

调用链落在 `App.onLaunch -> ensureGlobalUserProfile -> getGlobalUserProfile -> ensureSessionChangedSubscription`。该错误发生在首屏业务请求之前，会让小程序启动阶段直接中断。

## 根因

App 入口被单独打包为 IIFE，页面服务则由微信按 CommonJS 模块加载。`App.onLaunch` 执行窗口内不能假设以下两项已经稳定：

- 生命周期回调的 `this` 一定就是带有完整 `globalData` 的 App 实例；
- `getApp()` 已经可以返回当前 App 实例。

原实现由资料服务、API 客户端、会话服务和会话代际服务分别读取 `getApp().globalData`。其中任意一个服务在 App 注册前读取都会把启动异常伪装成业务失败。

## 修复

提交 `76ca0137ea9a57b8b7ed9c8797bb718040535922` 完成以下调整：

1. 新增 `services/app-runtime-context.ts`，统一管理 App 容器读取。
2. `app.ts` 在调用 `App()` 前登记稳定的启动容器，并确保该容器和 `App({ globalData })` 使用同一对象引用。
3. App、API 客户端、会话服务、会话代际、会话事件和资料服务统一通过该桥读取状态。
4. 正常页面运行阶段仍优先使用微信的真实 `getApp()`；只有启动窗口或测试替身不可用时才回退到已登记的容器。
5. 未初始化状态被转换为安全的 `app-not-initialized` 错误码和中文提示，不把内部异常直接展示给用户。

该修复只涉及新小程序运行层，不修改旧 Python 服务、线上旧版本、MySQL、Redis 或 Provider 配置。

## 验证

- 小程序 TypeScript 类型检查通过。
- 小程序回归测试：`341 pass / 0 fail / 3730 expect()`。
- 运行包已原子发布到 `apps/miniprogram/dist/`，来源指纹为 `76ca0137ea9a57b8b7ed9c8797bb718040535922`。
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过，40 个页面入口和必需根文件齐全。
- 构建过程中检测到开发者工具占用 `dist` 时，候选先写入 pending；关闭新项目开发者工具后再执行 `runtime:publish-pending`，没有清空旧运行包。
- 重新打开正确的 `dist` 独立工程并完成首次编译后，控制台确认同一来源指纹；启动链按预期经历无会话 `/me` 401、健康检查 200、微信登录 200、`/me` 200、资料读取 200，未再出现 `globalData` 未定义异常。

## 开发者工具操作要求

1. 关闭当前新项目窗口和真机调试会话。
2. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist\` 独立工程，确认 `project.config.json` 的 `miniprogramRoot` 为 `./`。
3. 普通编译一次，确认控制台打印 `revision=76ca0137ea9a57b8b7ed9c8797bb718040535922`。
4. 重新生成真机二维码；旧二维码或旧开发者工具增量索引仍可能加载修复前的 `app.js`，不能作为修复后的证据。
