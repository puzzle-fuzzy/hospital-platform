# 患者上下文只读页面契约

本文冻结患者端预约记录、爽约记录、报告目录、报告详情和门诊费用五类页面在发起业务查询前的共同边界。
它解决的是“当前页面到底能不能代表当前就诊人”的问题，不是医院目录同步接口的替代品。

## 1. 两类不同生命周期

```text
登录恢复 / 独立选择页
    -> syncPatientsFromHospital
    -> 完整医院目录同步 + his-patient 映射确认

预约记录 / 爽约记录 / 报告目录 / 报告详情 / 门诊费用页
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
4. 当最新 owner 目录成功返回空数组时，如果本地已有选择，仍必须返回 `patient-selection-stale`；只有从未保存过选择时才返回 `patient-not-bound` 对应的 `empty` 状态，不能把患者失效或目录恢复窗口误报成从未绑定；
5. 已保存患者存在但临床映射不可用时必须返回 `patient-clinical-unavailable`，不能把目录引用当作 `his-patient`；
6. 只有解析成功的内部 opaque `patientId` 才能进入预约、报告或门诊费用查询；Provider 患者号只在服务端 adapter 内部流转。

其中门诊费用、预约记录和报告目录的加载器还必须在小程序服务层再次调用同一个非空校验，
不能因为页面已经展示过患者卡片就把空标识交给 API。这样可以把患者上下文错误在网络请求
之前收敛为统一的 `patient-selection-required`，也避免为无效查询制造业务日志；服务端仍然
保留 owner 归属校验，客户端前置校验不是安全边界的替代品。

业务页面在新的请求开始时仍必须先清空上一位患者的列表，并使用页面实例级 latest-request guard 丢弃迟到响应。`loadCurrentPatient` 统一解析患者，不会替代页面自己的展示隔离和异步请求守卫。

所有使用页面请求守卫的原生页面还必须在 `onUnload` 调用 `disposePageInstance(this)`。这不是取消网络请求，而是把页面实例标记为不可回写：微信请求即使在页面离开后完成，也不能继续更新已销毁页面。首页会话恢复、报告详情和患者范围只读页面都必须遵守同一边界。

患者选择页切换成功后的 Toast 延迟回跳也属于页面实例状态：回跳定时器必须按当前选择页实例保存，并在 `onUnload` 中直接取消。页面已经卸载后不能再调用 `setData`，也不能让旧定时器继续执行 `navigateBack`，否则用户手动返回或快速重复进入时可能误操作新的页面栈。

选择页的刷新还必须区分“完整刷新周期”和“共享同步 Promise”：新一轮目录读取开始后，旧同步即使晚返回也不能覆盖新列表；
如果多个调用方复用同一个在途同步，Promise 必须返回完整患者数组，让每个仍有效的页面周期独立判断是否回写 `selectionReady` 和错误状态，
不能把同步结果封装在第一个调用方的 `void` 闭包中。目录读取先完成时只允许展示脱敏目录，
不能在临床映射确认前恢复本地当前患者；该标记只能由完整同步成功的最新周期重新计算。

同步成功后的页面回写必须继续消费 `setPatientsFromPayload`/`setPatientList` 对同一份快照
生成的 `empty`、`stale` 或 `unavailable` 解析结果，不能再按 `patients.length` 或
`ready` 数量二次推断错误状态。尤其是“已有本地选择但同步目录为空”时，数组长度为零
不能覆盖 `patient-selection-stale`；否则页面会把患者失效错误伪装成“从未绑定患者”，
用户也无法得到重新选择入口的正确提示。

首页、我的、患者选择、预约记录、爽约记录、报告目录、报告详情和门诊费用页的患者状态都必须复用
`services/patient-selection-service.ts` 的 `patientContextErrorMessage` 或
`patientSelectionResolutionMessage`。患者未绑定、已保存选择失效、临床映射不可用和要求先选择患者属于同一组
跨页面业务状态，不能由页面各自复制文案或直接展示服务端/Provider 原文；领域服务未配置、费用映射缺失等业务专属错误
可以在页面先处理，再回到这个公共安全兜底。稳定中文文案唯一维护在 `services/api-client.ts` 的公共错误表中，
目录解析状态只负责生成对应的错误码。

上述五个页面在发起患者范围查询前、以及异步响应准备写入页面状态前，还必须调用同一服务的
`isCurrentSelectedPatient`。页面实例级 latest-request guard 只能识别同一个页面的刷新顺序，不能识别用户在另一个页面
显式更换就诊人；本地 opaque `patientId` 快照不匹配时必须丢弃旧响应，不能把旧患者的预约、报告或费用卡片写回当前页面。

报告详情还必须在 `onLoad` 发起请求前校验页面参数中的 `patientId` 与本地当前选择一致，
并在详情响应准备回写前再次校验。服务端的 owner + patient + reportId + TTL 查询仍是最终授权边界；
小程序校验只负责阻止旧页面栈和慢响应在患者切换后继续展示，不能因此省略服务端复核。

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

- `apps/miniprogram/scripts/acceptance.test.ts` 必须确保四个患者目录列表页使用统一患者门禁，且报告详情页单独复用同一患者错误翻译入口；五个患者范围页面都不得各自重新实现目录解析或错误语义；
- 同一静态门禁还必须确保患者范围页面复用 `patientContextErrorMessage` 或 `patientSelectionResolutionMessage`，避免患者状态文案随页面迁移发生漂移；
- 同一静态门禁还必须确保五个页面复用 `isCurrentSelectedPatient`，避免跨页面切换后的旧异步响应或详情响应覆盖当前患者；
- 小程序测试只能证明调用顺序和失败边界，不能替代真实 Provider、生产公网和真机证据；
- 真机验收仍需逐个页面确认：选择患者 → 返回页面 → 目录重新读取 → 业务查询使用新患者 → 旧响应不会覆盖新列表；
- 任何未来新增患者端只读页面，必须先加入本契约和静态门禁，再注册业务 API。
