# 非支付业务迁移全量 TODO

更新时间：2026-09-16

## 审计范围与结论

本清单只覆盖旧服务中可以核对的非支付业务：小程序页面、患者中心、预约目录与非支付预约动作、报告、门诊/住院只读、健康内容、临床问卷、便民服务、智能导诊/陪诊、外部入口，以及后台运营能力。支付、医保、退费、收银台、账单支付和支付相关 HIS 回写不进入本清单，只保留为范围排除。

本轮使用的旧服务根目录是 /Users/yxswy/Documents/GitHub/hospital，新项目根目录是当前仓库。审计原则是：

- 旧源码中的页面和接口只是迁移输入事实，不自动等于新端应该照搬。
- 新端有页面、API、测试或 HTTP 200，不等于 Provider、数据库、微信、HIS、外部页面或真机业务已经完成。
- 只有旧服务确实有可执行行为，才建立迁移项；旧端自身是静态壳、本地假保存或 TODO 的功能，记录为“不应凭空实现”，不把它伪造成缺失的旧业务。
- 真正开放必须形成 contract → adapter → domain → persistence → API → 小程序 → 日志 → 真实验收闭环。

当前 TODO 复选框总数为 37 项，其中已完成 16 项、未完成 21 项。
另按标题优先级统计未完成项为：P0 0、P1 18、P2 1、P3 2。

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
| pnpm migration:boundary:audit | 通过 | 33 个冻结入口、陪诊/报告 action 事件绑定和生产源码边界均通过 |
| pnpm migration:fact:audit | 通过 | 当前文档事实已同步 64/47、partial=34、blocked-provider=0 和当前源码输入 revision |
| Node 24.12.0 显式环境下 `pnpm toolchain:audit`、小程序 build/runtime verify | 通过 | Bun=1.4.0、Node=24.12.0、pnpm=11.9.0；release sourceRevision=`cba13c71a74022b756144b9c7a61965cd542b1af`、development source 为当前工作树快照、两者 pageCount=47；详见 [`工具链复现记录-2026-09-16.md`](docs/发布/工具链复现记录-2026-09-16.md) |
| pnpm migration:breadth:audit | 通过 | 首页/我的入口结构通过，不代表服务全部可用 |
| pnpm miniprogram:navigation:audit | 通过 | 47 页面、4 主 Tab、37 个字面导航调用 |
| pnpm miniprogram:patient-display:audit | 通过 | 扫描 94 个页面源文件 |
| pnpm clinical:contract:audit | 通过但保持关闭 | 门诊记录、住院信息、电子导诊单仍 contract-pending |
| pnpm readonly:audit | 通过 | 6 个低风险业务域的结构闭环通过，不替代 Provider/真机证据 |
| pnpm todo:audit | 通过 | 本文件 37 项复选框及 P0/P1/P2/P3 统计已校验；已完成 16、未完成 21；P0 已清零 |

默认 shell 下的 pnpm 命令仍报告 Node engine wanted 24.12.0、当前 v26.8.1；本轮已用显式 Node 24.12.0 完成工具链和小程序运行包复现。外部 Provider、DevTools、真机和生产证据仍不因本地复现而成立。

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

- [x] P0-02 修复 pnpm migration:boundary:audit 的 5 条失败规则：陪诊入口改为 companion 状态 gate；报告详情的 report-cloud-image、report-share、report-follow-up 均绑定到真实页面事件，其中分享保持明确关闭态；boundary 审计同时校验 TS 方法和 WXML bindtap；移除生产源码中的冻结字段文字命中。已通过 boundary、breadth、navigation、typecheck 与小程序全量测试（416 pass、0 fail）。

### P0 发布事实文档不能继续引用旧候选

- [x] P0-03 更新 docs/发布/广度优先页面覆盖-2026-08-25.md:1-10 以及引用同一数字的迁移就绪报告/旧页面矩阵：统一写入当前 64 个旧页面、47 个原生页面、partial=34、blocked-provider=0 和源码 revision 82d5e4213c4a419eb49420f244b377990adfec5e；`pnpm migration:fact:audit` 已通过，入口覆盖仍明确不等于业务完成。

### P0 DevTools 实际运行包必须和当前源码一致

- [x] P0-04 在修改任何开放状态前，执行 pnpm --filter @hospital/miniprogram build:dev 和 release build，分别通过 runtime:verify:dev、runtime:verify；本次预约历史标签范围修正后 development 与 release 均重新生成并校验 47 页运行包，release sourceRevision=`82d5e4213c4a419eb49420f244b377990adfec5e`、generatedAt=`2026-09-15T18:11:51.048Z`，development snapshot=`workspace-sha256:218cf023e2f58e438619c2152a4fd18757faa2e0a0d9212d0672002d1ff96986`、baseSourceRevision=`82d5e4213c4a419eb49420f244b377990adfec5e`；确认 project.config.json 继续指向 dist/。

### P0 状态语义要统一为“安全子集/关闭态/待实证”

