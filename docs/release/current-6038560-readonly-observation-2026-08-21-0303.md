# `6038560` 当前线上只读运行观察（2026-08-21 03:03 CST）

> 本文只记录服务端运行层和低敏日志聚合，不代表微信登录、患者同步、患者切换、预约、门诊费用、普通资料或其它业务已经完成真机验收。
> 本次通过 SSH 只读检查阿里云中转内网服务器；没有修改旧 Python 服务、配置、数据库、Redis、Worker 或线上业务数据。

## 1. 运行层事实

| 项目 | 结果 |
| --- | --- |
| 新 API 当前 release | `/home/ps/code/hospital-platform/current -> releases/6038560` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| Worker | `inactive` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，继续共存 |
| 内网 readiness | `200`，`database=ok`、`redis=ok`、`schema=ok` |

## 2. 切换后低敏日志窗口

使用当前 release 自带的 `apps/worker/dist/p0-log-aggregate.js`，对
`2026-08-21 02:46:00 CST` 之后的 API journald 做只读聚合：

```json
{
  "parsedRecords": 1,
  "parseErrors": 0,
  "eventCounts": { "http.request.completed": 1 },
  "domainCounts": { "infrastructure": 1 },
  "outcomeCounts": { "success": 1 },
  "httpStatusCounts": { "200": 1 },
  "traceIdCount": 1,
  "providerRequestIdCount": 0,
  "correlation": {
    "chainCount": 1,
    "recordCount": 1,
    "missingCount": 0,
    "truncated": false
  }
}
```

当前窗口没有 `auth.*`、`patient.*`、`appointment.*`、`outpatient.payment.*` 或
`user.profile.*` 业务事件，也没有 Provider 请求号。正确结论是“当前 release 尚未取得新的真实业务请求证据”，
不能把无事件解释成 Provider 失败，也不能用健康检查替代真机页面、客户端 trace 和业务成功链。

## 3. 下一步

真机验收仍须由新的小程序 `dist/` 运行包生成二维码后，使用同一微信会话按以下顺序操作：

```text
微信登录 → 患者目录刷新 → 显式选择就诊人 → 我的挂号 → 爽约记录 → 门诊费用待缴/已缴
```

每个业务域都必须同时保存页面结果、客户端脱敏 HTTP/trace 和同一时间窗口的服务端低敏事件；任一患者归属、状态、金额、日期或关联链不一致，立即停止该域。
