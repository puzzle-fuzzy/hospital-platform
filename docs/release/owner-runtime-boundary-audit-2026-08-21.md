# owner / patient 运行时授权边界审计（2026-08-21）

> 当前候选：服务端 release `5a31427`；小程序运行包来源 `03d9d25d80d5a5d872a9137c7df0aa19a91ba38f`（提交 `03d9d25`）。

> 当前发布基线：服务端 `5a31427`；小程序候选 `03d9d25`；完整运行包来源
> `03d9d25d80d5a5d872a9137c7df0aa19a91ba38f`。本轮代码尚未部署，不代表真实 Provider 或真机验收完成。

## 本轮发现

患者目录 service 已经在 owner、调用上下文和下游访问前做运行时校验，但预约历史、门诊费用、报告目录/详情和普通资料
仍只依赖 TypeScript 的 `ownerUserId/userId: string` 声明。HTTP 路由中的 owner 确实来自已验证会话，因此公网路径不会直接暴露
这个缺口；然而组合根、回放任务和未来 Worker 可以绕过 Elysia，非法 owner 可能先进入仓储查询、短期报告引用或条件更新。

这不是把客户端传入的 owner 放行问题，而是同一服务层 contract 在不同调用入口不一致的问题。修正目标是统一 fail-closed，
不是新增兼容参数或改变患者归属规则。

## 已完成的运行时边界

| service | 校验位置 | 非法输入的稳定错误 | 被阻止的下游 |
| --- | --- | --- | --- |
| 预约历史 | `listRecords` 的上下文门禁之后、患者映射之前 | `appointment-record-query-invalid` | owner-scoped patient reference、预约 Provider |
| 门诊费用 | `list` 的上下文门禁之后、状态和患者映射之前 | `outpatient-payment-query-invalid` | owner-scoped patient reference、费用 Provider |
| 报告目录/详情 | `list/detail` 的上下文门禁之后、患者映射/引用仓储之前 | `report-query-invalid` | 患者映射、报告引用仓储、报告 Provider |
| 普通资料 | `get/update` 的上下文门禁之后、资料仓储之前 | `user-profile-invalid` | 资料读取和条件更新 |

所有校验复用 `isBoundedOpaqueIdentifier`：拒绝空值、首尾空白、控制字符和超长值，但不擅自增加尚未冻结的字符白名单。
失败日志只保留固定错误类型和安全 trace，不写入非法 owner/userId 原值。有效调用的业务结果、患者选择和 Provider contract 不变。

## 回归证据

| 检查 | 结果 |
| --- | --- |
| 预约、门诊费用、报告、普通资料 service 定向测试 | 77 pass / 313 expects |
| API/domain typecheck | 通过 |
| Biome 定向检查 | 通过 |
| 当前 release baseline / 文档断链审计 | 通过；分别为 `5a31427 + 03d9d25`、395 个文档无断链 |

每个受影响 service 都有非法 owner/userId 的 direct-call 回归测试，并断言不会触达仓储、Provider 或资料写入。支付预支付、
医保授权、6201/6202/6301、结算、退款和 HIS 回写不在本轮范围内，避免在 Provider contract 未冻结时扩大改动面。

## 下一步

先完成 API 全量测试、运行包来源和文档基线复核，再提交本轮代码。随后仍需使用当前 `03d9d25` 候选采集真实微信会话、
患者切换、预约历史和门诊费用的页面 / 客户端 HTTP / 服务端低敏日志三层证据；本地 direct-call 测试不能替代这些证据。
