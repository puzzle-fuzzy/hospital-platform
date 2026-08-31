# 患者数据生命周期与身份撤回策略

> 状态：仓库级策略与代码事实基线，日期：2026-08-31。
>
> 本文解决“代码应该如何处理数据”的工程边界，不等同于生产环境已经完成
> 数据清理、备份删除或法律合规确认。上线前仍需由数据负责人确认保留期限、
> 法律留存和实际执行证据。

## 1. 目标和不可突破的边界

新平台只保存完成当前业务闭环所必需的最小字段。微信身份关联、患者目录、
Provider 引用、报告短期引用、预约排班快照、订单和 outbox 事件分属不同用途，
不能因为同一个用户或患者而合并成一张“全量档案”。

以下字段不得进入小程序响应、公共 contract、Pino 日志或 URL：

- `session_key`、微信授权码、Provider access token 和支付 token；
- 完整身份证号、手机号、银行卡号、医保卡号和 Provider 原始患者号；
- Provider 原始响应、原始 query/body、完整 outbox payload 和诊疗正文。

`provider_subject`、`union_id`、`provider_patient_id` 虽然不是公开字段，仍属于身份
关联引用；它们只能在服务端持久化层和经过授权的 adapter 调用边界使用。脱敏摘要、
平台内部 `userId`/`patientId` 和短期 `reportId` 才能进入业务响应或低敏日志。

## 2. 当前 schema 的真实存储边界

| 数据类别 | 当前表/存储 | 允许保存的内容 | 当前生命周期事实 | 未完成的外部确认 |
| --- | --- | --- | --- | --- |
| 微信身份 | `hp_identity_users` | 平台 `user_id`、`provider_subject`、可选 `union_id`、创建/更新时间 | 通过唯一键绑定 Provider subject；没有会话密钥列 | 最小化保留、解绑、撤回和备份清除期限 |
| 普通资料 | `hp_user_profiles` | 昵称、性别、可选年龄/邮箱、版本号 | 与身份外键关联，删除身份时由 `ON DELETE CASCADE` 清理 | 运营侧删除请求、恢复副本和日志留存 |
| 患者目录 | `hp_patients` | 平台患者 id、owner、展示名、关系、脱敏卡号、来源、目录 Provider 引用、active/last-seen | Provider 目录消失先标记 `directory_active=0`，不直接物理删除 | 存量保留期限、账户撤回后的删除/归档方案 |
| 临床 Provider 引用 | `hp_patient_provider_references` | owner、平台患者 id、Provider 名称/用途、Provider 患者引用 | 绑定患者外键并 `ON DELETE CASCADE`；用途隔离 | Provider 侧解绑、撤销和备份清除证明 |
| 报告短期引用 | `hp_report_references` | 平台 report id、owner/patient、Provider/类型、Provider 报告引用、`expires_at` | 查询必须校验 owner、patient 和未过期；过期后不得继续查 Provider | 定时清理、撤回和灾备副本清理证据 |
| 预约排班观察快照 | `hp_appointment_schedule_snapshots` | 脱敏排班、时段、数量、Provider 请求引用、观察/过期时间 | 只读候选事实；`expires_at` 过期后不能用于写入 | 快照清理任务和保留期限 |
| 订单/支付事件 | `hp_payment_quotes`、`hp_payment_orders`、`hp_outbox_events` | 平台订单、分金额、状态、幂等键、受控事件状态 | 当前支付 gate 关闭；订单事实必须按 MySQL 恢复，outbox 达上限转人工复核 | 生产留存、对账、法律留存和删除豁免 |
| 会话 | Redis | 短期会话状态和代际信息 | 由配置 TTL 控制；Redis 不是支付/订单事实源 | 生产 Redis TTL 和清理证明 |

以上结论直接来自 `packages/persistence/migrations/0001_core.sql`、`0008`、`0009`、
`0012`、`0013`、`0014`、`0015` 和现有 MySQL repository。没有把“有外键”误判成
“已经完成隐私删除”：订单、报价、患者和报告引用之间存在保留/约束关系，账户撤回
不能在没有留存策略的情况下直接执行级联删除。

## 3. 撤回、解绑和删除的工程规则

### 3.1 微信身份撤回

1. 先冻结新的登录和业务写入，不删除审计事实来掩盖历史操作。
2. 解除 Provider subject 与平台用户的可登录绑定；`union_id` 不得迁移给其他用户。
3. 读取 owner 下的患者、报告引用、订单、outbox 和人工复核项，生成低敏影响清单。
4. 只有在数据负责人确认没有未结算订单、法定留存或人工复核事项后，才允许执行
   分阶段删除/归档；否则保留受限状态并拒绝新的业务操作。
5. 删除或归档完成后，必须核对主库、缓存、备份、日志和 Provider 侧撤回结果，保存
   仅含内部 id、数量、时间和 traceId 的审计记录。

当前仓库没有“账户撤回 API”或可直接运行的删除脚本，因此不能把上述流程标为已完成，
也不能在没有确认的情况下为 `hp_identity_users` 增加级联删除来绕过订单约束。

### 3.2 患者解绑

- 患者关系必须按 `owner_user_id + patient_id` 检查；不能按展示名、卡号或 Provider id
  找人。
- 目录同步缺失只改变 `directory_active`，不自动删除可能仍被报告/费用/订单引用的患者。
- Provider 引用撤销后，临床查询必须得到明确的“不可用/无权限”，不能降级为另一种
  患者或另一用途的 Provider 引用。
- 解绑操作需要幂等键、操作者、原因码、影响数量和结果摘要；原始身份证、卡号和
  Provider 响应不能写入审计日志。

### 3.3 报告和短期引用

`reportId` 是平台短期引用，不是 Provider 报告号。所有详情读取必须继续经过 owner、
patient 和 `expires_at` 三重检查；过期引用应进入受控清理任务，不能仅依靠“前端不再
展示”作为删除证明。

## 4. 访问、备份和日志要求

- API 只接受当前会话派生的 owner；客户端提交的 patient id、report id 只能作为待校验
  引用，不能改变 owner 范围。
- repository/adapter 是敏感字段的唯一边界；domain 和小程序使用平台内部引用与脱敏
  显示模型。
- 日志只记录 `requestId`、`traceId`、固定操作名、内部对象数量、错误分类和耗时；
  不记录 raw body/query、Provider id、身份凭证或完整 payload。
- MySQL 备份、binlog/PITR 和隔离恢复必须继承生产数据分级与留存策略；恢复演练结束后
  的临时副本必须可证明地销毁。Redis 会话可以重新建立，不能以 Redis 备份覆盖订单事实。
- 任何“删除成功”必须同时有主库结果、缓存结果、备份/副本处理结果和低敏审计事件；
  单纯返回 HTTP 200 或前端移除一行不构成删除成功。

## 5. 上线前的外部签字清单

以下事项不由本仓库测试代替，完成前相关业务 gate 保持关闭：

1. 数据负责人确认身份、患者目录、Provider 引用、报告引用、快照、订单、日志和备份的
   实际保留期限；
2. 安全/运维负责人确认主库、Redis、日志平台、备份、PITR、灾备副本的访问控制和清理；
3. Provider 负责人确认患者解绑、报告撤回和身份撤回的外部动作与结果凭证；
4. 具备脱敏 staging、数量/关系/孤儿记录校验、幂等重跑、旧端只读窗口和失败回滚证据；
5. 真机验证登录、切换患者、报告过期、拒绝授权和重试场景，并关联 requestId/traceId。

在上述证据到齐前，技术默认仍是新库冷启动、只读业务 fail-closed、支付/医保/HIS 关闭。
