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
| `entryCoverage.nativePageCount` | `apps/miniprogram/src/app.json` | 原生小程序注册了多少页面 | 微信开发者工具是否加载了这些页面 |
| `readOnly` | `read-only-domain-catalog.mjs` | 就诊人、预约、报告、门诊费用、普通资料五个只读域的页面/API/实现/日志/文档是否断链 | Provider 返回、生产流量或真机链路是否成功 |
| `providerIntake` | `docs/provider-intake/*.md` | Provider 材料是否登记、状态是否为 `normalized` 或 `confirmed` | `normalized` 不等于接口确认；高风险业务仍需独立 contract |
| `runtime` | live/pending `build-info.json` | 当前开发者工具目录和待发布候选的源码来源是否一致 | 当前微信设备一定运行了哪个版本；锁定目录时必须保留现场证据 |
| `businessCompletion` | 固定 fail-closed 判定 | 明确当前不能声称全项目业务完成 | 不会因为页面或状态页存在就伪造完成结论 |

## 当前基线（2026-08-25）

当前报告应体现以下事实：

- 旧页面共 64 个，其中 `replaced=7`、`partial=16`、`blocked=40`、`excluded=1`；所有阻断入口都进入固定迁移状态页。
- 原生小程序注册 20 个页面，四个主入口继续使用微信原生 `tabBar`。
- 五个只读域的仓库闭环结构审计通过，但只表示文件、日志和文档没有断链。
- Provider 接收材料为 4 份、当前均为 `normalized`，确认数为 0；挂号写入、支付、医保、退款和 HIS 回写不能据此开放。
- live `dist` 来源为 `fcc6630e`，pending 来源为 `296516a5`；两者不一致，所以待发布候选仍需在微信开发者工具释放目录锁后原子发布。

## 与后续迁移的关系

readiness 报告解决的是“全项目现在覆盖到哪里、哪些地方还缺 contract、运行包是否对齐”的可见性问题。业务推进仍按 [`full-migration-handoff-2026-08-25.md`](full-migration-handoff-2026-08-25.md) 执行：先完成安全只读域和健康内容的真实证据，再分别收集临床、患者写入、外部入口以及最后的支付/医保 contract。

任何新域都必须同时具备页面、API、领域模型、Provider 适配、脱敏与错误边界、低敏日志、文档、测试和对应的公网/真机证据，才能从阻断状态进入真实业务验收。
