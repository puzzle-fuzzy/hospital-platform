# 旧接口逐项迁移快照

> 盘点时间：2026-08-16。来源为旧 FastAPI 服务 `G:\\fuck\\hospital` 和旧 uni-app 小程序
> `G:\\fuck\\hospital\\hospital-app`。本文记录“代码曾经观察到的调用事实”，不是 provider
> 合同，也不是新服务的可调用清单。新服务能调用什么，以
> [`api-v2-public.md`](../api-v2-public.md) 和源码 OpenAPI 门禁为准。

## 1. 使用规则

旧项目同时存在三类路径，不能混为一谈：

1. 旧 Python 自有 API：由旧服务的 FastAPI controller 注册，通常使用 `/system`、`/common`、
   `/convenience`、`/knowledge`、`/intelligent` 等前缀。
2. 旧小程序直连 provider：由 `httpZy.ts`、`medical-insurance.ts` 等模块直接拼接众阳/云健康
   地址。它们不是新服务的公共 API，不能因为旧页面曾经请求过就直接暴露给新小程序。
3. 旧页面导航和 WebSocket：它们可能没有 HTTP API，仍然需要单独记录会话、权限、资源授权和
   断线重连语义，不能只复制一个 URL。

状态含义：

- `代码已迁移（只读）`：新服务已有业务 contract、adapter、API 和测试；provider、公网或真机
  证据仍要看对应 gate 和验收文档。
- `部分迁移`：只迁移了安全的目录/摘要，详情、写入、附件或状态回写仍关闭。
- `待 provider contract`：旧代码只有请求事实，缺少当前环境可验证的字段、权限、状态和错误
  语义；保持未注册。
- `最后处理`：支付、医保、退款、回调或 HIS 回写，必须在只读链路稳定后处理。
- `后台/运维边界`：旧接口继续由旧服务承担，未来建立独立 Admin/Operations API，不进入患者端。

## 2. 旧小程序直接使用过的 provider endpoint

### 2.1 患者目录、建档和绑定

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `GET /api/public/patientInfoByUnionId` | `api/modules/ZY.ts` | 代码已迁移（只读） | 新服务只从服务端微信身份读取 unionId；小程序不提交 unionId，响应只映射为脱敏患者目录。 |
| `GET /msun-middle-aggregate-patient/v1/patInfosFind` | `api/modules/ZY.ts` | 待 provider contract | 旧端档案查询依赖 provider 患者字段；新服务尚未把完整身份证、手机号或 provider 患者号放入公共 contract。 |
| `POST /msun-middle-aggregate-patient/v1/patients` | `api/modules/ZY.ts` | 待 provider contract | 真实建档需要身份证、卡号、手机号、关系和幂等/重复建档语义；不能用“同步目录”冒充新增成功。 |
| `POST /msun-middle-aggregate-patient/v1/patCards` | `api/modules/ZY.ts` | 待 provider contract | 绑卡必须校验当前平台用户、卡号所有权、重复绑定和撤销语义；当前只支持目录读取。 |

