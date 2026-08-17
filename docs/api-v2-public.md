# 新 API 公共接口契约

本文以当前 Elysia 路由和 TypeBox schema 为准，描述患者端实际注册的公共接口。
它解决的是“新服务现在能调用什么、必须提交什么、会返回什么”，不替代 provider
接口文档，也不代表真实微信、众阳、HIS、支付或真机已经验收。

## 1. 路由边界

生产公网入口是 `/api/v2`，阿里云 Nginx 将它转发到新服务内部的 `/api/v1`。新服务
监听内网 `18081`；旧服务继续使用原有端口和路由，不能把旧接口通过万能代理暴露给小程序。

| 调用层 | 路径 | 说明 |
| --- | --- | --- |
| 小程序/公网 | `/api/v2/*` | 对外版本化入口，要求使用 HTTPS 域名 |
| Elysia 内部 | `/api/v1/*` | 应用实际注册的业务路径 |
| Elysia 健康检查 | `/health/*` | 进程内部路径；公网由 Nginx 映射为 `/api/v2/health/*` |
| OpenAPI | `/openapi`、`/openapi/json` | 开发/测试默认开启；生产默认关闭，不作为患者端业务依赖 |

当前 OpenAPI 与本文“当前公共接口”表格的 method/path 清单已经由 `apps/api/src/app.test.ts` 做双向自动门禁：
代码新增、删除或改变输入输出时，必须同时更新该测试、本文和 [`migration/api-matrix.md`](migration/api-matrix.md)。

## 2. 通用请求规则

### 2.1 会话

除健康检查、系统探针、微信登录和微信支付通知外，患者端接口都要求：

```http
Authorization: Bearer <accessToken>
```

`accessToken` 是平台 opaque 会话，不应由小程序解析、拼接用户身份或永久缓存。收到
`401 unauthorized` 后只能重新执行一次 `wx.login()` 并重试，不能无限循环重试。

受保护路由会在 TypeBox 校验 query、body 和 params 之前验证 Bearer 会话；因此未登录或会话失效时，
即使缺少业务参数也必须返回稳定的 `401 unauthorized`。只有认证通过后，才会返回 `400 validation`，
用于表示业务输入本身不完整或不合法；小程序不能把这两类错误混为一谈。

微信登录只接收一次性 `wx.login()` code：

```http
POST /api/v2/auth/wechat
Content-Type: application/json

{"code":"wx.login 返回的一次性 code"}
```

小程序不得提交或接收 `openid`、`unionid`、`session_key`、AppSecret、商户私钥或 provider
原始报文。登录成功响应如下：

```json
{
  "success": true,
  "data": {
    "accessToken": "opaque-platform-token",
    "tokenType": "Bearer",
    "expiresInSeconds": 3600,
    "user": { "id": "internal-user-id" }
  }
}
```

### 2.2 请求追踪和幂等

| Header | 使用范围 | 规则 |
| --- | --- | --- |
| `X-Request-Id` | 业务请求可选 | 用于贯穿小程序、Nginx、API、adapter 和日志；服务端缺失时生成安全 requestId |
| `Idempotency-Key` | 患者同步、创建支付订单、微信预支付 | 支付订单和微信预支付由服务端持久化幂等；患者同步在 `0015` + `0016` schema gate 通过后使用 owner-scoped operation ledger，线上新 release、并发、公网和真机验收仍待完成 |
| `Authorization` | 受保护接口 | 只接受平台 Bearer 会话，不接受 provider token |

