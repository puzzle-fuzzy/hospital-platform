# 小程序当前候选 `6677671` 本地构建记录（2026-08-21）

> 本记录锁定当前待真机验收的本地运行包，不代表小程序已经上传线上，也不代表微信、患者、Provider 或支付业务已经验收。

## 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `6677671` |
| 小程序构建来源 | `667767123efdb5b3a0bedbe423ab1797f16b1247` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| `dist/build-info.json` | `sourceRevision` 与上述完整来源一致 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## ENOENT 复核结果

针对开发者工具曾报告的 `dist/services/single-flight.test.js`，已按当前候选重新构建并执行只读验证：

- `pnpm --filter @hospital/miniprogram build` 通过，运行包来源为 `667767123efdb5b3a0bedbe423ab1797f16b1247`；
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过，14 个页面入口和根文件齐全；
- `dist/` 中 `*.test.js` / `*.spec.js` 数量为 0，`single-flight.js` 存在，`single-flight.test.js` 不存在；
- 测试源码仍由 Bun 测试命令执行，但不会复制到微信运行包。

因此该路径不是需要补入运行包的业务脚本，而是开发者工具旧增量模块索引或旧真机调试会话的残留引用。请关闭旧真机调试和旧 `miniprogram` 窗口，重新普通编译当前 `apps/miniprogram/`，确认项目根为 `dist/` 后再生成二维码。

## 当前验收边界

真机验收必须使用本候选，并按页面截图、客户端 requestId/HTTP 状态、服务端低敏事件三层记录。模拟器未登录访问 `/api/v2/me` 得到 `401` 属于预期认证边界，不能改为伪造会话或放宽鉴权。

支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 写回继续保持关闭；旧 Python 服务、线上 API、数据库和 Redis 未因本地构建被修改或重启。
