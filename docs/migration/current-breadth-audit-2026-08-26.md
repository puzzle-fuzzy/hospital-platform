# 全量迁移当前检查点（2026-08-26）

> **当前候选覆盖（2026-08-26）**：pending 小程序候选已更新为 `ded78c58`（完整来源 `ded78c58c53923ecf5232a8035b3e790e5959216`），40 页，回归 `329 pass / 0 fail / 3632 expect()`；电子锦旗/表扬信记录区域已统一加载、失败、未开放三态和固定高度。pending 校验通过但尚未原子发布，live 仍为 `02dbf10`，九个真机证据域仍为 pending。

> 本文是本轮广度迁移的事实记录，不把“入口已经有落点”写成“业务已经完成”。
> 旧 Python 服务、旧数据库、旧 Redis、线上旧进程和另一会话维护的众阳预约适配器不在本轮修改范围内。

2026-08-26 最新横向补充：患者签名和消息订阅已从通用状态壳升级为原生安全展示页；采血预约、电子锦旗和表扬信已补齐真实可确认的患者入口、列表/记录关闭态、错误重试和统一状态说明；本批又把临床/服务入口以及我的问诊统一到共享当前就诊人上下文，并补充患者协议原文只读入口；微信资料被拒绝后的重试已接入 `wx.openSetting` 用户点击链路，选择页刷新并发门禁已补齐，“我的快递”已区分患者加载、失败和未开放三态。本轮又把电子锦旗和表扬信记录区域统一为加载/失败/未开放三态并固定高度，避免患者目录故障伪装成空记录。签名外部跳转、微信订阅授权、采血号源、锦旗/表扬信 Provider、临床 Provider、问诊 Provider 和写入仍关闭。当前最新 40 页运行相关源码候选为 `ded78c58c53923ecf5232a8035b3e790e5959216`，pending 运行包校验已通过，live `dist` 仍为上一候选 `02dbf10419740d96c4445493df019021ac22bcfa`；本地小程序回归为 `329 pass / 0 fail / 3632 expect()`；九个真机证据域仍为 `pending`。本轮另修正健康百科和报告详情的迁移台账映射。源码回归和运行包校验不能写成真机证据，也不改变 64 个旧入口的业务状态分布。

2026-08-26 横向推进记录：在既有患者域和临床只读页面基础上，本轮继续补齐 7 个临床内容、
3 个外部入口和 2 个预约 Provider 只读入口的原生页面外壳、必要的患者选择入口和稳定关闭态。
真实业务仍未注册临床问卷/规则、外部会话、采血号源或挂号详情 API，业务准入继续保持关闭；详见
[`clinical-read-contract-domain-foundation-2026-08-26.md`](clinical-read-contract-domain-foundation-2026-08-26.md)。

## 1. 当前总结果

| 项目 | 当前事实 | 结论 |
| --- | --- | --- |
| 旧端页面 | 64 个 Vue 页面 | 64/64 已进入逐页迁移台账 |
| 新端页面 | 40 个 TypeScript 原生页面 | `app.json` 注册完整，WXML 事件闭环；其中 25 个仍为 `surface-only` 页面外壳 |
| 入口状态 | `replaced=8`、`partial=23`、`surface-only=25`、`blocked-payment=7`、排除=1 | 64 个旧入口均有落点；支付/医保/回写仍关闭 |
| 旧服务端路由 | 195 个已挂载路由，另有 1 个未挂载路由文件 | 已纳入旧 API 盘点 |
| 旧端接口字面量 | 87 个 | 已纳入新旧接口语义清单 |
| 新端四个主 Tab | 原生 `tabBar` 单一声明 | 页面不重复渲染底栏 |
| 当前小程序运行相关源码候选 | pending `ded78c58c53923ecf5232a8035b3e790e5959216`；live `02dbf10419740d96c4445493df019021ac22bcfa` | 40 页，`329 pass / 0 fail / 3632 expect()`；pending 校验通过 |
| 当前 live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`（`02dbf10`） | 40 页，`runtime:verify` 通过；九个真机证据域仍为 pending，不能作为真机完成证据 |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` | 与旧 Python `8001` 共存，未因本轮文档而改变 |

## 2. 本轮门禁结果

以下门禁已经通过，证明的是结构、契约覆盖和代码边界：