### 2.2 预约目录、号源和预约写入

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `GET /msun-middle-business-amc-server/v1/first-depts` | `api/modules/appointment.ts` | 待 provider contract | 旧端一级/二级科室树；新端当前只使用经过白名单处理的排班科室读模型。 |
| `GET /msun-middle-business-amc-server/v1/schedulings/scheduling-depts` | `api/modules/appointment.ts` | 代码已迁移（只读） | 新服务固定渠道和未来时间窗口，不允许小程序透传任意 provider query。 |
| `GET /msun-middle-business-amc-server/v1/schedulings/scheduling-doctors` | `api/modules/appointment.ts` | 待 provider contract | 医生电话、照片、医保编码和擅长信息不能从旧响应直接公开；需重新确认展示白名单。 |
| `GET /msun-middle-business-amc-server/v1/schedulings` | `api/modules/appointment.ts` | 代码已迁移（只读） | 新服务只返回规范化排班和号源摘要，不返回挂号费或 provider 原始字段。 |
| `GET /msun-middle-business-amc-server/v1/schedulings/{id}` | `api/modules/appointment.ts` | 待 provider contract | 排班详情不能把 opaque `scheduleId` 直接当作 provider ID 使用；需要引用有效期和归属校验。 |
| `GET /msun-middle-business-amc-server/v1/sources` | `api/modules/appointment.ts` | 待 provider contract | 号源列表需要确认分页、实时性、过期和重复读取语义。 |
| `GET /msun-middle-business-amc-server/v1/sources/{hisScheduleId}` | `api/modules/appointment.ts` | 待 provider contract | 分时段号源只读展示也必须确认时间段时区和号源隐藏规则。 |
| `POST /msun-middle-business-amc-server/v1/sources/locked-sources` | `api/modules/appointment.ts` | 待 provider contract | 锁号 TTL、释放、并发冲突和超时后查状态均未冻结；不能直接开放。 |
| `GET /msun-middle-business-appointment-server/v1/appointment-infos/fact-register-fee` | `api/modules/appointment.ts` | 待 provider contract | 费用单位和报价有效期未知，不能把旧页面金额作为支付金额。 |
| `POST /msun-middle-business-appointment-server/v1/appointment-infos` | `api/modules/appointment.ts` | 待 provider contract | 旧 payload 混合 provider 患者号、身份证、电话、挂号费、支付状态和渠道字段；新端必须重新编排。 |
| `POST /msun-middle-business-appointment-server/v1/appointment-infos/d` | `api/modules/appointment.ts` | 待 provider contract | 取消必须使用服务端保存的预约映射，并明确已支付、已就诊、停诊和重复取消分支。 |
| `GET /msun-middle-business-appointment-server/v1/appointment-infos/{pat-id}` | `api/modules/appointment.ts`、`ZY.ts` | 代码已迁移（只读） | 新端固定预约历史查询渠道和日期语义；provider 专用预约患者映射仍需真实环境证据。 |
| `GET /msun-middle-business-appointment-server/v1/appointment-infos/{id}` | `api/modules/appointment.ts` | 待 provider contract | 详情字段包含支付、HIS 挂号号和患者敏感字段，不能直接映射到患者端。 |

旧端还声明了 `/msun-websocket-server/**` 的停诊推送基础路径。该路径没有在新端迁移；如
未来需要实时停诊，必须先定义 WebSocket 鉴权、患者/排班归属、断线重连和消息版本。

### 2.3 报告、病历、住院和门诊记录

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `GET /msun-middle-business-lis/v1/lis-reports-filter` | `api/modules/ZY.ts` | 代码已迁移（只读） | 新端返回脱敏报告目录；provider 报告号只留在服务端短期引用中。 |
| `GET /msun-middle-business-pacs/v1/exclude-privacy-patient-reports` | `api/modules/ZY.ts` | 部分迁移 | 已进入报告目录 adapter；附件、影像详情和资源授权仍关闭。 |
| `GET /msun-middle-business-ecg/v2/ecg-reports` | `api/modules/ZY.ts` | 部分迁移 | 已进入报告目录 adapter；详情和原始报告资源仍关闭。 |
| `GET /msun-middle-business-lis/v1/lis-reports/details` | `api/modules/ZY.ts` | 部分迁移 | 只有 LIS 白名单详情可在独立 gate 下开放；不返回原始 JSON、患者字段或文件 URL。 |
| `POST /msun-peis-app-peis-new/v1/find-report-list-for-wechat` | `api/modules/ZY.ts` | 待 provider contract | 旧接口依赖完整身份证号和 hospitalId；新患者模型不保存完整身份证，当前不迁移。 |
| `GET /msun-middle-aggregate-clinic/v1/out-emrs` | `api/modules/medicalRecord.ts` | 待 provider contract | 门诊电子病历目录需要单独确认患者归属、就诊记录 ID、分页/排序和可公开字段，不能由预约历史或报告目录代替；边界审计见 [`medical-record-and-hospital-boundary.md`](medical-record-and-hospital-boundary.md)。 |
| `POST /msun-middle-aggregate-clinic/v1/out-visit-records` | `api/modules/ZY.ts`、`medicalRecord.ts` | 待 provider contract | 门诊病历/就诊记录需要区分目录、内容和结构化数据的授权与脱敏，不与预约历史混用。 |
| `POST /msun-middle-aggregate-zyemr/v1/m-records/mr-menus` | `api/modules/medicalRecord.ts` | 待 provider contract | 住院病历目录字段含病历内容、签名和内部 ID，不能直接透传。 |
| `GET /msun-middle-aggregate-zyemr/v1/m-records/mr-contents` | `api/modules/medicalRecord.ts` | 待 provider contract | 病历正文需要资源权限、审计、下载/预览策略和敏感字段白名单。 |
| `GET /msun-middle-aggregate-zyemr/v1/m-records/mr-content-structs` | `api/modules/medicalRecord.ts` | 待 provider contract | 结构化病历需要确认元素版本和可公开字段。 |
| `GET /msun-middle-aggregate-hsz/v1/patients` | `api/modules/medicalRecord.ts` | 待 provider contract | 住院患者列表需要住院身份映射和当前住院状态，不能用门诊患者目录替代。 |
| `GET /msun-middle-open-settlepay/v1/inpatient-settle-singles/inpatient-in-day-singles` | `api/modules/medicalRecord.ts` | 最后处理 | 住院费用包含医保项目和诊断等敏感字段，必须与住院结算 contract 一起设计。 |

