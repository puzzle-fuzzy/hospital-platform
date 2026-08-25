# 患者端日期窗口边界审计

本文冻结当前只读查询的日期校验事实，专门避免“最多 N 个日历日”在客户端、API 和 provider 之间产生不同解释。
它不替代众阳接口文档；provider 的日期端点语义确认后，必须按本文的变更门槛更新 contract、测试和页面。

## 1. 当前服务端事实

`parseIsoCalendarDate` 只接受真实的 `YYYY-MM-DD`，并将日期解析为 UTC 零点时间戳。预约和报告服务当前使用：

```text
跨度 = endDate 的 UTC 零点 - startDate 的 UTC 零点
```

当前上限如下：

| 查询 | 起止日期差值上限 | 超限行为 |
| --- | ---: | --- |
| 预约排班 | 31 天 | 在调用 provider 前返回 `AppointmentScheduleQueryError` |
| 预约历史 | 366 天 | 在解析 owner/provider 映射前返回 `AppointmentRecordQueryError` |
| 报告目录 | 366 天 | 在解析 owner/provider 映射前返回 `ReportQueryError` |

因此，起止日期差值等于上限时请求合法，超过上限时请求非法；`endDate < startDate`、非法日历日期和错误格式均在 provider 调用前拒绝。
这一定义是“跨度上限”，不是把首尾日期都计入后的“日期条目数量上限”。例如，`2026-01-01` 到
`2026-02-01` 的差值是 31 天，当前校验允许该请求。

## 2. 客户端窗口不是 provider 分页

当前小程序为了复用旧端的查询习惯，使用以下平台窗口：

- 预约目录：当前中国标准时间日到当前日加 7 天；
- 预约历史（我的挂号）：当前中国标准时间日前后各 90 天，必须覆盖未来预约；
- 爽约记录：当前中国标准时间日前 90 天到当前日，只用于从预约历史派生 `missed`；
- 报告目录：当前中国标准时间日往前 30 天到当前日；
- 门诊费用：服务端固定最近 30 个中国标准时间日的时间窗口。

这些参数表示平台本次查询意图，不代表 provider 的“返回多少条”、服务端分页或 provider 的最终日期包含规则。
页面的排班/报告分批渲染也只是在本地减少同时渲染的节点，不能被记录为服务端分页。

小程序公共日期函数也把 `Invalid Date`、无穷大、负数和非整数天数视为本地参数错误，统一返回
`date-range-invalid`，不会生成 `NaN-NaN-NaN` 请求。这样可以把“页面/缓存传入的日期损坏”与
“Provider 超时、拒绝或合法空结果”分开记录；预约、爽约、报告和就诊摘要必须继续沿用这一公共边界。

报告目录还有一条独立的响应边界：服务端不会因为请求日期合法就默认 Provider 返回了对应窗口。目录整批归一化后，
每条 `reportedAt` 都必须使用已审计格式解析成功，并落在 `[startDate 00:00:00, endDate 次日 00:00:00)` 的自然日窗口内；
未知格式或窗口外结果统一返回 `provider-response-invalid`，不能排序后保留、过滤坏行或降级为空列表。这样可以阻止
Provider 忽略日期参数、缓存旧快照或聚合错窗口时被误报为成功目录。该校验不代表 Provider 的 `endDate` 包含规则已经冻结，
只是在平台边界上拒绝无法证明归属本次查询的结果。

当前还存在一个需要单独冻结的边界：预约排班 API 仍允许调用方提交合法的 startDate/endDate，服务端校验
跨度但不会把它们替换成当前业务日窗口；原生小程序调用方会自行生成未来 7 天。这样保留了当前 v2 查询 contract，
但不能把“客户端传入了未来日期”误认为服务端已经完成未来号源授权。待 Provider 日期语义和所有调用方范围确认后，
应优先把预约排班窗口收敛为服务端生成或至少增加当前业务日边界，并同步更新 API schema、测试、日志和真机证据；
在此之前不扩大查询范围，也不进入锁号/预约写入。

## 3. provider 文档到达后必须确认

在不改变当前代码行为前，必须取得并登记以下事实：

1. provider 的 `endDate` 是包含当天还是右开区间；
2. provider 所称的最大范围是起止日期差值、首尾包含的日历日数量，还是时间戳跨度；
3. 同一天查询、跨月、跨年和闰年时的实际返回范围；
4. 旧端的 `today + 7`、`today - 90` 和报告整日结束时间是否必须保持兼容；
5. provider 是否分页、分页排序键、快照一致性和重复项处理规则。

未确认前，不能把 `endDate` 改成 `startDate + N - 1`，也不能仅为了让文档看起来像“包含首尾”而放宽或收紧服务端校验。
任何变更都必须同时更新 `docs/provider-contract-v1.md`、[`api-v2-public.md`](../api-v2-public.md)、对应 adapter 测试、
小程序日期窗口测试和公网/真机验收记录。

## 4. 代码和测试位置

- 预约范围校验：`apps/api/src/modules/appointments/service.ts`；
- 报告范围校验：`apps/api/src/modules/reports/service.ts`；
- 日期解析：`packages/domain/src/date-range.ts`；
- 预约边界测试：`apps/api/src/modules/appointments/service.test.ts`；
- 报告边界测试：`apps/api/src/modules/reports/service.test.ts`。

测试必须保持“等于上限可调用 provider、超过上限不调用 provider”的门槛，避免未来修改错误提示或 provider adapter 时悄悄改变查询范围。
