# 患者目录同步幂等契约

> 状态：代码已实现，`0015` operation ledger 和 `0016` owner/provider 查询索引组成当前生产 schema；当前公网 release 为 `b7c9451`，当前本地小程序候选构建来源为 `add82665a11229c7d2d3856e70a292a59b01c6da`，尚未上传线上；`0016` 已完成 migration、marker/index postcondition 和 schema probe。真实患者并发/多患者切换/真机业务验收待完成。本文件是实现和发布的冻结边界；
> 当前线上已经具备本轮跨幂等键并发保护所需的 schema 运行前置，但这不等于真实 Provider 并发、失效恢复或真机业务已经验收。
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
MySQL 中按用户、provider、key 隔离的操作事实，并且和目录快照的最终提交具有一致的事务边界；
另外，同一 owner 即使提交不同的 key，也不能在已有租约未到期时再次访问同一个 provider。

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

### 2.3 小程序幂等键生成

小程序每次真正发起一次新的患者同步操作时生成一个新的幂等键，并在同一次调用中保持不变：

- 前缀只使用固定的业务标识，例如 `patient-sync` 或 `patient-selection-sync`；
- 前缀先收窄为安全字符，再拼接客户端时间片和随机尾部，最终长度不超过 128；
- 不能只使用 `Date.now()`。首页和选择页可能在同一毫秒发起不同同步，时间戳碰撞会让服务端把两个独立操作误判为同一 key replay；
- 幂等键不是 token，不得包含患者姓名、身份证、卡号、provider ID 或其他医疗字段；
- 同一页面实例的单飞调用共享同一个正在执行的 Promise；用户完成一次失败后的新手动刷新属于新操作，应生成新 key。若未来在网络层增加自动重试，必须复用原操作 key，不能在一次操作内重新生成。

首页页面层的 `onSyncPatients()` 不返回患者数组，只表示同步流程完成。因为“Provider 确认的空目录”和“同步失败”
都可能在错误实现中落成空数组，页面不能用 `[]` 作为失败兜底；失败必须通过安全错误状态呈现并清理当前展示上下文，
成功快照才允许进入页面状态。真正需要患者快照的调用只能使用服务层成功响应或页面已经确认的状态，不能从页面同步
方法的完成值推断目录内容。

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
| `in_progress` | 已经有一个同步请求占用 key，或同一 owner/provider 已经有其他 key 占用同步租约，尚未完成目录快照事务 | 租约未到期返回 `409 patient-sync-in-progress`，不再次访问 provider；租约到期后原子接管执行权 |
| `succeeded` | provider 完整目录和当前患者快照已经在同一事务中提交 | 不再访问 provider，按 owner 返回当前患者读模型，记录一次低敏 replay 日志 |

失败不作为永久成功缓存。provider 明确失败、响应不完整或数据库事务回滚时，操作保留为可恢复的
`in_progress`，直到租约到期；之后同一 key 可以接管重试。这样既不会把一次暂时失败永久锁死，
也不会在前一个请求仍可能写入时盲目并发重试。

> 重要边界：`succeeded` 的 replay 保护 provider 不被重复调用，并保证业务结果仍来自当前 owner
> 的平台读模型；它不是把 provider 原始响应永久保存后逐字节重放。若未来要求审计级的历史响应重放，
> 必须另建带保留期限的快照历史表，不能把当前 `hp_patients` 记录冒充历史快照。

### 3.1 空目录的保守语义

当前 Provider adapter 会把通过结构校验的空数组标记为 `complete=true`，但现有资料没有证明空数组
一定表示“该微信账号确实没有绑定患者”。它也可能来自权限过滤、Provider 临时异常或响应截断；如果
直接把它送入完整快照事务，持久化层会把已有医院目录患者全部标记为 inactive。

因此服务层采用以下不变量：

