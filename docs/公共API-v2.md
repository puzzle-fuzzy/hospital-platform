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
代码新增、删除或改变输入输出时，必须同时更新该测试、本文和 [`迁移/API矩阵.md`](迁移/API矩阵.md)。

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

无论接口返回成功还是错误，服务端都会在响应头返回最终采用的 `X-Request-Id`；错误响应不会因为进入统一错误处理器而丢失它。
小程序将该值保存到 `ApiError.requestId`，用于关联服务端 `http.request.failed`、业务失败事件和反向代理日志。
一次 401 自动登录重试可能对应多个物理 HTTP 请求，每个请求都有独立 requestId；最终抛出的错误只代表最后一次失败请求的链路号。
该标识只用于排障关联，不是会话凭证，也不应被页面当作业务主键展示或持久化。

患者同步使用 `POST /api/v2/patients/sync`，没有请求体；当前 `Idempotency-Key` 会进入
adapter 请求上下文。当前候选代码在 `0015_patient_directory_sync_operations` 和
`0016_patient_directory_sync_owner_index` 通过 schema gate 的实例中，
会持久化同步 operation、租约代次并在成功快照后禁止重复访问 provider；同 key replay 返回当前 owner
读模型，不保存 provider 原始响应；同一 owner/provider 使用不同 key 时，只要前一个租约未到期也会返回
处理中，不会并发访问 provider。尚未应用 `0016` 的旧实例必须保持 readiness 未就绪，不能把它当作完整
的服务端幂等保证；当前生产实例 `398be8e` 已应用 `0016` 并通过 schema probe。它不代表新增或绑定了患者。同步成功后，服务端在事务中恢复本次出现的患者为 active，
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
[`迁移/患者同步幂等契约.md`](迁移/患者同步幂等契约.md)。

### 2.3 日期、金额和标识

