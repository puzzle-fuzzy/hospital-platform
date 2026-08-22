# `2a2acd9` 运行层只读观察（2026-08-22 09:35 CST）

> 本记录只保存服务器进程、监听端口和日志读取权限边界。
> 它不把二维码、进程 active 或空日志聚合解释成微信登录、患者、预约或门诊费用业务完成。

## 1. 服务器共存状态

| 项目 | 观察结果 |
| --- | --- |
| 服务器 | `ps@192.168.112.172` |
| 当前 release 路径 | `/home/ps/code/hospital-platform/releases/2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 新 Bun API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python API | Gunicorn 继续监听 `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 本次变更 | 只读检查；未重启服务、未修改旧项目、未修改数据库或 Redis |

## 2. 日志证据边界

尝试使用当前 release 的 `p0-log-aggregate.js` 对 `2026-08-22 09:25 CST` 之后的新 API journald 做低敏聚合。
`ps` 账号无法通过 `sudo -n journalctl` 读取系统日志，聚合输入不足，因此本次不记录业务事件计数。

尤其不能把以下结果解释为“没有业务请求”：

- `parsedRecords=0`；
- `auth.*`、`patient.*`、`appointment.*` 或 `outpatient.payment.*` 计数为空；
- `providerRequestIdCount=0`。

这些只是日志读取权限不足后的无效观察，不是业务域的负面证据。后续必须在具备受控日志读取权限时，继续只输出
`p0-log-aggregate.js` 的计数和同链摘要，不输出 token、姓名、身份证、手机号、患者号、费用或原始 Provider 响应。

## 3. 下一步

真机验收仍以 `dc8cd5b8` 小程序运行包为准。用户扫码后，需要把页面结果、客户端公共 `requestId` 和服务端同链低敏日志
配对；在日志证据可读取前，不将任何只读业务标记为当前 release 已验收，也不进入支付、医保或 HIS 写回。

