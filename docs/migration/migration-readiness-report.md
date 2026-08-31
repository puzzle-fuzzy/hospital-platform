> **当前候选同步（2026-08-28）**：服务端 release `5738a71e0bcddaa8849106754baf5b296427bed7`；本地小程序 live/pending 运行包 sourceRevision `ce1c2179b57fe2783066b51f8621220224982928`；历史段落只作追溯。

# 全项目迁移 readiness 报告说明

> 本文说明 `pnpm migration:readiness` 的数据来源和判定边界。报告用于广度迁移交接，不是上线批准单，也不替代 Provider、公网、真机或临床审核证据。

> **当前运行事实（2026-08-28）**：最新小程序运行相关源码和本地 live/pending 运行输入均为 `ce1c2179b57fe2783066b51f8621220224982928`，共 38 个页面、4 个原生 Tab；`runtime:verify` 和 pending 校验通过。当前候选的小程序类型检查、352 项小程序测试、全仓 9 个 workspace 类型检查与测试、文档断链审计均通过；全仓聚合构建仅因微信开发者工具锁定 `apps/miniprogram/dist` 未完成，候选已保存在 pending，不能把本地校验写成线上部署。患者显式切换、预约历史/爽约、门诊费用只读和共享会话边界继续按已确认 contract 处理；临床/患者写入/外部/Provider 页面、支付医保、预约写入、实时就诊和真机证据仍保持各自阻断状态。当前候选检查点见 [`../migration/current-execution-checkpoint-2026-08-28.md`](../migration/current-execution-checkpoint-2026-08-28.md)。

## 生成方式

在仓库根目录执行：

```bash
pnpm migration:readiness
```

该命令只读取新项目仓库中的页面台账、原生小程序 `app.json`、首页/“我的”入口广度审计、只读域闭环清单、Provider 接收文档和本地运行包 `build-info.json`。它不会访问旧服务、数据库、Redis、Provider，也不会修改 `dist/` 或线上服务。

未开放入口的执行旁路另由 `tools/surface-only-closure-audit.mjs` 做静态审计，
并通过 `bun test tools` 纳入全量门禁。它把 15 个 `surface-only` 目标固定为 14
个关闭态页面工厂和 1 个本地安全数值子集，拒绝页面或共享工厂直接调用 HTTP、
Provider、支付、微信登录、外部小程序或 WebView；该门禁仍不等于正式 contract 已确认。

如需把当前 live/pending 小程序运行包来源不一致视为命令失败，执行：

```bash
pnpm migration:readiness -- --strict
```

`--strict` 只增加运行包来源一致性门禁；它不会把 Provider 未确认、真机未验收或高风险写入自动判定为完成。

## 报告字段

