# 健康知识内容迁移映射与上线边界

## 状态

当前状态：`mapping-and-route-ready`。本文已经完成旧端表、接口和新端 schema 的静态映射，
健康知识只读路由已经注册，但没有把旧数据库正文直接复制到生产；没有有效 published 版本时路由保持 fail-closed。

健康知识属于“医疗内容”而不是普通字典。没有脱敏导出、内容来源、临床审核、版本发布和撤回证据时，
不能因为新端已经有 repository 或测试 fixture 就宣称该域完成迁移。

## 0. 2026-08-20 readiness 复核

本轮只读盘点新仓库，未发现可供导入的正式脱敏内容 bundle；当前可见的是 schema、domain、导入器、repository、测试和文档。
这不能推断生产 MySQL 一定没有内容，但足以证明当前仓库没有可以直接执行的审核发布输入。患者端健康知识路由虽然已经注册，
但在没有有效 published 版本时保持 fail-closed，
健康百科页面、自测、风险评估、AI 导诊和报告解读不共享本域的“已完成”状态。

代码/测试完成的部分和医疗内容上线是两个独立门槛。需要真实内容责任人提供来源、脱敏导出、审核记录、版本发布和撤回演练后，
才可以生成 bundle 并进入 staging；详细当前证据见
[`../release/health-knowledge-readiness-audit-2026-08-20.md`](../release/health-knowledge-readiness-audit-2026-08-20.md)。

## 1. 旧端事实基线

旧端来源文件：

- API controller：`G:\\fuck\\hospital\\app\\api\\v1\\module_knowledge\\health\\controller.py`；
- API service：`G:\\fuck\\hospital\\app\\api\\v1\\module_knowledge\\health\\service.py`；
- ORM model：`G:\\fuck\\hospital\\app\\api\\v1\\module_knowledge\\health\\model.py`；
- 小程序页面：`hospital-app/src/pagesB/health/health_encyclopedia.vue`、
  `disease_detail.vue`、`drug_detail.vue`、`search_result.vue`。

旧患者 API 的实际路径均挂在 `/knowledge/health` 下：

| 旧路径 | 旧语义 | 新端计划 |
| --- | --- | --- |
| `GET /knowledge/health/crowd/list` | 人群目录 | `listCatalog("crowd")` |
| `GET /knowledge/health/department/list` | 科室目录 | `listCatalog("department")` |
| `GET /knowledge/health/part/list` | 部位目录 | `listCatalog("part")` |
| `GET /knowledge/health/disease/list/crowd/{crowd_id}` | 按人群查疾病 | `listDiseasesByRelation({ kind: "crowd" })` |
| `GET /knowledge/health/disease/list/department/{department_id}` | 按科室查疾病 | `listDiseasesByRelation({ kind: "department" })` |
| `GET /knowledge/health/disease/list/part/{part_id}` | 按部位查疾病 | `listDiseasesByRelation({ kind: "part" })` |
| `GET /knowledge/health/symptoms/list/part/{part_id}` | 按部位查症状 | `listSymptomsByPart(partId)` |
| `GET /knowledge/health/disease/list/symptoms?symptoms_ids=...` | 按多个症状查疾病 | `listDiseasesBySymptoms(symptomIds)` |
| `GET /knowledge/health/disease/detail/{disease_id}` | 疾病详情 | `getDiseaseDetail(diseaseId)` |
| `GET /knowledge/health/drug/detail/{drug_id}` | 药品详情 | `getDrugDetail(drugId)` |

### 症状查询参数命名边界

旧 FastAPI 接口的查询参数名是 `symptoms_ids`；新平台的已挂载 route 使用新的统一
camelCase 参数 `symptomIds`（重复 query key）。这不是旧接口的透明兼容层：原生小程序
未来接入时必须使用 `symptomIds`，不能让服务端同时猜测两个参数或把缺失参数默默当成空查询。
如果后续确实需要服务旧客户端，应单独设计带迁移期限、日志和回归测试的 compatibility route，
不能改变当前 canonical contract。

旧表事实来自 `model.py`，包括：

| 旧表 | 内容 | 新端目标表/事实 |
| --- | --- | --- |
| `knowledge_crowd`、`knowledge_department`、`knowledge_part` | 三类目录 | `hp_health_knowledge_items`，分别使用 `crowd`、`department`、`part` |
| `knowledge_symptoms` | 症状名称和首字母 | `hp_health_knowledge_items`，使用 `symptom` |
| `knowledge_disease` | 疾病名称、首字母和正文 | item + `hp_health_knowledge_disease_details` |
| `knowledge_drug` | 药品详情正文 | item + `hp_health_knowledge_drug_details` |
| `knowledge_*_disease` | 人群/科室/部位与疾病关系 | `hp_health_knowledge_disease_relations` |
| `knowledge_part_symptoms` | 部位与症状关系 | `hp_health_knowledge_part_symptoms` |
| `knowledge_symptoms_disease` | 症状与疾病关系 | `hp_health_knowledge_symptom_diseases` |
| `knowledge_disease_drug` | 疾病与药品显示关系 | `hp_health_knowledge_disease_drugs` |

