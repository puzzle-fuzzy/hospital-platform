# 当前小程序候选 `ec3e5f09` 本地构建记录（2026-08-21）

> 本文记录当前仓库提交 `ec3e5f094ecd0a85bbf98d4fc6ff9f14b27bb9ac` 的本地小程序运行包。
> 它尚未上传微信开发者工具线上代码包，也不代表真实微信登录、Provider 或真机业务已经验收。

## 本轮变更

患者范围只读页面在读取患者目录后重新验证 `/me` 的 owner：同一 owner 的 GET 会话恢复会采用最新会话代际继续组合读取；如果患者目录读取期间 owner 发生变化，或 owner 身份无法证明，则在预约历史、爽约、报告、门诊费用和报告详情业务请求前以 `session-changed` fail-closed。服务端、旧 Python 服务、线上配置、MySQL、Redis 和 Provider 自动化本轮未修改或调用。

## 构建证据

| 检查 | 结果 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `ec3e5f09` |
| 小程序构建来源 | `ec3e5f094ecd0a85bbf98d4fc6ff9f14b27bb9ac` |
| `pnpm --filter @hospital/miniprogram test` | 196 项通过，0 项失败，1490 个断言 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm exec biome check`（本轮源文件） | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个 `app.json` 页面脚本已发布 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过；来源为 `ec3e5f094ecd0a85bbf98d4fc6ff9f14b27bb9ac` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |
| 旧 Python 服务、线上配置、MySQL、Redis | 未修改、未重启 |

## 真机前操作

微信开发者工具必须关闭旧的增量调试状态，重新打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram\`，确认 `miniprogramRoot` 为 `dist/`，先普通编译，再基于本候选生成新二维码。
不要在 `dist/` 手工创建测试脚本；如果再次出现 `single-flight.test.js` ENOENT，按 [`miniprogram-runtime-enoent-recovery-2026-08-20.md`](miniprogram-runtime-enoent-recovery-2026-08-20.md) 刷新开发者工具的增量索引。

## 未完成门禁

微信登录、患者同步、多就诊人切换、预约历史/爽约/门诊费用的真机三层证据仍待人工采集；报告 Provider 目录/详情、二维码、支付、医保、退款、患者绑定和 HIS 写回继续保持关闭。静态测试和本地运行包验证不能替代页面截图、客户端 requestId/traceId 与服务端低敏日志的同链证据。
