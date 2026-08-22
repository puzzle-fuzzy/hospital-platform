# 当前小程序候选 `9eb672b` 构建与真机准入记录（2026-08-22）

> 本记录是当前小程序运行包入口。它证明运行包来源、测试脚本隔离和开发者工具锁定恢复边界，
> 不代表微信、众阳 Provider、真机业务、支付或医保已经验收。

| 项目 | 值 |
| --- | --- |
| 服务端 release | `9f479c9a` |
| 小程序客户端 | `9eb672b1` |
| 小程序构建来源 | `9eb672b1296f282fc536f72bb897631683e4532f` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| 真机业务状态 | 尚未取得当前候选的页面、客户端 HTTP、服务端日志三层同链证据 |

## 本候选包含的工程修正

构建发布层现在会在 TypeScript 编译、运行包依赖扫描和原子目录替换前完成全部门禁。若微信开发者工具仍持有
`dist/` 文件句柄，构建会明确报告可恢复的锁定错误，并保留上一份完整运行包；不会清空目录，也不会把测试脚本复制到运行包。

这项修正只影响新小程序的构建和维护提示，不需要部署或重启服务端，也没有触碰旧 Python `8001`、旧数据库、Redis、Provider
自动化或并行会话维护的众阳代码。

## 构建与运行包证据

本候选已通过：

- `pnpm --filter @hospital/miniprogram typecheck`；
- `pnpm --filter @hospital/miniprogram build`；
- `pnpm --filter @hospital/miniprogram runtime:verify`；
- 小程序测试 `210 pass / 0 fail / 1571 expect()`；
- Markdown 文档链接审计 `486` 篇无断链；
- 当前 `dist/build-info.json` 来源指纹、14 个页面入口和测试脚本数量复核。

运行包没有 `single-flight.test.js`，运行时代码也没有对它的相对引用。真机再次出现该路径时，应按开发者工具缓存/文件句柄
问题恢复，不得手工补测试脚本。

## 开发者工具恢复顺序

1. 停止当前真机调试会话；
2. 关闭所有指向该项目的微信开发者工具窗口，等待 `wechatdevtools.exe` 完全退出；
3. 重新执行 `pnpm --filter @hospital/miniprogram build` 和 `pnpm --filter @hospital/miniprogram runtime:verify`；
4. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，确认 `miniprogramRoot` 为 `dist/`；
5. 普通编译并从当前候选重新生成二维码，再开始扫码验收。

不要打开旧 `mp-weixin`、`src/` 或 `dist/` 作为项目根目录，不要继续使用旧二维码；构建失败时也不要在工具仍运行时手工删除或移动 `dist/`。

## 真机验收顺序与停止条件

使用同一候选、同一微信会话逐步验证：微信登录 → 患者同步/显式切换 → 我的挂号/爽约 → 门诊费用只读 → 普通资料读写。
每一步都要同时保存页面结果、客户端 requestId/traceId、服务端低敏事件和 Provider requestId（如有）。二维码、模拟器、健康检查
或本地测试都不能替代三层业务证据。

如果出现会话失效、患者映射冲突、Provider 拒绝、数据服务暂时不可用或页面与日志不一致，立即停止当前业务域，不能把异常降级为空列表
或成功提示。支付、医保、退款、预约写入、患者绑定、二维码真实协议和 HIS 回写继续最后处理。