- 日期查询参数统一为 `YYYY-MM-DD`，由服务端校验；不能透传任意 provider query 参数。
- 当前日期范围按 `endDate - startDate` 的 UTC 日历零点差值校验：预约排班最多 31 天，预约历史和报告目录最多 366 天。
  这是起止日期的跨度上限，不是把首尾都计入后的日期条目数量；provider 的 `endDate` 是否包含当天仍待合同确认，
  不能由小程序自行推断。详细边界见 [`迁移/日期窗口边界审计.md`](迁移/日期窗口边界审计.md)。
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
| `GET` | `/api/v2/appointments/department-tree` | Bearer；幂等键可选 | 返回挂号页的一级/二级真实科室树 |
| `GET` | `/api/v2/appointments/clinic-departments` | Bearer；幂等键可选 | 必填 `parentDepartmentId`；返回该受控二级科室下的三级可预约门诊 |
| `GET` | `/api/v2/appointments/schedules` | Bearer；幂等键可选 | 必填 `startDate`、`endDate`；可选 `departmentId`、`doctorId` |
| `GET` | `/api/v2/appointments/schedules/{scheduleId}/sources` | Bearer；幂等键可选 | 读取单个排班的分时段号源；`scheduleId` 必须对应未过期排班快照，否则 404 `appointment-schedule-reference-expired`；不返回 provider 号源 ID、锁号状态或费用 |
| `POST` | `/api/v2/appointments/holds` | Bearer + 幂等键 | body 为 `{patientId, scheduleId, sourceSerialNumber}`；服务端重新读取有效排班、号源和挂号费，创建 60 秒服务端占位 |
| `POST` | `/api/v2/appointments/registrations` | Bearer + 幂等键 | body 为 `{patientId, holdId}`；服务端执行重复预约检查、预约写入并保存 owner-scoped 取消映射 |
| `POST` | `/api/v2/appointments/registrations/{appointmentId}/cancel` | Bearer + 幂等键 | 通过服务端预约映射调用取消接口；重复取消返回已取消，不接收 provider 预约号 |
| `GET` | `/api/v2/appointments/records` | Bearer；幂等键可选 | 必填 `patientId`；默认 `scope=online` 时必填日期，`scope=all` 时不传日期；只读预约历史 |
| `POST` | `/api/v2/payments/medical-insurance/authorize` | Bearer + 必填幂等键 | body 为 `{appointmentId, authCode}`；授权码只在服务端调用医保授权 adapter，成功后返回服务端 `orderId` |
| `POST` | `/api/v2/payments/medical-insurance/orders/{orderId}/fees` | Bearer + 必填幂等键 | 从关联预约读取服务端金额和患者映射，独立执行医保费用上传 |
| `POST` | `/api/v2/payments/medical-insurance/orders/{orderId}/settle` | Bearer + 必填幂等键 | 使用已授权订单和费用上传引用，独立执行医保结算，不把中间状态当成功 |
| `GET` | `/api/v2/payments/medical-insurance/orders/{orderId}` | Bearer；幂等键可选 | 查询医保订单最终状态和服务端金额快照；不返回 payToken、身份证或 provider 原始字段 |
| `GET` | `/api/v2/my/doctors` | Bearer | 返回当前平台用户关注的医生关系；不接收 `userId` 或 `patientId` |
| `GET` | `/api/v2/my/doctors/{doctorId}` | Bearer | 返回当前用户自己的单个医生关系快照 |
| `POST` | `/api/v2/my/doctors` | Bearer + 幂等键可选 | body 只有 `{doctorId}`；服务端从当前排班目录确认医生资料后建立关注关系 |
| `DELETE` | `/api/v2/my/doctors/{doctorId}` | Bearer + 幂等键可选 | 幂等取消当前用户的医生关注关系；不会按 GET 执行破坏性操作 |
| `GET` | `/api/v2/knowledge/health/part/list` | Bearer | 返回已发布健康百科的身体部位目录；没有审核发布版本时 fail-closed |
| `GET` | `/api/v2/knowledge/health/crowd/list` | Bearer | 返回已发布健康百科的人群目录；不接受 provider 或患者参数 |
| `GET` | `/api/v2/knowledge/health/department/list` | Bearer | 返回已发布健康百科的科室目录；不接受 provider 或患者参数 |
| `GET` | `/api/v2/knowledge/health/symptoms/list/part/{partId}` | Bearer | 返回指定身体部位下的审核症状目录 |
| `GET` | `/api/v2/knowledge/health/disease/list/part/{partId}` | Bearer | 返回指定身体部位关联的审核疾病目录 |
| `GET` | `/api/v2/knowledge/health/disease/list/crowd/{crowdId}` | Bearer | 返回指定人群关联的审核疾病目录 |
| `GET` | `/api/v2/knowledge/health/disease/list/department/{departmentId}` | Bearer | 返回指定科室关联的审核疾病目录 |
| `GET` | `/api/v2/knowledge/health/disease/list/symptoms` | Bearer | 根据 1–10 个审核症状标识查询疾病；使用 `symptomIds` 查询参数 |
| `GET` | `/api/v2/knowledge/health/disease/detail/{diseaseId}` | Bearer | 返回指定审核疾病详情和可审计药品引用 |
| `GET` | `/api/v2/knowledge/health/drug/detail/{drugId}` | Bearer | 返回指定审核药品详情；不构成个体化用药建议 |
| `GET` | `/api/v2/reports` | Bearer | 必填 `patientId`、`startDate`、`endDate`；可选 `kind=laboratory|imaging|ecg` |
| `GET` | `/api/v2/reports/{reportId}` | Bearer | 必填 query `patientId`；只返回已开放的检验详情白名单，不返回文件 URL |
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
      "cardNumberMasked": "12345*********2345",
      "source": "hospital-his",
      "clinicalAccess": "ready"
    }],
    "total": 1
  }
}
```

`relationship` 只允许 `self`、`spouse`、`child`、`parent`、`other`、`unknown`。
`other` 仅表示 Provider 明确返回“其他”；`unknown` 表示关系未提供或暂时无法识别，
不能将两者互相替换。`source` 只表示平台内部来源分类；页面不能把 `other` 当作 provider
错误或直接展示给用户。卡号是服务端
脱敏读模型，不允许小程序自行拼接明文卡号。

`clinicalAccess` 只允许 `ready` 和 `unavailable`：`ready` 表示当前 owner 的该患者已经存在
可用于预约历史、报告和门诊费用只读查询的 `his-patient` 映射；`unavailable` 表示记录仍可在
选择页展示和核对，但尚未完成或已经失去医院档案映射，不能被选为临床查询上下文。小程序首次
没有历史选择时只能默认第一位 `ready` 患者；已有选择变为 `unavailable` 时必须要求用户显式
选择其他 `ready` 患者，服务端也会在调用 Provider 前 fail-closed。该字段不暴露 Provider 患者号，
也不能被客户端改写成可用状态。

患者目录同步和读取是两条服务端事实链：同步快照提交成功后，接口还需要读取当前 owner 的
脱敏读模型才能生成响应；如果这一步暂时失败，服务端返回错误，不会把空数组伪装成同步成功。
相同幂等键命中 durable replay 时不会再次访问 Provider，但仍会重新读取当前读模型。

患者目录的同步结果和 owner-scoped 读模型单次最多允许 128 条；这是平台资源保护，不是医院
业务上的绑定人数上限，也不是 Provider 分页总数。超过上限或读模型结构异常时服务端整批失败，
不会截断、不回收未出现在异常结果中的旧患者，也不会返回 `total` 与实际目录不一致的成功响应；
内部持久化读模型校验失败返回 `500 persistence-invalid`，不能被小程序解释为“暂无就诊人”。

### 3.2 普通个人资料

`GET /me/profile` 和 `PUT /me/profile` 只处理 `displayName`、`gender`、`age`、`email`。
当前会话决定 owner，客户端不能提交 `userId`；头像、手机号、身份证、实名姓名、微信
`openid`/`unionid` 和患者字段不属于该 API。详细字段、默认值、版本冲突和 migration 见
[`迁移/用户资料契约.md`](迁移/用户资料契约.md)。

`PUT /me/profile` 的请求体是严格白名单：除 `version` 和上述可更新字段外，任何未知字段都
返回 `400 validation`，服务端不能把 `avatar`、`openid` 等旧端字段静默删除后继续保存。这样
可以尽早发现旧页面仍在提交身份字段的迁移错误，也避免调用方误以为头像或微信身份已经被新服务接管。

资料不存在时返回 `version=0` 的默认值；首次更新必须使用 `version=0`，保存后版本变为 1。
后续更新必须带当前版本，冲突返回 `409 user-profile-conflict`，客户端应刷新后重试，不能
自动覆盖其他设备的修改。

### 3.3 预约目录和预约历史

原有 `/appointments/departments` 继续返回扁平的可预约科室目录，保持既有客户端兼容。
挂号选择页使用独立的 `/appointments/department-tree` 返回
`groupId`、`displayName` 和每个一级科室下的二级 `departments`；展开二级科室时，
仅能把该树返回的 `parentDepartmentId` 传给 `/appointments/clinic-departments`，由服务端
重新解析旧 Provider 所需名称后读取三级可预约门诊。小程序不得提交任意名称或搜索词给
Provider，也不能把医生列表当成三级门诊。

排班目录返回规范化的 `departmentId`、`doctorId`、`workDate`、`shiftName`、
`totalSlots`、`availableSlots` 和 `timeGroup`。`timeGroup` 只允许 `point`、`range`、
`unknown`。provider 原始数字状态、provider 号和挂号金额不在公共 contract 中。

预约历史返回 `departmentName`、`doctorName`、`workDate`、可选 `workTime`/`location`/
`serialNumber` 及 `status`。`workTime` 是 adapter 从已确认的时间点或 `groupStart`/
`groupEnd` 归一化后的 `HH:mm` 或 `HH:mm-HH:mm`；原始完整日期时间字段不进入公共响应，
不完整时间段会回退到 provider 的 `workTime`。状态只允许 `scheduled`、`cancelled`、`completed`、`missed`、
`stopped`、`substituted`、`registered`、`unknown`；其中 `stopped` 表示停诊、
`substituted` 表示替诊、`registered` 表示已登记。当前数字映射依据旧端源码的明确状态分支固化在 adapter
边界；这只是只读迁移 evidence，不构成预约写入或支付状态契约。新 Provider 文档/脱敏 fixture 若确认不同枚举，必须先更新
adapter、contract 和测试，不能由小程序根据文字猜测最终状态。Provider 返回重复 `appointmentInfoId` 时，
服务端拒绝整批结果；没有预约号的摘要不会被服务端根据数组位置伪造业务 ID。

预约历史有两个服务端拥有的读取范围：省略 `scope` 或传 `scope=online` 时使用旧端在线渠道，
必须带起止日期，默认由小程序计算当前中国标准时间前后各 90 天；传 `scope=all` 时使用已核实的
完整历史渠道，不传日期，服务端不会把在线结果复制或拼接成全部记录。Provider 渠道码不进入公共
请求参数，客户端只能选择这两个业务范围。

预约目录的服务层在进入 Provider 前校验日期；非法日期会返回稳定查询错误并记录对应的
`appointment.directory.*.failed`，不会产生 `requested`，也不会访问 Provider。

小程序的“爽约记录”不是独立公共 endpoint，而是对上述预约历史读模型做安全筛选：只展示服务端
返回的 `status=missed`，当前查询窗口为中国标准时间过去 90 天；`unknown`、空列表或 provider
未返回不能被客户端推断为爽约。

原生“我的挂号”调用该接口时使用当前中国标准时间日前后各 90 天，保证未来已预约记录
不会因为只查询过去而静默消失；原生“爽约记录”调用同一接口时只使用过去 90 天，并且只筛选
服务端明确返回的 `status=missed`。

### 3.3.1 预约写入与医保支付命令

`miniprogram-pay` 使用上表中的独立命令，不存在把“预约 + 医保支付”包成一个后端快速编排
接口的入口。业务顺序固定为：读取排班/号源 → 创建服务端占位 → 预约写入 → 医保授权 →
费用上传 → 医保结算 → 必要时查单。预约已存在时服务端返回已有的 opaque `appointmentId`，
小程序只能先调用取消命令，取消成功后再用新的幂等键重新占位和写入。

预约占位、预约写入、取消、医保授权、费用上传和结算分别有独立的日志事件、幂等键和错误边界；
provider 患者号、预约号、身份证、卡号、授权码和 payToken 不进入公共响应。医保 adapter 或
持久化未配置时统一 fail-closed，不返回伪造成功。

### 3.4 我的医生

“我的医生”是当前平台用户级关系，沿用旧端的用户级语义，但不复用旧端客户端快照写入。
列表、单项读取和取消关注都由 Bearer 会话确定 owner；客户端只提交服务端排班目录返回的
opaque `doctorId`。关注时 API 会在未来 7 天排班目录中重新确认医生姓名、科室和头像，再写入
`hp_my_doctors`；数据库以 `(owner_user_id, doctor_id)` 唯一键保证并发关注不重复，删除是幂等的。
关系不绑定当前就诊人，也不把 provider 的原始医生号或患者字段暴露给小程序。

服务端没有可确认的医生排班时返回 `404 my-doctor-not-found`；排班目录或持久化读模型异常时
返回对应的服务错误，不能把异常降级成“暂无医生”。

### 3.5 报告

报告目录只返回 `kind`、标题、时间、`available`/`abnormal`、`hasAttachment` 和可选的
opaque `reportId`；当前只有检验报告可以返回该 `reportId`。读取详情时必须同时提交目录当前选中的
内部 `patientId`，服务端按 owner、patient、reportId 和 TTL 再次校验；`reportId` 不能独立作为授权凭证。
影像和心电 provider 即使返回
原始报告号，也会在 adapter 边界丢弃，因为当前没有对应的可审计详情 contract。检验详情的检测项只包含 `name`、`result`、`unit`、`referenceRange`
和 `flag`；`flag` 为 `normal`、`high`、`low`、`critical` 或 `unknown`。

未指定 `kind` 时，服务端会同时读取 LIS、PACS 和 ECG 三个来源；当前公共 contract 没有部分成功状态，
因此任一来源失败都会让整次目录查询失败，不能把其余来源拼成不完整的成功列表。只有明确返回的空数组
才是对应来源的成功空结果。

`kind` 在 service 和 adapter 都做运行时白名单校验；内部调用传入未知来源时返回已有的
`400 report-query-invalid`，不会落入 adapter 的默认 ECG 分支，也不会访问 Provider。

目录摘要与详情引用是两个独立能力：provider 没有稳定报告号、详情 gate 未开启或无法建立
短期引用时，目录仍可返回安全摘要并省略 `reportId`，客户端只能隐藏详情入口；不能因为单条详情引用不可用而把整批报告目录当成服务不可用。

目录和 LIS 详情的 `reportedAt` 都必须使用服务端已审计的日期/时间格式；详情返回无法解析的时间时，
服务端返回 `502 provider-response-invalid`，不会把临床时间当普通文本展示。详情标题和时间是否能由 Provider
稳定回显并与目录摘要逐字段关联，仍需正式详情 contract 确认；在此之前不扩展数据库引用字段或猜测关联规则。

报告公共目录单次最多返回 512 条，LIS 详情单次最多返回 1024 条检测项；预约科室、排班和历史
分别最多返回 256、512、512 条。这些是服务端资源保护，不是 Provider 的分页总数，也不是患者
实际报告/预约数量上限。超过上限时服务端整批返回 `502 provider-response-invalid`，不会截断后
继续返回 `loaded`，也不会为不完整结果创建详情引用、排班引用或短期快照；当前 contract 没有
公开分页字段，客户端不得自行把拒绝结果解释为“暂无更多数据”。

影像附件、体检报告、原始报告号、患者字段和文件下载 URL 尚未开放。详情返回 404 不等于
患者没有报告，也可能表示该报告类型尚未通过详情 gate。

### 3.6 门诊病历目录

门诊病历页面对应旧端 `electronic_record.vue` 的真实调用：服务端按当前 owner 解析
`his-patient` 映射，再由 adapter 调用 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`。
小程序只提交平台 `patientId` 和自然日窗口，Provider 的 `patId`、`regId`、姓名、身份证及
其它原始字段不会进入小程序或日志。