患者同步使用 `POST /api/v2/patients/sync`，没有请求体；当前 `Idempotency-Key` 会进入
adapter 请求上下文。当前候选代码在 `0015_patient_directory_sync_operations` 和
`0016_patient_directory_sync_owner_index` 通过 schema gate 的实例中，
会持久化同步 operation、租约代次并在成功快照后禁止重复访问 provider；同 key replay 返回当前 owner
读模型，不保存 provider 原始响应；同一 owner/provider 使用不同 key 时，只要前一个租约未到期也会返回
处理中，不会并发访问 provider。尚未应用 `0016` 的旧实例必须保持 readiness 未就绪，不能把它当作完整
的服务端幂等保证。它不代表新增或绑定了患者。同步成功后，服务端在事务中恢复本次出现的患者为 active，
并将同一 owner/provider 目录中本次未出现的患者标记为 inactive；历史业务引用保留，内部
`patientId` 不更换。只有 provider adapter 确认返回完整目录时才允许这一步，分页结果必须先
在 adapter 内合并。`observedAt` 在 provider 请求发起前采样，较早请求晚返回时不能覆盖
较新的患者资料、临床引用或 active 状态。患者同步的 durable operation ledger 和结果重放仍需完成
新 release 切换、真实并发、公网和真机验收，才能作为线上业务证据；预约写入、患者绑定等命令开放前还必须分别
冻结各自的幂等和最终状态规则。订单创建和微信预支付的幂等键分别独立，不能混用。

`Idempotency-Key` 的公共输入约束是 1 至 128 个字符，只允许 `A-Z`、`a-z`、`0-9`、`.`、`_`、`:`、`-`；
缺失或不符合格式时，已登录请求在 provider 调用前返回 `400 validation`，不会产生患者目录副作用。
认证检查先于 header schema：没有 Bearer 会话或会话已失效时，即使同时缺少幂等键，也统一返回
`401 unauthorized`，不向未认证调用方暴露接口字段校验顺序。
下一步的状态机、租约、事务和 409 语义见
[`migration/patient-sync-idempotency-contract.md`](migration/patient-sync-idempotency-contract.md)。

### 2.3 日期、金额和标识

- 日期查询参数统一为 `YYYY-MM-DD`，由服务端校验；不能透传任意 provider query 参数。
- 当前日期范围按 `endDate - startDate` 的 UTC 日历零点差值校验：预约排班最多 31 天，预约历史和报告目录最多 366 天。
  这是起止日期的跨度上限，不是把首尾都计入后的日期条目数量；provider 的 `endDate` 是否包含当天仍待合同确认，
  不能由小程序自行推断。详细边界见 [`migration/date-window-boundary-audit.md`](migration/date-window-boundary-audit.md)。
- 金额字段使用人民币分的非负整数，例如 `amountFen: 100` 表示 1.00 元。
- `patientId`、`reportId`、`orderId`、`scheduleId`、`quoteId` 都是平台 opaque 标识。
  小程序不能把它们解释为 HIS 号、provider 号或卡号。
- 服务端根据当前会话校验患者归属；小程序不能提交 `ownerUserId` 绕过归属检查。

## 3. 当前公共接口

表中的路径为公网 `/api/v2` 路径。应用源码中的对应内部路径是去掉 `/api/v2` 后换成
`/api/v1`；健康检查是唯一的根路径映射例外。

