# 非支付业务迁移全量 TODO

更新时间：2026-09-16

## 审计范围与结论

本清单只覆盖旧服务中可以核对的非支付业务：小程序页面、患者中心、预约目录与非支付预约动作、报告、门诊/住院只读、健康内容、临床问卷、便民服务、智能导诊/陪诊、外部入口，以及后台运营能力。支付、医保、退费、收银台、账单支付和支付相关 HIS 回写不进入本清单，只保留为范围排除。

本轮使用的旧服务根目录是 /Users/yxswy/Documents/GitHub/hospital，新项目根目录是当前仓库。审计原则是：

- 旧源码中的页面和接口只是迁移输入事实，不自动等于新端应该照搬。
- 新端有页面、API、测试或 HTTP 200，不等于 Provider、数据库、微信、HIS、外部页面或真机业务已经完成。
- 只有旧服务确实有可执行行为，才建立迁移项；旧端自身是静态壳、本地假保存或 TODO 的功能，记录为“不应凭空实现”，不把它伪造成缺失的旧业务。
- 真正开放必须形成 contract → adapter → domain → persistence → API → 小程序 → 日志 → 真实验收闭环。

当前 TODO 复选框总数为 37 项，其中已完成 2 项、未完成 35 项。
另按标题优先级统计未完成项为：P0 3、P1 20、P2 9、P3 3。

## 当前机器事实

以旧仓库路径显式运行 pnpm migration:audit 的结果：

- 旧端实际页面 64 个；新端 app.json 已注册原生页面 47 个。
- 页面台账状态为 partial=34、replaced=10、surface-only=18、blocked-provider=0、blocked-external=1、excluded=1。
- 旧端 API 挂载路由 195 条，另有 1 个未挂载路由文件；旧客户端抽取到 87 个 endpoint literal。
- 旧客户端行为还包含 websocket=1、mini-program-navigation=6、web-view=3、payment-invocation=3、qr-and-official-account=6、insurance-callback=4。
- 当前不是“64 个页面都完成”，而是 64 个旧入口都在迁移台账中有落点；其中大量落点是安全子集或关闭态。

关键命令的当前结果：

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| LEGACY_HOSPITAL_ROOT=/Users/yxswy/Documents/GitHub/hospital pnpm migration:audit | 通过 | 证明旧页面和迁移矩阵逐项可对照，不证明业务验收 |
| pnpm migration:boundary:audit | 失败，5 条规则 | 陪诊 action 映射、报告 action-only 映射、生产源码冻结字段 |
| pnpm migration:fact:audit | 失败 | 发布覆盖文档仍写 43 个原生页面和旧 revision |
| pnpm --filter @hospital/miniprogram runtime:verify | 失败 | dist revision=751546da，当前源码期望=0cd711f9 |
| pnpm --filter @hospital/miniprogram runtime:verify:dev | 失败 | development runtime snapshot 不再匹配当前输入 |
| pnpm migration:breadth:audit | 通过 | 首页/我的入口结构通过，不代表服务全部可用 |
| pnpm miniprogram:navigation:audit | 通过 | 47 页面、4 主 Tab、38 个字面导航调用 |
| pnpm miniprogram:patient-display:audit | 通过 | 扫描 94 个页面源文件 |
| pnpm clinical:contract:audit | 通过但保持关闭 | 门诊记录、住院信息、电子导诊单仍 contract-pending |
| pnpm readonly:audit | 通过 | 6 个低风险业务域的结构闭环通过，不替代 Provider/真机证据 |
| pnpm todo:audit | 通过 | 本文件 37 项复选框及 P0/P1/P2/P3 统计已校验 |

仓库所有 pnpm 命令还报告 Node engine wanted 24.12.0、当前 v26.8.1。这是可复现性问题，不是业务已完成证据。

## 64 个旧页面逐项落点

机器事实源是 apps/miniprogram/src/services/legacy-page-catalog.ts:49-548；旧页面注册源是旧仓库 hospital-app/src/pages.json:53-96 及其 subPackages。下面把 64 个页面全部列出，并把支付项单独标为范围排除。