公共接口固定接受最多 30 天的 `startDate`/`endDate`，adapter 将自然日转换为旧 Provider
要求的 `00:00:00` 与 `23:59:59` 边界，并固定 `type="5"`。成功空数组是合法空状态；Provider
业务拒绝、超时、映射缺失和响应结构异常分别保持错误语义，不能沿用旧端“异常即空数组”的行为。

当前只迁移了门诊就诊摘要列表：科室、医生、医院、就诊类型、收费类别、就诊时间和诊断摘要。
病历正文、`out-emrs`、住院病历、附件、下载和详情引用仍是独立能力，不因目录有数据而自动开放。
小程序首批只渲染 8 条，点击“加载更多记录”仅展开已取得的安全读模型，不代表 Provider 分页。

### 3.7 门诊缴费和支付

门诊缴费列表只返回 `recordId`、状态、科室/医生、账单时间和 `amountFen`。服务端会先校验
`patientId` 并按当前用户解析 `his-patient` 映射，再调用 provider；空白、超长或带控制字符的标识、owner 映射缺失、
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

支付订单、订单查询、微信预支付和微信通知共用一个服务端运行时闸门。当前候选默认关闭；
闸门关闭时，这四类路由会在读取报价、读取订单、写入订单/outbox、验签解密或写入通知去重表
之前返回 `503 dependency-not-configured`，不会产生任何支付副作用。只有生产组合根同时具备注入的
真实微信支付 adapter、通知解密器、完整商户配置和后续人工/真实环境放行证据时才允许打开；
OpenAPI 仍保留路由是为了冻结公共契约，不代表当前支付已经可用。

