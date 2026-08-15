# 数据与基础设施迁移地图

## 1. 已确认的数据基础设施

| 能力 | 旧项目证据 | 新项目策略 |
| --- | --- | --- |
| 主数据库 | `app/core/database.py`、SQLAlchemy Async、MySQL 配置 | 第一阶段保留 MySQL；先建立 persistence port，再决定 Drizzle schema 迁移方式 |
| 缓存/锁 | `app/core/database.py`、Redis 配置及业务服务 | 第一阶段保留 Redis；明确 key、TTL、锁和幂等用途 |
| 文档/非结构化数据 | MongoDB 配置和连接生命周期 | 暂不迁移；先确认真实使用的集合与读写量 |
| 定时任务 | APScheduler、`/application/job` | API 与 Worker 分离；任务只通过可重试 command 触发业务服务 |
| 文件/报告 | `static/`、上传接口、报告解读 | 先定义文件存储 port，禁止把本地目录作为生产事实 |

## 2. 已看到的支付相关表候选

旧 Alembic 迁移 `9f5c4e2d1a7b_新增医保支付订单与回调事件表.py` 明确创建：

- `mbs_medical_orders`
- `mbs_payment_events`

新项目当前对应的目标事实包括：

- `hp_payment_orders`
- `hp_payment_prepay_attempts`
- `hp_wechat_payment_notifications`
- `hp_outbox_events`

已看到的字段类别包括：

- 内部订单状态、机构编码、医院订单号、微信商户订单号、混合订单号
- 医保支付订单号、支付 token 摘要、收费批次号、就诊编号
- 医保费用总额、现金支付金额、个人账户支付、基金支付
- 微信总金额/现金金额（分）、交易状态
- 回调事件 ID、payload hash、处理状态和错误信息

这证明旧项目已经开始将支付订单与回调事件持久化，但新项目仍需重新确认：

1. 线上表结构是否与当前迁移文件一致。
2. 唯一键是否覆盖所有 provider 单号和业务类型。
3. 金额字段是否需要统一迁移为整数分，避免元/分混用。
4. 事件处理是否具备锁、重试、死信和人工对账入口。

## 3. 敏感数据分类

| 分类 | 示例 | 新项目要求 |
| --- | --- | --- |
| 患者身份 | 姓名、身份证号、手机号、openid/unionid、医保个人信息 | 数据库加密/脱敏，日志只输出摘要，按患者授权访问 |
| 支付凭证 | pay token、prepay id、支付回调原文 | token 只存摘要或受控密文；原文按审计策略保存 |
| 服务端秘密 | AppSecret、APIv3 key、商户私钥、SM2/SM4 密钥 | 只进部署环境或密钥管理系统，小程序和仓库均不得出现 |
| 外部地址 | FSI forward、云健康、AI、HIS 地址 | 通过服务端配置注入，不由客户端决定目标 URL |

## 4. 迁移前必须完成的数据库工作

- 导出线上 schema、索引、约束和字符集的只读快照。
- 对照全部 Alembic revision，确认当前 head、分支和手工变更。
- 为患者、订单、支付尝试、provider 事件、outbox、审计事件建立目标字段表。
- 支付调起参数只允许受控密文落库，`prepay_id` 只保存摘要；密钥轮换需要独立的版本和回滚策略。
- 设计旧 ID 到新 ID 的映射和回滚策略。
- 在 staging 使用脱敏数据验证迁移，不直接在生产库试验。
