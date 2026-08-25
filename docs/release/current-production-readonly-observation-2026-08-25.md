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

### 2.1 日志关联约定

本次同时核对了 HTTP 请求日志和业务事件日志的字段语义：

- `http.request.completed` / `http.request.failed` 同时记录 `requestId` 和 `traceId`，两者在 HTTP 边界上是同一个经过安全归一化的 `x-request-id`；
- 预约、门诊费用等 service 通过 `adapterContextFromHeaders` 继承同一个 `traceId`，因此业务事件可以直接按 `traceId` 与 HTTP 完成/失败事件关联；
- `providerRequestId` / `providerRequestIds` 只代表 Provider 外部请求链，不能当作平台请求号；
- 业务事件不重复写 `requestId`，也不写 HTTP `statusCode`：前者避免两个同义字段造成检索歧义，后者只属于 HTTP 响应事实。业务排障统一先用 `traceId` 聚合，再读取同一 trace 的 HTTP 状态与 Provider 低敏请求号。

因此，本轮没有为了“看起来字段齐全”增加重复字段，也没有修改旧服务或线上日志格式。

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

## 5. 2026-08-25 03:43 CST 最新运行层复核

本轮再次通过受控 SSH 和公网 HTTPS 做只读复核，结果与上方边界一致：

| 检查项 | 结果 |
| --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081`，Bun 进程仍在监听 |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn worker 仍在监听 |
| 新 API release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 内网 readiness | HTTP 200，`database/redis/schema=ok` |
| 公网 readiness | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 HTTP 200，依赖均为 `ok` |

本次没有重启服务、读取环境变量或凭据、访问患者/Provider 原始数据、写入 MySQL/Redis，
也没有修改旧 Python 服务。该结果只证明新旧运行层继续共存和依赖就绪，不增加任何真机或 Provider 业务验收证据。

## 6. 2026-08-25 10:37 CST 最新低敏复核

通过内网 inspection key 再次执行只读检查，结果如下：

| 检查项 | 结果 |
| --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 最近 15 分钟业务事件 | 未观察到 `auth.wechat`、患者、预约、门诊费用或普通资料事件 |

本次检查没有重启、写配置、读取密钥/令牌/患者原始字段或修改旧服务。最近窗口没有产生新的微信资料授权、
客户端 requestId 或服务端业务 trace，因此当前 `fcc6630e` 真机候选仍只能记录为“等待设备操作”，不能推断
微信资料授权失败，也不能推断业务列表为空。

## 7. 2026-08-25 18:42 CST 最新共存与瞬态依赖复核

本轮再次使用内网 inspection key 只读检查，并从公网 HTTPS 读取健康响应；没有重启、修改配置、读取环境变量/令牌，
也没有写入 MySQL、Redis 或修改旧 Python 项目。

| 检查项 | 结果 |
| --- | --- |
| 新 API systemd | `hospital-platform-api-v2.service=active/running`，Bun 主进程仍为当前服务 |
| 新 API release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d`，监听 `10.0.0.3:18081` |
| 旧 Python | Gunicorn 仍监听 `0.0.0.0:8001`；`systemd` unit 状态不能单独代表旧进程状态，本次没有触碰旧进程 |
| 公网 live/ready/ping | `https://test-hp.meiyi.pro/api/v2/health/live`、`health/ready`、`system/ping` 均返回 HTTP `200`；复核后的 ready body 为 `database=ok`、`redis=ok`、`schema=ok` |

同一窗口的 journald 记录了数据库和 schema 探针一次 `PROTOCOL_CONNECTION_LOST`：

```text
18:42:20 CST  persistence.probe.unavailable  database/schema
18:42:47 CST  persistence.probe.recovered    database/schema
```

这说明探针能够记录“不可用 → 恢复”，但当前只能证明恢复后的瞬时状态，不能把一次公网 `200` 当成持续稳定性或业务验收。
下一次只读业务验收前仍需连续 readiness 观察，并将异常窗口与业务请求分开关联。

本窗口还抽样到一条服务端预约历史读取链：`scope=online` 的 Provider 结果为 61 条，日志中的状态计数全部为
`cancelled`。这只能作为“当前服务端映射结果需要复核”的事实，不能直接解释为用户没有预约，也不能把取消记录改成
有效挂号；应使用同一候选小程序、同一 trace、脱敏 Provider 响应和页面筛选结果复核。另一会话负责的
`packages/adapters/src/zhongyang-appointments.ts` 本轮不修改、不暂存、不部署。

本节服务端日志观察不构成当前 `7bc5956` pending 小程序的真机证据；客户端 requestId、公网链路、服务端 trace、
Provider requestId 和页面结果仍必须来自同一候选配对。

## 8. 2026-08-26 03:09 CST 当前运行层与 A 批次判断

本次使用内网 inspection key 和公网 HTTPS 做只读复核，没有重启服务、读取环境变量/令牌、写入 MySQL/Redis，
也没有修改旧 Python 项目。当前事实如下：

| 检查项 | 结果 |
| --- | --- |
| 新 API release | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python | `0.0.0.0:8001` 仍监听，未触碰 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 内网 readiness | `database=ok`、`redis=ok`、`schema=ok` |
| 公网 readiness | `/api/v2/health/ready` 返回 `200`，依赖均为 `ok` |
| 公网受保护报告接口 | 未带会话返回 `401 unauthorized`，没有把未认证误报为空报告 |

新服务最近 24 小时的低敏业务事件计数为：患者目录读取 `65 requested / 65 loaded`，患者同步 `11`，
预约历史 `5 requested / 5 synced`，门诊费用 `7 requested / 7 loaded`，普通资料 `20 requested / 20 loaded`；
报告目录没有观察到成功事件。这里的计数只用于决定验收顺序，不是业务成功证明：尤其不能从“有 loaded 事件”推导页面、
患者切换和 Provider 字段已经在当前小程序候选上验收。

本轮 A 批次判断：

1. 患者目录、预约历史、门诊费用可以进入同一候选配对的只读验收队列；先收集客户端 `requestId`、公网 HTTP、
   服务端 `traceId`、Provider `requestId` 和页面状态。
2. 报告目录继续保持关闭。当前运行层没有成功报告事件，且服务配置明确为 disabled；不能因为报告页面和 adapter
   的代码存在就打开报告 gate。
3. 支付、医保、结算、退款、预约写入和 HIS 回写仍属于最后批次，不能借用本次只读观察结果开放。

当前服务端 release 与本地 `77cebe5` 小程序 pending 仍不是同一候选，且微信开发者工具仍锁定 live `dist`；
因此本节不写入任何真机完成状态，也不替代下一步的候选发布和设备验收。
