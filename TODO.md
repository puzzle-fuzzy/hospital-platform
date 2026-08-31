# Hospital Platform 迁移校对 TODO

更新时间：2026-08-31

本文是本次“旧项目 → 新项目”全量静态校对的结论和后续清单。旧项目
`/Users/yxswy/Documents/GitHub/hospital` 只做源码、路由和资源盘点，没有运行旧服务、旧小程序、旧数据库、Redis 或 Provider。

## 0.1 未完成项统计（2026-08-31）

统计口径：`[ ]` 表示仍需实现、取得外部证据或完成受控运维动作；`[x]` 表示本仓库内的代码/文档/边界判断已经完成。第 7、10.6、11.4 节的“不迁移”条目属于已经确认的策略，不再计入未完成工作。

| 工作流 | 未完成条目 | 当前判断 |
| --- | ---: | --- |
| P0 数据迁移、身份安全与当前准入 | 10 | 旧库存量、凭据轮换、真机证据和切换窗口仍需外部确认 |
| P1 只读业务真实闭环 | 5 | 代码骨架已在库内，Provider、公网和真机证据仍缺 |
| P1 健康内容发布 | 2 | 源快照已存在但仍有质量告警，审核 bundle、导入/撤回和真机验收仍缺 |
| P1/P2 临床、患者、便民与外部能力 | 20 | contract、归属、资源权限、真实主体和业务页面仍缺 |
| P1 运维、恢复、告警与运营配置 | 10 | 代码门禁、人工复核工具和订单审计归档已有，生产告警接入、存量任务盘点和恢复演练仍缺 |
| P3 支付、医保、退款与 HIS 回写 | 6 | 按约定最后处理，当前保持关闭 |
| **合计未完成** | **53** | **不包含已经确认“不迁移”的策略项** |

复选框总数为 85 项，其中已完成 32 项、未完成 53 项。上表按工作流归并，`P1/P2 临床、患者、便民与外部能力` 包含第 10.2 节的 4 个产品闭环骨架项和 C/D/E 三个批次的 16 个 contract 项。另按标题优先级统计未完成项为：P0 10、P1 21、P2 16、P3 6；混合标题按标题中最高优先级归类。每次清单变更后，提交前都必须重新计算这组数字。

## 0. 先看结论

- 旧端共 64 个生产页面，均已登记唯一迁移落点；没有发现“完全没有登记”的页面。
- 当前台账状态：`replaced=8`、`partial=23`、`surface-only=23`、`blocked-payment=7`、`blocked-provider=1`、`blocked-external=1`、`excluded=1`。
- 旧 Python 服务静态发现 195 条已挂载路由，另有 1 个未挂载的 RAG 路由文件；新项目没有把它们全部复制成患者端 API，这是有意的边界。
- 新小程序实际注册 38 个页面、4 个原生 Tab；当前 `dist` 的 `sourceRevision=935410473e5a7c1be125a85834f957f53a833d8f`，页面数与源码一致。
- 新端结构已闭环的 5 个低风险域是：就诊人目录、预约目录/历史、报告目录、门诊费用只读列表、普通个人资料；它们都还缺 Provider/公网/真机的完整证据，因此不能称为业务完成。
- 当前真实证据就绪业务域为 0；健康百科审核 bundle 不存在；Provider 接收材料 4 份均为 `normalized`、确认数为 0；Worker 当前因支付和 Provider 配置缺失而跳过实际业务循环。

“页面存在”“状态页存在”“本地测试通过”均不等于迁移完成。任何患者绑定、临床内容、实时会话、支付、医保、退款和 HIS 回写，必须在正式 contract、服务端实现、低敏日志、公网和真机证据齐全后才可打开。

## 1. 校对证据与当前基线

本次使用的主要事实源：

- 旧页面及客户端行为：`/Users/yxswy/Documents/GitHub/hospital/hospital-app/src`。
- 旧服务路由：`/Users/yxswy/Documents/GitHub/hospital/app/api/v1`。
- 新页面台账：`apps/miniprogram/src/services/legacy-page-catalog.ts`。
- 新入口/批次：`apps/miniprogram/src/services/feature-navigation.ts`、`apps/miniprogram/src/services/migration-coverage.ts`。
- 旧接口完整清单：`docs/migration/legacy-api-endpoint-inventory.md`。
- 旧客户端非页面逻辑：`docs/migration/legacy-client-infrastructure-boundaries.md`。

已通过的结构审计包括架构、页面台账、冻结入口、契约材料覆盖、入口广度、导航、患者展示、临床边界、低风险只读域、Provider intake、错误契约、文档链接、日志事件、工具链、模板和类型检查。当前仍有一项预期的发布阻断：

- `pnpm check:candidate` 是仓库内候选代码门禁；`pnpm release:baseline:index:audit` 已通过，当前 `dist` 与 `9354104` 候选一致。
- `pnpm release:baseline:audit` 仍 fail-closed，因为线上服务端 release `5738a71e0bcddaa8849106754baf5b296427bed7` 之后存在 9 个未部署运行时代码文件：`packages/adapters/src/errors.ts`、`packages/adapters/src/http.ts`、`packages/domain/src/payment-order.ts`、`packages/domain/src/payment-provider.ts`、`packages/observability/src/index.ts`、`packages/persistence/src/migrate.ts`、`packages/persistence/src/mysql-repositories.ts`、`packages/persistence/src/outbox.ts`、`packages/persistence/src/repositories.ts`。这必须在受控发布窗口处理，不能为了让门禁变绿而伪造线上已部署。

## 2. 64 个旧页面逐页结论

状态说明：

- `replaced`：新端已有安全原生替代，但仍可能缺真实证据或原能力的独立 contract。
- `partial`：只迁移了可确认的安全子集，详情、写入、实时或外部能力仍未完成。
- `surface-only`：只有原生外壳、入口、空态或关闭态，不可称为业务迁移。
- `blocked-provider` / `blocked-external` / `blocked-payment`：统一进入状态页或关闭态，等待对应契约。
- `excluded`：明确不进入生产小程序。

### 2.1 首页、就诊、互联网医院

