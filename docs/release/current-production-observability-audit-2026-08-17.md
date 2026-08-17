# 2026-08-17 当前生产可观测性与依赖稳定性复核

> 本文只记录通过 SSH 读取 `hospital-platform-api-v2.service` journald 的结果，未读取 env、数据库数据或会话，
> 未执行重启、发布、migration、缓存清理或业务写入。日志中的用户身份字段不进入本文；只保留可关联的低敏
> trace/provider request 标识和状态事实。
>
> 证据窗口截止于 `b186098` 切换后的历史日志。当前线上 release 已进一步切换为 `9833a01`，其发布和切换后
> smoke 结果以 [`9833a01-production-acceptance-2026-08-17.md`](9833a01-production-acceptance-2026-08-17.md)
> 为准；本文件中的抖动和登录事件不能直接归因于 `ca5a372`。

## 1. 复核范围

| 项目 | 值 |
| --- | --- |
| SSH 主机 | `192.168.112.172`（主机名 `ps`） |
| 服务 | `hospital-platform-api-v2.service` |
| 复核日期 | 2026-08-17（中国标准时间） |
| 日志范围 | 当前服务最近 400 条 journald，筛选启动、持久化探针、微信登录、患者同步和排班快照事件 |
| 操作类型 | 只读 |

## 2. 观察到的事实

### 2.1 启动状态

2026-08-16 23:48:42 CST 的 `service.started` 日志显示：

- `runtimeMode=production`，日志 host 为 `10.0.0.3`、port 为 `18081`；
- `persistenceSchemaGate=true`，database、Redis、schema 探针均为 `ok`；
- `authRuntimeStatus=ready`，微信身份配置为 `configured`；
- 患者目录、预约目录、预约记录和门诊费用配置为 `configured`；
- 微信支付、报告目录和报告详情配置为 `disabled`。

> 启动日志的长 JSON 在 SSH 终端中会折行；端口和进程仍以 [`production-coexistence-readonly-audit-2026-08-17.md`](production-coexistence-readonly-audit-2026-08-17.md)
> 的 `ss` 结果为准，不能仅凭终端折行拼接字段。

### 2.2 持久化依赖抖动

日志出现多组成对事件：

| 时间（CST） | 事件 | 依赖/操作 | 结果 |
| --- | --- | --- | --- |
| 21:05:36 | `persistence.probe.unavailable` | database / `mysql.health_check` | 不可用 |
| 21:05:36 | `persistence.probe.unavailable` | schema / `mysql.schema_check` | 不可用 |
| 21:20:05-06 | `persistence.probe.recovered` | database、schema | 恢复 |
| 21:55:31 | `persistence.probe.unavailable` | database、schema | 再次不可用 |
| 21:59:19-20 | `persistence.probe.recovered` | database、schema | 再次恢复 |
| 22:04:44 | `persistence.probe.unavailable` | database、schema | 再次不可用 |
| 22:05:59 | `persistence.probe.recovered` | database、schema | 再次恢复 |

上述事件说明 readiness 是瞬时状态，不能只看单次 HTTP 200 或单次启动日志就进入真实业务验收。
当前需要继续定位 MySQL 远端连通性、连接池和网络抖动；禁止通过放宽 readiness、增加无限重试或伪造 `ok`
来掩盖问题。

### 2.3 微信登录与患者同步

| 时间（CST） | 事件 | 结果 | 关联标识 |
| --- | --- | --- | --- |
| 23:08:55 | `auth.wechat.login.failed` | `PersistenceUnavailableError`，HTTP 503 | journald 中有对应 traceId |
| 23:09:08 | `auth.wechat.login.succeeded` | 会话签发成功，`expiresInSeconds=3600` | journald 中有对应 trace/provider request |
| 23:09:11 | `patient.directory.synced` | `patientCount=1`、`activePatientCount=1`、`deactivatedPatientCount=0`、`hisPatientReferenceCount=1` | journald 中有对应 trace/provider request |
| 00:13:22 | `auth.wechat.login.failed` | `PersistenceUnavailableError`，HTTP 503 | journald 中有对应 traceId |

这证明日志能关联登录、依赖错误和患者同步，但只证明一位患者的成功样例；没有证明 Redis 实际 TTL、
第二位患者、多患者切换、失效恢复或真机完整链路。

### 2.4 预约目录观察

- 预约科室曾返回 `itemCount=62`。
- 一次排班快照持久化失败，原因是 `PersistenceUnavailableError`；后续一次排班快照以
  `snapshotPersistenceStatus=persisted` 成功保存，TTL 观察为短期快照。
- 该过程证明当前服务可以在 Provider 返回后明确区分“Provider 读成功但快照未持久化”和“持久化成功”，
  但不授权锁号、预约写入或支付。

### 2.5 基础设施进程只读核对

- API unit 的 `ExecStart` 为 `/home/ps/.bun/bin/bun /home/ps/code/hospital-platform/current/apps/api/dist/index.js`，
  当前 `EnvironmentFiles` 只确认使用 `/home/ps/code/hospital-platform/shared/api.env`，没有读取文件内容；unit
  配置为 `Restart=on-failure`、`RestartUSec=5s`。
- `mysql.service` 为 `active/running`，`0.0.0.0:3306` 正在监听；
- `redis-server.service` 为 `active/running`，`127.0.0.1:6379` 和 `[::1]:6379` 正在监听；
- 本次服务器上没有发现 Docker 容器承载这两个依赖；
- 抽查 MySQL/Redis 最近 300 条 systemd 日志，没有筛到重启、OOM、崩溃或明显错误摘要；当前
  `/var/log/mysql/error.log` 和 `/var/log/redis/redis-server.log` 文件大小为 0，历史日志已轮转，
  因此不能把“当前日志为空”解释成“历史没有错误”。

