# 全量阻断业务域 Contract 准入矩阵（2026-08-25）

## 说明

全量迁移当前不是“把 64 个旧页面都做成能点击”，而是先保证每个入口都有明确落点，再为每个高风险入口冻结独立的 contract。当前有 34 个冻结入口 gate：覆盖 39 个旧页面入口和 13 个 action-only 引用；其中既包括首页/“我的”入口，也包括预约、报告、费用、患者二级动作。它们统一进入 `pages/feature-status/feature-status`，但 Provider、患者身份、临床审核、支付状态机和外部主体不同，不能共用一个兼容接口。

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

## 34 个冻结入口 gate

| 域 | Contract 家族 | 当前入口 | 特有准入材料 | 仍然关闭的能力 |
| --- | --- | --- | --- | --- |
| 门诊病历 | `provider-read-only` | `electronic_record.vue` | Provider 版本、患者引用 | 病历写入、跨患者查询、临床建议 |
| 住院信息 | `provider-read-only` | `inpatient_center.vue` | episode、`patInHosId`、状态枚举 | 门诊/住院标识混用、住院写入、住院结算 |
| 住院支付 | `payment-write` | `inpatient_payment.vue` | 金额单位、订单状态机、回调/查单、幂等、补偿 | 创建订单、支付调起、医保结算、HIS 回写 |
| 医保电子凭证与挂号医保支付 | `payment-write` | `medical_insurance_pay.vue`、`registration_medical_pay.vue`、`我的:insurance` | 授权码 TTL、订单归属、医保协议、查单/回调、幂等 | 把授权当结算成功、前端提交 token/金额、绕过平台订单、未经查单写回 HIS |
| 我的医生 | `provider-read-only` | `doctor.vue` | 医生关系来源、展示白名单、失效规则 | 客户端指定关系、医生资料写入、跨 owner 查询 |
| 智能导诊 | `external-session` | `首页:guide`（action-only） | 模型/知识版本、免责声明、风险分流、会话 owner、会话审计 | 未版本化医疗建议、把导诊当诊断/预约成功、跨用户复用上下文 |
| 陪诊服务 | `external-session` | `首页:companion`（action-only） | 外部主体、会话 owner、短期会话、保留、退出、撤回 | 把预约历史当陪诊记录、长期 ticket、跨患者创建会话 |
| 智能客服 | `external-session` | `webview.vue`、`我的:smart-customer` | 域名 allowlist、外部受众、短期会话、回跳、退出 | 任意 URL、向 WebView 交付平台 token、长期 ticket |
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

### 二级入口与患者/费用补充 gate

| 入口 gate | Contract 家族 | 当前入口 | 特有准入材料 | 仍然关闭的能力 |
| --- | --- | --- | --- | --- |
| 挂号详情 | `provider-read-only` | `registration_detail.vue`、`预约记录:appointment-detail` | 预约引用、状态枚举、患者归属 | 用卡片索引读详情、跨患者查看、返回原始挂号号 |
| 预约下单 | `payment-write` | `confirm_registration.vue`、`预约目录:appointment-write` | 锁号、订单归属、取消、HIS 回写 | 直接锁号、客户端提交金额、无幂等创建 |
| 采血预约 | `provider-read-only` | `bloodAppointment.vue` | 采血号源、患者归属、状态枚举 | 提交采血预约、复用普通门诊号源 |
| 支付收银台 | `payment-write` | `payment_cashier.vue` | 订单归属、金额单位、回调/查单、回滚 | 恢复旧 WebView、任意外部支付地址、客户端确认成功 |
| 电子账单 | `payment-write` | `electronic_bill.vue` | 账单引用、金额单位、短期资源链接、过期 | 返回原始账单 URL、跨患者读取、把账单当支付成功 |
| 就诊人协议 | `patient-write` | `agreement.vue` | 协议版本、同意记录、撤回、审计 | 无版本接受、把本地勾选当同意、跨 owner 复用 |
| 就诊人联系地址 | `patient-write` | `express.vue` | 字段白名单、owner、版本、脱敏 | 仅凭姓名保存、完整地址写日志、覆盖其他患者 |
| 就诊二维码 | `patient-write` | `首页:patient-qr` | 签名载荷、受众、TTL、防重放、撤销 | 外发 `patId`/卡号、永久二维码、无签名生成 |
| 就诊人签名 | `patient-write` | `patient_signature.vue` | 用途、文件安全、同意、撤回 | 复用旧端签名、无用途上传、跨患者读取 |
| 消息订阅 | `external-session` | `subscription_message.vue` | 模板 ID、业务事件、授权结果、撤销 | 把本地开关当授权、未经事件发送、跨用户复用 |
| 费用记录详情 | `payment-write` | `outpatient_pay_detail.vue`、`门诊费用:outpatient-payment-detail` | 账单引用、金额单位、归属、字段白名单 | 把索引当账单号、混用待缴/已缴、未授权明细 |
| 门诊缴费 | `payment-write` | `门诊费用:outpatient-payment-write` | 订单归属、金额守恒、幂等、回调/查单 | 客户端创建订单、提交金额、绕过只读费用引用 |
| 报告详情入口 | `provider-read-only` | `报告目录:report-detail` | opaque 引用、患者归属、TTL、脱敏 | 用列表索引直连、返回原始报告号、跨患者打开 |
| 云影像 | `provider-read-only` | `报告详情:report-cloud-image` | 资源 allowlist、短期会话、受众、过期 | 任意影像 URL、长期资源链接、外发患者标识 |
| 报告分享 | `external-session` | `报告详情:report-share` | 受众、脱敏、TTL、防重放、撤销 | 分享原始报告、永久链接、无受众生成 |
| 报告复诊 | `provider-read-only` | `报告详情:report-follow-up` | 患者上下文、预约关系、用途、审计 | 根据报告自动预约、把报告当诊断、跨患者创建 |

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
