# 小程序候选运行包 `f1b8b61`（2026-08-27）

## 当前结论

本候选由提交 `f1b8b61609e0560d3da3fe176f62ab3585b6ee98` 构建，包含 `app.json` 注册的 40 个页面。
它已通过小程序 TypeScript 检查、完整页面回归、运行包完整性校验和来源校验，并原子发布到
`apps/miniprogram/dist/` live 目录。该事实只证明本地运行包来源，不能证明微信线上版本已经上传，也不能替代真机业务验收。

本候选只更新报告目录的失效 WXML 事件门禁；线上服务端继续使用
`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，旧 Python 服务、旧数据库和旧 Redis 未修改。

## 本候选修正

- 报告目录事件先按当前渲染批次回查 `viewKey`；找不到报告时静默丢弃，不再把刷新或患者切换前的失效点击误判为“详情未开放”。
- 当前报告存在时，仍先校验当前患者和会话代际；只有上下文有效但服务端没有发放短期 `reportId` 时，才进入报告详情关闭态。
- 自动化门禁固定了“失效事件 → 患者上下文 → 短期详情引用”的判定顺序，并保留中文注释说明旧事件不能获得详情路由资格。

## 构建与验证

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `f1b8b61609e0560d3da3fe176f62ab3585b6ee98`（`f1b8b61`） |
| 页面数量 | 40 |
| 小程序回归 | `338 pass / 0 fail / 3710 expect()` |
| TypeScript | 通过 |
| `runtime:verify` | 通过，live `dist` 来源为 `f1b8b61` |
| 真机证据 | 仍为 pending；当前没有运行中的开发者工具/真机会话 |

新的九域证据清单为 [`device-evidence-f1b8b616-pending.json`](device-evidence-f1b8b616-pending.json)。没有真机会话时只能保持 `pending`，不能用构建、静态测试或服务器 readiness 代替截图、客户端 `requestId`、服务端 trace 和 Provider 低敏请求号。

## 下一步

从本文件对应的 `apps/miniprogram/dist/` 独立工程普通编译并生成新二维码，按九域清单逐项采集页面、客户端 requestId、服务端 Pino traceId 和适用的 Provider 低敏请求号。报告详情仍是受限只读边界；支付、医保、预约写入和 HIS 回写必须等待独立 contract 与真实证据。
