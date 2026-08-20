# `5a31427` 新旧服务共存只读复核（2026-08-21 06:31 CST）

## 结论

本次仅通过 SSH 和公网执行只读检查，没有修改线上配置、重启服务、调用众阳/医保/支付 Provider，
也没有写入 MySQL 或 Redis。新 Bun/Elysia API 与旧 Python 服务继续共存，旧服务没有被触碰。

## 运行层证据

| 检查项 | 结果 |
| --- | --- |
| 新 API release | `5a31427`，`hospital-platform-api-v2.service=active` |
| 新 API 进程 | Bun，监听 `10.0.0.3:18081` |
| 旧 Python 服务 | Gunicorn，监听 `0.0.0.0:8001`，未修改、未重启 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 新 API 启动模式 | journald 明确记录 `environment=production`、`runtimeMode=production`、`authRuntimeStatus=ready` |
| 内网 readiness | `GET http://10.0.0.3:18081/health/ready` 返回 `200`，database/Redis/schema 均为 `ok` |

新 API 的内部监听路径是 `/health/ready`；`/api/v2` 是公网代理路径，不能把两者直接拼接后在内网探测。

## 公网只读证据

以下请求均通过 `https://test-hp.meiyi.pro` 完成：

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `/api/v2/health/live` | 200 | `status=ok` |
| `/api/v2/health/ready` | 200 | database/Redis/schema 均为 `ok` |
| `/api/v2/system/ping` | 200 | `service=hospital-api`、`apiVersion=0.1.0` |

## 证据边界

这次只证明服务进程、旧端口共存、生产模式、基础依赖和公网代理正常；没有产生微信登录、患者同步、预约历史、
门诊费用或普通资料的业务请求，因此不能替代真机页面、客户端 `traceId/requestId` 和服务端业务事件的三层验收。
支付、医保、报告 Provider、病历、患者绑定、预约写入和 HIS 写回仍保持原有关闭/待 contract 状态。
