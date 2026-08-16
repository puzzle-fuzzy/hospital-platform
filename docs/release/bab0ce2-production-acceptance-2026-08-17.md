# `bab0ce2` 生产发布与持久化探针日志增强验收

## 1. 发布边界

本次发布只更新新 Bun/Elysia API 及其 worker bundle，目标是让 MySQL、Redis、schema 只读探针在
状态转换时记录安全的 `attempts` 与 `durationMs`，并让恢复事件携带最新一轮 schema 诊断字段。
不改变探针重试次数、readiness fail-closed 语义和任何业务写入逻辑。

本次不修改旧 Python 服务、不重启旧端口 `8001`、不启动 worker、不执行 migration、不修改共享 env，
也没有调用微信登录、患者同步、预约、支付、医保、退款或 HIS 写入。

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `bab0ce2d1e20b61ed20c33c90bca4c5a2b047112` |
| 新 API release | `/home/ps/code/hospital-platform/releases/bab0ce2` |
| 切换指针 | `/home/ps/code/hospital-platform/current -> releases/bab0ce2` |
| 新 API | `hospital-platform-api-v2.service`，监听 `10.0.0.3:18081` |
| 旧 API | Python，PID `636918`，继续监听 `0.0.0.0:8001` |
| worker | `hospital-platform-worker-v2.service=inactive` |
| 临时候选 | `127.0.0.1:18082` 已停止，无残留监听 |

## 2. 本地门禁

提交前通过：

- `architecture:audit`、`migration:audit`、`provider:audit`；
- Biome format、lint；
- 9 个 workspace 的 typecheck、test 和 build；
- persistence runtime 单测 64 条通过，其中新增恢复日志安全字段测试通过。

测试明确验证：恢复日志保留 `attempts`、`durationMs`、schema 状态和缺失数量，同时不带入原始错误
内容；探针字段不代表业务操作已经被重放。

## 3. bundle 一致性

本地构建产物上传后，在服务器 release 目录重新计算 SHA-256，结果一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `d71ac03e392a05fc48ef585465d721d3ee88759df8e544b832fa726f6175afaf` |
| `apps/worker/dist/index.js` | `927685c2c9e96c13fd65447038038549adc08511ce8d3e7ed856b7f3f7710bfb` |
| `apps/worker/dist/preflight.js` | `f265f3522fb417d7349c402c6b71f626077ebeb96e5175d8262d00701dbbef0f` |
| `apps/worker/dist/provider-directory-smoke.js` | `dd22c5d402ba63eccc7f6962e2e89cc17736eea35f84da107d586d6bcf21eb00` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

## 4. 候选生产 env smoke

候选使用服务器已有 `shared/api.env`，只覆盖临时端口和本机 host，没有复制、打印或修改 env。
preflight 结果：runtime configuration、微信身份、患者目录、预约目录、预约记录、门诊费用、MySQL、
Redis 和 schema 均通过；微信支付、报告目录和报告详情仍为 disabled；schema 为
`schemaStatus=verified`、`expected=0015_patient_directory_sync_operations`。

候选 `127.0.0.1:18082` 启动日志确认：

- `runtimeMode=production`；
- database、Redis、schema probe 均为 `ok`；
- repositories、微信身份和 Redis session store 均为 injected/ready；
- 启动后执行 live、ready、system ping 和未登录认证边界，全部通过；
- ready 连续采样 `3/3`，候选结束后已停止。

## 5. 原子切换与公网 smoke

候选停止且 `18082` 释放后，执行同一父目录内的 `current.next -> current` 原子替换，只重启
`hospital-platform-api-v2.service`。切换后服务 active，PID 为 `1903747`，启动日志仍为 production mode，
database/Redis/schema 均为 `ok`。旧 Python `8001` 全程未重启，PID 未变化。

通过真实公网地址执行：

```text
NODE_ENV=production
HOSPITAL_API_BASE_URL=https://test-hp.meiyi.pro
HOSPITAL_API_PREFIX=/api/v2
HOSPITAL_RUNTIME_REQUIRE_READY=true
HOSPITAL_RUNTIME_READINESS_SAMPLES=6
HOSPITAL_RUNTIME_READINESS_INTERVAL_MS=1000
```

结果：

| 检查 | 结果 |
| --- | --- |
| `health-live` | HTTP 200 |
| `health-ready` | HTTP 200，连续 6/6 ready |
| `system-ping` | HTTP 200 |
| `auth-boundary` | HTTP 401，稳定 `unauthorized` |

公网 readiness traceId：

```text
d2d8a8e9-2c83-4d82-8d32-4eadbc69a1e2
925284a8-c70e-4f5d-a2fa-e23ec610770f
93729fd4-db3d-446c-b15b-307e9b3b1b32
fa9cf4b3-c9ba-47f3-924d-c674e5f83e3b
211c46d3-ae73-45c2-972f-3c83054c364e
baed8eca-8dcd-45ed-9291-15903d28d89b
```

服务端 journald 已看到对应 `/health/ready`、`/api/v1/system/ping` 和未登录认证边界请求；未发现
新的业务登录、患者同步或 Provider 业务请求。由于本次 smoke 没有制造依赖状态转换，新增的
`persistence.probe.recovered` 字段仍需在真实依赖恢复事件或受控故障演练中观察，不能用启动日志冒充
恢复事件证据。

## 6. 业务结论

本次只证明 `bab0ce2` 的代码门禁、生产配置、bundle 一致性、候选启动、新 API 原子切换、公网运行边界
和新旧服务共存均通过。它不证明：

- 微信真机登录、Redis session TTL 和过期后的 401；
- 患者同步 replay、第二位就诊人、多患者切换、inactive/recovery；
- 预约历史、门诊费用或报告的真实 Provider 读取；
- 病历、费用详情、患者绑定、二维码/公众号、便民服务等剩余迁移域；
- 任何预约写入、支付、医保、退款或 HIS 回写。

下一步仍按 [`当前迁移执行检查点`](../migration/current-execution-checkpoint-2026-08-17.md) 的 P0 顺序，先做
真实微信会话、患者上下文和只读业务证据，再接收新的 Provider 文档；旧 Python `8001` 继续保留。
