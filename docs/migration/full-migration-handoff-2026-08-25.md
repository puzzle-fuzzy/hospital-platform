# 全量迁移当前交接单（2026-08-25）

> **当前仓库执行检查点（2026-08-27）**：当前 `main`（具体提交以 `git rev-parse HEAD` 为准）中 API 运行时代码变更来源为 `eb4d2eb4`、`4e1e53ed`；当前候选已完成 API-only 远端原子发布，线上为 `b44421cd321ff9ff23eeb49b12641d1772d2bdc1`。本轮健康知识服务新增直调关系查询白名单并补充固定失败校验原因日志，发布基线已复核通过。旧 Python、旧数据库和旧 Redis 未修改。请先阅读 [`current-execution-checkpoint-2026-08-27.md`](current-execution-checkpoint-2026-08-27.md)，再使用本文下方的历史候选记录。

> **当前候选覆盖（2026-08-27）**：最新小程序源码和本地 live 运行输入为 `76ca0137ea9a57b8b7ed9c8797bb718040535922`（`76ca013`），40 页；核心回归、App.onLaunch 全局资料初始化时序、共享患者外壳会话边界、就诊二维码会话门禁、健康数值规则版本、会话失效资料缓存清理和预约请求运行时边界测试通过。该来源已完成校验并原子切换到 live `dist`，本候选未新增 Provider 请求或写入；本文下方旧候选数字只作历史追溯，以本段和 [`candidate-413cbea-miniprogram-runtime-2026-08-27.md`](../release/candidate-413cbea-miniprogram-runtime-2026-08-27.md) 为准。

> **最新候选纠正（2026-08-27）**：当前源码已注册 40 个页面，健康自测中的 BMI/血压安全数值子集已进入 `partial`，就诊页今日预约摘要已补齐但实时叫号仍关闭；采血预约、我的快递、患者签名展示和消息订阅展示也已进入 `partial`，当前统计为 `replaced=8 / partial=23 / surface-only=25 / blocked-payment=7 / excluded=1`。当前 40 页运行相关源码候选 `76ca0137ea9a57b8b7ed9c8797bb718040535922` 已完成构建、运行包校验并原子切换到本地 live `dist`；九个真机证据域仍为 `pending`，真实 Provider/临床/外部/患者写入业务仍未开放。协议版本、同意记录、撤回和审计仍关闭，正式健康审核 bundle 仍缺失；本候选修复 App.onLaunch 全局资料初始化时序并保留预约排班与预约历史底层请求运行时边界；旧 Python 服务未修改，线上新 API 已按 [`release/candidate-b44421cd-production-acceptance-2026-08-27.md`](../release/candidate-b44421cd-production-acceptance-2026-08-27.md) 完成新旧共存发布。

> 这份文档是后续会话的广度优先入口。它把“页面入口已覆盖”“代码已有安全子集”“真实业务已经验收”严格分开，避免继续把某一个页面的修补误当成全项目迁移完成。
>
> 本轮只修改新项目；旧 Python 服务、旧数据库、旧 Redis、线上旧进程和另一会话负责的 `packages/adapters/src/zhongyang-appointments.ts` 不在本轮修改范围内。

> **最新候选事实（2026-08-27）**：功能工作树在既有全量 64 个旧入口 A–F 批次覆盖上继续完成当前就诊人上下文的横向迁移；40 页运行相关源码候选 `76ca013` 已完成构建、静态校验并原子切换到 live `dist`。页面只迁移 owner-scoped 患者展示、重试、选择入口、协议原文只读和明确关闭态，并补齐共享患者外壳的 owner 证明、会话代际、账号切换清理以及会话失效时旧 owner 微信资料缓存清理；同时保留微信资料拒绝后的设置页重试、选择页刷新并发门禁以及“我的快递”加载/错误/未开放状态边界，并统一电子锦旗和表扬信记录区域的加载、错误、未开放三态及固定高度，不虚构临床 Provider、问诊会话、物流、采血号源或公开记录 provider。当前候选还收紧预约排班和预约历史底层请求字段、日期和范围关系，并修复 App.onLaunch 全局资料初始化时序。当前证据清单仍为九域 `pending`，从 live 重新生成二维码后逐域取证。当前候选证据见 [`../release/candidate-413cbea-miniprogram-runtime-2026-08-27.md`](../release/candidate-413cbea-miniprogram-runtime-2026-08-27.md)；历史候选的 live 包和证据清单不能直接作为本轮真机完成证据。

