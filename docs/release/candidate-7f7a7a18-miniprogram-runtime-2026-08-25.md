# 当前小程序 pending 运行包候选（7f7a7a18）

> 本记录描述提交 `7f7a7a18` 生成的 pending 运行包。它尚未发布到微信开发者工具、线上服务或真机，不代表真实业务验收通过。

## 来源与状态

| 项目 | 当前值 |
| --- | --- |
| 服务端本地候选 | `b42922f4`（未部署） |
| 小程序源码提交 | `7f7a7a1844f5269c88f814d7d97d805fe4b8aeca` |
| pending 运行包 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| 真机证据 | [`device-evidence-7f7a7a1-pending.json`](device-evidence-7f7a7a1-pending.json)，9 个域均为 `pending` |

## 本候选改动

- 统一迁移状态页展示每个旧端入口的台账说明；
- 同时展示安全子集和仍关闭的扩展能力，避免把 `partial` 或 `blocked-*` 误认为业务已完成；
- 未注册新的业务 API，未打开支付、医保、临床写入、患者绑定或外部 WebView；
- 未修改旧 Python 服务、旧数据库、旧 Redis，也未修改另一会话负责的众阳预约适配器。

## 已完成验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram test`：285 pass / 0 fail / 3211 expect()；
- `pnpm format:check`、`pnpm lint`：通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending -- --expect-source-revision 7f7a7a18`：通过；
- 正常 build 在发布阶段遇到 `dist/` 的 `EBUSY` 锁定，旧 live 运行包未被覆盖，完整候选已保留在 pending。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的 `dist/` 重新编译并采集页面截图、客户端 requestId、服务端 Pino 事件和 Provider 低敏请求号。当前候选只扩展迁移入口说明，不扩大任何高风险业务的开放范围。