| 旧页面 | 新落点 | 状态 | 还缺什么/结论 |
| --- | --- | --- | --- |
| `pages/index/index.vue` | `pages/index/index` | replaced | 首页原生替换已完成；只需真实登录、患者目录和入口验收。 |
| `pages/setting/setData.vue` | — | excluded | 旧端开发辅助页，不迁移。 |
| `pages/consult/consult.vue` | `pages/consult/consult` | partial | 患者上下文、未来/历史预约只读摘要已迁移；实时队列、WebSocket、最终就诊状态待 contract。 |
| `pages/hospital/hospital.vue` | `pages/hospital/hospital` | partial | 主 Tab 安全壳已迁移；外部 WebView、任意 URL、ticket 和互联网医院真实会话待 contract。 |
| `pagesB/health/webview.vue` | `pages/smart-customer/smart-customer` | surface-only | 智能客服入口壳已迁移；HTTPS allowlist、短期 ticket、登录态隔离、回跳仍关闭。 |
| `pagesB/account/follow.vue` | `pages/official-account/official-account` | replaced | 静态公众号说明已迁移；关注事实、二维码和微信订阅不由静态页面冒充。 |

### 2.2 预约

| 旧页面 | 新落点 | 状态 | 还缺什么/结论 |
| --- | --- | --- | --- |
| `pagesB/hospital/bloodAppointment.vue` | `pages/blood-appointment/blood-appointment` | partial | 当前就诊人、院区和无项目空态已迁移；采血号源、写入、取消和最终状态查询待 contract。 |
| `pagesB/hospital/confirm_registration.vue` | `pages/feature-status/feature-status` | blocked-payment | 锁号、预约登记、费用、幂等、支付前置和 HIS 回写待最后批次。 |
| `pagesB/hospital/department_select.vue` | `pages/appointment-directory/appointment-directory` | partial | 科室只读并入预约目录；号源写入和未确认字段不迁移。 |
| `pagesB/hospital/doctor_card.vue` | `pages/appointment-directory/appointment-directory` | partial | 只显示确认后的安全医生字段；目录、排序、脱敏字段和 Provider 证据待补。 |
| `pagesB/hospital/hospitalList.vue` | `pages/hospital-list/hospital-list` | replaced | 单院区静态卡片和安全预约前置已替换；动态医院目录不从旧快照恢复。 |
| `pagesB/hospital/navigation.vue` | `pages/hospital-navigation/hospital-navigation` | replaced | 静态地图/预览已替换；不伪造实时路线或动态定位。 |
| `pagesB/hospital/registration_detail.vue` | `pages/appointment-detail/appointment-detail` | surface-only | 详情引用、患者归属、状态映射和敏感字段白名单待 contract。 |
| `pagesB/hospital/registration_medical_pay.vue` | `pages/feature-status/feature-status` | blocked-payment | 挂号医保授权、查单、结算和 HIS 回写最后处理。 |
| `pagesB/hospital/registration.vue` | `pages/appointment-directory/appointment-directory` | partial | 预约目录只读已迁移；锁号、登记、支付和取消关闭。 |
| `pagesB/hospital/timeslot_source.vue` | `pages/appointment-directory/appointment-directory` | partial | 只展示确认后的号源字段；时间段时区、实时性和锁号待 Provider contract。 |

### 2.3 患者与用户

| 旧页面 | 新落点 | 状态 | 还缺什么/结论 |
| --- | --- | --- | --- |
| `pages/user/user.vue` | `pages/my/my` | partial | 已拆为我的、资料、患者选择和预约记录安全子集；真实会话和所有子域分别验收。 |
| `pagesB/hospital/selectPatient.vue` | `pages/patient-select/patient-select` | replaced | 已由 owner-scoped 患者目录和显式选择替换。 |
| `pagesB/patient/agreement.vue` | `pages/patient-agreement/patient-agreement` | replaced | 原文只读页已迁移；协议版本、同意、撤回和审计仍待患者 contract。 |
| `pagesB/patient/doctor.vue` | `pages/my-doctor/my-doctor` | surface-only | 医生目录与患者关系必须分开建模，不能直接恢复旧库快照。 |
| `pagesB/patient/express.vue` | `pages/patient-express/patient-express` | partial | 患者卡片和空态已迁移；真实物流来源、归属和状态字段待 Provider contract。 |
| `pagesB/patient/patient_signature.vue` | `pages/patient-signature/patient-signature` | partial | owner-scoped 脱敏列表和协议入口已迁移；签名材料、证据保留、撤回和医护读取待 contract。 |
| `pagesB/patient/patientAdd.vue` | `pages/patient-binding/patient-binding` | surface-only | 建档/绑卡外壳已迁移；实名核验、幂等、重复绑定、撤回和失败重试关闭。 |
| `pagesB/patient/patientChange.vue` | `pages/patient-select/patient-select` | replaced | 已由 owner-scoped 目录和显式选择替换；旧 patId/卡号缓存不迁移。 |
| `pagesB/user/edit_profile.vue` | `pages/profile/profile` | partial | 普通资料子集已迁移；头像、实名、手机号、微信身份与患者身份保持独立。 |
| `pagesB/user/feedback.vue` | `pages/feedback/feedback` | replaced | 旧端静态帮助和客服电话行为已替换；无需恢复旧后台工单接口。 |
| `pagesB/user/miss_appointment.vue` | `pages/missed-appointments/missed-appointments` | partial | 从服务端明确的 `missed` 状态派生只读页；待真实历史数据和四方证据。 |
| `pagesB/user/my_consultation.vue` | `pages/feature-status/feature-status` | blocked-external | 旧端是独立治疗陪诊/问诊历史，不是预约历史；外部主体、受众、短期会话和回跳待 contract。 |
| `pagesB/user/my_registration.vue` | `pages/appointment-records/appointment-records` | partial | 在线/全部历史只读已迁移；详情、取消、支付、退款关闭。 |
| `pagesB/user/subscription_message.vue` | `pages/patient-subscription/patient-subscription` | partial | 搜索、分类和只读开关展示已迁移；微信订阅授权、服务端发送、撤回和失败处理待 contract。 |

### 2.4 健康

