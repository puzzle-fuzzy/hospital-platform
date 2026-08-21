# 服务端候选 `9bc1638d` 本地构建记录（2026-08-22）

> 本记录只描述仓库本地候选的代码、测试和运行包证据。它没有把候选上传或切换到线上，不能替代生产 preflight、真实 MySQL/Redis/schema 复核、微信真机或 Provider 业务验收。

## 1. 候选边界

| 项目 | 结果 |
| --- | --- |
| 服务端本地候选 | `9bc1638d718d90cc222452530212881745b6a5045` |
| 服务端线上基线 | 仍以路线图和生产验收文档记录的 `9f491cb5` 为准；本轮未切换 |
| 小程序运行包来源 | `13b86a5a400ca0ccbee67abdfed726476a4749d4` |
| 旧 Python 服务 | 未修改、未重启 |
| 数据库/Redis | 本轮未迁移、未写入、未清理 |

## 2. 本候选修正

普通资料更新现在同时满足两层版本条件：

1. MySQL 仓储在同一事务中完成 owner 锁定、条件更新和 canonical 回读；
2. service 再确认返回版本必须严格等于 `expectedVersion + 1`。

如果仓储或未来实现返回了更晚的并发快照，service 会按既有版本冲突语义失败，不记录
`user.profile.updated` 成功事件，也不把后续设备的资料误报成当前请求成功写入的结果。

这层后置条件不能被 TypeScript 类型替代：仓储、回放器和测试替身都属于运行时边界，
必须证明本次 PUT 确实提交了期望的下一版本，才能向小程序返回成功资料快照。

## 3. 本地验证证据

| 检查 | 结果 |
| --- | --- |
| API 资料 service 定向测试 | 16 pass，64 个断言 |
| API workspace 全量测试 | 204 pass，846 个断言 |
| 小程序运行包构建 | 通过，14 个页面入口生成完整 JavaScript |
| 小程序运行包核验 | 通过；`dist/services/single-flight.js` 存在，`single-flight.test.js` 不存在，测试运行脚本数量为 0 |
| 全仓 `pnpm check` | 通过；架构、迁移、Provider、文档、格式、lint、工具、类型、测试和构建门禁均通过 |
| 文档断链审计 | 通过；当前仓库文档无断链 |

## 4. 真机与线上停止条件

当前候选仍不能宣称普通资料真实完成，尚缺：

- 当前线上 release 使用本候选后的真实 production preflight 和隔离 runtime smoke；
- 真实微信会话下 `GET/PUT /me/profile` 首次更新、默认值和合法性边界；
- 两个并发资料编辑者的 `409 user-profile-conflict`；
- 真机资料页面与服务端低敏日志的同链证据。

若要部署，只能按新 API 的 release runbook 上传独立 release、执行真实生产配置 preflight、
用临时端口隔离 smoke，再原子切换新 API `current` 并重启 `hospital-platform-api-v2.service`。
旧 Python `8001` 不参与切换、回滚或重启；支付、医保、退款和 HIS 写回仍保持关闭。