- 首次同步且当前 owner 没有医院目录患者时，空目录可以正常提交，公共响应是 `200`、`items: []`、`total: 0`；
- 当前 owner 已有 `source=hospital-his` 的目录患者时，空目录不会覆盖快照，返回 `502 patient-directory-snapshot-unsafe`；
- 这个错误只保留旧目录和临床映射，不把空响应解释成解绑，也不自动删除患者；
- 只有取得 Provider 正式 contract，明确空目录、权限过滤、临时故障和分页结束的区分后，才可以重新评估是否放宽该边界。

这条保护放在 service 层而不是 adapter 层，是因为 adapter 不拥有 owner 当前读模型，无法判断空结果是否会造成
破坏性替换。同步操作仍按失败租约恢复，未提交为 `succeeded`；租约到期后可以使用新的请求重试。

## 4. 事务和并发规则

### 4.1 开始操作

仓储在 MySQL 中执行一个短事务：

1. 先按 `owner_user_id` 锁定 `hp_identity_users` 中的 owner 行，把同一 owner 的同步启动阶段串行化；
2. 按 `(owner_user_id, provider_name, idempotency_key)` 唯一索引读取并锁定操作行；
3. 没有精确 key 记录时，再按 `(owner_user_id, provider_name, status, lease_until)` 查询并锁定其他未过期同步；
4. 没有记录时插入 `in_progress` 和 `lease_until`；
5. 已有 `succeeded` 时返回 `replay`；
6. 已有未过期 `in_progress` 时返回 `in_progress`；
7. 已有过期 `in_progress` 且没有其他活跃同步时增加 `attempt_count`、刷新租约并返回 `started`；
8. 事务提交后，只有拿到 `started` 的请求才能访问 provider。

这里的“没有其他活跃同步”也适用于精确幂等键已经过期的情况：如果同一
`ownerUserId/provider` 下存在另一个幂等键且其租约仍有效，当前请求必须返回
`owner-provider` 范围的 `in_progress`，不能直接接管旧 key。否则两个请求会同时访问
Provider，并可能以不同快照顺序覆盖同一份患者目录。MySQL 仓储在 owner 行锁内执行这次
排除当前 operation 的活跃租约查询，内存仓储和回归测试也保持同一语义。

插入竞争必须依靠数据库唯一约束处理，不能只依赖“先 SELECT 再 INSERT”。唯一键冲突后必须重新
读取并按状态分支，不能把 SQL duplicate error 直接转换成 500。

### 4.2 完成同步

`replaceDirectorySnapshot` 接受本次 operation 的内部标识和租约代次，并在**同一个 MySQL 事务**中完成：

1. 按 provider 患者号 upsert 本次完整目录；
2. 仅将同 owner/provider 下、`directory_last_seen_at` 早于本次 `observedAt` 且未出现的患者标记 inactive；
3. 查询本次 owner 的 active 读模型；
4. 仅当 `operation_id`、owner、provider 和 `attempt_count` 都仍然匹配时，把操作状态从 `in_progress` 更新为 `succeeded`，写入 `observed_at`、`completed_at` 和结果摘要；
5. 任意一步失败都回滚患者状态和操作状态，不能留下“目录已更新但操作仍显示成功”或相反的半套事实。

内存仓储虽然只服务测试，但也必须保留这条提交边界：目录快照替换没有真实 I/O 时不得插入
隐藏的异步让出点，租约校验、快照状态修改和 operation 成功标记在同一个事件循环 turn 内完成。
因此测试中的旧租约接管不会留下部分患者资料；真实环境仍以 MySQL 事务回滚、行锁和
`attempt_count` 条件更新作为最终保证。

进入这段事务前，adapter 必须验证 provider 返回的完整目录中 `providerPatientId` 唯一。重复患者号会在
upsert 时合并成一条内部患者，后出现的姓名、关系、卡号或能力映射可能覆盖先出现的资料；这类响应不能被
解释成“同一患者的两条展示记录”，必须作为非法快照拒绝并保留 provider request id 供排障。