微信预支付尝试是独立于订单状态的事实：首次申请会先记录 `pending`，成功才变为可重放的
`ready`；外部结果不明确时进入 `unknown`，不能把它当成失败后直接重建。若微信支付依赖未配置，
但支付模块闸门已经打开，服务端才会把本次尝试收敛为 `unknown` 并返回
`503 dependency-not-configured`；同一幂等键不会永久停留在 `pending`。闸门关闭时不会创建尝试，
配置和验收完成后应重新发起新的幂等请求。

### 3.8 列表、空结果和大结果集语义

当前患者端所有列表接口都使用同一个最小响应形状：`data.items` 是本次服务端实际返回的数组，
`data.total` 必须等于 `items.length`。当前没有公开 `page`、`pageSize`、`cursor` 或 `hasMore` 字段，
因此 `total` 不是 provider 的隐藏总数，也不是“还有多少页”的估计值。

| 接口 | 服务端数据窗口 | 返回顺序 | 小程序的分批行为 |
| --- | --- | --- | --- |
| `GET /api/v2/patients`、`POST /api/v2/patients/sync` | 当前 owner 的有效目录；同步必须是完整快照 | 使用服务端读模型顺序；第一项只能作为“从未选择过时的展示默认值”，不能解释为本人关系 | 选择页展示完整目录 |
| `GET /api/v2/appointments/departments` | 服务端生成的预约目录日期窗口 | 保留 adapter 返回的 provider 顺序；顺序不是科室优先级事实 | 左栏直接展示目录 |
| `GET /api/v2/appointments/department-tree` | Provider `first-depts` 的受控一级/二级目录 | 保留 Provider 已给出的排序；一级 ID 和二级 ID 均必须唯一 | 左栏显示一级、右栏显示二级；不预读三级或医生 |
| `GET /api/v2/appointments/clinic-departments` | 服务端先按 `parentDepartmentId` 回查一级/二级树，再以受控名称读取 `scheduling-depts` | 保留可预约门诊返回顺序；未知或过期二级 ID 不会退化为名称搜索 | 展开二级科室后显示蓝底三级门诊；选择三级门诊才读取医生和排班 |
| `GET /api/v2/appointments/schedules` | 起止日期差值最多 31 天；当前小程序请求未来 7 天；provider `endDate` 包含规则待确认 | 保留 adapter 返回顺序；页面按 `workDate` 升序分组，同一天内保留返回顺序 | 右栏每次最多渲染 12 条；这是本地渲染分页，不减少 provider 请求量 |
| `GET /api/v2/appointments/records` | `scope=online` 时起止日期差值最多 366 天；“我的挂号”请求当前日前后各 90 天，“爽约记录”请求过去 90 天；`scope=all` 不传日期；provider `endDate` 包含规则待确认 | 保留 adapter 返回顺序，客户端不得从文字或数组位置推断最终状态 | 当前完整读取结果首批渲染 10 条，点击“加载更多”继续展示；这是本地渲染分批，不代表 provider 分页 |
| `GET /api/v2/reports` | 起止日期差值最多 366 天；当前小程序请求近 30 天；Provider `endDate` 包含规则待确认；每条返回摘要的 `reportedAt` 必须可解析且落在本次请求的首尾自然日内 | 服务端仅对通过时间窗口校验的结果按 `reportedAt` 时间倒序；同时间再按 `reportedAt`、`kind`、`title` 升序稳定排序 | 当前完整读取后每次渲染 10 条；这是本地渲染分页 |
| `GET /api/v2/payments/outpatient/records` | 服务端固定最近 30 个中国标准时间日 | 保留 provider adapter 返回顺序；金额和状态已在服务端映射 | 当前完整读取结果首批渲染 10 条，点击“加载更多缴费记录”继续展示；这是本地渲染分批，不代表支付或 provider 分页 |

