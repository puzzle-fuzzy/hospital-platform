# 电子导诊单 Contract 草案

> 状态：`draft`。本文只记录旧端页面的实际调用线索和新端准入条件；未取得 Provider/HIS 文档、脱敏样例和权限确认前，
> 不注册公开 API、不新增小程序页面、不把预约历史结果冒充电子导诊单。

## 1. 旧端实际行为

旧端页面 `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\health\\electronic_consultation.vue` 的页面标题是“电子导诊单”，
但它并没有调用一个名字明确的电子导诊接口，而是调用：

```text
GetAppointmentHistoryApi(patId, { startTime, endTime })
  -> getAppointmentInfosApi(patId, ...)
  -> GET /msun-middle-business-appointment-server/v1/appointment-infos/{patId}
```

旧 `companion.ts` 将预约信息映射成 `COMPANION_DATA_LIST_ITEM`，页面展示科室、号源类型、序号、时间、状态提示和地点。
`getAppointmentInfosApi` 的默认 `requestChannel` 为 `4`，日期由设备本地时间计算；页面和 helper 都把非数组/请求异常折叠为空列表。

这只能证明旧端在“电子导诊单”页面复用了预约历史查询线索，不能证明渠道 4 就是电子导诊单 contract，也不能证明返回的预约记录包含取药、检查执行或导诊状态事实。

## 2. 旧端附带功能的真实边界

页面底部还存在以下入口：

- “缴费账单”跳转旧门诊缴费页；新端门诊费用目前只开放安全只读查询；
- “病历查询”跳转旧门诊病历页；门诊记录 contract 仍为 draft，不复用报告目录；
- “住院预约”跳转旧公众号/关注页面；不是电子导诊单业务，不在本 contract 实现；
- 就诊码弹框在旧模板中被注释，不能因为页面存在代码就当作医院扫码协议已完成。

因此电子导诊单页面不能通过恢复这些旧跳转来“补齐功能”。每个入口都必须有自己的 owner、权限和错误语义。

## 3. 新端暂不实现的原因

1. `requestChannel=4` 的真实含义、可查询范围和与预约历史的关系没有正式确认；不能用渠道 3 或渠道 4 的预约结果伪造导诊记录。
2. `appointmentInfoId`、Provider 患者号和序号的敏感性、稳定性、详情权限没有确认；不能放进小程序请求、缓存或公共 contract。
3. `tips` 是旧端按状态码拼接的文案，不是 Provider 已确认的执行状态；不能直接迁移为“已取药/已检查”等医疗事实。
4. 取药地点、检查地点、执行状态、电子导诊单来源、生成时机和撤回语义都没有字段白名单。
5. 旧端失败时显示空列表，无法区分真实空结果、患者映射缺失、权限拒绝、未配置和 Provider 暂时失败；新端不能复制这一错误边界。

在这些事实没有冻结前，个人中心的“电子导诊单”和首页同名服务保持“迁移中”提示是正确状态，不新增兼容转发或空壳页面。

## 4. Provider 最小确认清单

| 编号 | 必须确认 | 通过标准 |
| --- | --- | --- |
| EC-01 | 电子导诊单专用 endpoint、method、环境和认证 | 文档版本、地址和真实脱敏请求样例一致 |
| EC-02 | 患者引用来源 | 明确使用现有 `his-patient` 还是独立引用；客户端只传平台 `patientId` |
| EC-03 | `requestChannel=4` 语义 | 文档明确说明它是否为导诊单，不得从旧默认值推断 |
| EC-04 | 成功 envelope、空结果和业务失败 | 能区分成功空目录、权限拒绝、未配置和暂时失败 |
| EC-05 | 日期窗口、时区、排序和分页 | 服务端固定中国标准时间、最大窗口和快照/游标语义 |
| EC-06 | 字段白名单 | 科室、医生、时间、地点、序号、执行状态逐项确认脱敏和展示权限 |
| EC-07 | 稳定引用和详情 | 列表引用不能直接暴露 Provider ID；详情需要 owner、TTL 和审计 |
| EC-08 | 取药/检查/执行状态 | 说明字段来源、更新时间、未知值、撤回和最终一致性 |
| EC-09 | 二维码/扫码关联 | 提供医院扫码协议、短期 token、签名、TTL、回执和失败/重试规则 |
| EC-10 | 日志关联 | 允许记录平台 traceId、provider request id 和固定失败原因，不记录原始患者/医疗正文 |

## 5. 实现顺序与停止条件

Provider 资料齐全后，严格按以下顺序推进：

```text
provider 文档与脱敏样例
  -> 版本化 contract
  -> adapter 白名单与错误归一化
  -> owner-scoped service / 日志
  -> API route / 患者端运行时校验
  -> 小程序列表与详情
  -> Provider、内网、公网、真机四层验收
```

任何一项缺失时停止在当前层，不通过“复用预约 API”“返回空数组”“直接跳旧 WebView”或“先做 UI”绕过业务契约。

## 6. 当前结论

本轮没有代码变更。现有新端继续保留入口位置和旧端图标，但只显示迁移状态；预约历史、门诊费用、病历记录和电子导诊单彼此独立，
不能因为它们都显示“就诊时间/科室”就共用一个读模型。门诊病历的独立准入条件见
[`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md)。
