# 小程序运行包候选 `317350e0`（2026-08-26）

## 当前结论

本候选继续沿用全量入口覆盖和 fail-closed 业务边界，修正电子锦旗与表扬信
共享页面的记录状态机：患者目录读取期间显示固定高度加载态，读取失败显示
固定高度错误态，只有患者读取成功后才显示“公开记录暂未开放”。这两个页面
仍然不发起 Provider 查询、不提交内容，也不把关闭态写成业务完成。

候选已完成 TypeScript 编译、页面边界校验、运行包依赖校验、来源指纹写入和
`runtime:verify:pending`。原子切换到 live `dist` 时，微信开发者工具仍持有文件锁；
发布器拒绝替换，旧的完整运行包未被删除，候选保存在
`.local/hospital-miniprogram/pending`。

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `317350e003d2243c48c38e17de11e45cc3cdada2`（`317350e0`） |
| 页面数量 | 40 |
| pending 运行文件 | 391 |
| 小程序回归 | `324 pass / 0 fail / 3608 expect()` |
| `runtime:verify:pending` | 通过，40 个页面和根文件完整 |
| 真机证据清单 | [`device-evidence-317350e0-pending.json`](device-evidence-317350e0-pending.json)，9 个域均为 `pending` |
| 当前 live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`（`02dbf10`） |
| 原子发布 | 被微信开发者工具 `EBUSY` 锁保护阻止，未覆盖 live |
| 旧服务影响 | 无；未修改旧 Python 服务、数据库、Redis、线上进程或众阳适配器 |

## 候选包含的业务边界修正

- 电子锦旗和表扬信记录区域共享加载、错误、未开放三态，并保持固定高度，避免状态切换造成卡片跳变；
- 患者目录失败时不再同时展示“公开记录暂未开放”，避免把服务故障伪装成空记录；
- 健康百科和报告详情的旧端入口仍绑定对应 `featureKey`，统一覆盖视图准确显示已有安全子集；
- 微信资料拒绝后仍保留可重试的设置页授权语义；
- 患者目录刷新期间仍保留并发与会话边界；
- 仍不开放物流 Provider、锦旗/表扬信 Provider、临床 Provider、支付、医保、患者写入、外部 WebView 或真实临床结论。

## 发布前提

必须先关闭正在使用 `E:\__Super_Core__\hospital-platform\apps\miniprogram\dist\`
的微信开发者工具项目和真机调试，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:verify:pending
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

不能手工复制 pending 文件、删除 live `dist` 或只替换 `build-info.json`。发布成功后
仍需重新生成二维码并采集页面、客户端 `requestId`、Elysia/Pino 日志及适用的 Provider
请求号；静态运行包通过不等于真机业务验收完成。
