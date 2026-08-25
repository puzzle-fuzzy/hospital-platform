# 当前小程序 pending 运行包候选（3cf828ed）

> 本记录描述提交 `3cf828ed` 生成的 pending 运行包。它尚未发布到微信开发者工具、线上服务或真机，不代表真实业务验收通过。

## 来源与状态

| 项目 | 当前值 |
| --- | --- |
| 小程序源码提交 | `3cf828ed185f0e745138db04011d26c6db62fa8a` |
| pending 运行包 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| 真机证据 | [`device-evidence-3cf828e-pending.json`](device-evidence-3cf828e-pending.json)，9 个域均为 `pending` |

## 本候选改动

- 普通资料 `/me/profile` 暂时失败但 `/me` 已确认 owner 时，仍允许用户主动获取微信头像和昵称；
- 微信资料授权成功并完成普通资料 PUT 后，将全局资料状态恢复为 `ready`，避免页面长期停留在错误态；
- 授权加载过程中保留普通资料故障上下文，授权失败时仍提供稳定、可再次点击的中文提示；
- 新增跨页面授权回归和静态验收，验证“资料异常不等于未登录”；
- 未修改旧 Python 服务、旧数据库、旧 Redis，也未修改另一会话负责的众阳预约适配器。

## 已完成验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram test`：284 pass / 0 fail / 3129 expect()；
- `pnpm format:check`、`pnpm lint`：通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending -- --expect-source-revision 3cf828ed`：通过；
- 正常 build 在发布阶段遇到 `dist/` 的 `EBUSY` 锁定，旧 live 运行包未被覆盖，完整候选已保留在 pending。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的 `dist/` 重新编译并采集页面截图、客户端 requestId、服务端 Pino 事件和 Provider 低敏请求号。当前候选只修复全局资料授权状态边界，不扩大预约写入、支付、医保、临床或外部入口的开放范围。
