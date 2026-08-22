# 当前小程序候选 `41c708e` 构建与真机准入记录（2026-08-22）

> 本记录替代 `candidate-937bb2a` 作为当前人工入口。它补齐首页与“我的”页错误态的显式“重新加载”，
> 不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `9f479c9a` |
| 小程序客户端 | `41c708e1` |
| 小程序构建来源 | `41c708e1adf864ef6fef1f788e97aa8fb4371227` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 本候选包含的业务修正

首页和“我的”页的顶部网络错误现在提供显式“重新加载”入口。首页复用既有健康检查、会话和患者目录刷新编排，
“我的”页重新组合 `/me`、普通资料和患者目录，保持会话代际与 owner 边界；正常成功状态的旧版布局不变。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- 小程序测试 `216 pass / 0 fail / 1619 expect()`；
- Biome 定向检查；
- 当前 `dist/build-info.json` 来源指纹、14 个页面入口和测试脚本数量复核。

运行包没有 `single-flight.test.js`，运行时代码也没有对它的相对引用。真机再次出现该路径时，应按开发者工具缓存/文件句柄
问题恢复，不得手工补测试脚本。

## 真机验收边界

使用同一候选、同一微信会话逐步验证：微信登录 → 患者同步/显式切换 → 我的挂号/爽约 → 门诊费用只读 → 报告目录 → 普通资料读写。
每一步都要同时保存页面结果、客户端 requestId/traceId、服务端低敏事件和 Provider requestId（如有）。二维码、模拟器、健康检查
或本地测试都不能替代三层业务证据。支付、医保、退款、预约写入、患者绑定、二维码真实协议和 HIS 回写继续最后处理。
