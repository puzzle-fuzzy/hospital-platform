# 服务端候选 `14fcce5`：健康知识 staging 导入门禁（2026-08-25）

> 本记录只描述健康知识 bundle 的受控 staging 导入工具，不代表健康百科已经生产发布，
> 也不代表患者端健康 API、临床自测或评分规则已经开放。本次没有修改旧 Python 服务、旧数据库、旧 Redis
> 或线上运行包，也没有触碰另一会话负责的众阳预约适配器。

## 当前来源

| 项目 | 值 |
| --- | --- |
| Git 提交 | `14fcce5c` |
| 导入命令 | `pnpm --filter @hospital/persistence health:import-staging -- --confirm-staging <bundle.json>` |
| 允许环境 | `DEPLOY_ENV=staging` |
| 写入范围 | `hp_health_knowledge_publications`、`items`、`details`、`relations` |
| 生产状态 | 未导入、未发布、患者端 route gate 继续关闭 |

## 实现边界

- bundle 在创建 MySQL 连接池前先通过领域层白名单、版本、审核状态、时间窗口、详情完整性和关系约束校验；
- 命令必须同时收到 `DEPLOY_ENV=staging` 和显式 `--confirm-staging`，拒绝生产环境、未知参数、多个文件和命令行数据库覆盖；
- publication、items、details、relations 在一个事务中写入，任意 SQL 或外键错误自动回滚；
- Pino 只记录内容版本、审核状态、数量和固定错误分类，不记录文件路径、连接串、正文、患者字段、SQL 或异常原文；
- staging 导入成功不等于审核通过，不会自动打开患者端 API，也不会替代发布/撤回演练。

## 已通过的门禁

```text
pnpm --filter @hospital/persistence typecheck   通过
pnpm --filter @hospital/persistence test        102 pass / 0 fail / 631 expect()
pnpm --filter @hospital/domain test              72 pass / 0 fail / 155 expect()
pnpm architecture:audit                         68 条规则通过
pnpm provider:audit                              4 records / 31 doc IDs 通过
pnpm readonly:audit                              5 domains / 8 pages / 8 routes 通过
pnpm logging:audit                               84 个静态日志事件通过
pnpm docs:audit                                  689 个文档无断链
pnpm format:check                                304 个文件通过
pnpm lint                                        305 个文件通过
git diff --check                                 通过
```

全仓 `pnpm test` 当前仍被既有发布基线保护门禁阻断：线上服务仍为 `8eb51b5f`，
而该 release 之后存在尚未部署的运行时代码，其中包含另一会话负责的众阳预约适配器。
本次健康导入改动没有引入新的业务测试失败；在统一候选发布前，不修改该适配器，也不降低发布基线门禁。

## 执行前提

执行 staging 导入前必须取得审核 bundle、来源指纹、内容负责人、生效/撤回记录和目标 staging 数据库凭据，
并按 [`../migration/health-knowledge-import-runbook.md`](../migration/health-knowledge-import-runbook.md) 先做只读校验。
当前没有执行真实 bundle 导入；生产数据库和线上服务保持不变。
