# 下一阶段实施路线图

本文档是新会话继续工作的入口，描述当前真实边界、业务优先级、工程治理和上线验收顺序。
其中“已完成”只表示代码、测试或部署证据，不代表微信、众阳、医保、HIS、支付或真机已经完成真实验收。

## 当前基线

### 线上实时状态（2026-08-17 15:05 CST）

- 新 API 已从 `3ab0a6c` 原子切换到 `9833a01`，systemd active，内网原始路径和公网 `/api/v2` 的 live、ready、system-ping、未登录认证边界通过；公网 ready 连续 6/6 通过且保留 `Cache-Control: no-store`。旧 Python `8001` 监听保持不变，完整切换证据见 [`release/9833a01-production-acceptance-2026-08-17.md`](release/9833a01-production-acceptance-2026-08-17.md)。
- `0016_patient_directory_sync_owner_index` 已由候选 bundle 执行成功，marker、`owner_user_id,provider_name,status,lease_until` 索引列顺序和 schema probe 均通过；错误的跨平台打包在切换前被拦截，未产生 schema 半成品。支付、医保、HIS、报告和 Worker 仍关闭。
- 候选 runtime smoke 完成 readiness 连续 6/6、system ping 200、未登录受保护路由 401；这只是运行边界证据，真实微信会话、Redis TTL、多患者切换、普通资料读写/409、预约历史和门诊费用仍待真机三层验收。

### 线上实时状态（历史快照：2026-08-17 02:56 CST）

- 新 API `current=131fb5a`，systemd unit active，公网入口为 `https://test-hp.meiyi.pro/api/v2`；内外网 live/ready、no-store、system-ping 已通过，启动日志确认 `runtimeMode=production` 且 MySQL/Redis/schema 为 `ok`。本次只标准化持久化瞬态错误码日志，不改变业务 response 或写入重试边界；这是 `6d58c9c` 发布前的历史快照，证据见 [`release/131fb5a-production-acceptance-2026-08-17.md`](release/131fb5a-production-acceptance-2026-08-17.md)。
- 旧 Python API 仍监听 `0.0.0.0:8001`，未停止；Worker 仍 inactive。支付、医保、HIS、报告 gate 仍关闭。
- 02:18:26 CST 的一次真实微信登录因 `PersistenceUnavailableError` 返回 503；约 3 秒后下一次登录成功，随后 `/patients` 和完整患者同步均返回 200，记录 1 条 active 患者和 1 条 `his-patient` 映射，并读取到预约科室 62 条、排班 1 条。该组真实微信登录与单患者目录同步事件发生在 `527d163` 切换前，只能作为 `ca5a372` 的部分验收证据；当时没有安全底层错误码，不能断言具体网络/数据库根因。
- 23:50:17-23:50:18 的预约科室/排班只读证据来自前一 release `41c9c18`；02:18 CST 的科室/排班读取来自 `ca5a372`，科室 62 条、排班 1 条均返回 200，且 `snapshotPersistenceStatus=persisted`；Redis 实际 TTL、多就诊人切换/失效恢复、预约历史/报告/门诊费用 Provider 读操作、真机页面网络对齐和普通资料真实读写仍未完成。这些是历史业务证据，当前 release 的运行证据见 [`release/5c4e7cf-production-acceptance-2026-08-17.md`](release/5c4e7cf-production-acceptance-2026-08-17.md)。

### 2026-08-17 迁移差距审计

- 当前下一块不是继续增加静态页面，而是完成已有只读纵向切片的真实证据：患者 TTL/多患者、预约历史、门诊费用列表和普通资料；报告详情、病历、绑定、动态医院和外部入口仍等待新的 Provider 文档及脱敏样例。
- `7807aa8` 修正“我的”页的资料上下文：资料卡现在读取已冻结的普通资料昵称；普通资料读取失败只降级为安全兜底并提示重试，不会清理已经确认的患者上下文；资料卡提示也与实际跳转的个人资料页一致。该修正已通过 63 项小程序验收、typecheck、lint、格式和运行包构建，真实微信资料读写/409 与真机证据仍待完成。
- 2026-08-17 线上只读复核确认新旧服务共存、production mode、MySQL/Redis/schema readiness 和公网基础边界均正常；远端 Redis `PING` 通过但当前 SSH 账号不具备会话 key `SCAN` 权限，TTL 仍未验证。不得把本机 Redis 空库或 ACL 拒绝解释成“没有会话”，证据见 [`release/current-server-readonly-observability-2026-08-17.md`](release/current-server-readonly-observability-2026-08-17.md)。
- 本轮修复门诊费用 adapter 的金额边界：缺失金额不再降级为 `0` 分，显式零元仍可通过；这条规则已加入 adapter 测试和迁移差距审计。完整分层、证据等级和新文档接收门禁见 [`migration/migration-gap-audit-2026-08-17.md`](migration/migration-gap-audit-2026-08-17.md)。
- `d71ecd4`、`3609944` 和 `7a03df7` 继续收紧只读 adapter：门诊费用展示字段按公开 contract 限长，LIS 单位限制为 64 字符；2.6.33 未确认的 `waitPayAmount`、`registerDept`、`registerDoctor` 不再覆盖已确认字段，只有 `amount` 缺失时保持 fail-closed。该修正不改变支付/医保 gate，也未部署线上。
- 本轮预约排班审计进一步移除 `usableNum`/`remainingNumber` 号源 fallback；当前只接受已确认的 `usableSourceNum`，缺失时 fail-closed，避免旧端不同接口字段被错误合并。该修正仅影响只读 adapter 边界，未打开预约写入或锁号。
- 本轮为 runtime/provider smoke 增加有界 readiness 连续采样：库调用默认保持单次兼容语义，命令行默认 3 次，正式生产验收建议显式使用 6 次、间隔 2000 毫秒；任意中间 `not_ready` 都不能被最后一次恢复掩盖。该门禁只证明运行前置稳定，仍不替代真实微信、患者、Provider、真机或支付验收，规则见 [`release/readiness-stability-gate.md`](release/readiness-stability-gate.md)。
- `ed250ec` 的本地 runtime smoke 已对公网 `/api/v2` 完成 6/6 readiness、no-store、system-ping 和未登录 401 连续复核；该证据仍不代表 `ed250ec` 已部署，也不替代服务器 bundle provenance、journald、微信会话或真机业务验收。详见 [`release/current-public-readiness-stability-2026-08-17.md`](release/current-public-readiness-stability-2026-08-17.md)。
- `9833a01` 已完成真实生产 env preflight、`127.0.0.1:18082` 隔离 runtime smoke、原子切换和切换后公网 6/6 runtime smoke；本次只包含报告详情引用故障隔离和文档修正，不打开支付、医保、报告、预约写入或 HIS 写入。真实微信登录、多患者和 Provider 业务仍待在当前版本重新验收，证据见 [`release/9833a01-production-acceptance-2026-08-17.md`](release/9833a01-production-acceptance-2026-08-17.md)。
- 原生小程序补齐患者同步期间的进程级协调和统一路由门禁：任意页面在同步快照时，新增或更换就诊人不会再进入选择页并发发起第二条幂等同步；新增跨页面源码验收和协调器测试通过，待下一次真机更新运行包后观察真实提示。

