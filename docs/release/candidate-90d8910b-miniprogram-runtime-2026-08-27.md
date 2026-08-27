# 小程序候选运行包 `90d8910b`（2026-08-27）

## 当前结论

本候选由提交 `90d8910bdc54d48dde66c4ff03a7434c182ebd92` 构建，包含 `app.json` 注册的 40 个页面。
它已通过小程序 TypeScript 检查、页面回归、全仓 build 和运行包完整性校验，并原子发布到
`apps/miniprogram/dist/` live 目录。该事实只证明本地运行包来源，不能证明微信线上版本已经上传，也不能替代真机业务验收。

本候选配套服务端 `90d8910bdc54d48dde66c4ff03a7434c182ebd92` 已安全切换到新 Elysia release；旧 Python 服务、旧数据库和旧 Redis 未修改。

## 本候选修正

- 健康知识导入器、领域读模型和 MySQL 读模型共用明确的字段长度常量，阻止导入成功后读取失败。
- 疾病目录对超过 10,000 字的症状正文省略列表摘要，完整正文只在详情接口提供，不对医学正文做静默截断。
- 健康知识公共 contract 现在拒绝可选医学字段空字符串，并要求可点击药品引用携带 `drugId`。
- 微信原生 `tabBar` 仍是四个主页面唯一底栏；没有新增页面级底栏或第二套 selected 状态。

## 构建与验证

| 项目 | 结果 |
| --- | --- |
| 运行输入来源 | `90d8910bdc54d48dde66c4ff03a7434c182ebd92`（`90d8910b`） |
| 页面数量 | 40 |
| 小程序回归 | `337 pass / 0 fail / 3702 expect()` |
| TypeScript | 通过 |
| 全仓 build | 通过 |
| `runtime:verify` | 通过，live `dist` 来源为 `90d8910b` |
| 真机证据 | 仍为 pending；当前没有运行中的开发者工具/真机会话 |

新的九域证据清单为 [`device-evidence-90d8910b-pending.json`](device-evidence-90d8910b-pending.json)。没有真机会话时只能保持 `pending`，不能用构建、静态测试或服务器 readiness 代替截图、客户端 `requestId`、服务端 trace 和 Provider 低敏请求号。

## 下一步

从本文件对应的 `apps/miniprogram/dist/` 独立工程普通编译并生成新二维码，按九域清单逐项采集页面、客户端 requestId、服务端 Pino traceId 和 Provider 低敏请求号。健康百科正式审核 bundle 缺失时，健康内容接口继续 fail-closed；不得把当前代码 ready 写成内容业务已开放。
