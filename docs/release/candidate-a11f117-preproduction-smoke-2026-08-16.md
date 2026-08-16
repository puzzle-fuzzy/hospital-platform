# `a11f117` 持久化只读探针候选验收

> 记录时间：2026-08-16（中国标准时间）
> 目标：验证 MySQL/Schema 只读探针有界重试，不改变现网 `d177991`、旧 Python 服务或 Worker 状态。
> 结论：候选本地门禁、真实生产 env preflight 和临时 API smoke 均通过；候选未切换公网。

## 1. 候选与现网边界

| 项目 | 结果 |
| --- | --- |
| 候选 commit | `a11f117` |
| 候选 release | `/home/ps/code/hospital-platform/releases/a11f117` |
| 验证时现网 `current` | `/home/ps/code/hospital-platform/releases/d177991`，全程未改变 |
| 现网新 API | `10.0.0.3:18081`，未重启 |
| 旧 Python API | `0.0.0.0:8001`，仍监听，未操作 |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 临时候选 API | `127.0.0.1:18088`，验证后已停止并释放 |

候选只包含已在本地构建的 API/worker bundle；没有复制或打印 `shared/api.env`，没有执行 migration、业务写入、支付、医保、HIS 或 Provider 业务调用。

## 2. 本地门禁与 bundle 指纹

候选提交前执行 `pnpm check`，架构审计、迁移/Provider 台账、9 个 workspace 类型检查、全部测试和构建均通过。

| bundle | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `fad58ea8c3c58eab7b42eb5fcc91b2e682fa4360fe56793cb416670a873d42e0` |
| `apps/worker/dist/index.js` | `e3e9c253788a318380c0fe40ea7b58b8f2fb4568487e289627295de969778cc3` |
| `apps/worker/dist/preflight.js` | `0606e8c2101a8d4dc4b5392f888d13a4b98f5edb40f5ec2493c44356ceb7ae22` |
| `apps/worker/dist/provider-directory-smoke.js` | `591d4c27feecbd8721861d17b21e0b39e35ad6c5dd00912f4b0fd3c067050b1b` |
| `apps/worker/dist/api-runtime-smoke.js` | `eb285ee332a9ea7782e7f539fe784fd8af9083abc6f8c76082197faaf9712dec` |

SSH 上传后五个服务器文件的 SHA-256 与本地产物一致；候选目录根部没有遗留错误 bundle。

## 3. 真实生产 env preflight

2026-08-16 22:16:24 CST 使用服务器既有 `shared/api.env` 执行候选 `preflight.js`，结果为
`runtime.preflight.succeeded`：

- environment 为 `production`；
- MySQL 为 `ok`；
- Redis 为 `ok`；
- Schema 为 `verified`，目标 migration 为 `0015_patient_directory_sync_operations`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置为 `configured`；
- 微信支付、报告目录和报告详情保持关闭。

preflight 只验证依赖和配置，不启动 Worker，也不代表真实患者或 Provider 业务已经验收。

## 4. 候选临时 API smoke

候选使用真实生产 env，仅覆盖 `HOST=127.0.0.1`、`PORT=18088`，启动日志确认：

- `environment=production`、`runtimeMode=production`；
- 启动时 database/redis/schema 全部为 `ok`；
- `authRuntimeStatus=ready`；
- 患者、预约和门诊费用 gate 保持 configured，支付和报告 gate 保持 disabled。

接口结果：

| 请求 | 结果 |
| --- | --- |
| `GET /health/live` | 200，`status=ok` |
| `GET /health/ready` | 200，database/redis/schema 全部 `ok` |
| `GET /api/v1/system/ping` | 200，`apiVersion=0.1.0` |
| `GET /api/v1/patients`（无认证） | 401，错误码 `unauthorized`，中文安全文案 |

候选 PID `1050547` 收到停止信号后记录 `service.stopped`，`18088` 已确认释放；现网 `18081`、旧 `8001` 和 `current=d177991` 复核不变。

## 5. 本次变更与限制

本次只读探针在 `SELECT 1` 和 Schema 只读查询第一次失败时最多再尝试一次；最终失败仍返回 `unavailable`，不把失败伪装成 ready。业务 repository 的写入、事务和 Provider 调用没有扩大重试范围。

单元测试已覆盖“第一次失败、第二次成功”和“有界重试后仍失败”两条分支；本次临时 smoke 没有主动断开生产数据库连接，因此不能声称已经完成真实断链恢复验收。

下一步仍需：

1. 观察现网 `d177991` 的 MySQL/Schema 稳定性，不因候选 smoke 通过而切换；
2. 稳定后再做当前 release 的真实微信登录、患者同步/切换、预约只读和门诊费用只读验收；
3. 新 Provider 文档到达后，继续按 contract → adapter → API → 小程序 → 真实验收推进病历、报告详情、预约写入和支付相关能力。

