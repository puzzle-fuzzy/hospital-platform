# 健康知识迁移审核队列

> 本文描述健康百科从旧源快照到患者端发布之间的工程门。它不是临床审核结论，也不授予生产发布权限。

## 为什么需要单独的审核队列

健康知识的页面、API 和数据库表已经具备，但旧库导出的内容仍然是 `not-approved`。如果只看到页面和路由，
很容易把“代码已准备”误写成“内容已迁移”。审核队列把内容质量、临床责任、版本元数据、staging、发布撤回和
真机证据拆开，后续拿到真实材料后可以按门推进，而不是修改源快照来制造完成状态。

## 生成报告

```powershell
pnpm health:review:queue
```

报告只包含：

- 源系统、映射版本和 `not-approved` 状态；
- 各类条目和关系的数量；
- 质量告警数量；
- 源快照质量摘要与正文投影的一致性结果；
- 固定审核门的 `ready`、`blocked`、`pending-input` 或 `pending-validation` 状态；
- 下一项需要的材料。

报告不会输出疾病名称、药品正文、患者标识或旧 Provider 字段。`publishable` 永远为 `false`，即使审核 bundle
文件已经出现在本机目录，也必须继续执行 bundle 校验、staging 导入、发布/撤回演练和真机验收。

## 固定审核门

| 门 | 含义 | 放行材料 |
| --- | --- | --- |
| `source-quality` | 重复关系、控制字符、清理字段和未定义来源是否已经人工处理 | 重新导出的、质量告警为零或已留存处理结论的源审计结果 |
| `clinical-review` | 是否存在内容责任人和临床审核结论 | 独立脱敏审核 bundle、责任人引用和审核记录 |
| `bundle-metadata` | 版本、审核时间、生效窗口和免责声明是否齐全 | 通过 `@hospital/domain` validator 的 bundle |
| `staging-import` | 是否能在单事务内导入并失败回滚 | `DEPLOY_ENV=staging` 的导入日志和回滚证据 |
| `publication-drill` | 发布、撤回、同版本读取和重叠窗口是否正确 | staging 演练记录 |
| `device-acceptance` | 页面、客户端 requestId、服务端 Pino 和内容版本是否同链 | 当前候选运行包的真机证据 |

## 明确禁止

- 不修改 `.local/health-knowledge/legacy-source-snapshot.json` 来补 `published`、`reviewedAt` 或 `reviewerRef`；
- 不把旧源快照直接复制成 `.local/health-knowledge/reviewed-bundle.json`；
- 不因为 `bundle` 文件存在就跳过 domain 校验和 staging 导入；
- 不在审核完成前开放疾病、药品、自测、BMI 或血压结果；
- 不把队列报告当作患者端业务完成证据。

正式导入顺序见 [`health-knowledge-import-runbook.md`](health-knowledge-import-runbook.md)，源快照质量结果见
[`health-knowledge-source-audit-2026-08-25.md`](health-knowledge-source-audit-2026-08-25.md)。
