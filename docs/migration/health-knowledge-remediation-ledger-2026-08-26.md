# 健康内容整改台账（2026-08-26）

本轮继续推进 B 批次，但不把旧健康源快照直接升级为患者端医学内容。新增
`health:remediation:ledger` 工具，把源快照审计结果转换成不含正文的整改台账，
让内容责任人可以按固定 gate 处理问题；它不会访问数据库、线上服务或修改任何
健康内容。

## 当前命令

```powershell
pnpm health:source:audit
pnpm health:quality:findings
pnpm health:remediation:ledger
```

三条命令都只读取 `.local/health-knowledge/legacy-source-snapshot.json`。输出只保留
问题类型、数量、JSON 定位、材料要求和来源元数据，不输出疾病名称、药品名称、正文、
患者字段或任何 Provider 原文。

## Gate 含义

| Gate | 当前规则 | 是否能单独放行 |
| --- | --- | --- |
| 源快照质量 | 重复关系、控制字符、清理字段和来源声明必须重新确认 | 不能 |
| 临床内容审核 | 必须由内容责任人提供独立审核 bundle | 不能 |
| 版本与发布元数据 | 必须有版本、带时区审核时间、生效窗口和免责声明 | 不能 |
| staging 导入与撤回 | 必须演练重复导入、重叠版本、查询一致性和撤回 | 不能 |
| 真机只读验收 | 必须关联页面、客户端 requestId、服务端 traceId 和内容版本 | 不能 |

即使源质量告警归零，`publicationState=not-approved` 仍然保持临床审核 gate 阻塞；
工具的 `publishable` 固定为 `false`。健康百科在审核 bundle、staging 演练和真机证据
全部完成前继续 fail-closed，不新增自测题库、诊断结论或个体化用药建议。

## 本轮边界

- 只新增脱敏整改台账、测试和用户可见的授权加载反馈；
- 不修改旧 Python 项目、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- 不导入 `.local` 源快照，不创建健康内容发布记录；
- “我的”页在头像/昵称授权正在进行时不重复弹窗，但会明确提示“正在获取”，避免点击无反馈。

下一份业务材料仍是内容责任人提供的独立审核 bundle；收到后按
`bundle validator -> staging -> 撤回演练 -> 真机只读验收` 继续推进。
