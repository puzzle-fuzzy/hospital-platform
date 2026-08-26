# 广度迁移安全子集批次（2026-08-26）

本批次按“先横向补齐旧入口的可验证安全子集，再分别接入高风险真实业务”的顺序推进。
只修改新项目，不修改旧 Python 服务、旧数据库、旧 Redis、线上进程或其他会话维护的预约适配器。

## 本批次完成的四类安全子集

| 旧入口 | 新页面 | 已迁移行为 | 明确未开放能力 |
| --- | --- | --- | --- |
| `pagesB/hospital/bloodAppointment.vue` | `pages/blood-appointment/blood-appointment` | 当前就诊人、院区展示、旧端真实的无可预约项目空态、错误重试和统一选人 | 采血号源、预约写入、取消、最终状态查询 |
| `pagesB/patient/express.vue` | `pages/patient-express/patient-express` | owner-scoped 当前就诊人、旧端预留空列表、空态和统一选人 | 物流来源、患者归属校验、单号脱敏、状态映射 |
| `pagesB/patient/patient_signature.vue` | `pages/patient-signature/patient-signature` | owner-scoped 脱敏患者列表、页面选中态、协议原文入口和重试 | 签名用途/同意、文件上传、外部签名会话、回执、撤回 |
| `pagesB/user/subscription_message.vue` | `pages/patient-subscription/patient-subscription` | 当前就诊人、标题搜索、分类折叠、只读开关展示和迁移说明 | `wx.requestSubscribeMessage`、模板发送、授权回执、撤销和服务端保存 |

这里的 `partial` 只表示旧页面中已经确认的低风险行为完成，不代表对应业务整体完成，也不代表可以切换生产入口。
页面仍保留“查看迁移说明”或明确关闭态，避免把空列表、Toast 或本地状态误报成真实业务成功。

## 为什么没有继续实现其他入口

- “我的医生”依赖受控医生目录和关系 owner，旧表保存的是客户端医生快照，不能直接照搬。
- 临床病历、住院、电子导诊、风险评估、预问诊和随访缺少正式 Provider/临床版本契约，不能用预约或患者目录冒充。
- 锦旗、表扬信、患者新增绑定和签名真实写入需要患者/就诊引用、幂等、审核、撤回和医护读取规则。
- 二维码、预约写入、支付、医保和 HIS 回写属于副作用链路，继续放到后续独立批次。

## 代码与验证边界

机器台账把本批四个旧入口标记为 `partial`，并由迁移覆盖测试锁定状态与 native target。
验证时必须同时通过小程序类型检查、全量小程序回归、迁移台账、广度交互、文档和格式门禁；
代码测试通过仍不能替代当前候选的公网、服务端低敏日志和真机证据。