### 2.4 门诊费用、支付和结算

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `GET /msun-middle-open-settlepay/v1/outpatient-payments/out-pay-visit-records` | `api/modules/payment.ts` | 待 provider contract | 旧接口是另一种待支付就诊视图，新端当前只接入子项目费用目录。 |
| `GET /msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records` | `api/modules/payment.ts` | 代码已迁移（只读） | 服务端固定最近 30 个中国标准时间日和 `authSysCode`，金额转换后才进入展示模型。 |
| `GET /msun-middle-open-settlepay/v1/outpatient-settle-singles/outpatient-cost-details` | `api/modules/payment.ts` | 待 provider contract | 费用明细包含身份证、卡号、医保分类和结算单号，必须先完成脱敏与金额审计。 |
| `POST /msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle` | `api/modules/payment.ts` | 最后处理 | 这是结算创建，不是支付调起；需要服务端报价、幂等键和最终状态查询。 |
| `POST /msun-middle-open-settlepay/api/v2/open/payment/pre-order` | `api/modules/payment.ts` | 最后处理 | 不能由小程序提交总额、支付方式参数或支付用户标识；新端必须由服务端订单事实编排。 |
| `POST /msun-middle-open-settlepay/api/v2/open/payment/complete-settle` | `api/modules/payment.ts` | 最后处理 | 只有权威支付/医保终态满足条件后才允许完成结算。 |
| `POST /msun-middle-open-settlepay/api/v2/open/payment/pay-close` | `api/modules/payment.ts` | 最后处理 | 关单不能代替查单；未知状态必须先确认 provider 最终状态。 |
| `POST /msun-middle-open-settlepay/api/v2/open/settle/cancel-settle` | `api/modules/payment.ts` | 最后处理 | 取消结算必须绑定平台订单和当前可迁移状态，不能依据页面返回直接取消。 |
| `GET /msun-yb-app-miop/v1/out-insur-settle-infos` | `api/modules/payment.ts` | 最后处理 | 医保结算信息只能由服务端读取并校验订单归属和金额。 |
| `POST /msun-yb-app-miop/outSettle/v2/settle-info/notify` | `api/modules/payment.ts` | 最后处理 | 这是医保结果写回 HIS 的边界，不作为小程序直连接口。 |
| `POST /common/yunhealth/registration/medical-settlement-notify` | `api/modules/payment.ts`、旧 Python `module_common/yunhealth_settle` | 最后处理 | 只允许内部结算编排接收已验证的医保结果；必须绑定平台订单、幂等键和回写审计，不能由小程序直接调用。 |
| `POST /common/yunhealth/registration/medical-settlement-complete` | `api/modules/payment.ts`、旧 Python `module_common/yunhealth_settle` | 最后处理 | 只有权威医保回写成功后才允许完成挂号结算；未知状态不得自动完成或撤销。 |

