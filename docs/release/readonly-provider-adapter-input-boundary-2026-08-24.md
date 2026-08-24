# 只读 Provider adapter 运行时输入门禁（2026-08-24）

> 状态：已合入本地 `main` 候选，尚未部署到生产。本文只记录代码边界和回归证据，
> 不把本地测试当作 Provider、公网或真机业务验收。

## 1. 为什么补这一层

Elysia 的 HTTP schema 和业务 service 已经校验了门诊费用、报告目录的请求参数，
但 `Gateway` 是可注入的端口，也可能被回放任务、Worker 或未来组合根直接调用。仅依赖
TypeScript 类型会留下两类风险：

- `null`、未知字段或非法时间在属性读取阶段变成普通 `TypeError`，错误不会进入稳定的
  Provider 失败分类；
- 错误调用方可能把 `undefined`、倒序时间或未声明字段发给 Provider，让上游用默认范围
  解释本次查询，页面随后把不确定结果误报成合法空列表或费用/报告事实。

因此 adapter 自身也必须在任何网络请求前把输入投影成唯一的 canonical 形状。

## 2. 当前门禁矩阵

| adapter | 运行时允许的输入 | 触网前拒绝的内容 |
| --- | --- | --- |
| 门诊费用 `listRecords` | `providerPatientId`、`startTime`、`endTime`、`status`；时间为严格 `YYYY-MM-DD HH:mm:ss` 且不倒序 | `null`/数组、未知字段、空或非字符串患者引用、非法日历时间、倒序时间、未知状态 |
| 报告目录 `listReports` | `providerPatientId` + `startDate/endDate`；日期为合法 ISO 自然日且不倒序；`kind` 只能是已确认来源或未提供 | `null`/数组、未知字段、缺失/非法日期、倒序日期、非字符串来源、空或非字符串患者引用、未知来源 |
| LIS 详情 `getLaboratoryDetail` | 只接受 `providerReportId` 字符串 | `null`/数组、未知字段、非字符串或空报告引用 |

门诊费用输入错误和报告目录/详情形状错误使用不可重试的 `ProviderRequestError`，并标记
`responseInvalid=false`；未知门诊状态继续使用领域层的 `InvalidOutpatientPaymentStatusError`，
未知报告来源继续使用 `InvalidReportKindError`。这些错误都不会调用 Provider。

## 3. 中文注释与测试证据

核心实现和原因注释位于：

- `packages/adapters/src/zhongyang-outpatient-payments.ts`；
- `packages/adapters/src/zhongyang-reports.ts`。

本轮定向门禁：

- 门诊费用 adapter：`21 pass / 0 fail / 51 expect()`；
- 报告 adapter：`19 pass / 0 fail / 41 expect()`；
- `@hospital/adapters` TypeScript `typecheck` 通过；
- 四个修改文件 Biome 检查通过；
- 畸形输入测试均断言 Provider 调用次数为 `0`。

## 4. 发布与旧服务边界

本轮没有调用真实 Provider，没有写入 MySQL/Redis，没有重启新 API，也没有修改旧 Python
服务、反向代理或线上 env。生产当前仍以已发布的 `13f597ea` 为准；本地候选必须在后续
新 release 中重新完成 preflight、隔离 smoke、旧 `8001` 共存检查和真机业务证据，不能直接
把本次代码测试写成已部署结果。

支付、医保授权、退款、预约写入、取消和 HIS 回写不属于本次范围，继续保持关闭。

