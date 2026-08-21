# 当前 `c8eef370` 运行层只读观察（2026-08-21 23:10 CST）

> 本记录来自 `192.168.112.172` 的只读 SSH 复核。它只确认新服务运行状态、监听共存、依赖 readiness 和低敏日志窗口，
> 不代表微信登录、患者目录、预约、门诊费用、报告或任何 Provider 业务已经完成真机验收。

## 1. 运行状态

| 项目 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/c8eef370` |
| `hospital-platform-api-v2.service` | `active` |
| `hospital-platform-worker.service` | `inactive`（支付/异步 Worker 未启动） |
| 新 API 监听 | `10.0.0.3:18081`，进程为 Bun |
| 旧 Python 监听 | `0.0.0.0:8001`，进程为 gunicorn |
| 旧服务影响 | 未修改、未重启，仍保持监听 |

新旧端口在本窗口同时存在。该结果只证明新服务可以与旧服务共存，不能证明两套服务使用了相同的业务读写语义。

## 2. 依赖 readiness

只读请求 `http://10.0.0.3:18081/health/ready` 返回成功，依赖状态为：

```json
{"success":true,"data":{"status":"ready","dependencies":{"database":"ok","redis":"ok","schema":"ok"}}}
```

没有执行 migration、没有写入 MySQL/Redis，也没有调用众阳、医保或支付接口。

## 3. 最近 30 分钟低敏日志聚合

使用当前 release 中的 `apps/worker/dist/p0-log-aggregate.js` 对
`hospital-platform-api-v2.service` 的 journald JSON 输出进行聚合，结果为：

| 指标 | 结果 |
| --- | --- |
| `inputLines` / `parsedRecords` | `6` / `5` |
| `parseErrors` | `0` |
| `ignoredBlankLines` / `ignoredControlLines` | `1` / `0` |
| `eventCounts` | `http.request.completed=4`、`http.request.failed=1` |
| `domainCounts` | 仅 `infrastructure=5` |
| HTTP 状态 | `200=4`、`404=1` |
| `errorTypeCounts` | 仅 `NOT_FOUND=1` |
| `traceIdCount` / `providerRequestIdCount` | `5` / `0` |
| correlation | `chainCount=5`、`missingCount=0`、`truncated=false` |

当前窗口没有 `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*`、`report.*` 或
`user.profile.*` 业务事件，也没有 Provider 请求号。因此不能把这段空业务窗口解释成“业务失败”，
更不能把健康检查或单个 HTTP 200 当作真机业务完成证据。

## 4. 下一步

1. 重新打开新项目 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，确认运行根为 `dist/`，普通编译并生成当前候选二维码。
2. 以同一微信会话依次验证登录、患者同步、显式切换患者、预约历史/爽约和门诊费用只读。
3. 每个域同时保留页面结果、客户端 `traceId/requestId` 和当前 release 的低敏业务事件；没有三层证据就不标记为完成。
4. 保持支付、医保、退款、预约写入、报告 Provider gate 和 HIS 回写关闭。

本次没有部署、重启、配置写入或旧 Python 项目操作。
