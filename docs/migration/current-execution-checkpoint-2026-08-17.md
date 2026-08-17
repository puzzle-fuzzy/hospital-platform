# 当前迁移执行检查点（2026-08-17）

本文是新会话继续迁移时的短入口。它不替代逐域 contract，而是把当前线上事实、剩余范围、
下一步顺序和停止条件固定下来，避免在 Provider 文档不足时凭旧页面猜实现。

> 当前线上 release 是 `131fb5a`。真实微信、患者上下文和 P0 只读验收的操作顺序统一见
> [`P0 只读业务验收手册`](../release/p0-readonly-business-acceptance-runbook-2026-08-17.md)；本文后面的历史证据段落保留原时间线，不能当作当前 release 的新业务证据。

## 1. 当前事实

| 项目 | 当前状态 | 证据 |
| --- | --- | --- |
| 仓库代码候选 | 最新运行时实现提交为 `a4033b0`，文档检查点将由本次同步提交更新；在 `9d9e7b1` 的 opaque 标识边界基础上，门诊费用、预约历史和爽约页均增加首批 10 条的本地渲染窗口，并收紧患者同步幂等键生成，不改变服务端完整查询结果、金额或状态语义；均尚未部署线上，仓库实际 HEAD 以 Git history 为准 | Git history；不得用仓库代码或文档 HEAD 代替线上 release |
| 线上新 API | `131fb5a`，`18081`，production mode | [`131fb5a-production-acceptance-2026-08-17.md`](../release/131fb5a-production-acceptance-2026-08-17.md) |
| 旧 API | Python `8001` 继续运行，不能因为新端验收而停止 | 同上 |
| 依赖 | 线上仍是远端 MySQL `hospital-dev` 共库、Redis DB3/DB1 隔离、schema `0015`；候选新增 `0016_patient_directory_sync_owner_index` 尚未应用 | [`current-production-observability-audit-2026-08-17.md`](../release/current-production-observability-audit-2026-08-17.md) |
| 运行前置 | 公网 runtime smoke readiness `6/6`、no-store、system ping、未登录 401 通过 | [`131fb5a-production-acceptance-2026-08-17.md`](../release/131fb5a-production-acceptance-2026-08-17.md) |
| 原生页面 | `app.json` 注册 14 页，页面/构建/跳转台账通过 | [`native-page-migration-status.md`](native-page-migration-status.md) |
| Provider 文档 | 当前 intake 审计 3 份接收记录、26 个 documentId；新增旧项目目录发现材料和挂号/支付/退款材料均为 `normalized`，不能据此打开写入 | [`../provider-intake/2026-08-17-legacy-document-discovery.md`](../provider-intake/2026-08-17-legacy-document-discovery.md) |

公网基础运行边界的最新只读复核（2026-08-17 09:53 CST）已记录在
[`current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md)：live、ready 连续
3/3、system-ping 和未登录认证边界通过；该证据没有更新任何真实业务验收状态。

随后于 2026-08-17 11:13 CST 进行的公网只读复核已记录在同一证据文档的 2.5 节：live、ready、system-ping
均成功，`/patients` 未登录返回 `401 unauthorized`，并保留了本次 `x-request-id`；该复核仍不代表本地候选
已部署，也不更新微信、患者、Provider 或真机业务验收状态。

随后于 2026-08-17 12:06 CST 完成了更窄的公网关闭边界复核：live/ready/system-ping 仍通过，未登录的患者
和预约历史请求在业务 query 前返回 `401 unauthorized`，病历、医保授权和预约写入候选路径继续返回
`404 not-found`。本次没有携带会话、患者或 Provider 凭证，也没有执行任何写入；证据见
[`../release/current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md) 的 2.6 节。

本地小程序运行包的最新构建复核（2026-08-17）已记录在
[`miniprogram-runtime-package-verification-2026-08-17.md`](../release/miniprogram-runtime-package-verification-2026-08-17.md)：
14 个注册页面的 `.js/.json/.wxml/.wxss` 均存在；该证据不代表开发者工具或真机已经加载本次本地产物。

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

## 5. 当前 P0 复核证据

- 本地 `pnpm test`、`pnpm typecheck` 和小程序构建均通过；9 个 workspace 包测试成功，原生小程序
  14 个注册页面的运行时脚本均生成。测试和构建只能证明代码边界与构建产物一致，不能替代真实微信和
  Provider 业务证据。