### 2.5 医保授权、FSI 和微信医保混合支付

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `POST /common/mip-user-query` | `api/modules/medical-insurance.ts` | 最后处理 | 授权码只能在服务端兑换；前端不得传 provider token，也不能把授权结果当作结算成功。 |
| `GET /msun-middle-base-common/v1/depts` | `api/modules/medical-insurance.ts` | 待 provider contract | 医保科室编码查询不能让小程序自行决定 6201 的 `caty`；必须由服务端按已确认的科室映射使用。 |
| `GET /msun-middle-base-common/v1/users` | `api/modules/medical-insurance.ts` | 待 provider contract | 医保医师编码查询属于服务端映射数据，不把 provider 用户编码或原始用户信息返回小程序。 |
| `POST /common/mbs-fsi/1101` | `api/modules/medical-insurance.ts` | 最后处理 | 参保人信息是敏感医保数据，必须绑定平台患者和授权有效期。 |
| `POST /common/mbs-fsi/6201` | `api/modules/medical-insurance.ts` | 最后处理 | 费用明细、金额守恒、payToken 和凭证只留在服务端。 |
| `POST /common/mbs-fsi/6202` | `api/modules/medical-insurance.ts` | 最后处理 | `ordStas` 不是最终成功证明，必须按 6301/权威结算状态继续确认。 |
| `POST /common/mbs-fsi/6301` | `api/modules/medical-insurance.ts` | 最后处理 | 查单是最终状态确认的一部分，未知状态必须可重试和可人工对账。 |
| `POST /common/mbs-fsi/wechat-med-ins/self-pay-order` | `api/modules/medical-insurance.ts` | 最后处理 | 微信 APIv3 参数、openid、商户密钥和回调全部收回服务端。 |
| `POST /common/mbs-fsi/wechat-med-ins/mix-order` | `api/modules/medical-insurance.ts` | 最后处理 | 混合支付金额必须来自 6201/6202 和平台订单，不接受前端金额覆盖。 |
| `GET /common/mbs-fsi/wechat-med-ins/mix-order/{mix-trade-no}` | `api/modules/medical-insurance.ts` | 最后处理 | 查询必须按平台订单映射 provider 订单，不能接受任意外部订单号。 |
| `GET /common/mbs-fsi/wechat-med-ins/mix-order/by-out-trade-no/{out-trade-no}` | `api/modules/medical-insurance.ts`、旧 Python `mbs_fsi/controller.py` | 最后处理 | 按商户订单号查单只能由服务端通过平台订单映射调用；不能接受小程序任意外部订单号。 |
| `GET /common/mbs-fsi/wechat-med-ins/self-pay-order/{out-trade-no}` | `api/modules/medical-insurance.ts`、旧 Python `mbs_fsi/controller.py` | 最后处理 | 自费订单查单必须绑定内部支付订单、openid 归属和 provider 最终状态。 |
| `POST /common/mbs-fsi/wechat-med-ins/close/{out-trade-no}` | `api/modules/medical-insurance.ts`、旧 Python `mbs_fsi/controller.py` | 最后处理 | 关单不能替代查单；未知状态或已支付订单不得直接关闭。 |
| `POST /common/mbs-fsi/wechat-med-ins/refund` | `api/modules/medical-insurance.ts`、旧 Python `mbs_fsi/controller.py` | 最后处理 | 退款金额必须绑定已落库订单和可退款状态，不能接受页面自行计算的金额。 |
| `POST /common/mbs-fsi/wechat-med-ins/medical-refund-notify` | 旧 Python `mbs_fsi/controller.py` | 最后处理 | 医保退款结果通知必须验签、去重并进入事件/补偿流程，不能直接修改患者端状态。 |
| `POST /common/mbs-fsi/wechat-med-ins/self-pay-notify` | 旧 Python `mbs_fsi/controller.py` | 最后处理 | 自费支付通知必须验签解密、按商户订单映射落库，并通过查单确认最终状态。 |
| `POST /common/mbs-fsi/wechat-med-ins/notify` | 旧 Python `mbs_fsi/controller.py` | 最后处理 | 混合支付通知不得作为前端成功回调；必须校验金额、订单归属和重复通知。 |
| `POST /common/mbs-fsi/wechat-med-ins/refund-notify` | 旧 Python `mbs_fsi/controller.py` | 最后处理 | 退款通知必须与原支付订单及退款金额关联，失败进入人工/补偿队列。 |

