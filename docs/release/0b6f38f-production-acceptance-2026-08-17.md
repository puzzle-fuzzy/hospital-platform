# `0b6f38f` 生产切换与只读运行验收（2026-08-17）

## 结论

候选 `0b6f38f6e50e8c9d47422c9f0ffc44dc9ecbc185` 已完成本地构建、服务器真实生产 env
preflight、独立 `18082` smoke，并于 2026-08-17 16:40 CST 左右原子切换为当前线上 release。
本次只重启 `hospital-platform-api-v2.service`；旧 Python `8001` 保持监听，未停止或重启，Worker
仍保持 inactive。

本次代码进一步固定门诊费用 Provider 的 `authSysCode`：渠道码只能在 adapter 构造时注入，不能由
单次患者查询参数覆盖；支付、医保、退款、HIS 回写、预约写入和报告 gate 均未开放。

## 1. 本地与候选门禁

- 仓库候选：`0b6f38f6e50e8c9d47422c9f0ffc44dc9ecbc185`。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、格式、Lint、架构、Provider 和文档审计通过。
- `pnpm migration:audit` 仍被外部旧仓库的医保接口台账漂移阻塞；该阻塞未被修改或掩盖，具体见当前迁移检查点。
- 服务器 preflight 通过：`environment=production`、MySQL/Redis 为 `ok`、schema 为 `verified`，目标
  `0016_patient_directory_sync_owner_index`。
- 生产配置 gate：微信身份、患者目录、预约目录、预约历史和门诊费用为 `configured`；微信支付、报告目录、
  报告详情保持 `disabled`。

## 2. 五个 bundle provenance

服务器上传内容与本地产物 SHA-256 一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `732a3ac7cab04486b4008a948fc148badf6261852d63d0b98f1fe81aa01e3ac2` |
| `apps/worker/dist/index.js` | `ff4fcdbb1d1b4c2247893eba1b77043b29b342ef922228d772672592297c7c04` |
| `apps/worker/dist/preflight.js` | `f336c5b88606c11a9946e574b3d16555f60094ae523c95131ec6a2a1f006689a` |
| `apps/worker/dist/provider-directory-smoke.js` | `635bc31b1732a52bd6399c5b19d1256679004505d6ef9d60d7b319b7e6255d90` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

## 3. 隔离 smoke

候选在 `127.0.0.1:18082` 以 production 模式启动，未接收公网流量：

- `/health/live`：200；
- `/health/ready`：连续 3/3 为 200，MySQL/Redis/schema 均为 `ok`；
- `/api/v1/system/ping`：200；
- 未登录受保护路由：401 / `unauthorized`；
- smoke 完成后候选进程收到 SIGTERM，`18082` 已释放。

## 4. 原子切换后结果

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/0b6f38f6e50e8c9d47422c9f0ffc44dc9ecbc185` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001` 仍监听 |
| 内网 live/ready | 200；database/redis/schema 均为 `ok` |
| 公网 `/api/v2/health/ready` | 200，依赖均为 `ok` |
| 公网 runtime smoke | live 200、ready 连续 6/6、system ping 200、认证边界 401 |
| `18082` | 已释放 |

启动日志明确打印 `environment=production`、`runtimeMode=production`、`persistenceRepositories=enabled`
以及微信支付/报告 gate 的关闭状态。

## 5. 业务证据边界

本次发布和 smoke 没有调用微信登录、患者同步、预约历史或门诊费用 Provider。runtime smoke 的 401
只证明认证边界，不能证明 Provider 业务联通；下一步仍需用有效微信会话完成患者目录、多患者切换、普通资料、
预约历史和门诊费用的真机/公网/日志三层验收。

如果出现 `external service rejected the request`，必须按 `traceId` 查统一 HTTP 失败日志，再用低敏
`providerRequestId`、状态码和可重试性对照 Provider；不能把异常降级为空列表或增加未经确认的 fallback。

## 6. 回滚边界

若新 API readiness、公网路径或业务错误出现无法解释的异常，只回滚新 API 的 `current` 到前一 release
并重启 `hospital-platform-api-v2.service`；不得停止旧 Python、清空 Redis、删除旧 release 或执行未经审批的
数据库写入。支付、医保、退款和 HIS 回写继续最后处理。
