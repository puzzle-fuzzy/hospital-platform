# API 迁移矩阵

旧小程序实际调用过的 provider endpoint 逐项快照见
[`legacy-api-endpoint-inventory.md`](legacy-api-endpoint-inventory.md)。本矩阵负责按业务域
记录迁移策略和新 API 状态；逐项快照负责防止接口遗漏，二者都不把旧 endpoint 当作新公共 API。

> 旧路径来自 `G:\\fuck\\hospital` 的 FastAPI 路由和 `hospital-app/src/api` 调用。目标路径是设计方向，不代表已经实现。

当前新 Elysia 已实际注册的患者端公共接口，以 [`docs/api-v2-public.md`](../api-v2-public.md) 和
源码中的 OpenAPI 路径门禁为准；本文继续负责记录旧接口的迁移状态、未注册接口组和 provider 前置，
不把“目标路径”误写成“已经可调用”。

## 状态说明

- `代码已实现`：新仓库有 contract、service/adapter、测试或小程序页面证据。
- `运行已配置`：生产启动日志、schema/Redis 探针或 gate 配置有证据；不代表 provider 已授权。
- `真实已验收`：受控 provider 请求、公网 API、开发者工具/真机和对应日志证据均已保存。
- 未特别注明时，本文的“已实现”只代表前两类，不能替代真实验收。

## 1. 患者端 API

