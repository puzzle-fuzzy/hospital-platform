# 全量迁移当前交接单（2026-08-25）

> 这份文档是后续会话的广度优先入口。它把“页面入口已覆盖”“代码已有安全子集”“真实业务已经验收”严格分开，避免继续把某一个页面的修补误当成全项目迁移完成。
>
> 本轮只修改新项目；旧 Python 服务、旧数据库、旧 Redis、线上旧进程和另一会话负责的 `packages/adapters/src/zhongyang-appointments.ts` 不在本轮修改范围内。

> **最新候选事实（2026-08-25）**：提交 `ad793c80` 补齐了统一状态页的旧入口、业务域、A–F 迁移批次和下一步准入展示；当前 pending 来源为 `ad793c80b0d05b74ee0cee76058b32bd25b4ce38`，20 个页面，`279 pass / 0 fail / 3031 expect()`。构建已生成 pending，但 live `dist` 仍为 `fcc6630e`，微信开发者工具锁定导致发布返回 `EBUSY`；此前候选仅作历史追溯。

> **2026-08-25 续做记录**：提交 `163d696b` 补强了跨患者、预约、报告和费用模块共用的 `AdapterCallContext` 失败日志兜底；提交 `f97f9f03` 补齐健康知识错误码的服务端、客户端和文档契约；提交 `fc70fa0b` 修正未知/过期 `feature` 进入状态页时被误归类为“医疗记录”的错误语义；提交 `7627843a` 补齐状态页的迁移阶段，提交 `cd26a01` 补齐旧入口、业务域和下一步准入展示。当前 pending 小程序运行包已重新构建为 `cd26a01`（20 页），live `dist` 仍为旧来源 `fcc6630e`，因此没有覆盖 `dist`、没有发布微信运行包，也没有修改旧服务、旧数据库、旧 Redis 或另一会话的众阳预约适配器。

> **当前仓库事实（2026-08-25）**：本轮小程序功能候选为 `ad793c80`，当前小程序运行输入/pending 来源为 `ad793c80b0d05b74ee0cee76058b32bd25b4ce38`；该运行输入包含前序业务候选、健康知识错误码契约、未知入口错误语义、迁移入口覆盖视图、A–F 批次展示和共享门禁输入。微信开发者工具仍锁定 live `dist`，没有发布线上服务，也没有改变旧 Python 服务。服务端本地候选仍以 `b42922f4` 为准。历史候选编号只用于追溯，不能替代当前运行包、线上 release 或真机证据。

## 1. 当前真实基线

| 项目 | 当前事实 |
| --- | --- |
| 功能候选代码基线 | `ad793c80`（迁移状态页补齐旧入口、业务域和 A–F 批次覆盖视图） |
| 当前功能基线 | `ad793c80`（文档更新不改变 live `dist`） |
| 小程序业务代码候选 | `ad793c80b0d05b74ee0cee76058b32bd25b4ce38` |
| 小程序 pending 运行包 | `.local/hospital-miniprogram/pending/`，`build-info.json.sourceRevision=ad793c80b0d05b74ee0cee76058b32bd25b4ce38` |
| pending 页面数 | 20 个；每个页面具备 `.js/.json/.wxml/.wxss` |
| 小程序回归 | 当前源码 279 pass / 0 fail / 3031 expect()；pending 已包含当前运行输入；入口分发广度审计通过 |
| pending 静态验证 | 已通过；20 页、根文件、相对依赖、workspace 依赖、测试脚本和来源指纹均已校验 |
| 当前 live `dist` | 来源仍为 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，被微信开发者工具占用，未替换；不能用来证明本候选已加载 |
| 服务端本地候选 | 当前 `apps/api` 代码最新提交为 `b42922f4`，尚未因 release baseline drift 部署 |
| 线上服务 | 新 API `8eb51b5f` 与旧 Python `8001` 共存；本轮不停止旧服务 |

本轮最新的只读共存核对见 [`release/current-runtime-coexistence-readonly-2026-08-25.md`](../release/current-runtime-coexistence-readonly-2026-08-25.md)。该记录证明运行层边界正常，但不替代当前候选的业务验收。

## 2. 64 个旧页面的覆盖事实

