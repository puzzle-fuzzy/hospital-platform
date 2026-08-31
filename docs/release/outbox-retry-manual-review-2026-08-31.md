# Outbox 与微信查单重试边界（2026-08-31）

## 已落地的代码边界

- `OutboxWorker` 自动失败重试最多 12 次；达到上限后将事件状态写为 `manual_review`，清除 claim，不再被普通 worker 自动领取。
- 微信预支付查单异常或 provider 持续返回 `cash_pending` 时，`PaymentReconciliationWorker` 最多继续 12 次；达到上限后将尝试状态写为 `manual_review`，清除 `nextQueryAt`。
- 两条链路都会记录事件名、业务主键、尝试次数、上限和低敏原因；原始 provider 异常内容不写入用户响应或结构化日志。
- 迁移 `0017_outbox_manual_review_state.sql` 会为已有已处理 outbox 事件回填 `processed`，再为新事件建立 `status`、`manual_review_at` 和可用索引。

## 尚未宣称完成的部分

这次提交没有执行生产数据库迁移、没有重启线上服务，也没有打开支付或医保 gate。`manual_review` 目前是可靠的停止边界，不是完整的人工运营闭环。

正式开启相关业务前，还必须补齐并取得证据：

1. 受权限控制的人工查询、重放、隔离和审计工具；重放必须再次经过 owner、金额、幂等键和 provider 状态校验。
2. outbox 堆积、查单长期 pending、进入 `manual_review`、Provider 错误率和恢复失败的告警出口。
3. 生产 MySQL 备份/恢复窗口中执行 0017，完成 schema probe、回滚预案和服务端 release 绑定。
4. 针对旧 Python 服务共存、微信真机、Provider/HIS 回写和支付/医保的独立验收证据。

## 运维判断

在人工工具、告警和生产迁移证据完成前，`manual_review` 事件只能由受控维护流程处理；不允许通过修改 `available_at`、直接改状态或临时重启 worker 来绕过重试上限。
