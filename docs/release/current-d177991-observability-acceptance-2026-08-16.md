# `d177991` 切换窗口线上观测验收（历史记录）

> 记录时间：2026-08-16（中国标准时间）
> 目标：记录 `d177991` 切换窗口的真实业务证据、历史 release 日志和基础设施瞬态故障。
> 结论：该历史窗口尚未获得真实微信业务验收；数据库依赖在观测窗口内发生过四次短暂不可用，最近一次已恢复但稳定性仍未达标。当前线上版本已进一步切换为 `0b6f38f`，请以 [`0b6f38f-production-acceptance-2026-08-17.md`](0b6f38f-production-acceptance-2026-08-17.md) 为准；本文只保留 `d177991` 观测窗口的历史事实。

## 1. 观测范围

本记录只使用 SSH 在中转服务器上的只读结果，不读取或写出环境变量值、令牌、微信身份标识、患者标识、身份证号、provider 原始响应或费用明细。

- 当时软链接：`/home/ps/code/hospital-platform/current -> releases/d177991`。
- API systemd 进程启动时间：2026-08-16 20:41:28 CST。
- 新 API：`10.0.0.3:18081`，`hospital-platform-api-v2.service=active`。
- 旧 Python API：`0.0.0.0:8001`，仍在监听，未停止。
- 新 Worker：`hospital-platform-worker-v2.service=inactive`，本次没有启动。
- 生产配置：`runtimeMode=production`，目标 schema 为 `0015_patient_directory_sync_operations`。

## 2. 当前 release 启动后的业务证据

从 2026-08-16 20:41:28 CST 开始读取 `hospital-platform-api-v2.service` 的结构化日志，当前窗口只出现持久化探针事件，没有以下任何业务事件：

- `auth.wechat.login.*`
- `patient.directory.*`
- `appointment.*`
- `report.*`
- `outpatient.payment.*`

因此，以下事实仍然没有被当时的 `d177991` 证明：

1. 真机 `wx.login` 成功并建立会话；
2. 当前会话同步并切换就诊人；
3. 预约科室、排班、预约历史在当前 release 上通过公网入口返回；
4. 门诊费用目录在当前 release 上通过公网入口返回；
5. 报告目录和报告详情 provider 业务验收。

此前同一 systemd unit 中、但发生在 `d177991` 启动前的微信、患者、预约和费用事件只能作为历史 release 的连通性线索，不能回填为当前 release 的验收证据。

## 3. 持久化依赖瞬态故障

当前 release 启动后，MySQL 和 Schema 探针同时发生以下状态变化；Redis 探针在同一窗口保持正常：

| 时间（CST） | 事件 | 依赖 | 操作 | 结果 |
| --- | --- | --- | --- | --- |
| 20:59:43 | `persistence.probe.unavailable` | database | `mysql.health_check` | 不可用 |
| 20:59:43 | `persistence.probe.unavailable` | schema | `mysql.schema_check` | 不可用 |
| 20:59:53 | `persistence.probe.recovered` | database | - | 恢复 |
| 20:59:53 | `persistence.probe.recovered` | schema | - | 恢复 |
| 21:05:36 | `persistence.probe.unavailable` | database | `mysql.health_check` | 不可用 |
| 21:05:36 | `persistence.probe.unavailable` | schema | `mysql.schema_check` | 不可用 |
| 21:20:05 | `persistence.probe.recovered` | database | - | 恢复 |
| 21:20:06 | `persistence.probe.recovered` | schema | - | 恢复 |
| 21:55:31 | `persistence.probe.unavailable` | database | `mysql.health_check` | 不可用 |
| 21:55:31 | `persistence.probe.unavailable` | schema | `mysql.schema_check` | 不可用 |
| 21:59:19 | `persistence.probe.recovered` | database | - | 恢复 |
| 21:59:20 | `persistence.probe.recovered` | schema | - | 恢复 |
| 22:04:44 | `persistence.probe.unavailable` | database | `mysql.health_check` | 不可用 |
| 22:04:44 | `persistence.probe.unavailable` | schema | `mysql.schema_check` | 不可用 |
| 22:05:59 | `persistence.probe.recovered` | database | - | 恢复 |
| 22:05:59 | `persistence.probe.recovered` | schema | - | 恢复 |

故障期间：

- `/health/live` 仍返回 200，说明进程没有崩溃；
- `/health/ready` 正确返回 `database=unavailable、redis=ok、schema=unavailable`，服务保持 fail-closed；
- readiness 恢复后再次检查返回 `database=ok、redis=ok、schema=ok`；
- 使用真实生产环境变量运行只读 preflight，MySQL、Redis 和 `0015_patient_directory_sync_operations` schema probe 均通过；22:05:35 CST 的新建连接池 preflight 先于 API 连接池在 22:05:59 CST 恢复。
- 22:07:39 至 22:08:31 CST 的 6 次、每 10 秒一次的短时 readiness 观察均为 `ready`；这只证明恢复后的短窗口，不足以替代更长时间的稳定性观察。

日志只保留了低敏的依赖名、操作名和通用错误类型 `Error`，没有输出连接串、SQL、账号、密码或 provider 原始错误。因而当前证据只能确认“数据库/Schema 依赖发生瞬态不可用”，不能把根因武断归类为账号错误、网络 ACL、远端数据库重启或连接池问题。

## 4. 处理结论

当前不重启旧 Python 服务，不切换数据库，不执行 migration，不启动 Worker，也不因 readiness 瞬态恢复而修改生产配置。应用的 503 和 fail-closed 行为是正确的：登录请求在持久化不可用期间不能伪装成授权失败或成功。四次故障均在当前 release 启动后发生，因此稳定性观察是当前 release 进入真实业务验收的阻断前置。

下一步按以下顺序执行：

1. 继续观察 MySQL 远端连接和 `/health/ready`，至少取得连续稳定窗口后再进行业务验收；
2. 由服务器/数据库侧补充 `8.130.127.184:3306` 的连接拒绝、重置、超时和服务端重启证据；应用侧不记录原始数据库错误；
3. 稳定后使用真实真机链路重新验收：微信登录 → 患者同步 → 更换就诊人 → 预约目录/历史 → 门诊费用只读；每个步骤保存 HTTP 状态、业务事件和 `traceId`；
4. 报告、病历、挂号写入、支付、医保、HIS 和退款继续保持关闭，直到各自的 provider contract、状态样例和真实验收证据齐全。

## 5. 验收状态

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 新旧服务共存 | 已验证 | 新 API `18081` 与旧 API `8001` 同时监听 |
| 历史 release 进程 | 已验证 | `d177991`，production，API active |
| Redis | 当前窗口已验证 | readiness 和 preflight 均为 `ok` |
| MySQL/Schema | 瞬态恢复 | 发生四次不可用，最近一次已恢复；短时 6 次探针通过，仍需更长稳定性观察 |
| 当前 release 微信业务 | 未验收 | 启动后没有 `auth.wechat.*` 事件 |
| 当前 release 患者/预约/费用业务 | 未验收 | 启动后没有对应业务事件 |
| 报告/支付/医保/HIS | 保持关闭 | 没有借助健康检查或历史日志提前放开 |
