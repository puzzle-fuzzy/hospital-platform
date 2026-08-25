# 当前小程序 pending 运行包候选（28c0d9ef）

> 本记录描述提交 `28c0d9ef` 生成的 pending 运行包。它尚未发布到微信开发者工具、线上服务或真机，不代表真实业务验收通过。

## 来源与状态

| 项目 | 当前值 |
| --- | --- |
| 服务端本地候选 | `b42922f4`（未部署） |
| 小程序源码提交 | `28c0d9ef71cf72f1ac079a6e5c7a18469134f2c8` |
| pending 运行包 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| 真机证据 | [`device-evidence-28c0d9e-pending.json`](device-evidence-28c0d9e-pending.json)，9 个域均为 `pending` |

## 本候选改动

- 迁移状态聚合为每个 FeatureKey 增加显式契约族，区分 Provider 只读、患者写入、临床内容、外部会话和支付回写等边界；
- 状态页展示“契约族”而不是只展示通用迁移批次，避免把同一批次内不同风险的入口误认为同一种业务；
- 使用完整 `Record<FeatureKey, MigrationContractFamily>` 做编译期覆盖检查，新增入口缺少契约族时直接暴露；
- 新增迁移状态页和全量契约族映射回归；
- 未注册任何新的业务 API，未打开支付、医保、临床写入、患者绑定或外部 WebView；
- 未修改旧 Python 服务、旧数据库、旧 Redis，也未修改另一会话负责的众阳预约适配器。

## 已完成验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram test`：285 pass / 0 fail / 3210 expect()；
- `pnpm format:check`、`pnpm lint`：通过；
- `pnpm migration:readiness`、`pnpm migration:boundary:audit`、`pnpm migration:breadth:audit`、`pnpm migration:contract:audit`：通过；
- `pnpm docs:audit`：725 个文档，无断链；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending -- --expect-source-revision 28c0d9ef`：通过；
- 正常 build 在发布阶段遇到 `dist/` 的 `EBUSY` 锁定，旧 live 运行包未被覆盖，完整候选已保留在 pending。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的 `dist/` 重新编译并采集页面截图、客户端 requestId、服务端 Pino 事件和 Provider 低敏请求号。当前候选只扩展迁移状态的边界可见性，不扩大预约写入、支付、医保、临床或外部入口的开放范围。