- [x] P0-05 清理所有把页面壳、测试 fixture、Provider adapter 或静态页面描述成“已完成”的旧文档和状态文案；以 apps/miniprogram/src/services/legacy-page-catalog.ts:1-12、apps/miniprogram/src/services/feature-navigation.ts:154-157 为统一语义。当前统一目录已移除 `已迁移`/`读写已实现`/`全量替换进行中` completion readiness，状态页改为“代码已具备，待实证/安全子集/明确 contract 阻塞”；原生页面台账改为“安全静态子集/只读代码已具备，待实证/读写代码已具备，待实证/页面外壳与关闭态”；`replaced` 机器状态明确只代表原生落点，不代表业务完成。已同步 boundary、coverage、测试 fixture 与迁移文档，并通过 416 项小程序回归、typecheck、boundary、breadth、navigation、catalog 和 diff check。实际请求、成功/空/拒绝/超时、归属、日志、Provider、公网、真机证据仍是后续 P1 放行条件，未因本项放开任何业务；支付保持独立关闭。

## P1：优先迁移旧服务确实存在且新端尚未闭环的业务

### P1 患者身份和患者中心

- [ ] P1-01 完成患者绑定的真实环境验收，不重新设计功能：当前小程序已经从 apps/miniprogram/src/pages/patient-binding/patient-binding.ts:130-163 调用 bindPatientToHospital，API 在 apps/api/src/modules/patients/index.ts:31-96，服务端按查档→建档→绑卡→同步执行，见 apps/api/src/modules/patients/binding-service.ts:220-309 和 packages/adapters/src/zhongyang-patient-binding.ts:205-295。对照旧服务 `hospital-app/src/api/modules/ZY.ts:17-75`、`hospital-app/src/pagesB/patient/patientAdd.vue:81-111,199-256` 已静态确认：身份证派生 birthDate/sex 与旧逻辑一致；新端不再照搬旧端“查档异常即建档”、固定 `cardType=3` 或“身份证号当 cardNo”，而是要求 provider 返回真实 `cardNo`，并保持服务端 owner 隔离、幂等键、查档/建档/绑卡 requestId 和目录同步。新增 fail-closed 规则见 `packages/config/src/index.ts:568-603`：患者绑定还必须配置 HTTPS `LEGACY_PATIENT_AUTH_BASE_URL`，以旧服务用户 JWT/unionId 证明当前 owner，不能用静态众阳 token 代替。2026-09-16 又补齐了绑卡成功后“首次目录确认失败”的安全重试，见 `apps/api/src/modules/patients/binding-service.ts:183-220` 及其测试；重试只读目录，不重复建档/绑卡。本次二次验证记录在 `docs/迁移/患者绑定真实验收复核-2026-09-16.md`，并重新执行绑定服务/Provider adapter 7 项测试（7 pass、0 fail）。当前仍缺当前机构 cardType 字典值、2.1.52 患者自助授权、查档无记录/重复/超时、建档后绑卡失败补偿/最终查询及真实 Provider/真机响应；因此此项保持未完成和关闭。

- [ ] P1-02 补齐患者协议的真实同意、版本、撤回和审计 contract；旧端只有静态 agreement 页面，新端 apps/miniprogram/src/pages/patient-agreement/patient-agreement.ts:1-12 也明确不记录同意。二次对照复核见 `docs/迁移/患者协议同意对照复核-2026-09-16.md`：绑定页的布尔 `consent` 只是当前请求准入字段，不能替代版本化同意记录。只在确认患者绑定/实名业务确实需要时实现，不能把查看原文或勾选状态当作授权。

- [x] P1-03 对照旧服务 `hospital-app/src/pagesB/patient/patientAdd.vue:258-264` 的编辑 TODO、`hospital-app/src/api/modules/ZY.ts:17-75` 的患者接口和 `hospital-app/src/api/modules/user.ts:113-135` 的普通用户资料 PUT，确认旧服务没有患者资料更新/编辑 API：编辑入口只改标题，回填和保存明确是 TODO；因此关闭“迁移旧编辑功能”这一项，不新增患者 update contract，也不把 profile PUT 当患者资料更新。结论已记录在 `docs/迁移/患者绑定契约草案.md` 的“编辑模式”审计补充中；患者新增/绑卡真实验收仍由 P1-01 单独负责。

### P1 预约目录和非支付预约动作

- [ ] P1-04 完成预约目录只读链路的 Provider 对照和真实验收（静态二次审计见 [`预约目录只读对照审计-2026-09-16.md`](docs/迁移/预约目录只读对照审计-2026-09-16.md)，二次验证见 [`预约目录真实验收复核-2026-09-16.md`](docs/迁移/预约目录真实验收复核-2026-09-16.md)）：旧端 `first-depts`、`scheduling-depts`、`scheduling-doctors`、`schedulings`、排班详情和 `sources` 的接口定义见 `hospital-app/src/api/modules/appointment.ts:40-72,75-185,188-353`；实际页面调用见 `hospital-app/src/pagesB/hospital/registration.vue:135-147,186-212`、`department_select.vue:440-458,555-572`、`doctor_card.vue:278-301`、`timeslot_source.vue:98-153`。当前新端路由见 `apps/api/src/modules/appointments/index.ts:84-98,162-232`，adapter 见 `packages/adapters/src/zhongyang-appointments.ts:31-45,1048-1254`，小程序目录/排班/号源页见 `apps/miniprogram/src/pages/appointment-directory/appointment-directory.ts:87-185`、`appointment-schedule.ts:151-348`、`timeslot-source.ts:24-99`。静态代码已核对服务端日期、`Asia/Shanghai`、空结果 fail-closed、60 秒快照 TTL、`usableSourceNum`、时段白名单和 Provider ID 不外泄；但发现旧运行时后续排班/医生/号源请求实际传 `requestChannel=4`，当前新 adapter/Provider 契约文档固定 `3`，且新端用 `/schedulings` 派生医生卡片、未表达旧 `scheduleStatus`，这些都必须用当前 Provider 请求/响应确认，不能自行改渠道或猜停诊语义。本次隔离执行 adapter/service 54 项测试（54 pass、0 fail），但仍缺当前候选版本的 Provider/公网/开发者工具/真机只读证据，故保持未完成。

