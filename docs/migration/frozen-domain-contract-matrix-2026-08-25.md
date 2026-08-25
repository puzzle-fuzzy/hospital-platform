# 全量阻断业务域 Contract 准入矩阵（2026-08-25）

## 说明

全量迁移当前不是“把 64 个旧页面都做成能点击”，而是先保证每个入口都有明确落点，再为每个高风险域冻结独立的 contract。14 个域统一进入 `pages/feature-status/feature-status`，但它们的 Provider、患者身份、临床审核、支付状态机和外部主体不同，不能共用一个兼容接口。

唯一机器事实源是 [`tools/migration-boundary-catalog.mjs`](../../tools/migration-boundary-catalog.mjs)，入口审计是：

```powershell
pnpm migration:boundary:audit
pnpm migration:readiness
```

当前矩阵只证明准入边界完整，不证明任何阻断域已经具备真实业务能力。没有正式材料时，状态页必须继续保持关闭；不能用本地 fixture、旧接口转发、旧缓存或成功空数组代替 contract。

## 统一准入材料

所有冻结域至少需要以下材料：

1. 脱敏的请求、成功响应、明确空结果、拒绝和超时样例；
2. 当前用户/患者/外部主体的 owner 映射规则；
3. 字段白名单、状态枚举、敏感字段脱敏和长度边界；
4. requestId、Provider requestId、低敏业务事件和可重试性记录；
5. 失败回滚、重复请求、版本冲突和撤回/失效语义；
6. 页面 `requesting`、成功非空、成功空、未授权、输入错误、暂时故障和契约异常状态。

各域还必须补充自己的特有材料，完成后才能按 `contract -> adapter -> domain -> persistence -> API -> 页面 -> 日志 -> 真机` 顺序实现。

## 14 个域

| 域 | Contract 家族 | 当前入口 | 特有准入材料 | 仍然关闭的能力 |
| --- | --- | --- | --- | --- |
| 门诊病历 | `provider-read-only` | `electronic_record.vue` | Provider 版本、患者引用 | 病历写入、跨患者查询、临床建议 |
| 住院信息 | `provider-read-only` | `inpatient_center.vue` | episode、`patInHosId`、状态枚举 | 门诊/住院标识混用、住院写入、住院结算 |
| 住院支付 | `payment-write` | `inpatient_payment.vue` | 金额单位、订单状态机、回调/查单、幂等、补偿 | 创建订单、支付调起、医保结算、HIS 回写 |
| 我的医生 | `provider-read-only` | `doctor.vue` | 医生关系来源、展示白名单、失效规则 | 客户端指定关系、医生资料写入、跨 owner 查询 |
| 我的问诊 | `external-session` | `my_consultation.vue` | 外部主体、白名单、短期会话、回跳、退出、撤回 | 任意 WebView、长期 ticket、伪造问诊列表 |
| 电子导诊单 | `provider-read-only` | `electronic_consultation.vue` | 来源系统、患者上下文、短期会话、回跳 | 伪造导诊单、跨患者读取、未经确认的临床结论 |
| 患者新增绑定 | `patient-write` | `patientAdd.vue` | 同意、身份核验、幂等、撤回、医护读取 | 仅凭姓名绑定、客户端提交 Provider 患者号、无同意建档 |
| 入院预问诊 | `clinical-content-write` | `admission_preconsultation.vue` | 题卷版本、授权、幂等、临床审核 | 旧题库结论、无授权提交、问卷当诊断 |
| 出院随访 | `clinical-content-write` | `discharge_followup*.vue` | 出院事件、随访任务、答案版本、撤回、临床审核 | 跨任务提交、覆盖历史随访、无医护读取规则发布 |
| 风险评估 | `clinical-content-write` | `risk_*.vue` | 规则版本、适用人群、免责声明、临床审核 | 客户端阈值、个体化诊断、无版本回滚 |
| 健康自测与计算器 | `clinical-content-write` | `blood_pressure_calc.vue` 等 | 题库/阈值版本、适用人群、免责声明、临床审核 | 旧 JSON 医学事实、未经审核等级、个体化用药建议 |
| 预约前预问诊 | `clinical-content-write` | `pre_visit.vue` | 预约上下文、题卷版本、幂等、临床审核 | 把问卷当预约成功、跨预约复用答案、未经审核分诊 |
| 电子锦旗 | `external-content` | `gift_*banner.vue` | 内容审核、文件安全、公开脱敏、幂等、撤回 | 公开患者正文、未校验文件、无撤回内容 |
| 表扬信 | `external-content` | `gift_*praise.vue` | 内容审核、文件安全、公开脱敏、幂等、撤回 | 公开患者正文、把表扬信当医疗证明、无审核发布 |

## 统一状态页规则

状态页不是空白占位。它必须展示：当前迁移阶段、旧入口覆盖数量、下一步所需材料和返回共享主 Tab 的入口；不允许在阻断域中增加一个“请求后返回空列表”的假业务页。

当材料到达后，先更新机器目录和 contract 文档，再逐域实现。任何一个域的确认不能替代其他域的确认；尤其不能用门诊只读、预约历史或普通个人资料的成功证据替代支付、医保、临床或外部会话证据。

## 当前队列

- A 批次：五个低风险只读域先做同一候选的真机与服务端同链证据；
- B 批次：健康百科等待正式审核 bundle、staging 导入和撤回演练；
- C 批次：门诊病历、住院、医生、问诊分别收集 Provider contract；
- D/E 批次：患者绑定、便民写入、外部入口和实时能力分别冻结 owner、授权、短期会话和回跳；
- F 批次：支付、医保、结算、退款和 HIS 回写最后专项处理。

旧 Python 服务、旧数据库、旧 Redis 和线上旧进程不在本矩阵的修改范围内。
