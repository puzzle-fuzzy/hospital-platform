# 当前迁移执行检查点（2026-08-17）

本文是新会话继续迁移时的短入口。它不替代逐域 contract，而是把当前线上事实、剩余范围、
下一步顺序和停止条件固定下来，避免在 Provider 文档不足时凭旧页面猜实现。

> 当前线上 release 是 `131fb5a`。真实微信、患者上下文和 P0 只读验收的操作顺序统一见
> [`P0 只读业务验收手册`](../release/p0-readonly-business-acceptance-runbook-2026-08-17.md)；本文后面的历史证据段落保留原时间线，不能当作当前 release 的新业务证据。

## 1. 当前事实

| 项目 | 当前状态 | 证据 |
| --- | --- | --- |
| 仓库 `main` | `6b4be2e`；包含 `aa536eb` 排班字段边界修正、迁移台账和最新公网 smoke 文档，尚未部署线上 | Git history；不得用仓库 HEAD 代替线上 release |
| 线上新 API | `131fb5a`，`18081`，production mode | [`131fb5a-production-acceptance-2026-08-17.md`](../release/131fb5a-production-acceptance-2026-08-17.md) |
| 旧 API | Python `8001` 继续运行，不能因为新端验收而停止 | 同上 |
| 依赖 | 远端 MySQL `hospital-dev` 共库、Redis DB3/DB1 隔离、schema `0015` 已验证 | [`current-production-observability-audit-2026-08-17.md`](../release/current-production-observability-audit-2026-08-17.md) |
| 运行前置 | 公网 runtime smoke readiness `6/6`、no-store、system ping、未登录 401 通过 | [`131fb5a-production-acceptance-2026-08-17.md`](../release/131fb5a-production-acceptance-2026-08-17.md) |
| 原生页面 | `app.json` 注册 14 页，页面/构建/跳转台账通过 | [`native-page-migration-status.md`](native-page-migration-status.md) |
| Provider 文档 | 当前 intake 审计 3 份接收记录、26 个 documentId；新增旧项目目录发现材料和挂号/支付/退款材料均为 `normalized`，不能据此打开写入 | [`../provider-intake/2026-08-17-legacy-document-discovery.md`](../provider-intake/2026-08-17-legacy-document-discovery.md) |