| 旧路径/来源 | 目标边界 | 迁移策略 | 状态 |
| --- | --- | --- | --- |
| `POST /system/auth/login/wechat` | 公网 `POST /api/v2/auth/wechat`（内部 `/api/v1/auth/wechat`） | 后端接收 `wx.login` code，服务端换取身份并签发会话 | 代码、生产 v2 路由和运行边界已实现；当前微信账号的公网/真机完整证据仍待保存 |
| `GET /system/user/current/info` | 公网 `GET /api/v2/me`（内部 `/api/v1/me`） | 验证平台会话并返回内部用户 ID；provider subject 不出端 | 已实现最小会话视图；患者关系通过服务端 owner-scoped `/api/v1/patients` 返回内部 patientId |
| 旧个人资料、头像、患者新增/绑卡和协议入口 | 普通资料为公网 `GET/PUT /api/v2/me/profile`；头像、consent、binding 仍为独立 contract | 普通资料只接收昵称、性别、年龄、邮箱并使用 owner/version；不把旧 `/system/user/current/info/update`、`/system/user/current/avatar/upload`、`patients`、`patCards` 直接暴露给小程序 | 普通资料代码、0014 migration、生产 schema、API 运行和未登录公网 401 已验收；真实微信读写/409、真机、头像、实名、患者绑定和协议仍待完成；详见 [`user-profile-contract.md`](user-profile-contract.md)、[`../release/user-profile-production-acceptance-2026-08-16.md`](../release/user-profile-production-acceptance-2026-08-16.md) 和 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md) |
| 小程序 `VITE_ZHONGYI_BASE_API` 直连患者档案、绑卡 | `GET/POST /api/v1/patients` | 服务端调用 Zhongyang adapter，小程序不再直连外部域名 | 目录 adapter、内部映射和同步 API 已实现；真实账号同步、映射和真机证据待完成；新增/绑卡写入未实现 |
| 小程序预约/科室/报告接口 | `/api/v1/appointments`、`/api/v1/reports`、`GET /api/v1/reports/:reportId?patientId=...` | 以患者端业务模型重组，不按旧 provider URL 透传；在线/全部挂号分别由 `scope=online|all` 映射服务端渠道 3/4，爽约记录是预约历史 `status=missed` 的派生筛选；科室/排班 adapter 拒绝重复主键且只接受已确认的 `usableSourceNum`，页面列表 key 不承担业务身份；报告目录按可验证 `reportedAt` 倒序，详情再按 owner + patient + reportId + TTL 校验 | 当前 pending `8bc649f` 已具备预约历史/爽约、渠道 3/4 和报告目录的只读代码，线上仍为 `13f597e`，两者都待当前候选真机四方链路证据；报告真实 provider、预约写入、锁号、支付和体检报告未迁移 |
| 小程序门诊缴费列表 | `GET /msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records` | 新 API 按 owner-scoped 内部 `patientId` 查询，服务端固定日期窗口和渠道，只返回费用展示读模型 | 只读查询 adapter、API 和原生页面已实现；支付调起、医保授权、结算回写和退费仍未开放 |
| 旧首页就诊人卡片、就诊人绑定和二维码 | `GET /api/v1/patients`、`POST /api/v1/patients/sync`、后续独立二维码 contract | 首页只消费服务端脱敏患者读模型；选择页只保存 opaque `patientId`；二维码必须由服务端按医院扫码协议生成短期 token | 就诊人卡片、独立选择页和同步已实现；内部/众阳患者号不展示；二维码等待扫码字段、签名、TTL 和真机设备验收 |
| 旧首页报告查询 | `GET /api/v1/reports`、`GET /api/v1/reports/:reportId?patientId=...` | 新端独立报告目录页承载患者上下文和分批渲染；详情接受服务端 opaque `reportId` 与当前内部 `patientId`，服务端复核 owner + patient + TTL | 报告目录页、有限日期窗口和 gated LIS 详情入口已实现；真实 provider 详情、附件下载、体检报告仍待验收 |
| 旧端 `pagesB/account/follow` | 无服务端 API；原生页面 `pages/official-account/official-account` | 只迁移静态公众号通知说明和本地图标；不把打开页面解释为已关注，不生成伪二维码 | 静态页面已实现并纳入构建/源代码验收；二维码、关注状态、模板消息授权和外部主体仍待独立 contract |
| 旧端 `pagesB/hospital/hospitalList` | 无服务端 API；原生页面 `pages/hospital-list/hospital-list` | 迁移已核对的单院区静态卡片，图片使用本地受控资源；“去挂号”进入预约只读目录，“查看路线”不猜坐标、不调用外部地图 | 静态入口已实现并纳入构建/源代码验收；动态机构/院区目录、多院区选择和真实路线仍待独立 contract |
| 旧端 `pagesB/hospital/navigation` | 无服务端 API；原生页面 `pages/hospital-navigation/hospital-navigation` | 只迁移旧端静态 `map.jpg`、背景色、`aspectFit` 和点击预览；不把静态地图伪装成实时路线服务 | 静态页面已实现并纳入构建验收；动态医院列表、楼层/科室定位和实时路线待取得独立 contract |
| `GET /knowledge/*` | `/api/v1/knowledge/*` | 先迁移已审核健康百科只读内容；自测另行版本化 | 健康百科 contract/domain/persistence、fail-closed repository、服务端挂载和原生目录/详情页面已完成；旧库源快照导出器已完成，但内容脱敏导入、重复/控制字符复核、临床审核、真实 schema 执行和内容发布仍待实现 |
| `POST /intelligent/*` | `/api/v1/assistant/*` | 后续迁移 AI 导诊和报告解读 | 后续 |
| 旧个人中心扩展、外部 WebView、公众号、签名、订阅和采血 | 普通 profile 已独立实现；其余仍使用独立的 consent/external-entry/notification contract | 公众号说明和反馈帮助页只有静态页面，不复用患者目录或预约目录的字段和 token；外部入口使用 audience/allowlist/一次性引用 | 普通 profile 已注册但生产/真机待验收；真实头像、反馈写入、关注/订阅、签名、WebView 和采血能力未注册；详见 [`user-profile-contract.md`](user-profile-contract.md) 与 [`patient-center-and-external-entry-boundaries.md`](patient-center-and-external-entry-boundaries.md) |

## 2. 旧服务仍存在、但新 API 尚未注册的接口组

旧 FastAPI 在 `app/api/v1/__init__.py` 中还注册了以下路由组。它们不应因为旧服务仍能返回响应，
就被新小程序直接调用或通过“万能转发”接入；每组都必须有自己的 contract、权限、日志和验收证据。
旧 FastAPI 各模块的静态路由数量、挂载关系以及 `urls_rag.py` 的未挂载孤立路由，见
[`legacy-api-endpoint-inventory.md`](legacy-api-endpoint-inventory.md) 的“旧 FastAPI 路由基线”小节。