| 旧页面 | 当前落点和状态 | 代码证据 / 结论 |
| --- | --- | --- |
| pages/consult/consult.vue | pages/consult/consult，partial | 新端只有预约摘要；实时就诊/WebSocket 仍缺，见 apps/miniprogram/src/pages/consult/consult.ts:169-173,241-281 |
| pages/hospital/hospital.vue | pages/hospital/hospital，partial | 仅固定 HTTPS WebView，见 apps/miniprogram/src/pages/hospital/hospital.ts:1-31 |
| pages/index/index.vue | pages/index/index，replaced | 新首页已存在，未迁移能力仍由状态入口控制 |
| pages/setting/setData.vue | excluded | 旧端测试数据工具，不属于生产业务 |
| pages/user/user.vue | pages/my/my，partial | 我的页面拆为患者、资料、预约历史等安全子集 |
| pagesB/account/follow.vue | pages/official-account/official-account，replaced | 旧端实际主要是静态公众号说明，关注/二维码未形成可靠业务 |
| pagesB/health/admission_preconsultation.vue | pages/admission-preconsultation/admission-preconsultation，partial | 新端是关闭态外壳；旧端有问题配置和提交，旧源码见 hospital-app/src/pagesB/health/admission_preconsultation.vue:117-145,400-420 |
| pagesB/health/blood_pressure_calc.vue、pagesB/health/bmi_calc.vue | pages/health-test/health-test，partial | 新端只做 BMI 公式和血压读数校验，见 apps/miniprogram/src/pages/health-test/health-test.ts:39-43,88-124 |
| pagesB/health/discharge_followup.vue、pagesB/health/discharge_followup_detail.vue | pages/discharge-followup/discharge-followup，surface-only | 新端只注册临床外壳，见 apps/miniprogram/src/pages/discharge-followup/discharge-followup.ts:1-4；旧端有多套表单和提交，见 hospital-app/src/pagesB/health/discharge_followup_detail.vue:20-65,140-190 |
| pagesB/health/disease_detail.vue、pagesB/health/drug_detail.vue、pagesB/health/health_encyclopedia.vue、pagesB/health/search_result.vue | health-knowledge 原生页面，partial | 新端 API/版本/免责声明骨架存在；旧正文不能直接照搬，旧目录 API 见 hospital-app/src/api/modules/health.ts:79-179 |
| pagesB/health/electronic_bill.vue、pagesB/health/inpatient_payment.vue、pagesB/health/medical_insurance_pay.vue、pagesB/health/outpatient_pay.vue、pagesB/health/outpatient_pay_detail.vue、pagesB/health/payment_cashier.vue | 范围排除 | 全部属于费用/支付/医保/收银台，不在本次 TODO |
| pagesB/health/electronic_consultation.vue | pages/electronic-consultation/electronic-consultation，surface-only | 当前文件只有 clinical-entry-surface 注册，见 apps/miniprogram/src/pages/electronic-consultation/electronic-consultation.ts:1-4 |
| pagesB/health/electronic_record.vue | pages/medical-record/medical-record，partial | 新端只有近 30 天门诊摘要；旧端有 out-visit-records 和 out-emrs，见 hospital-app/src/api/modules/medicalRecord.ts:86-127 |
| pagesB/health/gift_electronic_banner.vue、pagesB/health/list_electronic_banner.vue、pagesB/health/record_electronic_banner.vue | pages/gift-banner/gift-banner，surface-only | 当前只显示患者上下文和公开记录关闭态；旧端真实提交/列表需要审核和文件规则 |
| pagesB/health/gift_health_praise.vue、pagesB/health/list_health_praise.vue、pagesB/health/record_health_praise.vue | pages/health-praise/health-praise，surface-only | 旧端存在表扬信提交和查询 API，见 hospital-app/src/pagesB/health/gift_health_praise.vue:147-151,231-271,333-391 及旧 API commendatoryLetter.ts:53-68 |
| pagesB/health/health_test.vue、pagesB/health/self_test_question.vue、pagesB/health/self_test_result.vue | pages/health-test/health-test，surface-only | 旧端使用题库和评分提交，见 hospital-app/src/pagesB/health/self_test_question.vue:30-43,107-126,176-200；新端 health-test 目前不是该题库 |
| pagesB/health/inpatient_center.vue | pages/inpatient-center/inpatient-center，surface-only | 当前只有外壳，见 apps/miniprogram/src/pages/inpatient-center/inpatient-center.ts:1-4；旧端实际查询住院患者，见 hospital-app/src/pagesB/health/inpatient_center.vue:365-439 |
| pagesB/health/pre_visit.vue | pages/pre-visit/pre-visit，surface-only | 旧端有硬编码问题和 saveBeforeVisitRecord 提交，见 hospital-app/src/pagesB/health/pre_visit.vue:89-141,276-291；新端只有外壳 |
| pagesB/health/record_electronic_banner.vue、pagesB/health/record_health_praise.vue | 分别归入上面的礼物/表扬信落点，surface-only | 列出原始页面，不能把记录空态当已完成查询 |
| pagesB/health/report_detail.vue、pagesB/health/report_query.vue | pages/report-detail、pages/report-directory，partial | 新端报告目录、详情和附件代理有代码；真实 LIS/PACS/ECG/PEIS 和资源授权仍待证据，见 apps/api/src/modules/reports/index.ts:43-118、apps/miniprogram/src/services/api-client.ts:3242-3345 |
| pagesB/health/risk_form_fall.vue、pagesB/health/risk_form_pain.vue、pagesB/health/risk_form_pressure.vue、pagesB/health/risk_self_evaluation.vue | pages/risk-evaluation/risk-evaluation，surface-only | 旧端有风险表单和 createRiskAssessment，见 hospital-app/src/pagesB/health/risk_form_fall.vue:256-300、hospital-app/src/api/modules/health.ts:205-316；新端只保留关闭态 |
| pagesB/health/webview.vue | pages/smart-customer/smart-customer，partial | 旧通用 WebView 支持 path、完整 url、旧 ticket，见 hospital-app/src/pagesB/health/webview.vue:14-83；新端只承载固定客服地址，见 apps/miniprogram/src/pages/smart-customer/smart-customer.ts:1-31 |
| pagesB/hospital/bloodAppointment.vue | pages/blood-appointment/blood-appointment，partial | 旧页面本身也是固定院区、硬编码患者、空项目和“预约功能开发中”，见 hospital-app/src/pagesB/hospital/bloodAppointment.vue:45-101；没有旧号源接口证据，不应凭空接 Provider |
| pagesB/hospital/confirm_registration.vue、pagesB/hospital/registration.vue、pagesB/hospital/department_select.vue、pagesB/hospital/doctor_card.vue、pagesB/hospital/hospitalList.vue、pagesB/hospital/navigation.vue、pagesB/hospital/registration_detail.vue、pagesB/hospital/timeslot_source.vue | appointment 原生页面，分别 partial/replaced | 预约目录、排班、号源、详情、取消已有新 API；医院/地图仅迁移旧静态行为。旧预约接口见 hospital-app/src/api/modules/appointment.ts:40-72,180-185,283-353,355-393,500-517 |
| pagesB/hospital/registration_medical_pay.vue | 范围排除 | 挂号医保支付属于支付/医保专项 |
| pagesB/hospital/selectPatient.vue | pages/patient-select/patient-select，replaced | 统一患者选择页已替换旧页面 |
| pagesB/patient/agreement.vue、pagesB/patient/doctor.vue、pagesB/patient/patientChange.vue | 协议静态页、我的医生、患者选择，replaced | 协议只读不等于同意；医生关系已有新 API；患者切换统一进入 owner-scoped 目录 |
| pagesB/patient/express.vue | pages/patient-express/patient-express，partial | 旧端列表永远为空且 TODO 查询，见 hospital-app/src/pagesB/patient/express.vue:55-85；新端明确不发物流请求，见 apps/miniprogram/src/pages/patient-express/patient-express.ts:40-47,84-134 |
| pagesB/patient/patient_signature.vue | pages/patient-signature/patient-signature，partial | 旧端使用硬编码患者和未知外部小程序，见 hospital-app/src/pagesB/patient/patient_signature.vue:96-128；新端只读患者并提示尚未开放，见 apps/miniprogram/src/pages/patient-signature/patient-signature.ts:57-61,132-142 |
| pagesB/patient/patientAdd.vue | pages/patient-binding/patient-binding，partial | 新端查档/建档/绑卡链路已有代码；旧端编辑模式仍是 TODO，见 hospital-app/src/pagesB/patient/patientAdd.vue:258-264 |
| pagesB/user/edit_profile.vue | pages/profile/profile，partial | 普通昵称/性别/年龄/邮箱已实现；头像、实名、微信身份不是普通资料 contract |
| pagesB/user/feedback.vue | pages/feedback/feedback，replaced | 旧端只有帮助、客服电话和静态行为，没有真实提交 API；不扩展为虚构工单 |
| pagesB/user/miss_appointment.vue | pages/missed-appointments/missed-appointments，partial | 新端由预约历史状态派生，仍待真实 Provider/公网/真机四方证据 |
| pagesB/user/my_consultation.vue | feature-status:consultation，blocked-external | 旧端依赖独立问诊/陪诊历史，不能改名为预约历史 |
| pagesB/user/my_registration.vue | pages/appointment-records/appointment-records，partial | 历史只读已有代码；支付/退款排除，取消和详情仍需真实验收 |
| pagesB/user/subscription_message.vue | pages/patient-subscription/patient-subscription，partial | 旧端只改内存后 Toast，见 hospital-app/src/pagesB/user/subscription_message.vue:203-214；新端明确固定 enabled=false，见 apps/miniprogram/src/pages/patient-subscription/patient-subscription.ts:68-71,184-187 |