- [ ] P1-05 完成非支付预约写入闭环（静态边界审计见 [`预约写入非支付边界审计-2026-09-16.md`](docs/迁移/预约写入非支付边界审计-2026-09-16.md)，二次验证见 [`预约写入二次验证-2026-09-16.md`](docs/迁移/预约写入二次验证-2026-09-16.md)）：旧端锁号接口声明、费用/执行预约/取消/记录/详情见 `hospital-app/src/api/modules/appointment.ts:355-393,395-517`，实际确认页提交 Provider 患者号、身份、金额、排班号和号源号见 `hospital-app/src/pagesB/hospital/confirm_registration.vue:199-215,237-272`，旧详情取消见 `registration_detail.vue:380-423`；本次检索未发现旧页面实际调用 `lockSourcesApi`。新端已有 POST `/appointments/holds`、`/registrations`、`/registrations/:id/cancel` 和详情 GET，见 `apps/api/src/modules/appointments/index.ts:100-160,234-255`、`apps/miniprogram/src/services/api-client.ts:2786-2831,3014-3066`，服务层/adapter/持久化见 `apps/api/src/modules/appointments/write-service.ts:343-838`、`packages/adapters/src/zhongyang-appointment-writes.ts:448-842`、`packages/persistence/migrations/0024_appointment_writes.sql:1-55`。静态代码已核对 owner/患者/opaque 引用/幂等/过期/条件更新和 Provider ID 不外泄；但 `hold` 必经未确认 `registerSource` 的实际费用合同，旧费用请求实际传渠道 4 而新写入 adapter 固定渠道 3，锁号 TTL/释放、Provider 超时最终状态、重复预约匹配范围均缺当前证据；本次复核还确认现有写入测试仅 1 项且没有独立 adapter 测试。故不修改渠道、不猜字段、不打开 gate，保持未完成；支付、医保、退费、HIS 支付回写不在此项。

- [ ] P1-06 完成预约历史和爽约的真实状态对照（静态二次审计见 [`预约历史与爽约记录对照审计-2026-09-16.md`](docs/迁移/预约历史与爽约记录对照审计-2026-09-16.md)，二次验证见 [`预约历史爽约二次验证-2026-09-16.md`](docs/迁移/预约历史爽约二次验证-2026-09-16.md)）：新端 my-registration/missed-appointments 读取 `/appointments/records`，见 `apps/miniprogram/src/services/api-client.ts:2900-2911`、`apps/miniprogram/src/pages/appointment-records/appointment-records.ts:213-318,367-393`、`apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts:106-236`；旧端记录入口与真实标签请求见 `hospital-app/src/api/modules/appointment.ts:395-517`、`hospital-app/src/pagesB/user/my_registration.vue:186-220`、`hospital-app/src/pagesB/user/miss_appointment.vue:208-233`。本轮已修正新端此前两个标签固定 `scope=all` 的偏差，当前按旧语义选择 `online/all`，并确认取消保留、`unknown` 不推断为 `missed`、跨患者/会话守卫的静态实现；本次复核又通过预约 adapter/service 54 项测试和小程序历史/爽约 5 项验收测试，但旧端前后各三个月与新端前后 90 天、旧爽约无日期与新端过去 90 天的窗口差异，以及 Provider 状态样例、当前候选版本公网/DevTools/真机/生产证据仍未完成，故保持未勾选。

- [ ] P1-07 完成我的医生关系迁移验收（静态对照见 [`我的医生关系对照审计-2026-09-16.md`](docs/迁移/我的医生关系对照审计-2026-09-16.md)，二次验证见 [`我的医生关系二次验证-2026-09-16.md`](docs/迁移/我的医生关系二次验证-2026-09-16.md)）：旧服务在 `app/api/v1/module_convenience/__init__.py:5-19` 挂载 `MyDoctorRouter`，真实路由/输入/客户端快照行为见旧仓库 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/my_doctor/controller.py:17-63`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/user.ts:38-110` 和 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/hospital/doctor_card.vue:278-306,364-449`；新端 owner-scoped GET/POST/DELETE `/my/doctors` 见 `apps/api/src/modules/my-doctors/index.ts:26-107`、客户端见 `apps/miniprogram/src/services/api-client.ts:2834-2881`。当前静态代码已拒绝旧 `user_id`/医生快照并由未来 7 日排班目录确认字段，本次关系服务 5 项测试与小程序医生页验收均通过；但旧库存 21 条关系的 owner 映射/不导入决定、关系和医生目录失效规则、旧实际 channel=4 与新 adapter channel=3 的 Provider 对照、空/拒绝/超时、公网/DevTools/真机/生产证据仍缺；不把状态页文案、单元测试或运行包元数据当业务完成。

### P1 报告、病历和住院只读

- [ ] P1-08 完成报告目录、四类详情和附件的真实 Provider 验收（静态二次对照见 [`报告目录详情附件对照审计-2026-09-16.md`](docs/迁移/报告目录详情附件对照审计-2026-09-16.md)，二次验证见 [`报告能力二次验证-2026-09-16.md`](docs/迁移/报告能力二次验证-2026-09-16.md)）：旧服务真实调用和未完成分支见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/ZY.ts:80-163`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/report_query.vue:400-482,539-646`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/report_detail.vue:365-464`；新端受控 `/reports`、详情和附件代理见 `apps/api/src/modules/reports/index.ts:43-118`、`apps/api/src/modules/reports/service.ts:676-997`、`apps/miniprogram/src/services/api-client.ts:3242-3385`。当前静态代码已具备 owner/patient 隔离、四类候选字段映射、短期 opaque 引用和附件 origin/MIME/20 MiB 边界，本次报告 adapter/service 51 项测试和小程序报告目录/详情 11 项测试均通过；但旧端只有 LIS 详情实际调用，PACS/ECG/PEIS 详情依赖旧快照或明确待完善；四类 Provider 正式合同、PEIS 身份授权、endDate/分页、详情关联、资源 TTL/allowlist、附件 content type/失败、当前公网/DevTools/真机/生产同链证据均缺失，两个 report gate 继续为 false。不得将页面可进入、本地 fixture、空列表、HTTP 200 或运行包元数据写成完成，也不得顺手开放报告解读、分享或自动复诊。

