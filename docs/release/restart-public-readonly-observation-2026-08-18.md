# 重启后公网运行层只读观察（2026-08-18）

## 观察时间与范围

- 观察时间：2026-08-18 15:13:34 CST；
- 入口：`https://test-hp.meiyi.pro/api/v2`；
- 方式：从开发机发起只读 HTTPS GET；
- 未携带会话、患者标识、Provider 参数或业务写入请求；
- 未执行 SSH 命令、服务重启、Nginx 修改、数据库写入或 Redis 修改。

## 结果

| 探针 | HTTP | 结果 |
| --- | ---: | --- |
| `/health/live` | 200 | `success=true`、`status=ok`、`service=hospital-api`，响应含 `Cache-Control: no-store` |
| `/health/ready` | 200 | `status=ready`，`database=ok`、`redis=ok`、`schema=ok`，响应含 `Cache-Control: no-store` |
| `/system/ping` | 200 | `success=true`、`service=hospital-api` |

## 证据边界

本次观察证明重启后公网新 API 路由仍能返回健康响应，不能证明本地候选 `4ae2a31` 已部署，也不能仅凭公网响应证明旧 Python `8001` 的 PID、监听或代理配置仍未变化。
当前线上 release 仍以最后一次 SSH 确认的 `9acdaf2` 为准；恢复授权 SSH 后必须重新核对 systemd release、内外网端口、旧服务 PID/监听和日志窗口。

本次没有产生微信登录、患者同步、预约、报告、门诊费用、支付、医保或 HIS 业务证据。
