# 当前小程序 pending 运行包候选（7627843a）

> 本记录描述本批“全量迁移入口覆盖”代码提交生成的 pending 运行包。它尚未发布到微信开发者工具、线上服务或真机，不代表真实业务验收通过。

## 候选事实

| 项目 | 当前值 |
| --- | --- |
| 小程序源码提交 | `7627843aa48ffe18651a5e5162202cbd0fd5d594` |
| pending 位置 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| pending 来源 | `build-info.json.sourceRevision` |
| 真机证据清单 | [`device-evidence-7627843-pending.json`](device-evidence-7627843-pending.json)，9 个域均为 `pending` |
| 服务端候选 | `b42922f`，尚未与线上旧 release 切换 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被微信开发者工具占用 |

## 本批迁移覆盖变更

- 统一状态页现在展示迁移阶段、覆盖的旧端入口数量和下一步材料；
- 所有状态入口均可返回共享的“医疗服务”主 Tab；
- 新增 `migration-coverage.ts` 聚合服务和回归测试，不复制旧页面台账；
- 没有打开 Provider、临床、患者绑定、外部 WebView、支付、医保或 HIS 回写能力。

## 本地验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- 当前小程序测试：`276 pass / 0 fail / 2915 expect()`；
- `pnpm migration:audit`：通过，64 个旧页面与迁移台账一致；
- `pnpm migration:breadth:audit`：通过，20 个注册页面的 WXML 事件闭环和 4 个主 Tab 通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending`：通过，20 个页面脚本和根文件完整；
- `pnpm --filter @hospital/miniprogram build`：源码编译和 pending 生成完成，但发布到 live `dist/` 时因微信开发者工具锁返回 `EBUSY`，旧运行包保留未变；
- `pnpm docs:audit`、`pnpm format:check`、`pnpm lint`：通过。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后才能使用本候选重新生成二维码并采集九域真机证据。旧 live `dist/` 未被替换前，不能把
本候选代码测试、pending 验证或页面状态页当作微信业务完成证据。
