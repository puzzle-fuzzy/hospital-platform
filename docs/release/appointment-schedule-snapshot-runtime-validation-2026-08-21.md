# 排班只读快照运行时校验审计（2026-08-21）

## 本轮结论

本轮只收紧预约目录“只读结果 → 服务端短期观察快照”的 persistence/domain 边界，
没有开放预约、锁号、取消、挂号费、微信支付、医保结算或 HIS 回写，也没有调用真实 Provider、
修改旧 Python 服务、数据库线上数据或 Redis。

发现的缺口是：`validateAppointmentScheduleSnapshot` 之前只检查引用形状、自然日、号源数量和
`expiresAt > observedAt`。如果未来任务、回放器或错误的组合根直接调用仓储，未知 Provider、
坏的排班展示字段或数小时有效的快照可能先进入 MySQL，再被未来命令误当成近期号源事实。

## 已收紧的不变量

| 边界 | 当前规则 |
| --- | --- |
| Provider 来源 | 只接受已冻结的 `zhongyang`；其它值在 SQL 前返回 `invalid_provider`。 |
| 排班读模型 | 对 `scheduleId`、科室/医生标识和名称、工作日、班次、可选时间、`timeGroup` 做与 adapter/service 一致的运行时校验；异常返回 `invalid_schedule`。 |
| 号源数量 | `totalSlots`、`availableSlots` 必须是非负安全整数，且可用数不能大于总数。 |
| 观察窗口 | `expiresAt` 必须晚于 `observedAt`，且 TTL 不得超过平台硬上限 5 分钟；当前目录 service 实际写入仍为 60 秒。 |
| Provider 引用 | `providerScheduleId`、`providerRequestId` 和平台 `scheduleId` 保持长度、首尾空白和控制字符边界。 |
| 写入范围 | 内存仓储和 MySQL 仓储继续共用同一个 domain validator，坏事实不进入任一实现。 |

5 分钟是平台对“近期观察事实”的资源/安全上限，不是医院预约合同，也不代表已经具备预约写入授权。
未来若 Provider 合同要求更长 TTL，必须重新审计排班新鲜度、锁号前复核、幂等和最终状态，不能只改一个常量。

## 代码与测试证据

- `packages/domain/src/appointments.ts` 新增中文注释、Provider/排班/TTL 运行时门禁和
  `MAX_APPOINTMENT_SNAPSHOT_TTL_MS`；该常量通过 `@hospital/domain` 公共入口导出。
- `packages/domain/src/appointments.test.ts` 覆盖未知 Provider、控制字符排班字段和超长 TTL；
  domain 类型检查通过，domain 测试 `64 pass / 135 expects`。
- 现有 `packages/persistence` 的内存/MySQL repository 仍在 `upsert` 前调用同一 validator；
  本轮没有为测试伪造 SQL 成功，也没有改变实际表结构。

## 未完成与下一步

这项修正只保证“观察到的排班事实不会越过存储边界”，不证明当前 release 的 Provider 非空/空结果/超时
三层证据，也不证明真机级联页面完成。下一步仍应使用匹配当前 release 的小程序运行包取得真实微信会话、
患者显式切换和预约历史/门诊费用只读证据；`requestChannel=4`、预约写入、支付、医保、退款和 HIS
继续等待正式 contract。
