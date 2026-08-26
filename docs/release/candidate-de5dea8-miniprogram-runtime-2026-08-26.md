# 小程序运行包候选 `de5dea8`（2026-08-26）

## 当前结论

本候选已经完成 TypeScript 编译、页面边界校验、运行包依赖校验和来源指纹写入，
并通过 `runtime:verify:pending`。原子切换到 live `dist` 时，微信开发者工具持有
`dist` 文件锁，发布器按设计拒绝替换；旧的完整运行包未被删除，候选保存在
`.local/hospital-miniprogram/pending`，等待关闭开发者工具后再发布。

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `de5dea8df249c2fd1e122df4508bcd6cbb3852a7`（`de5dea8`） |
| 页面数量 | 40 |
| pending 运行文件 | 389 |
| `runtime:verify:pending` | 通过，40 个页面和根文件完整 |
| 真机证据清单 | [`device-evidence-de5dea8-pending.json`](device-evidence-de5dea8-pending.json)，9 个域均为 `pending` |
| 当前 live 运行包 | `02dbf10419740d96c4445493df019021ac22bcfa`（`02dbf10`） |
| 原子发布 | 被微信开发者工具 `EBUSY` 锁保护阻止，未覆盖 live |
| 当前 pending | 保留，等待关闭工具后执行原子发布 |
| 旧服务影响 | 无；未修改旧 Python 服务、数据库、Redis、线上进程或众阳适配器 |

## 候选包含的业务边界修正

- 便民页面统一患者目录错误语义；
- 临床/服务/外部关闭态页面统一共享患者上下文错误语义；
- 未绑定、选择过期、医院映射缺失、依赖未配置、数据服务异常和登录失效
  不再由不同页面各自猜测或漏处理；
- 本候选仍不开放 Provider、支付、医保、写入、外部 WebView 或真实临床结论。

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
