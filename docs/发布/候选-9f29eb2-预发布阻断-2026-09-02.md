# 服务端候选 `9f29eb2` 生产预检记录（2026-09-02）

> 本记录只记录本次候选的真实生产预检和隔离运行证据。候选没有切换到线上 `current`，没有重启任何服务，没有执行数据库 migration，也没有调用支付、医保、HIS 或业务 Provider。

## 1. 候选与线上边界

| 项目 | 结果 |
| --- | --- |
| 本地候选 commit | `9f29eb2fec5be569e5a6efe9f0e6908b59015863` |
| 上传目录 | `/home/ps/code/hospital-platform/releases/9f29eb2fec5be569e5a6efe9f0e6908b59015863` |
| 切换前线上 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |
| 新 API | `hospital-platform-api-v2.service`，继续监听 `10.0.0.3:18081` |
| 旧 Python | 继续监听 `0.0.0.0:8001`，未修改、未停止、未重启 |
| Worker | `hospital-platform-worker.service=inactive`，未启动 |

## 2. 本地候选门禁

- `pnpm check:candidate`：通过。
- 工具测试：`124 pass / 0 fail / 802 expect()`。
- 9 个 workspace 的 typecheck、test、build：全部通过。
- API 和 preflight、runtime smoke、日志聚合、业务证据、Redis TTL 审计 bundle 均已生成。
- 小程序 live 运行包来源保持 `ce1c2179b57fe2783066b51f8621220224982928`；本次没有上传或切换微信线上版本。

## 3. 服务器上传与 checksum

候选 bundle 已上传到独立 release 目录。服务器重新计算的 SHA-256 与本地构建产物一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `5452f43d32bc43d5bfba56105cba62d7f6880a58cc2aa72c2ebc19f4326674d8` |
| `apps/worker/dist/index.js` | `41c91f9c5f30ece7f1b05c8eaf82c48b3071bd3144e0fc4c7b660223aad41f69` |
| `apps/worker/dist/preflight.js` | `f666e2972adca0e4781f966a2fc7ede7c09aa61f790d8b5c9ad90632e89d8d3c` |
| `apps/worker/dist/provider-directory-smoke.js` | `30cb94030228be5c240fbd4340dfae93b99b889eaefd6dbe66f0790934e61347` |
| `apps/worker/dist/api-runtime-smoke.js` | `9346656e4eb6ec8f5fbfd56b9f8d5ee2e8b9b3cf019912a15a98975023723e31` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `97d751023657da1c464c90be53dc1e3deed22a236ca0a1104955aeffbfe3a360` |

## 4. 生产 env preflight 结果

使用服务器现有 `shared/api.env`，没有回显连接串或凭据：

| 检查 | 结果 |
| --- | --- |
| environment | `production` |
| runtime configuration | passed |
| Provider configuration | identity、患者目录、预约目录、预约历史、门诊费用为 `configured`；支付和报告保持关闭 |
| MySQL | `ok` |
| Redis | `ok` |
| schema | failed：`0017_outbox_manual_review_state` 未登记 |

因此 preflight 退出码为 `1`。这不是网络或 Provider 错误，而是候选代码要求的目标 schema 尚未在生产库完成。

## 5. 隔离 runtime smoke

候选仅在 `127.0.0.1:18082` 临时启动，使用生产配置但没有接入线上 `current`：

- 启动日志明确 `environment=production`、`runtimeMode=production`、`port=18082`。
- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`。
- `persistenceSchemaProbe=unavailable`，`persistenceRepositories=fail_closed`。
- `/health/live` 返回 `status=ok`。
- `/health/ready` 返回 `status=not_ready`，依赖为 `database=ok`、`redis=ok`、`schema=unavailable`。
- 临时进程已正常退出并释放 `18082`；随后复核 `18081`、`8001` 仍监听，API 仍 `active`，Worker 仍 `inactive`，`current` 未改变。

## 6. 结论与下一步

本候选目前不能切换。需要 DBA/运维在受控备份和恢复窗口内审阅并执行 `0017_outbox_manual_review_state`，逐项核对 DDL、数据回填、索引和 post-condition；之后重新执行生产 preflight、隔离 smoke，确认 `PERSISTENCE_SCHEMA_READY` 与真实 schema 一致，才可以按 [`api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md) 原子切换并只重启新 API。

在此之前：

- 不把 `PERSISTENCE_SCHEMA_READY` 强行改为绕过 schema 的配置。
- 不切换 `current`，不重启新 API，不启动 Worker。
- 不修改旧 Python 服务、旧数据库业务数据或旧 Redis。
- 支付、医保、退款、HIS 回写和真实 Provider 业务继续保持关闭。
