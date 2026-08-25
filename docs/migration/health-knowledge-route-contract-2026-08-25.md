# 健康百科只读路由迁移契约（2026-08-25）

> 本文只描述健康百科后端入口的迁移状态，不代表健康内容、自测、风险评估、BMI/血压规则或临床建议已经完成。
> 当前新 API 可以冻结只读路由，但内容必须来自版本化、审核后并已发布的 bundle；没有发布版本时保持 fail-closed。

## 当前结论

旧端健康百科相关页面共有目录、症状关联、疾病详情和药品详情等多个入口。新项目已经具备：

- `@hospital/domain` 的健康内容读模型、版本和字段白名单校验；
- `@hospital/persistence` 的 MySQL 版本化发布表、只读仓储和未发布版本关闭态；
- `apps/api/src/modules/knowledge` 的 Bearer 认证只读 HTTP contract、统一日志和响应投影；
- `apps/api/src/app.ts` 的组合根挂载，以及 OpenAPI/公共 API 文档登记。

这表示“后端 contract 已纳入全量迁移范围”，不表示“患者已经能看到健康内容”。当前还缺少审核后的正式 bundle、发布/撤回演练、内容负责人和小程序页面验收，因此不能导入旧库快照，也不能在小程序内写死疾病、药品或评分数据。

## 公共入口

公网路径使用 `/api/v2`；应用内部使用 `/api/v1`。所有入口都要求当前平台 Bearer 会话：

| 能力 | 路径 | 当前状态 |
| --- | --- | --- |
| 身体部位、人群、科室目录 | `GET /knowledge/health/{part|crowd|department}/list` | 已冻结 contract；无已发布 bundle 时关闭 |
| 身体部位症状 | `GET /knowledge/health/symptoms/list/part/{partId}` | 已冻结 contract；只接受 opaque 内容 ID |
| 关联疾病 | `GET /knowledge/health/disease/list/{part|crowd|department}/{id}` | 已冻结 contract；关系必须属于同一发布版本 |
| 症状查疾病 | `GET /knowledge/health/disease/list/symptoms?symptomIds=...` | 已冻结 contract；1–10 个症状，拒绝重复和未知值 |
| 疾病详情 | `GET /knowledge/health/disease/detail/{diseaseId}` | 已冻结 contract；缺失返回稳定资源错误 |
| 药品详情 | `GET /knowledge/health/drug/detail/{drugId}` | 已冻结 contract；只读资料，不构成个体化用药建议 |

服务端只返回审核 bundle 的公开字段、发布版本、审核时间、来源标签和免责声明。不会接受或返回患者 `patientId`、HIS 号、身份证号、Provider 标识、旧端表主键或 AI 参数。

## 关闭条件

以下任一条件不满足，都不能把内容路径标为已完成：

1. bundle 通过 domain validator，包含唯一版本、来源、审核人、审核时间和免责声明；
2. 疾病、药品、症状和关系的引用都指向同一个内容版本，未知字段和跨类型引用被整批拒绝；
3. 导入在一个 MySQL 事务中完成，失败时回滚，不留下半个版本；
4. 只有已发布版本可被仓储读取，撤回后不能继续由缓存返回；
5. 小程序页面完成加载、错误、空结果、版本提示和免责声明展示验收；
6. 日志只保留操作、版本、结果数量和 request/trace 关联，不记录正文、患者字段或原始导入文件。

当前 `tools/architecture-audit.mjs` 的 `knowledge.route-contract-fail-closed` 门禁保证路由可以冻结，但不会绕过上述内容发布条件。`apps/api` 的健康百科测试覆盖认证、版本 envelope、字段投影、坏读模型和未配置依赖；这些测试不能替代临床审核和真机验收。

## 与其他健康页面的边界

- 健康自测、风险评估、BMI 和血压计算器：需要独立规则版本、适用人群、临床审核和免责声明，不能复用百科内容接口。
- 门诊病历、住院信息、电子导诊单、出院随访：属于患者/临床 Provider 域，不能使用健康百科 ID 或关系表替代。
- 报告解读、AI 导诊和问诊：需要独立会话、模型/知识版本、风险分流和审计，不从百科详情自动生成医疗建议。
- 支付、医保和 HIS 回写：与百科只读查询完全隔离，继续按最后专项处理。

## 下一步

先取得正式审核 bundle 和发布演练证据，再实现健康百科小程序的目录、搜索、疾病详情和药品详情页面；页面接入前不开放旧端健康 URL、旧库直读或本地 fixture。
