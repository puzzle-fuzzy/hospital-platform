# 服务端候选 `0aa9aa7d` 发布前记录（2026-09-01）

> 本文只记录当前 `main` 的本地服务端候选和发布前门禁，不代表已经上传、切换或重启线上服务。旧 Python 服务、旧数据库、旧 Redis 和线上进程不在本次本地构建动作范围内。

## 1. 候选来源与线上事实

| 项目 | 值 |
| --- | --- |
| 本地候选 commit | `0aa9aa7dc016d55a9e656c512157169aed1db801` |
| 当前线上服务端 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |
| 新 API systemd unit | `hospital-platform-api-v2.service` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 仓库 schema head | `0017_outbox_manual_review_state` |
| 线上 schema head | `0016_patient_directory_sync_owner_index` |
| 小程序 live source revision | `ce1c2179b57fe2783066b51f8621220224982928` |

2026-09-01 通过 SSH 只读检查确认：线上 `current` 仍指向 `5738a71e...`，API 为 `active`，Worker 为 `inactive`，`18081` 与旧端口
`8001` 同时监听；`/health/ready` 返回 database、Redis 和 schema 均为 `ok`。本记录没有修改服务器。

同一只读窗口确认 `ps` 账号的 sudo 规则只允许新 API unit 的 `restart`、`is-active` 和 `status` 三个固定命令，
没有旧 Python unit、Worker 或通配符权限；`shared/api.env` 权限为 `600`。这说明受控重启通道当前可用，
但不替代发布负责人、备份恢复证据和 `0017` schema 变更批准，也没有在本次检查中执行这些命令。

## 2. 本地构建产物指纹

以下文件来自当前仓库构建目录，上传前必须在服务器新的 `releases/<完整 commit>/` 目录重新计算 SHA-256 并逐项比对：

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

小程序构建信息仍为 38 个页面、source revision `ce1c2179b57fe2783066b51f8621220224982928`；本候选没有改变小程序运行包来源。

## 3. 发布前结果与阻断

- `pnpm check:candidate`：架构、迁移边界、契约、日志、错误码、文档、类型检查、测试和构建通过。
- `pnpm docs:audit`：879 个 Markdown 文档，无断链。
- `pnpm release:baseline:index:audit`：当前基线索引结构通过。
- `pnpm release:baseline:audit`：按设计 fail-closed。线上 release 后仍有 16 个未部署运行时文件，详见
  [`server-runtime-drift-audit-2026-08-31.md`](server-runtime-drift-audit-2026-08-31.md)；另外当前工作区存在其他会话未提交的交接文档变更，不能用清理或覆盖方式绕过。

因此，本候选当前只能作为待发布 bundle，不能作为线上日志、人工复核状态、`0017` schema 或 Provider 业务证据。

## 4. 受控发布前置条件

1. 发布负责人确认窗口、回滚点和旧 Python `8001` 共存不变量。
2. DBA/运维确认备份、恢复点和 `0017` schema 变更窗口；不得跳过 schema gate 或在未知状态下重试。
3. 将完整构建 bundle 上传到新的 release 目录，复核 SHA-256，不覆盖旧 release、`current` 或 `shared` 环境文件。
4. 使用服务器现有生产环境执行候选 preflight 和隔离端口 smoke；支付、医保、退款、HIS 和 Worker 保持关闭。
5. 只有候选、schema、配置、回滚和 smoke 全部通过后，才允许原子切换 `current`，并且只重启新 API unit；切换后重新确认新 API readiness 和旧 `8001`。

具体命令和停止条件遵循 [`infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)。