- 当前最新运行时实现提交 `a4033b0` 尚未发布；该提交在既有患者、预约、报告和门诊费用只读边界基础上，给门诊费用、预约历史和爽约派生页增加本地分批渲染，并让首页/选择页使用集中生成的安全幂等键：完整查询结果仍保留在页面状态，首批只把 10 条交给 WXML，后续只展开已取得的同一次 owner-scoped 结果，不新增 Provider 请求，也没有改变支付、医保、预约写入或旧 Python 服务。
  文档检查点将由本次同步提交更新，同样不代表线上已部署。线上验收必须继续以 `131fb5a` 的 bundle provenance 和 journald 为准，不能用本地测试结果推导线上已经拥有这些修正。
- 本轮尝试只读连接 `ps@192.168.112.172` 获取当前 release 和业务日志时，SSH 返回
  `Permission denied (publickey,password)`；因此本轮没有新增服务器、公网、真实微信或 Provider 业务证据，
  也没有执行部署、重启、迁移或旧服务操作。恢复可验证 SSH 会话后，必须先重新执行 P0 手册的低敏日志和
  Redis TTL 采样，再决定是否发布当前代码候选 `a4033b0`。
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

本轮独立门禁已通过：`architecture:audit`、`provider:audit`、文档断链、格式检查、lint、9 个 workspace
的 typecheck/test 和 build。`migration:audit` 未能整体判绿：它读取的旧仓库 `G:\\fuck\\hospital` 正被其他会话
修改，当前 `module_common` 和挂载总数、旧端 endpoint 台账均发生漂移；本轮没有修改该外部工作树或擅自刷新清单。
这只说明完整 `pnpm check` 仍有外部审计阻塞，不影响本轮代码门禁结果；线上 release、公开网络 readiness 以及真实
微信/Provider 业务证据仍需单独记录，不能由本地门禁替代。

本轮还修正了受保护 API 的认证顺序：Elysia 在 query/body/params schema 校验前验证 Bearer，
未登录或会话失效统一返回 `401 unauthorized`，认证通过后才返回 `400 validation`；微信登录和微信支付
回调仍是明确公开入口。该修正已由 API 集成测试、候选临时端口 smoke 和当前公网无会话回归验证，
当前线上 `131fb5a` 已具备该行为。业务会话、患者和 Provider 证据仍不能由认证边界 smoke 替代。

随后补充了患者同步入口的专门契约测试：未登录的 `POST /patients/sync` 在缺少幂等键时仍先返回
`401 unauthorized`；已登录但幂等键缺失或包含非法字符时返回 `400 validation`，并确认 provider
调用次数为 0。该轮只增加测试和文档，不改变已验证实现候选 `ef6f34c`，也没有发布或重启线上服务。

本轮又补充门诊费用 API 组合测试：平台 `patientId` 必须由服务端 owner-scoped 解析为
`his-patient` 引用；`unpaid`/`paid` 请求分别向 gateway 传递正确状态；Provider 确认的空目录保持
HTTP 200、`items: []`、`total: 0`，不能被页面解释成异常。该测试使用合成 gateway，只证明 API 组合
和响应契约，不替代当前线上账号、公网 Provider 或真机费用证据。

随后补充普通资料版本冲突日志：服务端继续返回 `409 user-profile-conflict`，同时记录不含用户 ID、
版本值和资料正文的 `user.profile.conflict` 事件，便于按 trace 定位多设备并发修改。该实现提交为
`4576e3a`，尚未发布线上；对应测试、日志规范和全量门禁已通过。

随后收紧报告详情来源边界：`ReportDirectoryEntry` 采用按报告类型区分的类型，只有 LIS 可以保留
`providerReportId` 并建立短期 opaque 详情引用；PACS/ECG 即使 provider 返回原始报告号，也在 adapter
边界丢弃。对应实现提交为 `3ced434`，尚未发布线上；adapter、领域类型、API 文档和全仓门禁已通过。

随后补齐报告详情页面的状态展示边界：服务端 `normal/high/low/critical/unknown` 枚举仍保持不变，
小程序只在展示层转换为“正常/偏高/偏低/危急/待确认”，不把患者文案写回 API 事实。对应实现提交为
`16b3264`，尚未发布线上；小程序 55 项验收、全仓门禁和运行包构建均已通过。

随后补齐预约历史时间展示边界：adapter 从已确认的 `groupStart/groupEnd` 提取 `HH:mm` 或
`HH:mm-HH:mm`，不把完整日期时间字段带入公共响应；时间段不完整或无法解析时回退 provider 的
`workTime`，不猜测结束时间。对应实现提交为 `d0bc8e1`，尚未发布线上；预约 adapter 57 项测试和
全仓门禁均已通过。

