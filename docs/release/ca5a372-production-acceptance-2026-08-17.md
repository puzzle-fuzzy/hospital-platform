# `ca5a372` 受保护接口认证顺序修复生产验收

## 1. 发布范围与边界

本次发布修复 Elysia 受保护模块的生命周期顺序：在 query/body/params 的 TypeBox schema 校验前，
先验证 Bearer 会话。这样未登录或会话失效请求统一返回 `401 unauthorized`；只有认证通过后，
业务参数不合法才返回 `400 validation`。微信登录入口和微信支付通知回调仍是显式公开入口。

本次只更新新 Bun/Elysia API bundle，不修改旧 Python 服务、不重启旧端口 `8001`、不启动 Worker、
不执行数据库 migration、不修改共享 env，也没有调用真实微信登录、患者同步、预约 Provider、
报告、门诊费用、支付、医保、退款或 HIS 写入。

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `ca5a372a3831d5738d59538556238e64328f6ee1` |
| 新 API release | `/home/ps/code/hospital-platform/releases/ca5a372` |
| 切换指针 | `current: bab0ce2 -> ca5a372` |
| 新 API | `hospital-platform-api-v2.service`，`10.0.0.3:18081`，PID `2038805` |
| 旧 API | Python，PID `636918`，继续监听 `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 临时候选 | `127.0.0.1:18082`，验收后已停止并释放 |

## 2. 本地代码门禁

提交前 `pnpm check` 通过：架构审计、迁移审计、Provider intake 审计、Biome format/lint、9 个
workspace 的 typecheck/test/build 均通过；API 测试为 74 条通过，新增测试覆盖受保护路由在缺少
业务查询参数时仍先返回认证错误。

本次实现的关键约束：

- 使用模块级 `onTransform({ as: "local" })`，只作用于当前受保护模块，不影响 health、system ping、
  OpenAPI、未知路由和公开登录/回调入口；
- 使用 `WeakMap<Request, SessionPrincipal>` 复用同一请求已完成的会话解析，避免 handler 再次查询 Redis；
- 会话缺失、过期或解析失败时 fail-closed，不创建伪造 principal，也不把错误降级为空业务结果；
- 认证顺序的行为和公开入口已同步到 API 文档、迁移台账和测试。

## 3. bundle 指纹与生产 preflight

候选上传后，在服务器 release 目录重新计算 SHA-256，与本地产物一致：

| bundle | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `4738e3c9ba531f43412930bb320ef471857a0ff6a3fc4e307262b69f611e4136` |
| `apps/worker/dist/index.js` | `927685c2c9e96c13fd65447038038549adc08511ce8d3e7ed856b7f3f7710bfb` |
| `apps/worker/dist/preflight.js` | `f265f3522fb417d7349c402c6b71f626077ebeb96e5175d8262d00701dbbef0f` |
| `apps/worker/dist/provider-directory-smoke.js` | `dd22c5d402ba63eccc7f6962e2e89cc17736eea35f84da107d586d6bcf21eb00` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

使用服务器既有 `shared/api.env` 执行 `preflight.js`，结果为 `runtime.preflight.succeeded`：

- MySQL、Redis 和 schema 均通过；schema 为 `verified`，目标 migration 为
  `0015_patient_directory_sync_operations`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用配置为 `configured`；
- 微信支付、报告目录和报告详情保持 `disabled`；
- preflight 只读取配置和依赖，不启动 Worker、不执行 migration、不访问患者或 Provider 业务。

## 4. 候选临时端口验收

候选使用生产 env，只覆盖 `HOST=127.0.0.1`、`PORT=18082` 和 `NODE_ENV=production`，没有复制、
打印或修改共享 env。候选启动日志包含 `runtimeMode=production`、数据库/Redis/schema probe 为 `ok`、
`authRuntimeStatus=ready` 和各项 capability gate 状态。

使用 release 内的 `api-runtime-smoke.js`，`/api/v1` 内网前缀结果如下：

| 检查 | 结果 |
| --- | --- |
| `health-live` | 200 |
| `health-ready` | 200，连续 3/3 ready |
| `system-ping` | 200 |
| `auth-boundary` | 通过，所有受保护路径 401，错误码 `unauthorized` |

候选进程收到 SIGTERM 后正常停止，`18082` 已确认释放；此时 `current` 仍为 `bab0ce2`，旧 Python
`8001` 未受影响。

## 5. 原子切换与公网验收

候选停止后，在同一父目录创建 `current.next` 并使用同目录原子 `mv -Tf` 切换，再只重启
`hospital-platform-api-v2.service`。切换结果：

- `current -> releases/ca5a372`；
- 新 API service active，PID `2038805`；
- 启动日志明确为 `environment=production`、`runtimeMode=production`，MySQL/Redis/schema 均为 `ok`，
  `authRuntimeStatus=ready`；
- 旧 Python PID `636918` 仍存在，`8001` 仍监听；
- Worker 仍 inactive，没有修改旧服务、旧表或旧 Redis DB1。

从开发机通过 `https://test-hp.meiyi.pro/api/v2` 执行生产 runtime smoke，结果为：

