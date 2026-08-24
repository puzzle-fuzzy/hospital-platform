# `6db3217b` 当前运行态共存只读观察（2026-08-24）

> 本记录只描述本轮通过内网 SSH 和公网健康探针观察到的运行态。它证明服务仍在运行和新旧端口共存，不能替代微信登录、患者切换、预约、门诊费用或真机三层业务验收。

## 观察范围

- 观察方式：使用受控内网 SSH 只读检查 `ps@192.168.112.172`，并从公网访问 readiness 探针。
- 本轮没有执行：代码上传、`current` 切换、systemd 重启、旧 Python 停止、数据库 migration、Redis 清理或 Provider 写操作。
- 当前线上 release：`6db3217bd3c990b009571ffd85b7da55d9ea7338`。
- 待切换候选：`13f597ea9ee3f65b9be858117826d948339d904a`，本轮仍未部署。

## 当前运行态

| 检查项 | 本轮观察结果 | 结论 |
| --- | --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/6db3217bd3c990b009571ffd85b7da55d9ea7338` | 线上仍是已验证 release |
| `hospital-platform-api-v2.service` | `active` | 新 API 服务正常运行 |
| `hospital-platform-worker.service` | `inactive` | Worker 仍保持关闭，符合当前只读边界 |
| 新 API 监听 | `10.0.0.3:18081`，Bun PID `694065` | 新服务内网监听正常 |
| 旧 Python API 监听 | `0.0.0.0:8001`，Gunicorn 主进程 `3687390`，worker `3687419`–`3687422` | 旧服务仍在，共存边界未被破坏 |

## 公网 readiness

公网 `GET https://test-hp.meiyi.pro/api/v2/health/ready` 本轮返回 `HTTP 200`，响应为：

```json
{"success":true,"data":{"status":"ready","dependencies":{"database":"ok","redis":"ok","schema":"ok"}}}
```

该请求返回的低敏 `x-request-id` 为 `45d83f6b-8591-4c57-9d73-58b702065c32`，只用于本轮健康探针链路定位；它不构成业务请求或 Provider 成功证据。

## 业务结论

1. 线上 `6db3217b` 仍是当前 release，候选 `13f597ea` 没有因为本轮复核而提前切换。
2. 新 Bun API、旧 Python API 和数据库/Redis 的共存运行态没有发现异常；本轮没有修改旧服务。
3. Worker 继续关闭，因此不会因为后台任务误触发预约写入、支付、医保、退款或 HIS 写回。
4. 预约“全部挂号”范围修正仍需候选切换后重新取得页面、客户端 requestId、服务端 Pino/Provider requestId 三层证据，不能用本地测试或旧 release 日志代替。

## 下一步准入

只有在取得服务器 sudo 授权并确认维护窗口后，才允许执行候选切换。切换前后必须再次确认：

- 只操作 `hospital-platform-api-v2.service`，不停止旧 Python `8001`；
- `current`、新 API `18081`、旧 API `8001` 和公网 readiness 均有前后对照；
- 候选启动日志明确为 `environment=production` / `runtimeMode=production`，并完成数据库、Redis、schema 探针；
- 候选小程序运行包来源与服务端 release 配套后，再进行真机只读业务验收；
- 任何业务失败都先保留 requestId/traceId 和低敏 Pino 事件，再判断是否回滚，不通过复制测试脚本、改旧服务或放开关闭业务来掩盖问题。