| 旧页面 | 新落点 | 状态 | 还缺什么/结论 |
| --- | --- | --- | --- |
| `pagesB/health/admission_preconsultation.vue` | `pages/admission-preconsultation/admission-preconsultation` | surface-only | 版本化问卷、授权、幂等提交和医护读取关闭。 |
| `pagesB/health/blood_pressure_calc.vue` | `pages/health-test/health-test` | partial | 只保留读数校验/展示；旧阈值、均值和风险结论不迁移，待临床审核。 |
| `pagesB/health/bmi_calc.vue` | `pages/health-test/health-test` | partial | 只保留 BMI 公式计算；人群分类、风险解释和参考表待临床审核。 |
| `pagesB/health/discharge_followup_detail.vue` | `pages/discharge-followup/discharge-followup` | surface-only | 出院事件、随访任务、答案版本和撤回规则关闭。 |
| `pagesB/health/discharge_followup.vue` | `pages/discharge-followup/discharge-followup` | surface-only | 不按旧 `user_id/pat_id` 覆盖随访任务；真实任务 contract 关闭。 |
| `pagesB/health/disease_detail.vue` | `pages/health-knowledge-detail/health-knowledge-detail` | partial | 审核内容详情壳已迁移；正式 bundle、发布、下线和临床审核缺失。 |
| `pagesB/health/drug_detail.vue` | `pages/health-knowledge-detail/health-knowledge-detail` | partial | 只读药品内容待审核 bundle；不得变成处方或个体化用药建议。 |
| `pagesB/health/electronic_bill.vue` | `pages/feature-status/feature-status` | blocked-payment | 账单授权、金额单位和短期文件引用待支付/资源 contract。 |
| `pagesB/health/electronic_consultation.vue` | `pages/electronic-consultation/electronic-consultation` | surface-only | 电子导诊单来源、患者上下文、读写权限和状态待临床 contract。 |
| `pagesB/health/electronic_record.vue` | `pages/feature-status/feature-status` | blocked-provider | 只有旧调用线索；没有正式门诊记录请求/响应、映射和字段白名单，不冒充预约或报告。 |
| `pagesB/health/gift_electronic_banner.vue` | `pages/gift-banner/gift-banner` | surface-only | 内容审核、文件安全、脱敏公开和撤回关闭。 |
| `pagesB/health/gift_health_praise.vue` | `pages/health-praise/health-praise` | surface-only | 内容审核、文件安全、脱敏展示和幂等关闭。 |
| `pagesB/health/health_encyclopedia.vue` | `pages/health-encyclopedia/health-encyclopedia` | partial | 目录只读壳已迁移；当前没有正式审核 bundle，路由 fail-closed。 |
| `pagesB/health/health_test.vue` | `pages/health-test/health-test` | surface-only | 题库版本、评分规则、免责声明和结果留存关闭；仅安全数值子集可用。 |
| `pagesB/health/inpatient_center.vue` | `pages/inpatient-center/inpatient-center` | surface-only | 住院 episode 权威来源、映射、状态和门诊/住院隔离待 contract。 |
| `pagesB/health/inpatient_payment.vue` | `pages/feature-status/feature-status` | blocked-payment | 住院账单、状态机、查单、退款和 HIS 回写待最后批次。 |
| `pagesB/health/list_electronic_banner.vue` | `pages/gift-banner/gift-banner` | surface-only | 只能展示审核后的公开视图，不能直读旧快照。 |
| `pagesB/health/list_health_praise.vue` | `pages/health-praise/health-praise` | surface-only | 只能展示审核后的公开视图，不能直读旧表。 |
| `pagesB/health/medical_insurance_pay.vue` | `pages/feature-status/feature-status` | blocked-payment | 医保授权、FSI 查单、回调和 HIS 回写最后处理。 |
| `pagesB/health/outpatient_pay_detail.vue` | `pages/feature-status/feature-status` | blocked-payment | 费用明细白名单、金额单位、患者归属和短期引用待 contract。 |
| `pagesB/health/outpatient_pay.vue` | `pages/outpatient-payment/outpatient-payment` | partial | 门诊费用只读列表已迁移；支付、医保、结算和退费关闭。 |
| `pagesB/health/payment_cashier.vue` | `pages/feature-status/feature-status` | blocked-payment | 不恢复旧 WebView 收银台或任意外部 URL。 |
| `pagesB/health/pre_visit.vue` | `pages/pre-visit/pre-visit` | surface-only | 问卷版本、预约关系、授权、幂等和医护读取关闭。 |
| `pagesB/health/record_electronic_banner.vue` | `pages/gift-banner/gift-banner` | surface-only | 详情只允许审核后的公开记录，不能复用旧患者快照。 |
| `pagesB/health/record_health_praise.vue` | `pages/health-praise/health-praise` | surface-only | 详情只允许审核后的公开记录，不能复用旧患者快照。 |
| `pagesB/health/report_detail.vue` | `pages/report-detail/report-detail` | partial | owner/patient/TTL 引用骨架已建立；详情、附件和资源授权待 Provider。 |
| `pagesB/health/report_query.vue` | `pages/report-directory/report-directory` | partial | 有限日期窗口报告目录已迁移；PEIS/PACS/ECG 详情分开处理。 |
| `pagesB/health/risk_form_fall.vue` | `pages/risk-evaluation/risk-evaluation` | surface-only | 量表题目、阈值、适用人群和免责声明待临床审核。 |
| `pagesB/health/risk_form_pain.vue` | `pages/risk-evaluation/risk-evaluation` | surface-only | 量表题目、阈值、适用人群和免责声明待临床审核。 |
| `pagesB/health/risk_form_pressure.vue` | `pages/risk-evaluation/risk-evaluation` | surface-only | 量表题目、阈值、适用人群和免责声明待临床审核。 |
| `pagesB/health/risk_self_evaluation.vue` | `pages/risk-evaluation/risk-evaluation` | surface-only | 题库版本、评分算法、结果授权和临床复核关闭。 |
| `pagesB/health/search_result.vue` | `pages/health-knowledge-search/health-knowledge-search` | partial | 只查审核 bundle；搜索索引和内容发布仍受版本闸门控制。 |
| `pagesB/health/self_test_question.vue` | `pages/health-test/health-test` | surface-only | 不可变题库、答案校验和临床审核关闭。 |
| `pagesB/health/self_test_result.vue` | `pages/health-test/health-test` | surface-only | 评分结果、解释、免责声明和撤回策略关闭。 |

## 3. 旧端非页面代码：已确认没有直接迁移的部分

### 3.1 客户端基础设施

旧小程序静态盘点范围：`src/api` 14 个、`src/stores` 2 个、`src/utils` 3 个、`src/components` 12 个、`src/jsonData` 5 个、`src/static` 30 个文件。它们不是“页面已经覆盖”的附属物，结论如下：

