# 0016 患者同步并发索引发布前审计（2026-08-17）

> 本文记录的是 `6d58c9c` 发布前的只读审计窗口：当时线上仍为 `131fb5a`、schema marker/index 尚未应用。后续 migration、postcondition、候选切换和公网运行结果以当前 [`9833a01-production-acceptance-2026-08-17.md`](9833a01-production-acceptance-2026-08-17.md) 为准；本文中的“尚未应用”均属于发布前历史事实，不代表当前线上状态。

> 本文记录 `0016_patient_directory_sync_owner_index` 的代码、schema 和线上只读审计结果。
> 本次没有执行 migration、发布、重启、停止服务或患者同步写入。`0016` 是非事务性 MySQL DDL，
> 必须和候选 release 绑定处理，不能在没有回滚/人工检查方案时直接对生产执行。

## 1. 这次 migration 做什么

`0016_patient_directory_sync_owner_index.sql` 只执行一条 DDL：

```sql
ALTER TABLE hp_patient_directory_sync_operations
  ADD KEY ix_hp_patient_sync_owner_provider_state
  (owner_user_id, provider_name, status, lease_until);
```

它是非唯一的查询索引，服务于“同一 owner/provider 下查找仍在租约内的同步操作”。

- 不新增患者、不修改患者目录行、不修改 provider 映射；
- 不修改旧 Python 服务使用的 legacy 表；
- 不改变 `0015` 的 owner/provider/key 唯一键，不能替代精确幂等 replay；
- 不允许把索引存在解释为并发业务已经验收；真实并发仍需候选 release、公网、日志和真机证据。

## 2. 代码与 schema gate 审计

本地代码审计确认：

1. `PERSISTENCE_MIGRATIONS` 已登记 `0016_patient_directory_sync_owner_index`；
2. `PERSISTENCE_SCHEMA_INDEXES` 要求表、索引名和四列顺序完全匹配；
3. `schema probe` 在 migration marker 不齐时返回 `incomplete`，不会跳过缺失索引继续报告 ready；
4. 患者同步 repository 在 owner/provider 活跃租约查询中使用这组列，但不会因为索引缺失而静默降级成“已保护”；
5. MySQL migration runner 明确把所有 DDL 标记为 `non_transactional_ddl`，失败后要求人工检查，不伪造可回滚语义。

本地持久化测试结果：67 项通过、0 项失败、525 个断言；其中包含 migration manifest、schema object/index
同步、患者同步 owner-scoped lease/replay 和写入失败边界测试。

## 3. 线上只读结果

通过 SSH 在 `192.168.112.172` 上使用 API 的受控数据库配置，仅输出计数，不输出连接串、用户名、密码、患者数据或 SQL 结果明细：

| 检查项 | 结果 |
| --- | --- |
| 发布前线上 release | `131fb5a` |
| `0015_patient_directory_sync_operations` marker | 存在（`1`） |
| `0016_patient_directory_sync_owner_index` marker | 不存在（`0`） |
| `ix_hp_patient_sync_owner_provider_state` | 不存在（`0`） |
| 线上新 API readiness | database、Redis、schema 当前 release gate 为 `ok`；该 gate 只认识线上已发布的 `0015` |
| 旧 Python API | `8001` 继续运行，本次未停止、修改或重启 |

因此当前线上确实仍是 `0015` 语义，不能宣称已经具备候选 `0016` 的跨幂等键并发索引保护。
本次只读查询没有触碰业务数据，也没有把 migration marker 当作业务验收证据。

## 4. 为什么现在不直接执行

直接在发布前的 `131fb5a` 上执行 `0016` 有三个风险：

1. 当前运行 bundle 不是包含 `0016` schema gate 的候选，migration 与代码 provenance 会被拆开，后续难以确认
   哪个版本开始承诺 owner/provider 并发语义；
2. `ALTER TABLE` 属于非事务性 DDL，若元数据锁等待、进程中断或 DDL 部分完成，不能依赖普通事务回滚；
3. migration 通过前，不能用旧 release 的 readiness 200 推导新候选已经可安全验收。

所以本阶段决策是：保持线上 `0015`、保持当前服务不变，先完成候选 bundle、migration runner、日志和回滚路径的同一版本审查。

## 5. 允许执行时的安全顺序

仅在明确授权发布窗口且候选代码已经固定 checksum 后执行：

1. 保存候选 bundle provenance，确认 `7807aa8` 之后的本地候选没有混入其他工作树改动；
2. 只停止/重启新 Elysia unit，旧 Python `8001` 全程保持运行；
3. 用候选 release 自带的 migration runner 执行 `0016`，不使用旧 release 的 runner 猜测执行；
4. migration 完成后只读核对 marker、索引名、索引四列顺序和 schema probe；
5. 启动候选 API，验证内网和公网 readiness、production mode、旧 Python 监听和低敏启动日志；
6. 再按患者同步 replay → 不同幂等键并发 → 多患者切换的顺序做业务验收，任何一步失败都停止扩展范围。

如果 migration 过程中失败：

- 立即停止后续发布和业务验收，保留 migration runner/journald/数据库元数据证据；
- 不自动 `DROP INDEX`，不重复执行，不把“marker 已写入”当作索引已成功；
- 先由运维/DBA 判断是 marker、索引或元数据锁的哪一类状态，再决定人工修复；
- 候选 API 启动失败时可以回到 `131fb5a`，因为新增的是兼容性的非唯一索引，不需要为回滚 release 删除它；
- 若无法证明索引和 marker 状态一致，schema gate 必须保持未就绪，业务路由保持 fail-closed。

## 6. 当前结论

`0016` 的设计边界与旧服务共存要求相容，但线上尚未应用；候选发布与 migration 必须绑定，且必须先完成
schema 元数据核对再进行患者并发验收。下一阶段先等待用户真机完成微信会话/患者上下文观察，或在明确发布窗口
获得执行授权；支付、医保、HIS 和预约写入仍不进入这条 migration 验收链路。