## P0：先修正迁移事实、安全边界和运行包

### P0 迁移审计不能在没有旧仓库时静默通过

- [x] P0-01 修改 tools/migration-inventory-audit.mjs:66-80：LEGACY_HOSPITAL_ROOT 缺失或旧仓库不可读时，CI/发布审计必须明确失败或要求显式的“未提供旧仓库”结果，不能默认 Windows 路径 G:\fuck\hospital 后输出 skipped 并让整体流程看起来通过；在当前旧仓库路径重跑 64 页面、195 路由、87 endpoint 的全量对照。已补 tools/migration-inventory-audit.test.mjs，正向与反向验证均通过。

### P0 入口 gate 必须与实际导航和生产源码一致

- [x] P0-02 修复 pnpm migration:boundary:audit 的 5 条失败规则：陪诊入口改为 companion 状态 gate；报告详情的 report-cloud-image、report-share、report-follow-up 均绑定到真实页面事件，其中分享保持明确关闭态；boundary 审计同时校验 TS 方法和 WXML bindtap；移除生产源码中的冻结字段文字命中。已通过 boundary、breadth、navigation、typecheck 与小程序全量测试（414 pass、0 fail）。

### P0 发布事实文档不能继续引用旧候选

- [ ] P0-03 更新 docs/发布/广度优先页面覆盖-2026-08-25.md:1-10 以及引用同一数字的迁移就绪报告/旧页面矩阵：统一写入当前 64 个旧页面、47 个原生页面、partial=34、blocked-provider=0 和源码 revision 0cd711f9aff5c03ef256822b83552d2a795e27c7；以 pnpm migration:fact:audit 为门禁，禁止“入口覆盖”被写成“业务完成”。

