# 门诊就诊记录目录 Contract 与实现记录

> 状态：`implemented-pending-acceptance`；旧端调用事实已落为新端安全只读子集，生产 gate 默认关闭，尚待真实 Provider、公网和真机验收。
> 最新复核日期：2026-08-28；下方 0.0–0.6 为历史审计快照，若与 0.7 或当前代码冲突，以 0.7、公共 API 契约和测试为准。
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

需要特别区分：旧源码 `src/api/modules/medicalRecord.ts` 中虽然声明了 `2.12.4` 的
`getMrMenusApi`，但它请求的是住院病历目录 `/msun-middle-aggregate-zyemr/v1/m-records/mr-menus`，
输入是 `patInHosId`、`babyId`、`menuCode` 和 `isProcess`；它不是门诊 `out-visit-records` 的说明，
也不能因为同属“病历”就复用门诊的 `patientId` 或 `his-patient` 映射。当前文档目录也没有发现
这条住院病历接口的正式 Provider contract，因此住院病历与门诊就诊记录都保持独立未开放状态。

## 0.1 2026-08-17 只读再审计结论

本轮在不调用 provider、不改动旧仓库和不读取生产患者数据的前提下，重新核对了当前 provider intake、旧端
`electronic_record.vue`/`ZY.ts` 线索、门诊与住院边界文档以及新 API 的 404 冻结测试。结论没有变化：当前没有
新增 `out-visit-records` 的正式请求/响应 contract、专用患者映射确认、成功/空目录/权限拒绝/暂时失败四类脱敏
样例，也没有目录记录详情或正文的资源授权说明。

因此本次审计在 contract 边界处停止，不新增 `packages/contracts` schema、adapter、service、小程序页面或
兼容转发；新端仍必须把门诊就诊记录目录、病历正文、住院 episode、住院费用和文件资源拆开。只有当 MR-01 至
MR-06、MR-13 至 MR-15 和最小交付包完成确认后，才重新评估是否进入目录实现；在此之前 404 是正确的业务状态，
不是待用空数据填充的开发缺口。

## 0.2 2026-08-19 继续审计后的停止结论

本轮只读复核继续以“先证明业务契约，再写新代码”为准入条件：重新核对旧端门诊/住院调用边界、当前
Provider intake 登记和新端未注册路由后，没有新增可供实现的 `out-visit-records` 正式契约、患者映射确认、
四类脱敏响应样例或记录字段授权清单。旧端源码仍只能证明历史调用方式，不能证明新端可以把旧字段直接公开，
也不能证明当前 Provider 已经允许新服务访问。

因此本轮明确停止在文档与准入门禁，不新增 schema、adapter、service、页面、缓存字段或万能转发。这个停止是
业务正确性保护措施：如果现在实现，将无法区分“Provider 成功但没有记录”“患者映射缺失”“权限拒绝”和“依赖
未配置”，最终会把真实故障伪装成空列表，或者把旧患者号、诊断和住院标识泄漏到新端。待 Provider 补齐
MR-01 至 MR-06、MR-13 至 MR-15 以及最小交付包后，必须先通过脱敏样例、字段白名单、错误语义和分页/时区测试，
再建立版本化 contract 并开放路由；在此之前，`GET /api/v2/medical-records` 继续保持未注册/404。

## 0.3 2026-08-20 旧端源码与新端准入再核对

本轮重新读取旧端当前文件并校验审计指纹，结果仍与本文记录一致：

