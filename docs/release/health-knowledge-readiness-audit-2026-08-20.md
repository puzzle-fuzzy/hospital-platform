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
- 健康知识 service 会在日志和响应前重新校验 repository 读模型，并只投影已冻结的患者端字段；异常只记录有限 `resultViolation`，统一映射为持久化错误；
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
