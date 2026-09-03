# Persistence migration recovery

## 适用范围

当前 `@hospital/persistence` 的 migration 文件包含 MySQL DDL。MySQL DDL 可能触发隐式提交，
所以 runner 不把 DDL 放进假想的可回滚事务，而是在 `hp_schema_migration_runs` 中留下每次
执行的状态。

官方语义参考：[ALTER TABLE](https://dev.mysql.com/doc/refman/8.4/en/alter-table.html)、
[当 COMMIT 发生时](https://dev.mysql.com/doc/refman/8.4/en/commit.html)。

## 发现 `started` 或 `failed` 时

先保持 `PERSISTENCE_SCHEMA_READY=false`，并停止会依赖目标 schema 的 API/worker。不要直接
再次执行 `pnpm db:migrate`；runner 会拒绝重放，这是预期的 fail-closed 行为。

迁移命令默认只允许本地数据库。远程 staging 需要显式设置
`PERSISTENCE_MIGRATION_ALLOW_REMOTE=true`；生产环境还需要额外设置
`PERSISTENCE_MIGRATION_ALLOW_PRODUCTION=true`。这些变量不会打开 API schema gate。

使用只读 SQL 确认执行记录：

```sql
SELECT migration_id, execution_mode, status, started_at, completed_at, error_message
FROM hp_schema_migration_runs
WHERE status <> 'succeeded'
ORDER BY started_at;

SELECT migration_id, applied_at
FROM hp_schema_migrations
ORDER BY migration_id;
```

然后由具备数据库权限的人员根据对应 migration 文件，检查 `information_schema` 中的表、
列、索引、唯一键和外键。需要注意：`hp_schema_migrations` 没有记录某个 migration，
不等于该 migration 的所有 DDL 都没有执行。

API 和集成验收的 schema probe 还会读取 MySQL `INFORMATION_SCHEMA`，核对关键表、列、索引
列顺序，以及患者/订单 owner 复合外键的本地列和引用列；因此不能只补写 migration history
或只恢复约束名称。

## 修复完成后的要求

1. 形成可审阅的 repair SQL，并在隔离 staging 先执行；
2. 对目标 migration 的全部 post-condition 做只读核验；
3. 由 DBA 按组织的变更流程把 migration history 和 run status 修复为一致；
4. 再运行 `pnpm db:migrate`，确认日志出现 `persistence.migration.succeeded` 或合法的
   `persistence.migration.skipped`；
5. 重新运行 `pnpm db:integration`，之后才评估是否允许打开 schema gate。

本项目当前不提供“自动把失败 migration 标记为已完成”的命令，因为在没有逐项 schema
post-condition 校验时，这会把人工误判直接变成生产数据风险。
