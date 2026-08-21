# `5a31427` 新旧服务共存只读复核（2026-08-21 07:25 CST）

> 本记录只覆盖线上运行层和日志窗口，不代表微信登录、患者切换、预约、报告、门诊费用、支付或医保业务已经完成真机验收。
> 本次没有修改配置、重启服务、调用 Provider、执行 migration，亦没有写入 MySQL 或 Redis。

## 运行状态

| 检查项 | 结果 |
| --- | --- |
| 新 API systemd 服务 | `hospital-platform-api-v2.service=active/running` |
| Worker | `hospital-platform-worker-v2.service=inactive`（按当前设计保持关闭） |
| 新 API 监听 | `10.0.0.3:18081`，Bun 进程 |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn 进程仍在监听 |
| 新 API 工作目录 | `/home/ps/code/hospital-platform/current` |

## 探针结果

内网服务直接访问时不带公网反向代理前缀，正确路径为：

- `GET http://10.0.0.3:18081/health/live`：`200`；
- `GET http://10.0.0.3:18081/health/ready`：`200`，`database=ok`、`redis=ok`、`schema=ok`。

公网反向代理路径继续保持：

- `GET https://test-hp.meiyi.pro/api/v2/health/live`：`200`；
- `GET https://test-hp.meiyi.pro/api/v2/health/ready`：`200`；
- `GET https://test-hp.meiyi.pro/api/v2/system/ping`：`200`。

因此，直接对内网服务请求 `/api/v2/health/ready` 得到 `not-found` 只表示把公网代理前缀误用于内部路由，不能当作新 API 健康故障；公网路径和内网路径必须分别按上述契约检查。

## 业务日志窗口

从服务端最近 10 分钟 journald 低敏事件中，没有观察到新的：

- `auth.*`；
- `patient.*`；
- `appointment.*`；
- `outpatient.payment.*`；
- `user.profile.*`。

这只能说明当前观察窗口没有新的业务请求，不能解释为业务失败，也不能替代真机页面、客户端 HTTP trace 和服务端事件的三层证据。当时下一步曾计划在历史 `9340846` 运行包上重新生成二维码；当前应改用 `6677671` 建立真实微信会话。