- `pnpm migration:audit`：64 个旧页面、40 个新页面、195 个旧服务端路由、87 个旧端接口字面量均有登记；
- `pnpm migration:boundary:audit`：34 个冻结业务入口门禁通过；
- `pnpm migration:breadth:audit`：首页/“我的”可见 action、40 个页面事件方法、四个主 Tab 和统一状态页入口通过；共享临床/患者/外部/Provider 页面工厂的事件方法由审计显式识别；
- `pnpm readonly:audit`：5 个低风险域、8 个页面、10 个公共路由和 35 个语义状态通过；
- `pnpm migration:contract:audit`：C/D/E 三批次 23 个已暴露 FeatureKey 全部覆盖，仍正确保持 `businessReady=false`；D 的领域状态机另外覆盖尚未暴露入口的 `patient-address` 计划能力；
- `pnpm provider:audit`、`pnpm clinical:contract:audit`、`pnpm docs:audit`、`pnpm logging:audit`：材料、临床边界、文档链接和日志注册结构通过。

## 3. 全仓检查的唯一当前阻断

`pnpm check` 在 `release:baseline:audit` 阶段按设计失败。失败原因不是测试失败，而是线上服务端 release 之后本地运行时代码继续变化，当前未重新部署：

- `apps/api/src/app.ts`、`application.ts`、错误处理插件；
- `packages/domain/src/appointments.ts`、`clinical-read-contract.ts`、`date-range.ts`、
  `external-entry-session.ts`、`index.ts`、`knowledge.ts`、`knowledge-import.ts`、
  `patient-write-command.ts`、`patients.ts`、`payment-state.ts`、`ports.ts`、`reports.ts`、
  `user-profile.ts`；
- `packages/persistence/src/health-knowledge-import.ts`、`mysql-health-knowledge-repository.ts`、
  `mysql-repositories.ts`；
- 另一会话维护的 `packages/adapters/src/zhongyang-appointments.ts`。

这项失败必须保持 fail-closed。不能通过修改发布基线、忽略运行时代码差异或只发布部分工作树来伪造线上与本地一致。下一次服务端发布必须先取得完整工作树协调结果，并在不影响旧 Python `8001` 的前提下完成新的生产 preflight、原子切换和公网/内网 smoke。

## 4. 各批次当前动作

| 批次 | 当前状态 | 继续推进的内容 | 暂停内容 |
| --- | --- | --- | --- |
| A 安全只读 | 代码就绪，等待候选发布和真实证据 | 患者切换、预约历史/爽约、报告目录、门诊费用、普通资料统一采证 | 未拿到配套运行包前不宣称真机完成 |
| B 健康内容 | 代码就绪，审核 bundle 缺失 | 处理 133 个源快照质量告警，等待内容责任人提供审核 bundle | 不开放疾病/药品正式内容，不新增自测和医疗结论 |
| C 临床只读 | 4 个域均 `normalized / unregistered` | 分别收集门诊记录、住院 episode、医生关系、电子导诊材料 | 不注册通用病历/住院/医生/导诊 API，不跨域复用 `patientId` |
| D 患者与便民写入 | 等待正式 contract | 整理 owner、同意、幂等、撤回、文件安全和医护读取要求 | 不新增建档、绑卡、地址、签名、问卷提交 |
| E 外部入口 | 已有共用短期会话领域基础，业务仍关闭 | 收集各外部主体的 allowlist、受众、回跳、退出和撤回材料 | 不恢复任意 WebView、长期 ticket 或本地订阅开关 |
| F 支付/医保/回写 | 最后批次 | 只做状态机、金额、查单、回调、补偿设计 | 不创建订单、不调起微信/医保支付、不修改旧 FSI 转发 |

> D 批次已先完成 12 个计划能力共用的命令状态基础，但当前只有 11 个进入冻结入口；这不改变 D 的业务准入状态。
> `pending` 只能通过同一命令的最终事实查询收敛，不能用重放副作用的方式“补偿成功”。
> 具体规则见 [`patient-write-command-domain-contract-2026-08-26.md`](patient-write-command-domain-contract-2026-08-26.md)。

## 5. 继续执行规则

1. 每个旧入口必须保持一个明确落点；统一状态页是迁移边界，不是业务完成。
2. 已有安全子集的域先整体采证；某一个详情页的细节不能阻塞其他业务域。
3. 缺少正式 Provider、临床、外部主体或支付材料时，停止该域实现并切换到其他可推进批次。
4. 任何新业务域都必须经过 `contract → adapter → domain → API → 页面状态机 → 低敏日志 → 真实证据`，不能把旧接口兼容转发直接暴露给小程序。
5. 任何发布前都必须重新通过发布基线；线上未部署的运行时代码不能作为真机或生产证据。

## 6. 自动复核命令

```powershell
pnpm migration:audit
pnpm migration:boundary:audit
pnpm migration:breadth:audit
pnpm migration:contract:audit
pnpm migration:readiness
pnpm docs:audit
pnpm format:check
pnpm check
```

其中 `pnpm check` 当前预期会在发布基线阶段报告“线上 release 落后于本地运行时代码”；该结果表示需要完整发布协调，不允许用门禁豁免代替部署。
