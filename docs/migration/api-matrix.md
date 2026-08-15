# API 迁移矩阵

> 旧路径来自 `G:\\fuck\\hospital` 的 FastAPI 路由和 `hospital-app/src/api` 调用。目标路径是设计方向，不代表已经实现。

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
| 小程序 `VITE_ZHONGYI_BASE_API` 直连患者档案、绑卡 | `GET/POST /api/v1/patients` | 服务端调用 Zhongyang adapter，小程序不再直连外部域名 | 目录 adapter、内部映射和同步 API 已实现；真实账号同步、映射和真机证据待完成；新增/绑卡写入未实现 |
| 小程序预约/科室/报告接口 | `/api/v1/appointments`、`/api/v1/reports`、`GET /api/v1/reports/:reportId` | 以患者端业务模型重组，不按旧 provider URL 透传 | 科室/排班已有服务器到真实 provider 的只读回归；预约历史、报告真实 provider、公网/真机证据仍待完成；预约写入、锁号、支付和体检报告未迁移 |
| 小程序门诊缴费列表 | `GET /msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records` | 新 API 按 owner-scoped 内部 `patientId` 查询，服务端固定日期窗口和渠道，只返回费用展示读模型 | 只读查询 adapter、API 和原生页面已实现；支付调起、医保授权、结算回写和退费仍未开放 |
| 旧首页就诊人卡片、就诊人绑定和二维码 | `GET /api/v1/patients`、`POST /api/v1/patients/sync`、后续独立二维码 contract | 首页只消费服务端脱敏患者读模型；选择页只保存 opaque `patientId`；二维码必须由服务端按医院扫码协议生成短期 token | 就诊人卡片、独立选择页和同步已实现；内部/众阳患者号不展示；二维码等待扫码字段、签名、TTL 和真机设备验收 |
| 旧首页报告查询 | `GET /api/v1/reports`、`GET /api/v1/reports/:reportId` | 新端独立报告目录页承载患者上下文和分批渲染；详情只接受服务端 opaque `reportId` | 报告目录页、有限日期窗口和 gated LIS 详情入口已实现；真实 provider 详情、附件下载、体检报告仍待验收 |
| 旧端 `pagesB/hospital/navigation` | 无服务端 API；原生页面 `pages/hospital-navigation/hospital-navigation` | 只迁移旧端静态 `map.jpg`、背景色、`aspectFit` 和点击预览；不把静态地图伪装成实时路线服务 | 静态页面已实现并纳入构建验收；医院列表、楼层/科室定位和实时路线待取得独立 contract |
| `GET /knowledge/*` | `/api/v1/knowledge/*` | 先迁移已审核健康百科只读内容；自测另行版本化 | ADR 0004、contract/domain port、0010 schema、fail-closed repository 和未挂载 service 已完成；旧内容脱敏导入、真实 schema 执行、内容审核和 API 挂载待实现 |
| `POST /intelligent/*` | `/api/v1/assistant/*` | 后续迁移 AI 导诊和报告解读 | 后续 |

## 2. 支付与医保 API

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

## 3. 管理端 API

| 旧路由组 | 目标应用 | 处理方式 |
| --- | --- | --- |
| `/system/user`、`/system/role`、`/system/menu`、`/system/dept` | Admin API | 保留 RBAC，但不与患者端共享 controller |
| `/monitor/*` | Admin/Operations API | 只暴露运维权限，使用独立鉴权与审计 |
| `/application/job` | Worker/Operations API | 调度执行从 API 进程拆出，API 只管理任务 |
| `/system/log`、字典、参数、通知 | Admin API | 后续迁移，先完成权限模型和审计契约 |

## 4. 不允许的迁移方式

- 不把 `/common/mbs-fsi/call` 直接开放给小程序作为万能代理。
- 不让小程序提交最终支付金额、医保基金金额或 HIS 完成状态作为权威。
- 不把旧的 `requestData`/`httpZy` 直连模式原样搬到原生小程序。
- 不以 API 返回 200、支付调起成功或本地缓存状态推断最终结算成功。
