# 旧端逐页迁移矩阵

> 盘点基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app\\src`，共扫描 64 个 Vue 页面；新端原生小程序当前有 14 个 TypeScript 页面源文件。
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
| `pagesB/account/` | `follow.vue` | 部分迁移 | 原生端已迁移静态公众号通知说明和受控本地图标；真实二维码、关注状态、模板消息授权和外部跳转仍待独立 contract |
| `pagesB/patient/` | `agreement.vue`、`doctor.vue`、`express.vue`、`patient_signature.vue`、`patientAdd.vue`、`patientChange.vue` | `patientChange` 已被安全的患者选择页替换；其余待 contract | 新增/绑定、签名、地址、我的医生和法律文本必须分别确认 owner、授权、审计和撤回规则；我的医生旧表/接口风险见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md)，患者绑定见 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md)，绑卡/协议/签名总边界见 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md) |
| `pagesB/hospital/` | `bloodAppointment.vue` | 待 provider contract | 需要采血号源、预约写入、取消和患者映射规则 |
| `pagesB/hospital/` | `confirm_registration.vue`、`registration.vue`、`registration_detail.vue` | 部分迁移 | 目录/历史只读页面已存在；锁号、预约写入、最终状态查询、取消、费用和 HIS 回写未开放 |
| `pagesB/hospital/` | `department_select.vue`、`doctor_card.vue`、`timeslot_source.vue` | 部分迁移 | 新端统一预约目录已覆盖科室/排班只读；医生详情、分时段字段白名单和写入前确认仍待 provider contract |
| `pagesB/hospital/` | `registration_medical_pay.vue` | 待 provider contract | 归入挂号支付专项，必须等待医保/微信支付状态机、金额和查单证据；不能由只读排班页面跳转伪造支付 |
| `pagesB/hospital/` | `selectPatient.vue` | 已替换 | 统一使用原生 `pages/patient-select/patient-select`，只持久化内部 opaque `patientId` |
| `pagesB/hospital/` | `hospitalList.vue` | 部分迁移 | 原生端已迁移旧静态单院区卡片、受控本地图片和“医院卡片 → 预约目录”前置流程；动态机构/院区目录、真实路线和多院区选择仍待独立 contract |
| `pagesB/hospital/` | `navigation.vue` | 部分迁移 | 静态地图已迁移；实时楼层、科室定位、路线和地图数据版本未迁移 |
| `pagesB/health/` | `outpatient_pay.vue` | 部分迁移 | 新端已接入门诊费用只读目录；费用详情、支付、医保授权、结算回写和退费未开放 |
| `pagesB/health/` | `outpatient_pay_detail.vue`、`electronic_bill.vue` | 待 provider contract | 需费用明细白名单、金额单位、账单归属、分页/状态和短期资源授权 |
| `pagesB/health/` | `payment_cashier.vue` | 待 provider contract | web-view 收银台必须固定 HTTPS allowlist、订单 owner、回调/查单和返回状态，不能接任意 URL |
| `pagesB/health/` | `medical_insurance_pay.vue` | 待 provider contract | 归入医保专项；1101/6201/6202/6301/6203/6401、授权、查单和 HIS 回写全部独立验收 |
| `pagesB/health/` | `report_query.vue`、`report_detail.vue` | 部分迁移 | 新端报告目录/opaque 详情骨架已存在；真实 LIS/PACS/ECG 详情、附件、体检报告和下载授权未完成 |
| `pagesB/health/` | `electronic_record.vue` | 待 provider contract | 需要 HIS/EMR 只读资源、患者归属、脱敏字段和详情授权 |
| `pagesB/health/` | `electronic_consultation.vue` | 待 provider contract | 需明确电子导诊单来源、提交/读取权限和患者上下文；不能用旧缓存字段直接展示 |
| `pagesB/health/` | `inpatient_center.vue`、`inpatient_payment.vue` | 待 provider contract | 需要住院登记、住院患者 ID、费用清单、余额和支付状态的独立模型；不能复用门诊 patientId |
| `pagesB/health/` | `admission_preconsultation.vue`、`pre_visit.vue` | 待 provider contract | 旧端分别走本地 JSON 问卷和 `saveBeforeVisitRecord` provider 写入；必须绑定问卷版本、预约/住院任务、患者授权、幂等、医护读取和撤回规则；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| `pagesB/health/` | `discharge_followup.vue`、`discharge_followup_detail.vue` | 待 provider contract | 需要出院事件、随访任务、版本化答案、提交幂等、医护读取和敏感健康数据审计；不能按 `(user_id, pat_id)` 覆盖不同随访表 |
| `pagesB/health/` | `risk_self_evaluation.vue`、`risk_form_fall.vue`、`risk_form_pain.vue`、`risk_form_pressure.vue` | 待临床审核 | 题目、评分、分级、建议、版本和免责声明必须由临床确认；未知问卷版本拒绝写入，结果是否落库还需授权 contract |
| `pagesB/health/` | `health_test.vue`、`self_test_question.vue`、`self_test_result.vue` | 待临床审核 | 旧端题库和分值不能直接当作医疗结论；先做版本化内容、临床复核和结果审计 |
| `pagesB/health/` | `bmi_calc.vue`、`blood_pressure_calc.vue` | 待临床审核 | 虽是本地计算，但旧端包含“示例”数据和历史血压标准；迁移前必须确认阈值、适用人群和免责声明 |
| `pagesB/health/` | `health_encyclopedia.vue`、`disease_detail.vue`、`drug_detail.vue`、`search_result.vue` | 待临床审核 | 只导入审核后的版本化内容；药品/疾病关联、搜索、发布时间和内容下线必须可审计 |
| `pagesB/health/` | `webview.vue` | 待 provider contract | 外部导诊/客服 web-view 必须有固定 HTTPS allowlist、来源参数白名单、登录态隔离和失败回退 |
| `pagesB/health/` | `gift_electronic_banner.vue`、`list_electronic_banner.vue`、`record_electronic_banner.vue` | 待 provider contract | 旧端提交患者/医生/就诊快照，必须改为服务端就诊引用；文字/文件审核、内容安全、脱敏公开展示、撤回和管理端读取权限未确认 |
| `pagesB/health/` | `gift_health_praise.vue`、`list_health_praise.vue`、`record_health_praise.vue` | 待 provider contract | 表扬信提交、审核、脱敏公开展示、幂等、撤回、文件上传和管理端权限未确认 |
| `pagesB/user/` | `edit_profile.vue` | 普通资料子集已迁移 | 原生 `pages/profile` 已迁移昵称、性别、年龄、邮箱并使用版本并发；头像、实名、微信身份和患者绑定仍关闭；详见 [`user-profile-contract.md`](user-profile-contract.md) |
| `pagesB/user/` | `feedback.vue` | 部分迁移 | 原生端已迁移热点问题、咨询电话和安全的迁移提示；真实意见提交、客服工单和受控配置仍未开放 |
| `pagesB/user/` | `miss_appointment.vue` | 部分迁移 | 新端以预约历史读模型的 `status=missed` 派生只读页面，当前固定展示近 90 天并支持切换就诊人；真实 provider 状态、公网和真机证据仍待完成，不能使用客户端 `status=4` 或把未知状态推断为爽约 |
| `pagesB/user/` | `my_consultation.vue` | 待 provider contract | 需要 AI/陪诊会话索引、患者归属、内容保留和脱敏策略；账单/病历/住院预约/就诊码按钮当前只是 Toast |
| `pagesB/user/` | `my_registration.vue` | 部分迁移 | 新端已接入预约历史只读；取消、退号、支付状态和 provider 患者用途映射仍待验收 |
| `pagesB/user/` | `subscription_message.vue` | 待 provider contract | 旧端只维护本地开关且未调用微信授权 API；需确认模板 ID、用户授权时机、业务事件、发送结果和撤销状态 |

## 盘点结论

- 64 个旧页面中，当前可宣称“已替换或已形成安全子集”的是：首页、我的/患者选择部分、预约前置静态医院卡片、公众号说明、反馈帮助、预约只读部分、报告目录骨架、门诊费用目录、院内静态地图。
- 预约写入、费用/支付/医保、住院、健康内容/自测、风险评估、随访、便民投稿、AI、外部 web-view 和个人中心扩展都不能因为旧页面存在而直接迁移。
- 新 provider 文档到达后，应先从本矩阵选择一个状态为“待 provider contract”的域，完成 contract → adapter → domain → persistence → API → 小程序 → 日志 → 验收闭环；文档缺失的字段不得进入公共 contract。
