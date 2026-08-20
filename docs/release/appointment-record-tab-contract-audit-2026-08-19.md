# “我的挂号”双标签契约审计（2026-08-19）

## 审计范围

本次只核对原生小程序“我的挂号”页面的“在线挂号/全部挂号”两个标签、服务端当前
预约历史渠道和客户端筛选边界。当前审计基准为服务端 `0e360d3` 与配套小程序候选
`6e6604f`（来源 `6e6604f8089e45ceeaaf4bcbbd57065174a59a31`）；本记录只描述只读合同边界，
不代表已经取得新的 Provider、真机或生产业务请求证据。

## 已确认的业务事实

1. 当前服务端预约历史只使用已经冻结的微信在线查询渠道 `requestChannel=3`。
2. 公共预约记录读模型不携带 `requestChannel` 或 Provider 患者标识；小程序不能从
   状态、数组顺序或空结果推导“全部渠道”。
3. “在线挂号”只排除服务端明确归一化为 `cancelled` 的记录；`scheduled`、`completed`、
   `missed`、`stopped`、`substituted`、`registered` 和已确认枚举 `unknown` 保持各自状态。
   展示边界还会拒绝绕过响应校验的未知字符串，不能因为它“不等于 cancelled”就进入列表。
4. “全部挂号”需要独立的 `requestChannel=4` Provider 合同、患者映射、日期窗口、失败/超时
   语义和验收证据。它不是把在线结果放宽筛选后的页面视图。

## 当前实现边界

- 页面继续保留旧端双标签的视觉结构。
- 点击“在线挂号”只展示当前已经取得的在线只读结果。
- 点击“全部挂号”不会修改活动标签、不会重新请求 Provider、不会把在线记录复制到全部列表，
  只提示“全部挂号查询正在迁移中”。
- `filterAppointmentRecords(records, "all")` 的防御性结果为空，但页面在进入该分支前会
  拦截标签；这不是“全部为空”的业务成功响应。
- 当前没有预约详情、取消、预问诊、锁号、预约写入或挂号费支付能力；这些能力必须另立
  contract，不能从只读摘要或标签行为推导。

## 代码与测试证据

- `apps/miniprogram/src/services/appointment-record-view.ts`：统一维护在线筛选和全部标签
  可用性，禁止本地拼接全部渠道。
- `apps/miniprogram/src/pages/appointment-records/appointment-records.ts`：标签点击前检查
  `isAppointmentRecordTabAvailable`，未开放标签不会触发请求。
- `apps/miniprogram/src/services/appointment-record-view.test.ts`：覆盖在线标签只排除取消记录，
  已确认 `unknown` 的展示语义、绕过校验的未知状态 fail-closed，以及全部标签在独立 contract
  到齐前不可用。
- `apps/miniprogram/scripts/acceptance.test.ts`：覆盖页面保留双标签、客户端不携带
  `requestChannel` 和未开放提示边界。

## 开放前置条件

只有同时取得以下材料，才可以重新评估“全部挂号”实现：

- `requestChannel=4` 的正式 Provider 文档和脱敏成功/空结果/失败/超时样例；
- 与在线渠道不同或相同的患者标识、日期窗口、排序和重复项语义；
- owner-scoped 映射、权限拒绝、重试和超时后的最终状态规则；
- 公网 API、页面结果和低敏 `traceId/requestId` 日志的三层验收记录。

在材料齐全前，保持当前“标签可见、能力不可用”的 fail-closed 行为。