### P0 DevTools 实际运行包必须和当前源码一致

- [ ] P0-04 在修改任何开放状态前，执行 pnpm --filter @hospital/miniprogram build:dev 和 release build，分别通过 runtime:verify:dev、runtime:verify；当前失败证据是 apps/miniprogram/scripts/verify-runtime.ts:271-302 报 development snapshot mismatch，以及 dist revision=751546da5db179a10cde7af3a83f92572f5f2ea4 与当前期望 revision 不一致。确认 project.config.json 继续指向 dist，并把构建 revision、pageCount=47、构建时间写入发布记录。

### P0 状态语义要统一为“安全子集/关闭态/待实证”

- [ ] P0-05 清理所有把页面壳、测试 fixture、Provider adapter 或静态页面描述成“已完成”的旧文档和状态文案；以 apps/miniprogram/src/services/legacy-page-catalog.ts:1-12、apps/miniprogram/src/services/feature-navigation.ts:154-157 为统一语义。每一个页面开放前都要补上实际请求、成功/空/拒绝/超时、归属、日志和真机证据，不能只删掉 feature-status 跳转。

## P1：优先迁移旧服务确实存在且新端尚未闭环的业务

### P1 患者身份和患者中心

- [ ] P1-01 完成患者绑定的真实环境验收，不重新设计功能：当前小程序已经从 apps/miniprogram/src/pages/patient-binding/patient-binding.ts:130-163 调用 bindPatientToHospital，API 在 apps/api/src/modules/patients/index.ts:31-96，服务端按查档→建档→绑卡→同步执行，见 apps/api/src/modules/patients/binding-service.ts:220-309 和 packages/adapters/src/zhongyang-patient-binding.ts:205-295。对照旧 ZY.ts:17-75，确认 birthDate/sex/cardType/院区配置、unionId 一致性、幂等重试、Provider 请求号、目录最终可见和失败补偿；未有真实响应时保持关闭。

- [ ] P1-02 补齐患者协议的真实同意、版本、撤回和审计 contract；旧端只有静态 agreement 页面，新端 apps/miniprogram/src/pages/patient-agreement/patient-agreement.ts:1-12 也明确不记录同意。只在确认患者绑定/实名业务确实需要时实现，不能把查看原文或勾选状态当作授权。

- [ ] P1-03 对照旧 patientAdd.vue:258-264 的编辑 TODO，决定是否存在旧服务真实的患者资料更新接口；若旧服务没有可执行更新行为，就关闭该迁移项并保留“新增绑定已实现、编辑不是旧能力”的记录；若业务确实需要，另立 owner-scoped patient update contract，不把 profile PUT 当患者资料更新。

### P1 预约目录和非支付预约动作

