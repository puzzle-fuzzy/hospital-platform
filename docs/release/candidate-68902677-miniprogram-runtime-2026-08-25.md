# 当前小程序 pending 运行包候选（68902677）

> 本记录描述提交 `68902677` 生成的 pending 运行包。它尚未发布到微信开发者工具、线上服务或真机，不代表真实业务验收通过。

## 来源与状态

| 项目 | 当前值 |
| --- | --- |
| 小程序源码提交 | `689026770a9f68837ba60f1d7bf1ad9f073d547e` |
| pending 运行包 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| 真机证据 | [`device-evidence-6890267-pending.json`](device-evidence-6890267-pending.json)，9 个域均为 `pending` |

## 本候选改动

- 20 个页面统一设置 `disableScroll: true`，根节点由显式 `scroll-view` 承担内容滚动；
- 四个主 Tab 继续使用 `tab-page-scroll`，其它页面使用统一的 `secondary-page-scroll`；
- 预约级联、日期选择和弹层列表的内部滚动边界保持不变；
- 导航审计和小程序验收测试新增页面级滚动回归，避免后续新增页面退回微信默认整页滚动；
- 未修改旧 Python 服务、旧数据库、旧 Redis，也未修改另一会话负责的众阳预约适配器。

## 已完成验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- `pnpm --filter @hospital/miniprogram test`：282 pass / 0 fail / 3119 expect()；
- `pnpm miniprogram:navigation:audit`：通过，20 pages / 4 primary tabs；
- `pnpm format:check`、`pnpm lint`：通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending -- --expect-source-revision 68902677`：通过；
- 正常 build 在发布阶段遇到 `dist/` 的 `EBUSY` 锁定，旧 live 运行包未被覆盖，完整候选已保留在 pending。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须从新的 `dist/` 重新编译并采集页面截图、客户端 requestId、服务端 Pino 事件和 Provider 低敏请求号。当前候选只解决滚动容器一致性，不扩大预约写入、支付、医保、临床或外部入口的开放范围。
