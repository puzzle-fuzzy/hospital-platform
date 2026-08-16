# 剩余迁移盘点与下一步计划

> 盘点基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app`，新端来源为
> `E:\\__Super_Core__\\hospital-platform`。本文只把源代码和测试证据作为“实现证据”，不把页面存在、接口返回 200
> 或旧接口曾经可调用误判为真实业务完成。
>
> 逐页完整清单见 [`legacy-page-matrix.md`](legacy-page-matrix.md)；本文件负责优先级、业务不变量和 provider 文档冻结规则。
> 旧小程序和旧 FastAPI 的逐接口快照见 [`legacy-api-endpoint-inventory.md`](legacy-api-endpoint-inventory.md)。

## 1. 盘点结论

旧端当前有 64 个 Vue 页面，新原生小程序有 10 个 TypeScript 页面源文件。新端已经形成患者端的第一条纵向切片，
但还不是旧端的功能等价替换：

页面之外的旧端请求封装、WebSocket、状态仓储、问卷/随访组件和静态业务配置，不能按“公共工具”视为已迁移；
它们的实际行为和禁止兼容方式见 [`legacy-client-infrastructure-boundaries.md`](legacy-client-infrastructure-boundaries.md)。

旧服务 Redis/MongoDB、APScheduler、文件资源、AI/WebSocket 和 Admin/RBAC 的运行边界另见
[`infrastructure-and-operations-boundaries.md`](infrastructure-and-operations-boundaries.md)；连接探针通过不等于这些能力已替代。

```text
已形成代码闭环（真实 provider、公网 API、微信真机和生产业务证据仍待）：登录 -> 患者目录 -> 选择患者 -> 只读预约/报告/费用查询 -> 爽约记录安全筛选
已迁移静态能力：院内导航静态地图（不含实时定位和路线）
仍缺业务契约：患者新增绑定、病历、住院、便民、AI、预约写入、支付、医保、HIS、二维码；医院列表仍缺机构/院区 contract
仍缺真实证据：众阳患者/预约历史/报告/门诊费用、公网 API、微信真机和生产回归
```

### 当前新端能力的准确状态

| 能力 | 新端代码 | 业务状态 | 不能宣称的内容 |
| --- | --- | --- | --- |
| 微信登录与平台会话 | `auth`、Redis session | 代码和生产运行边界已具备 | 未完成当前微信账号的真机完整证据时，不能宣称正式验收 |
| 患者目录与切换 | `patients`、独立选择页 | 目录同步、脱敏、owner 隔离、`0013` 快照 schema 和代码级完整快照状态模型已实现 | 真实失效/恢复数据、真机证据和新增/绑定家属仍未完成 |
| 预约科室/排班 | `appointments/departments`、`schedules` | 只读 provider adapter 和两列级联页面已实现 | 不能锁号、不能把 `scheduleId` 当成写入授权 |
| 预约历史/爽约筛选 | `appointments/records`、`missed-appointments` | contract、服务端状态映射、挂号记录页和 `missed` 派生页已实现；查询窗口固定为近 90 天 | 真实账号重新同步、公网和真机证据仍缺；未知状态不能推导为爽约 |
| 报告目录/详情 | `reports`、目录/详情页 | 目录和短期 opaque 详情引用骨架已实现 | 报告真实 provider、文件下载、PACS/ECG/体检详情未验收 |
| 门诊费用 | `payments/outpatient/records` | 只读目录已实现，查询时间显式使用 `Asia/Shanghai` | 费用详情、支付、医保、结算回写和退费未开放 |
| 院内导航 | `pages/hospital-navigation/hospital-navigation` | 旧端静态地图、背景色、`aspectFit` 和点击预览已迁移 | 医院列表、楼层/科室定位、实时路线和地图服务未迁移 |
| 微信支付 | 订单、预支付、通知、查单基础设施 | 代码基础和 gate 已具备 | 商户、回调、公网和真机支付未验收；gate 必须关闭 |
| 医保/HIS | domain/规则层部分存在 | 规则边界和文档基础存在 | 真实加密、授权、6201/6202/6301/6203/6401、HIS 回写均未迁移 |
| 健康知识 | contract/domain/repository、版本化 schema、导入校验和旧表映射文档已具备 | 明确 fail-closed，患者路由未挂载；真实内容未导入 | 内容来源/临床审核、staging 发布撤回、患者端页面和真机证据仍未完成 |
| 管理端/Worker | Worker 与持久化基础部分存在 | 运维边界和支付补偿基础存在 | RBAC 管理端、监控、通用任务管理、文件管理和后台日志查询未迁移为新 API；详见 [`infrastructure-and-operations-boundaries.md`](infrastructure-and-operations-boundaries.md) |

## 2. 按旧端页面的剩余清单

### P0：当前纵向切片必须先完成的验收

这些项目代码大部分已经存在，下一步不是增加新 UI，而是补真实证据和一致性：

- 患者目录重新同步后，确认每个患者都有正确的 `his-patient` 映射；没有映射时预约历史、报告、门诊费用必须在 provider 请求前失败。
- 首页、患者选择页、预约历史、报告目录、门诊费用切换患者后，确认不会沿用上一个患者的异步响应或列表。
- 首页和“我的”页的患者目录并发回写已在代码中使用最后一次请求获胜守卫；仍需在真机验证会话恢复、下拉刷新、同步和返回选择页同时发生时的展示结果。
- 门诊费用在“待缴费/已缴费”之间切换时，查询必须使用用户本次点击的状态快照，不能因为小程序 `setData` 异步回写而读取旧 tab。
- 预约目录切换左侧科室或下拉刷新时，确认旧科室排班不会覆盖当前科室，旧请求也不会恢复旧的日期分组和号源列表。
- 患者目录同步使用 provider 请求发起时间做快照版本；较早请求晚返回时，不能覆盖较新的患者资料、临床映射，
  也不能重新激活已被新快照标记为 inactive 的患者。
- 预约目录、预约历史、报告、门诊费用分别完成 provider、内网 API、公网 HTTPS 和真机四层证据。
- 统一 `unauthorized`、`patient-selection-required`、`dependency-not-configured`、provider 暂时不可用和空列表的用户态文案与日志事件。
- 爽约记录只允许展示服务端已归一化的 `missed`；`unknown`、空列表和 provider 未返回不能推断爽约，且当前只覆盖预约历史近 90 天窗口。
- 患者目录失效回收已使用“active/inactive + 事务快照”实现；`0013` 已完成生产 migration 和 schema probe，仍需真实失效/恢复验收，不能直接删除 `hp_patients`。

### 旧端顶层页面的重分类

旧端 `src/pages` 另外包含 5 个页面，它们不能因为不在 `pagesB` 清单中而被遗漏：

| 旧页面 | 当前状态 | 迁移边界 |
| --- | --- | --- |
| `pages/index/index.vue` | 已被原生首页替换 | 保留首页患者上下文、服务入口和底部导航；不保留旧端 provider 直连 |
| `pages/user/user.vue` | 已被原生“我的”页部分替换 | 患者选择、挂号记录等已接入；个人资料、反馈、订阅消息等扩展入口仍未迁移 |
| `pages/consult/consult.vue` | 未迁移 | 智能陪诊/导诊需要独立会话、免责声明、内容审计和外部服务 contract |
| `pages/hospital/hospital.vue` | 未迁移 | 互联网医院入口需要外部小程序/医院服务协议，不能伪造站内页面 |
| `pages/setting/setData.vue` | 开发辅助页，不纳入生产迁移 | 不进入生产 `app.json`，保留在旧端作为测试工具即可 |

### P1：取得新的 provider 文档后迁移

| 旧页面/入口 | 缺失内容 | 必要前置 |
| --- | --- | --- |
| `pagesB/hospital/department_select`、`doctor_card`、`timeslot_source` | 科室/医生/号源详情、分时段号源和写入前确认 | 新 AMC 目录/号源 contract、字段白名单和 TTL |
| `pagesB/hospital/confirm_registration`、`registration_detail` | 预约确认、预约详情和状态刷新 | 锁号、预约写入、最终状态查询、幂等与取消矩阵 |
| `pagesB/health/outpatient_pay_detail`、`electronic_bill` | 费用明细和可支付金额展示 | 费用详情 contract、金额单位和患者归属规则 |
| `pagesB/health/report_query`、`report_detail` 的真实能力 | LIS/PACS/ECG/体检真实数据、附件和详情授权 | provider 文档、资源 URL/短期授权、数据脱敏规则 |
| `pagesB/health/electronic_record` | 门诊病历目录、内容和结构化字段；旧端实际调用 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，病历正文接口另有定义 | HIS/EMR 只读 contract、资源授权和脱敏清单；目录差异草案见 [`medical-record-directory-contract-draft.md`](medical-record-directory-contract-draft.md)，整体边界见 [`medical-record-and-hospital-boundary.md`](medical-record-and-hospital-boundary.md) |
| `pagesB/hospital/hospitalList` | 医院列表 | 医院列表数据来源、机构选择语义和版本 contract |
| `pagesB/hospital/navigation` | 静态院内地图已迁移；实时楼层/科室定位未迁移 | 原始 `map.jpg`、`aspectFit`、点击预览已完成；动态地图数据、定位和路线 contract 待确认 |
| `pagesB/hospital/bloodAppointment` | 采血预约 | 采血服务 contract、号源状态和取消规则 |

### P2：内容和便民服务逐域迁移

| 旧页面组 | 页面范围 | 当前状态 | 迁移方式 |
| --- | --- | --- | --- |
| 健康百科/药品 | `health_encyclopedia`、`disease_detail`、`drug_detail`、`search_result` | 新端未挂载患者路由 | 只迁移审核后的版本化内容；不能直接复制旧数据库正文 |
| 健康自测 | `health_test`、`self_test_question`、`self_test_result`、BMI/血压计算 | 未迁移 | 题目、分值和结果必须版本化并经临床复核；先不开放自动风险判断 |
| 风险评估 | `risk_self_evaluation`、`risk_form_*` | 未迁移 | 题目、分值、风险分级和建议必须版本化并经临床复核；未知版本拒绝写入，不能把客户端风险结论当权威；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 预问诊/随访 | `pre_visit`、`admission_preconsultation`、`discharge_followup*` | 未迁移 | 旧端按原始 `pat_id` 和 JSON 数组保存，且不同表单可能按 `(user_id, pat_id)` 互相覆盖；必须先绑定预约/住院/随访任务、问卷版本、患者授权、幂等和医护读取权限；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 电子锦旗/表扬信 | `list_*`、`gift_*`、`record_*` | 未迁移 | 旧端可提交伪造的患者/医生/就诊字段，且 `display_type=1` 不等于已审核公开；必须完成内容安全、审核、脱敏展示、撤回和幂等；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 我的医生 | `pagesB/patient/doctor.vue` | 未迁移 | 旧端保存客户端医生快照，重复关注非幂等且使用 GET 删除；必须依赖受控医生目录、owner 关系、命令语义、唯一约束和审计；详见 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) |
| 智能陪诊/导诊 | `consult`、`webview`、`my_consultation` | 未迁移 | 独立 AI/会话 contract、免责声明、模型和知识版本审计 |

### P3：患者个人中心与低风险账户能力

- `user/user.vue` 目前只有新端基础“我的”页；爽约记录已提供基于预约历史读模型的安全筛选子页，但真实 provider/公网/真机证据仍未完成；个人资料、头像、意见反馈、订阅消息、咨询历史、公众号关注、我的医生和患者签名尚未迁移。旧端反馈和订阅当前只是本地/静态交互，不能按真实业务完成计算；详见 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md)。
- `patientAdd`、`patientChange` 的真实建档/绑卡接口尚未开放；旧端在查询档案失败时可能继续建档，当前“添加就诊人”只能显示迁移边界，不得伪造成功。
- `patient/agreement`、隐私授权、患者签名需要重新确认法律文本、授权记录和撤回策略，不能只复制旧页面；跨小程序票据和 WebView 规则见 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md)。

### P3：旧端非页面逻辑

- `httpZy`、`ws.ts` 和 `utils/index.ts` 仍包含直连 provider、token/patId 传递、unionId 查询和万能 URL 代理等旧边界；新端不得复制，必须由服务端 adapter、短期会话引用或专用实时 contract 替代。
- Pinia 用户/患者 store 仍会持久化旧身份、provider 患者号、卡号和身份证字段；新端只能持久化平台会话和 opaque `patientId`，并以当前 owner 的服务端读模型为准。
- `SelfTestEngine`、`selfTestConfig`、出院随访组件和院区选择器承载医疗/患者上下文逻辑；它们不是普通 UI 组件，需先完成临床审核、版本、授权、任务绑定和回滚规则。
- 首页/我的页 JSON 导航和旧底部 Tab 包含未注册页面与外部资源；新端只能跳转 `app.json` 已注册且完成 contract 的页面。详见 [`legacy-client-infrastructure-boundaries.md`](legacy-client-infrastructure-boundaries.md)。

### P4：费用、医保和外部回写（按用户要求最后处理）

- `outpatient_pay` 的真实支付、`payment_cashier`、医保授权和结算结果；
- `registration_medical_pay`、挂号医保支付、微信自费/混合支付；
- FSI `1101/6201/6202/6301/6203/6302/6401`、查单、退款、回调去重和补偿；
- 云健康 `medical-settlement-notify` / `medical-settlement-complete` 和 HIS 最终回写；
- 二维码：必须取得扫码字段、签名、TTL、撤销/防重放和医院设备证据后才实现。

## 3. 新 API 与旧 API 的差异风险

当前新端不是旧接口的路径替换，而是安全读模型。新的 provider 文档到达前，以下差异必须保持冻结：

1. 小程序只调用 Hospital API；任何 provider URL、token、provider 患者号和支付签名都不能进入小程序。
2. 业务输入使用内部 `patientId`；服务端根据 owner 和用途解析外部引用，禁止让客户端提交 `patId`、`thirdPatientId` 或金额。
3. 只读查询与写入命令分开；费用目录不能直接变成支付订单，排班目录不能直接变成锁号授权。
4. HTTP 成功只表示请求被接收/读模型生成；预约、支付、医保和 HIS 必须有独立的最终状态事实。
5. 旧服务继续运行在原边界；新端新增 route、migration 或 gate 必须能独立回滚，不修改旧服务的业务表语义。

## 4. 新接口文档到达后的冻结模板

新的文档获取方式接入后，每一个接口在实现前必须登记以下信息；缺任何一项都只能进入“待核对”，不能写成兼容猜测：

| 类别 | 必须记录 |
| --- | --- |
| 来源 | 文档名称、版本、发布日期、适用环境和 provider 联系/确认人 |
| 请求 | method、path、query/body/header、必填/条件字段、编码、单位、示例 |
| 身份 | token/签名/证书、调用方、患者标识来源、权限和有效期 |
| 响应 | 成功 envelope、业务成功条件、字段类型、枚举、空值和分页语义 |
| 失败 | HTTP/业务错误码、是否可重试、超时后的最终查询方式和人工处理方式 |
| 状态 | 状态机、幂等键、并发冲突、锁/过期/取消/退款/回写顺序 |
| 金额 | 元/分/字符串精度、总额守恒、各支付渠道边界和舍入规则 |
| 安全 | PII、日志禁止字段、回调验签、短期引用、脱敏和审计要求 |
| 证据 | golden fixture、sandbox 响应、内网/公网/真机验收步骤和回滚方案 |

### 文档变更规则

- 新文档与旧代码冲突时，先更新 contract/ADR 和差异记录，再修改 adapter；不能只改一处字段映射。
- 只有 provider 文档不能证明真实权限；还要有受控请求、响应和失败样例。
- 文档未说明的字段不进入公共 contract；先保留在 adapter 内部并标为待确认，不能“为了兼容”透传。
- 每完成一个域，必须同步更新 `docs/migration/api-matrix.md`、本清单、日志文档和验收手册。

## 5. 下一步执行顺序

1. 先完成 P0 的真实只读验收和患者上下文竞态审计，不扩大功能面。
2. 接收新的 provider 文档后，冻结预约写入、门诊费用详情、病历和报告资源的 contract 差异表。
3. 爽约记录安全筛选子页已完成代码闭环，但不替代真实验收；取得新的 provider 文档后，优先选择病历目录等低风险只读域完成 contract → adapter → API → 小程序 → 测试 → 验收手册闭环。医院列表仍等待机构/院区/路线 contract，不能把旧静态卡片扩展成动态业务。
4. 健康知识已经完成旧表/接口映射和导入前置校验；仍必须先做内容审核和版本化导入，再挂载患者 GET 路由；自测、AI 和报告解读继续分开。
5. 便民服务先按 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) 完成 contract 和旧数据隔离，再按“医生关系只读 → 患者反馈 → 临床问卷 → 预约后预问诊/出院随访”推进；provider/临床资料不足时不注册患者 API。
6. 最后按“现金支付 → 医保授权/结算 → 查单/退款 → HIS 回写”推进，任何未知状态都进入人工/补偿队列，不在前端显示成功。

## 6. 当前不做的事情

- 不根据旧页面字段猜新的预约写入、二维码、医保或支付接口。
- 不为了页面看起来完整而把未验收页面接到旧 provider 万能转发。
- 不删除旧服务、旧表或旧端口；不在文档证据不足时打开生产 gate。
