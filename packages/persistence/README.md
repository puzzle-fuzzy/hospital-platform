# Persistence Boundary

当前阶段已建立 MySQL/Redis 的真实连接探针、关闭生命周期和目标 schema 迁移文件。

readiness 的 `ok` 只证明 MySQL `SELECT 1` 与 Redis `PING` 可用，不代表 schema、微信、医保、HIS 或支付 provider 已接通。

API 只有在 `PERSISTENCE_SCHEMA_READY=true` 时才注入 MySQL repository；该变量不是自动迁移开关，必须在目标 migration 完成并通过脱敏 staging 验证后由部署配置显式开启。

领域层只能通过 repository/transaction port 访问持久化，不直接依赖 ORM。正式接入前先对旧库表、迁移版本、订单幂等键和历史回调数据做盘点。

订单仓储仍未接入生产组合根；在“订单写入 + outbox 事件”事务端口完成前，API 继续使用 fail-closed repository，避免产生不可恢复的外部支付副作用。
