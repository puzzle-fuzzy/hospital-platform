# 门诊就诊记录目录 Contract 草案

> 状态：`draft`，尚未获得 provider/HIS 确认，不得据此注册生产路由、打开 gate 或宣称业务迁移完成。
> 盘点日期：2026-08-16。
>
> 本文用于把旧端观察事实与新端待确认设计分开。provider 文档、脱敏响应样例和失败样例到达后，
> 必须逐项填写确认结果和内容指纹，再把确认后的事实迁移到版本化 contract；未确认字段不得直接复制到
> `packages/contracts`、adapter 或小程序页面。

## 0. 2026-08-16 文档到达复核

本次旧项目文档目录实际新增并已登记的材料是挂号登记、支付挂号和外部退款 3 份文档，接收记录见
[`../provider-intake/2026-08-16-appointment-registration-payment-refund.md`](../provider-intake/2026-08-16-appointment-registration-payment-refund.md)。
它们没有定义 `out-visit-records` 的请求/响应、患者映射或临床记录权限，也没有提供本目录所需的四类脱敏样例。

本次复核没有发现 2.12.4 病历目录或 `out-visit-records` 的 Provider contract 文件；旧端的
`POST /msun-middle-aggregate-clinic/v1/out-visit-records` 仍只能作为迁移线索。故本草案继续保持 `draft`，
`GET /api/v2/medical-records`、详情、诊断和附件能力继续保持 404/未注册，不通过旧 `httpZy` 或万能转发补齐功能。

## 1. 业务范围

本草案只覆盖“门诊就诊记录目录”，不覆盖：

- 门诊病历正文、XML/JSON 内容、结构化病历和附件；
- 住院 episode、住院病历、住院费用和结算状态；
- 诊断全文、处方、检验/影像原始报告和 AI 解读；
- 预约历史、爽约记录、门诊缴费或支付订单。

旧页面标题虽然叫“门诊病历”，实际只展示门诊就诊记录摘要。目录完成后仍不能把页面标记为“病历正文已迁移”。

## 2. 旧端观察事实（不是新 Contract）

### 2.1 请求事实

旧页面 `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\health\\electronic_record.vue`
调用旧 provider 请求：

```text
POST /msun-middle-aggregate-clinic/v1/out-visit-records
startDate = 最近 30 天的 00:00:00
endDate   = 当前日期的 23:59:59
type      = "5"
patId     = 旧患者选择器返回的 provider 患者号
```

旧页面使用设备/运行时本地时间计算日期，也没有记录服务端分页、排序、快照或最终一致性语义。`patId` 不能进入新端
小程序请求；新端必须从当前平台会话和内部 `patientId` 服务端解析用途专用的 provider 映射。

### 2.2 页面读取事实

旧页面读取过下列 provider 字段：

| 旧字段 | 旧页面用途 | 新端处理意见 |
| --- | --- | --- |
| `regId` | 列表 key/就诊记录标识 | 不能直接公开；需要确认是否能转换成短期 opaque `visitRecordId` |
| `deptName` | 科室名称 | 候选展示字段；需确认来源、脱敏和空值语义 |
| `doctorName` / `docName` | 医生名称 | 候选展示字段；需确认是否允许患者端展示 |
| `visitTime` / `visitDate` | 就诊时间 | 候选展示字段；必须确认时区、格式、排序和优先字段 |
| `hospitalName` | 医院名称 | 需确认机构来源；不能从旧静态配置补齐动态数据 |
| `clinicTypeName` | 就诊类型 | 需确认枚举和展示白名单 |
| `chargeClassName` | 收费类别 | 不能与费用/支付状态混用，需确认是否真的属于目录 |
| `patName` | 页面显示姓名 | 默认不进入记录项；患者上下文使用已脱敏的当前患者读模型 |
| `sexName` / `patAge` | 页面显示身份摘要 | 默认不进入公共 contract，除非 provider 明确确认用途和脱敏规则 |
| `maritalStatusName` | 页面显示身份字段 | 默认不迁移；与就诊目录无关且属于敏感个人资料 |
| `diagnosisName` / `diagnosis` | 页面显示诊断结果 | 默认不迁移；需要独立临床授权、敏感字段清单和审计 |

以上表格是差异线索，不是允许 adapter 透传的字段白名单。

### 2.3 旧端患者标识转换链（已确认的差异事实）

旧端页面传给 `out-visit-records` 的 `patId` 不是患者目录接口返回值的简单重命名，实际经过了两段转换：

```text
当前用户 unionId
  -> patientInfoByUnionId
  -> thirdPatientId / medicalCardNo / patientName
  -> patInfosFind(type=3, cardNo, patName)
  -> HIS patId
  -> out-visit-records.patId
```

这里的 `thirdPatientId` 只属于患者目录引用，不能因为它看起来像数字就直接拼进门诊记录请求。旧选择器还把查询到的
`patId`、卡号和身份证字段写入本地 `SelCard`，这属于旧实现的副作用，不能作为新端缓存设计；新端应当只保存平台
`patientId` 和必要的脱敏读模型，provider 患者号只在服务端当前调用帧或受 owner 约束的映射表中使用。

