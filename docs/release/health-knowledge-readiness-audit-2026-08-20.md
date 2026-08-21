# 健康知识域上线准入审计（2026-08-20）

> 本文只记录新项目当前代码和内容准入状态，不代表健康知识已经上线。
> 本轮没有导入旧库正文、修改 MySQL、打开患者路由、修改旧 Python 服务或制作小程序页面。

## 1. 当前事实

新项目已经具备以下工程基础：

- `packages/domain/src/knowledge.ts`：已审核内容的公共读模型、固定免责声明和查询参数校验；
- `packages/domain/src/knowledge-import.ts`：版本、发布状态、审核引用、时区、完整详情集和关系引用校验；
- `packages/persistence/migrations/0010_health_knowledge.sql`、`0011_health_knowledge_versioned_keys.sql`：版本化内容表和外键边界；
- `packages/persistence/src/health-knowledge-import.ts`：单事务导入，验证或 SQL 失败时回滚；
- `packages/persistence/src/mysql-health-knowledge-repository.ts`：只选择同一个 `published` 版本，拒绝草稿/撤回内容；
- `apps/api/src/modules/knowledge`：只读 service、响应 contract 和旧端路径映射，但模块尚未挂载到公共 API；
- 健康知识 service 会在日志和响应前重新校验 repository 读模型，并只投影已冻结的患者端字段；详情返回的 opaque id 必须与请求 id 一致；异常只记录有限 `resultViolation`，统一映射为持久化错误；
- `apps/api/src/app.test.ts`：验证健康知识路由在审核内容就绪前保持未注册。

## 2. 当前缺失的上线证据

本轮对新仓库进行文件盘点，只发现 schema、domain、repository、导入器、测试和文档，没有发现可供发布的脱敏内容 bundle。
这不能推断线上数据库一定为空，但说明当前代码仓库没有足够材料安全执行导入。以下证据仍缺失：

1. 旧库脱敏导出、总数/关系数/孤儿引用报告和转换映射；
2. 每个内容版本的来源、审核人、审核时间、固定免责声明和责任确认；
3. staging 的 draft → published、撤回、重新发布和缓存失效演练；
4. 患者端列表、疾病详情、药品详情的字段白名单与人工内容复核；
5. 真实 MySQL publication 读模型、健康知识 API、公网和小程序页面证据。

## 3. 业务结论

当前不能把以下事实混为“健康知识已迁移”：

- migration 已创建内容表 ≠ 已有审核内容；
- domain 测试通过 ≠ 医学正文正确；
- repository 可以读取 fixture ≠ 生产存在可发布版本；
- service 已实现 ≠ 患者 API 已开放；
- HTTP 200 或页面能渲染 ≠ 内容经过审核且可追溯。

因此当前继续保持：

- `/api/v1/knowledge/*` 不挂载；
- 不把旧 `/knowledge/health/*` 直接转发给小程序；
- 不导入旧正文、不使用默认 fixture 冒充生产内容；
- 不把健康知识、自测、风险评估、AI 导诊和报告解读共用一个成功状态；
- 不在患者端返回审核人、内部备注、草稿或撤回版本。

## 4. 下一步准入顺序

```text
脱敏导出与责任确认
  -> 生成不可变 content bundle
  -> domain validator 与关系完整性报告
  -> staging 单事务导入
  -> published/withdrawn/重新发布演练
  -> API response 白名单与日志审计
  -> 小程序阅读和免责声明验收
  -> 受控生产发布
```

在第一步材料到达前，不新增患者端页面或路由。内容责任人提供材料后，必须先更新
[`migration/health-knowledge-content-mapping.md`](../migration/health-knowledge-content-mapping.md) 和
[`adr/0004-health-knowledge-content-boundary.md`](../adr/0004-health-knowledge-content-boundary.md)，再进入代码实现。

## 5. 本轮代码证据

- 健康知识 domain、导入器和 repository 定向测试通过；
- 健康知识 repository 结果的运行时校验、重复项拒绝、额外字段丢弃和低敏日志测试通过；
- API 的“审核内容未就绪时路由保持未注册”测试通过；
- `pnpm architecture:audit` 的健康知识路由/导入事务规则通过；
- 本轮没有 Provider 调用、医疗内容导入或任何线上写入。

## 6. 导入与读取文本边界复核（2026-08-20）

对照旧端 `knowledge_disease`、`knowledge_drug` 的 `LONGTEXT` 字段和疾病详情页
`whitespace-pre-line` 展示方式，确认审核正文中的内部换行是合法的患者展示内容；它不能
因为是控制字符就被读取层一概拒绝。

本轮已统一导入器和读模型的边界：

- 标识、名称、来源和发布元数据仍只允许单行安全文本；
- 疾病/药品正文允许保留 CR/LF，保证导入后与小程序分段展示一致；
- 制表符、NUL、DEL 等其它不可见控制字符仍在导入前拒绝，避免提交后才在读取层失败；
- 新增 domain 回归测试覆盖“换行可读、隐藏控制字符拒绝”。

这只是代码一致性修正，不代表已经获得医学内容来源、审核责任或真实数据库发布资格；健康知识
API 仍保持未挂载，真实内容导入和患者页面验收门禁不变。

## 7. 版本内关系类别复核（2026-08-20）

健康知识表使用 `(content_version, item_id)` 复合外键，只能证明引用条目在同一版本存在，不能单独证明
它是 `part`、`symptom`、`crowd`、`department` 还是 `drug`。因此 repository 读取关系时增加了同版本
`item_kind` 约束：部位必须关联部位、症状必须关联症状、分类关系必须匹配关系种类，疾病详情中的药品引用
必须关联药品条目。

药品关系的 `is_clickable` 也只接受数据库布尔值的 `0/1`（或驱动明确返回的布尔值）；未知字符串或数字
会整次读取失败，不能静默转换成 `false`。这与导入器的关系类别校验共同形成“写入前 + 读取时”两道边界，
且不改变当前健康知识 API 未挂载、无真实内容发布的准入状态。

## 8. HTTP 查询参数准入复核（2026-08-20）

旧端症状查询使用 `symptoms_ids`，新端模块使用 `symptomIds`。新端尚未挂载，因此没有
“兼容旧客户端”的要求；当前选择将 `symptomIds` 作为唯一 canonical 参数，拼写错误或
缺失参数直接失败，不把两个命名混合后猜测业务语义。后续原生小程序接入必须按新 contract
生成重复 query key；若要保留旧客户端，另立 compatibility route 和退场计划。

## 9. JSON 导入运行时边界复核（2026-08-21）

本轮没有新增健康知识正文，也没有执行数据库导入；只补齐了导入入口的运行时边界：

- `validateHealthKnowledgeImportBundle` 现在先按 `unknown` 解析 JSON，再执行版本、时区、关系和完整详情集校验；
- 缺失对象/数组、错误类型和未知字段会统一返回字段路径，不再先抛普通 `TypeError`；
- `patientName`、身份证号等不在 contract 内的字段不会被静默丢弃，而是在导入前拒绝；
- `pnpm --filter @hospital/domain knowledge:bundle:check -- <file>` 只读文件并输出低敏摘要，不连接 MySQL/Redis、不执行 migration、不写库；
- `packages/persistence/src/health-knowledge-import.ts` 的单事务和路由未挂载边界保持不变。

这项改动只提高“内容进入 SQL 之前”的确定性，不能替代旧库脱敏、医学审核、staging 发布演练或患者端真机验收。
