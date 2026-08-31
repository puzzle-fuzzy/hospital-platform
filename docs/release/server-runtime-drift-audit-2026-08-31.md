# 服务端线上 release 与仓库运行时代码漂移审计（2026-08-31）

> 本文只记录仓库事实和发布边界，不执行部署、不重启服务，也不修改旧 Python 服务、旧数据库、旧 Redis 或线上配置。

## 1. 结论

当前线上候选仍是服务端 release `5738a71e0bcddaa8849106754baf5b296427bed7`。仓库 `main` 在该 release 之后新增了 Provider 失败阶段和传输错误码观测逻辑，但这些变更尚未部署到线上，因此不能把仓库当前源码描述为线上运行事实。

`pnpm release:baseline:audit` 的小程序文档基线部分已经通过；它仍因下列 3 个运行时文件未进入线上 release 而保持失败，这正是预期的 fail-closed 结果：

| 文件 | 变更提交 | 变更目的 | 当前关系 |
| --- | --- | --- | --- |
| `packages/adapters/src/errors.ts` | `2a0d98bc`、后续整理 | 增加 Provider 失败阶段类型 | 仓库候选有，线上 release 无 |
| `packages/adapters/src/http.ts` | `2a0d98bc`、后续整理 | 区分 HTTP、响应和传输失败 | 仓库候选有，线上 release 无 |
| `packages/observability/src/index.ts` | `2a0d98bc`、`48061c3d`、`6063d5dd` | 记录受限传输错误码和失败阶段 | 仓库候选有，线上 release 无 |

## 2. 核验依据

在仓库根目录执行：

```text
git diff --name-status 5738a71e0bcddaa8849106754baf5b296427bed7 -- packages/adapters/src/errors.ts packages/adapters/src/http.ts packages/observability/src/index.ts
pnpm release:baseline:audit
```

核验结果为 3 个运行时文件存在 release 之后的源码差异；审计器同时报告：

```text
服务端 release 5738a71e0bcddaa8849106754baf5b296427bed7 之后存在未部署运行时代码：packages/adapters/src/errors.ts, packages/adapters/src/http.ts, packages/observability/src/index.ts
```

这些改动只增加低敏故障定位字段，不应通过修改审计器、只发布其中一部分或把源码提交号写成线上版本来绕过门禁。

## 3. 当前发布边界

- 线上服务端运行事实仍以 `5738a71e0bcddaa8849106754baf5b296427bed7` 为准。
- 仓库中的 3 个文件属于下一次服务端候选，当前不可作为线上日志字段已存在的证据。
- 后续若要发布，必须在单一受控窗口中完成全仓类型检查、测试、API/Worker 构建、配置 preflight、候选切换、重启后 runtime smoke 和公网/内网共存核验，并确认旧 Python `8001` 未受影响。
- 在上述窗口完成前，不能宣称线上已经能够输出 `providerFailureStage` 或 `providerTransportErrorCode`。

## 4. 后续准入条件

1. 由明确的发布窗口负责人确认是否需要这 3 个日志字段进入线上。
2. 若需要，使用完整服务端候选发布，不拆分 `adapters` 与 `observability` 的关联变更。
3. 发布前保存候选 commit、配置指纹和回滚点；发布后只验证健康、ready、错误投影和旧端口共存，不调用支付、医保或未知 Provider 业务。
4. 发布证据通过后，再把本文件和 `TODO.md` 的“未部署运行时代码”描述更新为已部署事实；否则保持当前阻断状态。