| 旧路由组 | 旧职责 | 新端当前状态 | 正确迁移前置 |
| --- | --- | --- | --- |
| `/common/file/*` | 文件上传、文件资源处理 | 未注册 | 对象存储、内容安全、病毒扫描、owner/TTL 下载授权和审计 |
| `/common/mbs-fsi/*` | 医保 FSI、微信医保混合支付 | 仅有服务端规则/adapter port，患者 API 未开放 | 当前 provider 文档、SM2/SM3/SM4 golden vector、授权、查单、回调和 HIS 状态机 |
| `/common/mip-user-query/*` | 医保身份/授权查询 | 未注册 | 授权码生命周期、参保人归属、敏感字段和撤销语义 |
| `/common/yunhealth/*` | 云健康挂号结算与 HIS 回写 | 未注册为患者端 API | 内部回调鉴权、最终结算状态、幂等和失败补偿；不能开放给小程序 |
| `/convenience/*` | 锦旗、表扬信、风险评估、我的医生、出院随访、入院预问诊 | 未注册 | 旧端共 13 个路由；按 [`convenience-service-boundaries.md`](convenience-service-boundaries.md) 拆为反馈、临床问卷、医生关系和预问诊四个领域；必须先完成 owner、版本、幂等、审核和医护侧权限 contract |
| `/knowledge/tips/*` | 指标解读 | 新端 knowledge 领域骨架存在，患者路由未挂载 | 审核后的版本化内容、发布/下线记录和内容审计 |
| `/knowledge/health/*` | 健康百科、疾病和药品内容 | 新端已挂载版本化只读路由，并接入原生目录/搜索/详情页；无已发布 bundle 时 fail-closed；映射见 [`health-knowledge-content-mapping.md`](health-knowledge-content-mapping.md) | 临床审核、内容版本、药品关联、搜索和脱敏导入 |
| `/knowledge/selftest/*` | 健康自测题目与结果 | 未注册 | 题库版本、评分算法、临床复核、免责声明、授权和结果保留规则 |
| `/knowledge/report/*` | 报告解读 | 未注册 | 报告资源授权、解读模型/知识版本、免责声明和审计；不能从报告目录顺手开放 |
| `/intelligent/*` | AI 导诊、客服、文本/音频会话和 RAG 文档 | 未注册 | 会话 owner、模型/知识版本、内容安全、免责声明、音频存储和限流 |
| `/monitor/*` | Redis、在线用户、服务器资源、缓存和监控 | 患者 API 不迁移 | 独立运维身份、RBAC、审计、网络隔离和告警策略 |
| `/application/job/*` | 定时任务管理 | API 未迁移；新端由 worker 承担运行基础 | 管理端权限、任务状态、租约、并发和审计；不能让患者 token 管理任务 |
| `/system/user|role|menu|dept|position|dict|param|notice|log/*` | 管理端 RBAC、字典、参数、通知和操作日志 | 患者 API 不迁移 | 独立 Admin API、权限模型、审计和管理端验收；不能与患者会话混用 |

## 3. 支付与医保 API

