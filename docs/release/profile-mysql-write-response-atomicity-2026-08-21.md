# 普通资料 MySQL 写入响应原子性修正（2026-08-21）

## 发现的问题

普通资料更新原先虽然使用了 `expectedVersion` 条件更新，但流程是：

```text
读取当前资料 -> UPDATE ... WHERE version = expectedVersion -> 事务外再次 SELECT
```

最后一次读取不在同一事务内。两个设备同时修改同一用户资料时，先完成写入的请求可能在回读前被后一个设备再次更新，导致前一个 `PUT` 返回后一个设备的资料和版本。这样没有发生跨用户越权，但破坏了“成功响应就是本次写入后的 canonical 快照”这一资料 contract，也会让小程序把错误版本保存到页面状态。

## 修正后的不变量

- `version=0` 的首次插入、冲突判断和成功后的回读都在同一 MySQL 事务内；重复插入仍返回版本冲突。
- 已有资料先使用 `SELECT ... FOR UPDATE` 锁定当前用户行，再检查 `expectedVersion`，然后执行条件更新。
- 成功响应在同一事务连接内回读，并要求返回版本严格等于 `expectedVersion + 1`。
- 如果事务内回读返回非本次版本，直接回滚并返回 `UserProfileVersionConflictError`，不把不确定快照包装成 200 成功。
- `findByUserId` 的普通只读路径不变；API owner、字段白名单、版本号和 409 contract 不变。

核心代码在 `packages/persistence/src/mysql-repositories.ts`，中文注释说明了行锁、版本判断和响应快照必须处于同一保护范围的原因。

## 本地证据

| 检查项 | 结果 |
| --- | --- |
| persistence 测试 | 87 pass / 0 fail / 584 expects |
| 新增回归 | 后续版本快照必须回滚并返回版本冲突 |
| persistence typecheck | 通过 |
| API profile service 测试 | 15 pass / 0 fail / 61 expects |
| 真实 MySQL 并发验收 | 尚未执行 |

新增回归使用测试替身模拟事务内出现更晚版本，要求未提交事务、发生 rollback，并确认读取和响应路径使用 `FOR UPDATE`。这不是对真实 MySQL 并发的替代；真实验收仍需两个受控会话在当前候选上同时提交资料，并关联 HTTP `requestId`、服务端 `traceId` 和最终版本。

本次只修改新项目代码和测试，未部署、未重启服务、未修改旧 Python 项目、线上 MySQL 或 Redis。支付、医保、HIS、预约写入和 Provider 写操作继续保持关闭。
