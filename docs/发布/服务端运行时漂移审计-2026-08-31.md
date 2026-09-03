# 服务端线上 release 与仓库运行时代码漂移审计（2026-09-01 复核）

> 本文只记录仓库事实和发布边界，不执行部署、不重启服务，也不修改旧 Python 服务、旧数据库、旧 Redis 或线上配置。

## 1. 结论

当前线上候选仍是服务端 release `5738a71e0bcddaa8849106754baf5b296427bed7`。本次审计取样时可验证的仓库运行时代码基线为
`7668d747c1eb0885bf2dde29f83024fcae6adf99`，在该线上 release 之后包含 Provider 失败阶段和传输错误码观测、支付/outbox
自动重试上限与人工复核状态、`0017` schema migration，以及本轮持久化依赖来源和稳定公共错误码日志修正；这些变更尚未部署到线上，
因此不能把仓库当前源码描述为线上运行事实。

`pnpm release:baseline:audit` 的小程序文档基线仍受其他会话未提交的历史交接单字段阻断；服务端部分另因下列 16 个运行时文件未进入线上
release 而保持失败，这正是预期的 fail-closed 结果：

| 文件 | 变更目的 | 当前关系 |
| --- | --- | --- |
| `apps/api/src/modules/auth/service.ts` | Redis 会话失败来源标注 | 仓库候选有，线上 release 无 |
| `apps/api/src/plugins/request-logging.ts` | 公共依赖错误稳定码和低敏来源投影 | 仓库候选有，线上 release 无 |
| `packages/adapters/src/errors.ts` | Provider 失败阶段类型 | 仓库候选有，线上 release 无 |
| `packages/adapters/src/http.ts` | 区分 HTTP、响应和传输失败 | 仓库候选有，线上 release 无 |
| `packages/domain/src/index.ts` | 导出人工复核领域模型 | 仓库候选有，线上 release 无 |
| `packages/domain/src/manual-review.ts` | 人工复核状态/原因码边界 | 仓库候选有，线上 release 无 |
| `packages/domain/src/payment-order.ts` | 支付预支付人工复核状态和时间 | 仓库候选有，线上 release 无 |
| `packages/domain/src/payment-provider.ts` | 支付查单失败/人工复核边界 | 仓库候选有，线上 release 无 |
| `packages/observability/src/index.ts` | 受限传输错误码和失败阶段日志 | 仓库候选有，线上 release 无 |
| `packages/observability/src/operational-alerts.ts` | 运维告警阈值和低敏聚合 | 仓库候选有，线上 release 无 |
| `packages/persistence/src/errors.ts` | MySQL/Redis 依赖来源的运行时枚举 | 仓库候选有，线上 release 无 |
| `packages/persistence/src/migrate.ts` | 纳入 `0017_outbox_manual_review_state` schema | 仓库候选有，线上 release 无 |
| `packages/persistence/src/mysql-repositories.ts` | MySQL 来源和 outbox/支付人工复核状态 | 仓库候选有，线上 release 无 |
| `packages/persistence/src/outbox.ts` | 持久化 outbox 人工复核状态 | 仓库候选有，线上 release 无 |
| `packages/persistence/src/redis-session.ts` | Redis 来源和会话失败分类 | 仓库候选有，线上 release 无 |
| `packages/persistence/src/repositories.ts` | 人工复核状态更新仓储操作 | 仓库候选有，线上 release 无 |

## 2. 核验依据

在仓库根目录执行：

```text
git diff --name-status 5738a71e0bcddaa8849106754baf5b296427bed7 -- apps/api packages
pnpm release:baseline:audit
```

核验结果为 16 个运行时文件存在 release 之后的源码差异；审计器同时报告：

```text
服务端 release 5738a71e0bcddaa8849106754baf5b296427bed7 之后存在未部署运行时代码：apps/api/src/modules/auth/service.ts, apps/api/src/plugins/request-logging.ts, packages/adapters/src/errors.ts, packages/adapters/src/http.ts, packages/domain/src/index.ts, packages/domain/src/manual-review.ts, packages/domain/src/payment-order.ts, packages/domain/src/payment-provider.ts, packages/observability/src/index.ts, packages/observability/src/operational-alerts.ts, packages/persistence/src/errors.ts, packages/persistence/src/migrate.ts, packages/persistence/src/mysql-repositories.ts, packages/persistence/src/outbox.ts, packages/persistence/src/redis-session.ts, packages/persistence/src/repositories.ts
```

这些改动包含低敏故障定位字段和后台人工接管状态，不应通过修改审计器、只发布其中一部分、跳过 `0017` migration 或把源码提交号写成线上版本来绕过门禁。

## 3. 当前发布边界

- 线上服务端运行事实仍以 `5738a71e0bcddaa8849106754baf5b296427bed7` 为准；2026-09-01 SSH 只读检查确认该 release 仍为
  `current`，API 为 `active`，Worker 为 `inactive`，旧 Python `8001` 仍监听，ready 的 MySQL/Redis/schema 均为 `ok`。
- 仓库中的 16 个文件属于下一次服务端候选，当前不可作为线上日志字段、人工复核状态、`0017` schema 或最新依赖错误码已存在的证据。
- 后续若要发布，必须在单一受控窗口中完成全仓类型检查、测试、API/Worker 构建、配置 preflight、候选切换、重启后 runtime smoke 和公网/内网共存核验，并确认旧 Python `8001` 未受影响。
- 在上述窗口完成前，不能宣称线上已经能够输出 `providerFailureStage` 或 `providerTransportErrorCode`。

## 4. 后续准入条件

1. 由明确的发布窗口负责人确认是否需要这 16 个运行时代码文件及 `0017` migration 进入线上。
2. 若需要，使用完整服务端候选发布，不拆分 `adapters`、`domain`、`observability` 与 `persistence` 的关联变更。
3. 发布前保存候选 commit、配置指纹和回滚点；发布后只验证健康、ready、错误投影和旧端口共存，不调用支付、医保或未知 Provider 业务。
4. 发布证据通过后，再把本文件和 `TODO.md` 的“未部署运行时代码”描述更新为已部署事实；否则保持当前阻断状态。
