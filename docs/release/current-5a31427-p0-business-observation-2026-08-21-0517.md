# `5a31427` 当前 P0 业务窗口观察（2026-08-21 05:17 CST）

## 观测范围

本记录来自服务器 `192.168.112.172` 的只读 SSH 检查，服务器时间为
`2026-08-21T05:17:22+08:00`。本次只读取新 API 的 systemd 状态、监听端口、当前 release、
readiness 和最近 30 分钟的新 API journald；没有修改配置、重启服务、调用 Provider，也没有写入
MySQL/Redis。旧 Python 服务保持原状态。

| 项目 | 结果 |
| --- | --- |
| 新 API systemd | `active` |
| 当前 release | `5a31427` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| 当前 release 目录 | `/home/ps/code/hospital-platform/releases/5a31427` |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |
| 最近 30 分钟 journald | 1 条 `GET /health/ready`，HTTP `200` |
| 业务事件 | 未发现 `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*` 或 `user.profile.*` |

## 结论

当前新旧服务共存、生产 release 和依赖 readiness 正常；但本窗口只有健康检查，没有新的微信登录、
患者目录/切换、预约历史、爽约、门诊费用或普通资料业务请求。因此不能把“服务 active”、端口监听、
readiness 或健康检查解释成业务验收成功，也不能据此判断 Provider 失败。

当前候选仍需由真实设备产生业务流量，验收必须同时保留：

1. 真机页面结果；
2. 客户端 HTTP 的脱敏 `traceId/requestId`；
3. 服务端同一时间窗口的低敏请求、明确成功事件和 HTTP `2xx` 关联链。

在三层证据形成前，不开放预约写入、全部挂号、报告 Provider、患者绑定、支付、医保或 HIS 回写；
旧 Python `8001` 不属于本次改动范围。
