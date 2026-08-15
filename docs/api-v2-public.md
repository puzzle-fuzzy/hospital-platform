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

当前 OpenAPI 路径清单已经由 `apps/api/src/app.test.ts` 做自动门禁。路由增加、删除或
改变输入输出时，必须同时更新该测试、本文和 [`migration/api-matrix.md`](migration/api-matrix.md)。

## 2. 通用请求规则

### 2.1 会话

除健康检查、系统探针、微信登录和微信支付通知外，患者端接口都要求：

```http
Authorization: Bearer <accessToken>
```

`accessToken` 是平台 opaque 会话，不应由小程序解析、拼接用户身份或永久缓存。收到
`401 unauthorized` 后只能重新执行一次 `wx.login()` 并重试，不能无限循环重试。

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
| `Idempotency-Key` | 患者同步、创建支付订单、微信预支付 | 必须为 1～128 个字符；同一个业务动作重试必须复用原值，换值会产生新动作 |
| `Authorization` | 受保护接口 | 只接受平台 Bearer 会话，不接受 provider token |

患者同步使用 `POST /api/v2/patients/sync`，没有请求体；它的幂等键只保护一次目录
同步，不代表新增或绑定了患者。订单创建和微信预支付的幂等键分别独立，不能混用。

### 2.3 日期、金额和标识

- 日期查询参数统一为 `YYYY-MM-DD`，由服务端校验；不能透传任意 provider query 参数。
- 金额字段使用人民币分的非负整数，例如 `amountFen: 100` 表示 1.00 元。
- `patientId`、`reportId`、`orderId`、`scheduleId`、`quoteId` 都是平台 opaque 标识。
  小程序不能把它们解释为 HIS 号、provider 号或卡号。
- 服务端根据当前会话校验患者归属；小程序不能提交 `ownerUserId` 绕过归属检查。

## 3. 当前公共接口

表中的路径为公网 `/api/v2` 路径。应用源码中的对应内部路径是去掉 `/api/v2` 后换成
`/api/v1`；健康检查是唯一的根路径映射例外。

| 方法 | 公共路径 | 认证/幂等 | 用途和关键输入 |
| --- | --- | --- | --- |
| `GET` | `/api/v2/health/live` | 无 | 只证明 API 进程可响应，返回 `status: ok` |
| `GET` | `/api/v2/health/ready` | 无 | 返回 database、redis、schema 的 `ok`/`not_configured`/`unavailable`；不是 provider 验收 |
| `GET` | `/api/v2/system/ping` | 无 | 返回服务名和 API 版本，不执行业务依赖探测 |
| `POST` | `/api/v2/auth/wechat` | 无 | body 只有 `code`；服务端完成微信身份兑换并签发平台会话 |
| `GET` | `/api/v2/me` | Bearer | 恢复当前平台用户，只返回内部 `user.id` |
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

### 3.2 预约目录和预约历史

预约目录返回规范化的 `departmentId`、`doctorId`、`workDate`、`shiftName`、
`totalSlots`、`availableSlots` 和 `timeGroup`。`timeGroup` 只允许 `point`、`range`、
`unknown`。provider 原始数字状态、provider 号和挂号金额不在公共 contract 中。

预约历史返回 `departmentName`、`doctorName`、`workDate`、可选 `workTime`/`location`/
`serialNumber` 及 `status`。状态只允许 `scheduled`、`cancelled`、`completed`、`missed`、
`unknown`，不能由小程序根据文字猜测最终状态。

当前没有以下写入路由：

- `POST /api/v2/appointments/holds`
- `POST /api/v2/appointments`
- `POST /api/v2/appointments/{appointmentId}/cancel`

在 provider 文档、锁号/取消幂等、身份映射、失败补偿和真实验收完成前，旧服务的预约写入
接口不能被转发成新端接口。

### 3.3 报告

报告目录只返回 `kind`、标题、时间、`available`/`abnormal`、`hasAttachment` 和可选的
opaque `reportId`。检验详情的检测项只包含 `name`、`result`、`unit`、`referenceRange`
和 `flag`；`flag` 为 `normal`、`high`、`low`、`critical` 或 `unknown`。

影像附件、体检报告、原始报告号、患者字段和文件下载 URL 尚未开放。详情返回 404 不等于
患者没有报告，也可能表示该报告类型尚未通过详情 gate。

### 3.4 门诊缴费和支付

门诊缴费列表只返回 `recordId`、状态、科室/医生、账单时间和 `amountFen`。当前仍是只读
查询；支付调起、医保授权、医保结算、HIS 回写和退费必须走独立 contract。

平台支付订单的状态是服务端事实模型：

`created` → `authorized` → `pre_settled` → `insurance_submitted` → `insurance_settled`
→ `cash_pending` → `cash_paid` → `his_written_back` → `awaiting_confirmation` → `completed`。

`failed` 和 `cancelled` 是终止分支。小程序不能跳过状态、把 `6202` 或支付调起成功当成
最终结算成功，也不能提交 `totalFen`、`insuranceFen`、`cashFen` 或 HIS 完成状态。支付接口
当前仅完成平台编排边界，真实微信支付、医保、HIS 和真机验收仍未完成。

## 4. 统一响应和错误

患者端成功响应统一为：

```json
{"success":true,"data":{}}
```

错误响应统一为：

```json
{"success":false,"error":{"code":"unauthorized","message":"Invalid or expired session"}}
```

当前已注册公共路由会使用以下稳定错误码。`message` 是可记录和排障文本，页面展示应由
小程序按错误码映射，不能依赖英文 message 做业务判断。

| HTTP | `code` | 含义 |
| ---: | --- | --- |
| 400 | `validation` / `parse` | 请求 schema 或 JSON 不合法 |
| 400 | `appointment-query-invalid` | 排班日期/过滤条件不合法 |
| 400 | `appointment-record-query-invalid` | 预约记录查询条件不合法 |
| 400 | `report-query-invalid` | 报告查询条件不合法 |
| 400 | `payment-order-invalid` | 创建订单输入不合法 |
| 400 | `payment-notification-rejected` | 微信支付通知验签或内容校验失败 |
| 401 | `unauthorized` | 会话缺失、无效或已过期 |
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
| 502 | `provider-request-rejected` | provider 明确拒绝请求，不能盲目重试 |
| 503 | `dependency-not-configured` | 必需服务未配置，当前实例 fail-closed |
| 503 | `persistence-temporarily-unavailable` | 数据库、Redis 或 schema 暂时不可用 |
| 503 | `provider-temporarily-unavailable` | provider 暂时不可用，可按策略重试 |

## 5. 当前实现边界

以下内容在旧服务中存在，但当前没有注册为新患者端公共路由：医保 FSI、医保身份授权、云
健康结算/HIS 回写、文件上传、健康知识、健康自测、报告解读、AI 导诊、管理端 RBAC、监控
和任务管理。完整前置条件见 [`migration/api-matrix.md`](migration/api-matrix.md)。

特别是：

1. `200` 只证明本次 HTTP 调用返回成功，不证明 provider 业务成功。
2. `health/live` 不检查数据库、Redis、schema 或 provider；发布门禁必须检查 `health/ready`
   和独立依赖探针。
3. 旧服务可返回某接口，不代表新服务可以安全转发该接口；缺少 contract 时必须保持未注册。
4. 真实 provider 文档到达后，先进入 [`provider-document-intake.md`](provider-document-intake.md)
   做版本、来源、hash、字段和错误码冻结，再实现写入/支付/医保能力。

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