医保小程序跳转授权还使用国家医保小程序 appId 和回跳 `authCode`。这不是普通 HTTP API：
后续必须同时冻结目标小程序版本、`bizType`、城市/机构参数、回跳字段、授权码 TTL、一次性
消费和撤销规则。当前不把旧前端硬编码参数作为新 contract。

### 2.6 健康知识、便民和 AI

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `GET /knowledge/health/part/list` | `api/modules/health.ts` | 待 provider contract | 内容必须有版本、来源、审核人、生效/下线时间；不能直接复制旧库正文。 |
| `GET /knowledge/health/crowd/list` | `api/modules/health.ts` | 待 provider contract | 人群分类属于医疗内容导航，必须有版本和审核来源。 |
| `GET /knowledge/health/department/list` | `api/modules/health.ts` | 待 provider contract | 科室分类必须有版本和审核来源，不能把旧科室 ID 当作新公共 ID。 |
| `GET /knowledge/health/symptoms/list/part/{part_id}` | `api/modules/health.ts` | 待 provider contract | 症状/疾病关联属于医疗内容，需内容审核和查询版本。 |
| `GET /knowledge/health/disease/list/part/{part_id}` | `api/modules/health.ts` | 待 provider contract | 只允许审核后的疾病目录，不能把旧 ID 作为新公共 ID。 |
| `GET /knowledge/health/disease/list/crowd/{crowd_id}` | `api/modules/health.ts` | 待 provider contract | 只允许审核后的疾病目录，不能把旧 ID 作为新公共 ID。 |
| `GET /knowledge/health/disease/list/department/{department_id}` | `api/modules/health.ts` | 待 provider contract | 只允许审核后的疾病目录，不能把旧 ID 作为新公共 ID。 |
| `GET /knowledge/health/disease/list/symptoms` | `api/modules/health.ts` | 待 provider contract | 多值查询和排序语义需在新 contract 中固定。 |
| `GET /knowledge/health/disease/detail/{disease_id}` | `api/modules/health.ts` | 待 provider contract | 详情需免责声明、版本和紧急下线；不能作为诊断或用药建议。 |
| `GET /knowledge/health/drug/detail/{drug_id}` | `api/modules/health.ts` | 待 provider contract | 药品详情需免责声明、版本和紧急下线；不能作为个体化用药建议。 |
| `GET /knowledge/selftest/questions/{id}`、`POST /knowledge/selftest/assessment` | `api/modules/selfTest.ts` | 待 provider contract | 题库、评分、结果区间和临床复核必须版本化。 |
| `POST /knowledge/report/interpretation` | `api/modules/ZY.ts` | 待 provider contract | AI 解读必须关联报告版本、模型/知识版本、免责声明和审计；不从报告目录顺手开放。 |
| `GET /convenience/risk-assessment/list` | `api/modules/health.ts` | 待 provider contract | 患者授权、问卷版本、结果保存和医疗免责声明缺一不可。 |
| `POST /convenience/risk-assessment/create` | `api/modules/health.ts` | 待 provider contract | 提交必须绑定问卷版本、患者归属、幂等键和结果审计。 |
| `GET /convenience/discharge-follow-up/list` | `api/modules/health.ts` | 待 provider contract | 需要病区/患者归属和医护侧读取权限，不能只复制表单 JSON。 |
| `POST /convenience/discharge-follow-up/create` | `api/modules/health.ts` | 待 provider contract | 提交必须绑定出院事件、随访任务、幂等键和结果审计。 |
| `GET /convenience/admission-preconsultation/list` | `api/modules/health.ts` | 待 provider contract | 问卷版本、临床读取权限和敏感字段需单独冻结。 |
| `POST /convenience/admission-preconsultation/submit` | `api/modules/health.ts` | 待 provider contract | 提交必须绑定患者上下文、问卷版本、幂等键和临床读取权限。 |
| `POST /msun-hzzn-app-config/v1/saveBeforeVisitRecord` | `api/modules/health.ts` | 待 provider contract | 预问诊保存需要把预约/挂号映射、问卷版本和临床读取权限绑定，不能从旧页面直接透传。 |
| `GET /convenience/commendatory-letter/list` | `api/modules/commendatoryLetter.ts` | 待 provider contract | 内容安全、公开范围、患者归属和审核记录需要完整 contract。 |
| `POST /convenience/commendatory-letter/create` | `api/modules/commendatoryLetter.ts` | 待 provider contract | 提交必须绑定患者归属、幂等键、内容审核和公开范围。 |
| `GET /convenience/silk-banner/list` | `api/modules/silkBanner.ts` | 待 provider contract | 内容审核、公开范围和撤回规则未确认。 |
| `POST /convenience/silk-banner/create` | `api/modules/silkBanner.ts` | 待 provider contract | 提交必须绑定患者归属、文件安全检查、幂等键和审核记录。 |
| `GET /convenience/my-doctor/list` | `api/modules/user.ts` | 待 provider contract | 我的医生关系需要患者归属、医生来源、取消关注和数据保留规则；不能把旧用户字段直接迁移。 |
| `POST /convenience/my-doctor/create` | `api/modules/user.ts` | 待 provider contract | 关注写入必须使用服务端患者/医生映射、幂等键和重复关系处理。 |
| `GET /convenience/my-doctor/delete?doctor_id=xxx` | `api/modules/user.ts` | 待 provider contract | 旧端使用 GET 执行删除；新 contract 必须重新定义命令语义、鉴权、幂等和审计，不能照搬破坏性 GET。 |
| `GET /intelligent/treatment_companion/history` | `api/modules/companion.ts` | 待 provider contract | 新端预约历史不能直接当作 AI 陪诊历史；需要会话和数据来源边界。 |
| `GET /shift-scheduling/queue-position/{deptId}/{patId}` | `api/modules/companion.ts` | 待 provider contract | 旧端根据环境变量拼接直连路径；新端必须确认队列数据来源、患者归属、实时性和隐私边界。 |
| `GET /intelligent/treatment_companion/appointment` | 旧 `controller.py` | 待 provider contract | 未来就诊需独立会话 owner 和当前患者上下文。 |
| `WS /intelligent/treatment_companion/today_ws` | 旧 `controller.py` | 待 provider contract | 需要 WebSocket 鉴权、断线重连、消息版本和实时 HIS 数据授权。 |
| `POST /intelligent/outpatient_recommend/chat_text|chat_audio` | 旧 `controller.py` | 待 provider contract | 音频、会话、模型、免责声明、限流和内容审计未冻结。 |
| `GET /intelligent/outpatient_recommend/document_list` | 旧 `controller.py` | 待 provider contract | 返回的知识来源和科室目录必须版本化。 |
| `POST /intelligent/customer_service/chat_text|chat_audio` | 旧 `controller.py` | 待 provider contract | 客服和导诊不能共用未经审计的 prompt、模型或会话存储。 |

