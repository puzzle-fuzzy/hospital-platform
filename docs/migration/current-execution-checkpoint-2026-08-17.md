# 当前迁移执行检查点（2026-08-17）

本文是新会话继续迁移时的短入口。它不替代逐域 contract，而是把当前线上事实、剩余范围、
下一步顺序和停止条件固定下来，避免在 Provider 文档不足时凭旧页面猜实现。

> 截至 2026-08-18 15:25 CST，本地仓库 `main` 的当前 HEAD 以 Git history 为准，线上 API release 已切换为 `1b94c46`；本轮已完成候选上传、隔离 smoke 和只重启新 API；新 Bun/Elysia API
> 监听 `10.0.0.3:18081`，旧 Python API 继续监听 `8001`。此前的 `b3c9a99`、`5f5915e`、`bf67b96` 等内容均为历史段落，
> 不能继续当作当前线上事实。当前 release 的发布和业务证据见
> [`../release/1b94c46-production-acceptance-2026-08-18.md`](../release/1b94c46-production-acceptance-2026-08-18.md)；配套小程序构建来源为
> `d4261e5a59e0a9bfe69534169504d8a118ebca7f`。真实微信、患者上下文和 P0 只读验收的操作顺序统一见
> [`P0 只读业务验收手册`](../release/p0-readonly-business-acceptance-runbook-2026-08-17.md)。

## 1. 当前事实

| 项目 | 当前状态 | 证据 |
| --- | --- | --- |
| 仓库代码基线 | `main` 当前 HEAD（以 Git history 为准）；生产运行 bundle 的代码来源为 `1b94c46`，仓库 HEAD 不能替代线上 release | Git history；线上 bundle provenance 见最新发布记录 |
| 线上新 API | `1b94c46`，监听 `10.0.0.3:18081`，由 `hospital-platform-api-v2.service` 托管 | [`../release/1b94c46-production-acceptance-2026-08-18.md`](../release/1b94c46-production-acceptance-2026-08-18.md) |
| 旧 API | Python `8001` 继续运行，不能因为新端验收而停止 | 同上 |
| 依赖 | 线上远端 MySQL `hospital-dev` 共库、Redis DB3/DB1 隔离、schema `0016`；`0016_patient_directory_sync_owner_index` 已应用并通过生产 preflight | [`../release/1b94c46-production-acceptance-2026-08-18.md`](../release/1b94c46-production-acceptance-2026-08-18.md) |
| 运行前置 | 公网 live、ready、system ping 通过，隔离 smoke ready 连续 3/3，未登录受保护路由返回 `401/unauthorized`；切换后启动日志为 production 且依赖均为 `ok` | [`../release/1b94c46-production-acceptance-2026-08-18.md`](../release/1b94c46-production-acceptance-2026-08-18.md) |
| 原生页面 | `app.json` 注册 14 页，页面/构建/跳转台账通过 | [`native-page-migration-status.md`](native-page-migration-status.md) |
| Provider 文档 | 当前 intake 审计 3 份接收记录、26 个 documentId；新增旧项目目录发现材料和挂号/支付/退款材料均为 `normalized`，不能据此打开写入 | [`../provider-intake/2026-08-17-legacy-document-discovery.md`](../provider-intake/2026-08-17-legacy-document-discovery.md) |

2026-08-18 15:23-15:25 CST 的切换后 SSH/公网只读复核确认 `1b94c46`、新 `10.0.0.3:18081`、旧 `0.0.0.0:8001` 和内外网
readiness 均正常；本次只重启新 API，没有修改旧服务、旧端口或数据库。此前 `c63dba9` 的日志和业务事件仍按历史 release 理解，不能回填当前业务验收。

2026-08-18 13:20 CST 的增量只读复核再次确认双端口共存和 readiness 的 database/redis/schema `ok`；切换后日志聚合仍只有
`infrastructure` 事件和健康请求，`parseErrors=0`、`systemdWarningCount=0`、`providerRequestIdCount=0`，没有新的 P0 业务请求。
因此真机验收状态不变，不能把无业务事件解释为空列表成功。

2026-08-18 13:24 CST 的重启后复核确认 `hospital-platform-api-v2.service` 为 `active/running`，`current` 仍为
`38bc553`；新 API 内网 live、公网 `/api/v2/health/live`、`/api/v2/health/ready` 和 `/api/v2/system/ping`
均返回 `200`，ready 的 database/redis/schema 仍为 `ok`。旧端 `8001` 的本机根路径 GET 返回 `404`，仅作为端口监听证据，
不作为旧业务成功证据；本次没有修改旧服务、旧端口、数据库或环境变量。该复核未新增业务事件，P0 真机验收顺序保持不变。

