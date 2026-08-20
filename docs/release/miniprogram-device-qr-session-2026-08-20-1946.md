# 原生小程序真机二维码会话记录（2026-08-20 19:46 CST）

## 1. 本次候选

| 项目 | 事实 |
| --- | --- |
| 开发者工具项目 | `E:\__Super_Core__\hospital-platform\apps\miniprogram` |
| 运行根目录 | `dist/` |
| 小程序候选提交 | `767ed9c` |
| 运行包完整来源 | `767ed9c225bf4d329761f6abed7668015a2626b2` |
| 页面数量 | 14 |
| 设备类型 | iOS |
| 局域网模式 | 已开启 |
| 二维码显示失效时间 | `2026-08-20 20:11 CST` |

本次二维码由新的 `miniprogram` 开发者工具窗口生成。窗口资源树指向 `dist/`，构建日志显示 14 个页面编译成功；
模拟器当前页面为 `pages/patient-select/patient-select`，展示了患者姓名、关系、当前标记和服务端脱敏卡号。

## 2. 运行包边界

本次生成二维码前已经完成：

- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- `dist/services/` 不包含 `single-flight.test.js` 或其它 `*.test.js`/`*.spec.js`；
- `project.config.json` 的 `miniprogramRoot` 为 `dist/`。

此前的 `ENOENT dist/services/single-flight.test.js` 已由旧增量索引/缓存复现为开发者工具运行包问题，当前干净运行包和来源门禁均未复现。

## 3. 证据等级与未完成项

本记录只证明“当前候选二维码已经生成”，不证明手机已经扫码，也不证明微信授权、患者同步或任何业务成功。
截至记录时，服务端同一时间窗口尚未取得本二维码对应的 `/auth/wechat`、`/me` 或 `/patients` 请求，因而不能升级为真机三层验收。

真机扫码后必须继续记录同一会话的：

1. 页面结果：登录状态、患者选择页、显式切换结果；
2. 客户端 HTTP：脱敏路径、状态码、`traceId/requestId`；
3. 服务端日志：同链请求、明确业务成功、HTTP `2xx` 和低敏 Provider 诊断。

没有上述三层同窗口证据时，不把二维码显示、模拟器页面或扫码动作本身当作业务完成。

## 4. 下一步操作

1. 在二维码失效前用真实测试设备扫码；过期后必须重新从当前 `miniprogram` 窗口生成，不使用历史截图。
2. 先完成微信登录和患者目录同步，再从首页点击“新增就诊人”或从业务页点击“更换就诊人”进入选择页。
3. 选择页确认患者后，优先验收“我的挂号”和门诊费用只读链路；支付、医保、退款和 HIS 写回仍保持关闭。
4. 采集页面、HTTP 和服务端日志三层证据后，再更新本记录或对应业务 release 记录。

旧 `mp-weixin` 开发者工具项目、旧 Python 服务、线上数据库和 Redis 不属于本次操作范围，均未触碰。