| 旧来源 | 旧行为 | 新端结论 |
| --- | --- | --- |
| `src/api/http.ts` | Bearer、旧 `{code,msg,data}`、401 跳转旧登录页 | 只保留新平台 API client、统一错误码和受控重试；不复制旧成功判断。 |
| `src/api/httpZy.ts` | 直连 `VITE_ZHONGYI_BASE_API`，向 Provider 发送平台 Bearer，并记录原始请求/响应 | 不迁移；Provider 必须位于服务端 adapter，日志只能保留低敏元数据。 |
| `src/api/ws.ts` | `VITE_APP_WS_API`，query 携带 token/patId，自行重连 5 次 | 不迁移；待服务端握手、短期会话、消息版本、心跳、断线补偿和 owner 归属 contract。 |
| `src/api/modules/companion.ts` | 陪诊历史走旧 API，队列位置另直连 Provider | 不迁移；陪诊会话和实时队列必须分别建模。 |
| `src/api/modules/ZY.ts`、`appointment.ts`、`medicalRecord.ts` | 患者、预约、报告、病历等直连众阳中台 | 不复制 URL 和 payload；已拆入新端患者/预约/报告只读边界，剩余按 contract 阻断。 |
| `src/api/modules/payment.ts`、`medical-insurance.ts` | 微信支付、医保 FSI、云健康结算/退款、HIS 回写 | 不复制前端支付流程；全部归入最后的支付/医保/HIS 批次。 |
| `src/stores/user.ts` | 持久化 userInfo、access/refresh token 及可能的微信身份字段 | 新端只持有平台 opaque 会话，不解析或缓存 Provider 凭证。 |
| `src/stores/patient.ts` | 持久化 patId、卡号、身份证、thirdPatientId 等混合标识 | 新端只保存 owner 下的 opaque `patientId`；Provider 患者号仅在服务端调用帧内流转。 |
| `src/utils/index.ts` | unionId 查患者、缓存患者、`proxyForward`/任意 URL | 不迁移；新端禁止客户端提交 unionId、Provider ID 或任意 URL。 |
| `components/health/SelfTestEngine.vue`、`jsonData/selfTestConfig.ts` | 题目、跳题、分值、风险阈值和结果解释 | 不直接迁移；必须先有版本化题库、临床审核、适用人群和撤回策略。 |
| `components/health/discharge-followup-form*.vue` | 按场景渲染随访表单和覆盖逻辑 | 不直接迁移；必须绑定出院事件、任务版本、授权、幂等、撤回和医护读取。 |
| `components/form/formItem.vue` | 旧患者新增/资料表单校验 | 不直接迁移；新端将普通资料、实名资料和患者绑定拆开。 |
| `components/account/FollowPrompt.vue` | 公众号关注提示、二维码 | 静态说明可保留；关注主体、二维码、TTL、状态事实和订阅授权不迁移。 |
| `jsonData/homeNavData.json`、`userNavData.json` | 首页/我的入口及旧页面 URL、外部 OSS 图标 | 仅复用已核对资源；入口由新 app.json/FeatureKey 驱动。 |
| `jsonData/department*.json`、旧 `static` | 院区、科室、地图、外部素材 | 静态地图/本地资源可复用；动态目录、定位和未审核外部素材不迁移。 |
| `pagesB/patient/patientChange.bak2` | 页面备份 | 不属于生产页面，不作为实现依据。 |

旧端还包含 WebSocket 1 个行为文件、跨小程序跳转 6 个文件、WebView 3 个文件、支付调起 3 个文件、二维码/公众号 6 个文件、医保回调 4 个文件；这些都不能由页面台账覆盖，均已进入对应 contract 阻断批次。

## 4. 旧服务 195 条路由的迁移分类

完整的旧 endpoint literal 已写入 `docs/migration/legacy-api-endpoint-inventory.md`。本节按旧模块把全部路由范围归类，避免把“没有复制旧路由”误判成遗漏：

| 旧模块 | 已挂载数 | 分类 | 新端处理 |
| --- | ---: | --- | --- |
| `module_system` | 88 | 登录权限、用户、角色、菜单、字典、部门、岗位、通知、参数、日志等后台管理 | 不进入患者小程序；未来如需要，另建 Admin/Operations API、RBAC、审计和网络边界。 |
| `module_monitor` | 20 | 缓存、在线用户、资源、服务器监控 | 不进入患者小程序；保留为运维边界。 |
| `module_application/job` | 14 | 定时任务、任务日志、暂停/恢复/导出 | 不进入患者小程序；Worker 是新平台内部运行边界，不复刻后台 CRUD。 |
| `module_common` | 38 | 文件、医保 FSI、用户查询、云健康结算/退款 | 文件/原始 Provider 接口不公开；医保及结算进入最后批次。 |
| `module_convenience` | 13 | 预问诊、随访、锦旗、表扬信、我的医生、风险评估 | 原生外壳已覆盖；真实写入、审核、医护读取和关系 contract 仍关闭。 |
| `module_intelligent` | 7 | 陪诊预约/历史、导诊文本/语音、客服文本/语音、WebSocket | 外部会话/实时批次；另有 `urls_rag.py` 中 1 个未挂载 `document/create-by-file`，不迁移。 |
| `module_knowledge` | 15 | 健康百科、指标解读、自测题目/提交、报告解读 | 健康百科只在审核 bundle 存在时 fail-open；自测、报告解读和临床结论不直接复制。 |
| **合计** | **195** | **全部旧服务已分类** | **患者端只注册新 contract，不把旧路由作为 fallback。** |

旧客户端直连 Provider 的关键家族也已逐项归档：

- 患者：`patInfosFind`、建档 `patients`、绑卡 `patCards`；当前只保留服务端 owner-scoped 目录同步/读取，建档和绑卡待患者 contract。
- 预约：科室、医生、排班、号源、锁号、挂号、取消、详情；当前只开放安全目录和历史摘要，写入、取消、费用和详情引用关闭。
- 报告/病历/住院：LIS、PACS、ECG、PEIS、`out-emrs`、`out-visit-records`、住院病历和住院患者；当前只开放受限报告目录/详情骨架，病历/住院四域保持未注册。
- 费用/支付：门诊费用目录、费用明细、预支付、结算、查单、关单、退款；当前只开放门诊费用只读列表，所有副作用操作最后处理。
- 医保/回写：1101、6201、6202、6301、医保授权、微信医保订单、云健康结算/退款通知；不允许小程序直连，必须由服务端订单状态机编排。
- 健康/便民/AI：旧 `/knowledge`、`/convenience`、`/intelligent` 路由的请求事实均已记录，但旧响应不构成新 contract；缺审核、患者归属、会话或权限证据的均保持关闭。

## 5. 新端当前实际实现与缺失模块

当前新 API 实际注册模块为：`health`、`system`、`auth`、`profile`、`patients`、`appointments`、`reports`、`outpatient-payments`、`payments`、`knowledge`。主要公共入口：

