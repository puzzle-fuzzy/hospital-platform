# 当前生产只读运行观察（2026-08-25）

> 本文只记录对新 Elysia 服务的只读观察，不是 Provider、客户端或真机业务验收报告。
> 观察期间没有重启、修改旧 Python 服务、修改数据库/Redis，也没有读取环境变量、令牌或患者原始字段。

## 1. 运行边界

2026-08-25 01:21 CST 通过 SSH 只读检查确认：

| 项目 | 当前事实 |
| --- | --- |
| 新 API 进程 | `hospital-platform-api-v2.service` active/running，Bun 进程监听 `10.0.0.3:18081` |
| 旧 Python 服务 | Gunicorn 继续监听 `0.0.0.0:8001` |
| 新服务启动模式 | 日志明确记录 `runtimeMode=production`、`environment=production` |
| 当前服务 release | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 启动依赖状态 | MySQL、Redis、schema probe 均为 `ok`；认证、患者目录、预约目录、预约历史、门诊费用为 `configured` |
| 仍关闭的能力 | `reportDirectoryConfiguration=disabled`、`reportDetailConfiguration=disabled`、微信支付配置为 `disabled`，支付 runtime 为 `fail_closed` |

新 Elysia 进程只注册内部 `/health/*` 和 `/api/v1/*`。公网域名由阿里云 Nginx 做版本映射：

```text
公网 /api/v2/health/live  ->  内部 /health/live
公网 /api/v2/health/ready ->  内部 /health/ready
公网 /api/v2/*            ->  内部 /api/v1/*
旧服务根路径              ->  继续代理 8001
```

公网只读探针结果为：`/api/v2/health/live=200`、`/api/v2/health/ready=200`、
`/api/v2/system/ping=200`；直接请求内网 `/api/v2/*` 返回 404 是预期行为，不能把它误判成公网路由故障。

## 2. 最近 24 小时低敏业务计数

以下数字来自新服务 journald 的路径/状态计数，只保留路由和 HTTP 状态，不保留请求体、患者标识、卡号或授权头：

| 路由 | 请求次数 | 成功/失败观察 | 结论 |
| --- | ---: | --- | --- |
| `/api/v1/auth/wechat` | 11 | 仅表示曾有登录请求 | 不能替代当前真机登录验收 |
| `/api/v1/patients*` | 138 | 包含目录读取和同步 | 不能从次数推断多患者切换正确 |
| `/api/v1/appointments/departments` | 6 | 目录事件有 `requested/synced` | 不能替代当前候选真机验收 |
| `/api/v1/appointments/schedules` | 3 | 目录事件有 `requested/synced` | 不能把排班观察解释成可预约 |
| `/api/v1/appointments/records` | 17 | 9 次 `200`，8 次 `401`；出现 9 次 `requested/synced` | 预约历史已有生产只读成功观察，但尚缺当前候选的客户端 requestId、公网/真机闭环 |
| `/api/v1/payments/outpatient/records` | 9 | 4 次 `200`，5 次 `401`；出现 4 次 `requested/loaded` | 门诊费用读链路有成功观察，但没有金额非空样例、费用详情或支付证据 |
| `/api/v1/reports` | 5 | 全部 `401` | 当前没有报告 Provider 成功证据，报告 gate 必须继续关闭 |

`401` 只能说明请求未通过当前会话认证，不能被解释为 provider 空列表；`200` 也只说明当次平台读取成功，
不能自动证明客户端展示、患者切换、Provider 字段白名单或真机视觉正确。

## 3. `/api/v2` 404 日志噪声边界

同一时间窗口中，新服务曾收到少量直接访问内部 `/api/v2/health/live|ready` 的 404（低敏统计为 live 2 次、ready 7 次）。
服务器本地 systemd timer、cron 和新项目 Worker 源码中没有发现一个明确的本地业务探针在使用这个前缀；Worker 和应用自身
均使用内部 `/health/live`、`/health/ready`。

当前不增加 `/api/v2` 内部兼容路由，原因是：

1. 这会把公网版本前缀和 Elysia 内部路由职责混在一起；
2. 可能掩盖阿里云 Nginx 或外部监控目标配置错误；
3. 现在公网 v2 已返回 200，兼容路由不能证明真实公网链路更正确。

后续若要清理噪声，应在外部监控/阿里云 Nginx 的只读配置核对后，单独修正探针目标并再次观察，不能改旧 Python 路由。

## 4. 当前迁移结论

- 预约历史：可以进入“当前生产只读观察”阶段，但仍不开放详情、取消、退号、预问诊、预约写入和支付。
- 门诊费用：可以继续做只读页面/字段验收；支付、医保、结算、退款和 HIS 回写保持关闭。
- 报告：没有成功 Provider 证据，目录/详情 gate 继续关闭，不因页面骨架或单元测试通过而开放。
- 业务验收下一步必须由同一当前小程序运行包产生客户端 requestId，再在公网、Elysia/Pino 和 Provider 三层对齐；不能只依赖服务器总计数。