随后收紧门诊费用账单时间边界：adapter 只接受 `YYYY-MM-DD HH:mm:ss` 的中国标准时间文本，
并拒绝不存在的自然日、越界时分秒和带时区的 ISO 文本；这避免页面按设备时区猜测账单时间，
也保证稳定费用引用使用可验证的日期事实。对应实现提交为 `f5178a4`，尚未发布线上；适配器
新增日期边界测试，完整 `pnpm check` 已通过。

随后补齐普通个人资料读取日志：`GET /me/profile` 现在记录 `requested`、`loaded` 和
`read_failed` 事件，`loaded` 仅标记是否存在持久化资料行，失败事件仅记录错误类型；不记录
userId、昵称、邮箱或底层异常。对应实现提交为 `108d924`，尚未发布线上；API 81 项测试、
小程序 55 项验收和完整 `pnpm check` 已通过。

随后修正患者目录的跨页面并发边界：不同页面生成不同 `Idempotency-Key` 时，服务端不能只依赖
幂等键唯一约束，否则首页和选择页仍可能同时访问 provider。`bf71c49` 在同步开始事务中锁定
owner 身份行，并使用 `0016_patient_directory_sync_owner_index` 查询同一 owner/provider 的
活跃租约；内存仓储、MySQL 仓储和 API 测试均确认第二个不同 key 返回 `patient-sync-in-progress`，
不会产生第二次 provider 请求。该候选尚未部署，生产 schema 仍是 `0015`，完整 `pnpm check` 与
真实并发、公网、真机证据仍待完成。

随后补充患者同步处理中日志的冲突范围：`7bbdd99` 让服务端只记录固定的
`conflictScope=same-key|owner-provider`，分别区分同 key 网络重试和首页/选择页不同 key 的
跨页面并发；该字段不进入 API 响应，也不记录幂等键原文。同步文档、日志规范和旧端支付调起
行为台账已同步，完整 `pnpm check` 继续通过。

随后修正并发日志状态：`c291b93` 保证 `patient-sync-in-progress` 只记录带
`conflictScope` 的 `patient.directory.operation.in_progress`，不会再被总异常捕获器追加为
`patient.directory.failed`；同 key 和跨页面不同 key 均有测试覆盖。旧端支付调起台账随当前源代码
复核为 2 个文件，未将其他会话的旧端临时变化误写成新端能力。

随后 `e1fcc2d` 补齐预约历史的失败日志闭环：输入校验、依赖未配置、owner 映射和 Provider
异常统一记录 `appointment.records.failed`；只有 Provider 明确返回空数组时才记录
`appointment.records.synced` 且 `itemCount=0`。测试覆盖空结果、依赖缺失和 Provider 异常，完整
`pnpm check` 已通过；该候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `144fc5a` 补充门诊费用失败事件的内部 `patientId`，使 owner 映射失败、Provider 失败和
页面请求可以通过 `traceId + patientId + status` 关联；provider 患者号仍不进入日志。门诊费用服务
测试和 API typecheck 已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `1d6ca5c` 统一报告目录与详情的失败日志出口：报告目录非法查询、owner 映射和 Provider
异常记录 `report.directory.failed`；详情依赖未配置、owner/TTL 查询和 Provider 异常记录
`report.detail.failed`；Provider 明确空目录仍只记录 `report.directory.synced(itemCount=0)`。
报告 API 测试 84 项、全仓门禁已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `dd8ac8c` 冻结报告目录多来源聚合边界：未指定 `kind` 时 LIS、PACS、ECG 必须全部成功，
任一来源失败都拒绝整批响应，不使用部分成功或静默丢失报告类型；对应 adapter 测试、公共 API 文档、
业务正确性文档和 Provider 审计已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `c660462` 修正“我的”页的失败收敛：`/me` 或患者目录读取失败时清理当前页面的用户标签、
患者卡片和数量，但保留可重试的本地选择与会话 token，避免旧患者上下文被误显示为当前认证事实。
小程序验收 56 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `29d4213` 修正患者选择页的临床映射竞态：目录读取成功不等于 `his-patient` 映射已经完成，
页面只有完整同步成功且目录非空时才允许点击患者返回；同步失败时可以保留列表帮助诊断，但选择操作
会被拦截，不能让预约、报告或门诊费用页使用未确认映射的患者上下文。小程序验收 57 项、类型检查已通过，
候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `01ad0eb` 统一挂号记录和爽约记录的患者切换展示边界：新一轮 owner-scoped 目录读取开始时立即清理
上一位患者的卡片和列表，最新请求守卫继续阻止旧响应回写；这样在等待 Provider 读取期间不会出现患者身份
与记录内容短暂错配。小程序验收 58 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产
schema `0015` 为准。