- [ ] P1-09 将门诊病历从当前“近 30 天摘要”推进到旧服务确实存在的可授权范围（静态二次对照见 [`门诊病历目录对照审计-2026-09-16.md`](docs/迁移/门诊病历目录对照审计-2026-09-16.md)，二次验证见 [`门诊病历二次验证-2026-09-16.md`](docs/迁移/门诊病历二次验证-2026-09-16.md)）：旧页面实际只调用 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/electronic_record.vue:87-113` 和 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/ZY.ts:124-130`；`out-emrs` 仅在 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/medicalRecord.ts:112-127` 声明，未发现门诊页面实际调用。新端摘要链路见 `apps/api/src/modules/medical-records/index.ts:18-52`、`apps/api/src/modules/medical-records/service.ts:51-189`、`packages/adapters/src/zhongyang-medical-records.ts:16-229`、`apps/miniprogram/src/pages/medical-record/medical-record.ts:91-220`，当前 `ZHONGYANG_MEDICAL_RECORDS_READY=false`。本轮仅收口 adapter 对异常可选展示字段的 fail-closed 回归，并重新执行 adapter/service 6 项及小程序 4 项测试；摘要目录的 Provider 正式 contract、患者映射、公网/DevTools/真机/生产同链证据仍缺，正文、结构化内容和附件没有旧页面实际调用/授权依据，不实现、不复用报告数据、不把摘要改名为完整病历。

- [ ] P1-10 实现住院信息独立 episode 只读链路（不含住院支付和日费用；静态二次对照见 [`住院episode对照审计-2026-09-16.md`](docs/迁移/住院episode对照审计-2026-09-16.md)，二次验证见 [`住院episode二次验证-2026-09-16.md`](docs/迁移/住院episode二次验证-2026-09-16.md)）：旧 API 仅声明 `GET /msun-middle-aggregate-hsz/v1/patients?patId=...` 和包含 `patInHosId`、状态、病区、床位、医护、诊断、婴儿及身份证/卡号等字段的开放类型，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/medicalRecord.ts:129-241`；旧页面选择器实际只取 `payload.patient.patId` 查询并按数组直接渲染，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/inpatient_center.vue:66-238,396-439`，还把第一条 `patInHosId` 交给后续日费用逻辑（该逻辑不在本项）。新端只有 `apps/miniprogram/src/pages/inpatient-center/inpatient-center.ts:1-4` 和统一关闭态，无 inpatient API/adapter/domain/persistence；本次复核通过临床契约门禁和 8 项临床/患者上下文验收测试，仍缺 Provider contract、owner 映射、episode 多记录/状态规则、脱敏字段、越权/空/拒绝/超时/字段异常和同版本运行证据；保持未完成和关闭。严禁复用门诊 patientId、接受小程序提交 `patId/patInHosId` 或以本项解锁住院支付。

- [ ] P1-11 处理报告详情的云影像、分享、复诊三个实际未完成动作（静态二次对照见 [`报告详情云影像分享复诊对照审计-2026-09-16.md`](docs/迁移/报告详情云影像分享复诊对照审计-2026-09-16.md)，二次验证见 [`报告详情动作二次验证-2026-09-16.md`](docs/迁移/报告详情动作二次验证-2026-09-16.md)）：旧端云影像实际从报告对象取 `reportImgPath/reportPdfPath/pdfUrl` 后直接 `proxyForward`、下载并保存，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/report_detail.vue:34-51,365-396`，但无资源来源、授权、TTL、Content-Type 或审计 contract；分享函数只是 `showToast("分享功能待实现")`，见同文件 `:398-402`；复诊函数只跳 `/pages/consult/consult`，不携带 report/patient 关联，见同文件 `:184-197,404-409`。新端已具备 owner/patient/session 校验和服务端短期附件代理，见 `apps/miniprogram/src/pages/report-detail/report-detail.ts:96-150,280-368`、`apps/api/src/modules/reports/index.ts:43-73`、`apps/api/src/modules/reports/service.ts:848-997`，本次复核通过报告 adapter/service 51 项测试和小程序报告详情/附件 11 项测试，但云影像真实 Provider 资源映射、公网/DevTools/真机/生产同链证据仍缺；分享保持 feature status 关闭，见 `apps/miniprogram/src/services/feature-navigation.ts:428-434`；复诊仅跳通用预约目录，不自动创建预约，见 `apps/miniprogram/src/pages/report-detail/report-detail.ts:364-368`，不能标为报告复诊已迁移。先冻结资源 allowlist/短期引用、分享受众/脱敏/TTL/防重放/撤回、复诊目标/患者上下文/预约关系 contract，再验收真实链路；不能外发任意图片 URL 或永久分享链接。

