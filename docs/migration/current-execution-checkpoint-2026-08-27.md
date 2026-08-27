# 当前执行检查点（2026-08-27）

> 本文是当前工作树的执行事实入口，优先于本仓库中同一天之前生成的历史候选记录。
> 它记录代码、运行包、线上 release 和真实业务证据的边界，不把其中任意一项
> 推断成另一项。

## 本轮会话恢复复核（2026-08-27）

本轮开始时没有正在运行的微信开发者工具或真机会话；随后已重新打开当前
`apps/miniprogram/dist/` 独立工程，模拟器加载正常，并确认控制台打印的运行包来源为
`805c54ea9fa943385ad6feebed1401d521fbad3c`。随后通过“二维码真机调试”生成了当前候选的
iOS 调试二维码，但截至本检查点尚未观察到手机扫码连接，因此不填写真机结果，也不把二维码
生成本身当作业务验收证据。已完成不依赖真机的复核：

- `pnpm migration:breadth:audit`：40 个原生页面、4 个主 Tab、2 个 action 页面和 14 个状态页入口通过；
- `pnpm migration:readiness`：旧端 64 个入口全部登记，5 个低风险域代码就绪但真实证据为 `0/5`；
- `pnpm clinical:contract:audit`：4 个临床域继续保持 `normalized / unregistered`；
- `pnpm provider:audit`：4 份 Provider 接收记录、31 个 `documentId` 的来源和脱敏边界通过；
- `pnpm docs:audit`、`pnpm release:baseline:audit`：文档无断链，线上 API `b44421cd` 与小程序 live `805c54e` 基线一致。

本轮没有修改旧项目、旧 Python 服务、旧数据库或旧 Redis。后续若没有正式健康审核
bundle、临床/患者/外部 contract，不能通过继续写页面的方式替代业务材料；当前下一项实际动作
是等待手机扫码后，使用本二维码会话进行当前 live 小程序的真机三层取证。

## 当前来源与范围

| 项目 | 当前事实 | 结论 |
| --- | --- | --- |
| 当前 Git 工作树 | 当前 `main`（提交以 `git rev-parse HEAD` 为准）；本轮 API 运行时代码变更来源为 `eb4d2eb4`、`4e1e53ed` | 已提交并推送到 `origin/main` |
| 线上新 API | `b44421cd321ff9ff23eeb49b12641d1772d2bdc1` | 仍为已部署 release |
| 本地小程序 live `dist` | `805c54ea9fa943385ad6feebed1401d521fbad3c` | 与当前小程序运行包一致 |
| 旧 Python 服务 | `0.0.0.0:8001` | 本轮未修改、未停止 |
| 旧项目、旧 MySQL、旧 Redis | 不在本轮写入范围 | 本轮未操作 |

本轮 API 运行时代码变更 `eb4d2eb4` 包含健康知识服务的直调关系查询白名单：进入 repository 之前只接受
`kind` 和 `id`，未知字段返回稳定的查询校验错误；`4e1e53ed` 又为这条失败链补充固定枚举
`validationReason`，便于排障而不记录查询值。此前 `927b90cf` 已将健康知识路由的认证顺序和未知
query 参数边界固定下来。这些提交已随 `b44421cd321ff9ff23eeb49b12641d1772d2bdc1` 完成远端
API-only 发布；代码发布事实与真实 Provider/真机业务证据仍然分开记录。

## 门禁结果

已完成并通过：

- 健康知识 API 定向测试：9 项通过，0 失败；
- 全仓格式检查和 Biome lint；
- `pnpm typecheck`：9/9 workspace 通过；
- `pnpm test`：9/9 workspace 通过，API 216 项通过、0 失败；
- `pnpm build`：9/9 workspace 通过；
- 迁移、导航、患者展示、临床关闭态、只读域、Provider 材料、文档和日志静态审计。

`pnpm check:candidate` 已通过；API-only 发布完成后，`pnpm release:baseline:audit` 也已通过，确认
`b44421cd321ff9ff23eeb49b12641d1772d2bdc1` 已覆盖本轮服务端运行时代码，没有未部署运行时漂移。
该门禁仍不替代真实 Provider、微信真机或支付业务证据。

## 当前迁移状态

- 旧端 64 个页面均已登记，新端 40 个原生页面均有落点；
- 当前 5 个低风险域已有代码闭环：患者目录、预约目录/历史、报告受限只读、门诊费用只读、普通资料；
- 这 5 个域的真实业务证据仍为 `0/5`，九个真机证据域仍全部为 `pending`；
- 健康百科虽有只读 API 和页面，但正式审核 bundle 不存在，源快照仍 `not-approved`，继续 fail-closed；
- C 临床、D 患者/便民写入、E 外部入口、F 支付/医保/HIS 回写继续关闭；
- 不能把页面落点、类型测试、服务 smoke 或数据库 readiness 当作 Provider、真机或支付成功。

## 下一步固定顺序

1. API-only 发布已完成；后续若发生业务层回归，只回滚新 API `current`，不停止旧 Python `8001`。
2. 当前开发者工具已恢复并已生成二维码；待手机扫码后，先核对 `805c54ea9fa943385ad6feebed1401d521fbad3c`，再采集四 Tab、患者显式切换、预约历史/爽约、门诊费用和普通资料的三层证据：页面、客户端 `requestId`、服务端 Pino/Provider 低敏关联。
3. 收到正式审核 bundle、临床 contract、患者写入 contract、外部会话 contract 后，再按 B/C/D/E 独立准入；支付/医保/HIS 回写最后处理。

## 禁止事项

- 不把当前 `main`、小程序本地 `dist` 或运行层 smoke 直接写成微信线上或真实业务已验收事实；
- 不为了通过发布基线而回退安全校验、修改审计器或部署半套 API；
- 不把旧 Python 的 FSI、医保、微信授权或数据库内容复制到新端的未经确认路径；
- 不在缺少正式业务 contract 时新增患者写入、二维码、WebView、支付、医保或 HIS 回写接口。
