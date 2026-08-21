# 当前小程序候选构建记录（`aafccf5`，2026-08-21）

本候选由提交 `aafccf53d1e0eaac5ddaf98b1d850b084e4f78ed` 生成，收紧预约历史、爽约记录、报告目录和门诊费用四个只读列表页面的“加载更多”旧事件边界。刷新、切换患者或会话漂移期间抵达的旧 WXML 事件不能继续展开失去上下文的本地读模型；所有列表仍是一次完整只读查询后的本地渲染窗口，不是 Provider 分页。服务端、旧 Python 服务、线上配置、MySQL 和 Redis 均未因本次本地构建而修改或重启。

| 基线项目 | 值 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序客户端 | `aafccf5` |
| 小程序构建来源 | `aafccf53d1e0eaac5ddaf98b1d850b084e4f78ed` |
| 运行包目录 | `apps/miniprogram/dist/` |

## 本地验证

| 项目 | 结果 |
| --- | --- |
| 小程序全量测试 | 180 项通过，0 项失败，1438 个断言 |
| 小程序 typecheck | 通过 |
| 小程序 Biome | 通过 |
| 小程序 build | 通过；14 个页面运行脚本已发布 |
| `runtime:verify` | 通过 |
| `dist/services/single-flight.js` | 存在 |
| `dist/services/single-flight.test.js` | 不存在 |
| `dist/` 中 `*.test.js` / `*.spec.js` | 0 个 |

## 业务边界

本候选只证明本地代码、测试、来源和运行包门禁正确，尚未证明真机微信登录、患者显式切换、预约历史、爽约或门诊费用的三层业务证据。支付、医保结算、退款、预约写入、患者绑定、报告 Provider 详情、HIS 回写和二维码协议不在本候选开放范围内。

如再次出现 `dist/services/single-flight.test.js`，不要复制测试文件到运行包；应关闭旧真机调试、重新打开 `apps/miniprogram/`、普通编译并重新生成二维码，按 ENOENT 恢复记录刷新开发者工具的增量索引。