- [ ] P1-04 完成预约目录只读链路的 Provider 对照和真实验收：旧端 first-depts、scheduling-depts/doctors、schedulings、sources 见 hospital-app/src/api/modules/appointment.ts:40-72,180-185,283-353；新端路由见 apps/api/src/modules/appointments/index.ts:84-220、客户端见 apps/miniprogram/src/services/api-client.ts:2743-2783。逐项核对医院/科室/医生/日期/时段/余号、自然日和时区、空结果、停诊、快照 TTL、sourceSerialNumber 白名单和 Provider 原始 ID 不外泄。

- [ ] P1-05 完成非支付预约写入闭环：旧端 lockSources/createAppointment/cancelAppointment/record/detail 见 hospital-app/src/api/modules/appointment.ts:355-393,500-517；新端已有 POST /appointments/holds、/registrations、/registrations/:id/cancel，见 apps/api/src/modules/appointments/index.ts:100-160 和 apps/miniprogram/src/services/api-client.ts:2786-2831,3014-3066。只验收占位、预约写入、取消、详情和幂等/过期/冲突/Provider 未确定状态；支付、医保、退费、HIS 支付回写不在此项。

- [ ] P1-06 完成预约历史和爽约的真实状态对照：新端 my-registration/missed-appointments 读取 /appointments/records，见 apps/miniprogram/src/services/api-client.ts:2900-2911；旧端记录入口见 hospital-app/src/api/modules/appointment.ts:395-517。确认 online/all 范围、渠道 3/4、取消保留、unknown 不被推断成 missed，以及跨患者和会话切换隔离；没有 Provider 状态样例时不能用前端 status=4 代替。

- [ ] P1-07 完成我的医生关系迁移验收：旧服务把 MyDoctorRouter 挂在 app/api/v1/module_convenience/__init__.py:14-19，新端有 owner-scoped GET/POST/DELETE /my/doctors，见 apps/api/src/modules/my-doctors/index.ts:26-107 和客户端 apps/miniprogram/src/services/api-client.ts:2834-2878。核对旧存量 21 条关系的导入/不导入决定、医生目录失效、关注幂等、排班来源和真机结果；不把状态页文案当关系数据。

### P1 报告、病历和住院只读

- [ ] P1-08 完成报告目录、四类详情和附件的真实 Provider 验收：旧 LIS/PACS/ECG/PEIS、门诊报告解读调用见 hospital-app/src/api/modules/ZY.ts:80-163；新 API 只有受控 /reports、/reports/:reportId 和附件代理，见 apps/api/src/modules/reports/index.ts:43-118、apps/miniprogram/src/services/api-client.ts:3242-3345。分别核对患者归属、列表时间窗口、详情引用 TTL、LIS/PACS/ECG/PEIS 字段映射、云资源 allowlist、附件 content type/下载失败和报告原始号不外泄；真实 Provider 未验收前保持代码已实现/待实证。

- [ ] P1-09 将门诊病历从当前“近 30 天摘要”推进到旧服务确实存在的可授权范围：新端仅有 GET /medical-records，见 apps/api/src/modules/medical-records/index.ts:25-52 和 apps/miniprogram/src/pages/medical-record/medical-record.ts:91-188；旧端还有 out-visit-records、out-emrs，见 hospital-app/src/api/modules/medicalRecord.ts:86-127。先获取 EMR/就诊记录正式 contract、正文和附件授权，再实现目录→详情引用；不能复用报告数据或把摘要改名为完整病历。

- [ ] P1-10 实现住院信息独立 episode 只读链路（不含住院支付和日费用）：旧端确实调用 /msun-middle-aggregate-hsz/v1/patients，见 hospital-app/src/api/modules/medicalRecord.ts:129-241、hospital-app/src/pagesB/health/inpatient_center.vue:365-439；新端只有 apps/miniprogram/src/pages/inpatient-center/inpatient-center.ts:1-4 的关闭态。先确认住院 episode、patInHosId、在院状态、患者归属、脱敏字段和越权/空/拒绝/超时，再接 API；严禁复用门诊 patientId。

- [ ] P1-11 处理报告详情的云影像、分享、复诊三个实际未完成动作：旧端云影像下载与分享分别在 hospital-app/src/pagesB/health/report_detail.vue:365-402，分享明确是“待实现”；新端 feature status 仅有定义，见 apps/miniprogram/src/services/feature-navigation.ts:409-446。先根据旧服务确认是否有可迁移行为，再为短期资源、受众、脱敏、防重放、撤回、复诊关联建立独立 contract；不能自动从报告创建预约，也不能把图片 URL 或永久分享链接交给第三方。

### P1 健康内容与临床问卷

