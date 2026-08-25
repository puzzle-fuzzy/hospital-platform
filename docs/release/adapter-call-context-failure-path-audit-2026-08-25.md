# AdapterCallContext 失败路径安全审计（2026-08-25）

## 结论

本轮修正了新服务跨患者、预约、报告和费用模块共用的 `AdapterCallContext` 失败路径：

- 合法上下文的业务语义不变，仍只允许 `traceId`、`idempotencyKey`、`signal` 和 `timeoutMs`；
- 损坏上下文、异常 getter 或异常 proxy 在运行时统一收敛为无效上下文；
- 失败日志投影在读取 `traceId` 时不会再次抛错，因此不会用“日志构造失败”遮蔽原始业务异常；
- 不记录患者号、卡号、Provider 原文、凭证或错误正文。

这属于共享基础设施修正，不会打开任何预约写入、支付、医保、临床或外部入口，也没有修改旧 Python 服务、旧数据库、旧 Redis 或线上进程。

## 为什么要修

`adapterContextTraceId` 被多个 service 的失败日志调用。正常 HTTP 请求会先通过 Elysia schema 和 service 上下文校验，但组合根、任务和测试也能直接调用 service。如果传入带异常 getter 的损坏对象，原实现读取 `traceId` 时仍可能抛出第二个异常，结果是：

1. 原始患者/预约/报告/费用错误已经发生；
2. 失败日志为了读取 trace 再次抛错；
3. 统一错误处理器和日志链看到的是次生错误，无法按原始 trace 排查。

错误日志必须是最后一道兜底，不能假设输入对象一定是普通对象。

## 实现边界

文件：

- `packages/domain/src/ports.ts`
- `packages/domain/src/ports.test.ts`

`normalizeAdapterCallContext` 和 `adapterContextTraceId` 现在使用最小 `try/catch` 包住运行时读取。捕获异常时只返回 `undefined` 或固定字符串 `invalid`，不把异常对象、getter 值或原始对象写入日志。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| `bun test packages/domain/src/ports.test.ts` | 4 pass / 0 fail |
| `pnpm --filter @hospital/domain typecheck` | 通过 |
| `pnpm exec biome format packages/domain/src/ports.ts --write` | 通过 |
| `git diff --check` | 通过 |

新增回归覆盖：

- `traceId` getter 抛错时，失败日志仍得到 `invalid`；
- `timeoutMs` getter 抛错时，上下文校验返回 `undefined`，不会把 getter 异常继续向业务层传播。

## 后续

这项修正完成后继续按广度优先队列推进：先对 A 批次安全只读域做同一运行包的真实链路证据，再并行整理健康内容、临床只读、患者写入和外部入口 contract；支付、医保和 HIS 回写仍保持最后批次。该审计不替代 Provider、公网或真机验收。