| 新能力 | 当前路由 | 当前状态 |
| --- | --- | --- |
| 微信身份/平台会话 | `POST /api/v2/auth/wechat`、`GET /api/v2/me` | 代码边界完成；真实微信凭据、Redis、公网和真机证据缺失。 |
| 就诊人目录 | `POST /api/v2/patients/sync`、`GET /api/v2/patients` | owner-scoped 脱敏读模型；新增、绑卡、二维码、实名关系关闭。 |
| 预约目录/历史 | `GET /api/v2/appointments/departments`、`schedules`、`records` | 只读代码闭环；Provider 和真实链路证据缺失。 |
| 报告 | `GET /api/v2/reports`、`GET /api/v2/reports/{reportId}` | 摘要和受限 LIS 详情骨架；PACS/ECG/PEIS、附件和解读关闭。 |
| 门诊费用 | `GET /api/v2/payments/outpatient/records` | 只读列表；费用明细、支付、医保、结算和退费关闭。 |
| 普通资料 | `GET/PUT /api/v2/me/profile` | 普通字段和版本冲突代码闭环；实名、手机号、头像和微信身份独立。 |
| 健康百科 | `/api/v2/knowledge/health/*` | 路由和 fail-closed 代码完成；当前没有 `.local/health-knowledge/reviewed-bundle.json`。 |
| 支付基础设施 | `/api/v2/payments/orders*`、微信通知 | 代码和 gate 存在；`WECHAT_PAYMENT_READY`、加密密钥和真实回调验收缺失，不能调用。 |

明确没有注册、不能用近似数据冒充的模块：门诊病历、住院 episode、我的医生关系、电子导诊单、患者新增/绑卡、随访/风险/自测提交、锦旗/表扬信写入、智能导诊/陪诊/客服、WebSocket、报告分享/云影像、预约写入/取消、费用明细、收银台、住院支付、医保、退款和 HIS 回写。

## 6. 需要真正补齐的事项

### P0：先补当前验收和运行基线

- [x] 已生成 `docs/release/device-evidence-935410473e5a7c1be125a85834f957f53a833d8f-pending.json` 脱敏待采集模板；真实设备证据仍未取得，9 个真机域均保持 `pending`，不能用模板宣称真机完成。
- [x] 已将服务端候选记录和当前项目基线及当前验收语义统一更新为小程序 source revision `935410473e5a7c1be125a85834f957f53a833d8f`；`pnpm release:baseline:audit` 的文档基线部分已通过，文档中保留的旧候选仅作历史追溯。
- [x] 已明确 `5738a71e...` server release 与当前仓库运行时代码的部署关系：`packages/adapters/src/errors.ts`、`packages/adapters/src/http.ts`、`packages/domain/src/payment-order.ts`、`packages/domain/src/payment-provider.ts`、`packages/observability/src/index.ts`、`packages/persistence/src/migrate.ts`、`packages/persistence/src/mysql-repositories.ts`、`packages/persistence/src/outbox.ts`、`packages/persistence/src/repositories.ts` 共 9 个文件属于 release 之后的仓库候选，尚未进入线上；`pnpm release:baseline:audit` 因此继续 fail-closed，不宣称当前 release 与仓库运行时代码一致。详见 [`docs/release/server-runtime-drift-audit-2026-08-31.md`](docs/release/server-runtime-drift-audit-2026-08-31.md)。是否部署仍需单独受控发布窗口，不在本项中擅自执行。
- [x] 已明确 `apps/miniprogram/project.private.config.json` 为本机可选配置：存在时校验 `miniprogramRoot=dist/` 和关闭热重载，干净 checkout 缺失时测试不再因 `undefined` 失败；文件继续被 `.gitignore` 忽略，不提交敏感值。
- [ ] 真机验收至少覆盖：登录、患者切换、首页入口、预约目录、预约历史/爽约、门诊费用、报告、普通资料、错误重试，并关联客户端 `requestId`、服务端 `traceId` 和截图/结果。
- [x] 本轮保持旧项目只读；本清单不授权启动旧服务、不改旧数据库、不改旧支付或医保链路。

### P1：完成 5 个代码就绪只读域的真实闭环

- [ ] 就诊人目录：真实微信会话、账号切换、同步成功/空/失败、owner 隔离、Provider 映射和撤销证据。
- [ ] 预约目录/历史：科室、排班、在线/全部历史、爽约状态的 Provider 脱敏样例、时区/窗口、错误/超时和四方链路证据。
- [ ] 报告：目录、owner/patient/TTL 绑定、受限 LIS 详情的成功/空/拒绝/超时证据；PACS/ECG/PEIS 先不要顺手打开。
- [ ] 门诊费用只读：日期窗口、金额单位、患者归属、Provider 错误分类、空结果和请求链路证据；不因列表完成而开放支付。
- [ ] 普通资料：`GET/PUT`、版本冲突、会话代际、拒绝授权和重试证据；不要把微信资料、实名资料、手机号或头像合并进该 contract。

### P1：健康内容发布

- [x] 已提供脱敏旧源快照并放入约定证据目录 `.local/health-knowledge/legacy-source-snapshot.json`（Git 忽略，不进入发布包）；2026-08-31 源审计通过，快照包含 15,668 条索引、8,509 条疾病详情和 1,207 条药品详情，但仍有重复关系、控制字符等质量告警，不能直接作为审核 bundle 或用户可见内容。
- [ ] 修复/审核重复名称、控制字符等内容质量问题，产出有版本、来源、责任人、审核人、生效/下线时间和撤回指纹的 `reviewed-bundle.json`。
- [ ] 完成 bundle 校验、staging 导入、发布/撤回演练、搜索/详情一致性和真机验收；没有 bundle 时保持 `/knowledge` fail-closed。

### P2：临床只读 contract（C 批次）

- [ ] 门诊就诊记录：补齐 `out-visit-records`/`out-emrs` 的脱敏请求、响应、空、拒绝、超时、owner 映射、分页和字段白名单；注册独立的 medical-record domain，不复用预约/报告。
- [ ] 住院信息：确认 episode 权威来源、住院患者映射、状态枚举、门诊/住院隔离和费用边界。
- [ ] 我的医生：确认医生目录、患者关系、失效/解绑、排序分页和展示白名单；不把旧 `my_doctor` 表快照当当前关系。
- [ ] 电子导诊单：确认来源、患者上下文、读取权限、状态、短期资源引用和审计。
- [ ] 每个域分别完成 adapter、domain/service、API、前端状态机、日志、错误契约、测试和真实验收；不能用一份通用 `/clinical` 接口覆盖四域。

### P2：患者与便民 contract（D 批次）

