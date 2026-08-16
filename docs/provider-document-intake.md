# Provider 接口文档接收与冻结流程

本文是新 provider 文档到达后的统一入口。它适用于众阳、HIS、云健康、医保、微信支付、外部小程序和 web-view 服务。
旧端代码、旧网络请求或某次成功响应只能作为线索，不能单独作为新 contract 的依据。

截至 2026-08-16，最近一批挂号/支付/退款材料的接收记录见
[`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md)。
该记录当前为 `normalized`，用于说明“已经解析过哪些事实、还缺哪些前置依赖”，不代表已获得生产权限或允许注册接口。

## 1. 接收阶段

文档可以来自文件、网页、OpenAPI、接口导出、请求/响应样例、抓包、录屏或 provider 工程师确认；无论来源形式如何，
进入仓库前都要登记一条文档记录：

| 字段 | 要求 |
| --- | --- |
| `documentId` | 仓库内稳定标识，例如 `zhongyang-amc-2026-08-v2` |
| 来源 | provider、联系人/确认人、原始位置或传输渠道 |
| 版本 | 文档版本、发布日期、适用环境和有效期 |
| 完整性 | 文件名/页面地址、SHA-256 或可复核的内容指纹、接收时间 |
| 环境 | sandbox、staging、production 或内网专用环境 |
| 范围 | 业务域、接口列表、是否包含回调/状态查询/错误码 |
| 敏感内容 | 是否含 token、证书、身份证号、卡号、签名原文；敏感值必须先脱敏 |
| 当前状态 | `received`、`normalized`、`confirmed`、`rejected` 或 `expired` |

真实密钥、AppSecret、私钥、证书和完整患者数据不进入 Git；通过受控的环境变量/密钥传输进入运行环境。
抓包只保留脱敏后的 method、path、必要 header 名、请求字段结构、响应字段结构和状态码。

## 2. 标准化阶段

每一个 endpoint 单独形成一张 contract 卡片，不允许把一个 provider 的多个业务流程合并成“万能调用”：

| 类别 | 必须冻结的事实 |
| --- | --- |
| 请求 | method、path、query/body/header、编码、必填/条件字段、长度、单位、示例 |
| 身份 | 调用方、token/签名/证书、患者标识来源、权限、过期时间和刷新方式 |
| 响应 | HTTP envelope、业务成功条件、字段类型、枚举、空值、分页和排序 |
| 失败 | HTTP/业务错误码、是否可重试、超时后的最终查询方式、人工处理路径 |
| 状态 | 状态机、幂等键、并发冲突、锁/过期/取消/退款/回写顺序 |
| 金额 | 元/分/字符串精度、费用明细守恒、舍入、渠道边界和最终权威来源 |
| 安全 | PII、日志禁记字段、回调验签、短期引用、脱敏、审计和资源授权 |
| 证据 | golden fixture、sandbox 响应、失败样例、provider request id 和验收步骤 |

未在文档、样例或 provider 确认中出现的字段，不能进入公共 `contracts`；如 adapter 为了兼容必须读取，
只能保留在 adapter 内部，并标记 `待确认`，不得透传给 domain、API 或小程序。

## 3. 差异核对阶段

实现前先写差异记录，至少回答：

1. 旧端调用的 path、请求头和患者标识是否仍有效；
2. 旧端字段是否包含 provider 患者号、完整身份证、完整卡号、金额或支付状态；
3. 新端内部 `patientId` 如何通过 owner-scoped mapping 得到 provider 标识；
4. 旧端的 HTTP 200 是否可能承载业务失败；
5. 超时、重复请求和服务重启后如何确认最终状态；
6. 新端是否需要独立 migration、TTL、幂等键、outbox、worker 和补偿任务；
7. 小程序是否只需要脱敏读模型，还是存在真实写入/授权/支付行为。

差异未解决时，状态保持 `normalized`，不注册公开 route、不打开 gate、不部署生产。

## 4. 实现顺序

确认后的单个业务域必须按以下顺序落地：

```text
文档记录
  -> contract schema / error code
  -> domain state / invariant
  -> adapter + golden fixture
  -> persistence / migration / idempotency
  -> Elysia API + owner/auth boundary
  -> native mini-program page
  -> Pino events + redaction test
  -> API/public/DevTools/real-device acceptance
```

以下任一项缺失，都只能标记“代码已实现”或“待验收”，不能标记“真实已验收”：

- provider 受控请求和失败样例；
- 公网 HTTPS/反向代理路径；
- MySQL/Redis/schema 证据；
- 小程序开发者工具和真机证据；
- 日志能以 `requestId/traceId/providerRequestId` 定位，且没有敏感字段；
- 回滚步骤不影响旧 Python 服务、旧端口和旧数据库语义。

## 5. 文档产物约定

每个完成域至少同步更新：

- `docs/provider-contract-v1.md` 或新的版本化 contract 文档；
- `docs/migration/api-matrix.md`；
- `docs/migration/legacy-page-matrix.md` 与 `remaining-migration-inventory.md`；
- `docs/logging.md`；
- `docs/release/*-acceptance.md`；
- `packages/contracts`、`packages/domain`、`packages/adapters` 和对应测试。

版本升级不能只修改 adapter 字段。应保留旧版本差异、迁移原因、fixture 变化、生产 gate 变化和回滚方式。

## 6. 当前冻结边界

在新的 provider 文档和受控证据到达前，以下内容保持冻结：预约写入/锁号/取消、费用详情、微信支付、医保授权/结算、
HIS 回写、二维码、住院数据、病历详情、动态地图定位、AI 导诊和需要临床确认的健康自测结果。
页面可以保留明确的迁移提示，但不能通过旧 provider 万能转发来制造“功能已完成”的假象。