## 2. 不能直接兼容的差异

1. 旧表使用自增整数 id，新平台要求版本内稳定的 opaque 字符串 id。不能把旧数字 id
   直接作为公共 API id，也不能让不同类别的同一个数字发生冲突。转换规则必须在导入 bundle
   中显式生成，并保留旧 id 到新 id 的受控映射记录。
2. 旧表没有统一的 `draft/published/withdrawn`、来源、审核人、审核时间和生效窗口。
   旧行本身不能证明“现在可以给患者展示”；必须先生成新的 publication 事实。
3. 旧 `knowledge_disease.available_drugs` 是疾病表上的冗余字段，患者展示关系实际还来自
   `knowledge_disease_drug`。新端只接受关系表生成的 `availableDrugs`，不把旧冗余文本当作可点击药品引用。
4. 旧疾病和药品正文可能被用户理解为诊疗或用药建议。新端固定附带免责声明，正文必须由业务/临床负责人
   审核；不能把旧自测评分、风险等级或 AI 结论混入百科 publication。
5. 旧接口按整数 query/path 参数工作，新端在 API 边界使用字符串 id，并在 domain 层校验长度、类型、
   关系类别和同一 content version，避免数据库字段被直接透传。

## 3. 新端已经具备与尚未具备的部分

已具备代码基础：

- `packages/domain/src/knowledge.ts`：患者端只读模型、固定免责声明和查询边界；
- `packages/domain/src/knowledge-import.ts`：完整 bundle 的 item/关系/版本校验；
- `packages/persistence/migrations/0010_health_knowledge.sql`、`0011_health_knowledge_versioned_keys.sql`：
  发布状态、版本和关系表；
- `packages/persistence/src/health-knowledge-import.ts`：单事务导入，失败回滚；
- `packages/persistence/src/mysql-health-knowledge-repository.ts`：先选一个 published 版本，
  后续查询全部携带该版本；
- `apps/api/src/modules/knowledge`：已挂载但受 Bearer 会话保护的 GET service/module 和响应 contract；没有有效 published 版本时保持 fail-closed。

尚未完成：

- 旧数据库脱敏导出、行数/关系数/孤儿引用校验和转换报告；
- 内容来源、审核人、审核时间和固定免责声明的真实责任记录；
- staging 导入、发布、撤回和再次发布的真实数据库证据；
- 生产 content publication 和正式发布窗口证据；
- 搜索结果、疾病/药品详情的真机页面证据；页面代码已进入当前候选，但无 published bundle 时不展示正文；
- 健康自测、风险评估、AI 导诊和报告解读，它们必须走各自 contract，不能借用百科数据。

## 4. 正确导入顺序

```text
旧库只读脱敏导出
  -> 统计与关系完整性报告
  -> 生成新 id 和 content bundle
  -> 业务/临床审核并补 reviewerRef
  -> domain validator
  -> staging draft 导入
  -> staging published/withdrawn 演练
  -> API 白名单和真机验收
  -> 受控生产发布
```

导入文件中的 `reviewedAt`、`effectiveFrom` 和 `effectiveTo` 必须带 `Z` 或显式偏移量；
无时区时间会因部署机器时区不同而改变发布窗口，domain validator 会拒绝这种输入。

导入器必须满足：

- 一个 bundle 只对应一个 `contentVersion`，所有 item、详情和关系必须属于同一版本；
- 缺少疾病/药品详情或关系引用指向错误类别时，在 SQL 之前失败；
- published/withdrawn 版本必须有 `reviewerRef`；
- 任何导入失败都回滚整批，不留下半套目录；
- 患者端 repository 只能读取当前生效的 published 版本，不能读 draft 或 withdrawn；
- repository 读取关系时还必须校验同一 `content_version` 下的 `item_kind`，不能只依赖复合外键存在；
- 撤回后要验证原版本不再展示，重新发布要产生新的不可变版本，不能原地覆盖患者已看到的版本。

## 5. 当前结论与下一步

当前不能注册 `/api/v1/knowledge/*` 或把旧 `/knowledge/health/*` 直接转发到小程序。
下一步需要由具备内容责任的人提供脱敏导出和审核证据；拿到后按本文生成 bundle，先在 staging
完成导入/撤回/查询证据，再同步 `docs/api-v2-public.md`、`docs/migration/api-matrix.md`、日志文档和
真机验收手册，最后才注册患者 GET 路由和迁移小程序页面。

健康知识域的边界决策详见 [`ADR 0004`](../adr/0004-health-knowledge-content-boundary.md)。
