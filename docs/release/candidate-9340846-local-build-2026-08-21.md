# 小程序当前候选 `9340846` 本地构建记录（2026-08-21）

> 本记录锁定当前待真机验收的本地运行包，不代表小程序已经上传线上，也不代表微信、患者、Provider 或支付业务已经验收。

## 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `9340846` |
| 小程序构建来源 | `93408462f3eeadffed172f1ea3b10c043d461b1b` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| `dist/build-info.json` | `sourceRevision` 与上述完整来源一致 |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## 本候选验证

- 小程序 170 项测试、1364 个断言通过；全仓 typecheck 通过。
- `pnpm --filter @hospital/miniprogram build` 通过，发布过程完成 staging 后再替换运行包。
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过，14 个页面脚本和根入口齐全。
- 本次提交只包含会话恢复逻辑的格式整理；GET 二次 `401` 的同会话代际失效令牌清理语义保持不变，写入命令仍禁止自动重放。

## 运行与验收边界

该候选仍只调用 `wx.login()` 获取一次性 code，不隐式申请头像、昵称等资料授权。真机必须从本候选重新普通编译并扫码，保存页面、客户端请求号和服务端低敏日志三层证据。

支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 写回继续保持关闭；旧 Python 服务、线上 API、数据库和 Redis 未因本地构建被修改或重启。