> **广度复核补充（2026-08-27）**：64 个旧页面、195 个已挂载旧服务端路由和 87 个旧端接口字面量均已登记；本地结构门禁和发布基线均通过，`eb4d2eb4`、`4e1e53ed` 的服务端运行时代码已进入线上 `b44421cd`。该 release 已完成 production preflight、隔离 smoke、原子切换和公网 runtime smoke；这不是业务测试失败，也不能把运行层 smoke 代替 Provider 或真机业务证据。各批次当前动作见 [`current-breadth-audit-2026-08-26.md`](current-breadth-audit-2026-08-26.md)。

> **2026-08-25 续做记录**：提交 `163d696b` 补强了跨患者、预约、报告和费用模块共用的 `AdapterCallContext` 失败日志兜底；提交 `f97f9f03` 补齐健康知识错误码的服务端、客户端和文档契约；提交 `fc70fa0b` 修正未知/过期 `feature` 进入状态页时被误归类为“医疗记录”的错误语义；提交 `7627843a` 补齐状态页的迁移阶段，提交 `cd26a01` 补齐旧入口、业务域和下一步准入展示。以上候选均保留作历史追溯；当时 pending 小程序运行包为 `7f7a7a18`（20 页），live `dist` 仍为旧来源 `fcc6630e`，因此没有覆盖 `dist`、没有发布微信运行包，也没有修改旧服务、旧数据库、旧 Redis 或另一会话的众阳预约适配器。

> **当前仓库事实（2026-08-27）**：本轮最新小程序运行包来源为 `76ca0137ea9a57b8b7ed9c8797bb718040535922`；该运行输入包含全量入口覆盖视图、A–F 批次展示、契约族边界、逐入口说明、健康自测安全数值子集、临床/外部安全页面、预约 Provider 入口、统一当前就诊人上下文、共享患者外壳的 owner/会话代际清理、会话失效时旧 owner 微信资料缓存清理、我的问诊患者作用域、共享 Tab、统一页面滚动边界、全局资料授权边界、owner 回调保护、协议静态页、协议原文只读入口以及旧端“我的快递”、采血预约、电子锦旗和健康表扬信安全页面迁移，并补齐二维码有效会话门禁、健康数值工具规则版本、就诊/互联网医院关闭态纵向布局和 App.onLaunch 全局资料初始化时序。该候选已完成构建、静态校验并原子发布到 live `dist`，没有发布线上服务，也没有改变旧 Python 服务。历史候选编号只用于追溯，不能替代当前运行包、线上 release 或真机证据。

> **2026-08-27 继续修正**：共享患者外壳统一 `/me` owner 证明、目录读取后的 owner/会话代际重验证和账号切换清理；会话失效时先保存旧 owner 再删除其微信昵称/头像缓存，避免旧账号资料残留；同时保留 `pages/gift-banner/gift-banner` 和 `pages/health-praise/health-praise` 的固定高度记录区域状态，并修复 App.onLaunch 阶段全局资料初始化对 getApp 注册时序的依赖。该修正不会新增 Provider 请求，也不改变 `surface-only` 业务边界。相关纯状态、会话和静态验收测试已纳入小程序包级测试清单并通过，当前 `76ca013` 已完成运行包构建、静态校验和原子发布；真机证据仍待采集。

## 1. 当前真实基线

| 项目 | 当前事实 |
| --- | --- |
| 小程序运行相关源码基线 | `76ca0137ea9a57b8b7ed9c8797bb718040535922`（已发布到 live） |
| 当前小程序运行基线 | `76ca013`（live `dist`）；当前没有 pending 候选，最近一次构建已将 App.onLaunch 初始化时序修正候选原子发布 |
| 小程序运行包候选 | 来源 `76ca013`；业务状态沿用全量入口迁移台账 |
| live 运行包 | `apps/miniprogram/dist/build-info.json`，`sourceRevision=76ca0137ea9a57b8b7ed9c8797bb718040535922`，40 个页面 |
| 当前源码页面数 | 40 个；每个页面具备 TypeScript 源码和页面配置 |
| live 页面数 | 40 个；`runtime:verify` 已通过 |
| 小程序回归 | `341 pass / 0 fail / 3730 expect()`；入口分发审计通过 |
| 发布与运行包验证 | 发布前 `runtime:verify:pending` 已通过；发布后 `runtime:verify` 已通过 |
| 当前 live `dist` | 来源为 `76ca0137ea9a57b8b7ed9c8797bb718040535922`；真机是否已加载仍须通过新二维码和页面证据确认 |
| 服务端本地候选 | 当前 `main` 中包含 `eb4d2eb4`、`4e1e53ed` 引入的健康知识运行时代码；提交以 `git rev-parse HEAD` 为准，API-only 发布基线已通过 |
| 线上服务 | 新 API `b44421cd` 与旧 Python `8001` 共存；本轮不停止旧服务 |