| 检查 | 结果 | trace/request 证据 |
| --- | --- | --- |
| `health-live` | 200 | `757ab1ef-9cb9-4429-a13c-55211f183b95` |
| `health-ready` | 200，连续 6/6 ready | `61b52fdf`、`23f24999`、`0afb03b3`、`52d9de33`、`e95a8cf6`、`34beebcc` |
| `system-ping` | 200 | `d1b09e8b-2f55-48ea-9640-60a1ddf3366e` |
| `auth-boundary` | 通过，401/`unauthorized` | `501f9a74-ca58-49c9-b93e-d4e5517eef1b` |

额外直接验证了本次线上回归场景：不携带会话，并故意省略部分业务查询参数，四条受保护路由均
返回相同的 401 中文安全响应，而不是 schema validation 400：

| 请求 | HTTP | `x-request-id` |
| --- | ---: | --- |
| `GET /api/v2/appointments/records` | 401 | `91b5be81-9ce8-4274-aa0f-55de16800bbb` |
| `GET /api/v2/payments/outpatient/records?status=unpaid` | 401 | `635ea6d7-d89d-4f7a-a713-898844236783` |
| `GET /api/v2/reports` | 401 | `1abd3ec5-5fda-428f-9c66-667b2fdb9c15` |
| `GET /api/v2/me/profile` | 401 | `d2783fcc-ed03-4b0f-9523-e55560270132` |

四条响应的错误码均为 `unauthorized`，服务端 journald 已按新 API PID 记录相同 requestId、路径、
状态码和 `errorCode=unauthorized`。日志中没有记录 Bearer token、openid、身份证、请求体或 Provider
原始报文。

## 6. 结论与未宣称范围

本次证明 `ca5a372` 的认证生命周期顺序已经进入公网，并且受保护接口的错误边界、日志关联、新旧
服务共存和生产运行前置均通过。此前线上“未登录 + 缺少参数”返回 400 的问题已修复。

本次仍不能宣称：

- 微信真机登录、Redis 实际 TTL、会话过期和 `/me` 恢复；
- 第二位就诊人、多患者切换、inactive/recovery 和患者同步 replay；
- 预约历史、报告、门诊费用的真实 Provider 业务结果；
- 预约写入、支付、医保授权/结算、退款、HIS 回写或 Worker 已启用；
- 病历、二维码/公众号关注、动态医院、便民服务和其他未冻结 contract 的迁移已完成。

后续如发生新 API readiness、公网路径或旧 `8001` 异常，按
[`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 将 `current` 原子回滚到
`bab0ce2`，只重启新 API unit，不停止旧 Python 服务。
