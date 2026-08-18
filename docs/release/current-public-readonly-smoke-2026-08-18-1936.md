# 当前公网只读探针记录（2026-08-18 19:36 CST）

本记录只证明公网 HTTPS 入口、依赖 readiness 和未登录认证边界可复核；不证明微信会话、患者目录、
Provider 业务、真机页面或任何预约/费用/支付/医保/HIS 写入。探针没有携带 Bearer、openid、患者标识
或 Provider 参数，也没有修改服务器、数据库、Redis、旧 Python 服务或新 API release。

## 1. 探针结果

请求基址：`https://test-hp.meiyi.pro`，所有请求均为 `GET`。

| 路径 | HTTP | 低敏结果 |
| --- | ---: | --- |
| `/api/v2/health/live` | 200 | `success=true`，`service=hospital-api`，`status=ok` |
| `/api/v2/health/ready` | 200 | `success=true`，`status=ready`，`database=ok`、`redis=ok`、`schema=ok` |
| `/api/v2/system/ping` | 200 | `success=true`，`service=hospital-api` |
| `/api/v2/me/profile` | 401 | `success=false`，`error.code=unauthorized`；`x-request-id=ac90198e-c85b-43b7-b6ba-9c68a7e813d3` |
| `/api/v2/patients` | 401 | `success=false`，`error.code=unauthorized`；`x-request-id=afb070f6-b8cf-4f30-99eb-fa227b086a58` |

## 2. 证据边界

- 本次公网响应没有携带 release commit，因此不能用它单独证明线上仍运行某个具体 bundle；release provenance 仍以独立发布证据为准。
- 未登录接口按预期拒绝，不能替代真机扫码、微信会话、患者目录同步、患者切换或页面 Network trace。
- readiness 只证明依赖探针通过；不能推断预约历史、爽约、报告、门诊费用已经能返回真实 Provider 数据。
- SSH 只读连接 `ps@192.168.112.172` 在当前环境因 `Permission denied (publickey,password)` 未建立，因此本次不新增新旧监听端口或 systemd 进程共存证据。
- 本次没有执行登录、Provider 请求、业务写入、migration、Redis 写入、release 切换、重启或旧服务操作。

下一步仍按 [`miniprogram-readonly-acceptance-candidate-2026-08-18.md`](miniprogram-readonly-acceptance-candidate-2026-08-18.md)
等待新 `miniprogram` 项目扫码，再以页面、HTTP trace 和低敏业务日志三层证据验收。
