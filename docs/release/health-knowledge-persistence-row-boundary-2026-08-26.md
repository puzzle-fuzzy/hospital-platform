# 健康知识持久化行边界复核（2026-08-26）

## 结论

本轮继续推进健康内容的工程基础，但没有开放健康百科内容，也没有修改旧项目、旧数据库、Redis、线上服务或
健康知识数据。修正仅针对新 Elysia 的 MySQL repository：数据库坏行现在稳定归类为持久化读模型错误。

## 原有风险

健康知识 repository 读取 MySQL 行后会调用日期解析、`.trim()` 和领域校验。TypeScript 的行类型不能约束真实
数据库返回值；如果 `reviewed_at`、目录名称或可选正文变成数组/对象，原实现可能抛出普通 `TypeError`，或者让
发布元数据的领域校验错误直接进入 API 的查询参数 400。两种结果都会破坏运维判断：前者缺少固定违规原因，后者
会把服务端内容损坏误导成患者请求错误。

## 本轮处理

`packages/persistence/src/mysql-health-knowledge-repository.ts` 现在：

- 在日期、发布元数据、目录和首字母映射前检查运行时基本类型。
- 将发布行校验失败统一投影为 `HealthKnowledgeResultValidationError("publication-invalid")`。
- 将目录行坏值统一投影为 `catalog-item-invalid`/`letter-item-invalid`，将可选详情字段的异常形状投影为固定
  `document-item-invalid`。
- 保留 Provider/健康内容的 fail-closed 语义，不把坏行过滤后伪装成成功空列表。

## 回归证据

- `pnpm --filter @hospital/persistence test src/mysql-health-knowledge-repository.test.ts`：9 pass / 0 fail / 26 expect
- `pnpm --filter @hospital/persistence typecheck`：通过
- 新增回归覆盖：坏发布时间、坏目录名称必须产生 `HealthKnowledgeResultValidationError`。
- 当前正式审核 bundle 仍不存在，健康知识路由继续保持 `fail-closed`；本轮没有导入、发布或撤回任何内容。

下一步仍需内容责任人处理旧源快照的控制字符、重复关系和审核元数据，再进行 staging bundle 校验和发布/撤回演练；
不能用本轮 repository 代码通过来替代临床审核或真机验收。
