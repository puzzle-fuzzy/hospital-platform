# 当前公网只读复核（2026-08-20）

> 本记录只证明公网入口、健康检查和未授权边界在本次观察窗口可用；不代表微信登录、患者同步、众阳 Provider、
> 真机页面、预约、报告、门诊费用、支付或医保已经验收。

## 1. 观察范围

观察地址：`https://test-hp.meiyi.pro/api/v2`

本次只执行无凭证的 GET 请求，没有携带 Bearer Token、微信 code、患者 ID、Provider 参数或写入请求。

| 路径 | HTTP | 结果 |
| --- | ---: | --- |
| `/health/live` | 200 | `success=true`，`status=ok` |
| `/health/ready` | 200 | `success=true`，`status=ready` |
| `/system/ping` | 200 | `success=true` |
| `/me` | 401 | `error.code=unauthorized` |
| `/patients` | 401 | `error.code=unauthorized` |
| `/appointments/records?...` | 401 | `error.code=unauthorized` |

## 2. 证据边界

本次观察可以确认：

- 公网 HTTPS 路径仍然能够到达新 API；
- liveness 和 readiness 在观察时刻均通过；
- 未授权请求没有绕过会话校验进入用户或患者数据接口；
- 本次没有调用 Provider，也没有产生 MySQL、Redis 或业务写入。

## 3. SSH 运行层补充复核（2026-08-20 12:05 CST）

随后通过 SSH 只读检查 `192.168.112.172`，没有重启服务、修改配置或写入业务数据：

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `hospital-platform-api-v2.service` | `active` | 新 API 仍由 systemd 管理 |
| 当前 release | `398be8eca74d4f0245b88695056061ac43c7f860` | 与短提交 `398be8e` 一致 |
| 新 Bun API | `10.0.0.3:18081` | 新旧服务并行监听 |
| 旧 Python API | `0.0.0.0:8001` | 旧服务仍在运行，未被停止 |
| 公网 `/api/v2/health/live` | `200` | `success=true` |
| 公网 `/api/v2/health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok` |
| 公网 `/api/v2/system/ping` | `200` | 新 API 公网反向代理可达 |

本次 SSH 检查还对最近运行日志做了低敏事件名观察，未发现新的业务事件匹配行；这只能说明该观察窗口没有形成可复核的业务链，
不能把它解释成 Provider 或真机业务失败。当前线上 release 已确认是 `398be8e`，本地最新修正 `e050fa0` 尚未部署。

本次观察仍不能确认：

- 本地最新 commit `e050fa0` 是否已经部署（当前线上仍是 `398be8e`）；
- 真实微信登录是否能取得有效 session；
- 当前账号是否能同步患者目录并完成 `patInfosFind` 档案映射；
- 预约历史、报告、门诊费用和小程序页面是否完成真实三层验收；
- 支付、医保、HIS 写入和二维码协议是否满足开放条件。

后续若继续业务验收，应使用同一个真实微信会话按“登录 → `/me` → 患者同步 → 患者读取 → 只读业务页面”的顺序取证，
并用同一 `traceId/requestId` 关联 API 日志和 Provider request id。没有该证据时，不把健康检查成功解释成业务成功。