### P1 健康内容与临床问卷

- [ ] P1-12 完成健康百科真实内容迁移，而不是先开放已有页面（静态二次验证见 [`健康百科迁移放行审计-2026-09-16.md`](docs/迁移/健康百科迁移放行审计-2026-09-16.md)，本轮复核见 [`健康百科内容放行二次验证-2026-09-16.md`](docs/迁移/健康百科内容放行二次验证-2026-09-16.md)）：旧 Python 服务真实挂载 `/knowledge/health/*` 目录、症状查病、疾病详情和药品详情，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_knowledge/health/controller.py:15-203`；旧小程序实际调用见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/health_encyclopedia.vue:241-247,280-429`、`search_result.vue:396,834-868`、`disease_detail.vue:172-210`、`drug_detail.vue:129-162`。当前源快照复核仍为 `sourceValid=true`、`publicationState=not-approved`、`publishable=false`，内容 15,668 条，质量告警仍为重复关系 6、控制字符 115、清理字段 10、未定义旧来源 1；严格审计按预期失败。新端 API、bundle validator、bundle check、staging 单事务导入和 published-only repository 的 22 项导入/持久化测试、9 项 API 测试均通过，但独立审核 bundle、内容责任/临床审核、staging 发布/撤回/重叠窗口和 Provider/公网/DevTools/真机同链证据仍缺，患者端继续 fail-closed；不得复制旧快照为 published，也不得把 `knowledge_tips` 混入百科。

- [ ] P1-13 按旧服务真实行为迁移入院预问诊和预约前预问诊（静态二次对照见 [`预问诊迁移边界审计-2026-09-16.md`](docs/迁移/预问诊迁移边界审计-2026-09-16.md)，二次验证见 [`问诊问卷二次验证-2026-09-16.md`](docs/迁移/问诊问卷二次验证-2026-09-16.md)）：旧端入院问卷真实包含 10 个健康史问题，按缓存 `user_id/pat_id` 组装 `content[]` 提交，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/admission_preconsultation.vue:128-203,265-288,340-404`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:389-438`；旧 Python 服务 `/admission-preconsultation` 强制当前用户过滤，并按 `user_id + pat_id` 存在则覆盖、否则新增，模型只有 `user_id/pat_id/content`，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/admission_preconsultation/controller.py:17-48`、`service.py:15-65`、`model.py:9-17`，没有住院事件、问卷版本、撤回或幂等事实。预约前问卷旧端有 6 个自由文本/选择题，使用 `medicalCardNumber/registerId/hospitalId` 调用外部 `POST /msun-hzzn-app-config/v1/saveBeforeVisitRecord`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/pre_visit.vue:80-130,136-167,194-293`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:181-203`；旧 Python 仓库未发现该外部接口实现、版本化题库或成功/超时最终状态。新端两个页面只有 `registerClinicalContentSurfacePage` 关闭态，见 `apps/miniprogram/src/pages/admission-preconsultation/admission-preconsultation.ts:1-4`、`apps/miniprogram/src/pages/pre-visit/pre-visit.ts:1-4`、`apps/miniprogram/src/services/clinical-content-surface.ts:31-53,119-221`。本次通过临床契约门禁和 8 项临床/患者上下文验收测试，仍缺住院事件/预约关系、问卷版本、患者授权、幂等、撤回、医护读取和外部服务真实响应；保持关闭。不能复制旧题目、旧答案、`user_id/pat_id` 或接入未确认的外部保存接口。

- [ ] P1-14 按旧服务真实行为迁移出院随访（静态二次对照见 [`出院随访任务对照审计-2026-09-16.md`](docs/迁移/出院随访任务对照审计-2026-09-16.md)，二次验证见 [`出院随访二次验证-2026-09-16.md`](docs/迁移/出院随访二次验证-2026-09-16.md)）：旧端固定展示 8 套专科/手术表单并调用 `createDischargeFollowUp`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/discharge_followup.vue:136-153,214-250`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/discharge_followup_detail.vue:20-95,140-270`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:318-387`；旧 Python 服务实际按 `user_id + pat_id` 查找并覆盖，模型只有 `user_id/pat_id/table_name/content`，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/discharge_follow_up/service.py:12-67`、`model.py:9-18`，没有出院事件、任务/表单版本、幂等、撤回或医护读取授权。新端仅关闭态，见 `apps/miniprogram/src/pages/discharge-followup/discharge-followup.ts:1-4`，并明确要求唯一出院事件、任务版本、答案撤回和医护读取，见 `apps/miniprogram/src/services/clinical-content-surface.ts:71-85,119-133,180-221`；本次通过临床契约门禁和 8 项临床/患者上下文验收测试，但仍缺出院事件、任务/版本、授权、幂等、撤回、医护读取及 DevTools/真机/生产证据；先冻结 contract，不能按旧键迁移或把已完成预约当出院事件。

- [ ] P1-15 分开处理风险评估、自测题库和结果（静态二次对照见 [`风险评估与健康自测对照审计-2026-09-16.md`](docs/迁移/风险评估与健康自测对照审计-2026-09-16.md)，二次验证见 [`风险评估与健康自测二次验证-2026-09-16.md`](docs/迁移/风险评估与健康自测二次验证-2026-09-16.md)）：旧风险入口有跌倒/压力性损伤/疼痛 3 类表单，跌倒表单实际组装答案并调用 `createRiskAssessment`，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/risk_self_evaluation.vue:72-103`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/risk_form_fall.vue:18-95,106-177,214-300`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/health.ts:205-312`；旧 Python 服务按 `user_id + pat_id` 覆盖风险记录，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/risk_assessment/service.py:13-62`、`model.py:10-18`。旧健康自测入口展示 9 项，其中 7 项走题库、2 项走计算器，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/health_test.vue:79-151,258-290`；题目和评分实际来自 7 套 Python 配置，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_knowledge/selftest/config/list.py:1-35`、`controller.py:16-99`。新端风险页关闭，见 `apps/miniprogram/src/pages/risk-evaluation/risk-evaluation.ts:1-4`；健康自测只开放 `local-non-diagnostic-v1` BMI/血压安全子集，见 `apps/miniprogram/src/pages/health-test/health-test.ts:39-43,88-124`、`apps/miniprogram/src/services/health-safe-calculators.ts:1-6,21-29`。本次通过安全计算器/迁移边界测试、临床契约门禁和 8 项临床/患者上下文验收测试，仍缺题库/规则版本、临床审核、适用人群、患者授权、幂等、撤回/失效、保留审计及 Provider/DevTools/真机/生产证据；不能直接复制旧题库或旧覆盖写入。

- [x] P1-16 收口 BMI/血压计算器的安全参考范围（静态二次对照见 [`健康计算器安全子集审计-2026-09-16.md`](docs/迁移/健康计算器安全子集审计-2026-09-16.md)）：旧 BMI 分类/WHO-亚洲-中国参考表和血压分级/“1998 年标准”存在多套规则与适用范围缺口，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/bmi_calc.vue:80-145`、`blood_pressure_calc.vue:80-181`；新端明确只做 `local-non-diagnostic-v1` 的 BMI 公式和血压读数校验，见 `apps/miniprogram/src/pages/health-test/health-test.ts:39-43,88-124`、`apps/miniprogram/src/services/health-safe-calculators.ts:1-6,10-18,46-115`，本轮补齐公式/范围/golden cases 和临床字段隔离测试。参考计算子集已完成；临床分级、危险值提示或建议如未来需要，必须另行冻结临床规则 contract，禁止把结果写入病历、报告或风险记录。

