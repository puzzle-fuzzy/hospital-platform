# 小程序历史候选 `9340846` 本地构建记录（2026-08-21）

> 本记录已被当前候选 [`candidate-6677671-local-build-2026-08-21.md`](candidate-6677671-local-build-2026-08-21.md) 替代，仅用于追溯，不得用于新的真机验收。

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

## 2026-08-21 07:20 CST ENOENT 复核

针对开发者工具曾报告的 `dist/services/single-flight.test.js`，在当前候选上重新执行了完整的小程序运行包构建与只读验证：

- `pnpm --filter @hospital/miniprogram build` 通过，运行包来源仍为 `93408462f3eeadffed172f1ea3b10c043d461b1b`；
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过，14 个页面入口和根文件齐全；
- `dist/` 中 `*.test.js` / `*.spec.js` 数量为 0，`single-flight.js` 存在，`single-flight.test.js` 不存在；
- 小程序定向测试为 170 项通过、0 项失败、1364 个断言通过。

因此该路径只能来自开发者工具旧的增量模块索引或旧真机调试会话，不能通过复制测试脚本修复。必须先普通编译当前 `dist/`，再重新生成真机调试二维码。

## 2026-08-21 07:39 CST 开发者工具诊断复核

开发者工具的“调试器”面板显示 `1 error / 3 warnings`，展开后得到的唯一错误是：

```text
GET https://test-hp.meiyi.pro/api/v2/me 401
```

这是模拟器没有建立平台会话时访问当前用户接口的预期认证结果，不是页面脚本、运行包文件或服务端崩溃。开发者工具的“问题”面板为 `0`；其余 3 条是微信基础库关于 HarmonyOS/文章推荐的系统提示，不属于项目业务错误。

因此不能为了清除该诊断而把未登录 `/me` 改成 `200`、绕过 Bearer 鉴权或在客户端伪造会话。真机扫码建立有效会话后，必须重新以实际登录请求和服务端低敏日志验证该入口。

## 本候选验证

- 小程序 170 项测试、1364 个断言通过；全仓 typecheck 通过。
- `pnpm --filter @hospital/miniprogram build` 通过，发布过程完成 staging 后再替换运行包。
- `pnpm --filter @hospital/miniprogram runtime:verify` 通过，14 个页面脚本和根入口齐全。
- 本次提交只包含会话恢复逻辑的格式整理；GET 二次 `401` 的同会话代际失效令牌清理语义保持不变，写入命令仍禁止自动重放。

## 运行与验收边界

该候选仍只调用 `wx.login()` 获取一次性 code，不隐式申请头像、昵称等资料授权。真机必须从本候选重新普通编译并扫码，保存页面、客户端请求号和服务端低敏日志三层证据。

支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 写回继续保持关闭；旧 Python 服务、线上 API、数据库和 Redis 未因本地构建被修改或重启。
