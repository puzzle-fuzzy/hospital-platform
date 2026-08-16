# 患者目录同步幂等契约

> 状态：`draft`，本文件是下一步实现的冻结边界；在 migration、仓储和 API
> 测试完成前，不代表当前线上接口已经具备 durable 幂等。
>
> 适用接口：`POST /api/v2/patients/sync`。本契约只处理“从 provider 读取完整患者目录并
> 替换当前 owner 快照”的同步命令，不延伸到患者建档、绑卡、预约写入或支付。

## 1. 为什么必须单独做

当前接口已经要求 `Idempotency-Key`，但现阶段这个值只进入 API/provider 请求上下文：

- API 进程重启后没有操作记录，重复提交仍可能再次访问 provider；
- 两个进程可以同时读取 provider，再分别尝试写入同一个患者目录；
- provider 返回成功后，如果进程在快照事务与请求完成之间崩溃，下一次请求无法判断上一次是否已经完成；
- 如果没有明确的 owner 绑定，两个用户提交相同 key 可能错误共享结果。

因此，不能沿用支付订单的“查已有结果并返回”口径，也不能只在内存中增加一个 Map。同步幂等必须是
MySQL 中按用户、provider、key 隔离的操作事实，并且和目录快照的最终提交具有一致的事务边界。

## 2. 幂等键和业务指纹

### 2.1 唯一范围

一次操作的唯一范围是：

```text
(ownerUserId, provider, idempotencyKey)
```

`ownerUserId` 只能从 Bearer 会话解析；`provider` 由服务端路由固定为 `zhongyang`；小程序不能提交
这两个归属字段。`Idempotency-Key` 只接受长度 1 至 128 的安全 token 字符（`A-Z`、`a-z`、`0-9`、`.`、`_`、`:`、`-`），不能进入 URL、日志正文
或 provider 患者查询参数。

### 2.2 当前请求没有 body，因此不增加客户端指纹

患者同步当前没有请求体，操作语义固定为“同步当前 owner 的众阳患者目录”。后续若增加日期窗口、
院区或其他业务输入，必须把规范化后的输入摘要加入操作指纹，并在相同 key 对应不同摘要时返回
`patient-sync-idempotency-conflict`，不能静默复用旧结果。

## 3. 状态机

```text
                 provider/DB 成功且同一事务提交
       +----------------------------------------------+
       |                                              v
  absent --insert--> in_progress --lease takeover--> in_progress
                          |                              |
                          | provider/DB 失败             |
                          | lease 到期后可重新执行       |
                          +------------------------------+

  succeeded --same owner/provider/key--> replay current owner read model
```

### 状态定义

| 状态 | 含义 | 对重复请求的处理 |
| --- | --- | --- |
| `in_progress` | 已经有一个同步请求占用 key，尚未完成目录快照事务 | 租约未到期返回 `409 patient-sync-in-progress`，不再次访问 provider；租约到期后原子接管执行权 |
| `succeeded` | provider 完整目录和当前患者快照已经在同一事务中提交 | 不再访问 provider，按 owner 返回当前患者读模型，记录一次低敏 replay 日志 |

失败不作为永久成功缓存。provider 明确失败、响应不完整或数据库事务回滚时，操作保留为可恢复的
`in_progress`，直到租约到期；之后同一 key 可以接管重试。这样既不会把一次暂时失败永久锁死，
也不会在前一个请求仍可能写入时盲目并发重试。

> 重要边界：`succeeded` 的 replay 保护 provider 不被重复调用，并保证业务结果仍来自当前 owner
> 的平台读模型；它不是把 provider 原始响应永久保存后逐字节重放。若未来要求审计级的历史响应重放，
> 必须另建带保留期限的快照历史表，不能把当前 `hp_patients` 记录冒充历史快照。

## 4. 事务和并发规则

### 4.1 开始操作

仓储在 MySQL 中执行一个短事务：

1. 按 `(owner_user_id, provider_name, idempotency_key)` 唯一索引读取并锁定操作行；
2. 没有记录时插入 `in_progress` 和 `lease_until`；
3. 已有 `succeeded` 时返回 `replay`；
4. 已有未过期 `in_progress` 时返回 `in_progress`；
5. 已有过期 `in_progress` 时增加 `attempt_count`、刷新租约并返回 `started`；
6. 事务提交后，只有拿到 `started` 的请求才能访问 provider。

插入竞争必须依靠数据库唯一约束处理，不能只依赖“先 SELECT 再 INSERT”。唯一键冲突后必须重新
读取并按状态分支，不能把 SQL duplicate error 直接转换成 500。

### 4.2 完成同步

`replaceDirectorySnapshot` 接受本次 operation 的内部标识和租约代次，并在**同一个 MySQL 事务**中完成：

1. 按 provider 患者号 upsert 本次完整目录；
2. 仅将同 owner/provider 下、`directory_last_seen_at` 早于本次 `observedAt` 且未出现的患者标记 inactive；
3. 查询本次 owner 的 active 读模型；
4. 仅当 `operation_id`、owner、provider 和 `attempt_count` 都仍然匹配时，把操作状态从 `in_progress` 更新为 `succeeded`，写入 `observed_at`、`completed_at` 和结果摘要；
5. 任意一步失败都回滚患者状态和操作状态，不能留下“目录已更新但操作仍显示成功”或相反的半套事实。

