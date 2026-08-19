# `b7c9451` 会话与 readiness 只读复核（2026-08-19 11:49 CST）

## 1. 观察范围

本次只核对新 API 的当前进程、正确监听地址、依赖 readiness 和 Redis 会话 TTL 审计结果；
不执行微信登录、不写数据库、不写 Redis、不修改 ACL、不重启服务，也不操作旧 Python 服务。

| 检查项 | 结果 |
| --- | --- |
| 观察时间 | 2026-08-19 11:49 CST（服务器 UTC `2026-08-19T03:49:00Z`） |
| 当前 release | `/home/ps/code/hospital-platform/releases/b7c9451` |
| 新 API systemd | `hospital-platform-api-v2.service=active/running` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，仍与新 API 共存 |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |

## 2. Redis 会话 TTL 审计

在服务器内读取现有服务环境，仅将变量注入当前 release 自带的审计 bundle；输出不包含 Redis URL、
用户名、密码、key、用户 id 或 token：

```json
{"verified":false,"error":"redis-session-scan-unavailable"}
```

审计进程退出码为 `2`。这表示当前身份无法完成会话 key 扫描/TTL 聚合，不能解释为“没有会话”，
也不能用 API 的 `expiresInSeconds` 或 Redis `PING` 替代真实 TTL 证据。此前已确认应用实际连接的是远端
Redis；本次没有扩大常驻 API 账号的 `SCAN`/`INFO` 权限。

## 3. 结论

- 数据库瞬态断连后，当前新 API 已恢复并持续通过正确监听地址的 readiness 检查；本次未重启服务。
- 新旧服务端口仍然同时监听，旧 Python 服务未被修改或停止。
- 微信会话 TTL、过期后 `401`、会话失效后的重新登录和多就诊人失效恢复仍未完成真实验收。
- 要完成 TTL 证据，必须由运维提供短时、独立且仅允许 `hospital:session:*` 聚合扫描的审计身份；在此之前不改变
  生产 ACL，不开放公网 TTL 接口，不把 token 写入日志。

相关历史边界见 [`687690e Redis 会话 TTL 只读观察`](687690e-redis-session-ttl-observation-2026-08-18.md)
和 [`Redis 会话 TTL 与 ACL 只读观察`](redis-session-ttl-acl-observation-2026-08-17.md)。
