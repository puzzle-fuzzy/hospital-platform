# 小程序当前候选 `ec26f41` 本地构建记录（2026-08-22）

> 本记录对应当前本地运行包。服务端配套线上 release 为 `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10`，本候选不代表微信、Provider 或真机业务已经验收。

## 1. 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `002acc1be5cdd1b16c2c249f5dbbf9f7c65dbd10` |
| 小程序客户端 | `ec26f41` |
| 小程序构建来源 | `ec26f41f8575871972ac63a8074a9beaec1df55b` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## 2. 真机错误复核

`src/services/single-flight.test.ts` 是测试输入，不能复制到 `dist/`。本候选通过
`tsconfig.build.json` 和最终文件清单两层排除测试脚本；开发者工具报告的
`dist/services/single-flight.test.js` 属于旧增量模块索引或旧真机调试会话，不是运行包缺陷。

重新打开开发者工具后还发现过 `@hospital/contracts` 裸模块错误。微信运行时不解析 pnpm
workspace 裸模块名，当前候选已改为小程序本地无第三方依赖的预约记录时间校验，并通过与共享
契约边界一致性的测试；不能通过把 workspace 包复制进 `dist/` 规避运行时依赖边界。

本候选已经完成：

- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- `pnpm check` 全量门禁；
- 使用微信开发者工具 CLI 按 `apps/miniprogram/` 项目根目录打开并确认资源树为 `MINIPROGRAM`。
- 构建和运行包校验都会拒绝 `require("@hospital/*")`、`from "@hospital/*"` 等
  workspace 裸模块依赖，避免微信 CommonJS 运行时再次出现模块未定义。

## 3. 当前验收边界

真机验收必须同时记录页面结果、客户端 `/api/v2/` 请求及 requestId/traceId、服务端低敏同链事件。没有三层证据时，微信登录、患者同步、显式患者切换、预约历史、门诊费用和普通资料均只能标记为待验收。

支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 回写继续保持关闭；旧 Python 服务、线上数据库和 Redis 不因本地小程序构建而修改或重启。
