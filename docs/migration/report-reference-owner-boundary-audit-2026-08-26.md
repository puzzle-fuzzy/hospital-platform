# 报告引用 owner 隔离边界审计（2026-08-26）

## 结论

报告目录与检验报告详情已经具备服务端短期 opaque 引用、owner/患者双重查询和
过期校验。本轮审计发现并修复了一个跨层输入缺口：`ReportReference` 的
`ownerUserId` 之前只检查空白和长度，没有复用平台 opaque 标识规则拒绝控制字符。
现在任务、回放器、测试替身或未来 Worker 直接构造引用时，也会在 domain/persistence
边界 fail-closed。

这项修复只收紧非法输入，不改变合法报告引用的格式、10 分钟业务 TTL、Provider
查询路径或患者端展示字段；没有修改旧项目、旧数据库、旧 Redis、线上进程或真实
Provider 配置。

## 固定不变量

- `ownerUserId` 必须是非空、无首尾空白、无控制字符且不超过 64 个字符的平台 opaque 标识；
- `reportId`、`patientId` 和 `providerReportId` 仍分别执行各自长度与控制字符门禁；
- 引用必须固定为 `provider=zhongyang`、`kind=laboratory`；影像/心电报告不能借用 LIS 详情引用；
- 详情读取必须同时满足 `ownerUserId + patientId + reportId`，单独持有 `reportId` 不构成授权；
- 引用过期、范围错配或存储内容损坏时，不得访问 Provider，也不得把错误伪装成报告空列表。

## 本轮实现与证据

| 层 | 实现 | 证据 |
| --- | --- | --- |
| Domain | `validateReportReference` 复用 `isBoundedOpaqueIdentifier(ownerUserId)`，并保留 64 字符业务上限 | `packages/domain/src/reports.ts` |
| Domain 测试 | 控制字符、首尾空白 owner 均映射为 `invalid_owner` | `packages/domain/src/reports.test.ts` |
| 应用服务 | 详情读取继续先做 owner/患者/引用三元绑定，再访问报告 Provider | `apps/api/src/modules/reports/service.ts` |
| Persistence | 内存与 MySQL repository 共同调用引用校验，避免 fixture 放宽生产边界 | `packages/persistence/src/repositories.ts`、`packages/persistence/src/mysql-repositories.ts` |

本轮定向验证：报告 domain 测试 6 项通过，domain TypeScript 类型检查通过，Biome
检查通过。全量迁移仍需使用同一已部署 release 完成 Provider、公网和真机三层证据；
本地测试不能替代这些证据。

## 未完成边界

当前报告目录/详情仍不能宣称正式业务完成，原因包括：

- 真实 LIS/PACS/ECG 响应字段与当前候选 release 的 Provider 证据尚未完整配对；
- 报告详情附件、云影像下载、分享和随访入口仍保持关闭态；
- 需要在匹配的线上服务端与小程序运行包上取得页面、客户端 requestId、服务端
  traceId/Pino 低敏日志和真实微信会话证据；
- 不能因为 domain、adapter 或本地 API 测试通过，就把报告目录状态从迁移台账的
  `只读已实现/部分迁移` 直接改成正式完成。