| 文件 | 当前 SHA-256 | 本轮确认 |
| --- | --- | --- |
| `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\health\\electronic_record.vue` | `7e9842d10fce9e954a059c9dba9827fda66cb0ce629360e89a9333df4b10f669` | 页面按设备本地时间计算最近 30 天，发送 `type="5"`、`patId`、`startDate`、`endDate`；非数组和请求异常都被清空为页面空态 |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` | `659408140db42dd1705a143850dd568d8f286285cf31b58dfa7ae865607bfe38` | 只声明 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，返回项的未审计字段仍使用 `any` |

这次核对没有获得 Provider 新文档、脱敏响应、权限样例、分页/排序说明或 `out-visit-records.patId` 的用途确认。
因此不能把旧端“异常清空数组”的行为迁移到新端，也不能把旧端页面声明的 `regId`、诊断或身份字段当作公共白名单。
新端 `GET /api/v2/medical-records` 继续保持未注册/404；旧端仓库、线上服务、数据库和 Redis 均未修改。

只有在 MR-01 至 MR-15 的必要项和最小 Provider 交付包齐全后，才允许进入
“版本化 contract → adapter → owner-scoped service → API → 小程序页面 → 四层验收”的实现顺序。

## 0.4 2026-08-22 继续复核后的准入结论

本轮再次只读核对旧端页面、接口声明和患者选择器，四个审计文件指纹仍未变化：

| 文件 | 当前 SHA-256 | 本轮确认 |
| --- | --- | --- |
| `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\health\\electronic_record.vue` | `7e9842d10fce9e954a059c9dba9827fda66cb0ce629360e89a9333df4b10f669` | 页面只调用门诊 `out-visit-records`，按设备时间生成近 30 天窗口，异常响应会被旧端折叠为空列表 |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` | `659408140db42dd1705a143850dd568d8f286285cf31b58dfa7ae865607bfe38` | 门诊记录声明为 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，摘要类型仍含未审计扩展字段 |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\medicalRecord.ts` | `1a0db15d194e468ec2ef8b8502f9687322d07007b1c8a447d9a53d3cf61ef801` | 同时声明住院病历目录、内容和结构化接口，但没有证据证明门诊页面使用过这些接口 |
| `G:\\fuck\\hospital\\hospital-app\\src\\components\\health\\patient-hospital-selector.vue` | `e45e4d911f1d29eb86637857df20e2984663d7fd382db0a472c3ebc83d1ce02` | 旧选择器会把 Provider 患者号写入本地选择状态，不能迁移为新端 storage 或公共请求输入 |

截至本次复核，`docs/provider-intake/` 仍没有 `out-visit-records` 的正式确认包、患者映射说明、成功空目录/权限
拒绝/暂时失败脱敏样例、分页/时区约束或字段展示白名单。故本次仍停止在文档准入边界：不新增 schema、adapter、
service、API、页面或兼容转发，不把旧端异常清空列表的行为复制到新端；`/api/v2/medical-records` 继续保持未注册。
本次没有调用 Provider，也没有修改旧项目、线上服务、数据库、Redis 或并行会话维护的众阳自动化。

## 0.5 2026-08-24 当前 13f 候选复核

当前服务端 release 为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，小程序提交为 `13f597e`。重新核对旧端
`electronic_record.vue`、`medicalRecord.ts` 与原生首页动作后，结论没有放宽：

- 旧端实际页面调用的是门诊摘要 `POST /msun-middle-aggregate-clinic/v1/out-visit-records`，发送
  `type="5"`、旧 Provider `patId` 和最近 30 天本地时间窗口；这不等于门诊病历正文或住院病历目录；
- 旧端将 `regId`、科室、医生、就诊时间、姓名、性别、年龄、婚姻和诊断等未审计字段直接渲染，不能作为新端
  公共白名单；新端不得把 `patId`、`regId`、诊断或原始病历内容交给小程序；
- 新端首页的 `medical-record` 动作只显示“门诊病历正在迁移中”，没有注册 `/api/v2/medical-records`，也没有
  用预约、报告或门诊费用的 `his-patient` 映射猜测病历权限；
- 当前 Provider intake 仍没有正式契约和四类脱敏响应样例，因此本轮没有调用 Provider、没有改旧服务、没有
  新增路由或兼容转发。当前 13f 运行包门禁通过不代表病历业务已迁移。

在 MR-01 至 MR-15 和最小 Provider 交付包完成前，保持 404/迁移提示是正确的业务状态；下一项应继续选择不依赖
病历临床数据的静态或已有只读入口，不为填充页面而创造病历假数据。

## 0.6 2026-08-25 当前复核：仍然停止在 contract 边界

本轮在继续迁移“就诊”和“互联网医院”之前，重新核对门诊病历是否可以作为下一个只读能力实现。旧端四个关键文件的
当前 SHA-256 与本文历史审计指纹一致：

| 文件 | 当前 SHA-256 | 当前结论 |
| --- | --- | --- |
| `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\health\\electronic_record.vue` | `7e9842d10fce9e954a059c9dba9827fda66cb0ce629360e89a9333df4b10f669` | 仍只调用门诊 `out-visit-records` 摘要，使用旧 `patId` 和本地时间窗口；异常仍不能作为新端空态语义 |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` | `659408140db42dd1705a143850dd568d8f286285cf31b58dfa7ae865607bfe38` | 仍只有历史接口声明，未提供新端可用的请求/响应 contract |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\medicalRecord.ts` | `1a0db15d194e468ec2ef8b8502f9687322d07007b1c8a447d9a53d3cf61ef801` | 住院病历接口与门诊摘要仍是不同域，不能交叉复用患者输入或记录字段 |
| `G:\\fuck\\hospital\\hospital-app\\src\\components\\health\\patient-hospital-selector.vue` | `e45e4d911f1d29eb86637857df20e2984663d7fd382db0a472c3ebc83d1ce02` | 旧选择器仍会把 provider 患者号写入缓存，不能迁移到新端客户端状态 |

当前 `docs/provider-intake/` 仍只有已登记的预约/支付/结算材料，没有新增 `out-visit-records` 的正式确认包、
四类脱敏响应、分页/时区说明、字段白名单或病历资源授权说明。新端首页和“我的”页继续只显示“门诊病历正在迁移中”，
`/api/v2/medical-records` 继续不注册；本轮没有修改旧项目、旧服务、服务器、数据库、Redis 或并行会话维护的众阳自动化。

因此下一步不进入病历代码实现，继续优先选择已有正式只读 contract 的能力，并要求每个领域分别取得
“服务端 owner 隔离 → provider 脱敏结果 → 公网请求 → 真机页面”的配对证据。

## 0.7 2026-08-28 新端安全只读子集已实现

本轮基于旧端当前源码中已明确的 `out-visit-records` 请求事实，完成了“门诊就诊摘要目录”这一可独立验收的安全子集。
这里的实现不等于 Provider 已通过生产准入：`ZHONGYANG_MEDICAL_RECORDS_READY` 默认仍为 `false`，真实环境必须先完成
配置、Provider 响应核对、公网 requestId 与服务端日志配对，再打开 gate。

已实现链路如下：

```
小程序 patientId + 30 天自然日
  -> Elysia owner + patient 归属校验
  -> his-patient 服务端映射
  -> adapter POST out-visit-records(type=5, patId=服务端映射)
  -> 字段白名单投影
  -> 小程序门诊摘要列表