服务端返回已确认的空结果时，接口仍返回 HTTP `200`、`items: []` 和 `total: 0`；空列表不能被
客户端改写成“provider 暂时不可用”。反过来，身份映射缺失、依赖未配置、权限拒绝、超时或 provider
返回结构不合法必须走稳定错误码，不能伪装成空列表。

小程序的“加载更多”目前只控制已经取得的数据如何分批渲染，不能被验收记录写成“服务端已支持分页”。
未来要开放真正分页、游标或大结果集查询，必须先在 provider contract 中冻结游标一致性、排序键、重复项、
快照时间、`total` 语义和失败后的续取方式，再同步修改公共 contract、adapter、页面和验收文档。

### 3.9 健康百科只读路径

健康百科路由已经纳入新 API 的公共 contract，覆盖旧端健康百科、疾病详情、药品详情和症状关联查询的后端入口。
它只读取通过审核并已发布的版本化 bundle，并在服务端统一返回 `publication`、白名单字段和免责声明；不接收患者号、
provider 标识或 AI 参数，也不提供健康自测、风险评分、个体化诊断或用药建议。当前环境若没有审核发布版本，仓储返回
`503 dependency-not-configured` 或等价的 fail-closed 错误，不能把未审核旧库快照当作可展示内容。小程序页面接入仍需先完成
审核 bundle 的来源、发布和真机只读验收。

