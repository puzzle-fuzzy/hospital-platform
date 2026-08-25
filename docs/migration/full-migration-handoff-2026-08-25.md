# 全量迁移当前交接单（2026-08-25）

> 这份文档是后续会话的广度优先入口。它把“页面入口已覆盖”“代码已有安全子集”“真实业务已经验收”严格分开，避免继续把某一个页面的修补误当成全项目迁移完成。
>
> 本轮只修改新项目；旧 Python 服务、旧数据库、旧 Redis、线上旧进程和另一会话负责的 `packages/adapters/src/zhongyang-appointments.ts` 不在本轮修改范围内。

> **当前仓库事实（2026-08-25）**：本轮交接基线为 `0e1a94a1`。本轮提交只更新真机证据清单的结构审计与交接说明，不代表已经发布新的服务端或小程序运行包；服务端本地候选仍以 `apps/api` 的 `b42922f4` 为准，小程序 pending 仍以 `296516a5` 为准。历史候选编号只用于追溯，不能替代当前运行包、线上 release 或真机证据。

## 1. 当前真实基线

| 项目 | 当前事实 |
| --- | --- |
| 功能候选代码基线 | `923074bc128606b7f1504ad0e8e6ea354c4afa34` |
| 当前仓库 HEAD | `0e1a94a1`（真机证据结构审计与交接说明；不改变业务运行包） |
| 小程序源码候选 | `296516a5f255c563ec5eac40f2a3439632b143b8` |
| 小程序 pending 运行包 | `.local/hospital-miniprogram/pending/`，`build-info.json.sourceRevision=296516a5f255c563ec5eac40f2a3439632b143b8` |
| pending 页面数 | 20 个；每个页面具备 `.js/.json/.wxml/.wxss` |
| 小程序回归 | 261 pass / 0 fail / 2531 expect() |
| 当前 live `dist` | 仍被微信开发者工具占用，未替换；不能用来证明本候选已加载 |
| 服务端本地候选 | 当前 `apps/api` 代码最新提交为 `b42922f4`，尚未因 release baseline drift 部署 |
| 线上服务 | 新 API `8eb51b5f` 与旧 Python `8001` 共存；本轮不停止旧服务 |

本轮最新的只读共存核对见 [`release/current-runtime-coexistence-readonly-2026-08-25.md`](../release/current-runtime-coexistence-readonly-2026-08-25.md)。该记录证明运行层边界正常，但不替代当前候选的业务验收。

## 2. 64 个旧页面的覆盖事实

旧端实际扫描到 64 个 Vue 页面，当前逐页台账为 64/64：

| 状态 | 数量 | 含义 |
| --- | ---: | --- |
| `replaced` | 7 | 已有原生页面或等价静态能力；仍需真实链路/真机证据才能称为完成 |
| `partial` | 16 | 已有安全只读或静态子集；旧页面中的写入、详情、实时或外部能力仍关闭 |
| `blocked-provider` | 6 | 等待 HIS/Provider 的请求、响应、映射、脱敏和错误样例 |
| `blocked-clinical` | 13 | 等待题库、阈值、内容、随访或问诊规则版本及临床审核 |
| `blocked-payment` | 7 | 等待金额、订单、支付、查单、退款和 HIS 回写状态机 |
| `blocked-patient-contract` | 4 | 等待新增/绑定、协议、地址、签名的 owner、同意和幂等规则 |
| `blocked-external` | 10 | 等待 WebView、客服、问诊、分享、订阅等外部主体和回跳协议 |
| `excluded` | 1 | 旧端开发辅助页，不进入生产小程序 |
| **合计** | **64** | 每个旧页面有一个明确落点；不等于 64 个业务都已开放 |

逐页事实源是 [`legacy-page-catalog.ts`](../../apps/miniprogram/src/services/legacy-page-catalog.ts)，机器门禁为：

```text
pnpm migration:audit
pnpm migration:boundary:audit
```

所有 `blocked-*` 入口当前进入固定 `pages/feature-status/feature-status` 和固定 `FeatureKey`。这一步解决的是 404、无响应和任意旧 URL 跳转，不是空页面伪装成业务完成。

全项目 readiness 汇总可以通过 `pnpm migration:readiness` 生成，字段说明见 [`migration-readiness-report.md`](migration-readiness-report.md)。该报告明确拆分入口结构、五个只读域、Provider 材料状态、pending/live 运行包来源和真实业务完成状态；默认结构审计通过不代表 Provider、公网或真机验收通过，`--strict` 才会把运行包未对齐作为命令失败。

## 3. 当前可继续推进的业务队列

### A：安全只读队列

已有患者目录同步/读取、预约目录/历史/爽约、报告目录/受限详情、门诊费用列表和普通资料 GET/PUT 的代码闭环。下一步是同一候选下的页面、客户端 requestId、服务端 Pino 事件和 Provider requestId 配对验收。

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
2. 使用 [`device-evidence-296516a5-pending.json`](../release/device-evidence-296516a5-pending.json) 作为 9 个只读验收域的起始清单；一次记录成功、空结果、401、依赖不可用、Provider 超时和患者切换边界。
   `pnpm device:evidence:audit --file docs/release/device-evidence-296516a5-pending.json` 在全部域仍为 `pending` 时会先完成清单、候选指纹和脱敏边界审计，但总结果仍为 `passed=false`；一旦出现 `passed/failed` 真实链路结果，线上 release 基线必须先通过，否则工具直接拒绝纳入验收。
3. Provider 材料缺失时转向 B/C/D/E 的 contract 收集，不停在一个页面上猜测字段。
4. 每个业务域只有在 contract、adapter、domain 不变量、API、页面状态机、低敏日志、自动化测试和真实链路证据齐全后，才从 `partial/blocked-*` 改为完成。
5. `pnpm release:baseline:audit` 当前应继续 fail-closed：线上 release 之后存在未部署运行时代码，且包含另一会话负责的众阳预约适配器。不能通过修改审计器或只部署半套代码来“变绿”。

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

发布前仍必须保留旧 live 包，不能复制 `*.test.js`/`*.spec.js`，不能把本地测试结果写成线上真机或 Provider 证据。
