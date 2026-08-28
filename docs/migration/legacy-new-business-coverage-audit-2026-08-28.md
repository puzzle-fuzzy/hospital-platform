# 旧端与新端业务覆盖对照审计（2026-08-28）

> 本文是当前迁移交接的对照事实，不修改旧项目，也不把“有页面”解释为“真实业务已开放”。旧端来源为 `G:\\fuck\\hospital\\hospital-app`，新端来源为当前仓库；历史日期文档保留原始观察窗口，不能覆盖本文的当前结论。

## 1. 当前总览

当前新端运行相关源码已经构建为 38 个页面、4 个微信原生 Tab，完整来源为 `27d562e69ccb3972ec21fa624aaa28ee17dcbde7`。旧端扫描到 64 个页面，当前台账分布如下：

| 旧端台账状态 | 数量 | 当前含义 |
| --- | ---: | --- |
| `replaced` | 8 | 页面或安全静态能力已经有新端落点，但仍需对应业务/真机证据 |
| `partial` | 23 | 已迁移安全只读或静态子集，旧端的写入、详情、实时或外部能力仍未开放 |
| `surface-only` | 23 | 只有页面外壳和关闭态，不能当作查询成功 |
| `blocked-provider` | 1 | 需要正式 Provider contract 后才能建立读取链路 |
| `blocked-external` | 1 | 需要外部主体、域名、短期会话和回跳 contract |
| `blocked-payment` | 7 | 支付、医保、查单、退款或 HIS 回写仍未开放 |
| `excluded` | 1 | 旧端开发辅助页面，不进入生产小程序 |

机器审计入口：

```powershell
pnpm migration:audit
pnpm migration:boundary:audit
pnpm clinical:contract:audit
pnpm migration:readiness
```

## 2. 旧端与新端对照

| 业务域 | 旧端真实来源 | 新端落点 | 当前结论 | 下一步 |
| --- | --- | --- | --- | --- |
| 首页与就诊人 | `pages/index/index.vue`、`pagesB/patient/patientChange.vue`；患者档案使用 `GET /msun-middle-aggregate-patient/v1/patInfosFind` | `pages/index/index`、`pages/patient-select/patient-select`；`GET/POST /api/v2/patients` | owner-scoped 患者目录、显式切换、失效选择和脱敏展示已实现；新增绑定和二维码真实生成仍关闭 | 先完成当前候选真机切换/账号隔离证据；新增绑定另立患者 contract |
| 就诊页 | `pages/consult/consult.vue`；今日/未来/历史摘要与 WebSocket/实时队列逻辑分开 | `pages/consult/consult`；只展示已确认的预约摘要 | 安全摘要已迁移；实时叫号、队列位置和临床状态未迁移 | 取得实时 Provider、事件映射、断线重连和退出语义后再做 |
| 预约目录 | `pagesB/hospital/hospitalList.vue`、`doctor_card.vue`、`appointment.vue`；科室/排班查询使用众阳预约接口 | `pages/appointment-directory/appointment-directory`；`GET /api/v2/appointments/departments`、`schedules` | 只读目录、日期级联和本地分批展示已实现；当前候选仍需公网/真机/Provider 证据 | 先做 A 批次真实只读取证，不开放锁号 |
| 我的挂号与爽约 | `pagesB/appointment/appointmentRecord.vue` 等；历史使用 `GET /msun-middle-business-appointment-server/v1/appointment-infos/{patId}` | `pages/appointment-records/appointment-records`、`pages/missed-appointments/missed-appointments`；`GET /api/v2/appointments/records` | 在线/全部范围、状态归一化、爽约派生、患者会话边界和固定高度已实现；详情、取消、退号、支付仍关闭 | 先关联 `appointment.records.failed/synced` 与 Provider requestId，确认 503 根因 |
| 报告目录与详情 | `pagesB/health/report.vue`、`report_detail.vue`；LIS/PACS/ECG/PEIS 来源不同 | `pages/report-directory/report-directory`、`report-detail/report-detail`；`GET /api/v2/reports`、`reports/{reportId}` | 只读摘要和受限 LIS 详情有服务端 owner/patient/TTL 边界；影像、心电、附件、体检报告和解读未开放 | 以当前 Provider contract 确认的来源逐类验收，不能用预约记录替代门诊病历 |
| 门诊费用 | `pagesB/health/outpatient_pay.vue`、`payment.ts`；费用明细和支付接口分开 | `pages/outpatient-payment/outpatient-payment`；`GET /api/v2/payments/outpatient/records` | 只读费用列表和成功空结果语义已实现；支付、医保授权、结算、退费和 HIS 回写关闭 | 先验证费用只读的真实链路；支付整体留到 F 批次 |
| 普通个人资料 | `api/modules/user.ts` 的当前用户资料、头像和更新 | `pages/profile/profile`；`GET/PUT /api/v2/me/profile` | 昵称/性别/年龄/邮箱的 owner/version 资料契约已实现；头像、实名、手机号和微信身份不混入 | 完成真机 GET、PUT、409 和授权回归证据 |
| 健康百科 | `api/modules/health.ts` 的部位、症状、疾病、药品和详情接口 | `pages/health-encyclopedia/*`；`/api/v2/knowledge/*` | 代码、版本化读模型和 fail-closed 页面已具备；正式内容 bundle、质量整改和临床审核未完成 | 内容责任人提供审核 bundle，完成导入、撤回和真机证据 |
| 门诊病历 | `api/modules/medicalRecord.ts` 的门诊记录/内容/结构接口 | 统一进入 `pages/feature-status/feature-status?feature=medical-record` | 旧端虽有接口字面量，但当前没有足够字段白名单、授权和脱敏证据；新端已注销未确认 API 和页面 | 取得正式 contract 后单独建目录/正文/引用链，不能借用报告或预约接口 |
| 住院信息 | `api/modules/medicalRecord.ts` 的住院患者、日清单等接口 | `pages/inpatient-center/inpatient-center` 安全外壳 | episode 权威来源、患者映射和状态枚举未确认 | 收集住院 episode contract 后再实现只读目录 |
| 我的医生 | `api/modules/user.ts` 的 `/convenience/my-doctor/list/create/delete` | `pages/my-doctor/my-doctor` 关闭态 | 医生目录与患者关系的 owner、失效和医护可见范围未确认 | 先冻结关系模型和字段白名单，禁止沿用旧快照 |
| 电子导诊/我的问诊 | 旧端电子导诊、陪诊和问诊模块，部分入口还依赖外部页面或实时会话 | `pages/electronic-consultation/electronic-consultation` 或统一状态页 | 预约摘要不等于导诊单，旧端外部会话也不能直接复用；当前真实问诊/导诊 API 未注册 | 取得专用来源、受众、保留周期、退出和回跳 contract |
| 便民与静态页面 | 公众号说明、医院列表、院内地图、反馈、采血、快递、锦旗/表扬信 | 对应原生静态/安全子集页面 | 能确认的静态和安全展示已迁移；物流、采血号源、公开记录写入和外部关注状态未开放 | 保持关闭态；拿到独立来源和写入/审核 contract 后再分域推进 |
| 支付与医保 | `api/modules/medical-insurance.ts`、`payment.ts`、旧 Python `/common/mbs-fsi/*` | 当前仅有关闭态入口和隔离材料 | 预约下单、微信支付、医保授权、6201/6202/6301/6203/6401、查单、退款和 HIS 回写未开放 | 最后作为可回滚批次处理，不从只读接口旁路打开 |