adapter 还必须验证目录患者到 `his-patient` 的临床引用是一对一的。不同目录患者共享同一个 HIS `patId`
时，切换就诊人后可能读取同一份预约、报告或费用数据；在 provider 没有明确说明这种归并语义前，必须拒绝
整个快照，不能把潜在的错患者映射写入平台。

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
- `INDEX(owner_user_id, provider_name, status, lease_until)`，支持跨幂等键检查同一 owner/provider 的活跃租约；
- `FOREIGN KEY(owner_user_id)`，防止孤儿操作记录。

开始同步时使用已有的 owner 身份行作为事务锁，不把客户端 key 当作跨页面互斥锁；因此一次同步完成后，
新的手动刷新仍可使用新 key，只有重叠的未完成租约会被拒绝。

操作记录需要保留期限和清理策略。清理前不能复用仍在保留期内的 key；若未来要求长期审计，必须另
行设计加密/脱敏历史快照，不能无限保留患者展示资料。

## 6. API 错误和日志

### 6.1 HTTP 语义

| 场景 | HTTP | 错误码/结果 |
| --- | --- | --- |
| 未登录或会话已失效，即使幂等键缺失 | 401 | `unauthorized`；认证先于 header schema |
| 已登录但幂等键缺失或不符合安全字符约束 | 400 | `validation`；不得访问 provider |
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
- `patient.directory.snapshot.committed`
- `patient.directory.synced`（operation 成功提交后的结果事件）

事件字段只允许 `traceId`、`operationId`、owner 的不可逆短摘要、provider、attempt、
`conflictScope`、耗时、
患者数量、失效数量和 `providerRequestId`。禁止记录 `Idempotency-Key` 原文、unionId、openid、
身份证号、手机号、provider 原始响应和完整患者对象。

`patient.directory.snapshot.committed` 只证明快照事务已经返回，不能替代 `patient.directory.synced`；后者还要求
事务返回的 active 患者读模型和失效计数通过 domain 二次校验。若提交已成立但返回读模型损坏，只记录
`patient.directory.read.failed`，保留提交事实但不伪造同步成功或同步失败。

`conflictScope` 只允许 `same-key` 和 `owner-provider`：前者表示同一幂等键重试，后者表示
首页、选择页等不同入口提交了不同幂等键，但同一 owner/provider 已有未过期同步租约。它只用于
服务端排障，不进入小程序响应。

小程序还必须在页面路由层减少这类冲突：首页恢复、登录后的 bootstrap 或下拉刷新正在同步时，
“新增/更换就诊人”入口不得导航到选择页。选择页与首页属于不同页面实例，不能依赖页面级单飞锁
互相协调；当前实现由进程级患者同步协调器复用在途 Promise，并由统一导航入口提示用户稍后重试。
服务端 operation ledger 仍是最终并发保护，不能用前端协调器替代服务端租约。

## 7. 实现顺序和验收门禁

按以下顺序实现，任何一步失败都不开放新的高风险业务：

1. domain：增加开始/完成/重放结果类型和处理中错误；
2. migration：0015 创建操作表、外键、唯一键和基础租约索引，0016 增加 owner/provider 活跃租约索引，并扩展 schema readiness；
3. 内存仓储：覆盖成功重放、处理中冲突、过期租约接管和 owner 隔离；
4. MySQL 仓储：覆盖唯一键竞争和“患者快照 + 操作成功”同事务；
5. service/API：provider 只允许由 `started` 分支调用，增加 409 错误映射；
6. 小程序：处理中显示可理解的重试文案，不自动循环调用；
7. 文档和日志：同步更新公共接口、迁移清单、业务正确性、日志字段和验收手册；
8. 验收：本地并发测试 → 隔离 MySQL/Redis → staging provider → 公网 API → 微信真机；
9. 生产：先 migration/schema probe，再灰度启用新同步语义；旧服务仍保持原端口和数据库边界。

代码和生产 schema 完成后，`POST /patients/sync` 的新 release 语义已不再只是请求/provider 上下文；当前线上
release 为 `b7c9451`，并已取得 bundle provenance、migration postcondition 和公网运行前置证据。真实并发、公网业务和真机验收仍未完成，发布文档必须继续标记为“线上业务证据待完成”。