| 字段 | 来源 | 可以说明什么 | 不能说明什么 |
| --- | --- | --- | --- |
| `entryCoverage.legacy` | `legacy-page-catalog.ts`、`feature-navigation.ts` | 64 个旧页面是否都有迁移状态和固定落点 | 页面业务是否已经实现、接口是否可用 |
| `entryCoverage.legacy.domainCoverage` | `legacy-page-catalog.ts`、FeatureKey 门 | 按首页、就诊、互联网医院、预约、患者、健康、用户七个旧端业务域查看页面数、阻断数、状态分布和下一阶段 | 业务域内的页面数不等于业务功能完成数；`进入真实验收` 仍需要真实链路证据，`入口已覆盖，能力待契约/证据` 不能越过 FeatureKey 门 |
| `entryCoverage.frozenBoundary` | `tools/migration-boundary-catalog.mjs`、`migration-boundary-audit.mjs` | 34 个冻结入口 gate 的 FeatureKey、统一状态页落点、contract 家族、旧页面/action 映射和材料数量是否一致；同时覆盖二级页面状态调用 | 不代表任何 Provider、临床、支付、患者写入或外部会话已经开放 |
| `entryCoverage.frozenBoundary.batchCoverage` | 冻结入口 gate 的 `migrationBatch` 字段 | A–F 六个业务批次各自覆盖了多少 gate、旧页面和 action-only 入口，并能发现未分配批次 | 不代表批次内任何业务已经通过真实环境或真机验收 |
| `contractIntake` | `tools/migration-contract-intake-catalog.mjs` | C/D/E 的材料入口、必备证据、实现顺序和未确认禁止项是否覆盖全部 23 个已暴露 FeatureKey | `passed=true` 只代表材料清单结构完整；三个批次的 `businessReady` 仍必须为 `false` |
| `entryCoverage.nativePageCount` | `apps/miniprogram/src/app.json` | 原生小程序注册了多少页面 | 微信开发者工具是否加载了这些页面 |
| `migration:breadth:audit` | `tools/migration-breadth-audit.mjs` | 首页和“我的”全部可见 action 是否都有固定分发、状态页 key 和主 Tab 落点 | 不代表对应 Provider、临床或支付业务已经开放 |
| `migrationBreadth` | `migration-breadth-audit.mjs` 的结果 | 入口广度审计是否已经纳入总结构准入；任一可见 action 缺少固定分发，或当前 38 个页面的 WXML 事件缺少 TS 方法/共享页面工厂注册时，`structuralAuditPassed` 直接为 `false` | 不代表入口背后的 Provider、临床或支付业务已经完成 |
| `readOnly` | `read-only-domain-catalog.mjs` | 就诊人、预约、报告、门诊费用、普通资料五个低风险域的页面/API/实现/日志/文档是否断链，并给出 `read-only`、`read-model-sync` 或 `read-write` 操作边界 | Provider 返回、生产流量或真机链路是否成功 |
| `providerIntake` | `docs/provider-intake/*.md` | Provider 材料是否登记、状态是否为 `normalized` 或 `confirmed` | `normalized` 不等于接口确认；高风险业务仍需独立 contract |
| `clinicalContract` | `clinical-domain-catalog.mjs`、临床准入文档、结构化准入卡片和 API 源码 | 门诊记录、住院、医生关系、电子导诊单四个 C 批次临床域是否仍独立、未注册且没有误加通用路由；我的问诊属于 E 批次外部会话 | 不会因为材料登记就自动生成临床页面或接口 |
| `healthContent` | 健康知识路由、约定的本机审核 bundle 证据目录和发布状态元数据 | 健康百科代码是否具备、正式审核 bundle 是否已经进入当前证据目录 | 不代表 bundle 已通过临床审核、已导入 staging、已发布或已完成真机验收 |
| `runtime` | live/pending `build-info.json` 和当前运行输入指纹；发布前比较 pending/live，发布后比较 live/当前来源 | 当前开发者工具目录和待发布候选的源码来源是否一致 | 当前微信设备一定运行了哪个版本；锁定目录时必须保留现场证据 |
| `deviceEvidence` | 当前运行包（优先 pending，否则 live）的完整 `sourceRevision` 匹配 `docs/release/device-evidence-<commit>-pending.json` | 当前候选的真机证据域数量、状态和候选指纹是否匹配 | `pending` 不等于失败；清单结构通过也不等于真实业务成功 |
| `migrationQueue` | 旧页面状态、只读域、临床准入、运行包和真机证据 | A-F 六个业务批次当前停在哪个门槛、下一动作和停止条件 | 不会自动打开状态页，也不会把 contract 缺失解释成业务完成 |
| `businessCompletion` | 固定 fail-closed 判定 | 明确当前不能声称全项目业务完成 | 不会因为页面或状态页存在就伪造完成结论 |

## 当前基线（2026-08-27）

当前报告应体现以下事实：

