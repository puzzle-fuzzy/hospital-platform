# 报告目录 service 输入边界审计（2026-08-21）

> 本文只记录新项目当前报告目录 service 的代码和本地证据，不代表 LIS/PACS/ECG Provider、线上业务请求或微信真机已经验收。
> 本轮没有修改旧 Python 服务、旧数据库、旧 Redis，也没有打开报告目录、报告详情或附件 gate。

## 1. 发现的问题

报告 HTTP 路由的 TypeBox query schema 已限制 `startDate`、`endDate` 和可选 `kind`，但直接调用
`ReportService.list` 时，原来的运行时归一化函数只抽取这些字段，未知字段会被静默忽略。

这会造成一个真实的业务语义风险：组合根、回放任务或未来 Worker 如果误传 `providerReportId`、`patientId` 或其它
Provider 参数，service 仍可能按当前 owner、当前内部患者和日期继续查询。调用方看到的是一次“成功执行的查询”，
而不是明确的输入错误；更严重时会把另一种患者/Provider 意图误认为报告目录查询已经生效。

## 2. 修正内容

`apps/api/src/modules/reports/service.ts` 的 `normalizeReportDirectoryQuery` 现在使用固定字段白名单：

- 只允许 `startDate`、`endDate`、`kind`；
- 未知字段在患者映射和 Provider 请求前抛出 `ReportQueryError`；
- 不把未知字段名称或原值写入日志；
- HTTP schema 与 service runtime 校验形成两层边界，绕过 HTTP 的调用方也不能改变查询语义。

`apps/api/src/modules/reports/service.test.ts` 增加回归测试，使用 `providerReportId` 模拟错误意图，验证 service 明确失败且
Provider 调用次数为零。中文注释同时说明了为什么不能采用“只解构已知字段”的宽松写法。

## 3. 保持不变的报告边界

1. 客户端只提交平台内部 `patientId`、日期和有限 `kind`；Provider 患者号、报告号和文件 URL 不进入小程序 contract。
2. service 仍按 owner + `his-patient` 映射访问 Provider；患者映射、Provider 响应、报告来源、日期和资源上限继续 fail-closed。
3. LIS 详情引用仍是短期 opaque 引用，详情引用的 owner、patient、Provider、类型和 TTL 二次校验保持不变。
4. PACS、ECG、体检、附件下载、分享和报告解读没有因为本次修正而开放。
5. Provider 没有正式脱敏样例、线上 trace 和真机页面证据时，报告目录仍不能标记为真实完成。

## 4. 本地验证

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/api test src/modules/reports/service.test.ts` | 21 pass，91 个断言 |
| `pnpm --filter @hospital/api typecheck` | 通过 |
| `pnpm --filter @hospital/domain test src/reports.test.ts src/external-trace.test.ts` | 6 pass，10 个断言 |
| `pnpm --filter @hospital/miniprogram test`（现有全量 acceptance/runtime 门禁） | 174 pass，1378 个断言 |
| `pnpm exec biome check apps/api/src/modules/reports/service.ts apps/api/src/modules/reports/service.test.ts` | 通过 |

这些结果证明本地 service、domain 和客户端边界一致，但不替代 Provider 成功/空/拒绝/超时响应、生产日志或真机验收。

## 5. 变更隔离与下一步

- 未修改旧 Python 项目、旧端口 `8001`、旧数据库或旧 Redis。
- 未修改众阳报告 adapter，也未修改并行会话的 `apps/miniprogram/project.config.json` 和 `.codegraph/`。
- 下一步仍应先收集报告 Provider intake 和脱敏样例，再按“目录 → LIS 详情 → 其它来源/附件”的顺序分别冻结 contract。
- 如果 Provider 字段与当前 adapter 不一致，应停止在 contract 审计，不用宽松解析或空列表降级掩盖差异。
