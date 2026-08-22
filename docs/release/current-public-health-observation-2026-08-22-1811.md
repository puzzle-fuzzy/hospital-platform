# 当前公网健康探针只读观察（2026-08-22 18:11 CST）
> 当前服务端发布基线（2026-08-22 18:55 CST）：`0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；本观察仅为健康探针，不替代真机或 Provider 业务证据。

> 本记录只证明公网新 API 的健康和依赖探针，不证明微信登录、患者同步、预约、门诊费用、报告或真机业务完成。
> 本轮没有使用会话、患者参数或 Provider 请求，也没有修改旧 Python 服务、数据库或 Redis。

## 当前配套候选

| 项目 | 值 |
| --- | --- |
| 服务端 release | `84370077024762d92050cf077c27f3c60302e8f8`（`84370077`） |
| 小程序运行包来源 | `a64fe023bc34fe6e44f93846c39e202fe02d64a5`（`a64fe023`） |
| 观测方式 | 本机 HTTPS GET，只读、无 Bearer、无业务参数 |

## 探针结果

| 公网路径 | HTTP | 低敏结果 |
| --- | ---: | --- |
| `/api/v2/health/live` | `200` | `status=ok`, `service=hospital-api` |
| `/api/v2/health/ready` | `200` | `status=ready`, `database=ok`, `redis=ok`, `schema=ok` |
| `/api/v2/system/ping` | `200` | `service=hospital-api`, `apiVersion=0.1.0` |

## 证据边界

- 探针没有携带微信会话，不产生 `auth.wechat.*`、患者、预约、费用或报告业务证据。
- 当前 SSH 只读尝试仍被中转机拒绝公钥认证，因此本窗口不能刷新 systemd 进程、监听端口或 journald 的现场状态；不能用公网健康探针替代该信息。
- 真机验收仍必须同时取得手机页面、客户端脱敏 `requestId` 和服务端 Pino 同链事件。
