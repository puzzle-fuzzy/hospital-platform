# 小程序当前候选 `90fd783` 本地构建记录（2026-08-22）

> 本记录对应当前本地运行包。服务端配套线上 release 为 `84fac75ceeb2247b252cf7e160eedbda220378f8`，本候选不代表微信、Provider 或真机业务已经验收。

## 1. 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `84fac75ceeb2247b252cf7e160eedbda220378f8` |
| 小程序客户端 | `90fd783` |
| 小程序构建来源 | `90fd7832e3ad1031c9c916f118f90cc0f2840aff` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## 2. 本轮业务正确性修复

本候选保留患者范围只读请求的稳定会话代际边界，并进一步修复首页 `onShow` 与下拉刷新并发时的状态竞态。
只有当前目录读取返回 `loaded`，且页面生命周期和 session guard 仍有效时，首页才会显示“已恢复会话”；
被更新周期淘汰的 `superseded` 结果不能伪造会话成功，也不能在患者目录尚未确认时开放患者范围入口。

## 3. 真机错误复核

`src/services/single-flight.test.ts` 是测试输入，不能复制到 `dist/`。本候选通过
`tsconfig.build.json` 和最终文件清单两层排除测试脚本；开发者工具报告的
`dist/services/single-flight.test.js` 属于旧增量模块索引或旧真机调试会话，不是运行包缺陷。

前一候选还暴露过 `@hospital/contracts` 裸模块运行时解析错误。当前构建和验收脚本会拒绝
`require("@hospital/*")`、`from "@hospital/*"` 和动态 `import("@hospital/*")` 进入 JavaScript
运行包；共享契约只能在 TypeScript 类型或测试边界使用，小程序页面运行时使用本地模块。

## 4. 本轮门禁结果

- 小程序测试：203 pass、0 fail、1534 个 expect；
- 小程序 typecheck、build、runtime:verify 通过；
- 生成 14 个页面脚本，运行包不含 `*.test.js`、`*.spec.js` 或 workspace 裸模块运行时引用；
- `dist/build-info.json.sourceRevision` 已固定为 `90fd7832e3ad1031c9c916f118f90cc0f2840aff`，真机前必须在正确的 `apps/miniprogram/` 项目重新普通编译。

## 5. 当前验收边界

真机验收必须同时记录页面结果、客户端 `/api/v2/` 请求及 requestId/traceId、服务端低敏同链事件。没有三层证据时，微信登录、患者同步、显式患者切换、预约历史、门诊费用和普通资料均只能标记为待验收。

支付、医保、退款、预约写入、患者绑定、报告详情 Provider 和 HIS 回写继续保持关闭；旧 Python 服务、线上数据库和 Redis 不因本地小程序构建而修改或重启。
