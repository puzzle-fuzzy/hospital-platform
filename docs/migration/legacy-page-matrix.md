# 旧端逐页迁移矩阵

> 盘点基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app\\src`，共扫描 64 个 Vue 页面；新端原生小程序当前有 9 个 TypeScript 页面源文件。
> 本矩阵用于防止页面遗漏，不把“有旧代码”或“新端有占位入口”当作业务完成证据。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| 已替换 | 新端已有对应页面或等价平台能力，且没有把旧端 provider 直连带入小程序 |
| 部分迁移 | 新端已有安全的只读/静态子集，但旧端写入、详情、支付或外部回写仍未开放 |
| 待 provider contract | 页面依赖众阳、HIS、云健康、外部小程序或其他运行时服务；没有新文档前不得猜字段 |
| 待临床审核 | 页面包含风险评估、健康建议、题目/分值/阈值或医疗内容；需要版本化内容和临床复核 |
| 不纳入生产 | 旧端测试工具，不应加入生产小程序页面清单 |

## 页面清单

| 旧页面组 | 页面（完整扫描结果） | 当前状态 | 下一步边界 |
| --- | --- | --- | --- |
| `pages/` | `index/index.vue` | 已替换 | 使用原生首页、服务端患者读模型和平台 API；不恢复旧端 provider 直连、完整卡号或二维码拼接 |
| `pages/` | `user/user.vue` | 部分迁移 | 原生“我的”、患者选择和挂号记录已接入；资料、反馈、订阅消息、咨询历史等入口逐项建 contract |
| `pages/` | `consult/consult.vue` | 待 provider contract | 需要独立会话、患者上下文、免责声明、AI/导诊服务和审计日志 |
| `pages/` | `hospital/hospital.vue` | 待 provider contract | 这是 web-view/互联网医院入口，必须确认外部小程序或 HTTPS 域名白名单，不能伪造站内页面 |
| `pages/` | `setting/setData.vue` | 不纳入生产 | 仅旧端测试数据工具，不进入新端 `app.json` |
| `pagesB/account/` | `follow.vue` | 待 provider contract | 需确认公众号/外部内容的来源、二维码/跳转地址和微信域名配置 |
| `pagesB/patient/` | `agreement.vue`、`doctor.vue`、`express.vue`、`patient_signature.vue`、`patientAdd.vue`、`patientChange.vue` | `patientChange` 已被安全的患者选择页替换；其余待 contract | 新增/绑定、签名、地址、我的医生和法律文本必须分别确认 owner、授权、审计和撤回规则 |
| `pagesB/hospital/` | `bloodAppointment.vue` | 待 provider contract | 需要采血号源、预约写入、取消和患者映射规则 |
| `pagesB/hospital/` | `confirm_registration.vue`、`registration.vue`、`registration_detail.vue` | 部分迁移 | 目录/历史只读页面已存在；锁号、预约写入、最终状态查询、取消、费用和 HIS 回写未开放 |
| `pagesB/hospital/` | `department_select.vue`、`doctor_card.vue`、`timeslot_source.vue` | 部分迁移 | 新端统一预约目录已覆盖科室/排班只读；医生详情、分时段字段白名单和写入前确认仍待 provider contract |
| `pagesB/hospital/` | `registration_medical_pay.vue` | 待 provider contract | 归入挂号支付专项，必须等待医保/微信支付状态机、金额和查单证据；不能由只读排班页面跳转伪造支付 |
| `pagesB/hospital/` | `selectPatient.vue` | 已替换 | 统一使用原生 `pages/patient-select/patient-select`，只持久化内部 opaque `patientId` |
| `pagesB/hospital/` | `hospitalList.vue` | 待 provider contract | 旧页只有静态单院区卡片且“查看路线/去挂号”语义混杂；需确认医院/院区模型后再决定是否作为预约前置页 |
| `pagesB/hospital/` | `navigation.vue` | 部分迁移 | 静态地图已迁移；实时楼层、科室定位、路线和地图数据版本未迁移 |
| `pagesB/health/` | `outpatient_pay.vue` | 部分迁移 | 新端已接入门诊费用只读目录；费用详情、支付、医保授权、结算回写和退费未开放 |
| `pagesB/health/` | `outpatient_pay_detail.vue`、`electronic_bill.vue` | 待 provider contract | 需费用明细白名单、金额单位、账单归属、分页/状态和短期资源授权 |
| `pagesB/health/` | `payment_cashier.vue` | 待 provider contract | web-view 收银台必须固定 HTTPS allowlist、订单 owner、回调/查单和返回状态，不能接任意 URL |
| `pagesB/health/` | `medical_insurance_pay.vue` | 待 provider contract | 归入医保专项；1101/6201/6202/6301/6203/6401、授权、查单和 HIS 回写全部独立验收 |
| `pagesB/health/` | `report_query.vue`、`report_detail.vue` | 部分迁移 | 新端报告目录/opaque 详情骨架已存在；真实 LIS/PACS/ECG 详情、附件、体检报告和下载授权未完成 |
| `pagesB/health/` | `electronic_record.vue` | 待 provider contract | 需要 HIS/EMR 只读资源、患者归属、脱敏字段和详情授权 |
| `pagesB/health/` | `electronic_consultation.vue` | 待 provider contract | 需明确电子导诊单来源、提交/读取权限和患者上下文；不能用旧缓存字段直接展示 |
| `pagesB/health/` | `inpatient_center.vue`、`inpatient_payment.vue` | 待 provider contract | 需要住院登记、住院患者 ID、费用清单、余额和支付状态的独立模型；不能复用门诊 patientId |
| `pagesB/health/` | `admission_preconsultation.vue`、`pre_visit.vue` | 待 provider contract | 问卷版本、病区归属、患者授权、提交幂等、医护侧读取和撤回规则未确认 |
| `pagesB/health/` | `discharge_followup.vue`、`discharge_followup_detail.vue` | 待 provider contract | 需要出院事件、随访任务、提交幂等、医护读取和敏感健康数据审计 |
| `pagesB/health/` | `risk_self_evaluation.vue`、`risk_form_fall.vue`、`risk_form_pain.vue`、`risk_form_pressure.vue` | 待临床审核 | 题目、评分、分级、建议、版本和免责声明必须由临床确认；结果是否落库还需授权 contract |
| `pagesB/health/` | `health_test.vue`、`self_test_question.vue`、`self_test_result.vue` | 待临床审核 | 旧端题库和分值不能直接当作医疗结论；先做版本化内容、临床复核和结果审计 |
| `pagesB/health/` | `bmi_calc.vue`、`blood_pressure_calc.vue` | 待临床审核 | 虽是本地计算，但旧端包含“示例”数据和历史血压标准；迁移前必须确认阈值、适用人群和免责声明 |
| `pagesB/health/` | `health_encyclopedia.vue`、`disease_detail.vue`、`drug_detail.vue`、`search_result.vue` | 待临床审核 | 只导入审核后的版本化内容；药品/疾病关联、搜索、发布时间和内容下线必须可审计 |
| `pagesB/health/` | `webview.vue` | 待 provider contract | 外部导诊/客服 web-view 必须有固定 HTTPS allowlist、来源参数白名单、登录态隔离和失败回退 |
| `pagesB/health/` | `gift_electronic_banner.vue`、`list_electronic_banner.vue`、`record_electronic_banner.vue` | 待 provider contract | 文件/文字提交、审核、内容安全、患者信息展示、撤回和管理端读取权限未确认 |
| `pagesB/health/` | `gift_health_praise.vue`、`list_health_praise.vue`、`record_health_praise.vue` | 待 provider contract | 表扬信提交、审核、脱敏公开展示、文件上传和管理端权限未确认 |
| `pagesB/user/` | `edit_profile.vue`、`feedback.vue` | 待 provider contract | 个人资料修改和意见反馈需要字段白名单、审计、限流及客服/管理端闭环 |
| `pagesB/user/` | `miss_appointment.vue` | 待 provider contract | 需要爽约事实来源、状态定义、患者归属和展示时效；不能用预约记录列表推导 |
| `pagesB/user/` | `my_consultation.vue` | 待 provider contract | 需要 AI/陪诊会话索引、患者归属、内容保留和脱敏策略 |
| `pagesB/user/` | `my_registration.vue` | 部分迁移 | 新端已接入预约历史只读；取消、退号、支付状态和 provider 患者用途映射仍待验收 |
| `pagesB/user/` | `subscription_message.vue` | 待 provider contract | 需确认微信订阅消息模板、用户授权时机、模板 ID、业务事件和撤销状态 |

## 盘点结论

- 64 个旧页面中，当前可宣称“已替换或已形成安全子集”的是：首页、我的/患者选择部分、预约只读部分、报告目录骨架、门诊费用目录、院内静态地图。
- 预约写入、费用/支付/医保、住院、健康内容/自测、风险评估、随访、便民投稿、AI、外部 web-view 和个人中心扩展都不能因为旧页面存在而直接迁移。
- 新 provider 文档到达后，应先从本矩阵选择一个状态为“待 provider contract”的域，完成 contract → adapter → domain → persistence → API → 小程序 → 日志 → 验收闭环；文档缺失的字段不得进入公共 contract。