## 3. 两类 503 必须分开排查

### 3.1 新端预约历史 503

小程序请求：

```text
GET /api/v2/appointments/records?patientId=...&scope=online|all
```

服务端适配的众阳接口：

```text
GET /msun-middle-business-appointment-server/v1/appointment-infos/{patId}
```

`scope=online` 映射预约渠道 3，并携带有限日期窗口；`scope=all` 映射渠道 4 并省略在线日期窗口。新端只接受服务端 owner-scoped 患者映射，不把众阳 `patId` 返回给小程序。

适配器对众阳 HTTP 429、5xx、超时和网络失败标记为可重试，API 层才映射为 503 `provider-temporarily-unavailable`；Provider 返回 2xx 但读模型非法则是 502 `provider-response-invalid`，普通 4xx 拒绝则是 502 `provider-request-rejected`。因此，前端看到 503 不能单独证明众阳返回了 503，必须关联服务端的 `providerStatusCode`、`providerRequestId`、`providerRetryable` 和 `traceId`。

### 3.2 旧端医保 6201 503/502

旧 Python 的 `/common/mbs-fsi/6201` 不是预约历史接口，而是医保移动支付费用上传。旧服务将 6201 映射到医保移动支付中心的 `/org/local/api/hos/uldFeeInfo`，经医保转发服务发送；上游返回 504/超时文本时，旧代码通常转换为 HTTP 502 和“医保服务响应超时，请稍后重试”。这条链路与 `patInfosFind`、预约历史和新端 `/api/v2/appointments/records` 完全不同。

### 3.3 持久化 503

如果公共错误码是 `persistence-temporarily-unavailable`，应排查新服务的 MySQL、Redis、schema 或连接池，不应继续追众阳预约接口。错误码定义见 [`api-v2-public.md`](../api-v2-public.md)。

## 4. 当前可执行顺序

1. A 批次：以当前本地候选和同候选二维码采集患者目录、患者切换、预约目录、我的挂号、爽约、门诊费用和普通资料证据；全部 9 个真机域目前仍是 `pending`。
2. B 批次：等待健康内容审核 bundle，不把旧 JSON 快照直接发布。
3. C 批次：分别收集门诊记录、住院、医生关系、问诊/电子导诊的正式 contract。
4. D/E 批次：分别处理患者写入和外部短期会话，不能复用患者读取或预约历史 token。
5. F 批次：最后处理支付、医保、查单、退款和 HIS 回写，并保留旧服务可回滚。

每个域必须按 `contract → adapter → domain → persistence（如需要）→ API → 小程序状态机 → 低敏日志 → 公网/真机证据` 顺序推进；其中任一环节缺失，继续保持 `partial` 或 `blocked-*`，不得使用空列表、兼容转发或占位成功绕过门禁。

## 5. 关联实现与审计入口

- 旧端页面逐页台账：[`legacy-page-catalog.ts`](../../apps/miniprogram/src/services/legacy-page-catalog.ts)
- 新端公开 API：[`api-v2-public.md`](../api-v2-public.md)
- 临床入口收口记录：[`clinical-boundary-retraction-2026-08-28.md`](clinical-boundary-retraction-2026-08-28.md)
- 当前本地候选真机清单：[`device-evidence-27d562e6-pending.json`](../release/device-evidence-27d562e6-pending.json)
- 预约 Provider 失败日志：[`appointments/service.ts`](../../apps/api/src/modules/appointments/service.ts)
- Provider HTTP 错误分类：[`adapters/http.ts`](../../packages/adapters/src/http.ts)

