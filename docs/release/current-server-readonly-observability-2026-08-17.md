# 2026-08-17 线上当前只读观察

> 本文记录 2026-08-17 约 12:25（中国标准时间）通过 SSH 对中转服务器的当前只读复核。
> 未发布候选代码、未重启或停止服务、未执行 migration、未清理缓存、未读取患者明文或凭证，
> 也未执行预约、支付、医保、退款和 HIS 写入。文档只保留可维护的低敏运行事实。
>
> 这是 `6d58c9c` 切换前的历史快照；切换后的当前 release、0016 migration 和生产运行证据见
> [`6d58c9c-production-acceptance-2026-08-17.md`](6d58c9c-production-acceptance-2026-08-17.md)。

## 1. 运行版本与新旧服务共存

| 检查项 | 只读结果 |
| --- | --- |
| 服务器 | `192.168.112.172`，主机名 `ps` |
| 新 API | `hospital-platform-api-v2.service` 为 `active/running`；Bun/Elysia 监听 `10.0.0.3:18081` |
| 切换前历史 release | `/home/ps/code/hospital-platform/current -> releases/131fb5a` |
| 新 API 运行模式 | journald 启动日志标记为 `production`；systemd 从 `/home/ps/code/hospital-platform/shared/api.env` 读取环境变量，值未进入本文 |
| 旧 Python API | 进程仍运行并监听 `0.0.0.0:8001`；本次未修改、停止或重启 |
| 本地候选 | `a4033b0` 及后续测试清理提交尚未部署；线上不能使用本地 Git HEAD 推导 |

这证明“新旧服务同时运行”的基础设施边界仍成立，但不证明两套服务的所有业务语义已经一致。
当前没有触碰旧 Python 服务，也没有改变旧服务使用的端口、进程和数据路径。

## 2. 健康检查与公网边界

### 2.1 服务器内网只读检查

- 新 API 的 `/health/live` 返回 `200`，服务状态为 `ok`。
- 新 API 的 `/health/ready` 返回 `200`，`database`、`redis`、`schema` 均为 `ok`。
- 新 API 的 `/api/v1/system/ping` 返回 `200`。
- `/api/v1/health/live` 和 `/api/v1/health/ready` 返回 `404`；这是服务内部健康路由不带 `/api/v1` 前缀的正常现象，不能据此误判服务故障。

### 2.2 公网只读检查

从服务器访问公网入口 `https://test-hp.meiyi.pro/api/v2`：

- `/health/live` 返回 `200`；
- `/health/ready` 返回 `200`，数据库、Redis、schema 依赖均为 `ok`；
- `/system/ping` 返回 `200`。

公网 12:06 CST 的认证关闭边界、未登录 401 和病历/医保授权/预约写入 404 另见
[`current-public-readonly-smoke-2026-08-17.md`](current-public-readonly-smoke-2026-08-17.md) 的 2.6 节。
健康检查通过不等于微信、患者、预约历史或门诊费用已经真机验收。

## 3. 低敏业务日志观察

本次从服务日志筛选 12:00 CST 之后的低敏事件，只保留事件名、状态和数量：

| 事件 | 观察结果 | 能证明什么 |
| --- | --- | --- |
| `auth.wechat.login.requested` | 1 次 | 线上确实收到过微信登录请求 |
| `auth.wechat.login.succeeded` | 1 次 | 至少有 1 次微信身份兑换和会话签发成功 |
| `patient.directory.operation.started` | 4 次 | 患者同步操作进入服务端流程 |
| `patient.directory.requested` | 4 次 | 患者目录查询已向服务端业务层发起 |
| `patient.directory.synced` | 4 次 | 至少有 4 次同步完成事件 |
| `/api/v1/me`、`/api/v1/patients`、`/api/v1/patients/sync` | 后续请求返回 `200` | 当前会话窗口内患者基础链路曾恢复成功 |
| `appointment.records`、`outpatient.payment`、`user.profile` | 本窗口未观察到业务事件 | 不能宣称预约历史、门诊费用和资料已在线验收 |

同一窗口内曾观察到一次患者目录请求因 `PROTOCOL_CONNECTION_LOST` 返回 `503`，后续 `/me`、患者目录和同步请求恢复为 `200`。
这只能说明存在一次可恢复的持久化连接抖动，不能把后续成功解释为稳定性已达标；后续仍需连续窗口和业务真机证据。

## 4. Redis 会话 TTL 验证结论

新 API 进程的已建立连接指向远端 Redis `8.130.127.184:6379` 的 DB3；本机 `127.0.0.1:6379` 不是本次 API 会话 TTL 的有效验证目标。

在服务器内使用共享环境配置进行脱敏探测得到：

| 探测项 | 结果 |
| --- | --- |
| 远端 Redis `PING` | `PONG` |
| `SCAN hospital:session:*` | 当前 SSH 账号 `denied_or_failed` |
| 会话数量 | 未验证 |
| 会话 TTL 最小/最大值 | 未验证 |

这里明确区分“Redis 可连接”和“会话 TTL 可审计”：前者已通过，后者因 ACL/SCAN 权限边界没有证据。
本次没有放宽 ACL、没有输出 key、没有输出 token，也没有把空扫描结果写成“没有会话”。需要运维提供不暴露 key 的聚合结果，或在受控权限下重新采样后，才能完成 TTL 验收。

## 5. 当前决策

已完成的线上前置证据：

- 新旧服务共存、旧 Python `8001` 未受影响；
- 本历史快照中的新 Elysia release `131fb5a` 处于 production mode；
- MySQL、Redis、schema readiness 通过；
- 公网 live、ready、system ping 通过；
- 线上出现过真实微信登录成功和患者同步成功日志。

仍未完成、因此暂不继续打开的范围：

- Redis 会话 TTL、第二位患者、多患者切换、inactive/recovery；
- 普通资料读取/更新冲突、预约历史、爽约和门诊费用的真机三层证据；
- 报告目录 Provider gate；
- 预约写入、微信支付、医保授权与结算、退款、HIS 回写。

下一步只从 P0 只读业务中选择一个可取得完整 Provider 事实的域继续验收；若 Provider 字段、状态或权限无法确认，立即冻结该域并切换到下一个只读域，不新增猜测性兼容代码。