## 4. 统一响应和错误

患者端成功响应统一为：

```json
{"success":true,"data":{}}
```

错误响应统一为：

```json
{"success":false,"error":{"code":"unauthorized","message":"请先登录后再继续操作"}}
```

缺少 `Authorization` 时返回“请先登录后再继续操作”；Bearer 会话在 Redis 正常可读但找不到或已经过期时，
返回“登录状态已失效，请重新登录”。Redis 未配置/未注入时返回 `503 dependency-not-configured`；
Redis 已配置但发生连接、ACL 或传输故障时返回 `503 persistence-temporarily-unavailable`，不能把这类故障
伪装成 401。小程序必须按错误码处理，不能根据 message 文案分支。

当前已注册公共路由会使用以下稳定错误码。`message` 是可记录和排障文本，页面展示应由
小程序按错误码映射，不能依赖英文 message 做业务判断。

| HTTP | 数字码 | `code` | 含义 |
| ---: | ---: | --- | --- |
| 400 | 10100 | `validation` | 请求 schema 不合法 |
| 400 | 10300 | `parse` | JSON 请求体无法解析 |
| 400 | 30100 | `appointment-query-invalid` | 排班日期/过滤条件不合法 |
| 400 | 30200 | `appointment-record-query-invalid` | 预约记录查询条件不合法 |
| 400 | 50300 | `outpatient-payment-query-invalid` | 门诊缴费查询条件不合法 |
| 400 | 40100 | `report-query-invalid` | 报告查询条件不合法 |
| 400 | 60100 | `health-knowledge-query-invalid` | 健康知识查询参数不符合公开 contract |
| 400 | 20100 | `patient-query-invalid` | 就诊人查询上下文不合法 |
| 400 | 50100 | `payment-order-invalid` | 创建订单输入不合法 |
| 400 | 50200 | `payment-notification-rejected` | 微信支付通知验签或内容校验失败 |
| 400 | 60200 | `user-profile-invalid` | 普通个人资料字段不合法或没有可更新字段 |
| 401 | 10200 | `unauthorized` | 会话缺失、无效或已过期 |
| 404 | 10400 | `not-found` | 请求路径未注册，不能据此推断业务资源不存在 |
| 404 | 30210 | `appointment-record-patient-not-found` | 当前用户不拥有该预约查询患者 |
| 404 | 30300 | `appointment-schedule-reference-expired` | 排班快照引用未知或已过期；需返回目录重新获取 scheduleId |
| 400 | 30400 | `appointment-write-invalid` | 预约写入请求参数、幂等键或状态不合法 |
| 404 | 30410 | `appointment-write-patient-not-found` | 当前就诊人未找到有效的预约服务端映射 |
| 404 | 30420 | `appointment-hold-not-found` | 预约占位不存在或不属于当前用户 |
| 409 | 30430 | `appointment-hold-expired` | 预约占位已过期、已消费或不可继续使用 |
| 404 | 30440 | `appointment-registration-not-found` | 预约记录不存在或不属于当前用户 |
| 409 | 30450 | `appointment-medical-payment-active` | 预约已有医保支付流水，不能直接取消，请由支付/收费流程处理 |
| 400 | 30500 | `medical-insurance-invalid` | 医保授权、费用上传或结算请求状态不合法 |
| 404 | 30510 | `medical-insurance-appointment-not-found` | 关联预约不存在、已取消或不属于当前用户 |
| 404 | 30520 | `medical-insurance-order-not-found` | 医保订单不存在或不属于当前用户 |
| 404 | 50310 | `outpatient-payment-patient-not-found` | 当前就诊人尚未建立门诊缴费映射 |
| 404 | 40110 | `report-patient-not-found` | 当前用户不拥有该报告查询患者 |
| 404 | 40120 | `report-not-found` | 报告详情不可用或尚未通过 gate |
| 404 | 60110 | `health-knowledge-not-found` | 未找到对应的健康知识内容 |
| 404 | 50110 | `payment-order-not-found` | 订单不存在或不属于当前用户 |
| 404 | 50120 | `payment-quote-not-found` | 服务端报价不存在 |
| 409 | 50130 | `payment-quote-expired` | 服务端报价已过期，必须重新获取报价 |
| 409 | 50140 | `payment-idempotency-conflict` | 幂等键与已有订单的请求内容冲突 |
| 409 | 50150 | `payment-order-conflict` | 订单版本已被其他流程更新 |
| 409 | 50210 | `payment-notification-conflict` | 重复通知与已落库事件冲突 |
| 409 | 50220 | `payment-cash-prepay-not-allowed` | 当前订单不允许现金预支付 |
| 409 | 50230 | `payment-identity-not-found` | 支付身份映射不可用 |
| 409 | 50240 | `payment-prepay-in-progress` | 预支付仍在处理，不能并发创建 |
| 409 | 50250 | `payment-prepay-unknown` | 预支付结果需向 provider 确认，不能直接重建 |
| 409 | 20200 | `patient-sync-in-progress` | 当前用户的患者目录仍在同步，不能并发访问 provider |
| 409 | 20300 | `patient-sync-stale` | 本次患者目录结果早于已经提交的新快照，服务端拒绝旧结果回写 |
| 409 | 60210 | `user-profile-conflict` | 普通个人资料版本已被其他设备更新 |
| 400 | 60300 | `my-doctor-query-invalid` | 我的医生请求或医生标识不合法 |
| 404 | 60310 | `my-doctor-not-found` | 医生关系不存在或最新排班目录没有该医生 |
| 409 | 60320 | `my-doctor-already-followed` | 该医生已经被当前用户关注 |
| 502 | 20400 | `patient-directory-snapshot-unsafe` | Provider 返回空患者目录但当前已有就诊人，服务端拒绝执行不确定的批量失效 |
| 502 | 20500 | `patient-directory-reference-conflict` | 同一用户的医院档案映射与另一位就诊人冲突，本次就诊人未更新 |
| 502 | 10800 | `provider-request-rejected` | provider 明确拒绝请求，不能盲目重试 |
| 502 | 10820 | `provider-response-invalid` | provider 返回的数据违反平台读模型，不能作为患者端业务事实 |
| 503 | 10500 | `dependency-not-configured` | 必需服务未配置，当前实例 fail-closed |
| 503 | 60120 | `health-knowledge-unavailable` | 健康知识没有可用的已发布版本，或发布窗口发生冲突 |
| 503 | 10600 | `persistence-temporarily-unavailable` | 数据库、Redis 或 schema 暂时不可用 |
| 503 | 10810 | `provider-temporarily-unavailable` | provider 暂时不可用，可按策略重试 |
| 500 | 10900 | `unknown` | 未分类服务异常；页面不得根据此码推断业务结果 |
| 500 | 10700 | `persistence-invalid` | 数据库读模型或服务端内部身份违反 contract，不能降级为空列表 |

