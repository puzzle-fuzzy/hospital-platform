# Provider Endpoint Contract 模板

> 本文件是收到新 provider/HIS/医保/微信/外部服务文档后的逐接口填写模板。
> 复制本文件为版本化 contract，例如 `migration/medical-record-directory-contract-v1.md`，
> 填写完毕并经过确认后，才允许进入 `packages/contracts`、adapter、API 或生产 gate。
>
> 未确认的字段必须保留为“待确认”，不能为了兼容旧端而透传。

## 1. Contract 元数据

| 字段 | 内容 |
| --- | --- |
| `documentId` | 例如 `provider-domain-2026-08-v1` |
| 业务域 | 例如门诊记录、预约写入、病历正文、医保授权 |
| provider/系统 | provider 名称、HIS/医保/微信服务名称 |
| 文档版本 | 版本号、发布日期、生效日期、有效期 |
| 来源与确认人 | 原始文件/页面/传输渠道、provider 联系人或院内确认人 |
| 适用环境 | sandbox / staging / production / 内网专用 |
| 内容指纹 | 脱敏后文档或附件的 SHA-256；敏感原文不入 Git |
| 接收时间 | `Asia/Shanghai` 时间 |
| 当前状态 | `received` / `normalized` / `confirmed` / `rejected` / `expired` |
| 关联旧端 | 旧页面、旧 API、旧表或旧任务；只作为差异线索 |
| 关联新端 | 目标 contract、domain、adapter、migration、route 和页面 |

## 2. 单个 endpoint 卡片

每一个 path 单独填写一张卡片。一个接口的查询、写入、回调、查单和退款不能合并成“万能调用”。

### 2.1 基本信息

| 字段 | 内容 |
| --- | --- |
| 操作名 | 稳定的内部 operation 名，不直接使用模糊页面名称 |
| method/path | 精确 method、path、版本和环境 |
| 调用方向 | 新 API → provider / provider → webhook / worker → provider |
| 业务目的 | 该接口产生或读取的业务事实 |
| 最终权威 | provider 响应、查单、回调、HIS 状态还是人工确认 |
| 是否允许公开 | 只读目录 / 患者命令 / 内部 worker / 回调；默认不公开 |

### 2.2 请求与身份

```yaml
request:
  query: []
  path: []
  headers: []
  body: []
  encoding: ""
  timeout_ms: null
identity:
  caller: ""
  auth_scheme: ""
  patient_reference_source: ""
  owner_check: ""
  expires_in: ""
```

必须同时记录：

- 字段类型、是否必填、条件必填、长度、枚举、单位和编码；
- 平台内部 `patientId` 如何按 owner 和用途解析为 provider 引用；
- token、签名、证书、授权码和回调验签的生命周期；
- 患者是否需要显式授权，以及撤回后如何拒绝后续请求；
- 不能由小程序提交的字段：provider 患者号、完整身份证/卡号、金额、支付状态和 HIS 状态。

### 2.3 响应白名单

```yaml
response:
  http_success_condition: ""
  business_success_condition: ""
  envelope: ""
  fields:
    - provider_field: ""
      internal_field: ""
      type: ""
      nullable: false
      public: false
      masking: ""
      source_confirmed: false
  empty_result_semantics: ""
  pagination: ""
  ordering: ""
```

每个字段必须标明 `public`、脱敏方式、空值语义和确认来源。未确认字段只能停留在 adapter 内部，
不能进入 domain、公共 API、原生小程序或日志。

### 2.4 失败、重试和最终状态

| 情况 | HTTP/业务码 | 是否可重试 | 重试上限/退避 | 最终查询方式 | 用户态语义 |
| --- | --- | --- | --- | --- | --- |
| 成功 |  |  |  |  |  |
| 参数/权限拒绝 |  | 否 |  |  |  |
| 未配置/未授权 |  | 否 |  |  |  |
| 超时/连接失败 |  |  |  |  |  |
| provider 处理中 |  |  |  |  |  |
| 重复请求/并发冲突 |  |  |  |  |  |
| 回调重复或验签失败 |  |  |  |  |  |

必须明确：HTTP 200 是否可能承载业务失败；超时后能否查单；未知状态如何进入 `awaiting_confirmation`、
人工处理或补偿队列；前端不能把“调起成功”“已受理”显示为业务成功。

### 2.5 幂等、状态与持久化

```yaml
state:
  states: []
  transitions: []
  terminal_states: []
  unknown_state_policy: ""
idempotency:
  required: false
  key_source: ""
  scope: "owner + operation + resource"
  conflict_policy: ""
  lease_or_lock: ""
persistence:
  required: false
  tables_or_events: []
  unique_constraints: []
  ttl: ""
  rollback: ""
```

写入、支付、医保、回调、查单和文件引用必须说明事务边界、唯一约束、租约、版本条件更新、补偿和回滚；
只读目录也必须说明日期窗口、分页快照和大结果集限制。

### 2.6 安全与日志

| 项目 | 已确认规则 |
| --- | --- |
| 公共输出禁止字段 | provider ID、完整身份证/卡号、手机号、原始 XML/JSON、支付凭证、文件 URL |
| 日志允许字段 | `requestId`、`traceId`、operation、providerRequestId、低敏状态和重试判断 |
| 日志禁止字段 | Authorization、token、secret、原始请求/响应、患者身份和医疗正文 |
| 资源授权 | owner、患者、业务任务、TTL、下载次数、撤销和审计 |
| 数据保留 | 业务事实、原始报文、文件、审计事件分别定义保留期和删除/归档规则 |

## 3. 差异与实现门禁

在进入实现前，必须回答：

1. 旧端实际请求和新文档是否使用同一个患者标识、机构上下文和权限范围；
2. 新端是否需要新的 provider reference kind，能否复用现有映射；
3. 旧端字段是否包含客户端可伪造的患者/医生/科室/金额/状态；
4. 是否需要新的 migration、opaque 引用、TTL、outbox、worker 或人工补偿；
5. 小程序只读展示、命令写入、支付调起和最终业务成功是否被分成不同事实；
6. 旧服务继续运行时，新 migration、route、gate 和回滚是否会影响旧表、旧端口和旧 Redis namespace。

以下任一条件未满足，状态只能是 `normalized`，不能部署生产：

- 文档来源、版本和内容指纹已登记；
- 成功、空列表、业务失败、权限失败、超时、重复请求样例齐全；
- 字段白名单、患者映射、owner 权限和日志禁止字段已确认；
- contract/domain/adapter/persistence/API/小程序边界已评审；
- 具备脱敏 golden fixture、回滚步骤和真实验收计划。

## 4. 实现后必须留下的证据

| 层级 | 证据 |
| --- | --- |
| Provider | 受控请求、响应、失败样例、provider request id 和确认记录 |
| 代码 | contract、domain 不变量、adapter 白名单和边界测试 |
| 数据库 | migration、schema probe、唯一约束、TTL、事务/补偿测试 |
| API | owner/auth、错误码、OpenAPI、日志 redaction 和公网路径 |
| 小程序 | 页面注册、加载/空/错误/重试、患者切换和旧响应淘汰 |
| 运行 | 开发/生产模式日志、MySQL/Redis/schema readiness、回滚演练 |
| 真实验收 | 内网、反向代理、公网 HTTPS、微信开发者工具和真机（适用时） |

所有证据完成前，迁移状态只能写“代码已实现/待验收”，不能写“业务已完成”。