| 方法 | 公共路径 | 认证/幂等 | 用途和关键输入 |
| --- | --- | --- | --- |
| `GET` | `/api/v2/health/live` | 无 | 只证明 API 进程可响应，返回 `status: ok`；响应带 `Cache-Control: no-store` |
| `GET` | `/api/v2/health/ready` | 无 | 返回 database、redis、schema 的 `ok`/`not_configured`/`unavailable`；响应带 `Cache-Control: no-store`，不是 provider 验收 |
| `GET` | `/api/v2/system/ping` | 无 | 返回服务名和 API 版本，不执行业务依赖探测 |
| `POST` | `/api/v2/auth/wechat` | 无 | body 只有 `code`；服务端完成微信身份兑换并签发平台会话 |
| `GET` | `/api/v2/me` | Bearer | 恢复当前平台用户，只返回内部 `user.id` |
| `GET` | `/api/v2/me/profile` | Bearer | 读取当前用户的普通展示资料；不存在时返回安全默认值，不隐式创建记录 |
| `PUT` | `/api/v2/me/profile` | Bearer | 使用 `version` 更新昵称、性别、年龄、邮箱；不接收实名/微信/患者/头像字段 |
| `POST` | `/api/v2/patients/sync` | Bearer + 必填幂等键 | 从 provider 刷新当前用户的患者目录；不接受 body |
| `GET` | `/api/v2/patients` | Bearer | 返回当前用户 owner-scoped 的脱敏患者目录 |
| `GET` | `/api/v2/appointments/departments` | Bearer；幂等键可选 | 返回 provider 白名单后的科室目录 |
| `GET` | `/api/v2/appointments/schedules` | Bearer；幂等键可选 | 必填 `startDate`、`endDate`；可选 `departmentId`、`doctorId` |
| `GET` | `/api/v2/appointments/records` | Bearer；幂等键可选 | 必填 `patientId`、`startDate`、`endDate`；只读预约历史 |
| `GET` | `/api/v2/reports` | Bearer | 必填 `patientId`、`startDate`、`endDate`；可选 `kind=laboratory|imaging|ecg` |
| `GET` | `/api/v2/reports/{reportId}` | Bearer | 只返回已开放的检验详情白名单，不返回文件 URL |
| `GET` | `/api/v2/payments/outpatient/records` | Bearer；幂等键可选 | 必填 `patientId`、`status=unpaid|paid`；门诊费用只读列表 |
| `POST` | `/api/v2/payments/orders` | Bearer + 必填幂等键 | body 为 `{patientId, quoteId}`；金额必须来自服务端报价 |
| `GET` | `/api/v2/payments/orders/{orderId}` | Bearer | 读取当前用户自己的平台支付订单 |
| `GET` | `/api/v2/payments/orders/{orderId}/wechat-prepay` | Bearer + 必填幂等键 | 读取微信预支付尝试状态；不代表支付成功 |
| `POST` | `/api/v2/payments/orders/{orderId}/wechat-prepay` | Bearer + 必填幂等键 | 请求服务端创建微信 JSAPI 小程序调起参数 |
| `POST` | `/api/v2/payments/wechat/notifications` | 微信支付平台回调鉴权 | 仅微信支付平台调用；响应是 provider 要求的 `{code:"SUCCESS",message:"成功"}`，不是患者端 envelope |

### 3.1 患者目录响应

`GET /patients` 和 `POST /patients/sync` 返回：

```json
{
  "success": true,
  "data": {
    "items": [{
      "id": "patient-opaque-id",
      "displayName": "张*",
      "relationship": "self",
      "cardNumberMasked": "********12345",
      "source": "hospital-his"
    }],
    "total": 1
  }
}
```

`relationship` 只允许 `self`、`spouse`、`child`、`parent`、`other`。`source` 只表示
平台内部来源分类；页面不能把 `other` 当作 provider 错误或直接展示给用户。卡号是服务端
脱敏读模型，不允许小程序自行拼接明文卡号。

### 3.2 普通个人资料

`GET /me/profile` 和 `PUT /me/profile` 只处理 `displayName`、`gender`、`age`、`email`。
当前会话决定 owner，客户端不能提交 `userId`；头像、手机号、身份证、实名姓名、微信
`openid`/`unionid` 和患者字段不属于该 API。详细字段、默认值、版本冲突和 migration 见
[`migration/user-profile-contract.md`](migration/user-profile-contract.md)。

资料不存在时返回 `version=0` 的默认值；首次更新必须使用 `version=0`，保存后版本变为 1。
后续更新必须带当前版本，冲突返回 `409 user-profile-conflict`，客户端应刷新后重试，不能
自动覆盖其他设备的修改。

### 3.3 预约目录和预约历史

预约目录返回规范化的 `departmentId`、`doctorId`、`workDate`、`shiftName`、
`totalSlots`、`availableSlots` 和 `timeGroup`。`timeGroup` 只允许 `point`、`range`、
`unknown`。provider 原始数字状态、provider 号和挂号金额不在公共 contract 中。

