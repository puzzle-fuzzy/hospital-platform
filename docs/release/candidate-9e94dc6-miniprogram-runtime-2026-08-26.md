# 小程序运行包候选 `9e94dc6`（2026-08-26）

## 当前结论

本候选在上一候选的安全边界基础上，修正健康百科和报告详情的迁移台账映射：已有原生安全子集现在会被统一覆盖视图标记为 `partial`，不会误报为新端新增入口；健康百科仍由独立的 B 批次审核 bundle 队列控制，报告详情仍保持 LIS 受限只读边界。

候选已完成 TypeScript 编译、页面边界校验、运行包依赖校验、来源指纹写入和
`runtime:verify:pending`。原子切换到 live `dist` 时，微信开发者工具仍持有文件锁；
发布器拒绝替换，旧的完整运行包未被删除，候选保存在
`.local/hospital-miniprogram/pending`。

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `9e94dc6732a032b1e2f19da21047b49845e08a91`（`9e94dc6`） |
| 页面数量 | 40 |
| pending 运行文件 | 391 |
| 小程序回归 | `321 pass / 0 fail / 3600 expect()` |
| `runtime:verify:pending` | 通过，40 个页面和根文件完整 |
| 真机证据清单 | [`device-evidence-9e94dc6-pending.json`](device-evidence-9e94dc6-pending.json)，9 个域均为 `pending` |
| 当前 live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`（`02dbf10`） |
| 原子发布 | 被微信开发者工具 `EBUSY` 锁保护阻止，未覆盖 live |
| 旧服务影响 | 无；未修改旧 Python 服务、数据库、Redis、线上进程或众阳适配器 |

## 候选包含的业务边界修正

- 健康百科和报告详情的旧端入口已绑定对应 `featureKey`，统一覆盖视图能准确显示已有的 `partial` 安全子集；
- 健康百科仍属于独立的 B 批次审核 bundle，不混入通用冻结 gate；
- 微信资料拒绝后保留可重试的设置页授权语义；
- 患者目录刷新期间保留并发与会话边界；
- “我的快递”将患者读取加载、失败和物流未开放空态分开，固定记录区域高度；
- 仍不开放物流 Provider、临床 Provider、支付、医保、患者写入、外部 WebView 或真实临床结论。

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
