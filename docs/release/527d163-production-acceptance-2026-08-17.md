# `527d163` 持久化瞬态故障日志增强生产验收

## 1. 发布范围与安全边界

本次发布只增强持久化暂时不可用错误的服务端可观测性：

- `PersistenceUnavailableError` 只暴露 `read`、`write`、`transaction` 操作分类；
- 只有固定允许列表中的连接/传输错误码可以进入结构化日志；
- 原始 `cause` 仍只保留在服务端错误对象中，不进入 HTTP 响应、Pino 日志或小程序；
- MySQL 连接错误识别统一复用同一份规则；幂等读仍只在连接池内有界重试一次；
- 写入、事务、预约、支付、医保、退款和 HIS 不增加盲目重试。

本次不修改公共业务 response，不修改共享 env，不执行 migration，不启动 Worker，不触碰旧 Python
服务、旧端口 `8001`、旧 Redis DB1 或支付/医保/HIS gate。

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `527d16395837dc928b94e918316fe224a92ea39b` |
| 新 API release | `/home/ps/code/hospital-platform/releases/527d163` |
| 切换前 release | `/home/ps/code/hospital-platform/releases/ca5a372` |
| 切换后 release | `/home/ps/code/hospital-platform/current -> releases/527d163` |
| 新 API | `hospital-platform-api-v2.service`，`10.0.0.3:18081`，active |
| 旧 API | Python PID `636918`，`0.0.0.0:8001`，继续运行 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 候选端口 | `127.0.0.1:18082`，验收后已停止并释放 |

## 2. 本地门禁与测试

提交前 `pnpm check` 全部通过：

- architecture / migration / provider intake 审计通过；
- Biome format/lint 通过；
- 9 个 workspace typecheck 通过；
- API 76 条、持久化 64 条、小程序 53 条、Worker 45 条测试通过，其他 workspace 测试也全部通过；
- API、Worker 和原生小程序构建通过。

新增测试覆盖：

- 允许列表错误码 `PROTOCOL_CONNECTION_LOST` 可以进入 `persistenceErrorCode`；
- `persistenceOperation` 只记录内部操作分类；
- 未知 code 或可能包含连接信息的 code 不会进入日志；
- 原始错误消息、SQL 和连接串不进入日志元数据。

## 3. bundle 指纹与生产 preflight

五个服务器 bundle 与本地产物 SHA-256 一致：

| bundle | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `a7c95aabac0b66ea0aff68779d9a9f8dc9ed80eb0106384c20e3b1679a3d2e99` |
| `apps/worker/dist/index.js` | `a85c5f09d33bf44b915e836c11a5f0785aa8e5c0a848b5642cdf44f8deea32f2` |
| `apps/worker/dist/preflight.js` | `27a0a7d37fdf65902b85f5b2b71789a4403b1a49f64d94d61ccae601ddb79071` |
| `apps/worker/dist/provider-directory-smoke.js` | `dd22c5d402ba63eccc7f6962e2e89cc17736eea35f84da107d586d6bcf21eb00` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

服务器使用既有 `shared/api.env` 执行生产 preflight，结果为 `runtime.preflight.succeeded`：

- MySQL、Redis 和 schema 均通过，schema 为 `verified`，目标 migration 为
  `0015_patient_directory_sync_operations`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用为 `configured`；
- 微信支付、报告目录和报告详情保持 `disabled`；
- preflight 只读配置和依赖，没有启动 Worker、执行 migration 或访问患者/Provider 业务。

## 4. 候选临时端口验收

候选使用生产 env，只覆盖 `HOST=127.0.0.1`、`PORT=18082` 和 `NODE_ENV=production`。
候选启动日志明确包含 `environment=production`、`runtimeMode=production`，且 database、Redis、schema
探针均为 `ok`，认证和患者/预约/门诊费用配置状态与生产 env 一致。

候选 runtime smoke 结果：

