# Redis 会话 TTL 与 ACL 只读观察（2026-08-17）

> 本文只记录 Redis 会话 TTL 的受控诊断结果，不记录 Redis URL、用户名、密码、session key、token 或用户身份；本次没有修改 ACL、重启服务或写入 Redis。

## 1. 目标与连接归属

本次目标是确认新 API 实际使用的 Redis 连接，而不是把服务器本机 Redis 当成线上会话存储。

| 检查项 | 结果 |
| --- | --- |
| 观察时间 | 2026-08-17 19:17 CST |
| 新 API 进程 | `hospital-platform-api-v2.service` 的 Bun 进程 |
| 实际 Redis 对端 | 远端 `8.130.127.184:6379`，应用连接为 DB3 |
| 本机 `127.0.0.1:6379` | 不是新 API 会话 TTL 的验证目标；本机 DB1 数据不能推导 DB3 会话状态 |
| 环境读取方式 | 服务器内读取现有 systemd `EnvironmentFile`，凭证未打印、未传回本地 |

## 2. 只读探测结果

服务器侧使用服务 env 创建 Bun/ioredis 客户端，关闭 ioredis 的 `INFO` ready-check 后仅执行连接和会话
前缀扫描尝试：

| 探测 | 结果 | 结论 |
| --- | --- | --- |
| Redis 连接 | 成功 | 应用配置的远端 Redis 可达 |
| ioredis 默认 `INFO` ready-check | 被拒绝 | 生产 ACL 没有 `INFO` 权限；不应为诊断而放宽 |
| `SCAN MATCH hospital:session:*` | `acl-no-permission` | 当前应用/诊断身份不能枚举会话 key |
| 会话数量 | 未取得 | 不能把扫描失败当作 0 |
| TTL 最小/最大值 | 未取得 | `expiresInSeconds` 仍不是 Redis `TTL` 命令证据 |

此前对服务器本机 `127.0.0.1:6379` 的扫描得到 DB3 为空、DB1 有数据；由于新 API 连接的是远端 Redis，
该结果已明确降级为“错误目标的观察”，不进入会话 TTL 验收结论。

## 3. 业务与安全决策

当前 ACL 拒绝是合理的最小权限边界：应用只需要会话的 `GET/SET`，不应拥有全库 `SCAN` 或 `INFO`。
本轮不新增公网 TTL 接口、不把 token 放入日志、不读取或展示 key 原文，也不为验收临时修改生产应用 ACL。

若要完成 TTL 直接证据，应由运维提供一次受控的只读聚合：使用短时、独立的审计身份，仅允许
`SCAN`/`TTL` 访问 `hospital:session:*`，脚本只输出数量、最小 TTL、最大 TTL 和错误分类，完成后撤销该身份。
更稳妥的替代方案是由部署平台在不暴露 key 的前提下提供同样的聚合结果；不能用应用接口把任意 token 的 TTL
暴露给小程序或公网。

## 4. 当前结论与下一步

本次把“TTL 未验证”的原因从“连接目标不明”收敛为“实际远端 Redis 已确认，但应用 ACL 明确拒绝枚举”。
会话签发代码仍保持 `SET ... EX expiresInSeconds`，但 Redis 实际 TTL、过期后 401、真机失效恢复和多患者
失效恢复仍未验收。下一步可并行推进普通资料专用测试账号的 `PUT/409`，或等待运维提供最小权限 TTL 聚合；
在这两类证据完成前，不把会话或患者失效恢复标记为完成。

相关规则见 [`P0 只读业务验收手册`](p0-readonly-business-acceptance-runbook-2026-08-17.md)、
[`当前服务器 P0 只读观察`](current-server-p0-observation-2026-08-17.md) 和 [`Redis 会话实现`](../../packages/persistence/src/redis-session.ts)。
