# 当前小程序候选构建记录（`03d9d25`，2026-08-21）

本候选由提交 `03d9d25d80d5a5d872a9137c7df0aa19a91ba38f` 生成。本轮收紧首页患者初始化时序：登录恢复或主动登录后的第一次 `/patients` 读取只作为流程前置检查，不在医院侧临床同步完成前恢复 `selectedPatient`；只有完整同步成功后，首页才重新解析并展示当前就诊人。服务端、旧 Python 服务、线上配置、MySQL 和 Redis 均未因本次本地构建而修改或重启。

| 基线项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `03d9d25` |
| 小程序构建来源 | `03d9d25d80d5a5d872a9137c7df0aa19a91ba38f` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 本地验证

本候选已完成小程序 typecheck、全量测试、Biome、构建和独立 `runtime:verify`。并行会话维护的 `apps/miniprogram/project.config.json` 和 `.codegraph/` 未纳入本候选。

| 项目 | 结果 |
| --- | --- |
| 小程序全量测试 | 186 项通过，0 项失败，1461 个断言 |
| 小程序 typecheck | 通过 |
| 小程序 Biome | 通过 |
| 小程序 build | 通过；14 个页面运行脚本已发布 |
| `runtime:verify` | 通过；来源为完整 `03d9d25d80d5a5d872a9137c7df0aa19a91ba38f` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

## 业务边界

本候选只收紧客户端会话恢复与患者上下文初始化边界，不改变服务端 API contract，不开放新的业务域。真机微信登录、患者显式切换、预约历史、爽约和门诊费用仍需要页面、客户端请求和服务端低敏日志三层证据；支付、医保结算、预约写入、患者绑定、报告 Provider 详情、HIS 回写和二维码协议继续关闭。

如再次出现 `dist/services/single-flight.test.js`，不要复制测试文件到运行包；应关闭旧真机调试、重新打开 `apps/miniprogram/`、普通编译并重新生成二维码，按 ENOENT 恢复记录刷新开发者工具的增量索引。