本轮最新的只读共存核对见 [`release/current-runtime-coexistence-readonly-2026-08-27.md`](../release/current-runtime-coexistence-readonly-2026-08-27.md)。该记录证明运行层边界正常，但不替代当前候选的业务验收。

## 2. 64 个旧页面的覆盖事实

旧端实际扫描到 64 个 Vue 页面，当前逐页台账为 64/64：

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| `replaced` | 8 | 已有原生页面或等价静态能力；仍需真实链路/真机证据才能称为完成 |
| `partial` | 23 | 已有安全只读或静态子集；旧页面中的写入、详情、实时或外部能力仍关闭 |
| `surface-only` | 25 | 页面外壳、必要的患者选择入口和关闭态已迁移；真实业务仍按对应 contract 阻塞 |
| `blocked-provider` | 0 | Provider 入口已先迁移安全壳，真实读取仍未开放 |
| `blocked-clinical` | 0 | 临床入口已先迁移安全壳，题库/阈值/内容业务仍未开放 |
| `blocked-payment` | 7 | 等待金额、订单、支付、查单、退款和 HIS 回写状态机 |
| `blocked-patient-contract` | 0 | 患者新增绑定、签名和旧端快递页面已有安全外壳；真实 contract 仍未开放，协议同意能力也仍关闭 |
| `blocked-external` | 0 | 外部入口已先迁移安全壳，WebView、客服、问诊、分享、订阅仍未开放 |
| `excluded` | 1 | 旧端开发辅助页，不进入生产小程序 |
| **合计** | **64** | 每个旧页面有一个明确落点；不等于 64 个业务都已开放 |

逐页事实源是 [`legacy-page-catalog.ts`](../../apps/miniprogram/src/services/legacy-page-catalog.ts)，机器门禁为：

```text
pnpm migration:audit
pnpm migration:boundary:audit
```

除 25 个 `surface-only` 外壳外，剩余支付/医保/结算入口当前进入固定 `pages/feature-status/feature-status` 和固定 `FeatureKey`；这些外壳只展示页面边界和关闭态，不读取 Provider、不打开外部地址。这一步解决的是 404、无响应和任意旧 URL 跳转，不是空页面伪装成业务完成；健康自测以及采血预约、我的快递、患者签名展示、消息订阅展示的安全子集已单独进入 `partial`。

首页和“我的”当前可见的 31 个 action 另外由 `pnpm migration:breadth:audit` 审计：它检查 action 是否存在固定分支、状态页引用是否属于本地目录、图标是否存在以及四个主 Tab 是否仍注册；同时检查全部 40 个已注册页面的 WXML 事件是否都能在对应 TS 页面方法或共享页面工厂中找到。该门禁只保证入口交互完整，不扩大任何真实业务范围。

全项目 readiness 汇总可以通过 `pnpm migration:readiness` 生成，字段说明见 [`migration-readiness-report.md`](migration-readiness-report.md)。该报告明确拆分入口结构、五个只读域、Provider 材料状态、四个临床域准入状态、pending/live 运行包来源、九个真机证据域和真实业务完成状态；默认结构审计通过不代表 Provider、公网或真机验收通过，`--strict` 才会把运行包未对齐作为命令失败。

## 3. 当前可继续推进的业务队列

### A：安全只读队列

已有患者目录同步/读取、预约目录/历史/爽约、报告目录/受限详情、门诊费用列表和普通资料 GET/PUT 的代码闭环。下一步是同一候选下的页面、客户端 requestId、服务端 Pino 事件和 Provider requestId 配对验收。

跨 Tab 的全局资料初始化也已补齐页面先行启动保护：正常路径由 `App.onLaunch` 负责单飞，页面在明确 `idle` 初始态时才接管同一 Promise，避免把初始化竞态误判成未登录。实现和边界见 [`../release/miniprogram-global-profile-page-first-bootstrap-2026-08-25.md`](../release/miniprogram-global-profile-page-first-bootstrap-2026-08-25.md)。

本队列不扩展到：预约锁号/取消、报告附件、费用明细、支付、医保或 HIS 回写。

### B：健康内容队列

健康百科、症状查疾病、疾病/药品详情已经有运行时响应校验和安全投影；正式审核 bundle、staging 导入、发布/撤回和真机证据尚未完成。