小程序端统一在 [`apps/miniprogram/src/services/api-client.ts`](../apps/miniprogram/src/services/api-client.ts)
按上述稳定错误码映射中文文案；新增公共错误码时必须同步更新该映射和验收测试。未知错误码只展示安全兜底，
不能直接展示 provider 或内部错误文本；`statusCode`、`code` 和 `requestId` 仅用于客户端排障关联。

## 5. 当前实现边界

以下内容在旧服务中存在，但当前没有注册为通用患者端公共路由：医保 FSI、云健康结算/HIS
回写、文件上传、健康自测、报告解读、AI 导诊、管理端 RBAC、监控
和任务管理。旧接口逐项来源和状态见
[`迁移/旧接口清单.md`](迁移/旧接口清单.md)，
完整前置条件见 [`迁移/API矩阵.md`](迁移/API矩阵.md)。

特别是：

1. `200` 只证明本次 HTTP 调用返回成功，不证明 provider 业务成功。
2. `health/live` 不检查数据库、Redis、schema 或 provider；发布门禁必须检查 `health/ready`
   和独立依赖探针。
3. 旧服务可返回某接口，不代表新服务可以安全转发该接口；缺少 contract 时必须保持未注册。
4. 真实 provider 文档到达后，先进入 [`Provider文档接入流程.md`](Provider文档接入流程.md)
   做版本、来源、hash、字段和错误码冻结，再实现写入/支付/医保能力。

