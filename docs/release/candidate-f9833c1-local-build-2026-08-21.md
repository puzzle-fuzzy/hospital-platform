# 当前小程序候选构建记录（`f9833c1`，2026-08-21）

本候选由提交 `f9833c11ef0d49591fd14f99ce60ad92d800156a` 生成。本轮收紧本地会话缓存边界：开发者工具旧缓存、手工写入或异常中断产生的空白、控制字符和超长 token 不再被恢复，也不会进入 `Authorization`；只有通过与微信登录响应相同运行时校验的 token 才能发出受保护请求，并补充真实请求链路测试。服务端、旧 Python 服务、线上配置、MySQL 和 Redis 均未因本次本地构建而修改或重启。

| 基线项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `f9833c1` |
| 小程序构建来源 | `f9833c11ef0d49591fd14f99ce60ad92d800156a` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 本地验证

2026-08-21 本候选已完成全仓 `pnpm check`、小程序构建和独立 `runtime:verify`。并行会话维护的 `apps/miniprogram/project.config.json` 和 `.codegraph/` 未纳入本候选。

| 项目 | 结果 |
| --- | --- |
| 小程序全量测试 | 184 项通过，0 项失败，1453 个断言 |
| 小程序 typecheck | 通过 |
| 小程序 Biome | 通过 |
| 小程序 build | 通过；14 个页面运行脚本已发布 |
| `runtime:verify` | 通过；来源为完整 `f9833c11ef0d49591fd14f99ce60ad92d800156a` |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 必须不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 必须为 0 个 |

## 业务边界

本候选只收紧客户端本地会话恢复和认证请求头边界，不改变服务端 API contract，不开放新的业务域。真机微信登录、患者显式切换、预约历史、爽约和门诊费用仍需要页面、客户端请求和服务端低敏日志三层证据；支付、医保结算、预约写入、患者绑定、报告 Provider 详情、HIS 回写和二维码协议继续关闭。

如再次出现 `dist/services/single-flight.test.js`，不要复制测试文件到运行包；应关闭旧真机调试、重新打开 `apps/miniprogram/`、普通编译并重新生成二维码，按 ENOENT 恢复记录刷新开发者工具的增量索引。
