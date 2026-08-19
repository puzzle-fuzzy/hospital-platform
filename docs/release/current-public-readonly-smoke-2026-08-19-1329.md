# 当前公网只读运行复核（2026-08-19 13:29 CST）

## 1. 复核范围

本次只从公网访问 `/api/v2`，不携带 Bearer、微信 code、患者参数或 Provider 凭证；没有 SSH 登录、服务重启、数据库/Redis
写入，也没有修改旧 Python 服务。目的只是确认反向代理、基础运行层和未登录认证边界仍然存在。

公网入口：`https://test-hp.meiyi.pro/api/v2`

## 2. 结果

| 请求 | 结果 | 解释 |
| --- | --- | --- |
| `GET /health/live` | `200`，`data.status=ok` | API 进程存活 |
| `GET /health/ready` | `200`，`data.status=ready` | 数据库、Redis、schema 均返回 `ok` |
| `GET /system/ping` | `200` | 公共系统探针可达 |
| `GET /patients`（无 Authorization） | `401`，`unauthorized` | 认证边界生效，没有把未登录请求放进患者 service |

未登录错误文案为“请先登录后再继续操作”；本次响应没有返回患者、Provider 或内部引用字段。

## 3. 证据边界

本次结果只证明公网 HTTPS/反向代理、API 基础运行层和未登录认证边界，不能证明：

- 微信 `wx.login`、Redis 会话 TTL 或真实用户 `/me` 恢复成功；
- 患者目录同步、`patInfosFind` 临床映射、多患者切换或 owner 归属正确；
- 预约、报告、门诊费用 Provider 返回了真实数据；
- 小程序页面、真机二维码、Provider 日志和公网请求 trace 已经形成同链证据；
- 支付、医保授权、结算回写、HIS 写入或退款已经开放。

下一步仍需使用当前候选 `4822884` 在新小程序窗口扫码，并按真机验收清单同时保存页面、HTTP trace 和低敏服务端日志。
