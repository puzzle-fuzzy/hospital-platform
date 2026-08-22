# 当前小程序候选 `7f09bbb` 构建与真机准入记录（2026-08-22）

> 本记录对应患者范围页面入口门禁收紧后的最新小程序运行包。当前配套服务端已切换为
> `84370077024762d92050cf077c27f3c60302e8f8`；不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `84370077024762d92050cf077c27f3c60302e8f8` |
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

医院业务二维码仍必须等待扫码字段、签名、短期 TTL、撤销/防重放和扫码回执 contract，当前不开放业务二维码；开发者工具
调试二维码只用于真机取证，不能被当作医院业务二维码或业务完成证据。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- 小程序定向测试 `217 pass / 0 fail / 1624 expect()`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- `dist/build-info.json` 来源指纹、14 个页面入口和测试脚本数量复核。

运行包没有 `single-flight.test.js`，运行时代码也没有对它的相对引用。真机再次出现该路径时，应按开发者工具
旧增量索引/文件句柄问题恢复，不得手工补测试脚本。

## 2026-08-22 17:27 CST 当前候选复核

本轮在未修改旧项目、旧服务、数据库或 Redis 的前提下重新执行：

- `pnpm release:baseline:audit`：通过，服务端 `84370077` 与小程序 `7f09bbb` 来源一致；
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过，14 个页面入口和根文件齐全；
- `pnpm check`：通过，架构、迁移、Provider、日志、文档、类型检查、测试和构建均无失败；
- `dist/`：仍不存在 `single-flight.test.js`、`*.test.js` 和 `*.spec.js`。

开发者工具当前显示的是 `7f09bbb` 候选的 iOS/局域网调试二维码，尚未检测到手机连接；因此本次没有新增微信登录、
患者同步、预约、门诊费用或报告的真机三层证据。二维码调试会话只证明工具入口可用，不能替代页面、客户端 HTTP 和服务端
Pino 同链证据。

## 真机验收边界

使用同一候选、同一微信会话逐步验证：微信登录 → 患者同步/显式切换 → 我的挂号/爽约 → 门诊费用只读 → 报告目录 →
普通资料读写。每一步都要同时保存页面结果、客户端 requestId/traceId、服务端低敏事件和 Provider requestId（如有）。
二维码、模拟器、健康检查或本地测试都不能替代三层业务证据。支付、医保、退款、预约写入、患者绑定、二维码真实协议
和 HIS 回写继续最后处理。

## 2026-08-22 17:35 CST 运行包 ENOENT 恢复复核

针对再次出现的 `dist/services/single-flight.test.js` ENOENT，本轮重新构建当前候选并关闭/重开了新项目开发者工具窗口，
随后完成普通编译并重新生成 iOS/局域网真机调试二维码。`dist/services/single-flight.js` 存在，测试脚本仍为 0 个，
模拟器恢复首页，控制台没有该路径错误。旧 `mp-weixin` 窗口没有操作；当前二维码等待手机扫码，尚无新的真机业务三层证据。
