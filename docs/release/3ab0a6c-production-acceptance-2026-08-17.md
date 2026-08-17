# `3ab0a6c` 生产切换与运行时验收（2026-08-17）

## 结论

`3ab0a6c` 已在 2026-08-17 13:56 CST 左右原子切换为新 Elysia API 的生产 `current`，只重启
`hospital-platform-api-v2.service`。切换后新 API 运行时验收通过，旧 Python 服务、数据库 schema、支付/医保/HIS 写入边界均未改变。

这不是完整业务验收：本次只证明新版本已经安全接管运行时入口，尚未在该版本上重新完成真实微信登录、多就诊人切换、预约历史或门诊费用 Provider 读取。支付、医保授权、结算回写、退款和 HIS 写入仍然关闭。

## 切换前后状态

| 项目 | 切换前 | 切换后 |
| --- | --- | --- |
| 新 API `current` | `5c4e7cf` | `3ab0a6c` |
| 新 API 监听 | `10.0.0.3:18081` | `10.0.0.3:18081` |
| 新 API 进程 | Bun PID `661918` | Bun PID `824343` |
| 旧 Python 监听 | `0.0.0.0:8001` | `0.0.0.0:8001` |
| 旧 Python 进程 | PID `3851370` | PID `3851370` |
| systemd | active | active |
| 数据库迁移 | 未执行 | 未执行 |

切换操作仅为 `current.next -> current` 的符号链接原子替换和新 API 单元重启；没有停止、重启或修改旧 Python 服务。

## 切换后运行时证据

### 内网原始服务路径

2026-08-17 13:58 CST 通过当前服务器直接访问：

- `GET http://10.0.0.3:18081/health/live`：200，`Cache-Control: no-store`；
- `GET http://10.0.0.3:18081/health/ready`：200，`database=ok`、`redis=ok`、`schema=ok`；
- `GET http://10.0.0.3:18081/api/v1/system/ping`：200。

内网健康检查不能错误地拼接 `/api/v2`；`/api/v2` 是公网 Nginx 转发层的前缀。

### 公网入口

通过 `https://test-hp.meiyi.pro` 验收：

- `GET /api/v2/health/ready`：200，`database=ok`、`redis=ok`、`schema=ok`，响应保留 `Cache-Control: no-store`；
- `GET /api/v2/system/ping`：200；
- runtime smoke 的 `health-live`：200；
- runtime smoke 的 `health-ready`：连续 6/6 通过，间隔 2000 毫秒；
- runtime smoke 的 `system-ping`：200；
- runtime smoke 的 `auth-boundary`：401，错误码为 `unauthorized`。

本次 smoke 的最终 traceId 包括 `13081003-2abb-46c8-950a-600a9e9b581b`（6/6 readiness）、
`515cddd6-15f3-40e0-bd4c-42e4fafd9202`（system ping）和
`c257ea71-ccb7-4835-907e-70bdfa20d033`（认证边界）。它们只用于运行时追踪，不代表业务 Provider 成功。

## 业务验收边界

2026-08-17 13:49 CST 在切换前的 `5c4e7cf` 上曾观察到真实微信登录、平台会话、1 位患者目录和 1 条 HIS 映射同步成功。该证据明确属于旧 release，不能升级为 `3ab0a6c` 的真实微信验收。

因此当前真实业务状态仍是：

- 微信登录服务端链路：历史 release 有单账号证据，当前 `3ab0a6c` 待重新验收；
- 患者目录：代码和安全空快照边界已上线，当前版本待重新同步真实账号；
- 多就诊人切换、返回首页后的上下文重建：未验收；
- 预约科室/排班、预约历史、门诊费用 Provider 读取：未把旧 release 证据迁移为当前版本证据；
- 支付、医保授权、结算回写、退款、HIS 写入、报告详情和病历：继续关闭或未注册。

## 日志与权限说明

切换后可以通过公网 response 的 `x-request-id` 和 runtime smoke 日志追踪请求。当前 `ps` 账号的 sudo 白名单只允许新 API 的有限 systemd 操作，不允许无密码读取 `journalctl` 或操作旧服务；因此本记录不伪造切换后 `service.started` 的 journald 内容。生产启动 capability 的完整字段已在切换前真实 env preflight 和候选隔离日志中记录，见
[`candidate-3ab0a6c-preproduction-smoke-2026-08-17.md`](candidate-3ab0a6c-preproduction-smoke-2026-08-17.md)。

## 下一步

1. 让同一微信账号在真机重新执行登录，保存 `auth.wechat.login.succeeded`、`GET /me`、患者目录读取和同步的同一 trace 链；
2. 如果账号有多个就诊人，再验证选择页、返回首页、预约历史和门诊费用的患者隔离；
3. 只读业务出现 Provider 拒绝或字段不完整时，先冻结该功能并补 contract，不使用旧接口转发或空列表兼容；
4. 支付、医保和 HIS 写入最后处理，必须以真实 Provider 文档、状态机、回调/查单和真机证据为准。

如运行时失败，按 [`infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 只回滚新 API 到 `5c4e7cf`，不得停止旧 Python `8001` 或回滚数据库。
