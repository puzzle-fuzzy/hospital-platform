# 小程序候选 `767ed9c` 本地构建记录（2026-08-20）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端生产基线 | `0e360d3` |
| 小程序候选提交 | `767ed9c` |
| 运行包来源 | `767ed9c225bf4d329761f6abed7668015a2626b2` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- `pnpm --filter @hospital/miniprogram test`：167 项通过，0 项失败，1326 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- `pnpm docs:audit`：264 个文档，无断链。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0。
- 全仓 `pnpm check`：通过。

## 运行包边界修正

测试源码仍保留在 `src/services/`，供 Bun 测试执行；构建 staging 会递归拒绝测试脚本，
`runtime:verify` 也会在真机前再次拒绝。这样微信开发者工具不会把
`services/single-flight.test.js` 当作运行时依赖。详细故障与恢复步骤见
[`miniprogram-runtime-test-file-boundary-2026-08-20.md`](miniprogram-runtime-test-file-boundary-2026-08-20.md)。

## 真机状态

正确的 `miniprogram` 开发者工具项目已重新打开，模拟器首页正常，控制台没有
`single-flight.test.js` 错误，并生成了新的 iOS 真机调试二维码。到本记录生成时，服务端同一时间窗口
只收到健康检查，尚未收到 `/auth/wechat` 或 `/patients`，所以本候选仍不能标记为微信登录或患者同步真实验收通过。

下一步必须由真机扫描当前二维码，再同时保存页面、HTTP 和 journald 低敏事件；二维码、Provider、支付、医保和 HIS
均不因本地构建通过而开放。