### P1 便民服务和外部能力

- [ ] P1-17 对照旧电子锦旗和表扬信真实接口，决定是否迁移（静态二次对照见 [`电子锦旗与表扬信反馈对照审计-2026-09-16.md`](docs/迁移/电子锦旗与表扬信反馈对照审计-2026-09-16.md)，二次验证见 [`电子锦旗与表扬信二次验证-2026-09-16.md`](docs/迁移/电子锦旗与表扬信二次验证-2026-09-16.md)）：旧服务真实挂载 `CommendatoryLetter/SilkBanner`，旧客户端有 create/list 和患者/医生/就诊快照入参，见 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_convenience/__init__.py:3-19`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/modules/commendatoryLetter.ts:1-68`、`silkBanner.ts:1-73`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/gift_health_praise.vue:147-239,333-430`。旧服务只校验 `auth.user.id == data.user_id` 后直接新增，患者/就诊/医护快照和 `display_type` 由客户端提供，见旧 `commendatory_letter/service.py:30-76`、`silk_banner/service.py:24-68`、`base.py:7-28`，无审核、公开脱敏、撤回或幂等。新端仅有明确未开放的 convenience surface，见 `apps/miniprogram/src/pages/gift-banner/gift-banner.ts:1-4`、`health-praise.ts:1-4`、`apps/miniprogram/src/services/convenience-surface.ts:21-30,117-177`；本次通过便民页面/迁移边界测试及小程序便民验收，仍缺服务端就诊引用、内容审核、公开脱敏、幂等、撤回、管理端权限和 Provider/DevTools/真机/生产证据；当前不接旧 API、不导入旧历史。

- [ ] P1-18 完成患者签名的外部主体和授权核对（静态二次对照见 [`患者签名外部主体对照审计-2026-09-16.md`](docs/迁移/患者签名外部主体对照审计-2026-09-16.md)，二次验证见 [`患者签名外部主体二次验证-2026-09-16.md`](docs/迁移/患者签名外部主体二次验证-2026-09-16.md)）：旧端直接调用 `navigateToMiniProgram`，硬编码 `appId=wx0b76c9904392518f`，不设 path，并把 `patientId/patientName` 放进 `extraData`，成功回调为空，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/patient/patient_signature.vue:104-130`；旧端患者列表还带默认伪患者和 `BOUND_PATIENTS` 任意字段映射，见同文件 `:97-101,139-149`。新端只读取 owner-scoped 脱敏患者目录，点击仅选中并提示未开放，不调用外部小程序，见 `apps/miniprogram/src/pages/patient-signature/patient-signature.ts:21-47,70-126`、`patient-signature.wxml:20-77`。本次通过患者签名小程序验收和患者签名覆盖断言，仍缺目标主体、path、最小字段、一次性短期会话、回跳、失败/撤回、文件安全和审计协议；不能恢复硬编码 appId 或外发内部患者标识。