旧 `module_intelligent/urls_rag.py` 中的 `POST /document/create-by-file` 没有被当前
`module_intelligent/__init__.py` 挂载，属于源码中存在但未注册的孤立实现，不计入旧患者端
可用接口；未来如要开放，必须走独立管理端权限和文件安全审核。

### 2.7 旧服务自有的登录和个人中心调用

| 旧 endpoint | 旧来源 | 新端状态 | 业务边界 |
| --- | --- | --- | --- |
| `POST /system/auth/login/wechat` | `api/modules/user.ts` | 代码已迁移（只读） | 新端改为 `POST /api/v2/auth/wechat`；只接收一次性 wx.login code，不返回 provider 身份凭据。 |
| `GET /system/user/current/info` | `api/modules/user.ts` | 代码已迁移（只读） | 新端改为 `GET /api/v2/me`，只返回内部用户 ID。个人资料扩展、实名资料、头像和患者绑定不能由此接口顺带开放。 |
| `POST /system/auth/ticket` | `pagesB/health/webview.vue` | 待 provider contract | 旧实现把原始 access token 存入 Redis 并由 verify 返回；新端必须改为固定 audience、最小 scope、一次性引用和后端校验，不能继续把 JWT/平台 token 交给外部页面。 |
| `GET /system/auth/ticket/verify` | 旧 FastAPI `module_system/auth/controller.py` | 待 provider contract | 需要明确票据一次性消费、受众、TTL、资源 owner、回调和重放处理；当前不在新患者端公共 API 中。 |
| `PUT /system/user/current/info/update` | `api/modules/user.ts` | 待 provider contract | 个人资料、实名资料和微信身份字段必须拆分；不能接收旧端的 `openid`/`unionid`/身份证字段作为客户端输入；详见 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md)。 |
| `POST /system/user/current/avatar/upload` | `api/modules/user.ts` | 待 provider contract | 需要对象存储、文件检查、owner/TTL 下载和内容安全；不能直接信任/公开 `file_url`，当前不迁移。 |

