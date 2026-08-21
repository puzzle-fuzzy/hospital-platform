# 健康知识 service 输入边界审计（2026-08-21）

> 本文只记录新项目健康知识领域的代码和本地验证，不代表健康知识内容已经审核发布、API 已上线或小程序已经验收。
> 本轮没有导入医疗正文、修改线上数据库、挂载患者路由或修改旧 Python 服务。

## 1. 本轮发现

健康知识 HTTP 路由已经限制分类、路径参数和症状数组，但 `HealthKnowledgeService` 原先主要依赖 TypeScript 类型，
直接调用 service 时没有统一验证以下输入：

- 健康知识目录分类；
- 疾病关联的 `kind/id` 对象；
- 部位、疾病和药品的 opaque ID；
- 症状 ID 数组的类型、数量、重复值和控制字符。

组合根、回放任务或未来管理端若绕过 HTTP 传入坏值，可能把它们交给 repository，导致错误查询、异常 SQL 边界或把空结果
误认为“没有健康知识”。这与预约、报告 service 的未知字段风险属于同一类“编译期 contract 不能代替运行时 contract”问题。

## 2. 修正内容

### 2.1 领域层分类校验

`packages/domain/src/knowledge.ts` 新增 `validateHealthKnowledgeCatalogKind`：

- 只接受 `crowd`、`department`、`part`；
- 未知值返回固定的 `invalid_catalog_kind`，不把原始值放入异常或日志；
- 校验放在 domain，供 API service 和其它未来入口复用。

### 2.2 service 层输入门禁

`apps/api/src/modules/knowledge/service.ts` 在 repository 调用前校验所有只读入口：

- 目录分类；
- 疾病关联对象的结构、分类和 ID；
- 部位 ID、疾病 ID、药品 ID；
- 症状数组的数组形状、最大数量、重复值和每个 ID。

校验放在统一 `read` 日志范围内，因此非法输入仍会留下 `health-knowledge.read.requested` 与固定原因的
`health-knowledge.read.failed`，同时 repository 调用次数保持为零。中文注释说明了为什么不能只在 HTTP 层校验。

## 3. 保持的业务边界

1. 健康知识仍是已审核内容的只读域，不接收患者、Provider 或 AI 参数。
2. repository 仍只读取同一 `published` 版本；草稿、撤回版本、内部审核字段和原始内容不会进入患者端。
3. 导入器仍使用单事务和发布审核门禁；本轮没有执行导入，也没有使用 fixture 冒充真实内容。
4. `apps/api/src/modules/knowledge` 仍未挂载到公共 API，健康百科、自测、风险评估、AI 导诊和报告解读继续独立处理。
5. 没有内容来源、脱敏 bundle、临床审核、staging 发布/撤回演练和患者页面证据时，不打开健康知识 gate。

## 4. 本地验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/api test src/modules/knowledge/service.test.ts src/modules/knowledge/index.test.ts` | 6 pass，24 个断言 |
| `pnpm --filter @hospital/domain test src/knowledge.test.ts src/knowledge-import.test.ts` | 15 pass，31 个断言 |
| `pnpm --filter @hospital/persistence test src/mysql-health-knowledge-repository.test.ts src/health-knowledge-import.test.ts` | 9 pass，33 个断言 |
| `pnpm --filter @hospital/api typecheck` | 通过 |
| `pnpm exec biome check packages/domain/src/knowledge.ts packages/domain/src/index.ts apps/api/src/modules/knowledge/service.ts apps/api/src/modules/knowledge/service.test.ts` | 通过 |

这些证据证明输入门禁、导入校验、repository 版本边界和 HTTP 模块测试一致，但不证明医疗内容正确，也不替代真实发布和真机验收。

## 5. 变更隔离与下一步

- 未修改旧 Python 项目、旧端口 `8001`、旧数据库或旧 Redis。
- 未导入健康知识内容，未挂载 API，未制作患者端健康知识页面。
- 未修改并行会话的 `apps/miniprogram/project.config.json` 和 `.codegraph/`。
- 下一步仍是由内容责任人提供脱敏 bundle、审核记录和 staging 发布/撤回证据；材料到达前不新增患者端入口。
