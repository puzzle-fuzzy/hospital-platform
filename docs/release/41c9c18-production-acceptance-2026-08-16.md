# 41c9c18 生产切换与预约只读验收证据（2026-08-16）

## 1. 切换边界

- 候选 release：`41c9c18`，本地 `pnpm check` 已通过。
- 上传方式：只上传 API 和 Worker 的 5 个已构建 bundle；逐文件 SHA-256 与本地产物一致。
- 生产 preflight：通过；MySQL、Redis、`0015_patient_directory_sync_operations` schema probe 均为 `ok/verified`。
- 临时端口：`18089` production smoke 通过后已停止并释放；没有切换 `current` 前的线上请求。
- 切换动作：只将新 API `current` 从 `a11f117` 原子切换到 `41c9c18`，只重启
  `hospital-platform-api-v2.service`；旧 Python `8001` 未重启，Worker 未启动，未执行 migration、业务写入或缓存清理。

## 2. 切换后运行证据

| 检查 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/current -> releases/41c9c18` |
| systemd | `hospital-platform-api-v2.service=active` |
| 新 API | `10.0.0.3:18081` 监听 |
| 旧 Python | `0.0.0.0:8001` 仍监听 |
| 内网 `/health/ready` | `200`，`database/redis/schema=ok` |
| 公网 `/api/v2/health/ready` | `200`，`database/redis/schema=ok` |
| 公网缓存策略 | `Cache-Control: no-store` |
| 启动日志 | `environment=production`、`runtimeMode=production`、repository/auth 注入 ready |

## 3. 真实预约目录只读证据

2026-08-16 23:50:17-23:50:18 CST，在微信开发者工具中使用已登录账号重新打开预约目录，
没有点击锁号、预约、取消或支付：

| 请求 | trace/request | 结果 |
| --- | --- | --- |
| `GET /api/v1/appointments/departments` | `mp-msvze8ay-tnz3iq7a` | `200`，真实 Provider 科室 `itemCount=62` |
| `GET /api/v1/appointments/schedules` | `mp-msvze940-mk7gku8f` | `200`，真实 Provider 排班 `itemCount=1` |
| `appointment.schedule_snapshots.persisted` | `mp-msvze940-mk7gku8f` | `itemCount=1`，`expiresAt=2026-08-16T15:51:18.254Z` |
| `appointment.directory.schedules.synced` | `mp-msvze940-mk7gku8f` | `snapshotPersistenceStatus=persisted` |

这次证据确认了两条业务事实同时成立：Provider 只读目录有效，且排班观察快照已落库。
只有第二条事实处于 `persisted` 时，排班才具备进入未来锁号/预约前置评估的条件；它仍不等于
锁号授权、预约成功或支付成功。当前代码和页面继续保持预约写入关闭。

## 4. 当前结论与剩余边界

本 release 可以标记为“生产运行、预约科室/排班只读和短期快照持久化验收通过”。

仍未完成：

- Redis 对真实微信会话的实际 TTL 直接证据；
- 第二条患者记录、多就诊人切换、inactive/恢复和跨页面上下文隔离；
- 预约历史、报告、门诊费用的真实 Provider 结果及公网/真机四层证据；
- 普通个人资料真实读写和 409 冲突验收；
- 锁号、预约写入、取消、支付、医保、退款和 HIS 回写。

详细业务链路见 [`wechat-patient-sync-production-acceptance-2026-08-16.md`](wechat-patient-sync-production-acceptance-2026-08-16.md)，
Provider 只读分层手册见 [`provider-directory-acceptance.md`](provider-directory-acceptance.md)。