随后 `2850c17` 完善普通资料更新的业务日志边界：输入校验拒绝也记录 `user.profile.update_failed` 的
固定错误类型，`age: null` 和 `email: null` 的合法清空操作按请求字段计入修改数量；不记录用户身份、资料
字段或原始请求。API 测试 85 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema
`0015` 为准。

随后 `91997c7` 修正预约目录刷新期间的旧读模型隔离：下拉刷新开始即清空科室、排班、日期分组和号源
列表，旧请求即使晚返回也不能恢复旧目录；新数据必须在科室和对应排班读取成功后重新填充。小程序验收
58 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准；预约写入、锁号、
取消和支付仍未开放。

随后 `c3bde66` 修正门诊费用 tab 的初始化竞态：患者目录尚未确认时切换待缴/已缴只记录最后点击的状态，
不能创建新请求守卫取消初始 owner-scoped 患者读取；确认患者后才按最新状态查询费用。小程序验收 59 项、
类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准；支付调起和医保授权仍未开放。

随后 `7ea8228` 补齐预约目录合法空结果的页面边界：Provider 返回空科室目录时展示明确空态，区分“暂无可预约
科室”和请求失败，不留下空白页面，也不伪造号源。小程序验收 59 项、类型检查已通过，候选仍未部署，线上
继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `dc6d63f` 收敛首页患者上下文失败状态：患者目录读取或临床映射同步失败时清理首页患者卡片、列表和
选中展示，但保留本地 opaque 选择与会话 token，供后续恢复和 stale 判断；健康检查失败仍保持独立处理。
小程序验收 60 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `9d258a1` 修正选择页失败态：同步失败时可以保留目录列表帮助诊断和重试，但必须清除上一轮“当前”
展示标记并继续禁止选择，避免把尚未确认的 `his-patient` 映射误显示为有效上下文；本地 opaque `patientId`
不删除，仍用于目录恢复后的 stale 判断。小程序验收 61 项、类型检查已通过，候选仍未部署，线上继续以
`131fb5a` 和生产 schema `0015` 为准。

随后 `34bbb9c` 将同一规则前移到读取和同步开始：待确认期间不展示旧“当前”患者，只有最新 owner-scoped
目录与临床映射同步成功后才恢复标记；本地 opaque `patientId` 仍保留，避免暂时故障导致静默换人。小程序
验收 62 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `4aa877f` 进一步收紧首帧边界：选择页不再在 owner-scoped 目录返回前直接读取本地选择来绘制当前患者，
避免出现短暂的误导性标记；本地 opaque `patientId` 仍只保留在 storage，供目录恢复后的 stale 判断使用。小程序
验收 62 项、类型检查已通过，候选仍未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `3a596b1` 完成门诊待支付列表 2.6.33 的只读 contract diff：Provider `tradeStatus` 只有 `1=待支付`、
`3=已支付` 可进入公共 `unpaid/paid`，`2/4/5/9` 在独立结算与退款 contract 确认前全部拒绝；同时记录了当前
平台不透传 Provider 可选筛选参数的原因。适配器测试 60 项、类型检查已通过；没有增加公共接口，候选仍未部署，
线上继续以 `131fb5a` 和生产 schema `0015` 为准，支付/医保保持关闭。

随后 `596419d` 修正文档一致性：日期窗口审计和小程序 README 统一说明“我的挂号”使用当前日前后各 90 天，
“爽约记录”单独使用过去 90 天；这只是文档修正，不改变 API、服务端或小程序运行代码。

随后 `09e30b9` 补充只读业务日志生命周期：输入校验失败可能只产生 `*.failed`，`requested` 只代表已通过基础
校验并即将进入 owner/provider 链路，`synced/loaded` 只代表白名单读模型成功，不能被 HTTP 200 或空结果误解为
预约、结算或支付成功；该提交仅更新日志规范。

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

随后 `0610558` 收紧门诊缴费查询状态的运行时边界：领域 service 和众阳 adapter 共用白名单守卫，
未知状态返回 `400 outpatient-payment-query-invalid`，不会被历史的“非 unpaid 即 paid”分支误发为
`tradeStatus=3`，也不会触发 Provider 请求；失败日志只记录 `status=invalid`。API 86 项、原生小程序
58 项、全量 typecheck/test/build 和文档/迁移审计均通过，候选尚未部署，线上继续以 `131fb5a` 和生产
schema `0015` 为准，支付/医保/HIS 仍保持关闭。