### 已经具备

- 新旧服务共存：旧 Python 服务继续使用 `8001`，新 Elysia 服务使用 `18081`，公网通过 `/api/v2` 隔离。
- 新旧服务已通过当前服务器配置的脱敏比对确认共用远端 MySQL `8.130.127.184:3306/hospital-dev`，新服务
  只使用 `hp_*` 表，旧服务继续使用 legacy 表；旧 Redis 使用 DB1、新 API 使用 DB3，Redis 会话空间隔离。
  MongoDB、旧 Redis namespace、旧任务和其他旧基础设施仍不属于已迁移能力。
- 新服务已具备生产模式启动日志、MySQL/Redis/schema 探针、Pino 结构化日志和 fail-closed 依赖注入。
- 微信登录、平台会话、就诊人列表、就诊人独立选择页面已经形成患者端纵向切片；服务端真实登录和单患者同步已有生产日志证据，患者切换与真机完整验收仍未完成。
- 普通个人资料已形成独立纵向切片：`GET/PUT /api/v2/me/profile` 只处理昵称、性别、年龄、邮箱，使用 `version` 乐观锁；0014、生产 schema、API 重启、ready 和未登录公网 401 已验收，真实微信读写/409 与真机证据仍待完成；头像、实名、手机号和微信身份继续关闭。证据见 [`release/user-profile-production-acceptance-2026-08-16.md`](release/user-profile-production-acceptance-2026-08-16.md)。
- 预约科室、排班、预约历史的只读 contract、adapter、服务端脱敏和排班短期快照已经实现；前一 release `41c9c18` 已取得科室/排班真实 Provider 结果且快照持久化成功，但不能把目录 200 或快照 `persisted` 当成锁号/预约写入授权。
- 爽约记录已实现为预约历史 `status=missed` 的安全派生子视图，固定查询过去 90 天并支持切换就诊人；未知状态不推断为爽约，真实 provider、公网和真机证据仍待完成。
- 预约挂号页面已恢复旧版“两列级联”交互：左侧科室独立滚动，右侧按日期和 12 条分批展示号源，避免一次性渲染全部 provider 排班。
- 门诊缴费只读目录、原生页面和“我的”页面基础入口已经接入；支付调起、医保授权、结算回写仍保持明确未开放。
- 门诊费用查询窗口已固定为 `Asia/Shanghai` 的最近 30 个中国标准时间日；不会因服务器运行时区是 UTC 或其他时区而改变 provider 查询语义。
- 预约排班、预约历史和报告目录已冻结当前“起止日期差值”校验边界（31/366/366 天），并补齐等于上限、超过上限和 provider 不调用的测试；provider `endDate` 包含规则仍待新文档确认，边界审计见 [`migration/date-window-boundary-audit.md`](migration/date-window-boundary-audit.md)。
- 小程序预约历史、报告和门诊费用窗口已同步采用中国标准时间日历算法；跨中国标准时间零点时不会继续使用设备本地自然日。
- 首页就诊人卡片已改为展示服务端脱敏卡号，绑定入口进入独立选择页；报告查询已从首页后台状态改为独立报告目录页，并按 10 条分批展示。
- 首页和“我的”页的患者目录读取已补齐最后一次请求获胜守卫，避免会话恢复、同步、下拉刷新或返回选择页时旧响应覆盖当前就诊人；真机并发操作证据仍待补齐。
- 首页返回生命周期已补齐失效目录保护：从患者选择页返回时不再只比较本地 `patientId`，而是重新读取 owner-scoped 目录；旧患者被标记 inactive 或目录为空时，首页会清除展示上下文并要求重新选择。空目录不会删除本地选择，避免目录恢复后静默默认第一位；该逻辑已有原生 acceptance 断言，真机返回/同步竞态仍待验收。
- 医院列表的旧端静态单院区卡片已按原始图片、提示栏、卡片布局和预约前置语义迁移；公众号静态通知说明页、意见反馈帮助页已按旧端文案和静态交互迁移；院内导航的旧端静态地图页也已按原始图片、背景色、`aspectFit` 和点击预览行为迁移；动态医院/院区、楼层定位和实时路线仍未开放。
- 微信支付订单、预支付尝试、回调去重、查单补偿的领域和持久化基础已经实现，但支付 gate 仍关闭。
- 健康知识已完成旧端接口/表结构到新版本化 schema 的静态映射和导入时间边界；真实内容与临床审核未到位前，患者 GET 路由继续不挂载。
- 门诊就诊记录目录已完成旧端字段差异和候选 contract 草案；provider 文档确认前不注册 `medical-records` 路由，不开放病历正文或诊断字段。
- 便民服务已完成旧 13 个路由、旧表覆盖逻辑和患者/医生字段风险审计；新端仍未注册，边界已拆为反馈、临床问卷、医生关系和预约后预问诊四个领域。
- 个人中心扩展、患者新增/绑卡、法律协议、签名、订阅、外部 WebView、互联网医院和采血预约已完成旧页面副作用审计；旧首页顶部实际跳转的静态医院列表入口已恢复，但旧顶层互联网医院 web-view、真实反馈写入、动态机构/院区、路线、关注状态和票据仍必须按独立 contract 重做。
- 患者新增/绑卡已进一步形成独立契约草案：明确旧端“查询异常即继续建档”的禁止迁移行为、服务端状态机、owner/协议/幂等/超时恢复不变量和 PB-01 至 PB-16 provider 问题；在新 provider 文档冻结前，写入路由继续关闭。
- 旧端非页面逻辑（直连 provider、WebSocket、身份/患者持久化、临床问卷组件和静态入口配置）已完成单独审计；新端不得把这些旧 helper 当作可兼容迁移，边界见 [`migration/legacy-client-infrastructure-boundaries.md`](migration/legacy-client-infrastructure-boundaries.md)。
- 静态页面与关闭能力已完成真值审计：意见反馈旧端没有真实提交接口，公众号二维码是注释代码，订阅开关只是内存假保存；静态医院卡片、公众号说明、反馈帮助和院内地图按旧端真实行为迁移，未来工单/二维码/订阅授权继续作为独立 contract，不复制假成功。详见 [`migration/static-and-closed-feature-parity.md`](migration/static-and-closed-feature-parity.md)。
- 旧服务基础设施与运维边界已完成单独审计：旧 Redis 多 namespace、Mongo 连接、APScheduler/任务管理、本地文件资源、AI/WebSocket 和 Admin/RBAC 均未被新患者 API 全量替代；共存门禁见 [`migration/infrastructure-and-operations-boundaries.md`](migration/infrastructure-and-operations-boundaries.md)。
- 2026-08-16 生产 Redis 会话隔离已完成：新 API 使用独立 DB3/`hospital_v2` ACL，旧 Python 仍使用 DB1/旧全权限账号；新 API 已由 systemd 运行且公网 v2 健康检查可达，但新 Worker 未启动、报告 gate 关闭、旧 Python 仍由手工进程运行；证据见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- `f2c6d99` 和 `cb11bc8` 已通过本地完整门禁，并在生产 env 隔离的临时端口 `18082` 完成候选 release smoke：中文稳定错误契约、认证失败边界和 persistence 探针状态日志均已验证；当前生产 `current` 仍为 `55fce6c`，候选版本尚未切换公网。证据见 [`release/observability-error-contract-smoke-2026-08-16.md`](release/observability-error-contract-smoke-2026-08-16.md)。
- `3a37e7e` 已通过本地完整门禁，并在生产 env 隔离的临时端口 `18082` 完成最新候选 smoke：预约排班、预约记录和报告查询错误契约统一为稳定中文文案；当前生产 `current` 仍为 `55fce6c`，公网、provider 和真机验收仍未完成。证据见 [`release/query-error-contract-smoke-2026-08-16.md`](release/query-error-contract-smoke-2026-08-16.md)。
- 当前架构边界审计已从单一 API 客户端检查扩展为扫描原生小程序全部生产源码的 26 条规则；新增未验证外部入口和旧端假患者标记的回流保护。它只证明旧 provider/敏感标识边界没有回流，不替代 provider、公网和真机业务验收。
- 原生小程序构建已增加动态页面一致性门禁：从 `app.json` 读取全部页面，逐项检查 `.json/.wxml/.wxss/.ts` 源文件和 `dist/*.js` 运行文件，并校验 WXML 事件方法、页面跳转目标、本地资源和 WXSS 图片边界，避免新增页面再次出现真机找不到 `.js`、跳转 404 或 WXSS 本地资源错误。
- 当前公共 API 文档已增加列表语义门禁：明确 `total = items.length`、空列表与依赖失败的区别、各只读接口的排序/日期窗口，以及预约排班和报告页的本地渲染分批不等于服务端分页；后续取得 provider 分页文档后必须先更新 contract 再改代码。
- 候选代码已为健康探针响应明确设置 `Cache-Control: no-store`；公网切换到 `d177991` 后 live/ready 已确认保留该指令。后续发布判断仍必须以未缓存的 `/api/v2/health/ready` 和服务端日志为准，不能用单次 200 推导业务验收完成。
- 2026-08-16 17:02 CST 只读复核修正了 16:57 的临时判断：唯一公网 `X-Request-Id` 已在 SSH 主机 PID `2935571`（`current=55fce6c`）的 journald 中关联到同一个 `/health/ready` 请求，随后内网探针也恢复 `database/redis/schema=ok`；此前差异属于瞬时 readiness 恢复，不是另一 upstream。当前 `55fce6c` 内外层响应仍缺少候选代码要求的 `Cache-Control: no-store`，且尚未部署仓库 `main` 的待发布最新提交；发布前必须以 `git rev-parse HEAD` 固定候选版本。详见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 17:59-18:00 CST 复核确认服务器 `current=55fce6c`、API active、旧 Python `8001` 仍在、Worker inactive；仓库 `main=3c8c01b` 尚未部署。公网系统探针和患者端未登录路由的 200/401 边界正常，但 health/live、health/ready 仍缺 `Cache-Control: no-store`；下一步先完成候选 release 固定、临时端口验证和原子切换，再进行 P0 真实业务验收，详见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 18:06-18:07 CST 使用修正后的 Smoke 显式验收公网 `/api/v2`：system-ping 通过，live/ready 均因公网响应缺少 `Cache-Control: no-store` 被门禁拒绝；同时确认 Nginx 透传 `x-request-id`。这证明公网 Smoke 已不再错误地把 `/api/v1` 当作公网路径，但 no-store 仍是线上发布阻断项，证据见 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 已为 `ps` 安装新 API 的窄权限 systemd NOPASSWD 规则，并验证 API `is-active` 可无密码执行、worker 不在授权范围；随后候选 `d177991` 已完成固定、临时 smoke、原子切换和公网 no-store 验收，旧 Python `8001` 保持运行。权限证据见 [`release/systemd-narrow-permission-acceptance-2026-08-16.md`](release/systemd-narrow-permission-acceptance-2026-08-16.md)，切换证据见 [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md)。
- 2026-08-16 收到 2.6.7 挂号登记、2.10.4.2 支付挂号和 2.6.65.7 外部退款 Provider 文档，已完成脱敏元数据、字段、状态和依赖标准化，记录见 [`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md)。由于执行预约、排班/号源、患者档案、支付登记和退款查单文档缺失，当前状态保持 `normalized`，没有把预约写入、支付挂号或退款误标为已迁移。
- 候选 `d8f14f1` 已完成患者归属门禁的代码测试、真实生产 env preflight 和临时 production runtime smoke，但没有切换公网 `current`；真实 session、Provider 只读业务和真机证据仍待完成。证据见 [`release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md`](release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md)。
- 2026-08-16 21:00-22:06 CST 复核 `d177991` 切换窗口的真实日志：没有出现该 release 的微信、患者、预约、报告或门诊费用业务事件；MySQL 与 Schema 探针发生四次同步瞬态不可用后恢复，Redis 始终正常。该历史证据不能替代当前 release 的真实业务验收，详见 [`release/current-d177991-observability-acceptance-2026-08-16.md`](release/current-d177991-observability-acceptance-2026-08-16.md)。
- 候选 `a11f117` 已完成 MySQL/Schema 只读探针一次有界重试的本地完整门禁、真实生产 env preflight、`127.0.0.1:18088` 隔离 smoke，并于 22:24 CST 原子切换为当前 `current`；该修复降低坏连接造成的瞬态 readiness 误报，但不替代数据库稳定性观察或真实业务验收，证据见 [`release/a11f117-production-acceptance-2026-08-16.md`](release/a11f117-production-acceptance-2026-08-16.md)。
- 2026-08-16 22:24-22:25 CST：`a11f117` 在依赖探针恢复后原子切换到生产 `current`，只重启新 API；内网 `10.0.0.3:18081`、公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 全部通过，旧 Python `8001` PID/监听保持不变，Worker 仍 inactive。启动日志确认 production mode、MySQL/Redis/schema `ok`；本次没有业务 Provider 请求或业务写入，真实微信/患者/预约/费用/真机仍待分层验收。证据见 [`release/a11f117-production-acceptance-2026-08-16.md`](release/a11f117-production-acceptance-2026-08-16.md)。
- 2026-08-16 23:37-23:50 CST：`a11f117` 首次观察到预约目录的快照持久化暂时不可用；切换 `41c9c18` 后再次打开页面，科室 Provider 返回 62 条、排班 Provider 返回 1 条，快照持久化成功并记录 `snapshotPersistenceStatus=persisted`。该策略已在服务代码、测试和日志字段中明确，只有 `persisted` 才能作为未来写入前置观察事实；证据见 [`release/41c9c18-production-acceptance-2026-08-16.md`](release/41c9c18-production-acceptance-2026-08-16.md)。
- 2026-08-16 22:37 CST：`a11f117` 切换后连续 10 次、约 21 秒 readiness 均为 `ready`，切换后日志没有新的 persistence 探针抖动或业务事件；运行时前置已稳定，可以进入真实微信会话验收，但不能把这段观察当作患者、Provider 或真机业务成功。
- 2026-08-16：公网冻结检查确认带完整查询参数的报告、预约排班和门诊费用入口在未登录时均返回 401；病历、医保授权、预约写入等未注册入口返回 404。完全缺少报告参数时仅返回通用 400 `validation`，不包含 schema 细节、患者数据或 Provider 错误；该行为作为当前 Elysia 协议校验顺序记录，不改变业务 route 的 fail-closed 边界。

### 当前已验证的问题

- 线上预约 gate 曾经出现过未配置依赖；目前 gate 已经配置，科室/排班目录的 provider 只读请求已恢复。
- 从同一服务器直接请求众阳科室和排班地址可得到 HTTP 200，说明不能继续把问题归因于“上游不可达”。
- 新 API 旧日志只记录 `ProviderRequestError/UNKNOWN`，缺少上游状态码和操作名，已经补充低敏 provider 诊断字段。
- 认证、依赖未配置、provider 拒绝/暂时不可用和持久化暂时不可用已经统一为稳定错误码与中文安全文案；小程序按错误码兜底，服务端只在探针状态发生变化时记录 persistence unavailable/recovered，避免重复刷屏。`d177991` 的真实进程和公网基础运行时证据已完成，但不能用它替代真实 provider/真机业务证据。
- 2026-08-16 已定位并修复预约科室/排班目录错误：科室接口需要日期窗口，排班响应中的 `remainingNumber` 可能为 `null`，服务端只使用已确认的 `usableSourceNum` 映射可用号源；线上新版本已直接回归科室和排班 provider。
- 预约历史的标识根因已经确认：患者目录的 `thirdPatientId` 不能直接当作预约历史接口的患者标识；新代码已增加 `patInfosFind` 档案查询和 `his-patient` 独立映射，release `b1b84d7` 与 `ca3a877` 已上线，`0012_patient_provider_references`、`0013_patient_directory_snapshot` 均通过生产 schema probe，仍需重新同步真实账号并完成公网业务 smoke/真机验收。
- 预约写号、锁号、取消、实际挂号费、医保和微信支付不能仅凭旧页面字段直接开放；仍需 provider 合同和脱敏 fixture。
- 当前优先级上调为“持久化稳定性观察 → 当前 release 真实只读业务验收”：readiness 只能在 `database/redis/schema` 连续稳定后作为验收前置，且排班快照必须出现 `snapshotPersistenceStatus=persisted`；不能把历史 release 的业务日志或一次 preflight 通过当成当前版本成功。

## 业务实施顺序

### 阶段 A：患者基础闭环

1. 微信登录：`wx.login`、服务端 code2session、平台会话和 Redis TTL。
2. 就诊人：服务端同步、当前就诊人、独立选择页、owner 隔离和脱敏展示。
3. 患者端公共状态：登录失效、网络异常、服务不可用、空数据和重试文案统一。

验收标准：真机登录成功；就诊人切换后预约、挂号记录、报告都使用新的内部 `patientId`；小程序网络请求不出现 provider 域名。

### 阶段 B：预约只读业务

1. 修复众阳请求差异：对比 URL、请求头、超时、TLS、代理出口和响应状态。
2. 科室和排班：只展示平台白名单字段，失败时显示可重试的服务状态。
3. 预约记录：服务端根据 owner 解析 `his-patient` 临床映射，返回脱敏摘要；禁止回退到目录 `thirdPatientId`。
4. 排班快照：只作为服务端观察事实，带 TTL；不把客户端 `scheduleId` 当成锁号授权。

验收标准：真实 provider 只读请求在服务器、公网 API 和真机三层均有证据；日志能按 `traceId` 找到 provider 操作、请求号、HTTP 状态和重试判断；排班快照的 `snapshotPersistenceStatus` 必须明确，只有 `persisted` 才能进入后续写入前置评估。

### 阶段 C：预约写入

只有取得以下证据后才开始：

- 锁号接口、锁号 TTL、释放/过期语义和并发冲突样例；
- 实际挂号费单位、费用查询时序和金额边界；
- 执行预约幂等键、超时后的最终状态查询和业务失败语义；
- 取消窗口、退款/撤销、HIS 回写和补偿矩阵。

目标状态机：

```text
available -> hold_pending -> held -> booking_pending -> booked
                                      |                  |
                                      v                  v
                              awaiting_confirmation  cancellation_pending
                                                         |
                                                         v
                                                     cancelled
```

任何超时、重复请求或无法确认的 provider 结果都进入 `awaiting_confirmation`，不能从 HTTP 200 或小程序支付回调推导成功。

### 阶段 D：支付与医保

1. 先完成门诊费用读模型的 provider、公网 API 和真机只读验收，确认状态、金额和就诊人切换均正确。
2. 再完成现金支付订单和微信支付真机链路；门诊费用查询结果不能直接当作支付订单。
3. 再完成医保授权、6201/6202、6301 查单、6203 退款和 6401 结果边界。
4. 最后接入 HIS 写回和对账 worker。

金额统一使用整数分；6202 的预结算状态不能直接当最终成功，最终状态必须由权威查单/回调事实决定。

### 阶段 E：报告与健康内容

- 报告目录先做真实 provider 只读验收，再开放带 owner/TTL 的 LIS 详情引用；首页入口必须进入独立目录页，不能在首页后台加载后丢失结果。
- 报告详情、云影像、下载和分享需要独立的资源授权；没有安全文件 URL 和审计契约时只展示摘要或迁移提示。
- 健康百科先按 [`health-knowledge-content-mapping.md`](migration/health-knowledge-content-mapping.md) 完成脱敏导出、审核和版本化导入，再注册患者端路由。
- AI 导诊和报告解读必须独立于医疗事实库，保留免责声明、内容版本和审计日志。

### 阶段 F：便民服务、管理端和运维

- 便民服务按 [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md) 的顺序逐项迁移：先医生关系只读，再患者反馈，再临床问卷，最后预约后预问诊/出院随访；不能把旧管理端接口整体透传。
- 管理端使用独立权限模型和独立路由，不能复用患者端 token 语义。
- 个人中心和外部入口按 [`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md) 拆分；患者新增/绑定先遵循 [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md) 冻结查档、建档、绑卡和协议事实，再做普通资料，最后跨小程序、WebView、订阅和外部服务。
- 增加指标、告警、备份恢复演练、发布回滚和旧服务下线检查。
- 基础设施迁移按独立边界推进：新 API Redis DB/ACL 隔离已完成，但旧 DB1 namespace、Mongo/本地文件资产仍需确认，随后分别设计通用任务、文件资源、AI/WebSocket 和 Admin/RBAC；不能用新 worker 或连接探针代替这些能力。

