# 门诊费用失败态患者上下文边界（2026-08-18）

本文记录门诊费用只读页面的一项状态一致性修正。它只影响原生小程序页面状态和静态门禁，
不开放支付、医保、结算、退费或任何服务端写入，也不修改旧 Python 项目和旧服务。

## 1. 修正原因

门诊费用页的患者卡片和费用列表必须属于同一份已确认的 owner-scoped 读模型。原实现的
`showError` 会清空费用列表，但在“待缴费/已缴费”查询失败时保留 `selectedPatient`；这样页面
可能出现“上方仍显示当前患者、下方却没有与本次查询对应的数据”的混合状态，也可能让用户误以为
当前 tab 的结果已经针对该患者完成读取。

预约记录、爽约记录和报告目录已经在失败或 stale 状态清空患者卡片，门诊费用必须遵守相同的
展示隔离规则。清理的是页面派生状态，不会删除本地 opaque `patientId`、服务端患者目录或会话
token；空态仍保留“点击这里选择就诊人”的入口，用户可以显式恢复上下文。

## 2. 当前不变量

1. 初始目录读取和费用查询开始时清空旧患者卡片与费用列表。
2. 只有当前请求、当前显式患者和已通过服务端费用 contract 的结果同时成立时，页面才提交
   `selectedPatient` 与费用列表。
3. Provider、持久化、依赖未配置、患者映射或会话错误发生后，页面清空
   `selectedPatient/items/visibleItems`，不把失败降级成成功空列表。
4. 页面不删除本地患者选择；用户可以通过空态选择入口重新确认同一位或另一位就诊人。
5. 已缴费/待缴费切换只改变查询状态快照，不调用支付、医保授权、结算回写或 `wx.requestPayment`。

## 3. 实现与验证

- 页面实现：`apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.ts`；中文注释说明
  为什么失败态必须清理患者卡片。
- 页面空态：`apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.wxml`；患者为空时仍
  显示可点击的选择入口。
- 静态回归：`apps/miniprogram/scripts/acceptance.test.ts` 固定 `showError` 的患者清理边界。
- `pnpm --filter @hospital/miniprogram test`：121 项通过，1036 个断言。
- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过，运行包来源为
  `e5aef63d086e59bf66d43de4156b875314f39912`。

以上是代码和本地运行包证据，不代表真实 Provider、生产公网或微信真机费用业务已经验收；
真实验收仍须按当前候选手册取得页面、HTTP trace 和低敏日志三层证据。