预约历史返回 `departmentName`、`doctorName`、`workDate`、可选 `workTime`/`location`/
`serialNumber` 及 `status`。`workTime` 是 adapter 从已确认的时间点或 `groupStart`/
`groupEnd` 归一化后的 `HH:mm` 或 `HH:mm-HH:mm`；原始完整日期时间字段不进入公共响应，
不完整时间段会回退到 provider 的 `workTime`。状态只允许 `scheduled`、`cancelled`、`completed`、`missed`、
`stopped`、`substituted`、`registered`、`unknown`；其中 `stopped` 表示停诊、
`substituted` 表示替诊、`registered` 表示已登记。Provider 已确认的数字状态在 adapter
边界完成映射，不能由小程序根据文字猜测最终状态。Provider 返回重复 `appointmentInfoId` 时，
服务端拒绝整批结果；没有预约号的摘要不会被服务端根据数组位置伪造业务 ID。

小程序的“爽约记录”不是独立公共 endpoint，而是对上述预约历史读模型做安全筛选：只展示服务端
返回的 `status=missed`，当前查询窗口为中国标准时间过去 90 天；`unknown`、空列表或 provider
未返回不能被客户端推断为爽约。

原生“我的挂号”调用该接口时使用当前中国标准时间日前后各 90 天，保证未来已预约记录
不会因为只查询过去而静默消失；原生“爽约记录”调用同一接口时只使用过去 90 天，并且只筛选
服务端明确返回的 `status=missed`。

当前没有以下写入路由：

- `POST /api/v2/appointments/holds`
- `POST /api/v2/appointments`
- `POST /api/v2/appointments/{appointmentId}/cancel`

在 provider 文档、锁号/取消幂等、身份映射、失败补偿和真实验收完成前，旧服务的预约写入
接口不能被转发成新端接口。

### 3.4 报告

报告目录只返回 `kind`、标题、时间、`available`/`abnormal`、`hasAttachment` 和可选的
opaque `reportId`；当前只有检验报告可以返回该 `reportId`。影像和心电 provider 即使返回
原始报告号，也会在 adapter 边界丢弃，因为当前没有对应的可审计详情 contract。检验详情的检测项只包含 `name`、`result`、`unit`、`referenceRange`
和 `flag`；`flag` 为 `normal`、`high`、`low`、`critical` 或 `unknown`。

未指定 `kind` 时，服务端会同时读取 LIS、PACS 和 ECG 三个来源；当前公共 contract 没有部分成功状态，
因此任一来源失败都会让整次目录查询失败，不能把其余来源拼成不完整的成功列表。只有明确返回的空数组
才是对应来源的成功空结果。

目录摘要与详情引用是两个独立能力：provider 没有稳定报告号、详情 gate 未开启或无法建立
短期引用时，目录仍可返回安全摘要并省略 `reportId`，客户端只能隐藏详情入口；不能因为单条详情引用不可用而把整批报告目录当成服务不可用。

影像附件、体检报告、原始报告号、患者字段和文件下载 URL 尚未开放。详情返回 404 不等于
患者没有报告，也可能表示该报告类型尚未通过详情 gate。

### 3.5 门诊缴费和支付

门诊缴费列表只返回 `recordId`、状态、科室/医生、账单时间和 `amountFen`。服务端会先校验
`patientId` 并按当前用户解析 `his-patient` 映射，再调用 provider；空白标识、owner 映射缺失、
持久化失败或 provider 失败都不能变成成功的空列表。当前仍是只读查询；支付调起、医保授权、医保结算、
HIS 回写和退费必须走独立 contract。

Provider 返回的 `tradeStatus` 也必须与查询状态一致：`unpaid` 只接受 `1`，`paid` 只接受 `3`；
缺失、无法识别或错配时服务端整批拒绝结果，不把请求 tab 当作 Provider 事实贴到费用记录上。
该字段的 Provider 数字映射只在服务端 adapter 内完成，不进入小程序公共 response，也不代表支付或结算已经开放。