随后 `0505709` 收紧报告目录的 `kind` 运行时边界：领域 service 和众阳 adapter 共用来源白名单，
未知值返回已有的 `400 report-query-invalid`，不会被 adapter 默认分支误发为 ECG，也不会触发 Provider
请求；失败日志只记录 `report.directory.failed` 和稳定错误类型。API 86 项、原生小程序 62 项、adapter
62 项及全量 typecheck/test/build 和文档/迁移审计均通过，候选尚未部署，线上继续以 `131fb5a` 和生产
schema `0015` 为准；报告 gate、二维码、支付/医保/HIS 仍保持各自关闭边界。

随后 `87f7171` 补齐预约科室和排班服务层的失败日志出口：日期校验与服务端日期窗口生成均纳入
统一 `try/catch`，非法日期只记录对应的 `appointment.directory.departments.failed` 或
`appointment.directory.schedules.failed`，不记录虚假的 `requested`，也不访问 Provider；合法空目录、
排班快照和预约历史语义不变。API 87 项、原生小程序 62 项、全量 typecheck/test/build 和文档/迁移审计
均通过，候选尚未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准。

随后 `c1d10e3` 拆分患者目录同步与读模型读取的日志生命周期：`GET /patients` 记录
`patient.directory.read.requested/read.loaded/read.failed`，只记录 trace 和脱敏数量；患者快照事务或 durable
replay 已成立后，最后一步读模型暂时失败只记录 `read.failed`，不会再追加 `patient.directory.failed`，避免把数据库读失败
误判为 Provider 同步失败。患者服务定向测试 7 项、API 集成测试 33 项和全量 `pnpm check` 已通过；候选尚未部署，线上
继续以 `131fb5a` 和生产 schema `0015` 为准，支付/医保/HIS、二维码、预约写入仍保持关闭。

随后 `9d9e7b1` 将 opaque 标识的形状边界下沉到 domain/service 层：预约科室/医生过滤标识、预约历史
`patientId`、报告 `patientId/reportId` 和门诊费用 `patientId` 即使绕过 Elysia schema，也必须非空、长度不超过
128、无首尾空白和控制字符；非法值在 repository/provider 前失败，业务失败日志统一使用 `invalid`，不记录原始值。
该校验明确不替代 owner、TTL 或 provider 映射校验；API 91 项、domain 21 项、原生小程序 62 项、全量
typecheck/test/build、架构/provider/文档/格式/Lint 检查均通过。完整 `pnpm check` 的 migration audit 目前被外部旧
仓库 `G:\\fuck\\hospital` 另一会话未提交的医保结算改动阻塞：`module_common` 33→34、挂载合计 190→191，且旧端
新增两个 endpoint 未登记；本轮不改动该外部工作树和清单。提交未部署，线上继续以 `131fb5a` 和生产 schema `0015`
为准，支付/医保/HIS、二维码、预约写入仍保持关闭。

随后 `3b248c0` 为门诊费用只读页面增加本地渲染窗口：服务端仍返回本次完整结果，页面首批渲染 10 条，
“加载更多”只展开当前已取得的 owner-scoped、状态固定结果，不把本地展示窗口描述成 provider 分页，
也不从列表状态推导支付成功。小程序验收、typecheck、build 和独立架构/provider/文档/格式/Lint/test
检查均通过；本提交尚未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准，支付、医保、结算与 HIS 继续关闭。

随后 `015757a` 为预约历史和爽约派生页增加同样的本地渲染窗口：服务端仍按既定日期窗口返回完整结果，
页面首批渲染 10 条，“加载更多”只展开当前已取得的数据；爽约筛选仍只接受服务端归一化的 `missed`，
不新增 Provider 请求、不改变状态或空结果语义。小程序 62 项验收、全仓 9 workspace 的 typecheck/test/build、
架构/provider/文档/格式/Lint 检查均通过；本提交尚未部署，线上继续以 `131fb5a` 和生产 schema `0015` 为准，
预约写入、支付、医保、结算与 HIS 继续关闭。

随后 `a4033b0` 收紧患者同步幂等键：首页和选择页不再只使用 `Date.now()`，而是生成符合 header 字符约束的
业务前缀、时间片和随机尾部；同一页面单飞调用仍共享同一 Promise，不同页面实例不会因同一毫秒而误共享
owner/provider/key 操作事实。小程序 63 项验收、599 个断言、typecheck、格式和文档检查通过；本提交尚未部署，
患者同步 replay、owner/provider 并发租约、真实日志和真机证据仍待线上验收。
