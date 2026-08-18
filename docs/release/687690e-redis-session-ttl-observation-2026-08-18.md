# 687690e Redis 会话 TTL 只读观察（2026-08-18）

## 1. 观察范围

本记录只验证当前 `687690e` 运行环境的 Redis 会话 TTL 观察边界，不执行登录、不写 Redis、
不修改 ACL、不重启服务，也不操作旧 Python 服务。

| 项目 | 结果 |
| --- | --- |
| 观察时间 | 2026-08-18 21:22:15 CST（服务器 UTC `2026-08-18T13:22:15Z`） |
| 当前 release | `/home/ps/code/hospital-platform/releases/687690e` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 API | Python 端口 `0.0.0.0:8001` 仍在监听 |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |
| 审计凭证 | 未配置独立 `REDIS_SESSION_AUDIT_URL`，按设计回退应用 `REDIS_URL` |

## 2. 只读命令与结果

执行的是当前 release 自带的 bundle，不依赖服务器 workspace 源码：

```bash
/home/ps/.bun/bin/bun \
  "/home/ps/code/hospital-platform/releases/687690e/apps/worker/dist/redis-session-ttl-audit.js"
```

环境文件只在受控远程进程内注入，命令输出没有包含 Redis URL、ACL 用户名、密码、session key、
用户 id 或 token。安全输出为：

```json
{"verified":false,"error":"redis-session-scan-unavailable"}
```

进程退出码为 `2`，表示 Redis 会话扫描权限/连接错误；它不是 TTL 校验失败，也不是“没有会话”的
结论。当前只能确认 Redis `PING` 和 API readiness，不能确认会话数量、最小 TTL、最大 TTL 或永久 key 数量。

## 3. 结论与停止条件

- P0 会话 TTL 证据保持“未验证”；不得用 API 返回的 `expiresInSeconds` 或 Redis `PING` 代替 `TTL` 聚合。
- 不临时给常驻 API 账号增加 `SCAN` 权限，不读取或复制原始 Redis key。
- 如需完成该项，运维必须通过密钥管理提供独立的 `REDIS_SESSION_AUDIT_URL`，仅允许
  `hospital:session:*` 的只读 `SCAN`/`TTL`，随后重新执行同一 release bundle，并只提交聚合字段。
- 在独立 ACL 证据取得前，微信会话、患者切换和其它 P0 业务可以继续做页面/HTTP/日志分层验收，
  但不能把会话 TTL 标记为完成；支付、医保、退款和 HIS 继续保持关闭。

完整 P0 顺序见 [`p0-readonly-business-acceptance-runbook-2026-08-17.md`](p0-readonly-business-acceptance-runbook-2026-08-17.md)。
