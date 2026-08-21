# 小程序当前候选 `acf5a85` 本地构建记录（2026-08-21）

> 本记录锁定当前待真机验收的本地运行包，不代表小程序已经上传线上，也不代表微信、患者、Provider 或支付业务已经验收。

## 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `acf5a85` |
| 小程序构建来源 | `acf5a8596e70e1fb2b8d220a0b41eb69418ae086` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| `dist/build-info.json` | `sourceRevision` 与上述完整来源一致 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## 本次业务状态机修复

门诊缴费页在用户切换“待缴/已缴”时，如果请求返回 `401` 或依赖暂时不可用，页面现在会先更新 `sessionState` 为 `invalid/unavailable`，再清空费用列表。这样“更换就诊人”不会继续使用上一轮的 `valid` 状态错误放行；首次加载和 tab 切换共用同一会话状态语义。

对应回归门禁为 `outpatient payment tab failures refresh the session entry state`，本地小程序测试共 171 项通过、1366 个断言。

## ENOENT 运行包边界

`pnpm --filter @hospital/miniprogram build` 和 `pnpm --filter @hospital/miniprogram runtime:verify` 均通过；`dist/` 中不包含任何 `*.test.js` / `*.spec.js`，因此不能通过复制测试脚本处理开发者工具的旧增量索引错误。真机调试必须关闭旧二维码会话，在正确的 `miniprogram` 项目中重新普通编译并生成二维码。

## 当前验收边界

真机验收必须使用本候选，并按页面截图、客户端 requestId/HTTP 状态、服务端低敏事件三层记录。模拟器未登录访问 `/api/v2/me` 得到 `401` 属于预期认证边界，不能改为伪造会话或放宽鉴权。

支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 写回继续保持关闭；旧 Python 服务、线上 API、数据库和 Redis 未因本地构建被修改或重启。