`status` 同时在领域 service 和 Provider adapter 做运行时白名单校验；即使绕过 Elysia
query schema 的内部任务传入未知值，也只能返回 `400 outpatient-payment-query-invalid`，
不能被按“非 unpaid”降级成 Provider 的 `tradeStatus=3`，也不会访问 Provider。

账单时间按 2.6.33 的约定只接受 `YYYY-MM-DD HH:mm:ss`，并按中国标准时间解释；格式不合法、
自然日不存在或时分秒越界时，adapter 会整批拒绝结果，不把异常时间交给页面自行解析。

`recordId` 是服务端基于 Provider 单据、就诊或项目稳定标识生成的 opaque 引用，不包含返回数组下标；
同一费用在待缴/已缴查询或 Provider 排序变化后仍应保持一致。若 Provider 缺少稳定标识或同一响应出现
重复费用引用，adapter 会拒绝整批结果，避免客户端把不稳定 ID 当作未来支付/详情的业务主键。

平台支付订单的状态是服务端事实模型：

`created` → `authorized` → `pre_settled` → `insurance_submitted` → `insurance_settled`
→ `cash_pending` → `cash_paid` → `his_written_back` → `awaiting_confirmation` → `completed`。

`failed` 和 `cancelled` 是终止分支。小程序不能跳过状态、把 `6202` 或支付调起成功当成
最终结算成功，也不能提交 `totalFen`、`insuranceFen`、`cashFen` 或 HIS 完成状态。支付接口
当前仅完成平台编排边界，真实微信支付、医保、HIS 和真机验收仍未完成。

微信预支付尝试是独立于订单状态的事实：首次申请会先记录 `pending`，成功才变为可重放的
`ready`；外部结果不明确时进入 `unknown`，不能把它当成失败后直接重建。若微信支付依赖未配置，
服务端会把本次尝试收敛为 `unknown` 并返回 `503 dependency-not-configured`，同一幂等键不会永久
停留在 `pending`；配置完成后应重新发起新的幂等尝试。

### 3.6 列表、空结果和大结果集语义

当前患者端所有列表接口都使用同一个最小响应形状：`data.items` 是本次服务端实际返回的数组，
`data.total` 必须等于 `items.length`。当前没有公开 `page`、`pageSize`、`cursor` 或 `hasMore` 字段，
因此 `total` 不是 provider 的隐藏总数，也不是“还有多少页”的估计值。

| 接口 | 服务端数据窗口 | 返回顺序 | 小程序的分批行为 |
| --- | --- | --- | --- |
| `GET /api/v2/patients`、`POST /api/v2/patients/sync` | 当前 owner 的有效目录；同步必须是完整快照 | 使用服务端读模型顺序；第一项只能作为“从未选择过时的展示默认值”，不能解释为本人关系 | 选择页展示完整目录 |
| `GET /api/v2/appointments/departments` | 服务端生成的预约目录日期窗口 | 保留 adapter 返回的 provider 顺序；顺序不是科室优先级事实 | 左栏直接展示目录 |
| `GET /api/v2/appointments/schedules` | 起止日期差值最多 31 天；当前小程序请求未来 7 天；provider `endDate` 包含规则待确认 | 保留 adapter 返回顺序；页面按 `workDate` 升序分组，同一天内保留返回顺序 | 右栏每次最多渲染 12 条；这是本地渲染分页，不减少 provider 请求量 |
| `GET /api/v2/appointments/records` | 起止日期差值最多 366 天；“我的挂号”请求当前日前后各 90 天，“爽约记录”请求过去 90 天；provider `endDate` 包含规则待确认 | 保留 adapter 返回顺序，客户端不得从文字或数组位置推断最终状态 | 当前完整读取后展示 |
| `GET /api/v2/reports` | 起止日期差值最多 366 天；当前小程序请求近 30 天；provider `endDate` 包含规则待确认 | adapter 按 `reportedAt` 倒序，再按 `kind`、`title` 升序稳定排序 | 当前完整读取后每次渲染 10 条；这是本地渲染分页 |
| `GET /api/v2/payments/outpatient/records` | 服务端固定最近 30 个中国标准时间日 | 保留 provider adapter 返回顺序；金额和状态已在服务端映射 | 当前完整读取后展示，不代表支付分页 |