- [ ] P1-12 完成健康百科真实内容迁移，而不是先开放已有页面：旧库健康内容有 crowd=7、department=17、part=17、disease=8509、drug=1207、symptoms=5911，见 docs/迁移/健康内容与自测审计-2026-08-24.md:50-65；当前 hp_health_knowledge_publications/items 为 0，快照 publicationState=not-approved，见 docs/迁移/健康知识来源审计-2026-08-25.md:6-25。处理重复关系、115 个控制字符、knowledge_tips 未定义来源，生成独立审核 bundle，完成 bundle check、staging 导入、发布/撤回/重叠窗口演练和真机验收；当前 repository 只读取 published，见 packages/persistence/src/mysql-health-knowledge-repository.ts:305-345。

- [ ] P1-13 按旧服务真实行为迁移入院预问诊和预约前预问诊：旧端入院问卷及提交见 hospital-app/src/pagesB/health/admission_preconsultation.vue:117-145,400-420、hospital-app/src/api/modules/health.ts:389-438；预约前问卷及 saveBeforeVisitRecord 见 hospital-app/src/pagesB/health/pre_visit.vue:89-141,276-291、旧 API:181-203；新端两个页面目前都是 registerClinicalContentSurfacePage，见 apps/miniprogram/src/pages/admission-preconsultation/admission-preconsultation.ts:1-4 和 apps/miniprogram/src/pages/pre-visit/pre-visit.ts:1-4。需要版本化题目、预约/住院任务关联、患者授权、幂等、撤回、医护读取和敏感数据审计，未确认前不复制旧题目入小程序。

- [ ] P1-14 按旧服务真实行为迁移出院随访：旧端有多套表单和 createDischargeFollowUp，见 hospital-app/src/pagesB/health/discharge_followup_detail.vue:20-65,140-190、hospital-app/src/api/modules/health.ts:318-387；新端只有关闭态，见 apps/miniprogram/src/pages/discharge-followup/discharge-followup.ts:1-4。先定义出院事件、任务唯一性、表单版本、答案替换/撤回、幂等、医护端读取和敏感健康数据审计，不能按 user_id+pat_id 覆盖不同随访任务。

- [ ] P1-15 分开处理风险评估、自测题库和结果：旧风险表单提交 createRiskAssessment 见 hospital-app/src/pagesB/health/risk_form_fall.vue:256-300、旧 API:205-316；旧自测加载题目、提交答案和结果见 hospital-app/src/pagesB/health/self_test_question.vue:30-43,107-126,176-200；新端风险页和临床内容页都是关闭态。只有题目 ID、答案范围、评分/结果区间、适用人群、免责声明、版本撤回、历史解释和隐私保留都经过临床确认后，才能实现 API 和页面。

- [ ] P1-16 对 BMI/血压计算器做临床决策而非盲目照搬：旧矩阵明确指出旧 BMI 分类和血压阈值有版本差异，旧端规则不能自动升级为医学结论；新端只做 local-non-diagnostic-v1 的数值工具，见 apps/miniprogram/src/pages/health-test/health-test.ts:39-43,88-124 和 apps/miniprogram/src/services/health-safe-calculators.ts:1-6,21-29。若业务只需要参考计算，保留当前非诊断实现并补 golden cases/免责声明；若需要分级或建议，必须走独立临床规则 contract，禁止把计算结果存入病历、报告或风险记录。

### P1 便民服务和外部能力

- [ ] P1-17 对照旧电子锦旗和表扬信真实接口，决定是否迁移：旧服务路由明确包含 CommendatoryLetter/SilkBanner，见旧 app/api/v1/module_convenience/__init__.py:5-19；旧客户端有 create/list 和患者/医生/就诊快照入参，见 hospital-app/src/api/modules/commendatoryLetter.ts:1-68、hospital-app/src/pagesB/health/gift_health_praise.vue:333-391。新端只有 convenience surface，见 apps/miniprogram/src/pages/gift-banner/gift-banner.ts:1-4 和 apps/miniprogram/src/pages/health-praise/health-praise.ts:1-4。若继续迁移，必须改为服务端就诊引用，补文字/文件审核、公开脱敏、幂等、撤回和管理端权限；如果业务决定不迁移，删除开放入口并记录原因。

- [ ] P1-18 完成患者签名的外部主体和授权核对：旧端直接 navigateToMiniProgram，并把 patientId/patientName 放进 extraData，见 hospital-app/src/pagesB/patient/patient_signature.vue:104-128；新端只显示平台脱敏患者并在 apps/miniprogram/src/pages/patient-signature/patient-signature.ts:132-142 提示未开放。必须取得目标小程序主体、path、数据字段、短期会话、回跳、失败/撤回和审计协议后再实现，不能恢复硬编码 appId 或把内部患者标识外发。

