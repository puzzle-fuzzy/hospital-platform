# 当前小程序候选构建记录（`f66514d`，2026-08-21）

本候选由提交 `f66514de81c051cb8ade1477f758700b2837b9b7` 生成。它统一了“我的”页面与共享会话代际门禁，
同步修正了当前候选导航和 ENOENT 恢复文档；服务端、旧 Python 服务、线上配置、MySQL 和 Redis 均未因本次本地构建而修改或重启。

| 基线项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `f66514d` |
| 小程序构建来源 | `f66514de81c051cb8ade1477f758700b2837b9b7` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 本地验证

| 项目 | 结果 |
| --- | --- |
| 小程序全量测试 | 176 项通过，0 项失败，1398 个断言 |
| `pnpm --filter @hospital/miniprogram typecheck` | 通过 |
| `pnpm --filter @hospital/miniprogram build` | 通过；14 个页面运行脚本已发布 |
| `pnpm --filter @hospital/miniprogram runtime:verify` | 通过 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |
| `pnpm check` | 通过；全仓架构、迁移、Provider、文档、格式、lint、typecheck、测试和 build 门禁均通过 |

## 本轮业务边界修正

“我的”页面不再维护私有的会话代际错误实现，而是与预约历史、爽约、报告目录、门诊费用和报告详情页面统一使用
`assertSessionGeneration`。普通资料读取失败时仍保留原始认证/依赖错误语义；只有检测到当前仍有新会话时，才按混合快照风险 fail-closed，
避免把旧账号资料、患者目录和新账号会话拼在同一页面。

当前候选文档导航已从历史 `4e82313` 统一推进到本候选；历史候选文件继续保留用于追溯。

## 真机验收边界

本候选只证明本地运行包、类型、测试、来源和全仓门禁正确，尚未证明手机扫码后的微信登录、患者同步、预约历史、爽约或门诊费用
已经完成真机三层验收。继续验收时必须关闭旧真机调试会话，普通编译当前 `dist/`，再生成与 `f66514d` 对应的新二维码，
同时记录页面结果、客户端 `requestId` 和服务端低敏日志。若再次出现 `dist/services/single-flight.test.js`，不要补测试文件，
应按 ENOENT 恢复记录刷新开发者工具模块索引。
