# Persistence Boundary

当前阶段已建立 MySQL/Redis 的真实连接探针、关闭生命周期、目标 schema、
订单事务 repository、Redis session store 和 outbox lease 恢复边界。

目标 schema 还通过 `0007_owner_scoped_payment_foreign_keys` 在数据库层约束
`owner_user_id + patient_id/order_id` 的一致性；应用层 owner 校验和数据库复合外键
必须同时存在，不能只依赖 API 路由不接收 owner 参数。

readiness 的 `ok` 只证明 MySQL `SELECT 1` 与 Redis `PING` 可用，不代表 schema、微信、医保、HIS 或支付 provider 已接通。

API 只有在 `PERSISTENCE_SCHEMA_READY=true` 时才注入 MySQL repository；该变量不是自动迁移开关，必须在目标 migration 完成并通过脱敏 staging 验证后由部署配置显式开启。

显式命令：

```powershell
pnpm infra:up
$env:DATABASE_URL = "mysql://hospital:hospital_dev_password@127.0.0.1:3307/hospital_platform"
$env:REDIS_URL = "redis://127.0.0.1:6380"
pnpm db:migrate
pnpm db:integration
pnpm infra:down
```

`db:integration` 只接受 localhost 连接串，并使用随机前缀写入后清理本地验收数据；
它不是 staging/production 验收脚本。领域层只能通过 repository/transaction port
访问持久化，不直接依赖 ORM。正式接入前仍要对旧库表、迁移版本、订单幂等键和历史
回调数据做盘点。

订单仓储已经具备“订单写入 + outbox 事件”同事务实现，并完成本地真实 MySQL/Redis
集成验收；API 仍默认由 `PERSISTENCE_SCHEMA_READY=false` 保护，未完成目标环境
migration、staging 脱敏验证和 provider 配置前，不接入真实支付副作用。

预支付尝试使用 `hp_payment_prepay_attempts` 独立记录幂等键、版本和 provider 证据；
`prepay_id` 只保存 SHA-256 摘要，`pay_params_ciphertext` 使用部署注入的 AES-256-GCM
密钥保护。缺少 `PAYMENT_DATA_ENCRYPTION_KEY` 时，该 repository 保持 fail-closed。

微信通知使用 `hp_wechat_payment_notifications` 保存已验签解密后的白名单事实；
`notification_id` 与微信交易号都参与去重，通知事实和入站 outbox 必须在同一 MySQL
事务中提交，原始 provider resource 不落库。

预支付尝试同时保存 `query_attempts`、`last_queried_at`、`next_query_at` 和
`query_claimed_until`，并建立查单索引。查单 worker 通过 MySQL transaction + `FOR UPDATE
SKIP LOCKED` 原子领取已到期记录；终态或待确认状态会清除调度和 claim，崩溃后 lease
过期即可由其他 worker 接管。每次 claim 递增 attempt `version`，旧 worker 即使在 lease
过期后返回，也不能覆盖新 worker 的结果。这保证进程重启和多副本运行都不依赖进程内队列。
