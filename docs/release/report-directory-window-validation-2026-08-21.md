# 报告目录结果窗口绑定审计（2026-08-21）

## 结论

本轮发现并修正一个报告目录的业务正确性缺口：请求的 `startDate/endDate` 虽然经过合法日期和最大跨度校验，
但服务此前没有验证 Provider 返回的每条 `reportedAt` 是否属于这次请求窗口。若 Provider 忽略日期参数、命中其它日期的缓存，
或多来源聚合错配，服务可能把不属于本次查询的报告误报为成功结果。

现在报告目录在生成短期详情引用和成功日志之前，逐条完成以下门禁：

- 接受 `YYYY-MM-DD`、`YYYY/MM/DD`、带本地时间的上述格式，以及带明确 `Z`/偏移量的 ISO 时间；
- 自然日文本按 UTC 伪时间线比较，避免部署机器时区改变业务结果；带时区 ISO 文本按明确偏移比较；
- 查询窗口是包含首日和末日的自然日窗口，即 `[startDate 00:00:00, endDate 次日 00:00:00)`；
- 未知格式、无效日历日期和窗口外时间整批拒绝，不能过滤坏行、排序后保留或降级为空列表；
- 失败日志只记录固定的 `reported-at-invalid` 或 `reported-at-outside-query`，不记录 Provider 原文。

## 代码与测试

- `packages/domain/src/reports.ts`：新增报告时间解析和目录结果窗口校验；
- `apps/api/src/modules/reports/service.ts`：在来源筛选后、短期引用创建前调用窗口校验；
- `packages/domain/src/reports.test.ts`：覆盖日期格式、无效日期、窗口首尾和窗口外结果；
- `apps/api/src/modules/reports/service.test.ts`：覆盖窗口外/未知时间整批失败、无成功日志和固定失败原因。

## 证据边界

本轮只验证新仓库的 domain/service 代码、日志语义和回归测试，没有调用真实众阳接口，没有打开报告 Provider gate，
没有进行微信开发者工具或真机验收，也没有修改旧 Python 服务、线上反向代理、MySQL 或 Redis。Provider 的 `endDate` 包含规则、
分页和多来源快照一致性仍需正式合同及真实请求证据确认。