没有临床审核材料前，不新增 BMI、血压、健康自测、风险分级或个体化用药结论。

### C：临床只读队列

门诊病历、住院、医生关系、问诊/电子导诊单先分别收集正式 Provider contract。当前没有 `out-visit-records` 等正式字段白名单、脱敏成功/空/拒绝/超时样例和授权说明，因此继续保持状态页。

不能复用预约、报告的内部引用，也不能把旧端 `patId`、`regId`、`patInHosId` 或缓存直接暴露给小程序。

### D：患者与便民写入队列

新增/绑定、协议、地址、签名、预问诊、随访、风险评估、锦旗/表扬信需要独立的同意、幂等、撤回、文件安全和医护读取规则。没有这些材料时只完善准入文档，不写假提交接口。

### E：外部入口队列

智能客服、陪诊、问诊 WebView、订阅、报告分享/复诊需要域名 allowlist、短期会话、受众、退出和回跳协议。禁止把任意旧 URL、长期 ticket 或本地开关接入新小程序。

### F：支付与医保队列（最后）

预约下单、门诊/住院支付、微信支付、医保授权、1101/6201/6202/6301/6203/6401、查单、退款和 HIS 回写必须作为一个可回滚批次处理。只读费用列表不承载支付按钮，不复用旧 FSI 万能转发。

## 4. 下一步执行规则

1. 当前候选 `76ca013` 已通过原子发布器切换到 live `dist`，pending 目录已清理；后续重新构建时仍必须先确认锁状态并沿用原子发布器，不能删除或覆盖 live `dist`。
2. 当前候选 `76ca013` 的九域真机清单为 [`device-evidence-76ca0137-pending.json`](../release/device-evidence-76ca0137-pending.json)，已绑定 `76ca0137ea9a57b8b7ed9c8797bb718040535922`；九个域全部为 `pending`，一次记录成功、空结果、401、依赖不可用、Provider 超时、患者切换和账号切换边界。上一候选的 `device-evidence-02dbf10-pending.json`、`device-evidence-731c957-pending.json`、`device-evidence-de5dea8-pending.json` 和 `device-evidence-ed63a8e-pending.json` 只作历史模板，不能直接提交本轮证据。
   执行 `pnpm device:evidence:audit --file docs/release/device-evidence-76ca0137-pending.json` 时，在全部域仍为 `pending` 的情况下总结果仍为 `passed=false`；一旦出现 `passed/failed` 真实链路结果，线上 release 基线必须先通过，否则工具直接拒绝纳入验收。
3. Provider 材料缺失时转向 B/C/D/E 的 contract 收集，不停在一个页面上猜测字段。
4. 每个业务域只有在 contract、adapter、domain 不变量、API、页面状态机、低敏日志、自动化测试和真实链路证据齐全后，才从 `partial/blocked-*` 改为完成。
5. `pnpm release:baseline:audit` 已通过，确认 `b44421cd321ff9ff23eeb49b12641d1772d2bdc1` 已覆盖 `apps/api/src/modules/knowledge/index.ts`、`service.ts` 的运行时代码；不能通过修改审计器或只部署半套代码来“变绿”。

本轮共享基础设施修正已经完成，后续工作回到广度队列：A 批次从已发布的 `76ca013` live 运行包开始采集九个只读域证据；B 批次等待内容责任人审核 bundle；C/D/E 批次分别等待临床、患者写入和外部入口 contract；F 批次继续最后处理支付、医保和 HIS 回写。业务代码不能因为一个共享日志问题已修复就提前打开这些阻断域。

## 5. 交接时必须运行的门禁

```powershell
pnpm migration:audit
pnpm migration:boundary:audit
pnpm readonly:audit
pnpm provider:audit
pnpm logging:audit
pnpm docs:audit
pnpm format:check
pnpm lint
pnpm typecheck
```

小程序 pending 发布恢复：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

如果微信开发者工具仍锁定 `dist/`，可先只读验证隔离候选，不覆盖 live 运行包：

```powershell
$pendingBuildInfo = Get-Content -LiteralPath '.local/hospital-miniprogram/pending/build-info.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION = $pendingBuildInfo.sourceRevision
pnpm --filter @hospital/miniprogram runtime:verify:pending
Remove-Item Env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION
```

该命令只证明 pending 包静态完整且与显式来源指纹一致，不证明已经发布到 `dist`、上传微信或完成真机业务验收。

发布前仍必须保留旧 live 包，不能复制 `*.test.js`/`*.spec.js`，不能把本地测试结果写成线上真机或 Provider 证据。
