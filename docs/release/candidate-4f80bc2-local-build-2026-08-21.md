# 当前小程序候选构建记录（`4f80bc2`，2026-08-21）

本候选由提交 `4f80bc2f313fbcac9fc4e976006ae2c356ce2729` 生成。本轮修正 App 入口的会话恢复边界：`app.ts` 不再把本地缓存 token 直接写入全局或标记为已登录，统一由会话服务完成 token 校验和服务端 `/me` 验证后再建立会话事实。服务端、旧 Python 服务、线上配置、MySQL 和 Redis 均未因本次本地构建而修改或重启。

| 基线项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `4f80bc2` |
| 小程序构建来源 | `4f80bc2f313fbcac9fc4e976006ae2c356ce2729` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 本地验证

2026-08-21 本候选已完成小程序全量测试、全仓 `pnpm check`、小程序构建和独立 `runtime:verify`。并行会话维护的 `apps/miniprogram/project.config.json` 和 `.codegraph/` 未纳入本候选。

| 项目 | 结果 |
| --- | --- |
| 小程序全量测试 | 185 项通过，0 项失败，1456 个断言 |
| 小程序 typecheck | 通过 |
| 小程序 Biome | 通过 |
| 小程序 build | 通过；14 个页面运行脚本已发布 |
| `runtime:verify` | 通过；来源为完整 `4f80bc2f313fbcac9fc4e976006ae2c356ce2729` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

## 业务边界

本候选只收紧客户端本地会话恢复边界，不改变服务端 API contract，不开放新的业务域。真机微信登录、患者显式切换、预约历史、爽约和门诊费用仍需要页面、客户端请求和服务端低敏日志三层证据；支付、医保结算、预约写入、患者绑定、报告 Provider 详情、HIS 回写和二维码协议继续关闭。

如再次出现 `dist/services/single-flight.test.js`，不要复制测试文件到运行包；应关闭旧真机调试、重新打开 `apps/miniprogram/`、普通编译并重新生成二维码，按 ENOENT 恢复记录刷新开发者工具的增量索引。
