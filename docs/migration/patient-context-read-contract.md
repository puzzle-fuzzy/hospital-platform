# 患者上下文只读页面契约

本文冻结患者端预约记录、爽约记录、报告目录和门诊费用四类页面在发起业务查询前的共同边界。
它解决的是“当前页面到底能不能代表当前就诊人”的问题，不是医院目录同步接口的替代品。

## 1. 两类不同生命周期

```text
登录恢复 / 独立选择页
    -> syncPatientsFromHospital
    -> 完整医院目录同步 + his-patient 映射确认

预约记录 / 爽约记录 / 报告 / 门诊费用页
    -> loadCurrentPatient
    -> 读取最新 owner-scoped /patients
    -> requireStoredPatientSelection
    -> 只使用 ready 的内部 patientId 查询平台 API
```

业务页面故意不隐式触发 Provider 同步。原因是“打开只读页面”不应被扩大为一次医院目录同步：页面栈返回、多个只读页面并发打开和下拉刷新可能同时出现；如果每个页面都同步，就会制造同步租约冲突、重复 Provider 请求和难以解释的 `patient-sync-in-progress`。选择页完成同步后，调用页重新读取平台目录即可确认最新状态。

## 2. `loadCurrentPatient` 的不变量

实现位于 `apps/miniprogram/src/services/dashboard-service.ts`，调用方不得自行复制以下逻辑：

1. 目录读取必须经过带当前 Bearer 会话的 `/patients`，不能使用旧端缓存、Provider 地址或页面参数；
2. 首次从未保存选择时，才允许默认第一位 `clinicalAccess=ready` 患者；
3. 已保存患者不在当前 owner 目录时必须返回 `patient-selection-stale`，不能静默切换到 `patients[0]`；
4. 已保存患者存在但临床映射不可用时必须返回 `patient-clinical-unavailable`，不能把目录引用当作 `his-patient`；
5. 只有解析成功的内部 opaque `patientId` 才能进入预约、报告或门诊费用查询；Provider 患者号只在服务端 adapter 内部流转。

业务页面在新的请求开始时仍必须先清空上一位患者的列表，并使用页面实例级 latest-request guard 丢弃迟到响应。`loadCurrentPatient` 统一解析患者，不会替代页面自己的展示隔离和异步请求守卫。

预约记录、爽约记录、报告目录和门诊费用页的 `showError` 还必须复用
`services/patient-selection-service.ts` 的 `patientContextErrorMessage`。患者未绑定、已保存选择失效、临床映射不可用
和要求先选择患者属于同一组跨页面业务状态，不能由页面各自复制文案或直接展示服务端/Provider 原文；领域服务未配置、
费用映射缺失等业务专属错误可以在页面先处理，再回到这个公共安全兜底。

上述四个页面在发起患者范围查询前、以及异步响应准备写入页面状态前，还必须调用同一服务的
`isCurrentSelectedPatient`。页面实例级 latest-request guard 只能识别同一个页面的刷新顺序，不能识别用户在另一个页面
显式更换就诊人；本地 opaque `patientId` 快照不匹配时必须丢弃旧响应，不能把旧患者的预约、报告或费用卡片写回当前页面。

## 3. 失败后的用户态

| 情况 | 页面行为 |
| --- | --- |
| 未登录或会话失效 | 清空当前页面患者和业务列表，提供登录/重试入口 |
| 当前账号没有绑定患者 | 展示“暂无绑定就诊人”，入口进入患者选择页 |
| 已保存选择 stale | 保留本地 opaque ID 供恢复判断，但要求用户重新选择 |
| 临床映射不可用 | 展示映射未完成提示，不发起 Provider 业务查询 |
| 目录或业务请求暂时失败 | 不降级为空列表，不伪造“没有记录”，保留错误和重试入口 |

这些状态不能合并成一个空数组，否则用户无法区分“确实没有业务记录”和“当前就诊人上下文尚未成立”。

## 4. 代码门禁与真实验收

- `apps/miniprogram/scripts/acceptance.test.ts` 必须确保四个页面都使用 `loadCurrentPatient`，且不各自重新实现目录解析；
- 同一静态门禁还必须确保四个页面复用 `patientContextErrorMessage`，避免患者状态文案随页面迁移发生漂移；
- 同一静态门禁还必须确保四个页面复用 `isCurrentSelectedPatient`，避免跨页面切换后的旧异步响应覆盖当前患者；
- 小程序测试只能证明调用顺序和失败边界，不能替代真实 Provider、生产公网和真机证据；
- 真机验收仍需逐个页面确认：选择患者 → 返回页面 → 目录重新读取 → 业务查询使用新患者 → 旧响应不会覆盖新列表；
- 任何未来新增患者端只读页面，必须先加入本契约和静态门禁，再注册业务 API。
