# 项目文档导航

> 当前完整小程序来源校验值：`b0e093565493285e07fe549879f8b87eda649cc7`；当前服务端 release：`2a2acd9bcc89c35988b75fc03304dbd48078c9d5`。

新会话开始前先阅读本页，再根据任务进入对应文档。文档中的“已实现”只代表代码/测试或部署证据，不自动代表
真实微信、医保、HIS、支付 provider 或真机已经验收。

当前发布基线（2026-08-22）为：服务端线上 `2a2acd9bcc89c35988b75fc03304dbd48078c9d5`（提交 `2a2acd9`）、当前小程序候选来源
`b0e093565493285e07fe549879f8b87eda649cc7`（提交 `b0e0935`）。服务端已完成新 API 的原子切换与 production smoke；小程序已重新构建，
并清理/重建正确项目的开发者工具编译缓存，但仍需普通编译、生成新二维码并取得真机三层业务证据。旧 Python `8001` 未因本轮修改而改变。
下方带有 `current-*` 或旧 release 名称的记录是当时窗口的历史证据，不覆盖这个当前基线。

工作树运行包补充状态（2026-08-22）：`apps/miniprogram/dist/build-info.json.sourceRevision` 当前为
`b0e093565493285e07fe549879f8b87eda649cc7`，与已部署服务端 `2a2acd9` 配套。该运行包不含任何测试 JS；针对
`single-flight.test.js` 的 ENOENT 已重新构建并通过开发者工具 CLI 清理 compile 缓存、关闭后重开正确项目。
这只修复工具旧增量索引，不增加微信登录、患者、Provider 或真机业务证据。

## 首先阅读

