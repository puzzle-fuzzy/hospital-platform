# API 迁移矩阵

> 旧路径来自 `G:\\fuck\\hospital` 的 FastAPI 路由和 `hospital-app/src/api` 调用。目标路径是设计方向，不代表已经实现。

## 1. 患者端 API

| 旧路径/来源 | 目标边界 | 迁移策略 | 状态 |
| --- | --- | --- | --- |
| `POST /system/auth/login/wechat` | `POST /api/v1/auth/wechat` | 后端接收 `wx.login` code，服务端换取身份并签发会话 | 设计中 |
| `GET /system/user/current/info` | `GET /api/v1/me` | 返回脱敏后的当前用户和患者关系 | 设计中 |
| 小程序 `VITE_ZHONGYI_BASE_API` 直连患者档案、绑卡 | `GET/POST /api/v1/patients` | 服务端调用 Zhongyang adapter，小程序不再直连外部域名 | 目录 adapter、内部映射和同步 API 已实现；真实 provider 配置与验收待实现 |
| 小程序预约/科室/报告接口 | `/api/v1/appointments`、`/api/v1/reports` | 以患者端业务模型重组，不按旧 provider URL 透传 | 待盘点 |
| `GET /knowledge/*` | `/api/v1/knowledge/*` | 后续迁移健康知识和自测 | 后续 |
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