```

新端只返回 `visitTime`、科室、医生、医院、就诊类型、收费类别和诊断摘要；`patId`、`regId`、姓名、身份证、
住院标识和原始扩展字段不会越过 adapter/domain 边界。Provider 的自然日边界由 adapter 转成当天
`00:00:00` 与 `23:59:59`，服务端拒绝超过 30 天、非法日期和未建立映射的患者。

“我的问诊”也已从通用外部会话壳改为旧端 `my_consultation.vue` 对应的患者范围历史摘要列表，当前复用预约只读 adapter 的 `online` 渠道并固定过去 120 天；
这对应旧端的就诊历史摘要，不等于外部问诊会话；实时消息、问诊正文和附件仍未开放。两页都使用稳定加载/错误/空状态外壳，并只对已取得结果进行本地分批渲染。

本轮补充了 domain、adapter、service、API、小程序查询入口和回归测试；未修改旧 Python 服务、旧数据库、Redis 或旧端代码。
门诊病历正文 ` out-emrs `、住院病历、详情引用、附件下载、支付和医保继续按独立 contract 处理。

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

旧源码另外声明了住院病历接口 `2.12.4/2.12.5/2.12.6`，其输入围绕住院登记号、婴儿号、病历类型和
病历节点展开；门诊页面没有调用这些接口。实现门诊目录时，不得把住院 `patInHosId`、`noteId`、`mrTypeId`
或 `noteContent` 当作门诊记录字段，也不得把门诊目录成功解释成住院病历正文可读。

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

### 2.3 旧源码交叉核对与异常语义

本节固定本次审计时的源码证据，避免后续会话把“接口声明”误认为“页面真实使用”。旧文件在审计时的
SHA-256 指纹如下；文件发生变化后，应重新核对请求和字段，不能只沿用本节的行号：

| 文件 | 审计时 SHA-256 | 本次确认的事实 |
| --- | --- | --- |
| `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\health\\electronic_record.vue` | `7e9842d10fce9e954a059c9dba9827fda66cb0ce629360e89a9333df4b10f669` | 页面真实导入 `@/api/modules/ZY`，最近 30 天请求 `type="5"` 和 `patId`，并直接渲染摘要字段 |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` | `659408140db42dd1705a143850dd568d8f286285cf31b58dfa7ae865607bfe38` | 页面使用的 `getOutVisitRecordsApi` 返回 `OUT_VISIT_RECORD[]`，实际仅声明少量摘要字段，其余字段为 `any` |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\medicalRecord.ts` | `1a0db15d194e468ec2ef8b8502f9687322d07007b1c8a447d9a53d3cf61ef801` | 另有同路径的接口声明、`out-emrs` 和住院病历接口，但不能证明当前页面调用过这些能力 |
| `G:\\fuck\\hospital\\hospital-app\\src\\components\\health\\patient-hospital-selector.vue` | `e45e4d911f1d29eb86637857df20e2984663d7fd382db0a472c3ebc83d1ce02` | 旧选择器先按卡号/姓名查档案，再把 provider `patId` 写入 `SelCard`，这是旧端副作用，不是新端输入合同 |

旧门诊页面还有三处必须在新端显式修正的异常语义：

1. 日期由设备本地时间计算，开始边界是 30 天前当天 `00:00:00`，结束边界是当前日期 `23:59:59`；没有服务端时区、闭开区间、最大窗口或分页说明。
2. 响应只要不是数组就被替换为空数组；请求异常也会清空列表并继续显示“未查询到您的记录”。这会把 provider 暂时故障、业务拒绝和真实空目录混成同一个医疗事实，属于不可迁移的错误语义。
3. 页面只调用 `out-visit-records`，没有调用 `out-emrs`；因此旧页面最多是门诊就诊记录摘要列表，不能据此开放病历正文、诊断详情或附件。

新端必须保留以下不变量：日期由服务端按固定时区和合同窗口校验；provider 响应 envelope、业务成功标记和数组类型必须分别校验；失败、权限拒绝、映射缺失和真实空列表必须使用不同状态码和页面态；任何记录标识只能转换为 owner-scoped 的平台引用，不能把 `regId` 或 `patId` 返回给小程序。

### 2.4 旧端患者标识转换链（已确认的差异事实）

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
