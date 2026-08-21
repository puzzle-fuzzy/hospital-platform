# `7181e99e` 生产共存发布验收记录（2026-08-22）

## 结论

服务端 `7181e99e3a352244102f5591279528b3b66332c9` 已在不停止旧 Python 服务的前提下完成生产切换。
本次只切换新 Bun/Elysia API，并只重启 `hospital-platform-api-v2.service`；旧 Python `8001`、数据库、
Redis、Nginx 和 Worker 均未被本次发布重启或改写。

本次发布的核心变化是把“已配置 Redis 的连接/ACL/传输故障”从错误的
`dependency-not-configured` 改为 `persistence-temporarily-unavailable`，避免客户端把基础设施故障
误判为登录失效并清理本地会话。真实微信、患者、预约、门诊费用 Provider 和真机业务证据仍未由本次
运行层验收产生；支付、医保、HIS 写回和报告 Provider 继续保持最后专项/关闭状态。

## 1. 版本与产物

| 项目 | 结果 |
| --- | --- |
| 服务端 commit | `7181e99e3a352244102f5591279528b3b66332c9` |
| 小程序配套来源 | `90fd7832e3ad1031c9c916f118f90cc0f2840aff`（`90fd783`） |
| 本地发布包 SHA-256 | `A3D397FF1D984A2E2BF119AEB18A5CD9159BBD1933E86E3624D9C8D7FDFC2A1A` |
| 远端发布包 SHA-256 | 与本地一致 |
| API bundle | 远端 hash 与本地构建产物一致 |
| Worker bundle | 8 个 bundle 均完成远端/本地 hash 比对；本次不启动 Worker |

本地 `pnpm check` 已通过，包含类型检查、Biome、API/持久化/小程序测试、构建、文档和发布基线门禁。
小程序运行包仍由 `90fd7832e3ad1031c9c916f118f90cc0f2840aff` 生成，14 个页面入口齐全，
`dist/` 不含 `*.test.js` 或 `*.spec.js`；开发者工具报出的 `single-flight.test.js` 仍应按旧增量索引
清理流程处理，不能把测试脚本复制进运行包。

## 2. 切换前候选验收

- 使用线上真实 `shared/api.env` 执行生产 preflight：通过；微信身份、MySQL、Redis、schema、患者目录、
  预约目录/记录和门诊费用依赖均为已配置，支付保持关闭，报告目录/详情保持关闭。
- 候选以 `127.0.0.1:18082` 隔离启动：通过；启动日志明确记录 `environment=production`、
  `runtimeMode=production`、数据库/Redis/schema 探针为 `ok`。
- 隔离 runtime smoke：live、ready（连续 3 次）、system-ping 返回 200；未登录受保护路由返回
  401 `unauthorized`；关闭路由返回 404。隔离端口退出后无残留监听。

## 3. 原子切换与共存结果

切换前 `current` 指向 `84fac75ceeb2247b252cf7e160eedbda220378f8`。完成候选验证后，服务器先创建
临时符号链接，再原子替换 `current`，随后只执行：

```text
sudo systemctl restart hospital-platform-api-v2.service
```

切换后复核结果：

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `releases/7181e99e3a352244102f5591279528b3b66332c9` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 内网 live/ready/ping | `200 / 200 / 200` |
| 公网 live/ready/ping | `200 / 200 / 200`；ready 的 database/redis/schema 均为 `ok` |
| 未登录 `/api/v2/me` | `401 unauthorized` |
| 关闭路由 | `404 not-found` |
| 旧 Python | `0.0.0.0:8001` 持续监听，切换前后 Gunicorn PID 未变化 |
| 新 Worker | `inactive`，本次未启动 |
| `18082` | 无残留监听 |

旧 Python 的监听和进程共存是本次安全边界，不能因为新 API 健康就把旧服务视为已迁移或可下线。

## 4. 启动日志与错误语义

切换后的 journald 启动记录包含以下低敏字段：

```text
environment=production
runtimeMode=production
persistenceDatabaseProbe=ok
persistenceRedisProbe=ok
persistenceSchemaProbe=ok
authRuntimeStatus=ready
wechatIdentityConfiguration=configured
wechatPaymentConfiguration=disabled
reportDirectoryConfiguration=disabled
reportDetailConfiguration=disabled
msg=Hospital API listening in production mode
stop_failures=0
```

已配置 Redis 的 `GET`/`SET` 传输失败现在应映射为 HTTP 503
`persistence-temporarily-unavailable`；只有正常读到空值才映射为 401 `unauthorized`，未注入依赖才是
503 `dependency-not-configured`。这条故障注入路径还需要后续受控验证，不能把本次 readiness 通过解释为
Redis 故障场景已完成验收。

## 5. 切换后低敏日志观察（2026-08-22 05:03–05:23 CST）

使用当前 release 自带的 `p0-log-aggregate.js` 读取新 API journald，仅输出聚合计数：

| 指标 | 结果 |
| --- | --- |
| `parsedRecords` / `parseErrors` | `29 / 0` |
| 事件 | `service.started=1`、`service.stop.requested=1`、`service.stopped=1`、`http.request.completed=10`、`http.request.failed=16` |
| HTTP | `200=10`、`401=9`、`404=7` |
| 业务域 | 仅 `infrastructure` |
| `providerRequestIdCount` | `0` |
| systemd warning | `0` |

该窗口包含切换后的启动和运行层 smoke，没有新的微信登录、患者目录/切换、预约、报告或门诊费用事件。
因此“日志能正常收集”与“真机业务已验收”仍然是两件事；下一步必须由当前小程序候选产生真实会话，
再用页面结果、客户端 requestId 和服务端低敏事件完成三层关联。

## 6. 未完成与停止条件

本次只证明新服务运行层、发布产物来源、生产模式日志和新旧服务共存，不能替代以下证据：

- 真机微信登录、会话续期和多就诊人显式切换；
- 预约历史/爽约、门诊费用的 Provider requestId、页面结果和同链低敏日志；
- 报告 Provider contract、报告目录/详情的真实只读数据；
- 支付、医保授权、结算、退款、预约写入和 HIS 回写。

后续仍按“真实微信会话 → 患者选择 → 只读预约/费用 → 普通资料 → 报告 contract → 支付/医保/HIS 最后”
执行。任一只读业务出现患者归属、字段形状、状态或日志不一致，应停止该业务域并回到 contract 审计，
不能用兼容转发或空列表掩盖问题。
