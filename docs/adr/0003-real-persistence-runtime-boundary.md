# ADR 0003: Real persistence runtime boundary

## 状态

已接受，Phase 5A。

## 决策

新项目保留 MySQL 与 Redis 作为第一阶段真实基础设施，并在 `@hospital/persistence` 中使用 `mysql2` 与 `ioredis` 建立最小运行边界：

- MySQL 通过连接池和 `SELECT 1 AS health_check` 提供数据库探针；
- Redis 通过惰性连接和 `PING` 提供缓存探针；
- API 入口负责创建运行时并在 Elysia stop 生命周期关闭连接；
- schema 先以可审阅的 SQL migration 固化目标字段、索引、唯一键和 outbox lease 字段；
- 业务 repository 只有在 `PERSISTENCE_SCHEMA_READY=true` 时才接入生产组合根；缺少 schema 确认或 provider 配置时仍 fail-closed。

## 原因

旧项目已经使用 MySQL、Redis、支付订单和回调事件。当前重构不能在接入外部支付前只具备内存订单，否则外部成功结果可能没有持久化事实和可恢复 outbox。先固定真实连接与目标表结构，可以把后续 repository、事务和集成测试建立在明确边界上。

## 非目标

本 ADR 不声明旧库可以直接执行这份 schema，也不声明微信、医保、HIS 或支付 provider 已经可用。迁移前仍必须导出线上 schema、索引、字符集、Alembic head 和敏感字段快照，并在脱敏 staging 验证。

## 下一步

1. 为 `PaymentOrderRepository.insert` 增加订单与 `payment-order.created` outbox 的原子写入端口。
2. 实现 MySQL repository、Redis session store 和 outbox lease/重试，并使用真实 MySQL/Redis 集成测试验证。
3. 只有持久化事实闭环后，才接入微信身份、医保 6201/6202、微信支付和 HIS 回写 adapter。
