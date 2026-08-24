# `28a5c0c1` 新 API 生产共存发布验收记录（2026-08-24）

> 本记录证明服务端只读 adapter 门禁候选完成受控切换、生产依赖 readiness、公网 runtime smoke
> 和旧 Python 共存复核。小程序运行包仍为 `13f597e`，服务端与小程序来源不同是本次服务端独立发布的
> 有意结果；本文不把健康检查误写成微信、患者、预约、门诊费用、Provider 或真机业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `28a5c0c131794ce9dcc5f94bd3809402188ac87a` |
| 小程序客户端 | `13f597e` |
| 小程序构建来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 切换前服务端 release | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 切换后启动时间 | `2026-08-24 13:01:47 CST` |

## 发布前安全门禁

1. 在本地使用 Bun 构建 API/worker bundle，上传到
   `/home/ps/code/hospital-platform/releases/28a5c0c131794ce9dcc5f94bd3809402188ac87a`，没有在生产 release 目录构建。
2. 远端 SHA-256 与本地产物逐项一致；目录归属为 `ps:ps`，生产 env 权限为 `0600`。
3. 使用真实 production env 运行 preflight：MySQL、Redis、schema 均为 `ok`；微信 identity、患者目录、预约目录/记录和门诊费用已配置；支付、报告和 Worker 仍关闭。
4. 在 `127.0.0.1:18082` 启动隔离候选并完成 runtime smoke，随后只回收该临时 PID；没有接触旧 Python、数据库写入、Redis 清理或真实 Provider。

## 原子切换与旧服务共存

通过 `current.next-28a5c0c1 -> current` 原子替换后，只执行
`sudo systemctl restart hospital-platform-api-v2.service`。切换后新 API readiness 在第 2 次轮询通过；
旧 Python 没有停止、重启或修改，Worker 没有启动。

| 检查 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/28a5c0c131794ce9dcc5f94bd3809402188ac87a` |
| 新 API | `active/running`，监听 `10.0.0.3:18081` |
| 旧 Python | 仍监听 `0.0.0.0:8001`，切换前后 Gunicorn PID 集合未变化 |
| Worker | `inactive` |
| 内网 readiness | `200`，database/redis/schema 均为 `ok` |
| 旧端口保护 | `8001` 切换前后持续监听 |

## 切换后公网 runtime smoke

使用候选自带的 `api-runtime-smoke.js`，目标为公网
`https://test-hp.meiyi.pro/api/v2`，未携带会话、微信 code、患者标识、Provider 原始参数或支付字段。

| 检查 | 结果 |
| --- | --- |
| `health-live` | `200`，通过 |
| `health-ready` | `200`，连续 `3` 个样本通过 |
| `system-ping` | `200`，通过 |
| `auth-boundary` | 未登录业务路由 `401 unauthorized`，通过 |
| `closed-boundary` | 关闭能力路由 `404 not-found`，通过 |

服务启动日志明确为 `environment=production`、`runtimeMode=production`，并记录 MySQL/Redis/schema
探针为 `ok`。当前候选启动窗口的低敏日志聚合 `parseErrors=0`、`systemdWarningCount=0`；仅包含
健康检查、系统 ping、无会话认证边界和关闭路由探针，没有患者、预约、门诊费用、普通资料或报告业务事件。
这表示当前真机业务证据尚未产生，不表示 Provider 成功或失败。

## 当前业务状态与回滚

服务端候选已具备继续采集真机三层业务证据的运行条件，但以下业务仍未验收：微信真实登录、患者目录同步/显式切换、
预约历史在线/全部、爽约、门诊费用、报告、支付、医保、退款、预约写入和 HIS 回写。支付、医保和 Worker 继续保持关闭。

如果新 API readiness 或业务运行异常，只允许按发布手册将 `current` 原子回滚到
`13f597ea9ee3f65b9be858117826d948339d904a`，并只重启新 API；禁止停止旧 Python、删除旧 release、清理 Redis
或回滚 schema。小程序仍使用 `13f597e`，回滚服务端不会改变小程序运行包来源。

真机证据必须包含页面状态、客户端 `requestId`、服务端 Pino 事件和 Provider 低敏 requestId 的同链关联；
不得记录微信 code、openid、session_key、完整患者身份、Authorization 或 Provider 原文。
