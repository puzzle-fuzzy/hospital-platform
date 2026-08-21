# 日志最终脱敏边界审计（2026-08-21）

> 本轮只修改新项目的观测层和测试，不调用真实 Provider，不修改线上配置、MySQL、Redis、旧 Python 服务或并行会话维护的众阳自动化代码。

## 1. 审计结论

现有业务模块已经遵守“只记录 trace、状态、数量和有限 Provider 请求号”的规则，但日志最终输出层之前主要覆盖已知的 camelCase 字段。Provider 网关的不同版本可能返回 snake_case 字段，或者把原始响应放在 `provider_raw_payload`、`response_body` 等容器中；如果未来维护者误把这些对象交给 logger，原有字段清单不能完整兜底。

本轮已在 `packages/observability/src/index.ts` 补充：

- 患者身份、卡号、证件、电话、地址、邮箱等常见 snake_case 和移动端别名；
- `providerRaw`、`provider_raw_payload`、`rawResponse`、`response_body`、`request_body`、`body` 等原始报文容器；
- 与现有 Pino 路径脱敏保持同一清单，并继续通过最终 JSON 输出边界递归替换原值。

这不是允许业务代码记录原始报文。业务日志仍然只能通过白名单元数据记录 Provider 状态和请求关联号；最终脱敏只是防止未来误用时形成第二条泄露路径。

## 2. 代码与测试证据

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @hospital/observability test` | 7 项通过，0 项失败，28 个断言 |
| `pnpm --filter @hospital/observability typecheck` | 通过 |
| Biome（观测层实现与测试） | 通过 |

新增回归覆盖深层嵌套的 `patient_name`、`id_card_no`、`mobile_phone`、`card_no`，以及原始报文容器；断言原值不会进入最终 JSON，并确认字段被替换为 `[REDACTED]`。

## 3. 仍然禁止的做法

- 不在业务日志中传入 Provider 原始响应、URL、请求体、患者号、身份证号、完整卡号、手机号、邮箱或 access token；
- 不把 `Error.message`、`cause` 或 SQL/连接串作为排障字段直接写入 journald；
- 不因日志脱敏测试通过而宣称真实 Provider、真机、支付、医保或 HIS 业务已验收；
- 任何报告、门诊费用、预约和患者同步业务仍必须取得同一会话的页面、HTTP 和服务端低敏日志三层证据。

## 4. 后续门禁

下一步仍按既定顺序使用最新小程序运行包取得真实微信会话、显式患者切换、预约历史和门诊费用只读证据；普通资料写入及 409 并发证据随后单独验收。病历、患者新增/绑卡、二维码、支付、医保、退款和 HIS 写回在正式 contract 到达前继续保持关闭。