因此当前证据不能把 API 探针抖动归因于数据库/Redis 进程停止；更可能需要继续检查 API shared env 中的
数据库目标（不把值写入 Git）、API 到 MySQL 的瞬时连接、连接池、网络路径或探针重试时序。没有更直接
证据前，不修改连接超时、不放宽 readiness，也不清理缓存。

### 2.7 `b186098` 切换后运行证据

本节记录前述只读复核之后的正式切换结果；切换动作只重启新 API unit，旧 Python `8001`、Worker 和业务数据未触碰。

- `current` 已从 `41c9c18` 原子切换到 `b186098`，新 API PID `1803489`，unit 为 `active`；
- 2026-08-17 01:16:21 CST 的 `service.started` 确认 `runtimeMode=production`、`10.0.0.3:18081`、
  database/Redis/schema `ok`，患者/预约/记录/门诊费用 configured，支付/报告 disabled；
- 切换后使用 release bundle 对公网 `/api/v2` 完成 6/6 readiness、no-store、system ping 和未登录 401；
- 该证据解除候选运行前置阻断，但不证明真实微信、多患者、Provider 或真机业务完成。完整 release 证据见
  [`b186098-production-acceptance-2026-08-17.md`](b186098-production-acceptance-2026-08-17.md)。

### 2.6 API 实际连接目标

通过 `ss -ntp` 只读查看进程当前已建立的 TCP 连接，并对新 API env 只输出脱敏目标（不输出用户名、密码、
token 或完整连接串）得到：

- Bun API PID `1431434` 当前连接远端 `8.130.127.184:3306` 两条 MySQL 连接，以及
  `8.130.127.184:6379` 一条 Redis 连接；
- 新 API 脱敏 env 目标为 MySQL `8.130.127.184:3306/hospital-dev`、Redis `8.130.127.184:6379/3`；
- 旧 Python PID `636918` 当前连接同一远端 `8.130.127.184:6379` 两条 Redis 连接；本次快照没有看到
- 旧 Python 的生产配置文件 `/home/ps/code/Hospital-Backend/env/.env.prod` 经严格脱敏后确认：
  MySQL `8.130.127.184:3306/hospital-dev`、Redis `8.130.127.184:6379/1`、MongoDB
  `127.0.0.1:27017/admin`；密码、用户和其他敏感字段未输出；
- `127.0.0.1:3306` 和 `127.0.0.1:6379` 虽然可建立 TCP 连接，但当前没有证据表明 Bun API 使用本机这两项服务；
- 远端 MySQL/Redis TCP 端口在本次核对时均可达。

这条边界很重要：不能因为服务器本机也有 MySQL/Redis 就把新 API 的连接目标改成本机，除非先确认数据库
实例、schema、Redis DB/ACL、旧服务依赖和数据一致性；否则可能把新服务切到另一套数据，破坏旧服务共存。
当前可以确认新旧服务共用同一个 MySQL `hospital-dev`，新 API 使用 `hp_*` 表、旧服务继续使用 legacy
表；Redis 则通过 DB3/DB1 分离。MongoDB、旧 Redis namespace、旧任务和其他基础设施仍未迁移。

### 2.7 恢复后的公网短观察

2026-08-17 00:52:49-00:52:59 CST 从公网连续请求 `/api/v2/health/ready` 6 次，6/6 返回
`status=ready`，且 database、redis、schema 均为 `ok`。这只能证明该 10 秒窗口内远端依赖可用，不能关闭
前面记录的长时间抖动风险；后续仍需更长稳定窗口，并关联远端 MySQL 的连接错误或网络指标。

## 3. P0 决策

当前 P0 不应直接进入预约历史、报告或门诊费用的真实业务验收，先完成：

1. 在不泄露凭证的前提下比对新 API 与旧服务的数据库/Redis 目标、数据库名、Redis DB/ACL 和网络路径，
   再定位 MySQL/schema 探针抖动的根因；至少取得一段连续稳定的 readiness 和无新增
   `persistence.probe.unavailable` 观察窗口；
2. 对微信登录 503 使用新的真实 `wx.login` code 复测，保存失败/恢复的 traceId，并确认失败时小程序只显示
   可重试中文错误，不留下半会话；
3. 取得第二位患者或明确“当前账号只有一位患者”的 Provider 事实，再验证选择、切换、inactive 和恢复；
4. 依赖稳定后，按预约历史 → 门诊费用 → 报告目录的顺序逐域补 Provider、内网、公网、开发者工具/真机证据。

当前 API 进程、MySQL 和 Redis 都处于运行状态，不能据此关闭该风险；下一次定位应关联同一时刻的 API
探针事件、TCP 连接/连接池指标和 MySQL 服务端连接错误，而不是只看 `systemctl is-active`。

## 4. 不应据此宣称的内容

- `service.started` 中 capability 为 `configured` 不等于 Provider 权限和真实业务已验收；
- `patientCount=1` 不等于多就诊人迁移完成；
- 单次登录成功不等于登录链路稳定；
- 排班快照 `persisted` 不等于锁号或预约授权；
- 公网 `ready` 返回 200 必须同时读取 body 的 `status` 和依赖状态，不能只看 HTTP 状态码。
