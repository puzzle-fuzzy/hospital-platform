# `c01b1af` 服务端候选记录（2026-08-22）

> 本候选只修正预约排班快照日志的链路关联，不改变 Provider 请求、数据库 schema、业务响应、预约写入、支付或医保边界。
> 线上当前仍为 `49f74e0`；旧 Python 服务保持不动。

## 1. 发现

当前线上预约目录只读请求已成功，但 P0 聚合出现一条没有 `traceId/requestId` 的记录。源码定位到
`appointment.schedule_snapshots.persisted/failed`：它原来只投影 Provider 请求号，没有继承所属 HTTP 请求的 `traceId`。
这样会把排班目录与快照观察拆成两条无法关联的日志，降低后期排障准确性。

## 2. 修正

`AppointmentService.persistScheduleSnapshots` 现在显式接收并写入所属请求的 `traceId`，成功和失败两条事件保持相同链路。
中文注释说明了两类事实的区别：Provider 目录成功不代表快照成功，快照失败也不能丢失原始请求关联。

## 3. 本地验证

- `pnpm --filter @hospital/api exec bun test src/modules/appointments/service.test.ts`：`25 pass / 0 fail`；
- `pnpm --filter @hospital/api test`：`206 pass / 0 fail / 850 expect()`；
- `pnpm exec biome check apps/api/src/modules/appointments/service.ts apps/api/src/modules/appointments/service.test.ts`：通过；
- `pnpm --filter @hospital/api typecheck`：通过。

新增回归覆盖：排班快照成功事件带所属 `traceId`；快照写入失败事件仍带所属 `traceId`。

## 4. 发布边界

本候选尚未上传或切换服务器。真正部署时只能创建新的 release，执行真实 production env preflight、独立端口 smoke、
原子切换 `current`，然后只重启 `hospital-platform-api-v2.service`；旧 Python `8001`、Worker、数据库 schema、Redis
和公网旧转发不得修改。切换后重新触发预约目录只读请求，要求 P0 聚合 `parseErrors=0`、`systemdWarningCount=0`、
`correlation.missingCount=0`，并核对目录/排班成功事件与同一 HTTP 2xx 链路。
