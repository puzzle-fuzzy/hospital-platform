# Provider 接口文档接收与冻结流程

本文是新 provider 文档到达后的统一入口。它适用于众阳、HIS、云健康、医保、微信支付、外部小程序和 web-view 服务。
旧端代码、旧网络请求或某次成功响应只能作为线索，不能单独作为新 contract 的依据。

仓库级结构门禁为 `pnpm provider:audit`，并已纳入 `pnpm check`。它检查文档是否登记稳定 `documentId`、版本/适用环境、
逐文件 SHA-256 指纹、状态、脱敏边界、冻结/未开放边界、下一步证据和 `docs/README.md` 入口，并拒绝跨接收记录重复
`documentId`；它不会替代 Provider/院方对业务事实的确认。

截至 2026-08-16，最近一批挂号/支付/退款材料的接收记录见
[`provider-intake/2026-08-16-appointment-registration-payment-refund.md`](provider-intake/2026-08-16-appointment-registration-payment-refund.md)。
该记录当前为 `normalized`，用于说明“已经解析过哪些事实、还缺哪些前置依赖”，不代表已获得生产权限或允许注册接口。

同日补充复核的门诊结算、支付状态和医保回写材料见
[`provider-intake/2026-08-16-outpatient-settlement-insurance.md`](provider-intake/2026-08-16-outpatient-settlement-insurance.md)。
它们只补充流程事实和内容指纹；支付、医保、退款和 HIS 回写仍按最后阶段处理，不能因为材料齐全就打开 gate。

2026-08-17 旧项目文档目录复核又发现一批此前未登记的材料，见
[`provider-intake/2026-08-17-legacy-document-discovery.md`](provider-intake/2026-08-17-legacy-document-discovery.md)。
这批材料已经完成来源指纹和业务风险分类，但不改变当前 Provider 权限、生产配置或任何 route 的开放状态；其中
门诊待支付列表只用于核对现有只读 adapter，门诊结算、医保规范和微信医保订单材料继续保持最后阶段冻结。

2026-08-21 只读复核确认：`docs/provider-intake/` 仍只有上述 3 份登记记录，状态均为 `normalized`，没有新增正式
Provider/HIS contract、确认环境或四类脱敏响应样例。本次没有运行另一个会话的自动获取流程，也没有修改其相关文件；病历、报告、
二维码、患者绑定、支付、医保和 HIS 回写的准入边界保持不变。

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

`documentId` 是来源材料的稳定主键，不是接口路径、患者号或订单号。一个接收记录可以登记多个原始文件，
但每个文件必须对应一条唯一 ID 和一个完整 SHA-256；后续重新收到同名文件时，应新建版本化 ID 或先更新
原记录的来源版本，不得静默覆盖旧指纹。

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

## 7. 当前材料缺口台账（2026-08-19）

本表只描述准入缺口，不代表已经收到新的 Provider 文件，也不把旧端抓包或历史成功响应升级为正式 contract。
每个业务域必须先补齐表中的最小材料包，再单独建立版本化 contract；缺口存在时继续保持页面提示、未注册路由或
独立 gate 的 fail-closed 状态。

| 业务域 | 当前材料状态 | 已有边界/草案 | 进入实现前的最小材料包 | 当前动作 |
| --- | --- | --- | --- | --- |
| 患者新增/绑定家属 | 未收到当前环境的正式绑定 contract | [`migration/patient-binding-contract-draft.md`](migration/patient-binding-contract-draft.md)；PB-01 至 PB-16 | 绑定/建档 endpoint、身份核验、协议确认、owner 归属、重复/超时/幂等样例、撤销和错误码 | 只维护患者目录读取；“添加就诊人”不伪造成功 |
| 门诊就诊记录/病历目录 | 未收到 `out-visit-records` 的正式确认包 | [`migration/medical-record-directory-contract-draft.md`](migration/medical-record-directory-contract-draft.md)；MR-01 至 MR-15 | 请求/响应 envelope、`patId` 映射、成功空目录/权限拒绝/暂时失败样例、分页/时区、字段白名单和资源授权 | 不注册 `/api/v2/medical-records`；保持 404 |
| 报告目录与详情 | 代码骨架存在，但当前 Provider gate 和资源授权仍未完成 | [`migration/report-provider-contract-audit-2026-08-19.md`](migration/report-provider-contract-audit-2026-08-19.md) | 当前 LIS/PACS/ECG/体检环境的脱敏成功与失败样例、时间格式、详情/附件权限、短期引用和公网验收入口 | 继续保持报告 gate；不开放下载、影像/心电详情或体检接口 |
| 首页二维码 | 未收到医院扫码协议 | [`release/qr-contract-audit-2026-08-17.md`](release/qr-contract-audit-2026-08-17.md) | 扫码载荷定义、签名、短 TTL、一次性/防重放、撤销、扫码回执、医院设备和真机隔离验收 | 保留入口但显示未开放；不使用 `patId` 或完整卡号生成二维码 |
| 现金支付/医保/HIS 回写 | 已收到历史规范材料，但当前状态仍为 `normalized`，不是已确认生产 contract | [`provider-intake/2026-08-16-outpatient-settlement-insurance.md`](provider-intake/2026-08-16-outpatient-settlement-insurance.md) | 当前环境鉴权、金额守恒、6201/6202/6301/6203/6401 状态机、回调/查单/补偿、HIS 顺序和回滚样例 | 按用户要求最后处理；支付、医保和回写 gate 保持关闭 |

### 缺口转正式实现的顺序

```text
收到原始材料
  -> 登记 documentId / 版本 / 环境 / SHA-256
  -> 脱敏并取得成功、空、拒绝、暂时失败样例
  -> 明确 owner 映射、字段白名单、时区、幂等和日志禁止字段
  -> 更新对应差异审计与 contract
  -> contract / adapter / domain / API / 小程序 / 验收逐层实现
```

如果只拿到一段抓包或一个成功响应，最多把对应材料登记为 `normalized`；不能跳过失败语义、权限边界和回滚证据，
也不能为了让页面可点击而加入万能转发。这样可以保证旧 Python 服务继续运行，新服务的每个业务域仍可独立回滚。