旧端实际扫描到 64 个 Vue 页面，当前逐页台账为 64/64：

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| `replaced` | 7 | 已有原生页面或等价静态能力；仍需真实链路/真机证据才能称为完成 |
| `partial` | 17 | 已有安全只读或静态子集；旧页面中的写入、详情、实时或外部能力仍关闭 |
| `blocked-provider` | 6 | 等待 HIS/Provider 的请求、响应、映射、脱敏和错误样例 |
| `blocked-clinical` | 19 | 等待题库、阈值、内容、随访或问诊规则版本及临床审核；锦旗/表扬信也属于内容审核 |
| `blocked-payment` | 7 | 等待金额、订单、支付、查单、退款和 HIS 回写状态机 |
| `blocked-patient-contract` | 4 | 等待新增/绑定、协议、地址、签名的 owner、同意和幂等规则 |
| `blocked-external` | 3 | 等待 WebView、客服、问诊、分享、订阅等外部主体和回跳协议 |
| `excluded` | 1 | 旧端开发辅助页，不进入生产小程序 |
| **合计** | **64** | 每个旧页面有一个明确落点；不等于 64 个业务都已开放 |

逐页事实源是 [`legacy-page-catalog.ts`](../../apps/miniprogram/src/services/legacy-page-catalog.ts)，机器门禁为：

```text
pnpm migration:audit
pnpm migration:boundary:audit
```

所有 `blocked-*` 入口当前进入固定 `pages/feature-status/feature-status` 和固定 `FeatureKey`；互联网医院旧顶层入口已有独立安全壳，但外部能力仍关闭。这一步解决的是 404、无响应和任意旧 URL 跳转，不是空页面伪装成业务完成。

首页和“我的”当前可见的 31 个 action 另外由 `pnpm migration:breadth:audit` 审计：它检查 action 是否存在固定分支、状态页引用是否属于本地目录、图标是否存在以及四个主 Tab 是否仍注册；同时检查全部 20 个已注册页面的 WXML 事件是否都能在对应 TS 页面方法中找到。该门禁只保证入口交互完整，不扩大任何真实业务范围。

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

1. 先释放微信开发者工具对 `apps/miniprogram/dist/` 的锁，再发布 pending 候选；在此之前不删除或覆盖 live `dist`。
2. 使用 [`device-evidence-7627843-pending.json`](../release/device-evidence-7627843-pending.json) 作为 9 个只读验收域的起始清单；一次记录成功、空结果、401、依赖不可用、Provider 超时和患者切换边界。
   `pnpm device:evidence:audit --file docs/release/device-evidence-7627843-pending.json` 在全部域仍为 `pending` 时会先完成清单、候选指纹和脱敏边界审计，但总结果仍为 `passed=false`；一旦出现 `passed/failed` 真实链路结果，线上 release 基线必须先通过，否则工具直接拒绝纳入验收。
3. Provider 材料缺失时转向 B/C/D/E 的 contract 收集，不停在一个页面上猜测字段。
4. 每个业务域只有在 contract、adapter、domain 不变量、API、页面状态机、低敏日志、自动化测试和真实链路证据齐全后，才从 `partial/blocked-*` 改为完成。
5. `pnpm release:baseline:audit` 当前应继续 fail-closed：线上 release 之后存在未部署运行时代码，且包含另一会话负责的众阳预约适配器。不能通过修改审计器或只部署半套代码来“变绿”。

本轮共享基础设施修正已经完成，后续工作回到广度队列：A 批次等待运行包发布后采集九个只读域证据；B 批次等待内容责任人审核 bundle；C/D/E 批次分别等待临床、患者写入和外部入口 contract；F 批次继续最后处理支付、医保和 HIS 回写。业务代码不能因为一个共享日志问题已修复就提前打开这些阻断域。

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
$env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION = "fc70fa0b78a29f564c4e3e4b35ab28ae4afb3fde"
pnpm --filter @hospital/miniprogram runtime:verify:pending
Remove-Item Env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION
```

该命令只证明 pending 包静态完整且与显式来源指纹一致，不证明已经发布到 `dist`、上传微信或完成真机业务验收。

发布前仍必须保留旧 live 包，不能复制 `*.test.js`/`*.spec.js`，不能把本地测试结果写成线上真机或 Provider 证据。