## 工程与运行治理

### 每个业务域必须同步交付

1. `contracts`：请求、响应、错误码和敏感字段边界；
2. `domain`：状态机、金额/时间/owner 规则；
3. `adapters`：外部协议、签名、超时、重试和字段白名单；
4. `persistence`：migration、索引、幂等键、版本条件更新和恢复策略；
5. `api`：鉴权、输入校验、错误映射和 OpenAPI；
6. `miniprogram`：加载、空态、错误、重试、就诊人上下文和页面验收；
7. `worker`：回调、查单、outbox、lease 和补偿；
8. `docs`：contract、日志事件、配置、验收和回滚手册。

### 日志最小字段

- HTTP：`requestId`、`traceId`、方法、路径、状态码、耗时；
- provider：provider 名、操作名、provider 请求号、状态码、是否可重试；
- 业务：内部资源 id、owner 维度、状态迁移和幂等冲突；
- 禁止：Authorization、openid、unionid、session_key、患者身份证/手机号、provider 原始报文、支付签名和密钥。

### 发布门禁

```text
代码门禁 -> 本地真实 MySQL/Redis -> staging provider -> 线上只读 smoke
         -> 公网 HTTPS -> 微信开发者工具 -> 真机 -> 支付/医保/HIS 专项验收
```

