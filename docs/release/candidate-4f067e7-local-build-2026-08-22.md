# 当前小程序候选 `4f067e7` 构建与真机准入记录（2026-08-22）

> 本记录是当前小程序运行包入口。它证明运行包来源、年龄输入修正和开发者工具恢复边界，
> 不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `9f479c9a` |
| 小程序客户端 | `4f067e7b` |
| 小程序构建来源 | `4f067e7bb8b04e41a734ae4e6605f30c28a9c790` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 本候选新增的业务修正

个人资料年龄输入不再在输入事件中使用 `replace(/\D/g, "")` 静默改写用户输入。现在输入阶段保留原文，
保存边界只接受空值或 `0` 到 `150` 的十进制整数；`-1`、小数、科学计数法、字母和超范围值会在 PUT
之前被拒绝。实现和测试见 `apps/miniprogram/src/services/profile-form.ts` 与
`apps/miniprogram/src/services/profile-form.test.ts`。

这是一项小程序端修正，不需要部署或重启服务端，也没有触碰旧 Python `8001`、旧数据库、Redis 或 Provider
自动化代码。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- 小程序测试 `209 pass / 0 fail / 1566 expect()`；
- Markdown 文档链接审计 `484` 篇无断链。

运行包来源指纹已经写入 `dist/build-info.json`。构建排除测试源码，并在发布前拒绝测试脚本和缺失相对模块，
因此不能通过复制 `single-flight.test.js` 绕过 ENOENT。

## 开发者工具恢复顺序

1. 关闭当前真机调试会话和开发者工具窗口；
2. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`；
3. 确认 `miniprogramRoot` 为 `dist/`；
4. 执行一次普通编译，确认当前运行包来源为 `4f067e7b`；
5. 重新生成二维码后再扫码。

不要打开旧 `mp-weixin`、`src/` 或 `dist/` 作为项目根目录，不要继续使用旧二维码，也不要修改旧服务来处理本地
开发者工具缓存。

## 真机验收顺序与停止条件

使用同一候选、同一微信会话逐步验证：微信登录 → 患者同步/显式切换 → 我的挂号/爽约 → 门诊费用只读 →
普通资料读取与年龄保存。每一步都要同时保存页面结果、客户端 requestId/traceId、服务端低敏事件和 Provider
requestId（如有）。二维码、模拟器、健康检查或本地测试都不能替代三层业务证据。

如果出现会话失效、患者映射冲突、Provider 拒绝、数据服务暂时不可用或页面与日志不一致，立即停止当前业务域，
不能把异常降级为空列表或成功提示。支付、医保、退款、预约写入、患者绑定、二维码真实协议和 HIS 回写继续最后处理。
