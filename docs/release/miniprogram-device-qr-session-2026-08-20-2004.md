# 原生小程序当前真机二维码会话（2026-08-20 20:04 CST）

## 当前来源

| 项目 | 值 |
| --- | --- |
| 开发者工具项目 | 新 `miniprogram` 窗口 |
| 小程序候选 | `3a89312` |
| 运行包来源 | `3a89312cd982ee2fc490b75515cdb6c7d58d513e` |
| 服务端 release | `0e360d3` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 真机平台 | iOS |
| 二维码生成 | 20:04 CST，开发者工具重新编译后现场生成 |
| 二维码失效 | 20:29 CST（以开发者工具显示为准） |

## 运行层观察

- 开发者工具输出显示 14 个页面配置已编译，`analyzing codes success`；当前模拟器停留在选择就诊人页面。
- 当前运行包 `dist/` 已通过 `runtime:verify`，不包含 `*.test.js` 或 `*.spec.js`；因此不能再为
  `dist/services/single-flight.test.js` 手工补文件。
- 本会话只证明二维码已按当前候选重新生成，不证明真实微信登录、患者同步或其它业务已经成功。
  扫码后必须同时保存页面结果、HTTP `requestId/traceId` 和新 API 低敏业务日志。
- 旧 Python `8001` 未修改、未重启，不属于本次真机窗口。

## 验收状态

状态：等待真机扫码。若再次出现 `dist/services/single-flight.test.js`，应立即停止本次扫码，关闭开发者工具，
重新执行 `pnpm --filter @hospital/miniprogram build` 与 `runtime:verify`，再重新导入 `apps/miniprogram/`；
不能切换到旧 `mp-weixin` 窗口，也不能把旧二维码或旧日志并入当前证据。