当前新端已经为预约历史、报告目录和门诊费用建立了 `his-patient` 引用，但这只能证明这些能力自己的 provider
映射已经存在，不能证明 `out-visit-records` 使用同一个 HIS 患者号、同一个机构上下文或同一个权限范围。病历目录
必须在 provider 文档确认后决定是复用 `his-patient`，还是新增独立的 `medical-record-directory` 引用类型；在确认前
不得让病历 service 直接读取或猜测其他能力的引用。

## 3. 候选新端边界（待确认）

### 3.1 候选公共输入

候选内部接口可以采用以下语义，但在 provider 文档确认前不注册：

```text
GET /api/v2/medical-records
Authorization: Bearer <platform-session>
patientId=<platform-opaque-patient-id>
startDate=YYYY-MM-DD
endDate=YYYY-MM-DD
```

候选规则：

1. `patientId` 只能是当前会话 owner 下的内部 opaque ID；不能接受 `patId`、`thirdPatientId`、身份证、卡号或住院号。
2. 日期窗口由服务端限制，候选默认沿用平台中国标准时间日历边界和最多 30 天；旧端本地时间行为不能直接视为新 contract。
3. 不接受任意 provider query、医院 ID、机构 ID、查询类型或患者姓名检索条件。
4. 查询目录不等于病历正文授权；不能因目录返回记录就自动开放 `out-emrs`。

### 3.2 候选公共输出

只有 provider 明确确认来源、含义、权限和空值规则后，才允许从以下候选字段选择进入公共 contract：

```json
{
  "success": true,
  "data": {
    "items": [{
      "visitRecordId": "短期 opaque 引用或平台内部稳定引用",
      "departmentName": "科室名称",
      "doctorName": "医生名称（可选）",
      "visitedAt": "平台约定时区的日期时间",
      "hospitalName": "机构名称（可选）",
      "visitType": "平台确认后的有限枚举（可选）"
    }],
    "page": 1,
    "pageSize": 20,
    "hasMore": false
  }
}
```

这里的 `visitRecordId` 只是设计占位名，不代表旧 `regId` 可以直接暴露。若详情需要 provider 记录号，必须落库为
owner-scoped、带 TTL 的服务端引用，小程序只能提交平台 opaque 引用。

诊断、性别、年龄、婚姻、身份证、卡号、手机号、原始医院 ID、provider 记录号和正文内容默认不进入输出。

### 3.3 候选结果语义

目录 service 必须把“没有记录”和“没有资格查询”分开，不能把所有异常折叠为空数组：

| 情况 | 候选新端语义 | 是否允许展示“未查询到记录” |
| --- | --- | --- |
| provider 明确返回成功且结果为空 | 成功的空目录 | 允许 |
| 当前患者不存在病历目录专用映射 | `patient-provider-reference-missing` | 不允许，提示暂不可查询 |
| provider 未配置或 contract gate 关闭 | `service-not-configured` | 不允许，显示迁移/服务未开放 |
| provider 权限不足或患者无权访问 | `provider-forbidden` | 不允许，不能伪装为空 |
| provider 超时、限流或网络错误 | 可重试的暂时失败 | 不允许，保留重试入口 |
| provider HTTP 成功但业务 envelope 失败 | provider 业务失败 | 不允许，按业务错误提示 |

空数组只代表 provider 已完成一次有权限的查询且确认没有记录；它不能用来掩盖映射缺失、权限拒绝或暂时不可用。

## 4. Provider 必须确认的事实

新文档到达后，逐项填写来源、版本、示例和确认人；任何一项未确认，状态保持 `draft`：

| 编号 | 必须确认的问题 | 未确认时的风险 |
| --- | --- | --- |
| MR-01 | endpoint 当前 path、method、环境和认证 header 是否仍有效 | 旧地址可能已变更，不能直接联调 |
| MR-02 | `type="5"` 的准确语义、允许值和是否必须固定 | 客户端可能查询到错误范围 |
| MR-03 | provider 患者标识的来源及预约/门诊专用映射 | 患者目录 ID 误用于临床记录 |
| MR-04 | 请求 envelope、业务成功字段、空列表和业务失败响应 | HTTP 200 可能被误判为成功 |
| MR-05 | 日期是否含时区、边界是否闭开、最大窗口和历史保留期 | 跨日重复或漏记记录 |
| MR-06 | 分页/游标、默认排序、重复记录和快照一致性 | 大列表截断或重复渲染 |
| MR-07 | `regId` 是否稳定、是否敏感、是否允许换取详情 | 暴露内部记录号或无法安全查详情 |
| MR-08 | 科室、医生、机构和就诊类型字段的展示授权 | 把内部或不完整字段公开 |
| MR-09 | 诊断及身份字段是否属于目录，是否需要更高权限 | 敏感医疗信息越权泄露 |
| MR-10 | 超时、限流、provider request id、可重试错误和最终查询方式 | 重试造成重复请求或假空列表 |
| MR-11 | 记录撤回、更正、删除和历史数据更新时间语义 | 页面继续展示失效医疗事实 |
| MR-12 | 是否存在附件/正文引用及其 TTL、下载授权和审计要求 | 目录接口越权扩展为文件接口 |
| MR-13 | `out-visit-records.patId` 是否可以使用现有 `his-patient` 引用，还是必须建立病历专用引用 | 把其他业务的患者映射误用于临床记录，产生错患者或越权查询 |
| MR-14 | 医院/机构上下文是否参与患者映射和记录查询，是否允许跨院区查询 | 同一患者在不同机构下记录串读或漏读 |
| MR-15 | provider 空列表、权限拒绝、映射缺失、未配置和暂时失败的业务码/重试语义 | 页面把错误显示成“没有病历”，无法区分数据事实和服务故障 |