- [ ] 患者绑定/新增：实名查档、建档、绑卡、重复关系、幂等、失败重试、撤回、owner 关系和医护读取。
- [ ] 患者协议：协议版本、同意/撤回/重新同意、数据范围、审计和生效时点。
- [ ] 患者地址：字段白名单、隐私保护、owner、修改幂等和删除语义；当前没有患者地址页面/路由，不要凭旧组件补齐。
- [ ] 患者二维码：服务端生成、签名、用途、TTL、一次性消费和失效；禁止展示 HIS `patId`。
- [ ] 患者签名：签名材料、上传/存储、证据保留、撤回、资源权限和医护读取。
- [ ] 预问诊、出院随访、预约前问诊、风险评估、健康自测：先完成题库/表单版本、适用人群、免责声明、授权、幂等、结果留存/撤回和临床复核，再实现写入。
- [ ] 锦旗/表扬信：内容审核、附件安全、脱敏公开、幂等、撤回和列表/详情公开视图。

### P2：外部入口和实时能力（E 批次）

- [ ] 智能导诊、陪诊、客服、我的问诊：分别确认外部主体、数据受众、短期会话、登录态隔离、退出、回跳、撤销和审计；不能把预约历史改名为问诊。
- [ ] WebSocket：服务端握手和短期引用、消息 schema、患者/owner 归属、心跳、断线补偿和最终事实查询、幂等；禁止 token/patId 放 query。
- [ ] WebView/云影像/报告分享：HTTPS allowlist、短期资源引用、访问期限/次数、回跳、撤销和资源审计；禁止任意 URL 或永久 ticket。
- [ ] 微信订阅消息：模板、用户授权、服务端保存、撤回、发送失败和重试；旧端本地开关不是授权事实。

### P3：支付、医保和 HIS 回写（F 批次，最后处理）

- [ ] 预约写入：锁号 TTL、费用报价、预约登记、幂等、取消、已支付/已就诊/停诊/重复操作状态机和 HIS 回写。
- [ ] 门诊费用明细/收银台/电子账单：资源授权、金额单位、订单归属、短期引用、过期、失败和查单；不恢复旧任意 WebView。
- [ ] 微信支付：平台订单、服务端金额事实、预支付、回调验签解密、查单、关单、重复通知、补偿和最终状态；配置 gate 未完成前保持 503。
- [ ] 医保：授权码生命周期、1101、6201、6202、6301、医保/微信混合支付、查单、退款和回调；所有 provider token、身份证、卡号和 payToken 只在服务端。
- [ ] 云健康/HIS：挂号结算通知、完成、插件支付、退款申请/同步和最终一致性；不能把前端 `requestPayment` 成功或 HTTP 200 当业务成功。
- [ ] Worker：只有完成支付密钥、微信配置、真实 Provider、重试/补偿和回写验收后才打开业务循环；当前的 `not_configured` 是正确的 fail-closed 状态。

## 7. 明确不需要补充、也不应原样迁移的内容

- [x] 不把旧 `module_system`、`module_monitor`、`module_application/job` 的后台管理/运维 CRUD 搬进患者小程序；如未来需要，另立 Admin/Operations 项目和 RBAC/审计边界。
- [x] 不把旧 FastAPI 的通用 CRUD、Swagger、权限依赖、旧数据库模型、Redis/Mongo/文件/调度实现作为新患者端代码复制；新平台已经有自己的 Elysia、domain、adapter、persistence 和 Worker 边界。
- [x] 不迁移 `pages/setting/setData.vue`、`patientChange.bak2`、调试页、旧构建产物和旧接口文档中的示例数据。
- [x] 不迁移 `httpZy.ts`、`ws.ts`、`proxyForward`、任意 `fullUrl`、Provider URL、Provider ID、unionId/openid/session_key、完整卡号/身份证缓存，以及 token query WebSocket。
- [x] 不迁移旧端“查询失败就继续建档”“ID/卡号字段互相冒充”“GET 删除”“无幂等覆盖”“支付页面自行带金额”“HTTP 成功即业务成功”等危险兜底行为。
- [x] 不把旧健康题目、分值、阈值、风险结论、报告解读或 AI 输出当作事实；没有内容/临床责任和版本审核就保持关闭。
- [x] 不要求旧页面和新页面一一同名同路径；多个旧页面合并到一个安全只读页面是已确认的迁移策略，关键是行为边界和状态可追溯。
- [x] 不全量复制旧 `static`/OSS 资源；只保留已核对的本地资源，并补来源、版权、缓存和失效策略即可。

## 8. 后续执行顺序

1. [ ] 先修正当前发布/测试基线和真机证据目录，确认 `dist` 与当前源码一致。
2. [ ] 完成就诊人、预约、报告、门诊费用、普通资料 5 个只读域的 Provider、公网、日志和真机证据。
3. [ ] 完成健康百科审核 bundle 的质量修复、导入、发布和撤回证据。
4. [ ] 按 C/D/E 三条线分别收集正式 contract，逐域实现，不跨域复用患者号、身份证、金额或外部会话。
5. [ ] 最后实现预约写入、支付、医保、退款、Worker 补偿和 HIS 回写，并保留可回滚发布批次。

## 9. 完成判定

某个迁移域只有同时满足以下条件，才可以把对应复选框改为完成：

- 页面入口、API、domain、adapter、persistence/事件边界均已落地；
- 请求/响应/空/拒绝/超时/重试/权限和敏感字段白名单已冻结；
- owner 隔离、错误契约、Pino 低敏日志和测试已通过；
- Provider/临床/外部主体真实证据、公网链路和微信真机证据均可追溯；
- 发布包 source revision、运行目录、文档和部署基线一致；
- 不依赖旧项目运行，不把 mock、空数组、状态页或本地构建当作真实成功。

## 10. 第二轮横向复核（2026-08-31）

这一轮换了数据切换、代码组合、隐私安全、页面收录和事实基线几个角度。以下是上一轮清单中需要进一步单列的事项；旧项目仍只做静态读取，没有启动旧服务或连接旧库。

### 10.1 数据迁移与切换：新增 P0

