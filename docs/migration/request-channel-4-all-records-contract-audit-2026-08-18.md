# 全部挂号 requestChannel=4 合同审计

更新时间：2026-08-18

## 结论

当前不能开放“全部挂号”。旧端源码证明了页面意图是“在线挂号使用 `requestChannel=3`、全部挂号使用
`requestChannel=4`”，但没有证明当前医院 Provider 仍接受该渠道、两种渠道返回相同字段，或全部查询可以
安全地省略日期范围。新端因此继续只实现渠道 3，并让全部标签保持 fail-closed 的迁移提示。

本审计不修改旧项目，不向 Provider 发起新的业务请求，也不把旧端请求参数直接复制到新 API。

## 1. 证据来源

| 来源 | 已确认事实 | 不能证明的事项 |
| --- | --- | --- |
| 旧端 `src/pagesB/user/my_registration.vue` | 在线标签传 `3`；全部标签传 `4`；在线标签附带前后三个月日期窗口；全部标签没有日期窗口 | 当前生产渠道权限、响应字段、状态语义、分页/排序和超时后的最终结果 |
| 旧端 `src/api/modules/appointment.ts` | 旧客户端允许透传 `requestChannel`，并携带大量 Provider 患者/支付/预约字段类型 | 旧客户端类型和 HTTP 200 不是新平台 contract；旧端还可能把敏感字段带入页面状态 |
| 新端 `docs/provider-contract-v1.md` | 当前预约历史只读合同固定渠道 `3`、`isMzFlag=1`、`dateFlag=1`，日期由平台限制 | 渠道 `4` 的预约历史接口合同 |
| 新端 `docs/provider-intake/2026-08-16-appointment-registration-payment-refund.md` | 文档示例提到微信 `3`、自助机 `4`，但生产渠道码仍需确认 | 当前商户的渠道编码、授权范围及可回放的渠道 4 样例 |
| 新端 `packages/adapters/src/zhongyang-appointments.ts` | 记录 adapter 在服务端固定 `RECORD_REQUEST_CHANNEL="3"`，不接受小程序透传 Provider 参数 | 渠道 4 的字段白名单、响应包络和状态映射 |

## 2. 当前实现边界

新 API 的公共查询只接收内部 `patientId` 和有限 `startDate/endDate`，服务端再做 owner-scoped 患者映射；
Provider 患者号、渠道码和 `isMzFlag/dateFlag` 均由服务端 adapter 固定。这样可以防止小程序通过 query
切换 Provider 患者或渠道，也可以防止无限历史导出。

小程序当前只对已经取得的渠道 3 结果做“在线”筛选：排除服务端明确归一化为 `cancelled` 的记录。它不能把
渠道 3 结果复制到“全部”，也不能把未知状态、时间范围或页面列表数量推导为渠道 4 事实。

## 3. 必须补齐的渠道 4 事实

在实现代码前，至少需要 Provider/院方提供书面合同、脱敏 fixture 或受控 staging 回放，回答以下问题：

1. 渠道 4 是否仍是当前医院“全部挂号”的有效渠道，当前商户是否有调用权限；
2. 渠道 4 是否仍使用同一路径，是否要求 `isMzFlag=1`、`dateFlag=1`，以及日期缺省时的默认窗口；
3. 渠道 4 的响应包络、空结果成功条件、业务失败码和 HTTP/业务成功联合规则；
4. `status`、`statusName`、停诊、替诊、已登记、爽约和取消等状态是否与渠道 3 完全一致；
5. 是否存在分页、最大日期范围、默认排序、跨院区重复记录或同一预约重复返回；
6. 渠道 4 的患者号来源是否与渠道 3 相同，能否通过 owner/provider 独立映射安全取得；
7. 超时、连接中断、Provider 处理中和重复请求时的最终查单或稳定重试语义；
8. 至少一份成功、明确空结果、业务失败、字段异常和重复记录的脱敏样例。

## 4. 开放门槛

只有下列条件全部满足，才能新增服务端独立查询：

- 新增独立的渠道 4 contract/model/adapter 测试，不修改渠道 3 的固定语义；
- 服务端仍只接收内部 `patientId` 和平台允许的有限日期窗口，不允许小程序提交 `patId` 或任意渠道码；
- 对渠道 4 单独完成 owner 映射、字段白名单、状态映射、日期/分页边界和失败分类；
- `requested/synced/failed` 日志能区分渠道操作，但不记录患者号、预约号、支付字段或 Provider 原文；
- 获得真实 Provider 只读响应后，再完成公网、开发者工具和真机三层验收；
- 只有验收通过后，页面才从迁移提示切换为可查询状态。

在上述证据到达前，不新增 `requestChannel=4` 生产请求、不放宽日期校验、不修改当前 adapter 常量，
也不人为写入测试预约来制造样本。