### 4.1 provider 文档最小交付包

新的文档获取方式接入后，门诊就诊记录目录至少需要同时提供以下材料；只有一份成功响应或一段旧端抓包，不能进入
`confirmed`：

1. **接口定义**：当前环境的 method/path、认证 header、固定参数（包括 `type`）、请求/响应 envelope、字段类型、
   时间格式、分页或最大返回量说明。
2. **身份映射确认**：明确 `out-visit-records.patId` 的来源、医院/机构上下文、是否能复用现有 `his-patient` 引用，
   以及映射缺失时的业务码；不得只给一个看起来可用的数字患者号。
3. **四类脱敏样例**：成功有数据、成功空列表、权限/业务拒绝、超时或上游暂时失败；每份样例都要保留 provider
   request id 和业务码，但去除姓名、身份证、卡号、手机号、诊断正文和 token。
4. **字段白名单确认**：逐项确认科室、医生、机构、就诊时间、就诊类型和记录标识是否允许患者端展示；诊断、身份
   和正文默认排除，除非另有独立授权与审计说明。
5. **状态与一致性说明**：默认排序、历史保留期、记录更正/撤回、重复记录、最大日期窗口、超时后的最终查询方式
   和重试限制。
6. **验收入口**：sandbox/staging 的可复核地址、调用前置条件、成功/失败请求步骤、回滚方式和 provider 联系确认人。

文档接收后先登记 [`../provider-document-intake.md`](../provider-document-intake.md) 的 `documentId`、版本、环境和内容
指纹，再把以上材料逐项映射到 MR-01 至 MR-15。缺任何一项时状态保持 `draft` 或 `normalized`，不写入公共 schema、
不注册 `/api/v2/medical-records`，也不打开生产 gate。

## 5. 实现门禁

### 5.1 允许开始实现的条件

- 文档记录已按 [`../provider-document-intake.md`](../provider-document-intake.md) 登记，包含版本、环境和内容指纹；
- MR-01 至 MR-06 至少有 provider 确认和成功/空列表/业务失败/超时样例；
- 患者映射用途已经确认，且服务端能 owner-scoped 取得映射；
- 公共输出字段白名单、脱敏规则和日志禁止字段已经确认；
- 已有脱敏 golden fixture，能证明 provider 字段不会泄漏到 API、小程序和日志。

### 5.2 实现顺序

```text
provider 文档记录
  -> 差异表确认
  -> packages/contracts 目录 schema
  -> domain 只读模型与日期/分页不变量
  -> adapter + 成功/空/失败 fixture
  -> API owner/auth/日期窗口门禁
  -> Pino requested/loaded/failed 事件
  -> 原生页面与竞态/分页测试
  -> provider、内网、公网、真机四层验收
```

### 5.3 明确禁止

- 不把旧 `getOutVisitRecordsApi` 的返回类型直接复制到新 contract；
- 不把 `patId`、`regId` 或 `out-visit-record-id` 放到小程序请求或本地缓存；
- 不用预约历史、报告目录或门诊费用记录代替门诊就诊记录；
- 不因 provider 返回空数组就显示“没有病历”，必须区分真实空列表、未配置、权限不足和暂时失败；
- 不在未取得正文授权前实现 `out-emrs`、下载、诊断全文或 AI 解读；
- 不因接口返回 HTTP 200 或页面能渲染就标记真实业务完成。

## 6. 验收证据模板

完成后必须补齐：

| 层级 | 证据 |
| --- | --- |
| Provider | 请求/响应/空列表/业务失败/超时样例、provider request id 和字段确认记录 |
| 服务端 | contract 测试、owner 越权测试、日期/分页测试、adapter 脱敏测试 |
| 数据库 | 如需要引用或缓存，migration、TTL、owner 复合约束和 schema probe |
| 日志 | `medical-record.directory.requested/loaded/failed`，可按 trace/request/providerRequestId 定位且无原始 body |
| 公网 | `/api/v2` 实际反向代理路径、401/403/503/空列表行为 |
| 小程序 | 页面注册、切换就诊人、分页、重试、空态、错误置顶和旧响应淘汰 |
| 真机 | 登录、真实患者、真实记录、切换患者和退出/恢复会话证据 |

在上述证据全部完成前，页面状态只能是“代码已实现/待验收”，不能写成“病历已迁移”。
