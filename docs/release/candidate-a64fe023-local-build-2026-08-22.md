# 小程序候选 `a64fe023` 本地运行包记录（2026-08-22）

> 本文记录当前小程序运行包的可复核来源、构建门禁和开发者工具准入状态。它不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 小程序客户端 | `a64fe023` |
| 服务端 release | `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` |
| 小程序构建来源 | `a64fe023bc34fe6e44f93846c39e202fe02d64a5` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均为 0 |
| 运行包关键模块 | `services/single-flight.js` 存在；`services/single-flight.test.js` 不存在 |

## 本次代码内容

小程序请求客户端增加了低敏请求观测环，成功、HTTP 失败和网络失败都会记录：

- 服务端/客户端最终采用的 `requestId`；
- HTTP 方法、去掉查询参数的路径、状态码、耗时和结果类型；
- 最多保留最近 64 条，控制台日志不包含患者 ID、请求体、Token 或 Provider 原文。

成功响应会读取并校验服务端 `X-Request-Id`，因此登录、患者同步、预约和费用只读请求也可以与服务端 Pino 日志对齐。查询参数会在观测边界被移除，例如 `/patients?patientId=...` 只记录为 `/patients`。

## 已通过门禁

```text
pnpm --filter @hospital/miniprogram test           220 pass / 0 fail / 1634 expect()
pnpm --filter @hospital/miniprogram typecheck      通过
pnpm --filter @hospital/miniprogram build          通过
pnpm --filter @hospital/miniprogram runtime:verify 通过
```

构建发布器和运行包校验均会拒绝测试脚本、缺失相对模块和错误来源指纹；构建失败时保留上一份完整 `dist/`，不会把半成品暴露给开发者工具。

## `single-flight.test.js` ENOENT 处理

本次错误的边界已经确认：当前源码、构建 staging 和 `dist/` 都没有测试脚本运行时引用，报错来源是微信开发者工具旧增量模块索引或文件句柄仍指向历史运行包。

已执行以下受控恢复：

1. 只关闭新项目 `miniprogram` 窗口，旧项目 `mp-weixin` 窗口未操作；
2. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`；
3. 普通编译成功，构建面板显示 `services/single-flight.js`；
4. 重新生成 iOS/局域网真机调试二维码，二维码预计于 2026-08-22 18:14 CST 失效。

不得把 `single-flight.test.js` 复制到 `dist/`，也不得使用旧二维码继续验收。若再次出现同一路径，重复“结束真机调试 → 关闭并重开正确项目 → 普通编译 → 生成新二维码”的顺序。

## 尚未完成

当前仍缺同一候选下的真实手机三层证据：手机页面结果、小程序控制台的客户端 `requestId`、服务端 Pino 同链事件。微信登录后的患者同步/显式切换、预约历史/爽约、门诊费用只读和报告目录必须按该证据门禁逐项验收；支付、医保、退款、报告附件和 HIS 写回继续关闭。

本轮未修改旧 Python 服务、旧数据库、旧 Redis，也未操作旧项目窗口。