服务端返回已确认的空结果时，接口仍返回 HTTP `200`、`items: []` 和 `total: 0`；空列表不能被
客户端改写成“provider 暂时不可用”。反过来，身份映射缺失、依赖未配置、权限拒绝、超时或 provider
返回结构不合法必须走稳定错误码，不能伪装成空列表。

小程序的“加载更多”目前只控制已经取得的数据如何分批渲染，不能被验收记录写成“服务端已支持分页”。
未来要开放真正分页、游标或大结果集查询，必须先在 provider contract 中冻结游标一致性、排序键、重复项、
快照时间、`total` 语义和失败后的续取方式，再同步修改公共 contract、adapter、页面和验收文档。

## 4. 统一响应和错误

患者端成功响应统一为：

```json
{"success":true,"data":{}}
```

错误响应统一为：

```json
{"success":false,"error":{"code":"unauthorized","message":"请先登录后再继续操作"}}
```

缺少 `Authorization` 时返回“请先登录后再继续操作”；Bearer 会话无法在 Redis 中找到或已经过期时，
返回“登录状态已失效，请重新登录”。两种情况的稳定错误码都是 `unauthorized`，小程序必须按错误码处理，
不能根据 message 文案分支。

当前已注册公共路由会使用以下稳定错误码。`message` 是可记录和排障文本，页面展示应由
小程序按错误码映射，不能依赖英文 message 做业务判断。

| HTTP | `code` | 含义 |
| ---: | --- | --- |
| 400 | `validation` / `parse` | 请求 schema 或 JSON 不合法 |
| 400 | `appointment-query-invalid` | 排班日期/过滤条件不合法 |
| 400 | `appointment-record-query-invalid` | 预约记录查询条件不合法 |
| 400 | `outpatient-payment-query-invalid` | 门诊缴费查询条件不合法 |
| 400 | `report-query-invalid` | 报告查询条件不合法 |
| 400 | `payment-order-invalid` | 创建订单输入不合法 |
| 400 | `payment-notification-rejected` | 微信支付通知验签或内容校验失败 |
| 400 | `user-profile-invalid` | 普通个人资料字段不合法或没有可更新字段 |
| 401 | `unauthorized` | 会话缺失、无效或已过期 |
| 404 | `not-found` | 请求路径未注册，不能据此推断业务资源不存在 |
| 404 | `appointment-record-patient-not-found` | 当前用户不拥有该预约查询患者 |
| 404 | `outpatient-payment-patient-not-found` | 当前就诊人尚未建立门诊缴费映射 |
| 404 | `report-patient-not-found` | 当前用户不拥有该报告查询患者 |
| 404 | `report-not-found` | 报告详情不可用或尚未通过 gate |
| 404 | `payment-order-not-found` | 订单不存在或不属于当前用户 |
| 404 | `payment-quote-not-found` | 服务端报价不存在 |
| 409 | `payment-quote-expired` | 服务端报价已过期，必须重新获取报价 |
| 409 | `payment-idempotency-conflict` | 幂等键与已有订单的请求内容冲突 |
| 409 | `payment-order-conflict` | 订单版本已被其他流程更新 |
| 409 | `payment-notification-conflict` | 重复通知与已落库事件冲突 |
| 409 | `payment-cash-prepay-not-allowed` | 当前订单不允许现金预支付 |
| 409 | `payment-identity-not-found` | 支付身份映射不可用 |
| 409 | `payment-prepay-in-progress` | 预支付仍在处理，不能并发创建 |
| 409 | `payment-prepay-unknown` | 预支付结果需向 provider 确认，不能直接重建 |
| 409 | `patient-sync-in-progress` | 当前用户的患者目录仍在同步，不能并发访问 provider |
| 409 | `user-profile-conflict` | 普通个人资料版本已被其他设备更新 |
| 502 | `provider-request-rejected` | provider 明确拒绝请求，不能盲目重试 |
| 503 | `dependency-not-configured` | 必需服务未配置，当前实例 fail-closed |
| 503 | `persistence-temporarily-unavailable` | 数据库、Redis 或 schema 暂时不可用 |
| 503 | `provider-temporarily-unavailable` | provider 暂时不可用，可按策略重试 |
| 500 | `unknown` | 未分类服务异常；页面不得根据此码推断业务结果 |

