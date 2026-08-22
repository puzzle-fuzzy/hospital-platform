# 预约历史与爽约只读验收清单（2026-08-22）

> 当前候选为服务端 `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` 与小程序来源
> `b0e093565493285e07fe549879f8b87eda649cc7`。本清单只验收预约历史/爽约只读链路，
> 不打开预约提交、锁号、取消、支付、医保或 HIS 回写。

## 1. 验收顺序

1. 在正确的 `miniprogram` 项目中普通编译，确认 `dist/build-info.json.sourceRevision` 与上方来源一致；
   不把 `src/**/*.test.ts` 或生成的测试脚本复制进 `dist/`。
2. 使用真实微信会话登录，进入“选择就诊人”，明确点击一位就诊人并确认页面上的姓名和脱敏卡号。
3. 从首页或“我的”进入“我的挂号”，确认页面先完成 `/me` 和 owner-scoped 患者目录读取，再请求预约记录。
4. 记录“在线挂号”页面结果：有记录时核对科室、医生、日期、时段、序号和状态；空结果必须显示空态，不能把错误响应伪装成空列表。
5. 进入“爽约记录”，确认它只查询过去 90 天，并且只展示服务端明确归一化为 `missed` 的记录；不能把取消、完成或未知状态推断为爽约。
6. 更换另一位就诊人后重复步骤 3–5。旧卡片、旧列表和旧异步响应不得回写到新患者。

## 2. 必须同时保存的低敏证据

| 层级 | 需要记录 | 禁止记录 |
| --- | --- | --- |
| 页面 | 页面名称、结果为“有记录/空结果/明确错误”、是否完成患者切换 | 姓名、身份证、完整卡号、手机号、token、原始响应 |
| 客户端 | 请求方法、公共路径、HTTP 状态、脱敏 `requestId`、页面动作顺序 | `Authorization`、Provider 地址、Provider 患者号、完整请求参数 |
| 服务端 | `appointment.records.requested` → `appointment.records.synced` 或固定失败事件、同链 HTTP `2xx`、Provider 请求数量 | Provider 原始报文、患者号、预约号、姓名、身份证、手机号 |

只有三层证据属于同一次页面动作，并且 `requested/synced` 与 HTTP 完成事件保持同一平台 trace，
才能把该患者和该窗口标记为通过。单独的模拟器画面、HTTP `200` 或静态测试都不能替代真实验收。

## 3. 立即停止条件

- `/me` 返回 `401`、会话代际变化或患者目录 owner 不一致；
- 页面显示上一位患者的记录，或切换患者后旧列表仍可展开/点击；
- 预约记录依赖未配置、Provider 业务失败、响应字段非法、日期越过查询窗口或同链出现 HTTP 失败；
- 只能看到记录数量而无法证明页面、客户端 requestId 和服务端 trace 属于同一次请求；
- 任何步骤要求调用支付、医保授权、预约写入、取消或 HIS 回写。

停止后只保留低敏失败证据，不重试高风险动作，也不修改旧 Python 服务。

## 4. 当前实现入口

- API：`GET /api/v2/appointments/records`，仅接受平台内部 `patientId` 和有限日期窗口；
- 小程序：`pages/appointment-records/appointment-records`、`pages/missed-appointments/missed-appointments`；
- 服务端日志：`appointment.records.requested`、`appointment.records.synced`、`appointment.records.failed`；
- 业务代码：`apps/api/src/modules/appointments/service.ts`、
  `apps/miniprogram/src/services/dashboard-service.ts`。

真实 Provider 或真机证据未取得前，以上入口仍只能标记为“代码已实现、业务待验收”。