- 旧页面共 64 个，其中 `replaced=8`、`partial=23`、`surface-only=25`、`blocked-payment=7`、`excluded=1`；使用条款已迁移为原文只读页，健康自测只开放 BMI/血压安全数值子集，采血预约、我的快递、患者签名展示和消息订阅展示只开放低风险子集，但协议版本、同意记录、撤回和审计仍属于患者 contract 阻断能力；Provider、临床和外部入口已先进入安全壳，真实能力仍关闭。
- 旧端七个业务域已按台账拆开汇总：互联网医院 2 页/0 页面阻断、患者 7 页/0 页面阻断、健康 34 页/5 页面阻断、就诊 1 页/0 页面阻断、首页 2 页/0 页面阻断、用户 8 页/0 页面阻断、预约 10 页/2 页面阻断；其中带有 FeatureKey 契约门的互联网医院、患者和用户域标记为“入口已覆盖，能力待契约/证据”，健康和预约按页面阻断标记为“并行补齐 contract”，只有不带契约门的首页和就诊域进入真实验收。页面阻断数不等于业务完成数，不再用一个页面的修复代表全项目进度。
- 34 个冻结入口 gate 已由 `tools/migration-boundary-catalog.mjs` 统一登记，共覆盖 39 个旧页面入口和 13 个 action-only 引用（合计 52 个入口来源）；另有 31 次二级/主入口状态页调用、27 个对应 FeatureKey 纳入调用审计。每个 gate 都有独立 contract 家族、七类页面状态、通用/特有材料和关闭能力。readiness 的 `entryCoverage.frozenBoundary.passed=true` 只表示入口边界没有漂移，不表示这些业务可以调用 Provider。
- gate 批次覆盖当前为 A `4/3/2`、B `0/0/0`、C `4/4/0`、D `11/22/1`、E `8/3/6`、F `7/7/4`（依次为 gate/旧页面/action-only）；B 的 0 是因为健康内容由独立审核 bundle 队列控制，不允许把内容发布误归入其它业务 gate。`consultation` 属于外部问诊会话，按 `external-session` 归入 E，不计入临床只读 C。
- C/D/E 契约材料入口覆盖 23 个已暴露 FeatureKey，当前均为 `awaiting-formal-contract`；D 的命令领域基础另外覆盖尚未暴露入口的 `patient-address` 计划能力。`pnpm migration:contract:audit` 还会输出逐入口 `featureIntakeRows`，列出旧路径/action、契约族、去重后的材料要求和禁止能力，但不把结构通过转换成业务可用。
- 原生小程序注册 38 个页面，四个主入口继续使用微信原生 `tabBar`；23 个临床、患者、外部和预约 Provider 入口当前为 `surface-only`。
- 五个低风险域的仓库闭环结构审计通过，但只表示文件、日志和文档没有断链；其中患者目录是受控读模型同步，普通资料包含版本化 PUT，不能把它们误读为纯读取。
- 首页和“我的”共 31 个可见 action 已通过 `pnpm migration:breadth:audit`；每个 action 都有固定分发分支，阻断能力统一落到已登记的 `FeatureKey`，主 Tab 仍由 `app.json` 单一声明；另外 40 个已注册页面的 WXML 事件均能找到对应 TS 方法或共享页面工厂。该结果已经纳入 `migration:readiness` 的 `migrationBreadth` 字段和 `structuralAuditPassed` 结构准入，后续入口回退会直接阻断总报告。
- Provider 接收材料为 4 份、当前均为 `normalized`，确认数为 0；挂号写入、支付、医保、退款和 HIS 回写不能据此开放。
- live `dist` 当前来源为 `ce1c2179b57fe2783066b51f8621220224982928`，38 个页面已通过 `runtime:verify`；发布后 pending 目录已清理，readiness 以 live `build-info.json` 和当前运行输入指纹比对。当前运行包包含 38 个页面、今日预约摘要、健康自测安全数值子集、统一当前就诊人上下文和共享患者会话清理、我的问诊患者作用域、跨域页面外壳、协议原文只读入口、采血预约真实空态和锦旗/表扬信稳定关闭态、公共日期窗口边界、微信资料拒绝后的设置页重试、选择页刷新并发门禁、我的快递三态、报告目录失效事件静默丢弃、预约排班/历史底层请求边界以及健康百科和报告详情迁移台账映射，并修复 App.onLaunch 全局资料初始化时序；小程序回归为 `356 pass / 0 fail / 3826 expect()`。
- 当前 9 个真机证据域全部为 `pending`；候选指纹与 pending 运行包一致，但真实页面、客户端 requestId 和服务端同链日志尚未形成通过证据。
- 未开放入口关闭态审计通过：15 个目标页中 14 个使用共享页面工厂、1 个为健康自测本地安全数值子集；页面和共享工厂未发现直连 HTTP、Provider、支付、微信登录、外部小程序或 WebView 旁路。该结果只证明 fail-closed 结构，不改变 C/D/E/F contract 阻断状态。
- 关闭态审计器已在 `2580a1fe` 修正模板插值扫描边界：模板普通文案仍不参与调用匹配，`${...}` 内的可执行表达式不会被剥离；当前 `ce1c217` 修复 App.onLaunch 全局资料初始化时序，不改变任何业务放行状态。
- 关闭态审计器随后在 `cbb43040` 分离导入路径扫描，避免集中 API client 的模块字符串因统一剥离而漏报；真实导入会被拒绝、注释中的伪导入不会误报，该门禁修正同样不改变运行包或业务放行状态。
- 临床四域合同门禁通过只表示它们仍保持 `normalized / unregistered`；任何正式 Provider 材料到达后必须逐域进入 contract、adapter、domain 和 API 实现，不得删除门禁或共用 `/clinical`。

