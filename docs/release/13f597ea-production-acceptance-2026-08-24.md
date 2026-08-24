# `13f597ea` 新 API 生产共存发布验收记录（2026-08-24）

> 本记录证明 `13f597ea` 已完成受控切换、启动窗口等待、生产依赖 readiness、公网 runtime smoke 和旧 Python 共存复核。
> 它不把健康检查误写成微信、患者、预约、门诊费用、Provider 或真机业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 小程序客户端 | `13f597e` |
| 小程序构建来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 切换后新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 切换后新 API 主 PID | `896697` |
| 切换后启动时间 | `2026-08-24 11:32:55 CST` |

切换前线上 release 为 `6db3217bd3c990b009571ffd85b7da55d9ea7338`。候选目录已提前完成真实生产 env
preflight、隔离 `18082` runtime smoke 和远端产物校验；生产 env 文件权限仍为 `600`。

## 切换过程与安全边界

1. 第一次切换后，systemd 很快返回 `active`，但立即端口探测撞上 Bun 启动窗口；脚本没有等待 readiness，随后按安全边界回滚到 `6db3217b`。这次过程中旧 Python `8001` 始终保持监听。
2. 修正发布手册，要求 `restart` 后最多等待 15 秒，并在每次轮询中同时确认新 API readiness 和旧 `8001`。
3. 第二次使用修正后的流程原子替换同目录 `current.next -> current`，只执行 `sudo -n systemctl restart hospital-platform-api-v2.service`。
4. 第二次在第 2 次轮询通过 readiness，`current` 指向 `13f597ea`；没有停止、重启或修改旧 Python，没有启动 Worker，没有执行数据库 migration、Redis 清理、支付、医保、退款或 HIS 写回。

## 切换后运行态

| 检查 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/13f597ea9ee3f65b9be858117826d948339d904a` |
| 新 API systemd | `active/running`，`NRestarts=0` |
| 新 API 监听 | `10.0.0.3:18081`，Bun PID `896697` |
| 旧 Python 监听 | `0.0.0.0:8001`，Gunicorn PID `3687390`、`3687419`–`3687422` |
| Worker | `inactive` |
| 内网 readiness | `200`，database/redis/schema 均为 `ok` |
| 公网 readiness | `200`，database/redis/schema 均为 `ok` |
| 公网 system ping | `200`，service=`hospital-api` |

旧 Python 进程集合在切换前后保持不变；新 API 的短暂重启窗口没有改变旧服务监听或流量入口。

## 公网 runtime smoke

使用 `13f597ea` release 自带的 `api-runtime-smoke.js`，注入服务器既有 production env，目标为公网
`https://test-hp.meiyi.pro/api/v2`，没有携带会话、患者标识、微信 code、Provider 原始参数或支付字段。

| 检查 | 结果 |
| --- | --- |
| `health-live` | passed，HTTP `200` |
| `health-ready` | passed，连续 `3` 个样本 |
| `system-ping` | passed，HTTP `200` |
| `auth-boundary` | passed，未登录业务路由返回 `401 unauthorized` |
| `closed-boundary` | passed，关闭能力路由返回 `404 not-found` |

runtime smoke 日志明确记录 `environment=production`，并为每个检查保留低敏 `traceId`；不把这些探针升级为真实业务证据。

## 2026-08-24 12:08 CST 线上只读复核

本次通过受控 SSH 只读取 `hospital-platform-api-v2.service` 和其 journald，不执行重启、配置修改、数据库写入或 Redis
清理。结果如下：

| 检查 | 结果 |
| --- | --- |
| 新 API systemd | `active/running`，主 PID `896697`，启动时间 `2026-08-24 11:32:55 CST` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，仍保持共存 |
| 公网 `/api/v2/health/live` | `200` |
| 公网 `/api/v2/health/ready` | `200` |
| journald 格式 | JSON Pino，含 `event`、`requestId`、`traceId`、路径、状态和 `environment=production` |
| 当前候选业务成功事件 | 未发现可接收的微信登录、患者、预约、普通资料或 Provider 成功事件 |

启动后的日志只观察到健康检查、系统 ping、运行层关闭边界和无会话 `401` 探针；即使路径落在患者、预约、报告或资料
模块，也不能把无 token 的 `401` 当作业务成功。当前仍缺同一 13f 真机会话的页面截图、客户端 requestId、服务端业务事件和
Provider requestId 四方关联证据，因此本次只读复核不会改变真机验收状态。

## 当前业务验收状态

服务端和小程序的运行来源已配套，但当前仍缺少同一 `13f597ea` 会话的手机页面、小程序客户端 `requestId`、服务端
Pino/Provider requestId 三层证据。因此下一步按以下顺序进行只读真机验收：微信登录 → 患者同步与显式切换 → 预约历史在线/全部 → 爽约 → 门诊费用只读。

报告 Provider、支付、医保、退款、预约写入、HIS 写回和 Worker 继续保持关闭；没有正式 contract、授权、状态机、幂等和回滚证据，不能为了页面完整而开放。

若新 API 后续 readiness 或业务运行异常，只允许把 `current` 原子回滚到 `6db3217bd3c990b009571ffd85b7da55d9ea7338` 并只重启
`hospital-platform-api-v2.service`，再次核对 `18081`、公网 readiness 和旧 `8001`；禁止停止旧 Python、删除旧 release、清理 Redis 或回滚 schema。

## 2026-08-24 12:23 CST 线上预约/资料只读观察

本次通过受控 SSH 只读取监听状态和低敏 journald，没有重启、配置修改、数据库写入或 Redis 操作。

| 观察项 | 结果 |
| --- | --- |
| 新 API | `10.0.0.3:18081` 仍由 Bun 监听 |
| 旧 Python | `0.0.0.0:8001` 仍由 Gunicorn 监听，旧进程继续共存 |
| 普通资料 | 观察到 `GET /api/v1/me/profile` 的 `requested → loaded`，`persisted=false`；没有观察到真实 `PUT` 或 `409` |
| 患者目录 | 观察到 owner-scoped 读取 `itemCount=1` |
| 预约在线查询 | 观察到 Provider `zhongyang` 返回 `itemCount=61`，`statusCounts.cancelled=61`，日期窗口为在线历史窗口 |

这说明当前“在线挂号”为空是服务端记录全部被明确取消后，客户端在线筛选排除 `cancelled` 的结果，不能解释为
“Provider 没有返回历史数据”。源码同时确认“全部挂号”使用独立的 `scope=all` 查询并保留取消记录：
`dashboard-service.ts` 生成不带在线日期窗口的 `scope=all` 请求，`api-client.ts` 只把明确的 `all` 范围编码到 query，
不能把在线数组复制成本地全部列表。由于本次 journald 记录的是带日期窗口的在线请求，仍不能把“全部标签已在手机上显示 61 条”
写成真机完成证据；还需要一次真机点击“全部挂号”的页面、客户端 requestId、服务端日志和 Provider requestId 同链记录。
