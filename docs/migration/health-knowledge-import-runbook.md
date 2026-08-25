# 健康知识内容导入运行手册

本文定义健康知识脱敏 bundle 从“内容责任人交付”到“允许进入 staging 导入”之间的工程门禁。
它不是医学审核流程的替代品，也不会因为校验通过就自动开放患者端 API。

## 1. 先决条件

内容责任人必须先提供：

- 明确来源和脱敏说明；
- 内容版本号、审核人引用、审核时间和固定免责声明；
- 目录、疾病、药品和关联关系的总数报告；
- 孤儿引用、重复 id、重复关系和正文控制字符检查结果；
- 发布、撤回和重新发布的责任确认。

导出文件不能包含患者姓名、身份证号、手机号、就诊卡号、病历号或任何 provider 返回的内部字段。
若导出工具需要携带尚未纳入 contract 的字段，应先更新版本化 contract 和审计文档，不能依赖导入器静默忽略。

## 2. 旧库源快照（只读、未审核）

当前项目提供了一个仅面向迁移盘点的旧库导出器：

```powershell
pnpm --filter @hospital/persistence health:export-legacy -- `
  --output .local/health-knowledge/legacy-source-snapshot.json
```

它只读取明确列出的 `knowledge_crowd`、`knowledge_department`、`knowledge_part`、
`knowledge_symptoms`、`knowledge_disease`、`knowledge_drug` 及关系表，不修改旧表、
新表、Redis 或服务进程。输出文件是迁移源快照，不是患者端 bundle；快照的
`source.publicationState` 固定为 `not-approved`，不能直接交给导入器或直接发布。

导出器还会输出不含正文的数量和质量摘要：

- 旧 `knowledge_disease.available_drugs` 冗余字段不会进入新结构，药品关系表是唯一来源；
- 重复疾病-药品名称会保留源行并记录 `duplicateDiseaseDrugNames`，不能静默去重；
- 可点击但没有药品主键的关系会记录 `clickableDrugReferencesWithoutId`，不能伪装成可跳转；
- `knowledge_tips` 当前有旧表数据，但新 contract 尚无对应模型，会记录为 `ignoredLegacySources`，
  等待单独定义内容类型后再迁移；
- 字段首尾空白、缺省首字母和不允许的控制字符分别按规则记录或拒绝。

源快照完成后，必须先做字段/关系复核和临床审核，再转换成包含
`publication.status`、`reviewedAt`、`reviewerRef` 和免责声明的正式 bundle。
这一步不能通过默认状态、旧页面可渲染或接口转发替代。

## 3. 只读 bundle 检查

把脱敏 JSON 文件交给只读检查命令：

```powershell
pnpm --filter @hospital/domain knowledge:bundle:check -- C:\path\to\health-knowledge-bundle.json
```

成功时只输出 `contentVersion`、`status`、项目数量和关系数量；不会输出正文、患者字段或原始 JSON。
失败时返回稳定错误分类和字段路径，例如 `publication.reviewerRef` 或
`items[0].patientName`，方便修正导出而不把敏感值写进终端日志。

该命令具有以下边界：

- 只读取指定文件；
- 解析运行时 `unknown`，拒绝缺失对象/数组、错误类型和未知字段；
- 校验固定免责声明、带时区时间、同版本引用、条目类型和完整详情集；
- 不连接 MySQL、Redis 或 Provider；
- 不执行 migration，不插入、不更新、不发布任何数据库记录。

## 4. staging 导入顺序

只读检查通过后，仍需人工确认 bundle 的来源和审核证据，再由受控任务显式调用
`importHealthKnowledgeBundle`。该函数会在获得数据库连接前再次执行领域校验，并在同一个事务内写入
publication、items、details 和 relations；任一 SQL 或外键失败都必须回滚。

导入顺序固定为：

```text
脱敏导出
  -> 只读 bundle check
  -> 来源/临床审核确认
  -> staging 单事务导入
  -> published / withdrawn / 重新发布演练
  -> 读模型和日志审计
  -> 患者端 API 准入评审
```

`draft`、`withdrawn` 和没有审核引用的版本不能被患者 repository 读取。当前健康知识 API 仍未注册，
所以即使 staging 导入获得批准，也必须另行完成路由、缓存、响应白名单和真机验收后才能进入生产。

## 5. 失败处理

- `invalid-bundle`：修正 bundle 字段或关系后重新检查，不绕过校验；
- `invalid-json`：修正文件编码/JSON 结构后重新导出；
- 数据库事务失败：检查 staging schema 和外键，确认事务已回滚后再重试；
- 医学内容争议：退回内容责任人，不通过工程参数“默认发布”；
- 发现患者字段：立即废弃该文件并重新脱敏，不把它复制到日志、issue 或仓库。

任何失败都不能通过添加默认 fixture、直接转发旧接口或手工修改 `published` 状态来绕过。