静态检查、单元测试和本地集成测试不能替代真实 provider、生产代理或真机证据。旧服务在新业务逐项通过验收前保持运行。

## 本次立即执行项

1. 在真机重新验收首页患者卡片、切换就诊人和报告目录，确认页面只显示脱敏卡号与平台摘要；
2. 在真机验收预约科室和排班，保存公网请求的 `requestId` 与页面证据；
3. 使用当前已上线的 `5c4e7cf` 重新同步真实账号的患者目录，先运行显式 `patient-sync` smoke，再补做 `his-patient` owner-scoped 记录查询验收；
4. 验收门诊缴费只读页面：切换就诊人、待缴/已缴状态、空列表、异常重试和大数据滚动；
5. 取得二维码医院扫码协议，完成短期 token 设计前保持入口未开放；
6. 先取得患者绑定 PB-01 至 PB-16 的 provider 文档、脱敏样例和超时/重复请求证据；在此之前只维护患者目录读取和迁移提示，不开发建档/绑卡兼容代理；
7. 再处理报告真实 provider 只读验收、医院列表动态能力/病历和便民服务逐域迁移；静态医院卡片与静态院内地图只作为已完成子集，不能代替机构或路线 contract；个人中心扩展和外部入口先完成 contract/allowlist/旧数据隔离，非页面逻辑按新审计文档逐项清除直连和敏感缓存，院内导航动态能力必须先取得地图数据与路线 contract；
8. provider 只读稳定后，才进入预约写入合同和锁号设计；
9. 最后按现金支付 → 医保结算 → HIS 回写顺序做专项验收。
10. 旧生产 env 文件权限已收紧到 `0700/0600` 且旧进程存活；新 API Redis 会话已切换至 DB3/`hospital_v2` 最小 ACL 并完成公网 readiness 验收；0014 普通资料已完成生产 schema/API 运行验收，但真实微信资料读写和真机证据仍待完成。下一步完成历史读取风险/秘密轮换判断，再继续报告、病历和文件资源 contract；旧 DB1 全权限账号、旧任务和其他基础设施仍不得视为已迁移。
11. 收到新的 provider 文档后，先按 [`provider-document-intake.md`](provider-document-intake.md) 登记来源、版本、环境、脱敏样例和错误样例，再补齐 [`provider-contract-template.md`](provider-contract-template.md)；没有文档和样例的字段不得进入业务 schema、数据库或小程序页面。
12. 首个文档驱动的业务优先处理门诊就诊记录目录：先确认病历查询使用的 `his-patient` 映射、日期窗口、空结果、超时、资源授权和诊断字段白名单，再决定是否从草案注册 API；当前 [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md) 仍是 draft，不开放正文、诊断和文件下载。
13. 候选 `d177991` 已按 [`infra/systemd/api-v2-release-runbook.md`](../infra/systemd/api-v2-release-runbook.md) 完成原子 `current` 切换和新 API 单元重启；`18081`、公网 `/api/v2`、旧 `8001` 已复测通过。下一步进行真实微信登录、患者切换、预约只读和门诊费用的分层验收，任何业务层失败只回滚新 API，不触碰旧 Python 服务。
14. 已用公网 runtime smoke 的 traceId/requestId 证明 `/api/v2` 请求进入当时的 `d177991` Bun 进程；随后经历 `6d58c9c` 并已切换到当前 `5c4e7cf`，不再重复基础路由检查，转入真实 session、owner 映射、provider 状态和真机页面证据。