- [ ] P1-19 恢复旧就诊页的实时能力前先冻结独立 contract（实时能力复核见 [`实时就诊对照复核-2026-09-16.md`](docs/迁移/实时就诊对照复核-2026-09-16.md)，二次验证见 [`实时就诊二次验证-2026-09-16.md`](docs/迁移/实时就诊二次验证-2026-09-16.md)）：旧端今日就诊确实连接 `VITE_APP_WS_API + /webSocket/online/message`，把 token 和 `patId` 放入 URL/Authorization，解析 `messages` 并对叫号通知查询队列位置，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/api/ws.ts:1-128`、`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pages/consult/consult.vue:214-287,320-337,430-433`；但没有可核验的消息版本、事件 ID、游标补偿、患者/就诊事件绑定和订阅授权 contract。新端 `apps/miniprogram/src/pages/consult/consult.ts:169-173,236-291` 只有 owner-scoped 预约历史摘要，WXML 明确标注实时状态暂未开放，见 `apps/miniprogram/src/pages/consult/consult.wxml:1-62`。本次通过就诊摘要边界和小程序实时关闭验收，仍缺队列/叫号事件、认证、患者映射、游标补偿、断线重连、保留周期、临床状态脱敏、Provider/DevTools/真机/生产证据；不能复制旧 URL token/patId 或用预约摘要冒充实时就诊。

- [ ] P1-20 对照旧通用 WebView 的真实入口并完成外部边界（静态二次复核见 [`外部入口与通用WebView对照复核-2026-09-16.md`](docs/迁移/外部入口与通用WebView对照复核-2026-09-16.md)，二次验证见 [`外部入口与通用WebView二次验证-2026-09-16.md`](docs/迁移/外部入口与通用WebView二次验证-2026-09-16.md)）：旧 `pagesB/health/webview.vue` 同时承载智能客服、`outpatient-guide`、患者绑定/解绑 URL 和 `/system/auth/ticket`，传入完整 URL 时直接 decode 后追加 ticket，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pagesB/health/webview.vue:26-83`；互联网医院另有固定 H5，见 `/Users/yxswy/Documents/GitHub/hospital/hospital-app/src/pages/hospital/hospital.vue:13-29`。新端智能导诊已改为原生文字/语音 API，见 `apps/miniprogram/src/pages/smart-guide/smart-guide.ts:176-237`、`apps/api/src/modules/intelligent-guide/index.ts:46-97`，客服/互联网医院只保留固定地址，见 `apps/miniprogram/src/pages/smart-customer/smart-customer.ts:1-28`、`apps/miniprogram/src/pages/hospital/hospital.ts:1-31`，不接受任意 URL/path、不传平台 token、不复用旧 ticket。本次通过固定 WebView/原生导诊验收和旧入口目录断言，仍缺按 audience 分开的域名 allowlist、短期会话、回跳/退出、失败、外部主体和真机/生产证据；当前保持各自外部 contract 未完成。

## P2：补齐“旧端本来没有”或工程上仍缺失的边界决策

### P2 不把旧端占位误写成待迁移业务

- [x] P2-01 对 patient-express 做结论性收口：旧端只有本地 BOUND_PATIENTS/CURRENT_PATIENT、固定假患者和空数组，查询位置是 TODO，见 hospital-app/src/pagesB/patient/express.vue:55-85；新端对此已正确保持不发请求。二次验证已记录在 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`。除非业务方提供真实物流 Provider、患者归属、状态字段和保留策略，否则不要实现快递接口；拿到材料后再从 status-only 改为真实只读。

- [x] P2-02 对 patient-subscription 做产品决策：旧端“确定修改”只 Toast 并返回，没有微信订阅授权或服务端保存，见 hospital-app/src/pagesB/user/subscription_message.vue:203-214；新端 enabled 固定 false 是正确防伪。二次验证已记录在 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`。只有拿到模板 ID、授权时机、业务事件、发送回执、撤销状态和 owner 规则后才新建 contract，否则将其标记为旧端假功能而非迁移缺口。

