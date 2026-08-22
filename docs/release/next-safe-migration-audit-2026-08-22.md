# 剩余安全迁移与健康知识开放门槛审计（2026-08-22）

> 本文是当前迁移决策记录，不代表健康知识、门诊病历、患者绑定、二维码、支付或医保已经上线。
> 本轮只检查新项目和文档，没有修改旧 Python 项目、旧数据库、旧 Redis 或旧服务。

## 1. 当前候选与审计范围

当前配套候选固定为：

- 服务端已验证 release：`84370077024762d92050cf077c27f3c60302e8f8`（提交 `84370077`）；
- 小程序运行包来源：`a64fe023bc34fe6e44f93846c39e202fe02d64a5`（提交 `a64fe023`）；
- 小程序运行包已经通过 `runtime:verify`，测试脚本不会进入 `dist/`。

本轮对照以下事实源检查剩余迁移：

- `docs/migration/legacy-page-matrix.md`：旧端页面是否存在可直接迁移的完整业务闭环；
- `docs/migration/legacy-api-endpoint-inventory.md`：旧接口的真实语义、字段和 Provider 依赖；
- `docs/migration/remaining-migration-inventory.md`：当前优先级、业务不变量和放行条件；
- `docs/adr/0004-health-knowledge-content-boundary.md`：医疗内容的审核、发布、撤回和免责声明边界。

## 2. 当前未找到可安全扩大范围的 P2 功能

在不猜 Provider/HIS contract、不打开支付/医保、不修改旧服务的前提下，剩余候选均至少缺少一项关键业务证据：

| 领域 | 当前状态 | 缺失的放行证据 | 当前决定 |
| --- | --- | --- | --- |
| 门诊病历/住院 | 只有旧端路径和候选 contract 草案 | 正式字段授权、患者映射、成功/空/拒绝/超时样例、真机读模型 | 保持未注册，不做兼容转发 |
| 患者新增/绑定/解绑 | 旧端存在查档和写入行为，但语义混用卡号、身份证号和 `patId` | Provider 写入 contract、幂等、最终状态、协议版本、失败补偿 | 保持写入关闭 |
| 首页二维码 | 旧端实际使用 `medicalCardNo` 并调用外部二维码服务 | 签名、受众、TTL、防重放、撤销、扫码回执和设备验证 | 保持入口关闭 |
| 健康知识 | 新端已有 schema、domain、service、repository 和导入校验 | 真实脱敏内容、临床审核、发布/撤回演练、患者页面和真机证据 | 保持 API 未挂载 |
| 支付/医保/HIS | 基础设施和规则部分存在 | 金额与状态机、授权、回调、查单、退款、回写和真实验收 | 最后处理，运行闸门关闭 |

结论：当前最合适的下一步仍是使用 `84370077 + a64fe023` 完成已存在只读业务的真机三层验收，
不是继续增加一个缺少正式业务契约的页面或接口。

## 3. 健康知识代码现状与“未开放”原因

### 已完成的工程骨架

- `packages/domain/src/knowledge.ts`：公共只读读模型、查询边界和固定免责声明；
- `packages/domain/src/knowledge-import.ts`：版本、发布状态、审核引用、关系类别和完整详情集校验；
- `packages/persistence/migrations/0010_health_knowledge.sql`、`0011_health_knowledge_versioned_keys.sql`：版本化表和同版本关系约束；
- `packages/persistence/src/health-knowledge-import.ts`：单事务导入，校验或 SQL 失败时整体回滚；
- `packages/persistence/src/mysql-health-knowledge-repository.ts`：只读取同一个有效 `published` 版本，并在读取边界重新校验；
- `apps/api/src/modules/knowledge`：只读 Elysia module、service 和 response contract，定向测试已覆盖。

### 当前明确没有开放的部分

1. `apps/api/src/app.ts` 没有挂载 `healthKnowledgeModule`；患者端公共 API 不会暴露 `/api/v1/knowledge/*`。
2. `apps/api/src/application.ts` 的 `ApplicationServices` 和默认组合根没有注入 `knowledge` service；
   这不是漏接线，而是内容责任证据未完成时的显式停止条件。
3. `packages/persistence/src/knowledge.ts` 的默认 repository 使用 fail-closed 的未配置错误，
   不会用空数组或内存 fixture 伪装“没有内容”。
4. `apps/api/src/app.test.ts` 已验证内容未就绪时健康知识路由保持未注册。
5. 当前仓库没有可以直接安全导入的脱敏内容 bundle；这不能推断生产数据库绝对为空，但足以阻止执行导入。

因此不能把“表已迁移”“service 测试通过”或“模块文件存在”描述成“健康知识已经迁移”。

## 4. 健康知识的唯一开放顺序

```text
内容责任人交付脱敏导出
  -> 统计条目/关系/孤儿引用
  -> 生成单版本不可变 bundle
  -> 业务/临床审核并记录 reviewerRef
  -> domain bundle check
  -> staging 单事务导入
  -> published / withdrawn / 重新发布演练
  -> 组合根注入 service 并挂载患者 GET route
  -> 响应白名单、日志、缓存和小程序页面验收
  -> 受控生产发布
```

每一步都必须保留可复核证据。尤其是：

- `draft`、`withdrawn` 或没有审核引用的版本不能进入患者读模型；
- 撤回必须证明旧版本不再展示，重新发布必须产生新的不可变版本；
- 正文可以保留合法换行，但不能携带患者字段或其它未纳入 contract 的管理字段；
- 健康百科、自测、风险评估、AI 导诊和报告解读不能共享一个“内容已审核”成功状态；
- 即使 staging 导入成功，也不能跳过 API response、免责声明、日志和真机阅读验收。

## 5. 本轮决定与后续动作

本轮不新增健康知识路由、不导入旧正文、不新增小程序页面、不调用 Provider，也不改变线上服务。

后续只有在收到真实内容责任人材料后，才进入 [`health-knowledge-import-runbook.md`](../migration/health-knowledge-import-runbook.md)
规定的 staging 流程；在此之前，继续完成当前已开放只读业务的微信会话、患者显式切换、预约历史和门诊费用三层验收。

关联决策：

- [`ADR 0004`](../adr/0004-health-knowledge-content-boundary.md)
- [`health-knowledge-content-mapping.md`](../migration/health-knowledge-content-mapping.md)
- [`health-knowledge-readiness-audit-2026-08-20.md`](health-knowledge-readiness-audit-2026-08-20.md)
- [`remaining-migration-inventory.md`](../migration/remaining-migration-inventory.md)
