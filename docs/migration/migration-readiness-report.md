# 全项目迁移 readiness 报告说明

> 本文说明 `pnpm migration:readiness` 的数据来源和判定边界。报告用于广度迁移交接，不是上线批准单，也不替代 Provider、公网、真机或临床审核证据。

## 生成方式

在仓库根目录执行：

```bash
pnpm migration:readiness
```

该命令只读取新项目仓库中的页面台账、原生小程序 `app.json`、只读域闭环清单、Provider 接收文档和本地运行包 `build-info.json`。它不会访问旧服务、数据库、Redis、Provider，也不会修改 `dist/` 或线上服务。

如需把当前 live/pending 小程序运行包来源不一致视为命令失败，执行：

```bash
pnpm migration:readiness -- --strict
```

`--strict` 只增加运行包来源一致性门禁；它不会把 Provider 未确认、真机未验收或高风险写入自动判定为完成。

## 报告字段

| 字段 | 来源 | 可以说明什么 | 不能说明什么 |
| --- | --- | --- | --- |
| `entryCoverage.legacy` | `legacy-page-catalog.ts`、`feature-navigation.ts` | 64 个旧页面是否都有迁移状态和固定落点 | 页面业务是否已经实现、接口是否可用 |
| `entryCoverage.legacy.domainCoverage` | `legacy-page-catalog.ts` | 按首页、就诊、互联网医院、预约、患者、健康、用户七个旧端业务域查看页面数、阻断数、状态分布和下一阶段 | 业务域内的页面数不等于业务功能完成数；`进入验收` 仍需要真实链路证据 |
| `entryCoverage.nativePageCount` | `apps/miniprogram/src/app.json` | 原生小程序注册了多少页面 | 微信开发者工具是否加载了这些页面 |
| `readOnly` | `read-only-domain-catalog.mjs` | 就诊人、预约、报告、门诊费用、普通资料五个低风险域的页面/API/实现/日志/文档是否断链，并给出 `read-only`、`read-model-sync` 或 `read-write` 操作边界 | Provider 返回、生产流量或真机链路是否成功 |
| `providerIntake` | `docs/provider-intake/*.md` | Provider 材料是否登记、状态是否为 `normalized` 或 `confirmed` | `normalized` 不等于接口确认；高风险业务仍需独立 contract |
| `clinicalContract` | `clinical-domain-catalog.mjs`、临床准入文档、结构化准入卡片和 API 源码 | 门诊记录、住院、医生关系、问诊/电子导诊四域是否仍独立、未注册且没有误加通用路由 | 不会因为材料登记就自动生成临床页面或接口 |
| `healthContent` | 健康知识路由、约定的本机审核 bundle 证据目录和发布状态元数据 | 健康百科代码是否具备、正式审核 bundle 是否已经进入当前证据目录 | 不代表 bundle 已通过临床审核、已导入 staging、已发布或已完成真机验收 |
| `runtime` | live/pending `build-info.json` | 当前开发者工具目录和待发布候选的源码来源是否一致 | 当前微信设备一定运行了哪个版本；锁定目录时必须保留现场证据 |
| `deviceEvidence` | 按 pending `build-info.json.sourceRevision` 匹配 `docs/release/device-evidence-<commit>-pending.json` | 当前候选的真机证据域数量、状态和候选指纹是否匹配 | `pending` 不等于失败；清单结构通过也不等于真实业务成功 |
| `migrationQueue` | 旧页面状态、只读域、临床准入、运行包和真机证据 | A-F 六个业务批次当前停在哪个门槛、下一动作和停止条件 | 不会自动打开状态页，也不会把 contract 缺失解释成业务完成 |
| `businessCompletion` | 固定 fail-closed 判定 | 明确当前不能声称全项目业务完成 | 不会因为页面或状态页存在就伪造完成结论 |

## 当前基线（2026-08-25）

当前报告应体现以下事实：

- 旧页面共 64 个，其中 `replaced=7`、`partial=17`、`blocked=39`、`excluded=1`；所有阻断入口都进入固定迁移状态页，互联网医院旧顶层入口已有独立安全壳但外部能力仍关闭。
- 旧端七个业务域已按台账拆开汇总：互联网医院 2 页/1 阻断、患者 7 页/5 阻断、健康 34 页/27 阻断、就诊 1 页/0 阻断、首页 2 页/0 阻断、用户 8 页/2 阻断、预约 10 页/4 阻断；有阻断的域并行补 contract，无阻断的域进入真实验收，不再用一个页面的修复代表全项目进度。
- 原生小程序注册 20 个页面，四个主入口继续使用微信原生 `tabBar`。
- 五个低风险域的仓库闭环结构审计通过，但只表示文件、日志和文档没有断链；其中患者目录是受控读模型同步，普通资料包含版本化 PUT，不能把它们误读为纯读取。
- Provider 接收材料为 4 份、当前均为 `normalized`，确认数为 0；挂号写入、支付、医保、退款和 HIS 回写不能据此开放。
- live `dist` 来源为 `fcc6630e`，当前 pending 来源为 `e5345c4`；两者不一致，所以待发布候选仍需在微信开发者工具释放目录锁后原子发布。`e5345c4` 包含 `7bc5956` 的小程序业务代码以及共享构建/门禁输入。
- 当前 9 个真机证据域全部为 `pending`；候选指纹与 pending 运行包一致，但真实页面、客户端 requestId 和服务端同链日志尚未形成通过证据。
- 临床四域合同门禁通过只表示它们仍保持 `normalized / unregistered`；任何正式 Provider 材料到达后必须逐域进入 contract、adapter、domain 和 API 实现，不得删除门禁或共用 `/clinical`。

四域的结构化准入卡片位于 [`clinical-read-models-contract-gate.json`](../provider-intake/clinical-read-models-contract-gate.json)。它逐域记录 Provider contract、成功/空/拒绝/超时样例、owner 映射、字段白名单和脱敏规则的状态；当前只能是 `pending` 或 `missing`。这份卡片不是业务响应 fixture，不能被小程序或 API 读取；任何字段进入 `confirmed` 前必须先完成正式 contract 评审并同步独立域实现。

报告中的 `codeReadyDomainCount` 和 `realEvidenceReadyDomainCount` 必须分开读取：前者表示仓库结构和代码闭环通过，后者只在真机证据清单中对应域全部达到 `passed` 时增加。两者都不等于支付、医保或其它阻塞域已经开放。

`migrationQueue` 固定包含六个批次：A 安全只读真实取证、B 健康内容发布、C 临床只读契约、D 患者与便民写入、E 外部入口与实时能力、F 支付/医保/HIS 回写。A、B 可以在已有代码基础上并行收集真实证据；C-E 先收集各自 contract；F 始终最后处理。B 批次的 `reviewedBundlePresent` 只表示约定本机证据目录中存在文件，仍必须完成 bundle 校验、staging、发布/撤回和真机验收。队列中的 `nextAction` 和 `stopCondition` 是执行提示，不是把状态页变成业务页的授权。

## 与后续迁移的关系

readiness 报告解决的是“全项目现在覆盖到哪里、哪些地方还缺 contract、运行包是否对齐”的可见性问题。业务推进仍按 [`full-migration-handoff-2026-08-25.md`](full-migration-handoff-2026-08-25.md) 执行：先完成安全只读域和健康内容的真实证据，再分别收集临床、患者写入、外部入口以及最后的支付/医保 contract。

任何新域都必须同时具备页面、API、领域模型、Provider 适配、脱敏与错误边界、低敏日志、文档、测试和对应的公网/真机证据，才能从阻断状态进入真实业务验收。
