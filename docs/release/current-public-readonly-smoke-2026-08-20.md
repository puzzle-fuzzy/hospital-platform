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

## 2. 证据边界

本次观察可以确认：

- 公网 HTTPS 路径仍然能够到达新 API；
- liveness 和 readiness 在观察时刻均通过；
- 未授权请求没有绕过会话校验进入用户或患者数据接口；
- 本次没有调用 Provider，也没有产生 MySQL、Redis 或业务写入。

本次观察不能确认：

- 当前服务端是否已经部署本地 commit `1186937` 的档案卡片归属修正；
- 真实微信登录是否能取得有效 session；
- 当前账号是否能同步患者目录并完成 `patInfosFind` 档案映射；
- 预约历史、报告、门诊费用和小程序页面是否完成真实三层验收；
- 旧 Python 服务与新 API 进程是否仍同时监听（需要 SSH/内网只读证据）；
- 支付、医保、HIS 写入和二维码协议是否满足开放条件。

后续若继续业务验收，应使用同一个真实微信会话按“登录 → `/me` → 患者同步 → 患者读取 → 只读业务页面”的顺序取证，
并用同一 `traceId/requestId` 关联 API 日志和 Provider request id。没有该证据时，不把健康检查成功解释成业务成功。
