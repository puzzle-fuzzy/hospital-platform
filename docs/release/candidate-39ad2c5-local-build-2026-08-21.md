# 小程序当前候选 `39ad2c5` 本地构建记录（2026-08-21）

> 本记录锁定当前待真机验收的本地运行包，不代表小程序已经上传线上，也不代表微信、患者、Provider 或支付业务已经验收。

## 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `39ad2c5` |
| 小程序构建来源 | `39ad2c5937af2fdc735ffb223c0648464af3a48c` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面入口 | 14 个 |
| `dist/build-info.json` | `sourceRevision` 与上述完整来源一致；本次复核生成时间 `2026-08-21T02:22:25.620Z`（10:22:25 CST） |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |
| `single-flight.js` | 存在 |
| `single-flight.test.js` | 不存在，符合运行包边界 |

## 本次业务契约修正

统一个人资料的显示名校验改为按 Unicode code point 限制 1 至 64 个字符，避免 TypeBox `maxLength` 按 UTF-16 code unit 计数时把 64 个 emoji 误判为超长。孤立代理项、65 个 code point 以及其他非法输入仍会被拒绝；中文、emoji 和混合内容的边界测试已覆盖。

这项修正只影响公共资料 contract 和对应本地测试，不改变 owner 会话、患者上下文、Provider、数据库、Redis 或旧 Python 服务边界。服务端未部署，本候选只包含客户端运行包重新构建所需的当前仓库来源。

## ENOENT 运行包边界

`pnpm --filter @hospital/miniprogram build` 和 `pnpm --filter @hospital/miniprogram runtime:verify` 均已通过，生成的 `dist/` 不包含任何 `*.test.js` / `*.spec.js`，因此不能通过复制测试脚本处理开发者工具的旧增量索引错误。若开发者工具再次报告 `single-flight.test.js`，应关闭旧项目窗口、清理文件/编译缓存、确认 `miniprogramRoot=dist/` 后重新普通编译。

## 本地验证证据

| 检查 | 结果 |
| --- | --- |
| contracts 测试 | 2 项通过，27 个断言 |
| API 个人资料服务测试 | 13 项通过，53 个断言 |
| API 应用测试 | 40 项通过，240 个断言 |
| 原生小程序测试 | 171 项通过，1370 个断言 |
| 小程序构建 | 通过 |
| 运行包验证 | 通过，14 个页面齐全 |

## 当前验收边界

本候选必须重新生成真机二维码；此前其他候选的二维码和真机窗口不能用于本候选业务验收。真实微信登录、患者显式切换、预约历史、门诊费用、普通资料首次写入/409 冲突仍需页面、客户端请求和服务端低敏日志三层证据。

本轮没有进行 SSH 上传：当前 SSH 返回 `Permission denied (publickey,password)`。因此 `39ad2c5` 仍是本地构建来源，尚未发布到服务器或微信开发者工具真机运行包。支付、医保授权、退款、预约写入、患者绑定、报告 Provider 详情和 HIS 写回继续保持关闭；旧 Python 服务、线上 API、数据库和 Redis 未因本地构建被修改或重启。