- [ ] P1-19 恢复旧就诊页的实时能力前先冻结独立 contract：旧端今日就诊会连接 WebSocket、切换标签关闭连接、卸载时关闭，见 hospital-app/src/pages/consult/consult.vue:190-235,320-337,430-433 和 hospital-app/src/api/ws.ts:1-100；新端 apps/miniprogram/src/pages/consult/consult.ts:169-173,241-281 只有预约历史摘要。需确认队列/叫号事件、认证、患者映射、游标补偿、断线重连、保留周期、临床状态脱敏和真机证据；不能用预约摘要冒充实时就诊。

- [ ] P1-20 对照旧通用 WebView 的真实入口并完成外部边界：旧 pagesB/health/webview.vue 同时承载智能客服、outpatient-guide、患者绑定/解绑 URL 和 ticket，见 hospital-app/src/pagesB/health/webview.vue:26-83；新端智能导诊已经有原生文字/语音 API，见 apps/miniprogram/src/pages/smart-guide/smart-guide.ts:176-237、apps/api/src/modules/intelligent-guide/index.ts:46-97，客服/互联网医院只保留固定地址，见 apps/miniprogram/src/pages/smart-customer/smart-customer.ts:1-31、hospital.ts:1-31。按 audience 分开做域名 allowlist、短期会话、回跳/退出、失败和真机验收；不恢复万能 URL、旧 ticket 或向 H5 传平台 token。

## P2：补齐“旧端本来没有”或工程上仍缺失的边界决策

### P2 不把旧端占位误写成待迁移业务

- [ ] P2-01 对 patient-express 做结论性收口：旧端只有本地 BOUND_PATIENTS/CURRENT_PATIENT、固定假患者和空数组，查询位置是 TODO，见 hospital-app/src/pagesB/patient/express.vue:55-85；新端对此已正确保持不发请求。除非业务方提供真实物流 Provider、患者归属、状态字段和保留策略，否则不要实现快递接口；拿到材料后再从 status-only 改为真实只读。

- [ ] P2-02 对 patient-subscription 做产品决策：旧端“确定修改”只 Toast 并返回，没有微信订阅授权或服务端保存，见 hospital-app/src/pagesB/user/subscription_message.vue:203-214；新端 enabled 固定 false 是正确防伪。只有拿到模板 ID、授权时机、业务事件、发送回执、撤销状态和 owner 规则后才新建 contract，否则将其标记为旧端假功能而非迁移缺口。

- [ ] P2-03 清理 patient-address 的迁移假象：当前 FeatureKey 在 apps/miniprogram/src/services/feature-navigation.ts:21-25、migration-coverage.ts:126-130 中存在，但旧 64 页面和旧 action inventory 中没有 patient-address；旧仓库也没有患者地址管理 API/页面。应从“旧服务迁移 TODO”中删除或明确标为未来新需求，不得因为有 FeatureKey 就实现地址业务。

- [ ] P2-04 对 bloodAppointment 做同样的事实收口：旧页只有硬编码患者、固定院区、空态和“功能开发中”，见 hospital-app/src/pagesB/hospital/bloodAppointment.vue:45-101；当前页也只读取患者并进入状态页，见 apps/miniprogram/src/pages/blood-appointment/blood-appointment.ts:103-150。没有旧 Provider 号源/预约行为时不凭空实现；如果医院确有采血业务，另行取得业务来源和 contract。

### P2 工程和数据连续性

- [ ] P2-05 补齐非支付旧数据连续性方案：当前数据切换决策是新库冷启动，不自动导入旧用户、患者关系、预约存量、便民历史或健康知识历史，见 docs/迁移/数据切换决策-2026-08-31.md:7-26；对照旧服务和当前 hp_* 表逐域决定导入、只读兼容、人工复核或不迁移，至少覆盖患者关系、我的医生历史、报告引用、便民历史和已完成健康内容。没有数据指纹、数量和回滚记录，不要把冷启动写成完成迁移。

- [ ] P2-06 给已存在代码的低风险域补真实证据包：患者目录、普通资料、预约目录/历史、我的医生、报告目录、门诊摘要目前都有 TypeScript/API/测试落点，但 apps/api/src/index.ts:92-118,186-295 明确按配置状态 fail-closed。每个域保存同一候选版本的客户端 requestId、服务端 requestId/traceId、Provider 结果摘要、空/拒绝/超时、会话切换和真机截图；没有证据时状态只能是代码已实现/待实证。

