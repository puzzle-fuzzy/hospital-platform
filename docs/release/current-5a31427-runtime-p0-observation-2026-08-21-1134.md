# `5a31427` 运行层与 P0 业务窗口观察（2026-08-21 11:34 CST）

> 本记录来自服务器只读 SSH 复核。没有部署、重启、修改配置、写入 MySQL/Redis、调用 Provider，
> 也没有触碰旧 Python 服务。日志只输出安全聚合计数，不包含原始请求、token、患者信息或 Provider 响应。

## 1. 共存状态

| 项目 | 结果 |
| --- | --- |
| 当前服务端 release | `/home/ps/code/hospital-platform/releases/5a31427` |
| 新 API | `hospital-platform-api-v2.service=active` |
| Worker | `hospital-platform-worker.service=inactive`（当前按设计关闭） |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python API 监听 | `0.0.0.0:8001` |
| 当前本地代码提交 | `e6c686e`，尚未部署；本地小程序候选仍为 `c86a788` |

## 2. 最近一小时低敏日志聚合

使用当前线上 release 内置的 P0 日志聚合器处理
`hospital-platform-api-v2.service` 的 journald JSON 输出：

| 指标 | 结果 |
| --- | ---: |
| 输入日志行 | 20 |
| 成功解析记录 | 19 |
| 解析错误 | 0 |
| 空白行 | 1 |
| `http.request.completed` | 6 |
| `http.request.failed` | 13 |
| HTTP 200 | 6 |
| HTTP 401 | 8 |
| HTTP 404 | 5 |
| `traceId` 记录数 | 19 |
| Provider request id | 0 |
| `systemd` 警告 | 0 |
| 业务域事件 | 0（全部为 `infrastructure`） |

关联链完整性为 `chainCount=19`、`recordCount=19`、`missingCount=0`；本窗口没有 Provider 请求链。

## 3. 结论与下一步

当前线上运行层和新旧服务共存没有发生漂移，但最近一小时没有新的微信登录、患者目录/同步、预约历史、
门诊费用或普通资料请求。因此这只能证明“当前候选尚未产生业务请求”，不能解释为 Provider 失败、
业务空列表或真机验收成功。

下一步仍应使用 `c86a788` 重新普通编译并生成新二维码，扫码后按“微信登录 → 患者目录同步 → 显式切换患者 →
预约历史/爽约 → 门诊费用 → 普通资料只读/写入”顺序采集页面、客户端 requestId/traceId 和服务端低敏同链事件。
若扫码后仍只有 `infrastructure` 事件，应先检查开发者工具项目根、`miniprogramRoot=dist/`、缓存和公网前缀，
不得通过打开支付、医保或未完成 Provider contract 的路由来绕过证据缺口。