| 检查 | 结果 |
| --- | --- |
| `health-live` | 200 |
| `health-ready` | 200，连续 3/3 ready |
| `system-ping` | 200 |
| `auth-boundary` | 通过，受保护路径均为 401/`unauthorized` |

候选收到 SIGTERM 后正常停止，`18082` 已确认释放；切换前 `current` 仍为 `ca5a372`。

## 5. 原子切换与公网验收

候选停止后，在同一父目录通过 `current.next -> current` 原子替换，只重启
`hospital-platform-api-v2.service`。切换后确认：

- `current=/home/ps/code/hospital-platform/releases/527d163`；
- 新 API active，启动日志为 `environment=production`、`runtimeMode=production`；
- MySQL/Redis/schema 均为 `ok`，`authRuntimeStatus=ready`；
- 旧 Python PID `636918` 仍存在，`8001` 仍监听；
- Worker 保持 inactive，`18082` 没有残留监听。

公网 `https://test-hp.meiyi.pro/api/v2` runtime smoke 结果：

| 检查 | 结果 | trace/request 证据 |
| --- | --- | --- |
| `health-live` | 200 | `7c6c6d74-4e8e-4e86-a1f0-a77c4d99404a` |
| `health-ready` | 200，连续 6/6 ready | `7bba4300`、`18f1c9ab`、`d1cce067`、`f957a695`、`ab61149d`、`6861d806` |
| `system-ping` | 200 | `03ac1230-cf7a-4f88-a348-8b4d9980e933` |
| `auth-boundary` | 通过，401/`unauthorized` | `f3e7022e-c764-418a-8aa4-e79f98582b20` |

本次公网 smoke 只验证运行前置和认证边界，没有读取真实患者、预约历史、门诊费用或报告业务。

## 6. 真实业务证据与瞬态故障边界

`ca5a372` 切换后、`527d163` 切换前，真实开发者工具链路出现了以下可复核事实：

- 首次微信登录在 `02:18:26 CST` 返回一次 503，服务端事件为 `PersistenceUnavailableError`；
- 同一用户约 3 秒后重试，微信登录返回 200，随后 `/patients` 完成 1 位 active 患者同步和 1 条
  `his-patient` 映射；
- 同一链路随后读取预约科室 62 条、排班 1 条，排班快照持久化状态为 `persisted`；
- 当时日志没有安全的底层连接错误码，因此不能仅凭现有证据断言具体是连接丢失、超时还是其他瞬态故障。

本次 `527d163` 已补齐该诊断字段，但切换后尚未产生新的真实登录失败样本，因此不能宣称瞬态故障已经
根治。下一次真实登录若再次出现 503，应按同一 `traceId/requestId` 检索 `http.request.failed`、
`auth.wechat.login.failed`、`persistenceOperation` 和 `persistenceErrorCode`，再与 MySQL/网络日志
交叉核对。写入类故障仍必须先查询持久化事实，不能按日志错误码直接重放。

## 7. 未宣称范围与下一步

本次不能宣称以下内容已经完成：

- Redis 实际 TTL、会话过期恢复、第二位就诊人、多患者切换和 inactive/recovery；
- 预约历史、门诊费用、报告的当前 release 公网/真机完整业务验收；
- 普通资料真实读写和 409 版本冲突；
- 预约锁号/写入/取消、微信支付、医保授权/结算、退款、HIS 回写或 Worker 生产循环；
- 病历详情、费用详情、患者新增/绑定、二维码/公众号关注、动态医院、外部 WebView 和便民服务。

下一步继续按 `真实微信会话/TTL → 多患者切换与失效恢复 → 预约历史 → 门诊费用 → 普通资料` 的顺序，
每个领域分别建立 Provider、平台公网、真机页面和日志四层证据。新的 Provider 文档到达后，先登记来源、
版本、指纹、脱敏样例和错误/状态定义，冻结 contract 后再进入实现。