2026-08-18 13:35 CST 再次复核确认 `38bc553`、新旧双端口和内外网健康探针均未漂移；本次仍没有业务写入或
release 切换。日志聚合尝试因当前 SSH `sudo` 无法读取 journald 而只得到空输入，不能据此推导“没有业务事件”或
“日志无错误”；P0 业务证据继续以真机页面、HTTP trace 和具备权限的低敏日志三层为准。

公网基础运行边界的早期只读复核（2026-08-17 09:53 CST）已记录在
[`current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md)：live、ready 连续
3/3、system-ping 和未登录认证边界通过；该证据没有更新任何真实业务验收状态。

本轮先发现旧仓库并行修改造成的迁移台账漂移：`module_common` 实际为 34、旧服务挂载总数为 191，
并新增 `/common/yunhealth/registration/plugin-settlement-complete` 和 `/msun-yb-app-miop/thirdPartPay/start`。
已按旧源码逐项复核来源，并只更新新仓库的事实台账，将两条调用明确标为“最后处理”；没有修改旧工作树，
也没有把这两个路径注册到新 Elysia。更新后 `pnpm migration:audit` 已通过，支付/医保边界仍保持关闭。

本轮同时把患者选择的核心不变量补成原生小程序独立测试：首次进入且没有已保存患者时才允许默认目录第一人；
已保存患者不在当前 owner 目录时必须进入 `stale`，不能静默切换到其他患者；仍在目录中的已保存患者必须保持显式选择。
该测试与现有跨页面同步、过期响应和真机验收边界一起纳入 `pnpm test`，用于防止后续页面迁移时把患者上下文错误地降级成“当前用户”。

本轮继续收敛预约历史的展示边界：`appointment-records` 和 `missed-appointments` 不再各自复制状态文案与爽约筛选，
统一使用 `appointment-record-view`。只有服务端已归一化的 `missed` 才能进入爽约列表，`unknown` 不会被页面猜成爽约；
列表索引只用于 WXML diff，不被当作预约详情、取消、支付或其他写入引用。该规则已纳入原生小程序测试，未改变线上 API 或支付/医保 gate。

本轮进一步统一患者依赖页面的选择错误边界：预约记录、爽约、报告和门诊费用不再把“当前账号没有目录患者”与“本地保存的患者已从当前目录失效”折叠成同一个提示。
前者返回 `patient-not-bound`，后者返回 `patient-selection-stale` 并要求用户进入选择页显式重选；首次进入且没有历史选择时仍允许目录第一位默认患者。
这只改变小程序错误语义和测试，不改变 Provider、数据库、API 路由或支付/医保 gate。

本地原生小程序本轮又补齐了进程级患者同步协调器和统一患者选择导航门禁：首页、我的、预约记录、报告、
爽约和门诊费用页面不能在另一页面实例的同步快照尚未收敛时启动第二条幂等同步；选择页直接打开时也会
复用当前在途 Promise。该改动只影响尚未重新构建的本地小程序运行包，不改变当时线上 `daee96d` API、旧 Python
服务或数据库；必须在微信开发者工具重新构建后，用真机观察跨页面点击提示和服务端 trace 对齐。

随后以当前服务启动时间 `2026-08-17 15:39:39 CST` 为边界完成一次低敏服务器复核：观察到 1 次完整微信登录成功、
3 次患者目录同步成功和 6 次患者目录读取；预约历史、门诊费用和报告没有业务事件。另有 7 次受保护请求返回 401，
不能当作 Provider 失败或真实业务查询证据。该观察确认当前 release 的认证/患者基础链路出现过真实事件，但仍未完成
Redis TTL、多患者切换、预约历史和门诊费用的三层验收；详细聚合见 [`当前服务器 P0 只读观察`](../release/current-server-p0-observation-2026-08-17.md)。

后续增量窗口又观察到 1 次患者同步成功链和 2 次患者目录读取，但预约历史、门诊费用和报告仍无业务事件；这只更新
低敏观察数量，不更新 P0 验收状态，也不改变支付、医保和 HIS 写回的关闭边界。

本轮继续复核首页会话恢复的异常分支：如果 Redis、网络或会话校验暂时失败，首页只清理没有当前
principal 证明的患者展示数据，保留用户已明确选择的 opaque `patientId`。这样下一次目录恢复仍会按
owner-scoped 规则解析；若该患者已经失效，会进入 `patient-selection-stale` 并要求显式重选，不能因为
一次暂时性故障就把选择抹掉后静默回退到第一位患者。只有明确退出、没有本地会话的新登录起点或确认
会话失效后的安全收敛路径，才会清理本地选择。该修正只涉及小程序状态机和测试，没有修改 Provider、
数据库、线上端口或支付/医保 gate。

随后于 2026-08-17 11:13 CST 进行的公网只读复核已记录在同一证据文档的 2.5 节：live、ready、system-ping
均成功，`/patients` 未登录返回 `401 unauthorized`，并保留了本次 `x-request-id`；该复核仍不代表本地候选
已部署，也不更新微信、患者、Provider 或真机业务验收状态。

随后于 2026-08-17 12:06 CST 完成了更窄的公网关闭边界复核：live/ready/system-ping 仍通过，未登录的患者
和预约历史请求在业务 query 前返回 `401 unauthorized`，病历、医保授权和预约写入候选路径继续返回
`404 not-found`。本次没有携带会话、患者或 Provider 凭证，也没有执行任何写入；证据见
[`../release/current-public-readonly-smoke-2026-08-17.md`](../release/current-public-readonly-smoke-2026-08-17.md) 的 2.6 节。

随后于 2026-08-17 约 12:25 CST、`6d58c9c` 发布前，恢复了受控 SSH 只读会话，确认当时线上仍为 `131fb5a`，新 Elysia
`10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听，生产日志和三项 readiness 均正常；公网
live/ready/system-ping 也通过。该次观察窗口出现 1 次真实微信登录成功和 4 次患者同步完成事件，但没有
预约历史、门诊费用或资料事件。远端 Redis `PING` 通过，而会话 key 的 `SCAN` 被当前账号拒绝，所以
Redis TTL 仍未验证。完整低敏快照见 [`../release/current-server-readonly-observability-2026-08-17.md`](../release/current-server-readonly-observability-2026-08-17.md)。

随后于 2026-08-17 12:50-12:58 CST 完成候选 `6d58c9c` 的 production 切换：`0016` migration 成功，marker、
索引列顺序和 schema probe 均通过；新 API 仅重启自身并恢复 `18081`，旧 Python `8001` 保持监听。启动日志确认
production、MySQL/Redis/schema `ok`、支付/报告 gate 关闭；公网 runtime smoke 的 ready 连续 6/6、system-ping
和未登录 401 均通过。错误 ZIP/runner 包在切换前被隔离，未改变数据库；当前线上版本和完整证据见
[`../release/6d58c9c-production-acceptance-2026-08-17.md`](../release/6d58c9c-production-acceptance-2026-08-17.md)。

本地小程序运行包的最新构建复核（2026-08-17）已记录在
[`miniprogram-runtime-package-verification-2026-08-17.md`](../release/miniprogram-runtime-package-verification-2026-08-17.md)：
14 个注册页面的 `.js/.json/.wxml/.wxss` 均存在；该证据不代表开发者工具或真机已经加载本次本地产物。

2026-08-17 18:23 CST 的当前 release 只读观察已确认 `5f5915e`、新 API `18081`、旧 Python `8001` 共存，
并观察到 1 次微信登录成功、7 次患者同步成功和 14 次患者目录读取；目录仍为单患者，预约历史、门诊费用和
报告事件在该窗口均为 0。该事实只更新运行观察，不改变 P0 未完成项；详见
[`../release/current-server-p0-observation-2026-08-17.md`](../release/current-server-p0-observation-2026-08-17.md)。

个人中心视觉专项的最新运行包复核已记录在
[`miniprogram-visual-package-verification-2026-08-17.md`](../release/miniprogram-visual-package-verification-2026-08-17.md)：
它以 `f562d61` 为源码基线，额外核对了“我的/我的挂号”页面、旧端背景、固定底部导航和预约状态图标的产物哈希；
2026-08-17 18:39-18:40 CST 又在微信开发者工具重新打开当前项目，取得了三页 `Errors: 0` 的运行证据。
这仍然只是开发者工具模拟器证据，不替代真机、公网 API 或 Provider 业务验收。

本次开发者工具复核先暴露了 `appointment-records` 对 JSON 运行时模块的构建缺口：旧引用会落到
`data/department-location.json.js` 并阻断页面加载。当前已改为 TypeScript 数据模块，构建和运行包核验均
强制检查 `dist/data/department-location.js`，并在重新打开项目后确认错误消失；该边界已写入视觉核验文档。

2026-08-17 14:37 CST 的最新受控服务器只读观察已记录在
[`current-server-p0-observation-2026-08-17.md`](../release/current-server-p0-observation-2026-08-17.md)：当前运行包仍为
`3ab0a6c`，新旧端口同时监听，production、MySQL、Redis 和 schema readiness 均正常；当前进程只观察到患者
目录事件，没有预约历史或门诊费用事件。因此门诊费用仍只能称为“代码已实现、真实业务未验收”，不能因为配置状态为
`configured` 或 API readiness 通过就更新 P0 结论。

## 2. 剩余范围分层

### P0：已有代码，但缺真实业务证据

这些不是继续加页面，而是用当前 `1b94c46` 服务端与配套小程序候选完成真实链路：

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

## 5. 历史执行记录（不可覆盖前述当前事实）

> 本节保留历次候选版本、历史服务窗口和代码提交的追溯记录。每条记录中的“当前 release”、
> schema、端口和业务事件只对它自己的时间窗口成立，不得覆盖第 1 节的当前事实，也不能回填
> `1b94c46` 的真机、Provider 或 Redis TTL 验收。需要当前证据时，优先阅读本节前的当前事实、
> [`1b94c46-production-acceptance-2026-08-18.md`](../release/1b94c46-production-acceptance-2026-08-18.md)
> 和 [`p0-readonly-business-acceptance-runbook-2026-08-17.md`](../release/p0-readonly-business-acceptance-runbook-2026-08-17.md)。

- 本地 `pnpm test`、`pnpm typecheck` 和小程序构建均通过；9 个 workspace 包测试成功，原生小程序
  14 个注册页面的运行时脚本均生成。测试和构建只能证明代码边界与构建产物一致，不能替代真实微信和
  Provider 业务证据。
- `a4033b0` 及后续 `7807aa8` 的运行时修正已由 `6d58c9c` 候选 bundle 部署：门诊费用、预约历史和爽约派生页继续只做本地分批渲染，首页/选择页使用集中生成的安全幂等键，“我的”页资料失败可降级但不清理已确认患者上下文；完整查询结果、金额、状态和支付/医保/预约写入边界均未改变。线上 bundle provenance 和生产日志以 [`../release/6d58c9c-production-acceptance-2026-08-17.md`](../release/6d58c9c-production-acceptance-2026-08-17.md) 为准。
- 此前某次只读连接 `ps@192.168.112.172` 曾返回 `Permission denied (publickey,password)`；该条属于历史阻断，
  不能继续作为当前状态。2026-08-17 约 12:25 CST 已恢复受控 SSH 只读会话，并完成当前 release、
  新旧监听、production mode、readiness、公网基础边界和低敏业务日志复核。此次仍没有执行部署、重启、
  migration 或旧服务操作，也没有因此把 `a4033b0` 宣称为线上版本。
- 线上 Redis 使用远端 DB3，`PING` 成功但当前账号不具备 `SCAN hospital:session:*` 的可用权限；会话数量和
  TTL 不能从空结果推导，必须等待运维提供脱敏聚合或受控权限后再更新 P0 验收结论。
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

## 7. 历史基础设施观测记录（不可覆盖当前 release）

本轮补齐了 MySQL、Redis 和 schema 只读 readiness 探针的安全诊断字段：不可用与恢复事件均可记录
`attempts` 和 `durationMs`，schema 额外记录 `schemaStatus`、缺失 migration 数量和缺失结构数量。
其中 `attempts` 只表示探针自身的有限重试，不能解释为预约、支付或其他业务写入被重放；恢复日志的
字段仍然不包含连接串、SQL、原始异常消息、参数或第三方报文。详细字段约束见 [`日志规范`](../logging.md)。

本轮独立门禁已通过：`architecture:audit`、`provider:audit`、文档断链、格式检查、lint、9 个 workspace
的 typecheck/test 和 build。`migration:audit` 未能整体判绿：它读取的旧仓库 `G:\\fuck\\hospital` 正被其他会话
修改，当前 `module_common` 和挂载总数、旧端 endpoint 台账均发生漂移；本轮没有修改该外部工作树或擅自刷新清单。
这只说明完整 `pnpm check` 仍有外部审计阻塞，不影响本轮代码门禁结果；线上 release、公开网络 readiness 以及真实
微信/Provider 业务证据仍需单独记录，不能由本地门禁替代。

随后新增了 API owner-scope 结构门禁并复核通过，共 62 条架构规则：普通资料、患者目录、挂号历史、报告、
门诊费用和订单入口必须从当前 Bearer principal 进入 service，路由不得接受客户端 `userId` 或微信身份字段。
该门禁只防止迁移时的调用链结构漂移，不替代 owner 条件测试、Provider 映射测试或真机验收；支付订单仍只是
内部事实和 fail-closed 边界，未因此开放现金支付、微信支付、医保或 HIS 写回。

随后又补充了普通资料 API 的跨 owner 集成测试：用户 A 更新资料后，用户 B 只能看到自己的默认资料并独立更新，
用户 A 的资料不会被覆盖。该测试强化了“单账号页面看起来正确”之外的归属证据；真实微信资料读取、更新和过期版本
409 仍需在当前 release 通过真机、HTTP 和 journald 三层验收，不能由本地 fixture 代替。

随后补充了患者范围只读接口的跨 owner 集成测试：用户 B 使用用户 A 的内部 `patientId` 查询预约历史、报告目录
和门诊费用时，三个服务都在 owner + patient 映射边界返回稳定的“患者不可用”错误，Provider gateway 调用次数保持为 0。
这证明了 API 组合层不会把越权标识转换为 Provider 患者号；测试仍是合成 gateway 证据，不替代当前 release 的真实账号、
公网 Provider 和真机验收。

本轮还修正了受保护 API 的认证顺序：Elysia 在 query/body/params schema 校验前验证 Bearer，
未登录或会话失效统一返回 `401 unauthorized`，认证通过后才返回 `400 validation`；微信登录和微信支付
回调仍是明确公开入口。该修正已由 API 集成测试、候选临时端口 smoke 和当前公网无会话回归验证，
当前线上 `0b6f38f` 已具备该行为。业务会话、患者和 Provider 证据仍不能由认证边界 smoke 替代。

本轮先发现旧仓库并行修改造成的迁移台账漂移：旧 `module_common` 实际 38 个挂载路由、旧服务挂载总数
实际 195 个，旧客户端新增 4 条挂号插件支付/退款编排调用，微信支付调起涉及 3 个页面文件。已按旧源码
逐项复核并只更新新仓库的事实台账；`pnpm migration:audit` 现已通过，且这些路径全部登记为“最后处理”，
没有修改旧工作树、没有把它们注册到新 Elysia。支付、医保、退款和 HIS 回写继续保持关闭，等待独立
Provider contract、终态、幂等和补偿证据。

本轮对门诊费用渠道配置做了只读核对：服务器现行环境明确存在
`ZHONGYANG_OUTPATIENT_PAYMENT_READY=true` 和 `OUTPATIENT_PAYMENT_AUTH_SYS_CODE=thirdSelfMachine`；旧小程序源码
仍可见 `internetHospital`。由于两者代表不同 Provider 渠道语义，本轮没有把旧值覆盖新值，也没有把当前值
推广为所有环境的默认值；新代码已改为渠道码缺失即 `incomplete`/服务层 fail-closed，并在 Provider contract
中登记该差异，等待院方/Provider 的正式确认。此次仅读取了非敏感配置名和值，没有读取或修改密钥、服务和数据库。

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
异常记录 `report.directory.failed`；详情依赖未配置、owner/patient/TTL 查询和 Provider 异常记录
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

随后 `7807aa8` 修正“我的”页的普通资料上下文：资料卡读取已冻结的普通资料昵称，资料读取失败只作为
可降级展示错误，不阻断已经成功的 `/me` 和患者目录；资料卡副标题改为与实际跳转一致的“点击编辑个人资料”。
小程序 63 项验收、603 个断言、typecheck、lint、格式和运行包构建均通过；候选尚未部署，真实微信资料读写、
409 冲突和真机返回证据仍待完成。

本轮继续审计普通资料更新边界，发现 Elysia 默认 `normalize` 会把请求体中的未知字段静默删除，导致
旧端提交 `avatar`/`openid` 时仍返回 200。现已在根应用关闭该行为，并用 API 集成测试锁定未知字段必须返回
`400 validation`；该修复已随 `5f5915e` 完成生产切换，但真实资料读写、409 和真机验收仍待后续受控会话完成。

随后完成 `0016_patient_directory_sync_owner_index` 的代码与线上只读审计：线上 `0015` marker 存在，
`0016` marker 和目标复合索引均不存在；本地 0016 只对新端 operation ledger 增加非唯一查询索引，不影响
旧 Python legacy 表和患者数据。由于该 migration 是非事务性 DDL，候选发布与 migration 必须绑定，失败时先
核对 marker/索引元数据，不能自动重复执行或假设事务可回滚。持久化测试 67 项通过；详细执行边界见
[`../release/patient-sync-0016-readiness-audit-2026-08-17.md`](../release/patient-sync-0016-readiness-audit-2026-08-17.md)。

随后继续复核门诊费用的内部 Provider 契约：服务层仍会在访问患者映射和 Provider 前校验已确认的
`OUTPATIENT_PAYMENT_AUTH_SYS_CODE`，但 `authSysCode` 不再出现在 `OutpatientPaymentGateway.listRecords` 的
单次请求输入中，而是只在 adapter 构造时固定。这样可以避免未来调用方把查询动态导向未经确认的业务渠道，
也避免 adapter 因空值而自行猜测默认渠道。domain、API、adapter 类型检查通过，API 96 项和 adapter 63 项测试通过；
全仓 typecheck/test/build、架构/provider/文档/格式/Lint 检查通过，migration audit 仍仅被旧仓库的医保清单漂移阻塞。
本轮未修改服务器、数据库、旧 Python 服务或线上 release，支付、医保、结算与 HIS 继续留到最后处理。

随后候选 `0b6f38f` 完成五个生产 bundle 的本地/服务器 SHA-256 对照、真实生产 env preflight 和
`127.0.0.1:18082` 隔离 smoke；preflight 确认 `0016_patient_directory_sync_owner_index`、MySQL、Redis
和已开放只读 Provider 配置均通过，smoke 的 live、ready 3/3、system ping 和未登录 401 均通过。
候选停止后按同目录 `current.next -> current` 原子切换，只重启新 API；旧 Python `8001` 未停止或重启。
切换后 `0b6f38f` 的内网/公网 readiness 均为 200，公网 runtime smoke ready 连续 6/6，system ping 200、
认证边界 401，`18082` 已释放。切换时该发布仍没有真实微信、患者、预约历史或门诊费用 Provider 业务事件，
所以当时 P0 真实业务验收状态不变；支付、医保、退款和 HIS 回写继续最后处理。完整 bundle 与运行证据见
[`../release/0b6f38f-production-acceptance-2026-08-17.md`](../release/0b6f38f-production-acceptance-2026-08-17.md)。

随后复核患者完整快照在“Provider 患者号不变、候选内部 ID 变化”时的持久化语义：当前 MySQL 实现
已通过 `upsertPatientFromDirectory` 找回并沿用数据库中的稳定 `hp_patients.patient_id`，清理缺失的
临床 `his-patient` 引用时传入的也是该内部 ID，而不是本次 Provider 响应携带的候选 ID；失效/恢复、
owner 隔离和 Provider 映射语义因此保持一致。本轮没有重复修改运行代码，只新增 MySQL 回归测试锁定
该边界；持久化 69 项测试、typecheck 通过，未部署、未重启服务，真实 inactive/recovery 与 Provider
证据仍待 P0 业务验收。支付、医保、退款和 HIS 回写继续最后处理。

随后 16:40 CST 之后的 SSH 只读日志窗口观察到 1 次完整微信登录、3 次患者读模型读取、1 次预约历史同步
和 1 次门诊费用只读加载，并有 3 个可关联的 `providerRequestId`；同时仍有 7 次未登录 401。该证据把
预约历史和门诊费用从“无业务事件”推进到“已进入业务链、待页面/Provider/真机闭环”，但不能把事件计数
当作字段、状态、患者上下文或金额验收。当前 release、新旧服务监听和旧 Python 进程均未改变；详细低敏聚合见
[`../release/current-server-p0-observation-2026-08-17.md`](../release/current-server-p0-observation-2026-08-17.md)。

随后 17:40 CST 通过受控 SSH 对当前 `0b6f38f` 进程启动后的 journald 做低敏聚合：微信登录请求/成功各 1 次，
患者目录同步请求/成功各 5 次、患者读模型请求/成功各 13 次，预约历史请求/同步各 1 次，门诊费用请求/加载
各 1 次，HTTP 200/401 为 37/7，去重 `providerRequestId` 为 8。新 API `18081` 与旧 Python `8001` 仍共存，
没有执行线上修改。该证据只证明预约历史和门诊费用已进入当前 release 的只读业务链，仍不能证明页面字段、
患者上下文、待缴/已缴状态、金额、Redis TTL 或真机视觉结果；下一步按 P0 手册进行有效会话下的逐页核对，
支付、医保、退款和 HIS 回写继续关闭。

随后按旧端 `hospital-app/src/pages/user/user.vue`、`userNavData.json` 和
`pagesB/user/my_registration.vue` 复核并重制原生小程序的“我的”和“我的挂号”页面：
背景、头像占位、家庭成员入口、三组功能分类、旧端图标和固定底部导航均改为本地静态资源，避免
依赖旧 OSS 图片在真机上失效；功能标题和分组顺序以旧端实际数据为准，重复出现的“我的订单”标题
没有擅自改成新的业务含义。我的挂号恢复“在线挂号/全部挂号”双标签、就诊人/院区信息行、预约卡片
字段、预问诊和院内导航按钮；在线标签只在本地排除服务端明确的 `cancelled`，不会把未知状态猜成已取消，
也不会因切换标签再次访问 Provider。

院内导航暂按旧端已审核的 `departmentLocation.json` 做只读本地检索和弹窗展示，匹配不到时明确显示
“暂无位置信息”；预问诊因新端尚未取得独立 Provider contract，继续显示迁移提示，不透传旧端路由。
两页均保留当前 owner-scoped 就诊人选择链路，点击更换就诊人进入独立选择页，不把当前用户资料误当成
临床就诊人。页面首批预约记录只渲染 10 条，后续仅展开本次已取得的结果，不能被描述成 Provider 分页。
本轮已通过原生小程序 75 项验收、全仓 typecheck/test/build、架构审计、文档审计、Biome lint/format；
尚未部署或重启服务，真机视觉验收仍需在开发者工具重新构建后确认。支付、医保、结算、预约写入和 HIS
回写没有因页面补齐而提前开放。

随后于 2026-08-17 17:55 CST 发布 `5f5915e`：五个 bundle checksum 与本地产物一致，真实生产 env
preflight 通过，`127.0.0.1:18082` 隔离 smoke 的 live/ready 3/3、system-ping 和未登录 401 通过；
随后 `current` 从 `0b6f38f` 原子切换到 `5f5915e`，只重启新 API。切换后内网/公网 ready 均为 200，公网
runtime smoke readiness 6/6、system-ping 200、认证边界 401，旧 Python `8001` 仍监听。启动日志确认
production mode、MySQL/Redis/schema `ok` 和支付/报告 gate 关闭；该发布仍没有把普通资料真实读写、409、
患者切换或预约/费用 Provider 事件误记为已验收。完整证据见
[`../release/5f5915e-production-acceptance-2026-08-17.md`](../release/5f5915e-production-acceptance-2026-08-17.md)。

2026-08-17 18:52-18:53 CST 又在当前原生小程序运行包中完成了门诊费用双状态只读复核：从首页进入“门诊缴费”，
默认 `unpaid` 和手动切换 `paid` 均使用当前已确认就诊人的 owner-scoped 映射，服务端分别记录
`outpatient.payment.records.requested → loaded`、HTTP 200 和 `itemCount=0`；页面分别展示待缴/已缴合法空态，
没有调用支付、医保或 HIS 写回。当前线上仍为 `5f5915e`，新 API `18081` 与旧 Python `8001` 共存；该证据只把
门诊费用推进到“空列表三层只读证据”，不代表非空金额、第二位就诊人、Redis TTL、费用详情或任何支付/医保能力完成。
详细记录见 [`门诊缴费只读验收记录`](../release/outpatient-payment-readonly-acceptance-2026-08-17.md)。

2026-08-17 19:00-19:01 CST 又完成了普通个人资料真实会话只读复核：从个人中心进入“编辑个人信息”，
`GET /api/v1/me/profile` 返回 HTTP 200，服务端记录 `user.profile.requested → user.profile.loaded`，并明确
`persisted=false`；页面展示安全默认资料和普通资料边界说明，GET 没有隐式创建资料行。自动化控制开发者工具
期间出现 `clickCheckTask` 和 `undefined is not iterable` 控制/渲染层日志，因此本次不宣称调试器零错误或真机验收。
普通资料已推进到“真实默认值读取证据”，首次 `PUT`、409、真机和敏感身份字段仍未开放。详细记录见
[`普通个人资料只读观察记录`](../release/user-profile-readonly-observation-2026-08-17.md)。

随后完成首页就诊人二维码契约审计：旧端将完整 `medicalCardNo` 拼接到第三方二维码 URL，缺少医院扫码字段、
签名、TTL、撤销、防重放和扫码回执；新端 `onPatientQr` 只保留视觉入口并展示关闭态，不发起外部请求。按业务
正确性要求本轮停止二维码编码，等待医院/HIS 书面协议、脱敏样例和测试设备；详细决策见
[`首页就诊人二维码契约审计`](../release/qr-contract-audit-2026-08-17.md)。

2026-08-17 19:17 CST 继续做 Redis 会话 TTL 只读探测：通过服务 env 确认新 API 实际连接远端 Redis DB3，
服务器侧 Bun/ioredis 连接成功；关闭 `INFO` ready-check 后，`SCAN MATCH hospital:session:*` 被 ACL 明确拒绝。
本机 `127.0.0.1:6379` 的 DB1/DB3 结果不属于新 API 会话证据，因此没有把空扫描写成“没有会话”。实际会话数量、
TTL 范围和过期后 401 仍未验证；本次没有放宽 ACL、输出 key/token 或改动服务。详细记录见
[`Redis 会话 TTL 与 ACL 只读观察`](../release/redis-session-ttl-acl-observation-2026-08-17.md)。

本轮完成会话恢复、患者选择、预约记录和日志链路的只读代码审计；小程序 76 项、API 99 项测试和 107 份文档链接
审计均通过。审计确认 401/503 分流、并发 token 保护、首次默认患者、失效后显式重选、预约状态归一化和日志脱敏
边界没有新的可安全推断缺陷；Redis 实际 TTL、多患者切换、资料 PUT/409、预约/费用页面三层证据仍未完成，详细停止
条件见 [`session-patient-context-readonly-audit-2026-08-17.md`](../release/session-patient-context-readonly-audit-2026-08-17.md)。

2026-08-17 19:48 CST 通过受控 SSH 对 `5f5915e` 当前进程做了新的低敏聚合：服务启动后微信登录 2/2、患者同步
22/22、患者读模型读取 57/57、预约历史请求/同步 3/3、门诊费用请求/加载 2/2、普通资料读取 11/11，
HTTP 200/401 为 137/7，`parseErrors=0`，去重 `providerRequestId` 为 29。新 API `18081` 与旧 Python `8001`
仍共存；该证据只把这些域确认到“当前 release 已进入只读业务链”，不证明页面字段、非空金额、第二位患者、
Redis TTL、PUT/409、公网/真机三层结果。当前窗口没有 503、支付、医保、退款或 HIS 回写事件，不能据此开放任何
高风险能力；详细观察见 [`当前服务器 P0 只读观察`](../release/current-server-p0-observation-2026-08-17.md)。

2026-08-17 20:04 CST：针对“我的/我的挂号”页面继续核对患者上下文边界。旧端视觉复刻继续保持：
背景、头像占位、功能分类、本地图标、固定底部导航、挂号双标签、患者/院区信息行和院内导航静态弹窗
不回退；新增代码只把患者目录的 `clinicalAccess` 明确分为 `ready/unavailable`。迁移遗留或缺少
`his-patient` 映射的记录仍可展示脱敏信息，但不能默认选中、不能显式选中，也不能静默切换到其他患者；
预约历史、报告和门诊费用在服务端临床映射缺失时继续 fail-closed。已补齐 API、选择页、内存/MySQL
仓储、中文业务文档和回归测试；本轮只完成代码与静态验证，尚未部署或取得新的真机/Provider 证据，支付、
医保、预约写入和 HIS 仍关闭。

2026-08-17 20:12 CST：补齐“我的”页对患者临床映射失效的展示边界。此前“我的”页已经能够清除不可用患者的
当前卡片，但 `unavailable` 状态没有覆盖页面错误提示，用户只能看到家庭成员数量而不知道当前就诊人为什么
不能进入挂号、报告或费用查询。现在患者上下文错误优先于普通资料增强错误，明确提示进入选择页处理；没有
改变旧端背景、头像、功能分类、图标或固定底部导航，也没有打开任何未冻结的临床能力。本轮补充小程序验收断言，
尚未部署或取得新的真机/Provider 证据。

2026-08-17 20:18 CST：对当前服务器做只读复核。新 API 当前仍为 `5f5915e518e3d2de5647f7ddd90f91cd7f1e3d0c`，
本地 `main` 已到 `efb3d59`；新 Bun `18081` 与旧 Python `8001` 同时监听，内网 ready 的 database/Redis/schema
均为 `ok`，公网 live/ready/system-ping 均为 200，live/ready 带 `Cache-Control: no-store`。最近 400 条 journald
中出现微信登录、患者目录、预约记录、门诊费用和普通资料关键词，且没有 `persistence.probe.unavailable` 或
`recovered` 命中；关键词次数不是去重请求数或成功数，不能替代真机会话、字段、Provider 和多患者证据。完整记录见
[`release/current-live-readonly-audit-2026-08-17.md`](../release/current-live-readonly-audit-2026-08-17.md)。
本轮没有部署、重启、读取业务数据或打开支付、医保、预约写入和 HIS。

2026-08-17 20:24 CST：修复生产日志维护 artifact 缺失问题。此前服务器 release 只包含 API/worker 运行 bundle，
没有 `tools/p0-log-aggregate.mjs`，导致 P0 手册规定的 JSONL 脱敏聚合在服务器上不可执行；本轮将它纳入 worker
构建，显式生成 `apps/worker/dist/p0-log-aggregate.js`，并在发布切换手册、日志文档和 P0 验收手册中加入存在性与
SHA-256 门禁。已通过 worker 构建、聚合工具单测和 bundle stdin smoke；当前线上仍为旧 release，未部署、未重启，
不改变任何业务能力或支付/医保/HIS gate。

2026-08-17 20:32 CST：`bf67b96` 已按无损发布手册完成候选上传、六个 artifact checksum、真实生产 preflight、
`18082` 隔离 smoke、原子 `current` 切换和新 API 单独重启。新 `18081` ready、公网 live/ready/system-ping 与认证边界
均通过，旧 Python `8001` 保持监听，Worker inactive；当前 release 内日志聚合 bundle 对切换后 journald 窗口得到
`parseErrors=0`。这只完成运行时和日志维护 artifact 验收，不能回填真实微信、多患者、资料 PUT/409、预约/费用 Provider、
Redis TTL 或真机证据；支付、医保、预约写入、报告详情和 HIS 继续关闭，完整记录见
[`release/bf67b96-production-acceptance-2026-08-17.md`](../release/bf67b96-production-acceptance-2026-08-17.md)。