| 文档 | 用途 |
| --- | --- |
| [`wechat-auth-login.md`](wechat-auth-login.md) | 微信授权登录的架构、配置、域名、日志、验收和回滚唯一入口 |
| [`architecture.md`](architecture.md) | 全局分层、依赖注入、fail-closed 和迁移边界 |
| [`roadmap-next-phase.md`](roadmap-next-phase.md) | 业务、工程、运行和验收的下一阶段统一路线图；当前线上服务端 release 以 `2a2acd9`、当前小程序候选来源以 `b0e093565493285e07fe549879f8b87eda649cc7` 为准 |
| [`release/next-business-gates-2026-08-20.md`](release/next-business-gates-2026-08-20.md) | 当前业务门禁短入口：按微信会话、患者切换、只读业务、契约缺口和支付/医保最后专项排列执行顺序与停止条件 |
| [`release/miniprogram-runtime-publish-atomicity-2026-08-20.md`](release/miniprogram-runtime-publish-atomicity-2026-08-20.md) | 小程序 `dist/` 发布竞态、开发者工具 404 现场证据、staging/回滚修复和真机前验证要求 |
| [`release/miniprogram-runtime-enoent-recovery-2026-08-20.md`](release/miniprogram-runtime-enoent-recovery-2026-08-20.md) | `single-flight.test.js` 真机 ENOENT 的运行包边界、开发者工具旧增量索引根因和普通编译恢复顺序 |
| [`release/miniprogram-runtime-enoent-recovery-2026-08-22.md`](release/miniprogram-runtime-enoent-recovery-2026-08-22.md) | 当前 `4e1b2e2` 候选的 ENOENT 再次复核、普通编译、运行包门禁和二维码恢复证据 |
| [`release/current-public-health-observation-2026-08-22.md`](release/current-public-health-observation-2026-08-22.md) | 当前公网 live/ready/ping 低敏探针；明确它不替代真机、Provider 或旧服务共存证据 |
| [`release/device-evidence-redaction-phone-audit-2026-08-22.md`](release/device-evidence-redaction-phone-audit-2026-08-22.md) | 真机验收摘要中的手机号脱敏门禁、回归测试和不影响业务/旧服务的边界 |
| [`release/device-evidence-distinct-chain-audit-2026-08-22.md`](release/device-evidence-distinct-chain-audit-2026-08-22.md) | 普通资料与预约目录双请求必须使用独立客户端 requestId 和服务端关联指纹的证据门禁 |
| [`release/candidate-b0e0935-current-build-2026-08-22.md`](release/candidate-b0e0935-current-build-2026-08-22.md) | 当前 `b0e0935` 小程序运行包、`single-flight.test.js` ENOENT 恢复、开发者工具缓存处理和真机前运行包边界 |
| [`release/candidate-c01b1af-local-build-2026-08-22.md`](release/candidate-c01b1af-local-build-2026-08-22.md) | 未部署 `c01b1af` 预约排班快照日志 traceId 关联修正、本地测试和上线后缺失关联计数门禁 |
| [`release/2a2acd9b-production-acceptance-2026-08-22.md`](release/2a2acd9b-production-acceptance-2026-08-22.md) | 当前服务端原子切换、production preflight、旧 Python `8001` 共存、日志链路修正和只读预约证据 |
| [`release/next-appointment-records-acceptance-2026-08-22.md`](release/next-appointment-records-acceptance-2026-08-22.md) | 下一项预约历史/爽约只读验收顺序、三层低敏证据、停止条件和代码入口 |
| [`release/current-2a2acd9-business-observation-2026-08-22-0918.md`](release/current-2a2acd9-business-observation-2026-08-22-0918.md) | 当前 `2a2acd9` 线上低敏业务观察、预约已有事件、门诊费用未触发和下一次真机顺序 |
| [`release/candidate-b0e0935-local-build-2026-08-22.md`](release/candidate-b0e0935-local-build-2026-08-22.md) | 未部署 `b0e0935` 候选的患者卡号 contract、运行包来源、本地门禁和线上切换停止条件 |
| [`release/candidate-4f2d890-local-build-2026-08-22.md`](release/candidate-4f2d890-local-build-2026-08-22.md) | 未部署 `4f2d890` 众阳卡号超长响应 fail-closed 修正、服务端/小程序来源区分和发布停止条件 |
| [`release/readonly-page-state-audit-2026-08-22.md`](release/readonly-page-state-audit-2026-08-22.md) | 预约记录、门诊费用、报告目录的只读成功/空/异常语义、页面清理边界、日志证据和开发者工具占用处理 |
| [`release/ssh-access-recovery-and-release-gate-2026-08-22.md`](release/ssh-access-recovery-and-release-gate-2026-08-22.md) | SSH 公钥恢复、发布前只读确认、新 API 原子切换、旧 Python `8001` 共存和回滚门禁 |
| [`release/miniprogram-devtools-project-preflight-2026-08-21.md`](release/miniprogram-devtools-project-preflight-2026-08-21.md) | 当前候选运行包和微信开发者工具项目选择前置检查；防止误用旧 `mp-weixin` 窗口 |
| [`release/redis-readiness-concurrency-audit-2026-08-20.md`](release/redis-readiness-concurrency-audit-2026-08-20.md) | Redis readiness、会话读写和 TTL 维护的连接单飞边界；不重放业务命令，失败后允许安全重试 |
| [`release/redis-session-error-classification-2026-08-22.md`](release/redis-session-error-classification-2026-08-22.md) | 区分 Redis 未配置、会话自然失效和已配置 Redis 瞬态读写故障的 HTTP/日志边界；修复已随 `7181e99e` 发布 |
| [`release/redis-session-ttl-audit-hard-cap-2026-08-21.md`](release/redis-session-ttl-audit-hard-cap-2026-08-21.md) | Redis 会话 TTL 只读审计 `maxKeys` 硬上限、最后一页超量返回和当前线上未验证边界 |
| [`release/observability-redaction-casing-audit-2026-08-20.md`](release/observability-redaction-casing-audit-2026-08-20.md) | Pino 日志脱敏的 HTTP 头大小写、幂等键和患者身份字段变体边界；仅为本地新项目代码审计，不代表线上已切换 |
| [`release/observability-deep-redaction-audit-2026-08-21.md`](release/observability-deep-redaction-audit-2026-08-21.md) | Pino 10 固定层级路径的深层泄露缺口、递归 JSON 输出门禁、合成探针和未部署边界 |
| [`release/worker-startup-mode-log-audit-2026-08-21.md`](release/worker-startup-mode-log-audit-2026-08-21.md) | Worker 启动探针失败时的 development/test/production 模式日志边界、回归测试和未部署说明 |
| [`release/patient-relationship-unknown-boundary-2026-08-20.md`](release/patient-relationship-unknown-boundary-2026-08-20.md) | 患者关系明确“其他”和关系缺失/未知的契约、adapter 映射、小程序文案与验收边界 |
| [`release/patient-card-masking-contract-2026-08-22.md`](release/patient-card-masking-contract-2026-08-22.md) | 患者卡号公共 contract、前五位/后四位展示边界、历史掩码兼容和重新同步停止条件 |
| [`release/miniprogram-profile-logic-audit-2026-08-20.md`](release/miniprogram-profile-logic-audit-2026-08-20.md) | 普通资料版本更新、409、会话失效清理、低敏日志和真实写入验收缺口的当前逻辑审计 |
| [`release/miniprogram-profile-write-session-race-audit-2026-08-21.md`](release/miniprogram-profile-write-session-race-audit-2026-08-21.md) | 普通资料写入返回后会话代际变化的 `saving` 状态收敛、回归证据和真机写入未完成边界 |
| [`release/profile-mysql-write-response-atomicity-2026-08-21.md`](release/profile-mysql-write-response-atomicity-2026-08-21.md) | 普通资料 MySQL 行锁、版本条件更新和 canonical 响应回读的事务原子性修正 |
| [`release/profile-mysql-read-model-validation-2026-08-21.md`](release/profile-mysql-read-model-validation-2026-08-21.md) | 普通资料 MySQL 行映射统一领域读模型校验、`persistence-invalid` 错误链和未发布边界 |
| [`release/wechat-identity-duplicate-race-unionid-2026-08-21.md`](release/wechat-identity-duplicate-race-unionid-2026-08-21.md) | 微信身份重复键竞争时的 unionId 补全、条件写入和权威回读边界 |
| [`release/patient-provider-reference-conflict-2026-08-21.md`](release/patient-provider-reference-conflict-2026-08-21.md) | 患者目录与 HIS 临床档案双重唯一约束冲突、事务回滚和稳定错误码边界 |
| [`release/miniprogram-appointment-readonly-logic-audit-2026-08-20.md`](release/miniprogram-appointment-readonly-logic-audit-2026-08-20.md) | 预约历史/爽约的患者归属、日期窗口、状态筛选、双标签停止条件和并发回写审计 |
| [`release/appointment-schedule-snapshot-runtime-validation-2026-08-21.md`](release/appointment-schedule-snapshot-runtime-validation-2026-08-21.md) | 排班只读结果落入短期观察快照前的 Provider、字段、号源和 TTL 运行时校验 |
| [`release/miniprogram-outpatient-payment-logic-audit-2026-08-20.md`](release/miniprogram-outpatient-payment-logic-audit-2026-08-20.md) | 门诊费用只读的患者归属、状态、日期、金额精度、页面并发和支付关闭边界 |
| [`release/outpatient-payment-identity-boundary-2026-08-21.md`](release/outpatient-payment-identity-boundary-2026-08-21.md) | 门诊费用 Provider 稳定身份字段的严格形状、长度、控制字符和 `recordId` 唯一性边界 |
| [`release/miniprogram-outpatient-payment-session-race-audit-2026-08-21.md`](release/miniprogram-outpatient-payment-session-race-audit-2026-08-21.md) | 门诊费用状态切换前的患者会话代际竞态、请求前 fail-closed 修正和验证边界 |
| [`release/appointment-outpatient-readonly-correctness-audit-2026-08-21.md`](release/appointment-outpatient-readonly-correctness-audit-2026-08-21.md) | 预约与门诊费用只读 service 输入字段、渠道 3/4、状态、患者归属和当前验证证据 |
| [`release/report-attachment-boundary-2026-08-21.md`](release/report-attachment-boundary-2026-08-21.md) | 报告 LIS 附件标记的元素类型、控制字符和下载授权关闭边界 |
| [`release/readonly-business-chain-audit-2026-08-21.md`](release/readonly-business-chain-audit-2026-08-21.md) | 当前候选预约历史、爽约、门诊费用患者上下文复核，以及 `single-flight.test.js` ENOENT 运行包恢复证据 |
| [`release/current-gated-domains-audit-2026-08-21.md`](release/current-gated-domains-audit-2026-08-21.md) | 当前病历、患者绑定、二维码、报告详情/附件和支付医保门禁，以及公网关闭路由只读证据 |
| [`release/miniprogram-qr-contract-audit-2026-08-21.md`](release/miniprogram-qr-contract-audit-2026-08-21.md) | 旧端二维码实际使用 `medicalCardNo` 而非 `patId` 的证据、外部生成风险和新端关闭闸门 |
| [`release/current-public-readonly-smoke-2026-08-21-2055.md`](release/current-public-readonly-smoke-2026-08-21-2055.md) | 20:55 CST 公网 live/ready/ping、未登录资料/患者鉴权和本地运行包来源限制；不替代真机业务证据 |
| [`release/miniprogram-report-readonly-logic-audit-2026-08-20.md`](release/miniprogram-report-readonly-logic-audit-2026-08-20.md) | 报告目录/详情的患者归属、多来源聚合、opaque 引用、附件存在性和关闭门禁 |
| [`release/report-directory-service-input-boundary-audit-2026-08-21.md`](release/report-directory-service-input-boundary-audit-2026-08-21.md) | 报告目录 service 未知字段拒绝、owner/患者映射、详情引用和 Provider gate 边界 |
| [`release/miniprogram-patient-directory-superseded-2026-08-21.md`](release/miniprogram-patient-directory-superseded-2026-08-21.md) | 首页患者目录请求被淘汰时的显式生命周期结果、禁止误启动同步的并发修正与验证证据 |
| [`release/patient-directory-correctness-audit-2026-08-21.md`](release/patient-directory-correctness-audit-2026-08-21.md) | 患者目录 owner、双层 Provider ID、完整快照、临床映射、会话代际和显式切换的全链路正确性审计 |
| [`release/patient-sync-lease-fencing-2026-08-21.md`](release/patient-sync-lease-fencing-2026-08-21.md) | 不同幂等键接管后旧患者同步响应的提交租约栅栏、回归测试和真实并发验收边界 |
| [`release/patient-service-input-boundary-audit-2026-08-21.md`](release/patient-service-input-boundary-audit-2026-08-21.md) | 患者目录 service 直接调用的 owner/上下文运行时校验、公共错误契约和仓储前 fail-closed 证据 |
| [`release/adapter-call-context-runtime-boundary-audit-2026-08-21.md`](release/adapter-call-context-runtime-boundary-audit-2026-08-21.md) | 非支付 service 共享 AdapterCallContext 运行时校验、失败日志安全投影和下游访问停止条件 |
| [`release/owner-runtime-boundary-audit-2026-08-21.md`](release/owner-runtime-boundary-audit-2026-08-21.md) | 预约、门诊费用、报告和普通资料 service 的 owner/userId 运行时校验及下游停止条件 |
| [`release/miniprogram-patient-session-composition-boundary-2026-08-21.md`](release/miniprogram-patient-session-composition-boundary-2026-08-21.md) | 患者范围页面跨 `/me`、患者目录和业务列表的会话代际组合门禁、报告详情深链复核和验证证据 |
| [`release/miniprogram-session-domain-error-boundary-audit-2026-08-21.md`](release/miniprogram-session-domain-error-boundary-audit-2026-08-21.md) | 已验证会话与患者/报告/挂号/费用业务读取错误的状态边界、修正范围和真机前门禁 |
| [`release/miniprogram-patient-selection-session-recovery-race-audit-2026-08-21.md`](release/miniprogram-patient-selection-session-recovery-race-audit-2026-08-21.md) | 患者选择页在 `/me` 自动恢复会话时的代际竞态、修正顺序和回归证据 |
| [`release/miniprogram-readonly-page-session-event-audit-2026-08-21.md`](release/miniprogram-readonly-page-session-event-audit-2026-08-21.md) | 预约记录、爽约记录和报告目录的跨会话本地分页、标签、详情及静态事件门禁 |
| [`release/candidate-c86a788-local-build-2026-08-21.md`](release/candidate-c86a788-local-build-2026-08-21.md) | 历史 `c86a788` 小程序本地构建来源和运行包隔离记录；当前候选请使用 [`candidate-f488c6f-local-build-2026-08-21.md`](release/candidate-f488c6f-local-build-2026-08-21.md) |
| [`release/candidate-4e82313-local-build-2026-08-21.md`](release/candidate-4e82313-local-build-2026-08-21.md) | 历史 `4e82313` 小程序运行包、会话组合边界修正和来源指纹；当前候选请使用 [`candidate-f488c6f-local-build-2026-08-21.md`](release/candidate-f488c6f-local-build-2026-08-21.md) |
| [`release/candidate-cde7bc9-local-build-2026-08-21.md`](release/candidate-cde7bc9-local-build-2026-08-21.md) | 历史 `cde7bc9` 小程序运行包、首页患者初始化时序、来源指纹和真机验收边界 |
| [`release/candidate-4f80bc2-local-build-2026-08-21.md`](release/candidate-4f80bc2-local-build-2026-08-21.md) | 历史 `4f80bc2` 小程序运行包、App 入口会话恢复边界和来源指纹；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-f9833c1-local-build-2026-08-21.md`](release/candidate-f9833c1-local-build-2026-08-21.md) | 历史 `f9833c1` 小程序运行包和本地会话缓存安全边界；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-8d33a27-local-build-2026-08-21.md`](release/candidate-8d33a27-local-build-2026-08-21.md) | 历史 `8d33a27` 小程序运行包和认证响应令牌快照边界；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-9c582a1-local-build-2026-08-21.md`](release/candidate-9c582a1-local-build-2026-08-21.md) | 历史 `9c582a1` 小程序运行包和门诊费用卡片旧事件边界；当前候选请使用 [`candidate-f488c6f-local-build-2026-08-21.md`](release/candidate-f488c6f-local-build-2026-08-21.md) |
| [`release/miniprogram-readonly-list-load-more-boundary-audit-2026-08-21.md`](release/miniprogram-readonly-list-load-more-boundary-audit-2026-08-21.md) | 当前四个只读列表本地加载窗口的会话/患者/加载状态门禁审计 |
| [`release/candidate-7a6f4df-local-build-2026-08-21.md`](release/candidate-7a6f4df-local-build-2026-08-21.md) | 历史 `7a6f4df` 小程序运行包和门诊费用会话竞态修正；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-f66514d-local-build-2026-08-21.md`](release/candidate-f66514d-local-build-2026-08-21.md) | 历史 `f66514d` 小程序运行包和个人中心会话门禁记录；不能替代当前 `cde7bc9` 候选 |
| [`release/current-public-runtime-smoke-2026-08-21-1112.md`](release/current-public-runtime-smoke-2026-08-21-1112.md) | 11:12 CST 公网 `/api/v2` live/ready、未登录鉴权和未开放路由只读复核；不替代真机业务证据 |
| [`release/current-public-runtime-smoke-2026-08-21-1136.md`](release/current-public-runtime-smoke-2026-08-21-1136.md) | 11:36 CST 公网 `/api/v2` 生产模式、普通资料独立鉴权和未开放能力边界复核；不替代真机业务证据 |
| [`release/current-5a31427-runtime-p0-observation-2026-08-21-1121.md`](release/current-5a31427-runtime-p0-observation-2026-08-21-1121.md) | 11:21 CST 新旧服务共存、Worker、端口和 P0 业务日志空窗口只读复核；不替代真机业务证据 |
| [`release/current-5a31427-runtime-p0-observation-2026-08-21-1134.md`](release/current-5a31427-runtime-p0-observation-2026-08-21-1134.md) | 11:34 CST 新旧服务共存与最近一小时 P0 业务日志空窗口只读复核；不替代真机业务证据 |
| [`release/current-5a31427-coexistence-readonly-2026-08-21-0631.md`](release/current-5a31427-coexistence-readonly-2026-08-21-0631.md) | 06:31 CST 新旧服务共存、生产模式、内网依赖和公网 live/ready/ping 只读复核；不替代真机业务证据 |
| [`release/current-5a31427-coexistence-readonly-2026-08-21-0725.md`](release/current-5a31427-coexistence-readonly-2026-08-21-0725.md) | 07:25 CST 新旧服务共存、正确内外网探针路径和 P0 业务日志空窗口；不替代真机业务证据 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0732.md`](release/current-5a31427-p0-business-observation-2026-08-21-0732.md) | 07:32 CST 当前候选二维码、运行包来源、新旧服务和 P0 业务日志空窗口；不替代真机业务证据 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0647.md`](release/current-5a31427-p0-business-observation-2026-08-21-0647.md) | 06:47 CST 二维码等待期间的新旧服务、readiness 和 P0 业务日志空窗口；不把健康检查或空窗口当作业务成功 |
| [`release/current-5a31427-real-business-event-window-2026-08-21.md`](release/current-5a31427-real-business-event-window-2026-08-21.md) | 服务器真实微信登录/患者同步事件窗口；因早于当前 `b0e0935` 构建且来源未匹配，只作为历史观察，不计入当前候选验收 |
| [`release/84fac75c-production-acceptance-2026-08-22.md`](release/84fac75c-production-acceptance-2026-08-22.md) | 历史 `84fac75c` 真实生产切换、隔离候选验收、新旧服务共存、公网 smoke 和切换后低敏日志窗口；不覆盖当前 `7181e99e` |
| [`release/readonly-business-invariant-review-2026-08-22.md`](release/readonly-business-invariant-review-2026-08-22.md) | 当前 release 的就诊人归属、预约历史/爽约、门诊费用只读、日志关联和真机准入不变量审计；不替代真实真机业务证据 |
| [`release/6038560-production-acceptance-2026-08-21.md`](release/6038560-production-acceptance-2026-08-21.md) | 历史 `6038560` 服务端生产切换、真实 env preflight、隔离 runtime smoke、新旧服务共存和未完成真机业务边界 |
| [`release/9f491cb5-production-acceptance-2026-08-21.md`](release/9f491cb5-production-acceptance-2026-08-21.md) | 历史 `9f491cb5` 真实生产切换、隔离候选验收、新旧服务共存和未完成真机业务边界 |
| [`release/current-c8eef370-runtime-observation-2026-08-21-2310.md`](release/current-c8eef370-runtime-observation-2026-08-21-2310.md) | 历史 `c8eef370` 新旧服务共存、readiness 和低敏日志只读观察；没有新的真机业务事件 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0402.md`](release/current-5a31427-p0-business-observation-2026-08-21-0402.md) | `5a31427` 切换后 P0 日志空窗口的安全计数、门禁缺失项和下一次真机取证顺序 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0451.md`](release/current-5a31427-p0-business-observation-2026-08-21-0451.md) | `5a31427` 04:51 CST 线上只读观测：新旧服务共存正常，但最近 30 分钟没有新的微信/患者/预约/费用/资料业务事件 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0409.md`](release/current-5a31427-p0-business-observation-2026-08-21-0409.md) | `5a31427` 04:09 CST 线上只读复核；新旧端口正常、日志解析无误，但仍没有新的真机业务请求 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0554.md`](release/current-5a31427-p0-business-observation-2026-08-21-0554.md) | 05:54 CST SSH 只读复核当前 release、新旧服务共存、readiness 和 P0 业务空窗口；不代表真机业务完成 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0429.md`](release/current-5a31427-p0-business-observation-2026-08-21-0429.md) | `5a31427` 04:29 CST 最新线上只读复核；服务 active、新旧端口共存，但最近窗口仍没有新的真机业务请求 |
| [`release/current-6038560-readonly-observation-2026-08-21-0303.md`](release/current-6038560-readonly-observation-2026-08-21-0303.md) | `6038560` 切换后 SSH 只读运行状态与低敏日志观察；当前窗口只有健康检查，没有新的真实业务事件 |
| [`release/patient-directory-trace-retention-2026-08-21.md`](release/patient-directory-trace-retention-2026-08-21.md) | 患者目录多请求 provider trace 的 domain 保留、低敏日志字段、测试证据和与众阳自动化的隔离边界 |
| [`release/readonly-provider-trace-retention-2026-08-21.md`](release/readonly-provider-trace-retention-2026-08-21.md) | 预约目录/历史和门诊费用只读日志的多请求 trace 保留、失败链关联和测试证据 |
| [`release/miniprogram-real-device-login-patient-acceptance-2026-08-21.md`](release/miniprogram-real-device-login-patient-acceptance-2026-08-21.md) | 历史 `6038560` 窗口的 `6e6604f` 真机微信登录、患者目录读取/同步三层低敏证据；不能替代当前 `c8eef370` 验收 |
| [`release/candidate-1b9b4b0-local-build-2026-08-21.md`](release/candidate-1b9b4b0-local-build-2026-08-21.md) | 历史 `1b9b4b0` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-7f157d4-local-build-2026-08-20.md`](release/candidate-7f157d4-local-build-2026-08-20.md) | 历史 `7f157d4` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-457d9ae-local-build-2026-08-20.md`](release/candidate-457d9ae-local-build-2026-08-20.md) | 历史 `457d9ae` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-ac238c6-local-build-2026-08-20.md`](release/candidate-ac238c6-local-build-2026-08-20.md) | 历史 `ac238c6` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-8f80b3e-local-build-2026-08-20.md`](release/candidate-8f80b3e-local-build-2026-08-20.md) | 历史 `8f80b3e` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/miniprogram-device-qr-session-2026-08-20-2027.md`](release/miniprogram-device-qr-session-2026-08-20-2027.md) | 历史 `8f80b3e` 候选的 iOS 真机二维码会话；不能用于当前 `cde7bc9` 真机验收，仅记录扫码前运行包状态 |
| [`release/current-public-readonly-smoke-2026-08-20-2030.md`](release/current-public-readonly-smoke-2026-08-20-2030.md) | 20:30 CST 公网 `/api/v2` live/ready/ping 与未登录 `/me`、`/patients` 认证边界复核；不代表微信、Provider 或真机业务完成 |
| [`release/current-runtime-p0-observation-2026-08-20-2036.md`](release/current-runtime-p0-observation-2026-08-20-2036.md) | 20:36 CST SSH 只读复核新旧端口、readiness 与低敏 P0 事件计数；没有新的真机业务请求，不代表业务验收完成 |
| [`release/current-5a31427-p0-business-observation-2026-08-21-0545.md`](release/current-5a31427-p0-business-observation-2026-08-21-0545.md) | 05:45 CST SSH 只读复核当前 release、新旧服务共存、实际内网 readiness 地址与 P0 业务空窗口；不代表真机业务完成 |
| [`release/current-public-readonly-smoke-2026-08-21-0547.md`](release/current-public-readonly-smoke-2026-08-21-0547.md) | 05:47 CST 公网 HTTPS 健康、认证和关闭能力只读复核；不代表 Provider 或真机业务完成 |
| [`release/current-public-readonly-smoke-2026-08-21-1021.md`](release/current-public-readonly-smoke-2026-08-21-1021.md) | 10:21 CST 历史 `39ad2c5` 候选的公网 HTTPS 健康、认证和关闭能力只读复核；不代表 Provider 或真机业务完成 |
| [`release/current-5a31427-runtime-and-p0-observation-2026-08-21-1038.md`](release/current-5a31427-runtime-and-p0-observation-2026-08-21-1038.md) | 10:38 CST 服务器新旧服务共存、readiness、P0 低敏日志和公网只读 smoke；业务域仍为空窗口，不代表真机业务完成 |
| [`release/miniprogram-device-qr-session-2026-08-20-2004.md`](release/miniprogram-device-qr-session-2026-08-20-2004.md) | 历史 `3a89312` 候选的 iOS 真机二维码会话；仅记录当时运行层和扫码前状态，不代表当前候选登录或业务验收成功 |
| [`release/candidate-767ed9c-local-build-2026-08-20.md`](release/candidate-767ed9c-local-build-2026-08-20.md) | 历史 `767ed9c` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-d772f09-local-build-2026-08-20.md`](release/candidate-d772f09-local-build-2026-08-20.md) | 历史 `d772f09` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/candidate-0dccf54-local-build-2026-08-20.md`](release/candidate-0dccf54-local-build-2026-08-20.md) | 历史 `0dccf54` 小程序候选构建记录；不能替代当前 `cde7bc9` 候选 |
| [`release/0e360d3-production-acceptance-2026-08-20.md`](release/0e360d3-production-acceptance-2026-08-20.md) | 历史 `0e360d3` 原子生产切换、`patId` 契约、新旧服务共存和未完成业务验收 |
| [`release/current-public-readonly-smoke-2026-08-20-1442.md`](release/current-public-readonly-smoke-2026-08-20-1442.md) | 14:42 CST 公网健康探针、ready 依赖和未登录普通资料/预约/门诊费用接口的只读复核；不代表真机或 Provider 业务完成 |
| [`release/398be8e-production-acceptance-2026-08-19.md`](release/398be8e-production-acceptance-2026-08-19.md) | 历史 `398be8e` 原子生产切换、患者映射安全修正、新旧服务共存和未完成验收 |
| [`release/current-398be8e-runtime-recheck-2026-08-19-1657.md`](release/current-398be8e-runtime-recheck-2026-08-19-1657.md) | 16:57 CST 重启后 `398be8e`、新旧端口、正确内网探针和业务日志只读复核；不代表 Provider/真机业务完成 |
| [`release/current-public-readonly-smoke-2026-08-19-1723.md`](release/current-public-readonly-smoke-2026-08-19-1723.md) | 历史 `398be8e` 公网 live/ready/ping 与未授权 `/me`、`/patients` 只读复核；不替代微信、Provider 或真机业务验收 |
| [`release/current-public-readonly-smoke-2026-08-20.md`](release/current-public-readonly-smoke-2026-08-20.md) | 2026-08-20 切换前 `398be8e` 的公网 live/ready/ping、未授权只读边界与 SSH 双服务共存复核；不替代微信、Provider 或真机验收 |
| [`release/current-runtime-readonly-observation-2026-08-20-1227.md`](release/current-runtime-readonly-observation-2026-08-20-1227.md) | 12:27 CST 新旧服务监听、Worker、readiness 和最近业务日志的只读观察；不代表 Provider 或真机业务完成 |
| [`release/current-runtime-readonly-observation-2026-08-20-1306.md`](release/current-runtime-readonly-observation-2026-08-20-1306.md) | 13:06 CST 切换前 `398be8e`、新旧端口、readiness 与 journald 低敏聚合复核；无新的业务事件，不代表 Provider 或真机业务完成 |
| [`release/current-runtime-and-build-observation-2026-08-20-1839.md`](release/current-runtime-and-build-observation-2026-08-20-1839.md) | 当前小程序运行包测试脚本隔离、全量门禁、公网 `/api/v2` 只读回归和未完成真机业务证据 |
| [`release/old-python-log-routing-observation-2026-08-20.md`](release/old-python-log-routing-observation-2026-08-20.md) | 旧 Python 多 worker 下 6201 日志未出现在 `all.log` 的只读证据、原因边界和后续治理建议；未修改旧服务 |
| [`release/968af78-production-acceptance-2026-08-19.md`](release/968af78-production-acceptance-2026-08-19.md) | 历史 `968af78` 原子生产切换、档案关联校验、新旧服务共存和未完成验收 |
| [`release/current-968af78-runtime-coexistence-2026-08-19-1550.md`](release/current-968af78-runtime-coexistence-2026-08-19-1550.md) | 15:50 CST 重启后 SSH 只读复核 `968af78`、新旧监听、公网 live/ready、依赖状态和最近业务日志；不代表 Provider/真机业务成功 |
| [`release/in-memory-clinical-access-parity-2026-08-19.md`](release/in-memory-clinical-access-parity-2026-08-19.md) | 内存患者 `clinicalAccess` 与 MySQL 映射事实对齐；本地修正，未部署线上 |
| [`release/patient-provider-owner-join-2026-08-19.md`](release/patient-provider-owner-join-2026-08-19.md) | 临床 `his-patient` 映射同时校验患者主表与映射表 Provider 归属；本地修正，未部署线上 |
| [`release/current-968af78-runtime-coexistence-2026-08-19-1543.md`](release/current-968af78-runtime-coexistence-2026-08-19-1543.md) | 15:43 CST SSH 只读复核 `968af78`、新旧监听、公网 live/ready 和依赖状态；不代表 Provider/真机业务成功 |
| [`release/08c36a8-production-acceptance-2026-08-19.md`](release/08c36a8-production-acceptance-2026-08-19.md) | 历史 `08c36a8` 原子生产切换、日志脱敏、新旧服务共存、`patInfosFind`/二维码边界和未完成验收 |
| [`release/65219e2-production-acceptance-2026-08-19.md`](release/65219e2-production-acceptance-2026-08-19.md) | 历史 `65219e2` 原子生产切换、候选 smoke、新旧服务共存、`patInfosFind`/二维码边界和未完成验收 |
| [`release/current-65219e2-preflight-and-coexistence-2026-08-19.md`](release/current-65219e2-preflight-and-coexistence-2026-08-19.md) | 切换前 `65219e2` 生产 preflight、gate 状态、内外网 readiness 和旧 Python 共存历史复核；不代表 Provider/真机业务完成 |
| [`release/current-65219e2-runtime-observation-2026-08-19.md`](release/current-65219e2-runtime-observation-2026-08-19.md) | 切换前重启窗口的 `65219e2` 运行层、正确内网探针、公网 readiness、生产模式和报告关闭 gate 历史复核 |
| [`migration/zhongyang-authorization-contract-audit-2026-08-19.md`](migration/zhongyang-authorization-contract-audit-2026-08-19.md) | 旧平台用户 JWT 与新服务 Provider 凭证的区别、鉴权契约缺口和真实验收停止条件 |
| [`migration/patinfosfind-archive-field-audit-2026-08-19.md`](migration/patinfosfind-archive-field-audit-2026-08-19.md) | `patInfosFind` 的档案字段、`patId` 临床引用、卡片层级、二维码事实和继续开放门禁 |
| [`migration/outpatient-payment-provider-contract-audit-2026-08-19.md`](migration/outpatient-payment-provider-contract-audit-2026-08-19.md) | 门诊费用 2.6.33 参数、`patInfosFind.data.patId`、金额/状态映射、渠道码和只读停止条件 |
| [`release/b7c9451-production-acceptance-2026-08-19.md`](release/b7c9451-production-acceptance-2026-08-19.md) | 历史 `b7c9451` 生产切换、P0 日志同链门禁、双服务共存和业务未完成边界 |
| [`release/current-b7c9451-p0-business-observation-2026-08-19-0815.md`](release/current-b7c9451-p0-business-observation-2026-08-19-0815.md) | 历史 `b7c9451` SSH 只读 P0 业务日志观察；患者读取/同步同链通过，其他业务域和真机证据仍缺 |
| [`release/current-b7c9451-p0-business-observation-2026-08-19-0821.md`](release/current-b7c9451-p0-business-observation-2026-08-19-0821.md) | 历史 `b7c9451` 微信登录、患者读取和同步同链观察；预约、费用、报告和真机页面仍待继续取证 |
| [`release/current-public-readonly-smoke-2026-08-19.md`](release/current-public-readonly-smoke-2026-08-19.md) | 重启后公网 live/ready/system-ping 与未登录认证边界复核；不代表 SSH 进程共存、Provider 或真机业务验收 |
| [`release/current-public-readonly-smoke-2026-08-19-1329.md`](release/current-public-readonly-smoke-2026-08-19-1329.md) | 13:29 CST 公网 live/ready/ping 与未登录患者接口复核；不代表微信、Provider 或真机业务验收 |
| [`release/current-b7c9451-database-transient-observation-2026-08-19.md`](release/current-b7c9451-database-transient-observation-2026-08-19.md) | 历史 `b7c9451` 远端 MySQL 瞬态断连、readiness 恢复、双服务共存和磁盘风险观察；不代表业务验收 |
| [`release/miniprogram-current-candidate-simulator-observation-2026-08-19.md`](release/miniprogram-current-candidate-simulator-observation-2026-08-19.md) | 历史模拟器只读页面观察（当时候选为 `b451cc6`）；当前验收候选请改读 `cde7bc9`，本记录不替代真机、Provider 或服务端日志证据 |
| [`release/miniprogram-real-device-acceptance-checklist-2026-08-19.md`](release/miniprogram-real-device-acceptance-checklist-2026-08-19.md) | 当前 `4e1b2e2` 候选的扫码前门禁、真机操作顺序和三层证据清单 |
| [`release/miniprogram-real-device-evidence-template-c86a788.md`](release/miniprogram-real-device-evidence-template-c86a788.md) | 历史 `c86a788` 候选的真机证据模板；当前模板请使用 [`miniprogram-real-device-evidence-template-4e1b2e2.md`](release/miniprogram-real-device-evidence-template-4e1b2e2.md) |
| [`release/miniprogram-real-device-evidence-template-4e82313.md`](release/miniprogram-real-device-evidence-template-4e82313.md) | 历史 `4e82313` 候选的真机页面、客户端 trace 和服务端低敏日志记录模板；当前模板请使用 [`miniprogram-real-device-evidence-template-4e1b2e2.md`](release/miniprogram-real-device-evidence-template-4e1b2e2.md) |
| [`release/miniprogram-real-device-evidence-template-8d33a27.md`](release/miniprogram-real-device-evidence-template-8d33a27.md) | 历史 `8d33a27` 候选的真机页面、客户端 trace 和服务端低敏日志记录模板；当前模板请使用 [`miniprogram-real-device-evidence-template-4e1b2e2.md`](release/miniprogram-real-device-evidence-template-4e1b2e2.md) |
| [`release/miniprogram-real-device-evidence-template-9c582a1.md`](release/miniprogram-real-device-evidence-template-9c582a1.md) | 历史 `9c582a1` 候选的真机页面、客户端 trace 和服务端低敏日志记录模板；当前模板请使用 [`miniprogram-real-device-evidence-template-4e1b2e2.md`](release/miniprogram-real-device-evidence-template-4e1b2e2.md) |
| [`release/miniprogram-stable-patient-read-session-2026-08-22.md`](release/miniprogram-stable-patient-read-session-2026-08-22.md) | 患者范围只读请求固定会话代际的竞态修复、回归证据和真机边界 |
| [`release/miniprogram-homepage-session-state-2026-08-22.md`](release/miniprogram-homepage-session-state-2026-08-22.md) | 首页目录读取被淘汰时的会话状态竞态、刷新 guard 和回归边界 |
| [`release/miniprogram-real-device-evidence-template-7a6f4df.md`](release/miniprogram-real-device-evidence-template-7a6f4df.md) | 历史 `7a6f4df` 候选的真机页面、客户端 trace 和服务端低敏日志记录模板；不能替代当前 `cde7bc9` 候选 |
| [`release/miniprogram-real-device-evidence-template-f66514d.md`](release/miniprogram-real-device-evidence-template-f66514d.md) | 历史 `f66514d` 候选真机证据模板；不能替代当前 `cde7bc9` 候选 |
| [`release/miniprogram-device-qr-session-2026-08-21-0903-acf5a85.md`](release/miniprogram-device-qr-session-2026-08-21-0903-acf5a85.md) | 历史 `acf5a85` 候选 09:03 CST 的 iOS/局域网二维码会话；不能用于当前 `cde7bc9` 真机验收，仅记录当时缓存清理、普通编译和扫码前运行包状态 |
| [`release/miniprogram-device-qr-session-2026-08-21-0854-acf5a85.md`](release/miniprogram-device-qr-session-2026-08-21-0854-acf5a85.md) | `acf5a85` 候选的上一二维码会话历史；已被新候选替代，不得用于当前真机验收 |
| [`release/miniprogram-device-qr-session-2026-08-21-0842-acf5a85.md`](release/miniprogram-device-qr-session-2026-08-21-0842-acf5a85.md) | `acf5a85` 候选的历史二维码会话；已被新候选替代，不得用于当前真机验收 |
| [`release/miniprogram-device-qr-session-2026-08-21-0810.md`](release/miniprogram-device-qr-session-2026-08-21-0810.md) | 先前真机二维码会话历史；当前扫码必须使用最新 `cde7bc9` 构建后生成的会话 |
| [`release/miniprogram-device-qr-session-2026-08-21-0705.md`](release/miniprogram-device-qr-session-2026-08-21-0705.md) | 历史 `9340846` 候选的 iOS/局域网真机二维码会话；当前二维码必须从 `cde7bc9` 候选重新生成，仅证明二维码与运行包边界，不代表手机业务验收成功 |
| [`release/miniprogram-device-qr-session-2026-08-21-0658.md`](release/miniprogram-device-qr-session-2026-08-21-0658.md) | 历史 `c08378b` 候选的二维码会话；已被当前 `cde7bc9` 候选替代，不得用于当前真机验收 |
| [`release/miniprogram-device-qr-session-2026-08-21-0644.md`](release/miniprogram-device-qr-session-2026-08-21-0644.md) | 历史 `6ce1272` 候选的 iOS/局域网真机二维码会话；已被当前 `cde7bc9` 候选替代，不得用于当前真机验收 |
| [`release/miniprogram-session-recovery-logic-audit-2026-08-21.md`](release/miniprogram-session-recovery-logic-audit-2026-08-21.md) | 会话失效恢复、GET 二次 401 清理、命令禁止重放和患者代际隔离规则；代码当前候选为 `f488c6f3` |
| [`release/miniprogram-device-session-2026-08-19-1651.md`](release/miniprogram-device-session-2026-08-19-1651.md) | 历史 `398be8e + 48ba22f` 候选的二维码/设备连接状态复核；当前尚无有效手机连接，不代表真机业务验收 |
| [`release/miniprogram-device-session-lan-2026-08-19.md`](release/miniprogram-device-session-lan-2026-08-19.md) | 历史 `474b044` 候选的局域网二维码重试、传输层错误边界；新的扫码必须使用当前 `cde7bc9` 候选 |
| [`release/miniprogram-my-page-session-generation-order-2026-08-19.md`](release/miniprogram-my-page-session-generation-order-2026-08-19.md) | “我的”页资料与患者目录的会话代际顺序、降级和旧患者清理边界 |
| [`release/miniprogram-my-page-session-composition-boundary-2026-08-20.md`](release/miniprogram-my-page-session-composition-boundary-2026-08-20.md) | “我的”页 `/me`、资料和患者目录跨请求组合的一致性围栏；本地修正，未部署线上 |
| [`release/miniprogram-appointment-directory-readonly-contract-2026-08-19.md`](release/miniprogram-appointment-directory-readonly-contract-2026-08-19.md) | 预约科室/排班两列级联的 JSON 运行时契约、号源语义和只读停止条件 |
| [`release/miniprogram-report-readonly-response-contract-2026-08-19.md`](release/miniprogram-report-readonly-response-contract-2026-08-19.md) | 报告目录/LIS 详情 JSON 运行时契约、短期引用匹配和临床结果停止条件 |
| [`release/report-provider-trace-aggregation-boundary-2026-08-20.md`](release/report-provider-trace-aggregation-boundary-2026-08-20.md) | 报告目录多 Provider 请求号的有界聚合、低敏日志字段和回归证据 |
| [`release/miniprogram-auth-session-response-contract-2026-08-19.md`](release/miniprogram-auth-session-response-contract-2026-08-19.md) | 微信登录与 `/me` 会话响应的运行时校验、token 持久化和会话代际边界 |
| [`release/miniprogram-list-response-envelope-contract-2026-08-19.md`](release/miniprogram-list-response-envelope-contract-2026-08-19.md) | 患者、预约和门诊费用列表的 success/data 包络、字段白名单、唯一性和日期金额校验 |
| [`release/appointment-record-tab-contract-audit-2026-08-19.md`](release/appointment-record-tab-contract-audit-2026-08-19.md) | “我的挂号”在线/全部双标签的渠道边界、未开放语义和 requestChannel=4 前置条件 |
| [`release/miniprogram-patient-select-session-display-boundary-2026-08-19.md`](release/miniprogram-patient-select-session-display-boundary-2026-08-19.md) | 就诊人选择页在会话失效/账号切换后的目录清理边界；不代表多患者真机验收 |
| [`release/miniprogram-profile-session-display-boundary-2026-08-19.md`](release/miniprogram-profile-session-display-boundary-2026-08-19.md) | 普通资料读取/保存在会话失效后的旧资料清理边界；不代表真实 PUT、409 或真机验收 |
| [`release/miniprogram-login-patient-bootstrap-boundary-2026-08-19.md`](release/miniprogram-login-patient-bootstrap-boundary-2026-08-19.md) | 登录成功与患者上下文就绪的分层契约、同步失败回调门禁和首页旧患者清理边界 |
| [`release/miniprogram-patient-navigation-session-state-2026-08-19.md`](release/miniprogram-patient-navigation-session-state-2026-08-19.md) | 患者范围页面四态会话门禁、`/me` 验证顺序和本地候选验证边界 |
| [`release/miniprogram-session-explicit-patient-retention-2026-08-19.md`](release/miniprogram-session-explicit-patient-retention-2026-08-19.md) | 会话失效/重新登录期间保留显式就诊人选择，防止恢复后静默换成第一位患者 |
| [`release/miniprogram-command-session-replay-boundary-2026-08-19.md`](release/miniprogram-command-session-replay-boundary-2026-08-19.md) | GET 自动恢复与命令请求禁止重放的会话安全边界；不代表线上小程序、真机或支付验收 |
| [`business-correctness.md`](business-correctness.md) | 患者上下文、映射、时间窗口、只读边界和错误处理不变量 |
| [`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md) | 患者目录同步的 durable operation ledger、租约代次、重放语义和生产验收门禁 |
| [`api-v2-public.md`](api-v2-public.md) | 当前 Elysia 公共 `/api/v2` 路由、请求规则、响应字段和稳定错误码 |
| [`migration/remaining-migration-inventory.md`](migration/remaining-migration-inventory.md) | 旧端 64 个页面、新端 14 个页面的差异、风险分级和新接口文档冻结模板；当前服务端为 `7181e99e` |
| [`migration/current-execution-checkpoint-2026-08-17.md`](migration/current-execution-checkpoint-2026-08-17.md) | 当前执行检查点（历史段落保留但顶部已更新到 `c8eef370`）、剩余迁移分层、P0/P1/P2/P3 顺序和偏移检查表；旧 release 仅作历史追溯 |
| [`migration/migration-gap-audit-2026-08-17.md`](migration/migration-gap-audit-2026-08-17.md) | 当前迁移差距、证据等级、未迁移分层、新文档接收门禁和下一阶段顺序；文档内旧 release 仅作历史证据，当前服务端以 `7181e99e` 为准 |
| [`release/p0-readonly-business-acceptance-runbook-2026-08-17.md`](release/p0-readonly-business-acceptance-runbook-2026-08-17.md) | `7181e99e` 服务端与配套小程序候选的微信会话、患者上下文、预约历史、爽约和门诊费用真机/日志验收步骤与业务不变量 |
| [`release/user-profile-readonly-device-acceptance-2026-08-18.md`](release/user-profile-readonly-device-acceptance-2026-08-18.md) | 普通资料首次读取、版本更新、409 并发冲突、非法字段和低敏日志的真机验收步骤 |
| [`release/profile-read-model-display-fail-closed-2026-08-22.md`](release/profile-read-model-display-fail-closed-2026-08-22.md) | 普通资料读模型损坏、会话失效和暂时不可用的前端错误分流；避免把数据故障误判成登录失效 |
| [`release/readonly-business-contract-audit-2026-08-18.md`](release/readonly-business-contract-audit-2026-08-18.md) | 预约历史、爽约记录和门诊缴费的患者归属、窗口、错误分流、日志闭环和未完成证据审计 |
| [`release/readonly-business-chain-audit-2026-08-20.md`](release/readonly-business-chain-audit-2026-08-20.md) | `patInfosFind` → 临床 `patId` → 预约/门诊费用 → 小程序的只读闭环、日志边界和本地测试证据 |
| [`release/outpatient-payment-envelope-validation-2026-08-18.md`](release/outpatient-payment-envelope-validation-2026-08-18.md) | 门诊费用 Provider 响应包络必须明确 `success=true` 的代码修正、测试和未部署边界 |
| [`release/provider-envelope-consistency-2026-08-18.md`](release/provider-envelope-consistency-2026-08-18.md) | 患者目录、档案映射、报告目录和 LIS 详情的 Provider 成功包络一致性审计 |
| [`release/patient-archive-identity-correlation-2026-08-19.md`](release/patient-archive-identity-correlation-2026-08-19.md) | `patInfosFind` 返回档案与本次姓名/卡号查询的二次一致性校验、兼容边界和测试证据 |
| [`release/miniprogram-outpatient-error-context-2026-08-18.md`](release/miniprogram-outpatient-error-context-2026-08-18.md) | 门诊费用失败态清理患者上下文、可达选择空态和本地回归证据 |
| [`release/miniprogram-outpatient-tab-race-2026-08-18.md`](release/miniprogram-outpatient-tab-race-2026-08-18.md) | 门诊缴费首次加载期间切换待缴/已缴标签的状态快照和旧请求淘汰边界 |
| [`release/miniprogram-homepage-stale-directory-lifecycle-2026-08-18.md`](release/miniprogram-homepage-stale-directory-lifecycle-2026-08-18.md) | 首页患者目录旧请求、页面卸载和错误回写的生命周期边界 |
| [`release/miniprogram-my-page-critical-path-2026-08-18.md`](release/miniprogram-my-page-critical-path-2026-08-18.md) | “我的”页患者目录关键路径、普通资料降级读取和页面实例并发边界 |
| [`release/report-readonly-contract-audit-2026-08-18.md`](release/report-readonly-contract-audit-2026-08-18.md) | 报告目录/详情的患者归属、短期 opaque 引用、Provider 文本边界、日志和真实验收缺口 |
| [`migration/report-provider-contract-audit-2026-08-19.md`](migration/report-provider-contract-audit-2026-08-19.md) | LIS/PACS/ECG/体检四类旧报告来源与新端覆盖边界；身份证、详情、附件和报告解读停止条件 |
| [`release/current-public-readonly-smoke-2026-08-18-2025.md`](release/current-public-readonly-smoke-2026-08-18-2025.md) | 重启后的公网 live/ready/system-ping 与未登录认证边界复核；不代表真实业务验收 |
| [`release/current-release-p0-observation-2026-08-17-2129.md`](release/current-release-p0-observation-2026-08-17-2129.md) | `bf67b96` 21:29 CST 当前 release 的新旧服务共存、公网 ready 和只读业务事件增量观察 |
| [`logging.md`](logging.md) | Pino 事件、脱敏字段、requestId/traceId 和 journald 检索 |
| [`../README.md`](../README.md) | 项目状态、开发命令和公开 API 概览 |

## 发布与运行

| 文档 | 用途 |
| --- | --- |
| [`../infra/README.md`](../infra/README.md) | 本地 MySQL/Redis、migration、schema probe 和 runtime smoke |
| [`../infra/systemd/README.md`](../infra/systemd/README.md) | 新 API/worker 的 systemd 目录、env 权限和启动检查 |
| [`../infra/systemd/api-v2-release-runbook.md`](../infra/systemd/api-v2-release-runbook.md) | 新 API 候选 release 的原子切换、最小权限、验收和回滚 |
| [`release/persistence-acceptance.md`](release/persistence-acceptance.md) | MySQL/Redis/schema 的分层验收 |
| [`runbooks/persistence-migration-recovery.md`](runbooks/persistence-migration-recovery.md) | migration 失败和恢复边界 |
| [`release/provider-directory-acceptance.md`](release/provider-directory-acceptance.md) | 众阳患者、预约和报告 provider 验收 |
| [`release/readiness-stability-gate.md`](release/readiness-stability-gate.md) | runtime/provider smoke 的连续 readiness 稳定性门禁与证据规则 |
| [`release/41c9c18-production-acceptance-2026-08-16.md`](release/41c9c18-production-acceptance-2026-08-16.md) | 历史 `41c9c18` 生产切换、预约科室/排班只读和快照持久化验收证据 |
| [`release/user-profile-production-acceptance-2026-08-16.md`](release/user-profile-production-acceptance-2026-08-16.md) | 普通个人资料 0014 migration、生产 API、schema 和公网路由验收；真实微信资料读写仍待完成 |
| [`release/patient-sync-idempotency-production-acceptance-2026-08-16.md`](release/patient-sync-idempotency-production-acceptance-2026-08-16.md) | 0015 生产证据与 0016 发布前历史边界；真实并发/多患者同步仍待验收 |
| [`release/patient-sync-0016-readiness-audit-2026-08-17.md`](release/patient-sync-0016-readiness-audit-2026-08-17.md) | 0016 发布前代码、schema gate、线上 marker/index 只读结果和非事务性 DDL 发布/止损顺序；发布后结果见当前 release 验收文档 |
| [`release/0995f7c-production-acceptance-2026-08-18.md`](release/0995f7c-production-acceptance-2026-08-18.md) | `0995f7c` 生产切换、停机边界、新旧服务共存和真实业务未验收边界 |
| [`release/candidate-9ca3a89-redis-session-ttl-audit-2026-08-18.md`](release/candidate-9ca3a89-redis-session-ttl-audit-2026-08-18.md) | `9ca3a89` Redis 会话 TTL 审计工具的独立上传、生产 preflight、临时 smoke 和 ACL fail-closed 证据；未切换生产 |
| [`release/candidate-38bc553-local-build-2026-08-18.md`](release/candidate-38bc553-local-build-2026-08-18.md) | `38bc553` 微信身份边界修复后的候选构建、产物 checksum、隔离 smoke、无损切换和未完成业务边界 |
| [`release/c26e696-production-acceptance-2026-08-18.md`](release/c26e696-production-acceptance-2026-08-18.md) | 历史 `c26e696` 服务端生产切换、真实 env preflight、隔离 smoke、新旧服务共存和日志边界；仅用于追溯 |
| [`release/b7c9451-production-acceptance-2026-08-19.md`](release/b7c9451-production-acceptance-2026-08-19.md) | 历史 `b7c9451` P0 日志关联门禁生产切换、启动模式、内外网运行层和旧服务共存验收；不等同真实业务完成 |
| [`release/current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md`](release/current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md) | 历史 `b7c9451` 数据库恢复后的 readiness、双服务共存和 Redis 会话 TTL 未验证边界 |
| [`release/current-b7c9451-config-gates-observation-2026-08-19-1155.md`](release/current-b7c9451-config-gates-observation-2026-08-19-1155.md) | 历史 `b7c9451` 生产模式、非敏感业务 gate 和支付/报告关闭边界 |
| [`release/current-c26-p0-business-observation-2026-08-18-2340.md`](release/current-c26-p0-business-observation-2026-08-18-2340.md) | 历史 `c26e696` 重启后 P0 日志只读观察；患者读取/同步同链证据通过，其他业务域仍缺证据，不等同真机验收 |
| [`release/current-c26-p0-business-observation-2026-08-18-2349.md`](release/current-c26-p0-business-observation-2026-08-18-2349.md) | 历史 `c26e696` 新 HTTP 完成门禁下的日志观察；微信登录、患者读取/同步同链通过，其他业务域仍缺证据 |
| [`release/current-c26-runtime-and-p0-observation-2026-08-18-2354.md`](release/current-c26-runtime-and-p0-observation-2026-08-18-2354.md) | 误重启后的历史 `c26e696` 运行层、双服务共存和 P0 日志门禁复核；不等同真机业务验收 |
| [`release/candidate-b7c9451-p0-correlation-gate-2026-08-18.md`](release/candidate-b7c9451-p0-correlation-gate-2026-08-18.md) | `b7c9451` P0 同 trace/request 证据门禁候选的远端 checksum、真实生产 preflight、隔离 runtime smoke 和未切换边界 |
| [`release/candidate-387b4a3-http-success-gate-2026-08-18.md`](release/candidate-387b4a3-http-success-gate-2026-08-18.md) | `387b4a3` HTTP 2xx 完成门禁候选的远端 checksum、真实生产 preflight、隔离 runtime smoke 和未切换边界 |
| [`release/687690e-redis-session-ttl-observation-2026-08-18.md`](release/687690e-redis-session-ttl-observation-2026-08-18.md) | 历史 `687690e` 的 Redis 会话 TTL 只读审计结果；应用账号无 `SCAN` 权限，TTL 保持未验证，不扩大常驻 ACL |
| [`release/candidate-37016c4-smoke-log-hardening-2026-08-18.md`](release/candidate-37016c4-smoke-log-hardening-2026-08-18.md) | `37016c4` smoke 日志原始异常消息修正、产物 checksum、生产 preflight 和公网 runtime smoke；候选未切换线上 |
| [`release/4ae2a31-production-acceptance-2026-08-18.md`](release/4ae2a31-production-acceptance-2026-08-18.md) | 历史 `4ae2a31` 生产切换证据；仅用于追溯，不作为当前线上基线 |
| [`release/0995f7c-current-runtime-observation-2026-08-18-0254.md`](release/0995f7c-current-runtime-observation-2026-08-18-0254.md) | `0995f7c` 当前 release、双服务监听、公网 live/ready 和 MySQL/Redis/schema 的只读运行时快照 |
| [`release/0b6f38f-production-acceptance-2026-08-17.md`](release/0b6f38f-production-acceptance-2026-08-17.md) | 历史 `0b6f38f` 原子切换、候选 checksum、真实 env preflight、公网 6/6 readiness 和新旧服务共存证据 |
| [`release/6d58c9c-production-acceptance-2026-08-17.md`](release/6d58c9c-production-acceptance-2026-08-17.md) | `6d58c9c` 生产切换、0016 migration、候选运行边界和未完成真机业务证据 |
| [`release/5c4e7cf-production-acceptance-2026-08-17.md`](release/5c4e7cf-production-acceptance-2026-08-17.md) | `5c4e7cf` MySQL 只读连接恢复、候选 checksum、生产切换、公网 6/6 readiness 和旧服务共存证据 |
| [`release/bab0ce2-production-acceptance-2026-08-17.md`](release/bab0ce2-production-acceptance-2026-08-17.md) | `bab0ce2` 探针日志增强、候选 checksum、真实生产 preflight、原子切换、公网 6/6 readiness 和旧服务共存证据 |
| [`release/ca5a372-production-acceptance-2026-08-17.md`](release/ca5a372-production-acceptance-2026-08-17.md) | `ca5a372` 认证顺序修复、候选 checksum、生产 preflight、公网认证边界和旧服务共存证据 |
| [`release/527d163-production-acceptance-2026-08-17.md`](release/527d163-production-acceptance-2026-08-17.md) | `527d163` 持久化瞬态故障安全日志增强、候选 checksum、生产 preflight、公网 6/6 readiness 和旧服务共存证据 |
| [`release/131fb5a-production-acceptance-2026-08-17.md`](release/131fb5a-production-acceptance-2026-08-17.md) | `131fb5a` 持久化错误码标准化、候选隔离 smoke、原子切换、公网 6/6 readiness 和旧服务共存证据 |
| [`release/public-readiness-cache-audit-2026-08-16.md`](release/public-readiness-cache-audit-2026-08-16.md) | 公网 readiness 瞬时差异、内网绑定地址和健康探针 no-store 候选修复证据 |
| [`release/candidate-b4dc33b-production-smoke-2026-08-16.md`](release/candidate-b4dc33b-production-smoke-2026-08-16.md) | `b4dc33b` 生产 env preflight、bundle checksum、临时端口 runtime smoke 和旧服务共存收尾证据 |
| [`release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md`](release/candidate-3dc6f5f-preproduction-smoke-2026-08-16.md) | `3dc6f5f` 真实生产依赖 preflight、临时端口 runtime smoke、trace 关联修复和旧服务共存证据 |
| [`release/candidate-3129148-preproduction-smoke-2026-08-16.md`](release/candidate-3129148-preproduction-smoke-2026-08-16.md) | `3129148` Provider smoke 会话边界、真实依赖 preflight、临时端口 runtime smoke 和旧服务共存证据 |
| [`release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md`](release/candidate-d8f14f1-preproduction-smoke-2026-08-16.md) | `d8f14f1` 患者归属门禁、真实依赖 preflight、临时端口 runtime smoke 和旧服务共存证据 |
| [`release/candidate-d177991-production-acceptance-2026-08-16.md`](release/candidate-d177991-production-acceptance-2026-08-16.md) | `d177991` 候选 checksum、生产 env、原子切换、公网 `/api/v2` 和旧服务共存验收 |
| [`release/current-d177991-observability-acceptance-2026-08-16.md`](release/current-d177991-observability-acceptance-2026-08-16.md) | `d177991` 切换窗口的历史业务日志边界、MySQL/Schema 瞬态故障和后续验收门禁 |
| [`release/candidate-a11f117-preproduction-smoke-2026-08-16.md`](release/candidate-a11f117-preproduction-smoke-2026-08-16.md) | `a11f117` 持久化只读探针有界重试、真实生产 env preflight、临时 API smoke 和现网隔离证据 |
| [`release/a11f117-production-acceptance-2026-08-16.md`](release/a11f117-production-acceptance-2026-08-16.md) | `a11f117` 实际生产切换、内外网 health、启动日志、新旧服务共存和业务验收限制 |
| [`release/production-coexistence-readonly-audit-2026-08-16.md`](release/production-coexistence-readonly-audit-2026-08-16.md) | 2026-08-16 生产新旧服务、MySQL/Redis、Worker、权限和公网 v2 的只读快照 |
| [`release/current-public-readonly-smoke-2026-08-17.md`](release/current-public-readonly-smoke-2026-08-17.md) | 2026-08-17 公网 live/ready/ping 和病历关闭边界的只读复核；不包含会话、Provider 或真机验收 |
| [`release/current-public-readonly-smoke-2026-08-18-1936.md`](release/current-public-readonly-smoke-2026-08-18-1936.md) | 2026-08-18 19:36 CST 重启后公网 live/ready/ping、未登录认证和 SSH 证据边界复核 |
| [`release/current-runtime-coexistence-readonly-2026-08-18-2136.md`](release/current-runtime-coexistence-readonly-2026-08-18-2136.md) | 2026-08-18 21:36 CST 重启后当前 release、新旧监听和公网 ready 的只读复核 |
| [`release/current-runtime-coexistence-readonly-audit-2026-08-18-2322.md`](release/current-runtime-coexistence-readonly-audit-2026-08-18-2322.md) | 2026-08-18 23:22 CST 重启后 `c26e696`、新旧监听、内外网 live/ready 和业务证据边界复核 |
| [`release/current-public-readiness-stability-2026-08-17.md`](release/current-public-readiness-stability-2026-08-17.md) | `ed250ec` smoke 源码对公网 `/api/v2` 的 6 次 readiness 连续采样证据；不代表该提交已部署 |
| [`release/current-server-p0-observation-2026-08-17.md`](release/current-server-p0-observation-2026-08-17.md) | `3ab0a6c` 切换后、15:00 发布前服务器生产模式、双服务共存、依赖 readiness 和预约/门诊费用业务事件缺失的历史只读观察 |
| [`release/production-coexistence-readonly-audit-2026-08-17.md`](release/production-coexistence-readonly-audit-2026-08-17.md) | 2026-08-17 SSH 只读核对新 Bun `18081`、旧 Python `8001`、systemd 状态和 release 指针；不包含业务验收 |
| [`release/current-production-observability-audit-2026-08-17.md`](release/current-production-observability-audit-2026-08-17.md) | 2026-08-17 当前 API 启动 capability、MySQL/schema 探针抖动、微信登录失败/恢复和患者同步日志复核 |
| [`release/restart-coexistence-readonly-audit-2026-08-18.md`](release/restart-coexistence-readonly-audit-2026-08-18.md) | 2026-08-18 重启后新旧服务监听、内外网探针和内网/公网路径边界复核 |
| [`release/miniprogram-readonly-acceptance-candidate-2026-08-18.md`](release/miniprogram-readonly-acceptance-candidate-2026-08-18.md) | 历史 `b451cc6` 小程序候选的只读验收组合和停止条件；当前候选请改读 [`candidate-cde7bc9-local-build-2026-08-21.md`](release/candidate-cde7bc9-local-build-2026-08-21.md) |
| [`release/miniprogram-readonly-business-acceptance-2026-08-19.md`](release/miniprogram-readonly-business-acceptance-2026-08-19.md) | 历史 `c26e696` 窗口的模拟器与服务端日志观察；不替代当前 `c8eef370` + `f488c6f3` 真机/Provider 验收 |
| [`release/miniprogram-api-prefix-hardening-2026-08-19.md`](release/miniprogram-api-prefix-hardening-2026-08-19.md) | 2026-08-19 小程序未知 API 前缀缓存回退、刷新 404 防护和运行包证据 |
| [`release/restart-coexistence-readonly-audit-2026-08-19.md`](release/restart-coexistence-readonly-audit-2026-08-19.md) | 2026-08-19 重启后新旧服务共存、公网健康探针、全仓门禁和业务未完成边界复核 |
| [`release/readonly-business-contract-audit-2026-08-18.md`](release/readonly-business-contract-audit-2026-08-18.md) | 预约历史、爽约记录和门诊费用只读业务的不变量、日志闭环和当前测试证据 |
| [`release/current-live-readonly-audit-2026-08-17.md`](release/current-live-readonly-audit-2026-08-17.md) | 2026-08-17 当前 release、内外网 ready、旧新服务共存和低敏业务日志关键词的只读核对 |
| [`release/bf67b96-production-acceptance-2026-08-17.md`](release/bf67b96-production-acceptance-2026-08-17.md) | `bf67b96` 六个 release artifact、候选隔离 smoke、原子切换、旧新服务共存和日志聚合验证 |
| [`release/candidate-3ab0a6c-preproduction-smoke-2026-08-17.md`](release/candidate-3ab0a6c-preproduction-smoke-2026-08-17.md) | `3ab0a6c` 患者目录空快照安全边界、真实生产 env preflight、隔离端口 runtime smoke 和旧服务共存证据 |
| [`release/3ab0a6c-production-acceptance-2026-08-17.md`](release/3ab0a6c-production-acceptance-2026-08-17.md) | `3ab0a6c` 原子切换、内外网运行时、6/6 readiness、旧服务共存和业务未验收边界 |
| [`release/daee96d-production-acceptance-2026-08-17.md`](release/daee96d-production-acceptance-2026-08-17.md) | `daee96d` 候选 checksum、真实生产 preflight、原子切换、公网 6/6 readiness、旧服务共存与业务未验收边界 |
| [`release/systemd-narrow-permission-acceptance-2026-08-16.md`](release/systemd-narrow-permission-acceptance-2026-08-16.md) | 新 API 最小 systemd NOPASSWD 规则的安装、校验和旧服务共存证据 |
| [`release/observability-error-contract-smoke-2026-08-16.md`](release/observability-error-contract-smoke-2026-08-16.md) | `f2c6d99` 候选 release 的 production env 隔离 smoke、中文错误契约和清理证据；不代表公网切换 |
| [`release/miniprogram-static-navigation-acceptance.md`](release/miniprogram-static-navigation-acceptance.md) | 原生小程序静态院内导航页面验收 |
| [`release/miniprogram-static-hospital-list-acceptance.md`](release/miniprogram-static-hospital-list-acceptance.md) | 原生小程序静态医院卡片、预约前置和路线未开放边界验收 |
| [`release/miniprogram-static-official-account-acceptance.md`](release/miniprogram-static-official-account-acceptance.md) | 原生小程序静态公众号说明页和关注事实边界验收 |
| [`release/miniprogram-static-feedback-acceptance.md`](release/miniprogram-static-feedback-acceptance.md) | 原生小程序反馈帮助、客服电话和真实提交边界验收 |
| [`release/miniprogram-devtools-runtime-acceptance-2026-08-16.md`](release/miniprogram-devtools-runtime-acceptance-2026-08-16.md) | 原生小程序 `dist/` 模块缺失、开发者工具配置修复和模拟器复核证据 |
| [`release/miniprogram-runtime-package-verification-2026-08-17.md`](release/miniprogram-runtime-package-verification-2026-08-17.md) | 报告目录/就诊人页面 JS 缺失问题的构建后运行包验证和未覆盖边界 |
| [`release/payment-acceptance.md`](release/payment-acceptance.md) | 微信支付、回调、查单和真机验收 |

## 契约与迁移

| 文档 | 用途 |
| --- | --- |
| [`provider-contract-v1.md`](provider-contract-v1.md) | 微信、众阳和支付 adapter 边界 |
| [`provider-document-intake.md`](provider-document-intake.md) | 新 provider 文档的接收、标准化、冻结和验收流程 |
| [`provider-contract-template.md`](provider-contract-template.md) | 收到新文档后逐 endpoint 填写请求、响应、错误、状态、权限和验收证据的模板 |
| [`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md) | 本轮挂号登记、支付挂号和外部退款文档的 SHA-256、字段、状态、依赖缺口和冻结决策；当前为 `normalized` |
| [`provider-intake/2026-08-16-outpatient-settlement-insurance.md`](provider-intake/2026-08-16-outpatient-settlement-insurance.md) | 门诊结算、支付查单、关单、取消结算和医保回写材料的指纹、流程顺序和 SET-01 至 SET-08 实现缺口；当前为 `normalized` |
| [`provider-intake/2026-08-17-legacy-document-discovery.md`](provider-intake/2026-08-17-legacy-document-discovery.md) | 旧项目文档目录中此前未登记的门诊待支付、基础目录、门诊结算、医保规范和微信医保材料；含内部组件文档排除说明；当前为 `normalized` |
| [`medical-insurance-contract-v1.md`](medical-insurance-contract-v1.md) | 医保金额、状态和回写契约 |
| [`appointment-write-contract-v1.md`](appointment-write-contract-v1.md) | 预约写入/锁号/取消的冻结边界 |
| [`migration/payment-contract.md`](migration/payment-contract.md) | 门诊支付、挂号医保支付、微信预支付和 Provider 支付挂号状态的边界 |
| [`migration/api-matrix.md`](migration/api-matrix.md) | 旧接口到新接口的迁移矩阵 |
| [`migration/legacy-api-endpoint-inventory.md`](migration/legacy-api-endpoint-inventory.md) | 旧 FastAPI 与旧小程序 provider endpoint 的逐项快照、状态和业务边界 |
| [`migration/data-map.md`](migration/data-map.md) | 旧数据和新表/领域字段的映射 |
| [`migration/legacy-inventory.md`](migration/legacy-inventory.md) | 旧项目能力清单和未迁移风险 |
| [`migration/legacy-page-matrix.md`](migration/legacy-page-matrix.md) | 64 个旧端页面的逐页状态、风险和下一步边界 |
| [`migration/native-page-migration-status.md`](migration/native-page-migration-status.md) | 以 `app.json` 为事实源的 14 个原生页面业务状态、边界和下一步门禁 |
| [`migration/medical-record-and-hospital-boundary.md`](migration/medical-record-and-hospital-boundary.md) | 门诊病历、住院、医院列表和院内导航的旧接口审计与 contract 边界 |
| [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md) | 门诊就诊记录目录的旧字段差异、候选 contract、provider 确认问题和实现门禁 |
| [`migration/directory-contract-diff-2026-08-17.md`](migration/directory-contract-diff-2026-08-17.md) | 2.1.9 科室基础目录与 2.1.13 院内用户资料和当前预约/患者域的差异、敏感字段和实现门禁 |
| [`migration/convenience-service-boundaries.md`](migration/convenience-service-boundaries.md) | 便民服务 13 个旧路由、旧表风险、新领域边界、幂等、日志和验收门禁 |
| [`migration/health-calculator-contract-draft.md`](migration/health-calculator-contract-draft.md) | BMI/血压旧端规则审计、临床确认项、版本化规则和迁移门禁 |
| [`migration/health-knowledge-content-mapping.md`](migration/health-knowledge-content-mapping.md) | 健康知识旧表映射、版本化导入、审核发布和患者端路由准入边界 |
| [`migration/health-knowledge-import-runbook.md`](migration/health-knowledge-import-runbook.md) | 脱敏 bundle 的只读检查、审核、staging 事务导入和失败处理顺序 |
| [`adr/0004-health-knowledge-content-boundary.md`](adr/0004-health-knowledge-content-boundary.md) | 健康知识内容审核、撤回、免责声明和 AI/自测隔离决策 |
| [`release/health-knowledge-readiness-audit-2026-08-20.md`](release/health-knowledge-readiness-audit-2026-08-20.md) | 当前健康知识代码、内容输入、发布证据和未挂载状态审计 |
| [`release/health-knowledge-service-input-boundary-audit-2026-08-21.md`](release/health-knowledge-service-input-boundary-audit-2026-08-21.md) | 健康知识 service 分类、关联、ID、症状数组的运行时输入门禁和未挂载边界 |
| [`migration/patient-center-and-external-entry-boundaries.md`](migration/patient-center-and-external-entry-boundaries.md) | 个人资料、绑卡、协议、签名、订阅、WebView、医院列表和采血预约的旧行为与安全边界 |
| [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md) | 患者查档、建档、绑卡、协议、幂等、超时恢复和 provider 待确认问题；当前写入路由保持关闭 |
| [`migration/user-profile-contract.md`](migration/user-profile-contract.md) | 普通个人资料的字段边界、版本并发、owner 隔离、头像/实名排除项和验收门禁 |
| [`migration/legacy-client-infrastructure-boundaries.md`](migration/legacy-client-infrastructure-boundaries.md) | 旧端请求封装、WebSocket、Pinia 状态、复用组件、静态配置和资源的迁移边界 |
| [`migration/static-and-closed-feature-parity.md`](migration/static-and-closed-feature-parity.md) | 静态页面、旧端假保存和未注册能力的真值分类，避免把未来能力误记成旧业务迁移缺口 |
| [`migration/infrastructure-and-operations-boundaries.md`](migration/infrastructure-and-operations-boundaries.md) | 旧 Redis、MongoDB、APScheduler、文件资源、AI/WebSocket、Admin/RBAC 与新服务替代状态 |

## 维护规则

1. 新增业务能力时，先更新 API contract、架构文档、日志事件和验收手册，再写实现。
2. 新增环境变量时，只在 `.env.example` 和对应运行手册记录变量名/用途，真实值通过 SSH 或密钥管理传输。
3. 新增日志事件时，必须说明可记录字段和禁止字段；Pino redact 只是兜底，不是记录敏感数据的许可。
4. 真实 provider、生产 schema、公网 Nginx 和真机验收必须分别保存证据，不能用单元测试代替。
5. 旧服务仍由原项目和 `8001` 管理；新服务只使用 `api-v2` systemd、`18081` 和 `/api/v2` 公网路由。
6. 新增或删除原生页面后必须运行 `pnpm migration:audit`；页面注册、TypeScript 源码、构建生成的 JavaScript 和迁移台账必须同步。
7. 新增或移动 Markdown 文档后必须运行 `pnpm docs:audit`；本地链接必须指向仓库内现有文件，外部链接不由该门禁代替联网验收。
8. 新增日志事件或修改事件名后必须运行 `pnpm logging:audit`；静态事件必须登记在 `docs/logging.md`，动态事件必须说明稳定前缀或明确事件表边界。