- [x] P2-03 清理 patient-address 的迁移假象：当前 FeatureKey 在 apps/miniprogram/src/services/feature-navigation.ts:21-25、migration-coverage.ts:126-130 中存在，但旧 64 页面和旧 action inventory 中没有 patient-address；旧仓库也没有患者地址管理 API/页面。已在 `apps/miniprogram/src/services/feature-navigation.ts:251-259` 明确标为“未来新需求”，并由 `apps/miniprogram/src/services/migration-coverage.test.ts` 锁定无旧来源断言；详见 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`，不得因为有 FeatureKey 就实现地址业务。

- [x] P2-04 对 bloodAppointment 做同样的事实收口：旧页只有硬编码患者、固定院区、空态和“功能开发中”，见 hospital-app/src/pagesB/hospital/bloodAppointment.vue:45-101；当前页也只读取患者并进入状态页，见 apps/miniprogram/src/pages/blood-appointment/blood-appointment.ts:103-150。结论和二次验证已记录在 `docs/迁移/P2占位能力结论性收口-2026-09-16.md`；没有旧 Provider 号源/预约行为时不凭空实现；如果医院确有采血业务，另行取得业务来源和 contract。

### P2 工程和数据连续性

- [x] P2-05 补齐非支付旧数据连续性方案：当前数据切换决策是新库冷启动，不自动导入旧用户、患者关系、预约存量、便民历史或健康知识历史，见 docs/迁移/数据切换决策-2026-08-31.md:7-26；已对照旧服务和当前 hp_* 表逐域决定导入、只读兼容、人工复核或不迁移，覆盖患者关系、我的医生历史、报告引用、便民历史和已完成健康内容。已记录旧便民 42 行、健康知识 15,668 条的来源指纹、数量、目标写入为 0 和无写入回滚基线，见 [`非支付存量连续性复核-2026-09-16.md`](docs/迁移/非支付存量连续性复核-2026-09-16.md)。本项完成的是安全处置方案，不代表历史已迁移或患者端可见；未来导入仍需业务/数据/安全/临床审批和受控 staging。

- [ ] P2-06 给已存在代码的低风险域补真实证据包：患者目录、普通资料、预约目录/历史、我的医生、报告目录、门诊摘要目前都有 TypeScript/API/测试落点，但 apps/api/src/index.ts:92-118,186-295 明确按配置状态 fail-closed。本轮已整理六个域的代码测试结果、当前 dist/source 候选漂移和待采集字段，见 [`P2-06低风险域证据包状态-2026-09-16.md`](docs/迁移/P2-06低风险域证据包状态-2026-09-16.md)；每个域仍需同一候选版本的客户端 requestId、服务端 requestId/traceId、Provider 结果摘要、空/拒绝/超时、会话切换和真机截图。没有真实证据时状态保持代码已实现/待实证。

- [x] P2-07 固定 Node/Bun/pnpm 运行环境并补发布复现记录：仓库声明和 CI 已统一为 Bun 1.4.0、Node 24.12.0、pnpm 11.9.0；已显式使用机器上安装的 Node 24.12.0（默认 shell 仍为 v26.8.1）执行 `pnpm toolchain:audit`、`build:dev`、`runtime:verify:dev`、release `build` 和 `runtime:verify`，均通过。release/development 均为 47 页、453 个文件，release 来源为 `cba13c71a74022b756144b9c7a61965cd542b1af`，文件树指纹和构建输出见 [`工具链复现记录-2026-09-16.md`](docs/发布/工具链复现记录-2026-09-16.md)。本项完成的是本地工具链/运行包复现，不代表 DevTools、Provider、真机或生产验收完成；这些继续按独立证据包处理。

- [x] P2-08 为 94 个小程序页面源文件建立按业务域的真机回归矩阵：已逐项覆盖 `app.json` 的 47 页及其 `.ts/.wxml` 源文件，区分 `代码具备/待实证`、`安全静态/关闭`、`写入前受控` 和范围排除；固定 S0-S9 场景覆盖登录/退出、无患者、换患者、会话失效、Provider 503、空列表、超时、页面返回和 `dist` 实际加载。矩阵见 [`小程序页面回归矩阵-2026-09-16.md`](docs/迁移/小程序页面回归矩阵-2026-09-16.md)，并明确临床、外部、患者绑定、报告附件的 `600` 受控证据边界。`pnpm miniprogram:navigation:audit`（47 页）、`pnpm miniprogram:patient-display:audit`（94 个源文件）和 `pnpm migration:breadth:audit` 均通过；本次已用 Node 24.12.0 重建当前运行输入对应的 dist，release 来源为 `cba13c71`，但仍没有本文候选的 DevTools/真机/Provider/生产同链证据，因此矩阵内业务行保持 pending，不把矩阵建立或运行包复现误写成业务验收完成。本轮未触碰支付/医保/收银台/费用页面或相关代码。

- [x] P2-09 复核健康知识中的 `knowledge_tips`：二次核对确认旧 Python 确实存在 `knowledge_tips` 表和认证后的 `GET /knowledge/tips/{id}`，字段为 `id/title/content/status`，见旧服务 `/Users/yxswy/Documents/GitHub/hospital/app/api/v1/module_knowledge/tips/model.py:11-21`、`controller.py:13-29`；但旧小程序“指标解读”实际在 `hospital-app/src/pagesB/health/health_test.vue:154-271` 使用 10 项本地硬编码内容，没有发现调用该接口，不能把两个对象强行关联。新端导出器仍在 `packages/persistence/scripts/health-knowledge-source-export.ts:91-99,516` 将其列为 `ignoredLegacySources`，bundle/API 没有 `tip` 类型或路由。结论、数据范围/内容责任/临床审核/版本发布阻塞和未来输入已记录在 [`健康贴士来源与范围复核-2026-09-16.md`](docs/迁移/健康贴士来源与范围复核-2026-09-16.md)；在取得真实使用关系、脱敏数据指纹、责任人、审核和撤回 contract 前不实现、不导入、不塞入疾病/药品正文，也不因此开放健康内容。

## P3：后台运营和长期维护

### P3 后台能力不能只看患者小程序

- [x] P3-01 做旧后台系统管理域的迁移决策和实现排期：旧 FastAPI 总路由把 system、monitor、common、application、convenience、intelligent、knowledge 全部挂载，system 还包含 auth/user/role/menu/dept/position/dict/params/notice/log；当前新 API system 只有 ping，管理端只有认证兼容、日志和范围外管理入口，不能称为旧后台已迁移。已逐模块记录旧路由数量、当前承接状态、保留/新建/下线决策和 A0-A5 实现排期，见 [`后台系统管理域迁移决策与排期-2026-09-16.md`](docs/迁移/后台系统管理域迁移决策与排期-2026-09-16.md)。本项完成的是决策和排期，不代表后台 user/role/menu/dept/position/dict/params/notice 已实现；实际实现仍需责任人、RBAC、数据保留、staging 和生产验收，支付/医保管理入口继续排除。

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
