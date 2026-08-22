# 当前小程序候选 `5e43aed` 构建与真机准入记录（2026-08-22）

> 本记录对应首页二维码患者上下文门禁收紧后的最新小程序运行包。它只更新小程序客户端候选，
> 服务端仍使用已验证的 `1e58bb66`；不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `1e58bb66bf24021d2b680eb5fd03abfec467989a` |
| 小程序客户端 | `5e43aed` |
| 小程序构建来源 | `5e43aed0e026cd48d980d58c468223b9a5ee8744` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 本候选包含的业务修正

首页二维码入口仍保持关闭态，但提示前的患者上下文判断现在必须同时满足：

1. 页面存在当前患者对象；
2. 当前患者的 `clinicalAccess` 为 `ready`；
3. 页面对象的内部 `patientId` 与当前 storage 的显式选择一致。

这样可以避免页面停留期间发生账号切换、会话失效或目录刷新失败时，把旧对象误认为当前就诊人。
正式二维码仍必须等待医院扫码字段、签名、短期 TTL、撤销/防重放和扫码回执 contract，当前不生成二维码。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- 小程序定向测试 `216 pass / 0 fail / 1620 expect()`；
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