`observedAt` 仍然在 provider 请求发出前采样。租约接管会递增 `attempt_count`，因此较早的 provider
快照即使晚返回，也不能完成新一轮 operation；它的目录事务必须回滚，且不能覆盖已经提交的更新快照。

### 4.3 进程崩溃和租约

- 租约默认 60 秒，生产配置通过服务端常量控制，不允许客户端提交；
- provider 请求可能超过租约时，当前实现必须在访问 provider 前后记录低敏耗时，并在未来增加续租能力；
- 在续租能力完成前，provider 超时上限必须小于租约，避免两个 worker 同时认为自己拥有 key；
- 进程在 provider 请求期间崩溃时，另一进程只能等待租约到期后接管；
- 进程在完成事务后崩溃时，下一次请求读到 `succeeded`，不会再次访问 provider。

## 5. 建议的持久化字段

表名暂定 `hp_patient_directory_sync_operations`，最终以 migration 评审结果为准：

| 字段 | 规则 |
| --- | --- |
| `operation_id` | 平台内部 UUID，主键，不返回 provider 或小程序 |
| `owner_user_id` | 外键到 `hp_identity_users`，参与唯一键 |
| `provider_name` | 当前固定 `zhongyang`，参与唯一键 |
| `idempotency_key` | 规范化后的请求头值，不记录在普通日志 |
| `status` | 仅允许 `in_progress`、`succeeded` |
| `attempt_count` | 从 1 开始，租约接管时递增 |
| `observed_at` | provider 快照发起时间，按 UTC 解释 |
| `lease_until` | 操作租约；未到期不能重复访问 provider |
| `completed_at` | 成功事务提交时间，未完成时为空 |
| `result_digest` | 只存脱敏读模型的稳定摘要，用于排障；不能存 provider 原文、unionId 或完整证件号 |
| `created_at`、`updated_at` | 数据库时间 |

必须建立：

- `UNIQUE(owner_user_id, provider_name, idempotency_key)`，阻止跨进程重复占用；
- `INDEX(status, lease_until)`，为过期租约扫描和运维清理服务；
- `FOREIGN KEY(owner_user_id)`，防止孤儿操作记录。

操作记录需要保留期限和清理策略。清理前不能复用仍在保留期内的 key；若未来要求长期审计，必须另
行设计加密/脱敏历史快照，不能无限保留患者展示资料。

## 6. API 错误和日志

### 6.1 HTTP 语义

| 场景 | HTTP | 错误码/结果 |
| --- | --- | --- |
| 同 key 已成功 | 200 | 返回当前 owner 的患者读模型，不访问 provider |
| 同 key 正在处理中 | 409 | `patient-sync-in-progress`，小程序提示稍后刷新 |
| key 与未来扩展的请求指纹冲突 | 409 | `patient-sync-idempotency-conflict` |
| provider 失败 | 502/503 | 保持现有 provider 错误语义；操作等待租约到期后可恢复 |
| 快照事务失败 | 503 | `persistence-temporarily-unavailable`；不得返回成功 |

### 6.2 必须记录的低敏事件

- `patient.directory.operation.started`
- `patient.directory.operation.replayed`
- `patient.directory.operation.in_progress`
- `patient.directory.operation.lease_taken_over`
- `patient.directory.synced`（operation 成功提交后的结果事件）

事件字段只允许 `traceId`、`operationId`、owner 的不可逆短摘要、provider、attempt、耗时、
患者数量、失效数量和 `providerRequestId`。禁止记录 `Idempotency-Key` 原文、unionId、openid、
身份证号、手机号、provider 原始响应和完整患者对象。

## 7. 实现顺序和验收门禁

按以下顺序实现，任何一步失败都不开放新的高风险业务：

1. domain：增加开始/完成/重放结果类型和处理中错误；
2. migration：创建操作表、外键、唯一键、租约索引，并扩展 schema readiness；
3. 内存仓储：覆盖成功重放、处理中冲突、过期租约接管和 owner 隔离；
4. MySQL 仓储：覆盖唯一键竞争和“患者快照 + 操作成功”同事务；
5. service/API：provider 只允许由 `started` 分支调用，增加 409 错误映射；
6. 小程序：处理中显示可理解的重试文案，不自动循环调用；
7. 文档和日志：同步更新公共接口、迁移清单、业务正确性、日志字段和验收手册；
8. 验收：本地并发测试 → 隔离 MySQL/Redis → staging provider → 公网 API → 微信真机；
9. 生产：先 migration/schema probe，再灰度启用新同步语义；旧服务仍保持原端口和数据库边界。

在上述代码和测试完成前，当前 `POST /patients/sync` 仍按“请求/provider 上下文，不具备 durable
幂等”对外描述；不得提前把公共文档改写成已完成。