公网基础运行边界的最新只读复核（2026-08-17 09:17 CST）已记录在
[`current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md)：live、ready 连续
3/3、system-ping 和未登录认证边界通过；该证据没有更新任何真实业务验收状态。

## 2. 剩余范围分层

### P0：已有代码，但缺真实业务证据

这些不是继续加页面，而是用当前 `131fb5a` 完成真实链路：

1. 微信登录、Redis 会话实际 TTL、`/me` 恢复；
2. 患者同步 replay、第二位就诊人、多患者切换、inactive/recovery；
3. 普通资料真实读取、首次更新和 409 版本冲突；
4. 预约历史和爽约筛选的真实 Provider 状态映射；
5. 门诊费用待缴/已缴只读目录、金额/空列表/状态切换；
6. 报告目录在报告 gate 打开后的真实 Provider 只读链路；当前报告 gate 仍关闭，不能把页面骨架当作完成；
7. 真机页面网络、页面返回、刷新并发和服务端 `traceId` 对齐。

P0 的退出条件是：每个域都具备服务器日志、平台公网请求和真机页面三层证据；患者域还必须有
owner 目录、内部 `patientId`、TTL 和失效/恢复证据。单元测试、preflight 或 readiness 不能替代这些证据。

### P1：等待新的 Provider/HIS/外部服务文档

- 门诊病历目录、正文和资源授权；
- 门诊费用详情、电子票据和短期文件 URL；
- 患者新增、查档、绑卡、协议、签名和家属关系；
- 动态医院/院区、坐标、楼层和路线；
- 公众号二维码、关注状态、订阅消息和外部主体；
- 互联网医院/客服 WebView 的 HTTPS allowlist 和回调；
- 住院中心、住院费用、采血预约；
- 反馈工单、医生关系、预问诊、出院随访和其他便民服务。

没有文档、脱敏请求/响应样例、错误/状态定义和权限边界时，保持 route 未注册或静态安全子集。

### P2：需要临床/内容审核

健康知识导入与发布、BMI/血压计算、风险自测、健康问卷、AI 导诊/咨询、出院随访建议和报告解读。
这些内容不能从旧端分值、阈值或文案直接复制为医疗结论；必须版本化、可审计并有审核主体。

### P3：最后处理的高风险副作用

预约锁号/写入/取消、现金支付、微信支付、医保授权与结算、查单/退款、HIS 回写、通知补偿和管理端
权限。每个副作用都必须先冻结幂等键、最终状态查询、超时补偿、金额单位、回滚和日志字段。

## 3. 下一步执行顺序

### 第一步：真实微信和患者上下文

用户在开发者工具或真机执行 `wx.login`，进入患者选择页并完成一次刷新/切换；服务端保存低敏
`traceId`、会话 TTL、患者数量、active/inactive 数量和映射数量，不保存 code、openid、身份证或 token。

具体操作、日志事件和 Redis TTL 的脱敏读取方式以
[`P0 只读业务验收手册`](../release/p0-readonly-business-acceptance-runbook-2026-08-17.md) 为准。

验收必须覆盖：

- 登录成功后 `/me` 可以恢复；
- Redis TTL 与 API 过期时间一致；
- 当前患者切换后预约/记录/报告/费用请求均使用新的内部 `patientId`；
- 旧患者失效时页面要求显式重新选择，不默认切换到 `patients[0]`；
- 同步 replay 不生成第二套内部患者 ID，不重复访问 Provider。

### 第二步：P0 只读域逐个闭环

固定顺序为：预约历史 → 门诊费用 → 普通资料 → 报告目录。每个域都按：

`真实 provider 结果 → adapter 字段白名单 → owner/状态/时间边界 → API → 公网 → 真机 → 日志证据`

推进；一个域失败时只停止该域，不把错误降级为空成功，也不提前进入写入。

### 第三步：新 Provider 文档接收

新的文档入口无论是 PDF、HTML、截图、在线页面还是用户指定的其他方式，先登记：

- 来源、版本/环境、获取时间和 SHA-256 或可复核指纹；
- endpoint、方法、请求头、字段类型、金额单位、日期/分页语义；
- 成功/失败/处理中状态、错误码、重试和最终状态查询；
- 患者/就诊人标识映射、权限、owner、幂等键、TTL 和超时语义；
- 脱敏样例、真实环境可用性、回调/文件资源和日志禁止字段。

文档先进入 `provider-intake`，再更新 `provider-contract-template` 和对应迁移矩阵；没有冻结 contract
前不得写 adapter、公共 API 或页面字段。字段不确定时保留 `待 contract`。

### 第四步：最后打开副作用

只有对应只读链路、状态机、最终状态查询和补偿证据齐全后，才逐项评估预约写入、现金支付、医保、
退款和 HIS。支付成功、医保授权成功和 HIS 回写成功必须分别有服务端事实，不能以前端弹窗或第三方
返回一次成功替代。

## 4. 偏移检查表

每次开始新任务前确认：

- 是否仍然只通过 Hospital API 访问 Provider；
- 是否错误使用了 `thirdPatientId`、provider 患者号、排班号或数组下标作为新端公开 ID；
- 是否把列表 200、ready、静态页面或空列表当成业务完成；
- 是否在没有新文档时猜了 URL、字段、金额、状态或回调；
- 是否让患者切换、异步刷新或返回页面复用了旧上下文；
- 是否记录了可关联但低敏的日志，而没有记录 token、openid、身份证、原始报文或支付凭证；
- 是否触碰旧 Python `8001`、旧表、旧 Redis DB1 或打开支付/医保/HIS gate；
- 是否同步更新 contract、迁移台账、日志说明、测试和 release 证据。

## 5. 本轮 P0 复核证据

- 本地 `pnpm test`、`pnpm typecheck` 和小程序构建均通过；9 个 workspace 包测试成功，原生小程序
  14 个注册页面的运行时脚本均生成。测试和构建只能证明代码边界与构建产物一致，不能替代真实微信和
  Provider 业务证据。
- 当前仓库 HEAD `6b4be2e` 尚未发布；`aa536eb` 只收紧排班 adapter 的 `usableSourceNum` 字段边界，
  没有改变支付、医保、预约写入或旧 Python 服务。线上验收必须继续以 `131fb5a` 的 bundle provenance
  和 journald 为准，不能用本地测试结果推导线上已经拥有该修正。
- 本轮尝试只读连接 `ps@192.168.112.172` 获取当前 release 和业务日志时，SSH 返回
  `Permission denied (publickey,password)`；因此本轮没有新增服务器、公网、真实微信或 Provider 业务证据，
  也没有执行部署、重启、迁移或旧服务操作。恢复可验证 SSH 会话后，必须先重新执行 P0 手册的低敏日志和
  Redis TTL 采样，再决定是否发布 `9717766`。
- 服务器日志显示 `2026-08-17 00:13 CST` 曾有一次 `auth.wechat` 失败，错误为旧 release
  `41c9c18` 的持久化不可用；该请求发生在 `b186098` 切换前，不能归因于当前 release。
- `b186098` 在约 `01:16 CST` 切换后，`bab0ce2` 曾于约 `01:38 CST` 运行；本轮于约 `02:11 CST`
  原子切换到 `ca5a372`，并于约 `02:30 CST` 原子切换到当前 `527d163`。`ca5a372` 切换后曾出现一次
  真实微信登录持久化 503，约 3 秒后重试成功，随后完成单患者同步、预约科室和排班读取；该证据发生在
  `527d163` 切换前，且第一次失败没有底层安全错误码。当前仍没有 Redis TTL、多患者切换、预约历史
  或门诊费用完整业务证据，完整发布证据见
  [`../release/527d163-production-acceptance-2026-08-17.md`](../release/527d163-production-acceptance-2026-08-17.md)。

## 6. 当前明确不宣称

当前不能宣称：完整微信真机登录验收、多患者/TTL/失效恢复、预约历史/门诊费用/报告真实 Provider
验收、病历/费用详情/患者绑定/动态医院/二维码/便民服务完成，以及任何预约写入、支付、医保、退款或
HIS 回写完成。

## 7. 本轮基础设施观测增强

本轮补齐了 MySQL、Redis 和 schema 只读 readiness 探针的安全诊断字段：不可用与恢复事件均可记录
`attempts` 和 `durationMs`，schema 额外记录 `schemaStatus`、缺失 migration 数量和缺失结构数量。
其中 `attempts` 只表示探针自身的有限重试，不能解释为预约、支付或其他业务写入被重放；恢复日志的
字段仍然不包含连接串、SQL、原始异常消息、参数或第三方报文。详细字段约束见 [`日志规范`](../logging.md)。

本轮本地门禁已通过：`architecture:audit`、`migration:audit`、`provider:audit`、格式检查、lint、
9 个 workspace 的 typecheck/test 和 build。该结果只证明代码与日志契约一致；线上 release、公开网络
readiness 以及真实微信/Provider 业务证据仍需单独记录，不能由本地门禁替代。

本轮还修正了受保护 API 的认证顺序：Elysia 在 query/body/params schema 校验前验证 Bearer，
未登录或会话失效统一返回 `401 unauthorized`，认证通过后才返回 `400 validation`；微信登录和微信支付
回调仍是明确公开入口。该修正已由 API 集成测试、候选临时端口 smoke 和当前公网无会话回归验证，
当前线上 `131fb5a` 已具备该行为。业务会话、患者和 Provider 证据仍不能由认证边界 smoke 替代。

随后 `527d163` 已完成真实生产 env preflight、`127.0.0.1:18082` 候选 smoke、原子切换和公网
6/6 readiness 验收；旧 Python `8001` 保持运行，候选端口已释放。`527d163` 只增强持久化瞬态故障
的安全诊断字段，不增加写入重试；尚无新的真实登录失败样本，不能宣称瞬态故障已根治。完整发布边界
见 [`../release/527d163-production-acceptance-2026-08-17.md`](../release/527d163-production-acceptance-2026-08-17.md)。

本轮还补齐了 `PersistenceUnavailableError` 的安全诊断字段：只记录持久化操作分类和固定允许列表
中的连接/传输错误码；原始 SQL、连接串、参数和错误消息仍不会进入 HTTP 或结构化日志，且写入/事务
不增加盲目重试。详细规则见 [日志规范](../logging.md)。

随后针对真实日志中可能出现的驱动包装层格式差异继续收紧了这条边界：`PROTOCOL_CONNECTION_LOST`
等固定错误码现在统一兼容大小写、短横线和下划线差异，但只输出规范化的大写下划线值；包含主机、
连接串或 SQL 片段的自定义 code 仍会被拒绝。这个修正只提升故障关联能力，不改变 503 响应、只读
连接池有限重试或写入/事务禁止盲目重试的规则，并已补充 persistence 单元测试。
