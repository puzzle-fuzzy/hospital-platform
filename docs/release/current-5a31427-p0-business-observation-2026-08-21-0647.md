# 当前 `5a31427` P0 业务日志窗口（2026-08-21 06:47 CST）

> 本次仅通过 SSH 对线上新 API 做只读检查，没有修改配置、重启服务、调用 Provider、写入 MySQL/Redis，也没有触碰旧 Python 项目。
> 日志没有新的业务事件，不能把“没有请求”解释为空列表成功。

## 运行层与共存状态

| 项目 | 结果 |
| --- | --- |
| 新 API | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081`，Bun 进程监听 |
| 旧 Python API | `0.0.0.0:8001`，Gunicorn 进程继续监听 |
| Worker | `hospital-platform-worker-v2.service=inactive`，保持关闭 |
| 内网 readiness | `200`；database、redis、schema 均为 `ok` |
| 启动模式 | 生产模式；本窗口未改变 release |

## 近 20 分钟日志观察

服务端 journald 的低敏事件只观察到健康探针完成事件，没有新的：

- `auth.*` 微信登录或会话事件；
- `patient.*` 患者目录、同步或切换事件；
- `appointment.*` 预约历史或排班事件；
- `outpatient.payment.*` 门诊费用事件。

窗口内出现的 `/api/v2/health/ready`、`/api/v1/health/ready` 和 `/api/health/ready` `404` 属于直接把公网版本前缀带到
内网应用的路径探针；正确的内网 `/health/ready` 返回 `200`。这类路径探针不能用来判断业务服务失败，也没有触发 Provider。

## 当前结论

当前候选服务运行层和新旧服务共存仍正常，但 `5a31427` 尚未取得新的微信会话或 P0 只读业务三层证据。后续必须使用当前
`6ce1272` 小程序二维码，从微信登录开始，同时保存页面结果、客户端 `requestId/traceId` 和服务端低敏业务日志；预约写入、支付、
医保、退款、病历和 HIS 回写继续保持关闭。

