# 预约与门诊费用只读正确性审计（2026-08-21）

> 本文只记录新项目当前代码、测试和契约边界，不代表众阳 Provider、线上当前 release、微信真机或真实费用业务已经验收完成。
> 本轮没有修改旧 Python 服务、旧数据库、旧 Redis，也没有修改另一个会话正在维护的众阳 adapter。

## 1. 审计范围与结论

本轮继续复核“当前会话 → owner-scoped 患者 → `his-patient` 临床映射 → Provider 只读查询 →
服务端公共读模型 → 小程序页面”的预约历史、爽约和门诊费用链路。

已发现并修复一个服务层输入边界缺口：HTTP Elysia schema 会拒绝未知查询字段，但直接调用 service 时，
未知字段可能被解构后静默丢弃。例如调用方传入 `requestChannel=4`，原逻辑会忽略该意图，仍使用预约记录已确认的
微信渠道 `3` 查询。现在 service 层也采用固定字段白名单，未知字段在访问 Provider 前明确失败；不会把一个未开放的
“全部挂号”意图伪装成在线挂号查询成功。

除上述输入边界外，本轮没有发现可以在不猜测 Provider contract 的前提下安全修改的预约或费用业务逻辑。
支付、医保授权、结算、退款、通知和 HIS 写回继续关闭。

## 2. 已确认的不变量

| 业务边界 | 当前正确行为 |
| --- | --- |
| 患者归属 | 客户端只提交平台内部 `patientId`；服务端按当前 owner 解析用途专用 `his-patient`，不接受客户端 Provider 患者号或卡号。 |
| 预约历史窗口 | 使用 `Asia/Shanghai` 当前自然日前后各 90 天，包含过去记录和未来预约。 |
| 爽约窗口 | 只查询过去 90 天，并且只筛选服务端明确归一化的 `status="missed"`。 |
| 预约记录渠道 | 当前只查询已确认的微信在线渠道 `requestChannel=3`；未知状态、重复预约号、非法日期、越界记录和业务失败包络整批拒绝。 |
| 全部挂号 | `requestChannel=4` 仍缺少独立 contract；HTTP 与 service 都不接受它作为公开查询字段，页面保留入口位置但不复用渠道 3 结果。 |
| 门诊费用状态 | 公共读模型只接受 `unpaid/paid`，Provider `tradeStatus` 只接受本次查询对应的 `1/3`；`2/4/5/9` 不猜测为已支付。 |
| 门诊费用窗口 | 使用 `Asia/Shanghai` 最近 30 个自然日；账单时间和金额通过严格运行时校验，不能用浮点或 `toFixed` 修正金额。 |
| 页面并发 | 患者切换、刷新、标签变化或页面卸载后，旧请求不能回写新页面；旧列表和患者卡片在新查询开始时按状态机清理。 |
| 大结果集 | 服务端返回完整、已验证的只读结果；小程序首批渲染 10 条，“加载更多”只展开已取得数据，不冒充 Provider 分页。 |
| 副作用 | 当前两个领域只有只读 Provider 查询，不创建预约、订单或支付状态，不执行医保授权、结算、退款或 HIS 写回。 |

## 3. 本轮代码处理

### 3.1 service 层拒绝未知字段

`apps/api/src/modules/appointments/service.ts` 新增预约排班和预约记录查询字段白名单：

- 排班只允许 `startDate`、`endDate`、`departmentId`、`doctorId`；
- 预约记录只允许 `startDate`、`endDate`；
- 日期、标识和窗口校验完成后，未知字段仍会在 Provider 调用前被拒绝；
- 错误日志不记录未知字段原文，避免把外部参数扩散到日志。

`apps/api/src/modules/appointments/service.test.ts` 新增回归测试，明确验证带有 `requestChannel=4` 的直接 service 调用
会返回对应查询错误，且 Provider 调用次数保持为零。

这与 HTTP 层的 TypeBox `additionalProperties=false` 是两层边界：HTTP 防止网络请求进入，service 防止组合根、回放任务
或未来 Worker 绕过 HTTP 后改变已确认的业务语义。

## 4. 本地验证证据

以下命令均在 `E:\__Super_Core__\hospital-platform` 执行：

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/api test src/modules/appointments/service.test.ts` | 24 pass，94 个断言 |
| `pnpm --filter @hospital/api test src/modules/outpatient-payments/service.test.ts` | 14 pass，51 个断言 |
| `pnpm --filter @hospital/adapters test src/zhongyang-appointments.test.ts src/zhongyang-outpatient-payments.test.ts` | 32 pass，71 个断言 |
| `pnpm --filter @hospital/domain test src/appointments.test.ts src/outpatient-payments.test.ts` | 5 pass，7 个断言 |
| `pnpm --filter @hospital/miniprogram test src/services/appointment-record-view.test.ts src/services/dashboard-service.test.ts` | 174 pass，1378 个断言 |
| `pnpm --filter @hospital/api typecheck` | 通过 |
| `pnpm exec biome check apps/api/src/modules/appointments/service.ts apps/api/src/modules/appointments/service.test.ts` | 通过 |

小程序测试命令包含既有全量 acceptance/runtime provenance 门禁；本次 API service 修正不改变小程序运行包来源，
也不把测试脚本编译进 `dist/`。

## 5. 尚缺证据与停止条件

当前仍不能把预约或门诊费用标记为真实完成，缺少：

1. 当前服务端 release 与当前小程序候选的真实微信登录、患者确认和页面三层同链证据；
2. 当前 release 下预约 Provider 的非空、空结果、业务拒绝和超时样例，以及 `traceId/requestId` 低敏关联日志；
3. 真机“我的挂号/爽约”和门诊费用页面的患者切换、刷新、列表展开结果；
4. `requestChannel=4` 全部挂号的正式字段、状态、排序、分页和失败 contract；
5. 门诊支付、医保授权、6202/6301 结算、支付通知、退款和 HIS 写回的独立 contract 与幂等验收。

在上述证据到齐前，不应通过兼容字段、空列表降级、渠道复用或支付模拟来“完成”业务。若 Provider 返回字段与当前
adapter 不一致，应先停在 contract 审计，不直接改成宽松解析。

## 6. 变更隔离

- 未修改旧 Python 项目、旧服务端口 `8001`、旧数据库或旧 Redis。
- 未修改 `packages/adapters/src/zhongyang-appointments.ts`、`packages/adapters/src/zhongyang-outpatient-payments.ts`。
- 未修改并行会话的 `apps/miniprogram/project.config.json` 和 `.codegraph/`。
- 本轮只调整预约 service 的 fail-closed 输入边界、对应测试、审计文档和路线图。
