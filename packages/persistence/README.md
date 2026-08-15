# Persistence Boundary

数据库和缓存实现暂不进入第一步重构。这里预留 MySQL、Redis、迁移、事务和 outbox 实现的位置。

领域层只能通过 repository/transaction port 访问持久化，不直接依赖 ORM。正式接入前先对旧库表、迁移版本、订单幂等键和历史回调数据做盘点。
