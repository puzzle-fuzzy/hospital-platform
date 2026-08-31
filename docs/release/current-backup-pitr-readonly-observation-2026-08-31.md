# 生产备份与 PITR 只读观测（2026-08-31）

本文记录本轮对 `ps@192.168.112.172` 的只读核对结果，用于判断备份、binlog/PITR、恢复
与告警 TODO 的真实状态。没有修改 systemd、cron、MySQL、Redis 或任何服务进程，也没有
读取或输出数据库连接凭据、业务数据和备份内容。

## 1. 运行层观测

| 检查 | 结果 | 能否作为医院业务备份证据 |
| --- | --- | --- |
| systemd 中备份相关 unit | 发现 `dpkg-db-backup.service` / `dpkg-db-backup.timer`，另有未启用的 `pg_basebackup@.timer` | 不能；它们不是医院 MySQL 业务库备份任务 |
| `ps` 用户活动 cron | `0` 条 | 不能证明 root 或外部备份平台没有任务，也不能证明已配置备份 |
| 医院 MySQL 全量备份文件/对象存储 | 本轮未发现可验证的受控清单 | 未取得证据 |
| 隔离恢复演练 | 未执行 | 未取得证据 |

## 2. MySQL binlog 只读观测

在旧服务现有数据库配置上下文内，只查询了恢复相关的系统变量，未打印连接配置：

```text
binlog_expire_logs_seconds       2592000
binlog_format                    ROW
expire_logs_days                 0
innodb_flush_log_at_trx_commit  1
log_bin                          ON
sync_binlog                      1
```

这说明当前 MySQL 具备开启 binlog 和较强提交落盘设置的运行基础，binlog 保留窗口约为
30 天。但它不能证明：

- binlog 已被安全复制、归档并可按时间点恢复；
- 存在可恢复的全量备份、备份校验和异地/隔离副本；
- 已验证 MySQL、Redis、文件资源和新旧服务的联合恢复顺序；
- 恢复后 RPO/RTO、保留策略、访问权限和告警通知满足生产要求。

## 3. 结论与后续门禁

本轮只关闭了“当前 binlog 运行参数未知”这一事实缺口，不能关闭生产备份与恢复 TODO。
正式关闭前仍需要运维负责人提供不含业务数据的备份任务清单、最近一次成功备份与校验结果、
隔离环境恢复记录、PITR 结果、RPO/RTO 实测值、保留/删除策略和告警触发/恢复演练证据。
在证据到齐前，不能切换生产发布执行器，也不能把本机恢复测试或 MySQL `log_bin=ON`
当作完整灾备能力。