| 旧路径 | 目标边界 | 关键规则 | 状态 |
| --- | --- | --- | --- |
| `POST /common/mip-user-query` | `POST /api/v1/payments/insurance/authorization` | 授权码只在服务端兑换；不把 provider 凭证返回小程序 | 待实现 |
| `POST /common/mbs-fsi/1101` | `MedicalInsuranceGateway.getPerson` | 只允许由支付编排服务调用 | 待实现 |
| `POST /common/mbs-fsi/6201` | `MedicalInsuranceGateway.uploadFees` | 费用明细必须来自真实结算信息 | 待实现 |
| `POST /common/mbs-fsi/6202` | `MedicalInsuranceGateway.createSettlement` | 6202 返回的医保订单与金额必须落库 | 待实现 |
| `POST /common/mbs-fsi/6301` | `MedicalInsuranceGateway.querySettlement` | 查单是补偿路径，不是前端猜状态 | 待实现 |
| `POST /common/mbs-fsi/6203` | `MedicalInsuranceGateway.refund` | 退款必须绑定已落库支付订单和金额 | 待实现 |
| `POST /common/mbs-fsi/6302` | `POST /api/v1/webhooks/medical-insurance/settlement` | 公开回调验签、去重、入事件表后异步处理 | 待实现 |
| `POST /common/mbs-fsi/wechat-med-ins/*` | `WechatPaymentGateway` | 微信医保混合支付只暴露启动/查询结果视图 | 待实现 |
| `POST /common/yunhealth/registration/medical-settlement-complete` | 内部 `HospitalSettlementGateway.writeBack` | 2.27.2.32 成功后才允许 2.6.65.5；未知状态不自动撤销 | 待实现 |

## 4. 管理端 API

| 旧路由组 | 目标应用 | 处理方式 |
| --- | --- | --- |
| `/system/user`、`/system/role`、`/system/menu`、`/system/dept` | Admin API | 保留 RBAC，但不与患者端共享 controller |
| `/monitor/*` | Admin/Operations API | 只暴露运维权限，使用独立鉴权与审计 |
| `/application/job` | Worker/Operations API | 调度执行从 API 进程拆出，API 只管理任务 |
| `/system/log`、字典、参数、通知 | Admin API | 后续迁移，先完成权限模型和审计契约 |

## 5. 不允许的迁移方式

- 不把 `/common/mbs-fsi/call` 直接开放给小程序作为万能代理。
- 不让小程序提交最终支付金额、医保基金金额或 HIS 完成状态作为权威。
- 不把旧的 `requestData`/`httpZy` 直连模式原样搬到原生小程序。
- 不以 API 返回 200、支付调起成功或本地缓存状态推断最终结算成功。

## 6. 2026-08-16 新 Provider 文档冻结结果

本轮收到以下 3 份文档：2.6.7 挂号登记、2.10.4.2 支付挂号、2.6.65.7 外部退款。
字段、状态、金额和依赖矩阵见 [`../provider-intake/2026-08-16-appointment-registration-payment-refund.md`](../provider-intake/2026-08-16-appointment-registration-payment-refund.md)。

当前结论是“已接收并标准化”，不是“合同已确认”：

- 2.6.7 明确是写入型挂号登记，返回 `registerStatus`、`chargeStatus` 和多种金额字段，但状态枚举、金额单位、
  幂等、锁号/释放和超时查单尚未确认；不注册挂号写入 adapter。
- 2.10.4.2 明确依赖缺失的 2.10.4.1 执行预约，并定义 `payState=0..5`；其中 `3` 只是“支付成功、院内处理中”，
  不能被新 API 或小程序显示为最终预约成功；不注册支付挂号 adapter。
- 2.6.65.7 的文档角色是外部系统提供接口，`result=2` 表示质疑/未知并引用缺失的 2.6.65.8 查单；调用方向、
  鉴权和退款最终事实未确认；不实现退款 endpoint 或退款按钮。
- 由于文档同时出现 `patId`、卡号、身份证号、设备 IP/MAC、金额和支付状态，这些字段只能留在未来服务端 adapter 边界，
  不得进入小程序请求、公共 response、日志或 URL。

在执行预约、排班/号源、患者档案、支付登记和退款查单文档及脱敏失败/超时样例补齐前，预约写入、支付、医保、HIS 回写和退款
继续保持冻结；现有预约/费用只读接口不因这批文档而改变状态。

门诊结算、支付查单、关单、取消结算和医保回写的补充材料已单独登记为
[`../provider-intake/2026-08-16-outpatient-settlement-insurance.md`](../provider-intake/2026-08-16-outpatient-settlement-insurance.md)，
当前同样是 `normalized`。它们补充了流程顺序和高风险副作用，但没有改变本节支付/医保 API 的“待实现”状态；
2.6.65.5、2.6.65.6、2.6.65.11 和 2.27.2.32 仍不能进入公共 route 或生产 gate。