- [ ] 明确本次是“新库冷启动”还是“保留旧用户/旧业务存量”。当前新库 `hp_*` schema 与旧库 `system_users`、`my_doctor`、`mbs_medical_orders`、便民表和 `knowledge_*` 表没有表级导入关系；仓库也没有通用旧库 backfill、双读、双写或切换脚本。
- [ ] 若保留用户，设计旧 `system_users` 到 `hp_identity_users` 的账户连续性映射、重复/冲突处理、登录首次绑定和回滚方案。旧库的 `openid`、`unionid`、身份证和实名字段不能直接进入小程序或新公共 contract。
- [ ] 若保留患者关系，设计旧患者标识到 `hp_patients` / `hp_patient_provider_references` 的脱敏映射和核对报告；不得把旧 `pat_id`、卡号或目录快照直接当作新端 `patientId`。
- [ ] 对旧 `mbs_medical_orders` / `mbs_payment_events` 与新支付订单、预支付、通知表建立存量策略：待支付、已支付、退款中、失败和重复通知不能靠字段猜测迁入，必须有对账、冻结和人工处置方案。
- [ ] 对旧便民问卷、医生关系、表扬信/锦旗和健康知识分别决定“审核后导入、只存档、不迁移”或“重新建模”；当前健康知识只有专用源快照/审核流程，不能视为通用历史数据迁移能力。
- [ ] 在任何切换前补齐脱敏 staging、导出快照、数量/关系/孤儿记录校验、幂等重跑、审计留痕、旧端只读窗口和失败回滚步骤；没有这些证据时只能按新库冷启动处理。

### 10.2 已有骨架但没有产品闭环：新增 P1/P2

- [ ] `packages/domain/src/medical-records.ts` 与 `packages/adapters/src/zhongyang-medical-records.ts` 目前只是门诊记录 domain/adapter 骨架；它没有接入 `apps/api` 的 service、正式路由、生产组合根、持久化或小程序业务页。`createZhongyangMedicalRecordGateway` 目前也只有 adapter 导出，不能把它计为病历已迁移。
- [ ] `packages/domain/src/patient-write-command.ts` 已有写命令状态机，但没有命令表、repository、业务 service、API 或页面提交链路；患者绑定、协议、地址、二维码、签名、问卷、表扬信和锦旗仍是 contract 待完成，不是“代码已完成”。
- [ ] `packages/domain/src/external-entry-session.ts` 已有外部入口会话校验规则，但没有持久化、消费/撤销 API、外部主体 adapter 或真实回跳链路；不能因有 TTL/状态机就认为互联网医院、客服、问诊、云影像或分享能力已迁移。
- [ ] `apps/worker/src/api-runtime-smoke.ts` 中的 `/medical-records` 相关路径仅属于运行时 smoke/关闭边界测试，不是生产 API；后续新增真实路由时要避免把 smoke 路径和业务入口混淆。

### 10.3 身份、凭据与患者数据安全：新增 P0/P1

- [ ] 旧仓库 Git 跟踪了 `env/.env.prod`、`env/wechat/apiclient_key.pem`、`env/wechat/wechatpay.pem`、小程序环境文件和 `insurance-service/.env`。禁止复制这些文件；确认它们是否曾暴露给不应访问的人员或远程仓库，并按结果吊销/轮换微信、医保和 Provider 凭据。这个判断超出新仓库权限，仍需服务器/代码托管管理员确认。
- [x] 新仓库保持只有模板文件进入 Git；`pnpm secret:audit` 和 `pnpm secret:audit:history` 已完成工作树及可达历史扫描，均未发现真实凭据或私钥原文。扫描只输出定位信息，不输出秘密值，详见 [`docs/security/secret-scan.md`](docs/security/secret-scan.md)。
- [ ] 新 `hp_identity_users` 仍持久化 Provider subject/union id 等身份关联字段；在保留存量账户前确认最小化保留、访问控制、删除/解绑、备份和日志策略，不能只依赖 TypeScript 类型保证隐私。
- [ ] 明确患者目录、Provider 引用、预约快照和报告短期引用的保留期限、失效清理及账户撤回后的处理。当前部分历史引用通过 `inactive`/外键保留，不能默认等同于隐私删除已完成。

### 10.4 页面收录与前后端契约：新增 P1

- [x] 已收窄 `apps/miniprogram/src/sitemap.json`：移除全量 `allow: "*"`，只显式开放医院公开信息、公众号说明、反馈说明和审核健康百科页面，并以 `disallow: "*"` 保护其余患者作用域页面；`acceptance.test.ts` 已锁定公开白名单及健康百科参数。
- [ ] 真实开通前继续逐域核对“页面状态、API 路由、service、adapter、provider 映射、持久化”是否同一版本；尤其不能把患者目录/预约/报告/费用的只读闭环误扩展成病历正文、支付或外部 WebView。
- [ ] 对所有 read-through Provider 域补一份来源权威与新鲜度策略：哪些数据只来自实时 Provider，哪些是快照，TTL/过期/查询失败时是否可展示旧值，不能由页面自行推断。

### 10.5 文档事实源与发布校验：新增 P1

- [x] 已建立机器可读当前基线索引 [`docs/release/current-baseline.json`](docs/release/current-baseline.json)，并由 `pnpm release:baseline:index:audit` 校验；人工文档中的旧候选仅保留为历史追溯，不再作为当前验收入口。
- [x] 已将源码 revision、dist/build-info、API release、schema head 和真实证据批次绑定到同一发布记录；索引审计会在 live `dist` 存在时检查其 sourceRevision，真机证据仍必须逐域采集，不能用 pending 模板宣称完成。
- [x] 已明确本机测试基线：`project.private.config.json` 被 `.gitignore` 忽略，测试在文件存在时校验 `miniprogramRoot=dist/` 和关闭热重载，干净 checkout 缺失时不再因 `undefined` 失败；详见小程序 acceptance test。

### 10.6 本轮确认不需要补充的内容

- [x] 不需要把旧后台 `module_system`、监控、任务调度、保险辅助服务、Java/外部库和通用 CRUD 迁入患者小程序；它们应保持独立项目或明确归档。
- [x] 不需要复制旧端直连 Provider、任意 URL/WebView、token query、完整患者号/卡号和旧支付页面；本轮静态复核未发现这些危险调用进入新小程序生产源码。
- [x] `apps/miniprogram/src/assets/legacy-home` 中未被引用的旧 Tab 图标变体属于资源清理项，不是功能迁移缺口；当前 `app.json` 已明确使用 `v6` 资源，后续可单独清理并做构建回归。

## 11. 第三轮非功能与运行一致性复核（2026-08-31）

这一轮从应用生命周期、系统能力、后台任务、恢复链、运维模板和可复现构建角度重新对照。旧项目仍只做静态读取，没有启动旧服务、旧小程序、旧数据库、Redis 或 Provider。

### 11.1 生命周期和用户可见运营配置：新增 P1

