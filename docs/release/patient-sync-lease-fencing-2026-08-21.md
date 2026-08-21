# 患者目录租约提交栅栏修正（2026-08-21）

> 本文记录新项目本地代码修正与测试证据，不代表 Provider、线上服务、微信真机或多就诊人切换已经验收。
> 本轮没有修改旧 Python 项目、旧服务、数据库、Redis，也没有触碰另一个会话维护的众阳自动化 adapter。

## 发现的问题

患者目录同步使用 `owner + provider + idempotencyKey` 的 durable operation ledger 和租约代次：

1. 页面 A 取得旧幂等键和租约后请求 Provider。
2. 旧租约到期，页面 B 使用不同幂等键取得新租约并访问 Provider。
3. 页面 A 的旧响应晚于租约到期返回。

原实现只在快照提交的最后一步按 `operationId + attemptCount + status=in_progress` 更新 operation。
不同幂等键接管时，旧 operation 行仍可能暂时保持 `in_progress`，所以旧响应会先修改患者资料、临床引用或 `directory_active`，
最后才因为完成更新失败而回滚不了已经发生的事务内前置写入风险。该行为不满足“旧响应不能重新激活新快照已停用患者”的业务不变量。

## 修正方案

服务层在 Provider 返回后重新采样 `completedAt`，而请求发出前采样的 `observedAt` 继续只用于快照顺序。
患者快照仓储在任何患者 upsert、引用清理或失效回收之前，必须在同一事务内锁定并同时确认：

- `operationId` 属于当前 owner/provider；
- operation 仍为 `in_progress`；
- `attemptCount` 与本次租约代次一致；
- `lease_until > completedAt`。

任何条件失败都返回 `PatientDirectorySnapshotStaleError`，不写患者表、不清理临床映射、不推进快照水位。
MySQL 查询使用时间条件，读回 operation 后再做一次时间校验；内存仓储保持相同领域语义，避免测试替身掩盖生产竞态。

## 代码与注释位置

- `apps/api/src/modules/patients/service.ts`：区分 Provider 请求发起时间和响应提交时间。
- `packages/domain/src/patients.ts`：记录 `completedAt` 的用途和不能替代 `observedAt` 的原因。
- `packages/persistence/src/mysql-repositories.ts`：事务内的 operation、代次和租约双重校验。
- `packages/persistence/src/repositories.ts`：内存仓储的等价 fail-closed 语义。

## 回归覆盖

- 内存仓储：不同幂等键接管后旧响应不能写入过期快照或改变原患者资料。
- MySQL 仓储：过期 operation 在患者写入前被拒绝；有效 operation 仍能在同一事务内完成快照和 operation。
- API service：`observedAt` 仍在 Provider 请求前采样，`completedAt` 在 Provider 返回后采样。

本轮本地定向结果：持久化包 86 项测试通过、domain 包 64 项测试通过、患者 API service 22 项测试通过、持久化类型检查通过。
这些结果只证明本地实现和测试夹具一致，不替代真实 MySQL 并发、众阳延迟响应、线上日志关联和微信真机页面证据。

## 后续验收边界

在取得当前 release 的真实 trace 前，不能把该修正写成线上并发已验证；仍需单独验收多页面刷新、真实租约到期、
第二位就诊人显式切换、inactive 恢复以及会话失效后的重新同步。支付、医保、预约写入、二维码和 HIS 回写继续保持关闭。
