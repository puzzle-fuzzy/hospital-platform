# 2026-08-19 重启后公网只读运行复核

更新时间：2026-08-19 02:04 CST

本记录用于补充一次本地重启后的公网只读观察。它只证明当前公网 `/api/v2` 入口仍能到达新
Bun/Elysia API，并不能替代服务器 SSH 进程核对、真实微信会话、Provider 业务或真机页面验收。

## 1. 请求结果

| 请求 | 结果 | 说明 |
| --- | --- | --- |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | `200` | 服务存活；响应带 `Cache-Control: no-store` |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | `200` | `database=ok`、`redis=ok`、`schema=ok`；响应带 `Cache-Control: no-store` |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | `200` | 系统探针可达 |
| `GET https://test-hp.meiyi.pro/api/v2/me` | `401 unauthorized` | 未携带 Bearer 时认证边界正常 |

本轮没有携带微信会话、患者标识或 Provider 参数，没有执行 MySQL/Redis 写入、同步、预约、
报告、费用、支付、医保或 HIS 操作。

## 2. SSH 进程边界

本轮尝试使用既有只读 SSH 入口时，服务器返回 `publickey`，本地会话没有对应私钥，因此没有
继续尝试修改 SSH 配置，也没有通过终端执行任何服务器命令。故本记录不新增以下结论：

- `hospital-platform-api-v2.service` 当前 systemd 状态；
- `current` 指针实际指向的 release；
- 新 API `18081` 与旧 Python `8001` 是否仍同时监听；
- Worker 是否保持 inactive。

以上项目仍以最近一次已记录的生产切换证据为准；本次公网结果不能覆盖或扩大该证据范围。

## 2.1 后续只读复核（2026-08-19 06:42 CST）

在没有 Bearer、openid、患者参数或写入操作的前提下再次从公网复核：`health/live`、`health/ready`
和 `system/ping` 均返回 `200`，`health/ready` 的 `database/redis/schema` 均为 `ok`；`GET /me`
返回预期 `401 unauthorized`。本次 `/me` 响应的低敏 `x-request-id` 为
`7d4373db-3cf1-4ed6-b2b9-e913a5a80b7a`，未保存响应以外的会话或身份信息。

这次复核仍只证明公网运行层和未登录认证边界，不证明线上 release 指针、旧 Python 共存、Provider、
微信真机或任何患者/费用业务已经验收。

## 3. 后续动作

继续按当前路线图执行：先取得可验证的真实微信会话和多就诊人切换证据，再分别验收预约历史、
门诊费用和报告只读链路。二维码、全部挂号、预约写入、支付、医保和 HIS 继续保持关闭，直到
取得对应的 Provider contract、脱敏样例、错误语义和真机证据。
