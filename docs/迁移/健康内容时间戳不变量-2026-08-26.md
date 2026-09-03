# 健康内容发布时间严格时间边界（2026-08-26）

## 本轮结论

健康知识发布元数据的时间字段现在统一经过严格 ISO 8601 时间点校验：必须带显式时区，
并且日历日期、时、分、秒和时区偏移都必须真实存在。`2026-02-30T00:00:00.000Z` 这类
会被 JavaScript `Date.parse` 自动进位的值会在进入发布选择或 SQL 写入前被拒绝。

本轮只收紧领域和导入边界，没有导入旧健康正文、没有注册健康知识 API、没有改变发布闸门，
也没有修改旧 Python 服务、数据库、Redis 或线上配置。

## 为什么这是业务规则而不是格式偏好

健康内容的 `reviewedAt`、`effectiveFrom` 和 `effectiveTo` 会参与发布审计及“当前生效版本”
选择。如果不同运行时把非法日期解释成不同的合法时间，可能出现以下错误：

- 未到生效时间的内容提前进入患者端；
- 已过期内容继续被选择；
- staging 校验通过，但生产按另一条时间线选择版本；
- 审核记录与患者实际看到的内容版本无法关联。

因此，发布时间必须先经过日历回读和时钟范围校验，再交给运行时转换为绝对时间戳。

## 固定实现边界

| 位置 | 规则 | 失败结果 |
| --- | --- | --- |
| `packages/domain/src/date-range.ts` | 统一解析带时区的严格 ISO 时间点，拒绝日期/时钟/偏移溢出 | 返回 `undefined`，由调用方映射稳定错误 |
| `validateHealthKnowledgePublication` | `reviewedAt` 必须通过严格解析，免责声明仍只能使用代码固定值 | 拒绝发布读模型 |
| `validateHealthKnowledgeImportBundle` | `reviewedAt/effectiveFrom/effectiveTo` 使用同一解析器，之后再检查生效窗口顺序 | 在 SQL 之前按字段路径拒绝 bundle |

导入器仍不负责判断医学正文是否正确；临床审核、来源追溯、撤回和 staging 演练仍是独立
准入条件。严格时间校验也不代表健康内容已经发布。

## 回归证据

- `packages/domain/src/date-range.test.ts`：覆盖合法时间、非法日历日期、24 时、缺少时区和显式偏移；
- `packages/domain/src/knowledge.test.ts`：审核时间的非法日历日期被拒绝；
- `packages/domain/src/knowledge-import.test.ts`：生效窗口的非法日历日期在 SQL 前按字段路径被拒绝；
- 本轮 domain 测试：`95 pass / 0 fail / 238 expect()`。

## 仍未开放的能力

健康审核 bundle、健康百科 API、自测评分、BMI/血压临床规则和风险评估仍保持原有
`fail-closed` 状态。下一步必须先取得脱敏内容、审核责任、版本和撤回证据，再独立进行
staging 导入和真机验收；不能因为时间字段门禁通过就把健康内容标记为完成。