四域的结构化准入卡片位于 [`clinical-read-models-contract-gate.json`](../provider-intake/clinical-read-models-contract-gate.json)。它逐域记录 Provider contract、成功/空/拒绝/超时样例、owner 映射、字段白名单和脱敏规则的状态；当前只能是 `pending` 或 `missing`。这份卡片不是业务响应 fixture，不能被小程序或 API 读取；任何字段进入 `confirmed` 前必须先完成正式 contract 评审并同步独立域实现。

报告中的 `codeReadyDomainCount` 和 `realEvidenceReadyDomainCount` 必须分开读取：前者表示仓库结构和代码闭环通过，后者只在真机证据清单中对应域全部达到 `passed` 时增加。两者都不等于支付、医保或其它阻塞域已经开放。

`migrationQueue` 固定包含六个批次：A 安全只读真实取证、B 健康内容发布、C 临床只读契约、D 患者与便民写入、E 外部入口与实时能力、F 支付/医保/HIS 回写。A、B 可以在已有代码基础上并行收集真实证据；C-E 先收集各自 contract；F 始终最后处理。B 批次的 `reviewedBundlePresent` 只表示约定本机证据目录中存在文件，仍必须完成 bundle 校验、staging、发布/撤回和真机验收。旧库源快照的聚合质量审计见 [`health-knowledge-source-audit-2026-08-25.md`](health-knowledge-source-audit-2026-08-25.md)，审核门队列见 [`health-knowledge-review-queue.md`](health-knowledge-review-queue.md)，两者不改变 `reviewedBundlePresent` 的判定。队列中的 `nextAction` 和 `stopCondition` 是执行提示，不是把状态页变成业务页的授权。

`healthContent.sourceSnapshotStatus` 只表示旧源快照是否缺失、已完成结构审计或格式无效；`healthContent.reviewQueue` 只输出不含正文的审核门和聚合数量。源快照存在、结构审计通过或审核 bundle 文件存在，都不能直接使 `businessReady` 变为 true。

## 与后续迁移的关系

readiness 报告解决的是“全项目现在覆盖到哪里、哪些地方还缺 contract、运行包是否对齐”的可见性问题。业务推进仍按 [`full-migration-handoff-2026-08-25.md`](full-migration-handoff-2026-08-25.md) 执行：先完成安全只读域和健康内容的真实证据，再分别收集临床、患者写入、外部入口以及最后的支付/医保 contract。

任何新域都必须同时具备页面、API、领域模型、Provider 适配、脱敏与错误边界、低敏日志、文档、测试和对应的公网/真机证据，才能从阻断状态进入真实业务验收。