## 3. 旧 Python 服务自身的患者相关路由

### 3.1 旧 FastAPI 路由基线

按旧仓库 `app/api/v1/__init__.py` 的 include 关系和 controller 路由装饰器做静态扫描，旧服务的
路由规模如下。这里的数量是迁移盘点证据，不代表这些路由都应该进入新患者端 API：

| 旧模块 | 静态路由数量 | 新端边界 |
| --- | ---: | --- |
| `module_system` | 88 | Admin API；患者端只单独迁移微信登录和最小当前用户视图 |
| `module_monitor` | 20 | Operations API；不进入患者端 |
| `module_application` | 14 | Worker/Operations API；不让患者会话管理任务 |
| `module_common` | 33 | 文件、医保、支付和内部结算；按独立 contract 最后迁移 |
| `module_convenience` | 13 | 便民业务逐域迁移；需要患者授权、内容/临床审核和医护侧权限 |
| `module_intelligent` | 8 | AI/实时会话逐域迁移；需要 WebSocket、模型、知识版本和审计 contract |
| `module_knowledge` | 15 | 健康内容、报告解读、自测；需要版本化导入和临床审核 |
| **已挂载静态合计** | **191** | 不得用万能转发代替迁移 |

静态扫描另发现 `module_intelligent/urls_rag.py` 的 `POST /document/create-by-file` 1 个装饰器，
但它没有被 `module_intelligent/__init__.py` 挂载，因此不计入上面的 191 个实际挂载路由；未来若开放，
必须作为管理端文件导入能力重新设计权限、对象存储、内容安全和审计。旧服务的 8001 端口继续保留，
新 Elysia 不复用这些 Admin/Operations controller。

以下路径是旧 FastAPI controller 的实际注册事实。它们继续由旧服务承担，不能直接成为新
小程序的兼容转发：

| 旧路由族 | 观察到的叶子路径 | 新端处理 |
| --- | --- | --- |
| `/common/file` | `POST /upload`、`POST /download` | 待对象存储、病毒扫描、owner/TTL 授权和审计后再迁移 |
| `/common/mbs-fsi` | `GET /test`、`POST /call`、`9001`、`1101`、`2201`、`2206A`、`2207A`、`s601`、`s602`、`s603`、`s605`、`6201`、`6202`、`6203`、`6301`、`6302`、`6401` | 最后处理；禁止万能 FSI 转发 |
| `/common/mbs-fsi/wechat-med-ins` | 自费/混合下单、查单、关单、退款和支付通知 | 最后处理；回调验签、去重、查单和订单状态机必须先落库 |
| `/common/mip-user-query` | `POST /` | 最后处理；只允许服务端使用授权上下文调用 |
| `/common/yunhealth/registration` | `POST /medical-settlement-notify`、`POST /medical-settlement-complete` | 最后处理；只允许内部结算编排调用 |
| `/convenience` | 13 个表扬信、锦旗、风险评估、我的医生、出院随访、入院预问诊的 list/create/submit/delete 路由 | 待各业务 contract、内容审核和权限确认；旧字段风险、覆盖逻辑、幂等和日志门禁见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| `/knowledge` | tips、health、selftest、report interpretation/stream | 待版本化内容、临床复核和资源授权 |
| `/intelligent` | 陪诊、导诊、客服、WebSocket | 待会话、模型、知识版本、免责声明和审计 |

