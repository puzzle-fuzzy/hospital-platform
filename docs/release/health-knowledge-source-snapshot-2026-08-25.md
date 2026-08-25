# 健康知识旧库源快照核对（2026-08-25）

## 结论

已通过 SSH 对服务器上新旧服务共用的 MySQL 做只读导出验证。旧 Python 服务、新 Bun 服务、
数据库和 Redis 均未重启、未修改；新端健康知识表也没有写入。导出的文件只保存在本机
`.local/health-knowledge/` 忽略目录，不进入 Git、发布包或患者端接口。

这次完成的是“迁移源盘点”，不是“健康内容上线”。源快照固定为
`source.publicationState=not-approved`，当前健康知识 API 继续关闭。

## 真实源数据摘要

| 项目 | 数量 |
| --- | ---: |
| 目录/症状/疾病/药品条目合计 | 15,668 |
| 疾病详情 | 8,509 |
| 药品详情 | 1,207 |
| 疾病与人群/科室/部位关系 | 16,259 |
| 部位与症状关系 | 5,910 |
| 症状与疾病关系 | 19,776 |
| 疾病-药品重复名称组 | 6 |
| 可点击但缺少药品主键 | 0 |
| 首尾空白被记录的字段 | 10 |
| 缺省首字母 | 0 |
| 旧正文控制字符 | 115 |

旧库另有 `knowledge_tips` 10 条，但新健康知识 contract 没有对应内容类型，已记录为
`ignoredLegacySources`，没有将它们塞进疾病详情或静默丢弃。

## 当前代码边界

- `packages/persistence/scripts/health-knowledge-source-export.ts`：稳定 opaque id、白名单字段映射、
  关系保留和质量报告；重复关系不去重。
- `packages/persistence/scripts/export-legacy-health-knowledge.ts`：只读 CLI，只输出数量和质量摘要，
  不打印医疗正文，不执行 SQL 写入。
- `docs/migration/health-knowledge-import-runbook.md`：源快照到正式审核 bundle 的门禁和操作顺序。
- `.local/health-knowledge/legacy-source-snapshot.json`：本机临时证据，不应提交。

## 放行前仍缺少的工作

1. 清理/复核 6 组重复疾病-药品关系，并确认哪些关系允许患者点击查看药品详情。
2. 对 115 个旧正文控制字符做内容责任人复核；正式 bundle 不能直接带入这些字符。
3. 为 `knowledge_tips` 单独决定 contract、来源、字段和展示入口，不能借用疾病详情字段。
4. 补齐脱敏证明、内容版本、审核人引用、审核时间、免责声明、生效窗口以及撤回演练。
5. 生成正式 draft/published bundle 后，先在 staging 单事务导入、验证读模型，再单独评审患者端路由和真机展示。

## 验证命令

```powershell
pnpm --filter @hospital/persistence typecheck
pnpm --filter @hospital/persistence test
pnpm exec biome check packages/persistence/scripts/health-knowledge-source-export.ts packages/persistence/scripts/health-knowledge-source-export.test.ts packages/persistence/scripts/export-legacy-health-knowledge.ts packages/persistence/package.json
```

本次结果：持久化类型检查通过，98 个测试通过、0 个失败，Biome 检查通过。
