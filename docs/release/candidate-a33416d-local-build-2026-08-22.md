# 当前小程序候选 `a33416d` 构建与真机准入记录（2026-08-22）

> 本记录替代 `candidate-9eb672b` 作为当前人工入口。它证明运行包来源、测试脚本隔离和
> 患者加载状态修正，不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `9f479c9a` |
| 小程序客户端 | `a33416d8` |
| 小程序构建来源 | `a33416d8417661fa5256deb22df55a97456cc608` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 本候选包含的业务修正

预约记录和门诊缴费页面在读取 `/me`、患者目录和业务列表期间，会暂时清空旧患者上下文以避免身份错配。
本候选把这段临时状态明确显示为“正在加载就诊人...”；只有本轮读取结束且没有患者时，才显示“请先选择就诊人”。
这样不会把网络等待误报为登录失败或患者未选择。对应的业务不变量、中文注释和 acceptance 门禁已同步更新。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- 小程序测试 `211 pass / 0 fail / 1575 expect()`；
- Markdown 文档链接审计 `489` 篇无断链；
- 当前 `dist/build-info.json` 来源指纹、14 个页面入口和测试脚本数量复核。

运行包没有 `single-flight.test.js`，运行时代码也没有对它的相对引用。真机再次出现该路径时，应按开发者工具缓存/文件句柄
问题恢复，不得手工补测试脚本。

## 真机验收边界

使用同一候选、同一微信会话逐步验证：微信登录 → 患者同步/显式切换 → 我的挂号/爽约 → 门诊费用只读 → 普通资料读写。
每一步都要同时保存页面结果、客户端 requestId/traceId、服务端低敏事件和 Provider requestId（如有）。二维码、模拟器、健康检查
或本地测试都不能替代三层业务证据。支付、医保、退款、预约写入、患者绑定、二维码真实协议和 HIS 回写继续最后处理。
