# 报告目录服务层查询边界（2026-08-19）

## 目的

`GET /reports` 的 HTTP query 由 Elysia schema 校验，但 `ReportService.list` 也可能被组合根、回放任务或未来 Worker 直接调用。
服务层不能把 TypeScript 的 `ReportDirectoryQuery` 当成运行时事实。

## 固定规则

- 输入必须是非数组对象；
- `startDate` 和 `endDate` 必须是字符串，随后继续通过已有自然日和跨度校验；
- `kind` 可以省略，提供时必须是字符串，未知枚举仍由已有 `InvalidReportKindError` 拒绝；
- 形状不合法时在 owner 映射和 Provider 调用前失败；
- 公共响应继续沿用 `400 report-query-invalid`，失败日志继续使用 `report.directory.failed` 和错误类型；
- 不记录原始查询对象、患者正文、Provider 患者号或 Provider 原始报文。

## 为什么服务层也要校验

HTTP schema 只保护 HTTP 路由。内部调用绕过该层时，直接读取 `input.kind` 可能把 `null` 或数组变成未映射的 TypeError/500，
错误日期类型也可能进入日期解析。把运行时形状收敛放在服务层，可以让所有入口共享同一错误语义，并保证错误查询不会触碰患者映射或 Provider。

## 证据与边界

- 回归验证 `null`、数组、空日期和 `kind: null` 均返回 `ReportQueryError`；
- 回归验证患者仓储和报告 Provider 调用次数均为 0，并且每次失败都有低敏 `report.directory.failed`；
- 本次没有改变报告字段、LIS/PACS/ECG gate、详情引用、附件下载、域名、数据库、Redis 或线上 release；真实 Provider 与真机验收仍待完成。
