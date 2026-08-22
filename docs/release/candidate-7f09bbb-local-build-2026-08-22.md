# 当前小程序候选 `7f09bbb` 构建与真机准入记录（2026-08-22）

> 本记录对应患者范围页面入口门禁收紧后的最新小程序运行包。它只更新小程序客户端候选，
> 服务端仍使用已验证的 `1e58bb66`；不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `1e58bb66bf24021d2b680eb5fd03abfec467989a` |
| 小程序客户端 | `7f09bbb` |
| 小程序构建来源 | `7f09bbb2cf32d4753795bcbc91fe23ec05eeeee6` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 本候选包含的业务修正

首页和“我的”页进入挂号、爽约、门诊费用、报告等患者范围页面时，入口现在必须同时满足：

1. 页面存在当前患者对象；
2. 当前患者的 `clinicalAccess` 为 `ready`；
3. 患者 ID 与当前 storage 的显式选择一致。

页面自身仍会再次执行 owner、会话代际、患者映射和响应校验。入口门禁只是提前阻断已失效的页面对象，
不能替代服务端授权，也不会静默切换到其他患者。

正式二维码仍必须等待医院扫码字段、签名、短期 TTL、撤销/防重放和扫码回执 contract，当前不生成二维码。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- 小程序定向测试 `217 pass / 0 fail / 1624 expect()`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- `dist/build-info.json` 来源指纹、14 个页面入口和测试脚本数量复核。

运行包没有 `single-flight.test.js`，运行时代码也没有对它的相对引用。真机再次出现该路径时，应按开发者工具
旧增量索引/文件句柄问题恢复，不得手工补测试脚本。

## 真机验收边界

使用同一候选、同一微信会话逐步验证：微信登录 → 患者同步/显式切换 → 我的挂号/爽约 → 门诊费用只读 → 报告目录 →
普通资料读写。每一步都要同时保存页面结果、客户端 requestId/traceId、服务端低敏事件和 Provider requestId（如有）。
二维码、模拟器、健康检查或本地测试都不能替代三层业务证据。支付、医保、退款、预约写入、患者绑定、二维码真实协议
和 HIS 回写继续最后处理。