15. 2026-08-16 21:20 CST 使用候选 `3dc6f5f` 的 runtime smoke bundle 复测当前公网 `/api/v2`，live、ready、system-ping 和未登录认证边界全部通过；本次无会话、无患者/Provider 业务请求，不能替代真实微信 session 验收。证据见 [`release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md)。

## 业务正确性加固记录

- 2026-08-16：开发者工具观测到一次 `/api/v2/auth/wechat` `503`，但旧页面层仍显示脱敏患者卡片；
  已确认页面可见患者不等于本次微信登录成功。首页会话恢复或重新登录失败时现在清理当前页面患者派生状态，
  仅在本地 token 已被判失效时进入无会话态，避免把 Redis/网络暂时故障误处理成永久退出；真实登录仍需
  `auth.wechat.login.succeeded`、`/me`、患者同步和 Redis TTL 的同链路证据。

- 2026-08-16 23:19-23:20 CST：当前公网只读观察确认新 API 的 live/ready/system-ping、数据库/Redis/schema
  readiness、未登录患者 401 和病历 404 冻结边界均符合预期；没有触发微信登录、患者同步、预约、支付、医保或 HIS
  写入。该观察不能替代真实 session、Provider 和真机证据，详见
  [`release/current-public-readonly-smoke-2026-08-16.md`](release/current-public-readonly-smoke-2026-08-16.md)。

- 2026-08-16：将旧端 WebSocket、跳转其他小程序、web-view、支付调起、二维码/公众号和医保回跳纳入文件级迁移审计；这些入口仍保持“待契约/未迁移”，不因普通 HTTP endpoint 台账通过而提前开放。

- 2026-08-16：补齐患者临床映射生命周期：完整快照缺少 `his-patient` 时在同一事务内清理旧 `patId`，旧快照和普通单条 upsert 不会误触发清理；新增内存/MySQL 回归测试和中文业务规则文档。
- 2026-08-16：修正报告目录批量短期引用的观察时钟：同一次 provider 响应的所有 `reportId` 共享同一 `createdAt`/`expiresAt`，避免批量处理跨时钟边界产生不一致 TTL。

- 2026-08-16：患者目录 adapter 现在先拒绝同一完整快照中的重复 `thirdPatientId`，并在临床档案查询完成后拒绝重复的 HIS `patId`；避免持久化 upsert 把两条 provider 记录静默合并，或让切换就诊人后读取同一份临床数据。空医疗卡号会按旧端约定回退到有效 `cardNo`。
- 2026-08-16：预约排班 adapter 固定使用已确认的 `usableSourceNum`，不再把旧端别名作为 fallback，并拒绝同一响应中的重复 `hisScheduleId`；避免错误号源数量和多个 opaque 排班引用指向同一 provider 号源。
- 2026-08-16：报告 adapter 按来源拒绝重复 `reportId`；无 provider 报告号的摘要继续只展示摘要，不根据标题和时间伪造详情唯一引用。
- 2026-08-16：预约科室 adapter 拒绝同一响应中的重复 `departmentId`；预约历史和爽约页面不再把可缺失/重复的 `serialNumber` 当渲染主键，页面 key 明确仅用于列表 diff，不具备预约或 provider 业务含义。
- 2026-08-16：修复服务端与小程序只读窗口依赖运行时本地时区的问题，并用 UTC 输入验证仍输出中国标准时间；提交 `4c0d255` 只涉及客户端和文档，不需要重启 API，也不会打开支付、医保或结算写入。
- 患者目录失效回收已在代码中实现为 0013 的 active/inactive 事务快照，并保留历史引用；目标环境 migration 和 schema probe 已完成，下一步是失效/恢复数据验收和真机证据，仍禁止物理删除 `hp_patients`。
- 普通个人资料已在 0014 建立独立 `hp_user_profiles` 表；MySQL 首次写入和条件版本更新均有回归测试，下一步必须先做 schema probe、默认值/冲突公网验收，再允许真机使用资料编辑入口。
- 2026-08-16：0014 已在生产受控应用，schema probe 返回 `ready`，当时 `d177991` 已切换新 API；该历史窗口随后运行 `b186098`，未登录 profile 401 已验证，真实微信资料默认值、首次更新、409 冲突和真机仍未完成。当前线上版本以 `5c4e7cf` 验收记录为准。
- 2026-08-16：修复首页与患者选择页下拉刷新提前结束的问题；首页等待健康检查和服务端目录读取，患者选择页继续等待医院目录同步，并移除目录读取完成后提前关闭 `loading` 的时序漏洞，避免临床映射尚未落库时进入预约、报告或费用查询，也不让首页普通刷新隐式放大为 provider 同步。
- 2026-08-16：修复预约目录日期标签使用设备本地时区的问题；`workDate` 现在按固定日历解析，跨时区不会改变医院日期或星期。
- 2026-08-16：患者同步 durable operation ledger、租约代次、同事务快照提交和 409 处理中语义已完成代码、测试和 `0015` migration，生产 schema probe 已通过；该历史窗口公网 `18081` 曾运行 `b186098`，真实患者并发、多患者切换、公网和真机证据仍待完成，契约与证据见 [`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md) 和 [`release/patient-sync-idempotency-production-acceptance-2026-08-16.md`](release/patient-sync-idempotency-production-acceptance-2026-08-16.md)。预约写入、患者绑定前必须完成这些线上验收。
- 2026-08-16：修复患者目录完整快照的乱序并发：`observedAt` 在 provider 请求前采样，内存仓储和 MySQL 条件更新都拒绝旧快照覆盖新状态；新增服务层、内存仓储和 MySQL 回归测试。
- 2026-08-16：收紧普通个人资料页的并发边界；下拉刷新使用最后一次请求获胜守卫，加载/保存期间由 UI 和方法层双重禁止保存，避免旧 GET 覆盖新 `version` 或快速连点制造不必要的 409。首页和患者选择页的患者同步统一使用 `services/single-flight.ts`，自动恢复、生命周期回调和手动刷新在同一页面实例内复用等待中的 Promise，并在成功/失败后释放锁；跨页面/跨进程仍以服务端 operation ledger 为最终幂等事实。真实微信资料读写和真机验收仍未完成。
- 2026-08-16：修正首页、预约记录、爽约记录、报告目录和门诊费用页的首次 `onShow` 生命周期状态：移除模块级 `isFirstShow`，改为页面实例内的 `hasShown`，避免页面栈叠加时不同实例互相消费首次展示标记，造成患者上下文漏刷新或重复请求；新增原生 acceptance 断言和中文业务不变量说明。
- 2026-08-16：继续修正页面栈并发边界：原生页面曾将 `createLatestRequestGuard` 和患者同步 `createSingleFlight` 直接放在模块级，导致同一路径多个实例共享请求状态；现统一使用页面对象作为 `WeakMap` owner，页面实例间不再互相取消患者、预约、报告、费用或资料请求，新增 guard/单飞隔离测试和构建门禁。
- 2026-08-16：完成生产 Redis 会话隔离：新 API 使用 DB3/`hospital_v2`，ACL 只允许 `PING/SELECT/GET/SET` 与 `hospital:session:*`，通过 TTL 和跨前缀拒绝探针；旧 Python DB1 继续运行，未迁移旧 namespace。
- 2026-08-16 20:08-20:11 CST：`b4dc33b` 已在真实生产 env 完成独立 release checksum、preflight、production mode、MySQL/Redis/schema、no-store、system ping 和未登录认证边界 smoke；候选 `18082/18083` 已停止，`current=55fce6c`、新 API `18081` 和旧 Python `8001` 未改变。真实微信、患者同步、预约/报告/门诊费用和真机仍待切换后验收，证据见 [`release/candidate-b4dc33b-production-smoke-2026-08-16.md`](release/candidate-b4dc33b-production-smoke-2026-08-16.md)。
- 2026-08-16 20:37-20:42 CST：候选 `d177991` 已完成真实生产 env preflight、五个 bundle checksum、`18082/18083` 隔离 smoke，并原子切换到生产 `current`；新 API `18081` 的公网 `/api/v2` live/ready（含 `Cache-Control: no-store`）、system-ping 和六路未登录认证边界全部通过，旧 Python `8001` 保持 PID/监听不变，Worker 仍 inactive。真实微信登录、患者同步/切换、预约目录/历史、报告和门诊费用仍需在公网切换后分层验收，证据见 [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md)。
- 2026-08-16：完成 `f2c6d99` 候选 release 的错误契约和 `cb11bc8` persistence 探针状态日志隔离 smoke；HTTP 401、生产模式启动、MySQL/Redis/schema 探针均符合预期，临时端口已清理，生产 `current=55fce6c`、`18081` 和旧 `8001` 保持不变。由于 systemd 管理权限尚未就绪，公网错误文案、患者同步 `0015` 和真机业务仍不能计为已验收。
- 2026-08-16：剩余迁移重新收敛为“文档驱动的 provider 业务”和“已有代码的分层验收”两条线：病历、患者绑定、预约写入、支付/医保/HIS、二维码不允许根据旧端页面猜测实现；每块业务必须先冻结 provider contract、状态机、owner/幂等/超时语义和日志字段，再进入代码和真机验收。
- 2026-08-16：小程序页面错误展示统一经过稳定错误码映射，页面不再直接读取 `Error.message`；未知/未来错误码回退到安全文案，避免 provider 或内部异常文本进入患者界面。
- 2026-08-16：补齐患者端列表的数量、空结果、排序、日期窗口和大结果集语义门禁；修正文档中“失效就诊人自动回退第一项”的错误描述，明确只有首次无选择才默认第一项，已有选择失效必须显式重新选择。
- 2026-08-16：修正报告目录与详情 gate 的边界；provider 缺少稳定报告号时保留安全摘要并省略详情引用，不再把单条详情不可用扩大成整批目录失败；公共文档和回归测试同步固定该不变量。
- 2026-08-16：为患者新增、门诊就诊记录目录/详情和医保授权候选路径增加 404 冻结门禁；在 provider/HIS contract、owner 映射、幂等和真实验收完成前，不允许以旧接口转发或空响应伪造迁移完成。
- 2026-08-16：复核旧端病历源码后明确拆分住院病历 `2.12.4/2.12.5/2.12.6` 与门诊 `out-visit-records`；住院 `patInHosId`、`babyId`、`noteId`、`mrTypeId` 不能复用为门诊记录字段，门诊目录仍等待独立 Provider/HIS contract，详见 [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md)。
- 2026-08-16：进一步固定病历异常语义和住院 episode 链：旧门诊页实际使用 `ZY.ts` 的窄响应类型，非数组、请求异常都会被折叠为空列表；旧住院页则按 `patId → patInHosId → 日费用` 串联并默认取第一条 episode。新端不得复制这两个错误边界，必须区分真实空目录、映射缺失、权限拒绝和暂时失败，并在 provider contract 确认多 episode、金额单位和时间窗口前继续保持病历/住院路由关闭。
- 2026-08-16：门诊费用服务补齐空白 `patientId` 的服务层拒绝，并让 owner 映射、持久化和 provider 失败统一进入 `outpatient.payment.records.failed`；失败不能被误记为成功空列表，也不能绕过低敏日志链路。
- 2026-08-16：微信预支付在依赖未配置时也会把已记录的尝试从 `pending` 收敛为 `unknown`，返回 `dependency-not-configured`；同一幂等键不会永久卡在“处理中”，配置完成后必须用新的幂等键重新申请，提交 `b8086d1`。
- 2026-08-16：provider 目录 smoke 补齐门诊费用 `unpaid`/`paid` 两个只读状态，并要求服务端回显状态与请求状态一致；继续拦截金额、订单、医保、患者身份和 provider 原始字段，未触发支付、医保或结算写入。
- 2026-08-17：`0610558` 继续收紧门诊费用状态边界：领域 service 与众阳 adapter 都拒绝运行时未知状态，避免“非 unpaid 即 paid”误发 `tradeStatus=3`；新增稳定的 `outpatient-payment-query-invalid` 错误码、低敏 `status=invalid` 失败日志和回归测试。该修正未部署，不改变门诊费用只读范围，也未打开支付、医保或 HIS。
- 2026-08-17：`0505709` 收紧报告目录 `kind` 的运行时边界：领域 service 与众阳 adapter 都拒绝未知来源，避免默认分支把错误查询降级为 ECG；复用 `report-query-invalid` 稳定错误码，补齐失败日志与回归测试。该修正未部署，不改变报告 gate，也未打开二维码、支付、医保或 HIS。
- 2026-08-17：`87f7171` 补齐预约科室/排班日期校验的失败日志闭环：非法日期和服务端日期生成异常记录 `appointment.directory.*.failed`，不产生 `requested`、Provider 调用或伪造空结果；该修正未部署，不改变预约只读范围，也未打开预约写入、二维码、支付、医保或 HIS。
- 2026-08-17：`c1d10e3` 拆分患者目录同步与读模型读取的日志生命周期：`GET /patients` 新增独立的 `read.requested/read.loaded/read.failed` 事件；快照事务或 durable replay 成功后，如果最后的脱敏读模型读取失败，只记录 `read.failed`，不再追加 `patient.directory.failed`，避免把持久化读取故障误判为 Provider 同步失败。患者服务定向 7 项、API 集成 33 项及全量 `pnpm check` 通过；该修正未部署，线上仍以 `131fb5a` 和生产 schema `0015` 为准。
- 2026-08-17：`9d9e7b1` 将 opaque 标识的形状校验下沉到 domain/service 层，覆盖预约过滤、预约历史、报告目录/详情和门诊费用查询；服务层不再信任绕过 Elysia schema 的非法标识，失败日志只记录固定 `invalid`，不泄露超长或控制字符原值。API 91 项、domain 21 项、原生小程序 62 项及独立架构/provider/文档/格式/Lint/typecheck/test/build 检查通过；完整 `pnpm check` 仅被 `G:\\fuck\\hospital` 另一会话未提交的旧医保改动造成的迁移清单漂移阻塞，本轮不修改该工作树。该修正未部署，不改变只读范围，预约写入、二维码、支付、医保和 HIS 继续关闭。
- 2026-08-17：门诊费用页面补齐大结果集的本地渲染边界：服务端仍返回本次完整只读结果，页面首批渲染 10 条，后续“加载更多”只展开同一次 owner-scoped 查询已取得的数据，不新增 provider 请求、不改变 `total`、金额或状态事实，也不被描述为 provider 分页。小程序 62 项验收、typecheck 和构建通过；该修正未部署，支付、医保、结算和 HIS 继续关闭。
- 2026-08-17：预约历史和爽约派生页补齐同样的本地渲染边界：服务端固定日期窗口和完整结果不变，页面首批渲染 10 条，后续“加载更多”只展开当前已取得的数据；爽约仍只能由服务端归一化的 `missed` 状态决定，不新增 provider 请求、不改变状态或空结果语义。该修正未部署，预约写入、支付、医保和 HIS 继续关闭。
- 2026-08-17：收紧患者同步幂等键生成：首页和选择页不再只使用 `Date.now()`，改为集中生成符合 header 约束的业务前缀、时间片和随机尾部；同一页面单飞调用仍复用同一个 Promise，不同页面实例不会因同一毫秒而误共享 owner/provider/key 操作事实。该修正未部署，患者同步 replay、并发租约和真机证据仍待线上验收。
- 2026-08-17：发现 Provider 空患者目录的语义尚未被正式 contract 区分为“确实无绑定患者”或“不完整/权限过滤/临时异常”，因此服务层新增 fail-closed 保护：首次且确实为空的 owner 仍可成功，已有医院目录患者时返回 `patient-directory-snapshot-unsafe` 并保留旧快照，避免一次不确定响应批量停用就诊人。该修正未部署，待 Provider contract 和真机多就诊人验收后再评估是否放宽。
- 2026-08-17：病历域再次完成只读 contract 审计，仍未发现 `out-visit-records` 的正式 provider/HIS 文档、专用患者映射确认、四类脱敏样例和资源授权定义。旧端门诊记录与住院病案仍是两条不同链路；因此本轮按业务正确性要求停止编码，继续保持 `GET /api/v2/medical-records`、详情、正文、诊断和附件 404/未注册，不以万能转发或空列表伪造迁移完成。后续只有在 MR-01 至 MR-06、MR-13 至 MR-15 和最小交付包完成后才重新评估；当前切换到下一项可取得真实 contract 或可分层验收的只读工作。
- 2026-08-17：修正报告目录详情引用的故障隔离：单条 LIS 短期引用持久化失败时保留安全摘要、隐藏详情入口并记录 `report.detail_reference.failed`；LIS/PACS/ECG Provider 聚合失败仍整批 fail-closed。该修正不打开报告 gate，不改变报告详情、附件和支付/医保/HIS 的关闭边界。
- 2026-08-17：修正预约历史 Provider smoke 的验收窗口偏差：此前 smoke 只请求过去 90 天到当天，无法证明“我的挂号”不会漏掉未来预约；现在与原生 `dashboard-service` 和公共 contract 统一为当前中国标准时间前后各 90 天，并补固定日期回归测试。该修正只增强验收工具，不改变预约历史 API、预约写入或支付/医保/HIS 边界。
- 2026-08-17：继续修正 Provider smoke 的日期基准：绝对时间先转换为 UTC+8 自然日再生成查询参数，并用北京时间午夜临界的 UTC 固定时刻回归，避免 smoke 在服务器时区或 UTC 截取下把预约、报告和排班窗口错移一天。该修正仍只影响验收工具，不改变线上 API。
- 2026-08-16 18:20-18:21 CST：SSH 只读复核确认 `current=55fce6c`、新 API `18081`、旧 Python `8001` 均存活；公网 `/api/v2` Smoke 的 system-ping 通过，但 live/ready 仍因缺少 `Cache-Control: no-store` 被拒绝，`sudo -n` 仍需密码，未执行任何线上切换或重启。
- 2026-08-16 18:35 CST：更新后的公网 Smoke 进一步确认 system-ping 与六路未登录 `auth-boundary` 通过；live/ready 仍因缺少 `Cache-Control: no-store` 被拒绝。当前只证明公网路由和认证边界，不能替代候选切换、provider 或真机业务验收。
- 2026-08-16：提交 `0dc39aa` 建立以原生 `app.json` 为事实源的 14 页面迁移台账和 `pnpm migration:audit` 门禁，随后以 `09c88b1` 校正发布文档时序；均为文档/静态检查增强，尚未构建、上传或部署，不能改变生产 `current=55fce6c` 和公网 no-store 未通过的结论。
- 2026-08-16 18:44 CST：SSH 只读复核确认 `current=55fce6c`、新 API `18081`、旧 Python `8001` 仍共存，`sudo -n` 仍需密码；公网 live/ready/system-ping 分别返回 200，ready 依赖均为 `ok`，但 live/ready 仍缺 `Cache-Control: no-store`。本次没有重启、切换、migration 或业务写入，requestId 和完整结果已记录在 [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md)。
- 2026-08-16 16:57 CST：首次观测到公网与内网 readiness 短时不同；17:02 CST 通过唯一 requestId 和 Bun journald 证明两者实际来自同一个 `55fce6c` 进程，差异属于依赖探针恢复，不是另一 upstream。当前 release 仍缺少候选代码的 `Cache-Control: no-store`，仓库 `main` 的待发布版本尚未部署，仍禁止用公网 `200` 推导业务已验收。