以下候选路径当前仍刻意保持 `404`，不是兼容入口，也不是“暂时返回空数据”：

- `POST /api/v2/patients`：患者新增/建档；
- `POST /api/v2/payments/insurance/authorization`：旧的通用医保授权路径。
- `POST /api/v2/appointments`、`POST /api/v2/appointments/{appointmentId}/cancel`：旧的通用预约路径。

它们与 `miniprogram-pay` 使用的分层命令不是同一路由；旧服务存在对应能力不改变这些旧路径的关闭状态。

## 6. 源码证据与维护入口

- 路由组合：[apps/api/src/app.ts](../apps/api/src/app.ts)
- 患者/预约/报告模块：[apps/api/src/modules](../apps/api/src/modules)
- TypeBox 公共 schema：[packages/contracts/src/index.ts](../packages/contracts/src/index.ts)
- 错误码映射：[apps/api/src/plugins/error-handler.ts](../apps/api/src/plugins/error-handler.ts)
- OpenAPI 路径门禁：[apps/api/src/app.test.ts](../apps/api/src/app.test.ts)
- 微信登录、域名和线上路由：[`微信授权登录.md`](微信授权登录.md)
- 日志字段与脱敏：[`日志规范.md`](日志规范.md)

修改公共接口时，必须同一提交完成：schema/路由、服务端业务不变量、日志事件、测试、本文
和迁移矩阵；真实生产和真机证据另存于发布验收文档，不能用本地测试替代。
