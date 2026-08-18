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