旧服务还包括 `/system`、`/monitor` 和 `/application/job` 管理/运维 API。它们属于独立
Admin/Operations 边界，当前不计入患者端迁移完成度；新端若建设管理后台，必须单独设计 RBAC、
审计、网络隔离和管理员验收。

## 4. 与新公共 API 的对应关系

当前已经注册的新公共 API 只覆盖以下安全读模型和基础设施：

| 旧能力 | 新公共入口 | 迁移结论 |
| --- | --- | --- |
| 微信登录 | `POST /api/v2/auth/wechat` | 已完成代码边界；真实凭据、schema、Redis 和真机证据仍单独验收 |
| 当前用户 | `GET /api/v2/me` | 只返回内部用户 ID，不返回 openid/unionid |
| 患者目录 | `GET /api/v2/patients`、`POST /api/v2/patients/sync` | 完整目录快照、active/inactive 和 owner 隔离已进入代码；新增/绑卡仍关闭 |
| 预约目录 | `GET /api/v2/appointments/departments`、`GET /api/v2/appointments/schedules` | 只读目录已实现；号源锁定、预约写入、取消和挂号费关闭 |
| 预约历史 | `GET /api/v2/appointments/records` | 只读摘要已实现；provider 专用患者映射和真实环境仍需验收 |
| 报告目录/检验详情 | `GET /api/v2/reports`、`GET /api/v2/reports/{reportId}` | 目录已按来源分层；只有 gated LIS 白名单详情，附件/体检/原始报告关闭 |
| 门诊费用目录 | `GET /api/v2/payments/outpatient/records` | 只读列表已实现；费用详情、支付、医保和 HIS 回写关闭 |
| 微信支付基础设施 | `/api/v2/payments/orders*`、`/api/v2/payments/wechat/notifications` | 代码和 fail-closed gate 已实现；不能据此宣称真实支付完成 |

新 API 的完整输入、输出、错误码和认证规则见 [`../api-v2-public.md`](../api-v2-public.md)。
本文件中的旧 endpoint 不得被当作新 API 的 fallback。

## 5. 下一步实施顺序与业务不变量

1. 先完成当前只读纵向切片的真实证据：患者目录、预约目录/历史、报告目录、门诊费用，分别
   经过 provider、内网、公网和真机四层验证。
2. 新 provider 文档到达后，按“原始 endpoint → 字段差异 → 新 domain contract → adapter →
   API → 小程序 → 日志 → 验收”逐接口闭环；文档未说明的字段不进入公共 contract。
3. 优先选择病历目录或医院列表这种只读域完成一条新闭环；病历正文、附件、住院费用和 AI
   不因为目录接口存在而顺手开放。
4. 最后处理现金支付、医保授权/6201/6202/6301、退款/撤销、微信回调和 HIS 回写。6202 返回、
   微信调起成功或 HTTP 200 都不是最终业务成功；最终状态必须由权威查单/回写事实确认。
5. 患者新增、绑卡、二维码、预约写入和取消都必须服务端持有身份映射、幂等键、TTL、状态机和
   审计证据；小程序只能提交 opaque ID 和用户动作，不能提交 provider 患者号、身份证、卡号或金额。

遇到业务逻辑绕弯时，必须在 domain/service 的中文注释中解释“为什么不能直接沿用旧字段”，
并在对应 contract、日志和验收文档中留下同一条边界，避免后续维护者把兼容字段重新暴露。
