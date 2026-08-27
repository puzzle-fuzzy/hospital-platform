# 当前执行检查点（2026-08-27）

> 本文是当前工作树的执行事实入口，优先于本仓库中同一天之前生成的历史候选记录。
> 它记录代码、运行包、线上 release 和真实业务证据的边界，不把其中任意一项
> 推断成另一项。

## 当前来源与范围

| 项目 | 当前事实 | 结论 |
| --- | --- | --- |
| 当前 Git 工作树 | 当前 `main`（提交以 `git rev-parse HEAD` 为准）；API 运行时代码变更来源为 `eb4d2eb4` | 已提交并推送到 `origin/main` |
| 线上新 API | `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240` | 仍为已部署 release |
| 本地小程序 live `dist` | `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328` | 与当前小程序运行包一致 |
| 旧 Python 服务 | `0.0.0.0:8001` | 本轮未修改、未停止 |
| 旧项目、旧 MySQL、旧 Redis | 不在本轮写入范围 | 本轮未操作 |

本轮 API 运行时代码变更 `eb4d2eb4` 包含健康知识服务的直调关系查询白名单：进入 repository 之前只接受
`kind` 和 `id`，未知字段返回稳定的查询校验错误。此前 `927b90cf` 已将健康知识
路由的认证顺序和未知 query 参数边界固定下来。两次提交都属于新 API 运行时代码，
因此在远端 API-only 发布完成之前，不能把它们写进线上 release 的事实。

## 门禁结果

已完成并通过：

- 健康知识 API 定向测试：8 项通过，0 失败；
- 全仓格式检查和 Biome lint；
- `pnpm typecheck`：9/9 workspace 通过；
- `pnpm test`：9/9 workspace 通过，API 215 项通过、0 失败；
- `pnpm build`：9/9 workspace 通过；
- 迁移、导航、患者展示、临床关闭态、只读域、Provider 材料、文档和日志静态审计。

`pnpm check` 当前不会整体通过，唯一阻断是 `release:baseline:audit`：它检测到
线上 release `1bc8b0a8` 之后新增的未部署运行时代码为：

- `apps/api/src/modules/knowledge/index.ts`
- `apps/api/src/modules/knowledge/service.ts`

这是发布前安全阻断，不是把检查器改绿的理由，也不是旧服务故障。发布前不能手工
修改线上 release 文档来掩盖该差异。

## 当前迁移状态

- 旧端 64 个页面均已登记，新端 40 个原生页面均有落点；
- 当前 5 个低风险域已有代码闭环：患者目录、预约目录/历史、报告受限只读、门诊费用只读、普通资料；
- 这 5 个域的真实业务证据仍为 `0/5`，九个真机证据域仍全部为 `pending`；
- 健康百科虽有只读 API 和页面，但正式审核 bundle 不存在，源快照仍 `not-approved`，继续 fail-closed；
- C 临床、D 患者/便民写入、E 外部入口、F 支付/医保/HIS 回写继续关闭；
- 不能把页面落点、类型测试、服务 smoke 或数据库 readiness 当作 Provider、真机或支付成功。

## 下一步固定顺序

1. 在明确的发布窗口内，只发布当前仓库 `main` 的新 API，先用 `git rev-parse HEAD` 固定候选，再按 systemd 原子切换、preflight、隔离 smoke、readiness 和旧端共存检查执行；不停止旧 Python `8001`。
2. 只有远端 `current`、公网运行检查和 release 文档都确认后，重新运行 `pnpm release:baseline:audit`；不得先改文档再验收。
3. 从当前 live 小程序 `dist` 重新普通编译并生成二维码，采集四 Tab、患者显式切换、预约历史/爽约、门诊费用和普通资料的三层证据：页面、客户端 `requestId`、服务端 Pino/Provider 低敏关联。
4. 收到正式审核 bundle、临床 contract、患者写入 contract、外部会话 contract 后，再按 B/C/D/E 独立准入；支付/医保/HIS 最后处理。

## 禁止事项

- 不把当前 `main`、`eb4d2eb4` 或本地 `dist` 直接写成线上已发布事实；
- 不为了通过发布基线而回退安全校验、修改审计器或部署半套 API；
- 不把旧 Python 的 FSI、医保、微信授权或数据库内容复制到新端的未经确认路径；
- 不在缺少正式业务 contract 时新增患者写入、二维码、WebView、支付、医保或 HIS 回写接口。