小程序端统一在 [`apps/miniprogram/src/services/api-client.ts`](../apps/miniprogram/src/services/api-client.ts)
按上述稳定错误码映射中文文案；新增公共错误码时必须同步更新该映射和验收测试。未知错误码只展示安全兜底，
不能直接展示 provider 或内部错误文本；`statusCode`、`code` 和 `requestId` 仅用于客户端排障关联。

## 5. 当前实现边界

以下内容在旧服务中存在，但当前没有注册为新患者端公共路由：医保 FSI、医保身份授权、云
健康结算/HIS 回写、文件上传、健康知识、健康自测、报告解读、AI 导诊、管理端 RBAC、监控
和任务管理。旧接口逐项来源和状态见
[`migration/legacy-api-endpoint-inventory.md`](migration/legacy-api-endpoint-inventory.md)，
完整前置条件见 [`migration/api-matrix.md`](migration/api-matrix.md)。

特别是：

1. `200` 只证明本次 HTTP 调用返回成功，不证明 provider 业务成功。
2. `health/live` 不检查数据库、Redis、schema 或 provider；发布门禁必须检查 `health/ready`
   和独立依赖探针。
3. 旧服务可返回某接口，不代表新服务可以安全转发该接口；缺少 contract 时必须保持未注册。
4. 真实 provider 文档到达后，先进入 [`provider-document-intake.md`](provider-document-intake.md)
   做版本、来源、hash、字段和错误码冻结，再实现写入/支付/医保能力。

以下候选路径当前刻意保持 `404`，不是兼容入口，也不是“暂时返回空数据”：

- `POST /api/v2/patients`：患者新增/建档；
- `GET /api/v2/medical-records`、`GET /api/v2/medical-records/{visitRecordId}`：门诊就诊记录目录与详情；
- `POST /api/v2/payments/insurance/authorization`：医保授权。

它们必须先完成 provider/HIS contract、owner 映射、状态/幂等、脱敏和真实验收，才允许进入公共
OpenAPI；旧服务存在对应能力不改变这一关闭状态。

## 6. 源码证据与维护入口

- 路由组合：[apps/api/src/app.ts](../apps/api/src/app.ts)
- 患者/预约/报告模块：[apps/api/src/modules](../apps/api/src/modules)
- TypeBox 公共 schema：[packages/contracts/src/index.ts](../packages/contracts/src/index.ts)
- 错误码映射：[apps/api/src/plugins/error-handler.ts](../apps/api/src/plugins/error-handler.ts)
- OpenAPI 路径门禁：[apps/api/src/app.test.ts](../apps/api/src/app.test.ts)
- 微信登录、域名和线上路由：[`wechat-auth-login.md`](wechat-auth-login.md)
- 日志字段与脱敏：[`logging.md`](logging.md)

修改公共接口时，必须同一提交完成：schema/路由、服务端业务不变量、日志事件、测试、本文
和迁移矩阵；真实生产和真机证据另存于发布验收文档，不能用本地测试替代。
