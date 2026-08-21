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

## 2. 只读 bundle 检查

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

## 3. staging 导入顺序

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

## 4. 失败处理

- `invalid-bundle`：修正 bundle 字段或关系后重新检查，不绕过校验；
- `invalid-json`：修正文件编码/JSON 结构后重新导出；
- 数据库事务失败：检查 staging schema 和外键，确认事务已回滚后再重试；
- 医学内容争议：退回内容责任人，不通过工程参数“默认发布”；
- 发现患者字段：立即废弃该文件并重新脱敏，不把它复制到日志、issue 或仓库。

任何失败都不能通过添加默认 fixture、直接转发旧接口或手工修改 `published` 状态来绕过。