- [ ] P2-07 固定 Node/Bun/pnpm 运行环境并补发布复现记录：package engine 要求 Node 24.12.0，而本轮是 v26.8.1；统一 CI、开发者工具构建和发布机版本，记录 build:dev/release、app.json pageCount、source revision、dist hash 和 runtime verify 输出，避免源码和 DevTools dist 再次分离。

- [ ] P2-08 为 94 个小程序页面源文件建立按业务域的真机回归矩阵：结构审计已通过不等于页面业务完成。至少覆盖登录/退出、无患者、换患者、会话失效、Provider 503、空列表、超时、页面返回和 dist 实际加载；临床、外部、患者绑定、报告附件必须另存受控证据，不把控制台内部错误栈当业务结果。

- [ ] P2-09 处理健康知识中未定义的 knowledge_tips：旧快照审计把它列为未定义来源，见 docs/迁移/健康知识来源审计-2026-08-25.md:57-80；当前新 API 只建 part/crowd/department/symptom/disease/drug 版本化读模型。先确认它是否属于业务范围并取得来源/审核责任，不能塞入疾病正文、药品说明或通用提示字段后宣称健康内容已迁移。

## P3：后台运营和长期维护

### P3 后台能力不能只看患者小程序

- [ ] P3-01 做旧后台系统管理域的迁移决策和实现排期：旧 FastAPI 总路由把 system、monitor、common、application、convenience、intelligent、knowledge 全部挂载，见旧仓库 app/api/v1/__init__.py:5-35；system 还包含 auth/user/role/menu/dept/position/dict/params/notice/log，见旧 app/api/v1/module_system/__init__.py:3-26。当前 apps/api/src/modules/system/index.ts:1-14 只有 ping，apps/admin/src/server.ts:572-624 只有 captcha/login/logout、1101 和日志接口。需逐模块决定哪些服务继续由旧后台承担、哪些迁移到新 API/管理端、哪些废弃；不要把当前日志页面称为旧后台已迁移。

- [ ] P3-02 补齐后台监控、任务、文件和便民运营闭环，或形成明确不迁移记录：旧 monitor 有 cache/online/server/resource，application 有 job，common 有 file，convenience 有锦旗、表扬信、风险、随访和我的医生管理路由；当前 apps/admin/src 只有 App.tsx、LogPanel.tsx、api.ts、insurance.ts、raw-logs.ts、server.ts、types.ts。对于仍在生产使用的模块，补 RBAC、审计、列表/详情/处理状态和失败重试；不再使用的模块要有下线和数据保留说明。

- [ ] P3-03 建立迁移清单和实际代码的持续一致性门禁：将 migration:audit、migration:boundary:audit、migration:fact:audit、runtime:verify、clinical:contract:audit、readonly:audit、miniprogram-patient-display-audit 纳入同一 CI 报告；每次页面、FeatureKey、旧接口矩阵或 dist 变化都必须更新来源 revision、旧页面状态和未验证项，保留“代码完成、运行环境、Provider、真机、生产接受”五类状态。

## 已确认不作为本次 TODO 的事项

- 支付、医保、退费、收银台、门诊/住院支付、支付订单、微信支付/医保回写和支付相关 HIS 证据全部排除，避免与本次非支付迁移混账。
- pages/setting/setData.vue 是旧测试数据页，明确 excluded。
- 旧 hospitalList.vue 和 navigation.vue 目前证据只支持单院区静态卡片、静态地图、预览；新端的静态替换已完成。动态医院、院区、路线、楼层定位若将来需要，必须另立新业务 contract，不能写成旧迁移遗漏。
- 旧 feedback.vue 没有真实提交 API；当前静态帮助/拨号替换满足旧的可执行行为，不新造客服工单。
- 旧 express.vue 是空列表预留，不存在可迁移的物流查询实现。
- 旧 subscription_message.vue 是本地假保存，不存在可迁移的微信订阅链路。
- patient-address 在旧 64 页面和 action 清单中没有来源，不属于旧服务迁移。
- 旧 my_consultation.vue 的演示/外部问诊入口不能用预约历史顶替；在外部主体、归属、会话和保留规则确认前维持关闭。

## 每项完成标准

完成任一 TODO 时，必须在对应项下补充：旧源码行为和新源码落点；contract/字段白名单/版本；请求与响应样例的受控存放位置；服务端和 Provider requestId/traceId；成功、空、拒绝、超时、会话切换和越权结果；小程序 dist/runtime 校验；真机或生产验收结论；未验证项和回滚方式。不得只把页面打开、单元测试通过或 HTTP 200 写成业务完成。

本文件是当前审计快照，不替代旧页面矩阵、Provider 合同、临床审核、发布证据或生产验收记录；这些材料更新后必须重新运行相应门禁并更新本文件。
