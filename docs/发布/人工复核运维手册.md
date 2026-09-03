# 人工复核队列维护手册

更新时间：2026-08-31

本文对应 `0017_outbox_manual_review_state` 之后的运行时。它只处理已经达到
自动重试上限的 outbox 事件和微信查单尝试，不会打开支付、医保或 HIS 能力。

## 1. 安全边界

- 维护命令必须在 API/Worker 使用同一份生产配置的受控服务器 shell 中执行。
- 命令要求 `PERSISTENCE_SCHEMA_READY=true`、MySQL 真实只读 readiness 和 schema
  probe 同时为 `ok`；数据库未就绪时不会查询或修改队列。
- `list`/`check` 只读取低敏摘要，不输出 outbox payload、患者号、身份证、支付参数、
  Provider 原文或密文。
- `requeue` 必须指定一条记录、固定原因码和 `--confirm`。它不重置累计尝试次数，
  再次失败仍会回到人工复核。
- 不允许直接在 MySQL 上手工改 `status`、`manual_review_at` 或 `next_query_at`；
  所有改变必须留下结构化 `maintenance.manual_review.requeued` 日志。

## 2. 查看与告警检查

在 `apps/worker` 目录对应的发布包中执行：

```text
bun run src/manual-review.ts list --limit 50
bun run src/manual-review.ts check --limit 100
```

`check` 会输出 outbox 和微信查单人工复核数量；队列非空时记录
`maintenance.manual_review.alert`，并以退出码 `2` 结束，供 systemd timer、监控
或告警平台接入。退出码 `0` 只表示本次有界检查没有发现人工复核记录，不代表支付
或 HIS 业务已完成。

## 3. 单条重放

先用 `list` 确认 ID 和最近的 Provider/订单证据，再执行一次重放：

```text
bun run src/manual-review.ts requeue --kind outbox --id <event-id> --reason operator-confirmed --confirm
bun run src/manual-review.ts requeue --kind wechat-payment-query --id <attempt-id> --reason provider-evidence-confirmed --confirm
```

允许的原因码只有：

- `operator-confirmed`：运维已核对订单、通知和日志事实；
- `provider-evidence-confirmed`：已取得可关联的 Provider 查单证据；
- `false-positive-reviewed`：确认是错误分类或人工复核误报。

重放成功只代表记录重新进入受控调度队列。必须继续观察 Worker 日志、订单/通知
持久化事实和最终一致性；不能把命令返回 `success=true` 当作支付成功或 HIS 回写
成功。若再次进入人工复核，应停止继续重放并升级人工处理。

## 4. 当前限制

该工具解决的是仓库内的死信查询、人工重放和告警出口。它不替代：

- 生产 MySQL 备份、PITR、恢复演练和 RPO/RTO；
- 微信支付/医保/HIS 的真实 Provider 合同与回写验收；
- 生产发布窗口、回滚和 `0017` migration 执行；
- 外部告警平台本身的通知渠道配置。
