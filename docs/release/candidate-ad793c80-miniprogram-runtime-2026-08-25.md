# 当前小程序 pending 运行包候选（ad793c80）

> 本记录描述 `ad793c80` 生成的 pending 运行包。它尚未发布到微信开发者工具、线上服务或真机，不代表真实业务验收通过。

## 候选事实

| 项目 | 当前值 |
| --- | --- |
| 小程序源码提交 | `ad793c80b0d05b74ee0cee76058b32bd25b4ce38` |
| pending 位置 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 20 |
| pending 来源 | `build-info.json.sourceRevision` |
| 真机证据清单 | [`device-evidence-ad793c8-pending.json`](device-evidence-ad793c8-pending.json)，9 个域均为 `pending` |
| 服务端候选 | `b42922f`，尚未与线上旧 release 切换 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍被微信开发者工具占用 |

## 本批迁移覆盖变更

- 统一状态页现在同时展示迁移阶段、旧端入口、业务域、所属 A–F 批次和该批次下一步输入；
- 健康内容单独归入 B，医保/支付/HIS 回写单独归入 F，避免不同风险业务共用一个迁移状态；
- 状态入口仍只展示迁移边界，不调用未确认 Provider、不恢复外部 WebView、不发起支付或患者写入；
- 没有修改旧 Python 服务、旧数据库、旧 Redis 或另一会话负责的众阳预约适配器。

## 本地验证

- `pnpm --filter @hospital/miniprogram typecheck`：通过；
- 当前小程序测试：`279 pass / 0 fail / 3031 expect()`；
- `pnpm migration:breadth:audit`：通过，20 个注册页面的 WXML 事件闭环和 4 个主 Tab 通过；
- `pnpm migration:boundary:audit`：通过，34 个冻结入口 gate 通过；
- `pnpm readonly:audit`：通过，5 个低风险业务域的页面、API、日志和文档闭环通过；
- `pnpm --filter @hospital/miniprogram runtime:verify:pending`：通过，20 个页面脚本和根文件完整；
- `pnpm --filter @hospital/miniprogram build`：源码编译和 pending 生成完成，但发布到 live `dist/` 时因微信开发者工具锁返回 `EBUSY`，旧运行包保留未变；
- `pnpm format:check`、`pnpm lint`：通过。

## 发布与验收边界

关闭当前微信开发者工具窗口和真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后才能使用本候选重新生成二维码并采集九域真机证据。旧 live `dist/` 未被替换前，不能把
本候选代码测试、pending 验证或页面状态页当作微信业务完成证据。
