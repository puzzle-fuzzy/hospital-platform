# 重启后新旧服务共存只读复核（2026-08-18）

本文记录用户反馈服务器刚才重启后，对新 Bun/Elysia API、旧 Python API 和公网转发做的只读复核。
本次没有重启服务、切换 release、执行 migration、写入 MySQL/Redis 或请求任何患者/Provider 业务。

## 1. 复核时间和目标

| 项目 | 结果 |
| --- | --- |
| 复核时间 | 2026-08-18 11:54 CST |
| SSH 目标 | `ps@192.168.112.172` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 当前 release | `/home/ps/code/hospital-platform/releases/c63dba9` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python API 监听 | `0.0.0.0:8001` |

## 2. 结果

### 2.1 内网直连新 API

内网服务地址不包含公网版本前缀，以下响应均成功：

| 请求 | 结果 |
| --- | --- |
| `GET http://10.0.0.3:18081/health/live` | `200`，`status=ok` |
| `GET http://10.0.0.3:18081/health/ready` | `200`，`database=ok`、`redis=ok`、`schema=ok` |
| `GET http://10.0.0.3:18081/api/v1/system/ping` | `200`，`service=hospital-api` |

### 2.2 公网转发

公网 Nginx 使用 `/api/v2` 作为新服务的版本化入口，以下响应均为 `200`：

| 请求 | 结果 |
| --- | --- |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | `200` |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | `200` |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | `200` |

### 2.3 旧服务边界

`ss -ltn` 同时看到 `10.0.0.3:18081` 和 `0.0.0.0:8001`，没有端口覆盖。旧 Python 服务没有被本次复核停止、
重启或修改；旧域名根路径仍由原有转发链路负责。

### 2.4 当前时间窗口的低敏日志

使用服务器 `journalctl` 从 2026-08-18 11:45 CST 起读取，并通过当前 release 的日志聚合 bundle 只输出计数：

| 指标 | 结果 |
| --- | --- |
| 输入行 / 解析记录 | `53 / 52` |
| `parseErrors` | `0` |
| `systemdWarningCount` | `0` |
| HTTP `200 / 404` | `22 / 2` |
| 患者目录 requested / loaded / synced | `4 / 8 / 4` |
| 去重 `providerRequestId` | `4` |

该窗口的两个 `404` 与本次错误拼接内网 `/api/v2/health/*` 的探测相符；修正为内网健康路径后，
live、ready 和 system ping 均成功。没有把这两个路径错误计入业务失败，也没有把患者目录事件推导成预约、
费用或真机验收完成。

### 2.5 12:06 CST 继续复核

本轮继续使用 SSH 只读检查，当前服务端 release 未变化，仍为 `c63dba9`；本地刚提交的原生小程序入口修正
`f44600e` 尚未部署到服务器。结果如下：

| 指标 | 结果 |
| --- | --- |
| systemd / 监听 | `active`；新 API `10.0.0.3:18081`、旧 Python `0.0.0.0:8001` 同时存在 |
| 内网 live / ready / ping | `200 / 200 / 200`，database、redis、schema 均为 `ok` |
| 公网 live / ready / ping | `200 / 200 / 200` |
| journald 输入行 / 解析记录 | `48 / 47`，`parseErrors=0`，`systemdWarningCount=0` |
| HTTP `200 / 404` | `24 / 2`；`404` 为已知路径探测，不扩展为业务故障 |
| 患者目录请求 / 读取成功 / 同步成功 | `3 / 6 / 3` |
| 去重 `providerRequestId` | `3` |

该窗口仍没有新的微信登录、预约历史、爽约、门诊费用或报告业务链证据；患者目录日志只证明当前服务有
低敏请求/结果记录，不能代替真机页面、HTTP trace 或 Provider 字段验收。旧 Python 服务未被本轮停止、
重启或修改。

### 2.6 12:17 CST 重启后再次复核

再次通过 SSH 执行只读检查，当前服务仍未切换 release、重启或写入业务数据：

| 指标 | 结果 |
| --- | --- |
| systemd / 当前 release | `active`；`c63dba9` |
| 新旧监听 | `10.0.0.3:18081` 与 `0.0.0.0:8001` 同时存在 |
| 内网 ready | `200`；database、redis、schema 均为 `ok` |
| 公网 ready | `200`；database、redis、schema 均为 `ok` |
| 当前 release 的 TTL 工具 | 不存在；不能用未发布脚本冒充当前 release 证据 |
| 同一生产 Redis ACL 的 TTL 探测 | 候选 `9ca3a89` 工具返回 `redis-session-scan-unavailable`，退出码 `2` |

TTL 结果仍然是“未验证”，不是“没有会话”：常驻 API Redis ACL 可以连通 Redis，但没有会话 key 的扫描权限，
因此没有输出 key、token 或 TTL，也没有修改 ACL、Redis、数据库或业务数据。最近日志的低敏聚合本次未重复声称通过，
因为当前 SSH sudo 规则未授予 `journalctl` 无密码读取权限；后续必须由运维提供独立只读日志权限或安全聚合结果。

## 3. 维护注意事项

内网健康探针必须使用 `/health/live`、`/health/ready`，内网系统探针使用 `/api/v1/system/ping`；公网才使用
`/api/v2/health/live`、`/api/v2/health/ready` 和 `/api/v2/system/ping`。直接把公网 `/api/v2` 前缀拼到内网
服务上会得到 `404`，这表示路径层级错误，不表示新 API 或旧 API 中断。

## 4. 仍未证明的内容

本次只证明进程、监听、依赖 readiness 和版本化公网路由恢复，不能替代：

- 真机微信登录和会话过期恢复；
- 第二位就诊人切换、失效/恢复以及跨患者隔离；
- “我的挂号”、爽约、门诊费用和报告的真实 Provider 字段与页面闭环；
- 普通资料真实 PUT/409；
- Redis 会话 TTL；
- 预约写入、微信支付、医保授权/结算、退款和 HIS 回写。
