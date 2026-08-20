# 当前运行层只读观察（2026-08-20 13:06 CST）

> 本记录只描述一次线上运行层和结构化日志的只读观察，不代表微信真机、Provider、预约、门诊费用、报告、支付或医保业务验收完成。
> 本次没有修改旧 Python 项目、数据库、Redis、Nginx 配置，也没有重启任何服务或主动发起业务请求。

## 观察结果

| 检查项 | 结果 |
| --- | --- |
| 服务器 | `192.168.112.172` |
| 新服务 release | `/home/ps/code/hospital-platform/releases/398be8eca74d4f0245b88695056061ac43c7f860`（`398be8e`） |
| 新 API | `10.0.0.3:18081`，`hospital-platform-api-v2.service=active` |
| 旧 Python API | `0.0.0.0:8001`，仍在监听 |
| Worker | `hospital-platform-worker-v2.service=inactive`，符合支付/补偿任务尚未开放的边界 |
| readiness | `status=ready`，`database=ok`、`redis=ok`、`schema=ok` |

## 最近 30 分钟结构化日志摘要

通过当前 release 的 `p0-log-aggregate.js` 对新 API journald 进行低敏聚合：

```json
{
  "inputLines": 4,
  "parsedRecords": 3,
  "parseErrors": 0,
  "ignoredBlankLines": 1,
  "eventCounts": { "http.request.completed": 3 },
  "domainCounts": { "infrastructure": 3 },
  "outcomeCounts": { "success": 3 },
  "httpStatusCounts": { "200": 3 },
  "systemdWarningCount": 0,
  "traceIdCount": 3,
  "providerRequestIdCount": 0,
  "correlation": {
    "chainCount": 3,
    "recordCount": 3,
    "missingCount": 0,
    "truncated": false
  }
}
```

本窗口没有 `auth.wechat.*`、`patient.directory.*`、`appointment.*`、`report.*` 或
`outpatient.payment.*` 业务事件。这个结果只表示观察期间没有新的业务请求，不能证明业务域故障，
也不能用健康检查或历史日志替代真机页面、HTTP 响应和业务事件三层证据。

## 共存与安全边界

- 新 API 与旧 Python 使用独立监听地址和端口，本次没有停止或重启旧服务；
- 没有调用众阳 Provider、医保接口、支付接口，也没有写入 MySQL 或 Redis 业务数据；
- 日志聚合只输出计数、固定分类和哈希后的关联摘要，不保存 token、患者标识、金额或第三方原始报文；
- 下一步仍应在当前小程序候选 `e050fa0` 上由真实设备产生业务请求，再按同一时间窗口采集页面、HTTP `requestId/traceId` 和低敏日志。