- [ ] 旧端 `hospital-app/src/App.vue` 的 `onShow` 会接收医保小程序回跳并把 `authCode`、`extraData` 写入全局状态，甚至直接输出到日志；新端没有复制这条回跳链，这是正确的安全边界，但必须由产品确认医保回跳是“明确下线”还是后续按新 contract 重做。不得恢复旧的原始授权码日志行为。
- [ ] 旧端和新端反馈页都硬编码客服电话 `13835627395` 与工作时间 `工作日 08:00-17:00`；确认号码、时段、归属人和变更流程仍然有效。当前反馈点击仍只是 Toast，不能让用户误以为已经提交工单；正式开通前应把客服配置收归一个可审计来源，不要在两个小程序包中重复维护。
- [ ] 旧 `manifest.json` 还包含医保小程序 AppID、关闭 `urlCheck` 和多端原生权限；新项目目标是原生微信小程序，当前不需要迁移 Android/iOS 权限或旧 `urlCheck=false`。若未来重新支持医保/原生端，须另做平台安全审核，不按旧配置直接复制。

### 11.2 后台任务、恢复和运维闭环：新增 P1

- [ ] 旧 FastAPI 启动时会加载数据库中的 APScheduler 任务，并单独启动 `plugin_payment_reconcile_loop`，后者会扫描“微信预支付已创建但云健康/HIS 未完成回写”的订单并继续完成结算。新 Worker 目前只实现微信通知 handler 和微信查单，没有对应的云健康/HIS 插件恢复 handler；支付/HIS 批次开启前必须明确逐项替代、存量迁移和人工补偿方案。
- [x] 已为 `OutboxWorker` 和 `PaymentReconciliationWorker` 增加 12 次自动重试上限；达到上限后分别落库为 `manual_review`，清除下一次自动调度，并输出可检索的人工接管日志。新迁移为 `0017_outbox_manual_review_state`，尚未执行到生产库。
- [x] 已补齐人工复核队列的低敏查询、告警检查和单条受控重放：`apps/worker/src/manual-review.ts` 提供 `list`、`check` 和要求固定原因码及 `--confirm` 的 `requeue`；`check` 以退出码 `2` 暴露队列积压，仓储使用状态条件更新且不重置累计尝试次数。对应手册见 [`docs/release/manual-review-operations.md`](docs/release/manual-review-operations.md)。这些能力完成并取得生产证据前，支付/HIS gate 继续关闭。
- [x] 已确认 `payment-order.created`、`payment-order.state-changed` 是内部审计事件，不直接触发 Provider；Worker 组合根已显式注册经过 payload/金额/状态校验的归档 handler，并输出 `worker.outbox.audit_event_archived`，损坏事件仍会失败并进入重试/人工复核。这样支付 gate 打开后不会因缺 handler 无限重试，也不会把归档成功误报为支付成功。
- [ ] 旧任务管理 CRUD 与示例任务本身可以不迁入患者小程序，但切换前仍要盘点旧库中实际启用的任务记录，逐条标记“退休、保留在旧系统或改写到新 Worker”；不能仅因为后台 `/job` 路由不迁移，就推断没有业务定时任务。
- [ ] 现有迁移恢复手册覆盖 MySQL DDL 的非事务性、schema probe 和失败止损，但尚未形成清晰的生产 MySQL 备份、binlog/PITR、恢复演练、保留周期、RPO/RTO 和告警记录。新旧切换前补齐；同时明确 Redis 会话可过期重建，而支付/订单/outbox 数据必须按数据库恢复策略处理。
- [ ] 为 API/Worker 的 readiness、`not_configured`、`not_ready`、outbox 重试堆积、查单长期 pending、Provider 错误率/延迟和恢复失败建立实际监控/告警规则。当前结构化日志和 trace 只提供检索基础，不能单独证明已具备自动发现和恢复能力。

### 11.3 环境模板与构建可复现性：新增 P1/P2

- [x] 已统一 schema gate 文案：根目录 `.env.example` 与 `infra/systemd/api.env.example` 均引用 `packages/persistence/src/migrate.ts` 的完整迁移清单，并明确当前 migration head 为 `0017_outbox_manual_review_state`；两处均保留 `PERSISTENCE_SCHEMA_READY` 仅作显式 gate、不是自动迁移开关的说明。
- [x] 已明确 `.env.example` 是开发/测试 API 与本地 Worker 模板，`infra/systemd/api.env.example` 是生产 API unit 模板；公共配置以 `packages/config/src/index.ts` 为准，`pnpm env:template:audit` 校验两份模板的职责边界、生产安全默认值和敏感值占位符。`pnpm runtime:preflight` 已用于真实配置的只读依赖探针，生产执行仍必须在服务器受控 shell 中完成。详见 [`infra/README.md`](infra/README.md)。
- [x] 已建立 GitHub Actions CI，锁定 `.node-version=24.12.0`、`.bun-version=1.4.0`、`pnpm@11.9.0`，使用 `pnpm install --frozen-lockfile` 执行 `pnpm check:candidate`；`pnpm toolchain:audit` 会校验版本文件、`package.json` 和 workflow 的一致性。详见 [`docs/release/ci-and-toolchain-baseline.md`](docs/release/ci-and-toolchain-baseline.md)。
- [ ] 生产发布执行器仍保持手动受控：当前服务端 release 之后有未部署运行时代码漂移，且旧 Python 服务必须共存；在补齐受控发布窗口、回滚和线上证据前，不自动化切换或重启线上服务。
- [x] 当前小程序源码与 `dist/build-info.json` 的来源 revision `935410473e5a7c1be125a85834f957f53a833d8f`（`9354104`）已对齐；来源指纹只包含实际影响小程序产物的源码、构建/发布器、共享 contract 和锁文件，根目录工作区脚本及来源元数据脚本不会制造客户端候选漂移。`docs/release/current-baseline.json` 已把 source revision、dist revision、API release、schema head 和真实设备证据清单绑定到一份机器可读发布记录。真实设备证据仍保持 pending，不得把索引绑定误报为业务验收通过。

### 11.4 本轮确认不需要补充

- [x] 不需要把旧 `App.onHide` 空实现、旧端未发现的 update-manager/location/scanCode 等系统能力人为补回；应以新端目标平台和实际需求为准。
- [x] 不需要复制旧医保回跳中的原始 token/授权码、旧直连 Provider、旧任意 WebView、旧多端权限或旧调度器实现；这些是待 contract/安全审核或独立运维边界，不是患者小程序的直接迁移目标。
- [x] 不需要把旧示例 `app/module_task/scheduler_test.py` 当成真实业务任务迁移；只需要完成上一节所述的旧库已启用任务记录盘点和去留确认。
