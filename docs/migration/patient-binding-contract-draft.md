# 患者新增与绑定契约草案

> 状态：`draft`，当前不注册真实写入路由。
>
> 盘点基准：2026-08-16。旧端来源为
> `G:\\fuck\\hospital\\hospital-app`，新端来源为
> `E:\\__Super_Core__\\hospital-platform`。本文把旧代码已经观察到的事实与
> 尚未取得的医院/provider 契约严格分开；在第 7 节的问题没有闭环前，不能把
> 草案字段直接变成 API。

## 0. 2026-08-16 文档到达复核

本轮已复核旧项目文档目录中的相关材料：2.1.9 是科室基本信息，2.1.13 是院内用户信息，
它们不定义 `patInfosFind`、`patients` 或 `patCards` 的患者档案/绑卡请求，也不能回答 PB-01 至 PB-16。
本轮已经登记的挂号、支付、结算和医保材料同样不覆盖患者绑定的查档、建档、绑卡、解绑和协议事实。

因此本草案继续保持 `draft`，`POST /api/v2/patient-binding/*` 不注册；不能把“有科室/院内用户文档”
误判成“患者绑定 Provider contract 已到达”，也不能根据旧端 `patInfosFind` 的一次成功响应打开写入。

## 0.1 2026-08-20 旧端绑定流程再审计

本轮重新读取旧端新增就诊人和切换就诊人代码，并校验源码指纹：

| 文件 | 当前 SHA-256 | 本轮确认的事实 |
| --- | --- | --- |
| `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\patient\\patientAdd.vue` | `4d1e382e88e12a967a2ff4da2e27fc88fb2a9102f128670bf0187e1b06c197b5` | `type=2` 查档后有 `patId` 就调用 `patCards`；查档异常会继续进入 `patients` 建档；建档后再次绑卡；提交前还会更新旧用户资料 |
| `G:\\fuck\\hospital\\hospital-app\\src\\pagesB\\patient\\patientChange.vue` | `726d8a97433dfec1f09089268676b5b196f34275579ab2ef975c87bacf794e1e` | 切换时使用旧端 `thirdPatientId/cardNo` 组合并重新查档；随后把档案字段写入旧端缓存，编辑模式仍是 TODO |
| `G:\\fuck\\hospital\\hospital-app\\src\\api\\modules\\ZY.ts` | `659408140db42dd1705a143850dd568d8f286285cf31b58dfa7ae865607bfe38` | 只声明 `patInfosFind`、`patients`、`patCards` 等旧 Provider 调用，未提供新服务所需的幂等、最终确认和错误语义 |

这次复核进一步确认以下行为不能作为新端实现依据：

1. `patInfosFind(type=2)` 超时、5xx、空响应或解析失败会被旧端当成“没有档案”，继续执行建档，存在重复建档和错患者风险；
2. 建档请求把身份证号复制到 `cardNo`，并固定 `cardType=3`，但没有医院合同证明证件号就是医疗卡号；
3. 建档和绑卡之间没有可恢复的命令状态、幂等键或最终状态查询，HTTP 成功也不能证明 owner 已经绑定；
4. 旧端会把姓名、手机号、身份证号和 `openid` 写入用户资料接口，患者绑定不能借此修改平台微信身份；
5. 协议复选框默认同意，提交函数没有强制校验版本化同意事实；
6. 切换页将档案身份证字段放入 `patCardNo` 的缓存结构，不能复制为新端卡号读模型。

因此本轮不新增写入 API、数据库表、Provider adapter、绑定命令或兼容转发；`pages/patient-select` 的新增入口继续
显示迁移提示。只有 PB-01 至 PB-16 获得书面 contract、脱敏成功/未找到/拒绝/超时样例和可回滚测试环境后，才进入
“查档只读 → 绑定状态机 → 建档”分阶段实现。旧仓库、线上服务、数据库和 Redis 均未修改。

## 1. 结论先行

患者新增、已有档案绑定、修改资料和解绑不是一个简单的“保存表单”接口，而是
四个不同的业务动作：

1. **查找档案**：判断医院是否已经存在与当前用户提交信息匹配的档案；
2. **新建档案**：仅在医院明确确认“没有可绑定档案”后创建；
3. **绑定关系**：把已确认的医院档案与当前平台用户建立关系；
4. **修改/解绑**：必须有独立的医院授权、审计、冲突和撤销语义。

当前只能开放患者目录读取和选择。新增入口继续显示迁移提示，不能向用户显示
“绑定成功”，不能让小程序携带 `patId`、`thirdPatientId`、身份证号或 unionId
调用 provider，也不能因为一次查询超时就自动建档。

## 2. 旧端已经确认的实际流程

以下内容来自旧端源代码，不代表新端应该照搬：

| 旧步骤 | 旧实现事实 | 新端处理结论 |
| --- | --- | --- |
| 读取患者目录 | `GET /api/public/patientInfoByUnionId?unionId=...`，返回 `thirdPatientId`、姓名、`medicalCardNo/cardNo`、关系等 | unionId 只能由服务端身份映射取得；小程序只接收脱敏平台患者读模型 |
| 选择已有患者 | 旧端再次调用 `patInfosFind`，以 `type=3`、卡号和姓名查询档案，再把返回的 `patId` 写入 Pinia/缓存 | 新端只保存 opaque 内部 `patientId`；HIS `patId` 只能在服务端映射层使用 |
| 查找待绑定档案 | `GET /msun-middle-aggregate-patient/v1/patInfosFind`，提交 `type=2`、`idCardType=0`、身份证号、姓名 | provider 文档必须确认匹配规则、返回数量和身份一致性；查找异常不得转成“没有档案” |
| 已有档案 | 只要返回对象且有 `patId`，就调用 `POST /msun-middle-aggregate-patient/v1/patCards`，主要字段为 `patId`、`cardNo` | 必须增加 owner、姓名/证件一致性、重复关系、协议和幂等校验 |
| 没有档案 | 查询结果没有 `patId` 时调用 `POST /msun-middle-aggregate-patient/v1/patients`，携带姓名、手机号、身份证、证件类型、性别、生日、卡类型/卡号等 | 只有 provider 明确返回“未找到”且创建规则已冻结后才能执行 |
| 新建后绑定 | 建档返回 `patId` 后再次调用 `patCards` | 建档成功与绑定成功必须分开持久化；中间超时进入待确认，不能重复建档 |
| 查询失败 | 旧端 `catch` 后继续走建档流程 | **禁止迁移**：网络错误、超时、5xx、协议解析失败与“未找到”必须是不同状态 |
| 用户资料副作用 | 用户没有身份证时，旧端先把姓名、手机号、身份证、实名姓名和 openid 发给旧用户资料接口 | 新端禁止从患者绑定流程修改微信身份；实名资料写入必须是独立权限域 |
| 协议同意 | 页面复选框默认勾选，提交函数没有强制检查；协议页同意只 Toast，不记录版本/时间 | 新端必须服务端校验版本化同意事实，未同意直接拒绝 |
| 编辑模式 | 旧端只修改页面标题，回填和更新逻辑是 TODO | 当前不迁移为“编辑成功”；修改必须等待独立 contract |
| 解绑 | 旧端跳转固定外部健康卡管理 URL | 不得复用旧 WebView；需要固定 audience、短期会话和回调确认 |

旧端 `patientAdd.vue` 还会由身份证号码直接推导性别和出生日期，但没有完成
证件校验和日期合法性闭环；新端即使保留输入，也只能把它作为待校验材料，不能
把客户端推导结果当作医院事实。

### 2.1 二次审计补充的旧端风险

| 观察事实 | 不能直接迁移的原因 |
| --- | --- |
| 页面要求填写手机号，提示文字提到短信通知和每日短信次数，但源码没有验证码获取/校验接口 | 不能把“填写手机号”当作手机号已验证；必须确认验证码主体、用途、有效期、限流和 provider 是否真正发送通知 |
| 提交建档时把身份证号复制到 `cardNo`，并把 `cardType` 固定为 `3` | 这是旧端假设，不证明医院卡号等于证件号；新 contract 必须分别确认卡号来源、卡类型枚举和是否允许自助建卡 |
| “设为默认就诊人”开关在模板中被注释，旧提交流程没有可靠的默认关系写入 | 当前不能迁移成 provider 默认患者事实；新端的默认选择只能是本地展示偏好，若要跨设备同步必须另设平台 contract |
| 页面计算年龄，但 `calcAge` 结果没有进入明确的建档字段 | 年龄不能由客户端计算结果覆盖医院出生日期/年龄事实；服务端只接受经过 contract 确认的出生日期语义 |

## 3. 新端候选状态机

状态机属于服务端内部事实。小程序只接收脱敏状态和下一步提示，不接收 provider
原始响应、完整证件号或临床 `patId`。

```text
requested
    |
    v
identity_verified -> archive_lookup_pending
                         |
              +----------+----------+
              |                     |
              v                     v
       archive_found          archive_not_found
              |                     |
              v                     v
       bind_pending          create_pending
              |                     |
              v                     v
             bound           created_confirmed
                                      |
                                      v
                                bind_pending
                                      |
                                      v
                                     bound

archive_lookup_pending / create_pending / bind_pending
       -- provider timeout or ambiguous result --> awaiting_confirmation
                     |
          +----------+----------+
          |                     |
          v                     v
       retryable             rejected / duplicate
```

### 状态迁移规则

- `requested -> identity_verified`：只能从当前平台会话解析 owner；客户端提交的
  `openid`、`unionid`、provider 患者号全部忽略或拒绝。
- `identity_verified -> archive_lookup_pending`：服务端生成命令 ID 和幂等指纹，
  证件正文不进入日志；同一 owner 的相同规范化证件指纹不能并发创建第二条命令。
- `archive_lookup_pending -> archive_found`：仅在 provider 返回可验证的唯一档案，
  且姓名、证件类型和证件匹配规则满足冻结契约时迁移。
- `archive_lookup_pending -> archive_not_found`：仅在 provider 明确返回“无匹配档案”，
  不是空响应、HTTP 200、字段缺失或本地解析失败。
- `archive_found -> bind_pending`：必须先检查当前 owner 是否已经绑定、是否被其他
  owner 占用、关系是否允许，以及协议同意是否有效。
- `archive_not_found -> create_pending`：创建前应展示核对确认，并由服务端重新确认
  原子幂等条件；不能仅依赖第一次查询结果。
- 任意写入请求超时、响应不完整、结果与请求不一致或 provider 返回未知状态：进入
  `awaiting_confirmation`，先查询最终事实，再决定重试绑定还是人工处理。
- `bound` 是唯一可以刷新患者目录的成功状态。建档成功但绑定结果未知时，不能把
  患者显示为已绑定。
- `duplicate`、`rejected` 和 `awaiting_confirmation` 都必须可恢复；重复点击不能
  生成第二次建档或第二次绑定副作用。

## 4. 候选 API 边界（暂不注册）

以下只是内部设计草案，不是已冻结的公共接口。

### 4.1 请求允许的字段

```text
POST /api/v2/patient-binding/commands
```

候选请求字段：

| 字段 | 是否允许小程序提交 | 说明 |
| --- | --- | --- |
| `patientId` | 否，新增流程不需要 | 已有平台患者只能通过 owner 解析；不接受 provider ID |
| `displayName` | 是 | 长度、字符集和规范化规则待 provider 确认 |
| `phone` | 是 | 进入受控实名/绑定域；日志只记录是否存在和不可逆指纹 |
| `identityType` | 是 | 只能是冻结枚举；不能让客户端自由传 provider 类型 |
| `identityNumber` | 是 | 仅经 HTTPS 到平台服务；不进普通日志、URL、缓存和小程序长期存储 |
| `relationship` | 是 | 仅作为平台关系声明，不能替代医院关系事实 |
| `agreementVersion` | 是 | 服务端必须检查当前有效版本和实际同意主体 |
| `idempotencyKey` | 通过请求头提交 | 必须与 owner、命令用途和规范化材料绑定 |
| `openid/unionid/patId/thirdPatientId` | 否 | 发现即拒绝，不能兼容接收 |

候选响应只允许返回：

- 平台 `commandId`；
- 内部状态：`pending`、`awaiting_confirmation`、`bound`、`duplicate`、`rejected`；
- 脱敏展示姓名、关系和卡号摘要；
- 用户可执行的下一步，如 `retry`、`refresh`、`contact_hospital`。

候选查询：

```text
GET /api/v2/patient-binding/commands/{commandId}
```

命令查询必须再次按 token 校验 owner。小程序不得通过命令查询得到 provider
请求参数或原始医院响应。

### 4.2 不允许的兼容方案

- 不把旧 `/patInfosFind`、`/patients`、`/patCards` 直接代理给小程序；
- 不在 API 中接受“有 `patId` 就绑定”的简化请求；
- 不把查询异常降级成建档；
- 不把 `thirdPatientId` 当作 `patId`，也不让两者共用持久化列；
- 不把身份证号拼进 GET URL、日志、Redis key、页面参数或二维码；
- 不在客户端本地缓存完整患者对象、身份证或医院原始报文；
- 不以 Toast 或 HTTP 200 代表绑定成功；
- 不把“建档成功”直接等价为“当前 owner 已绑定”。

## 5. 持久化和并发不变量

真实实现至少需要独立于 `hp_patients` 目录快照的命令/关系事实。表名待 migration
冻结，建议包含以下逻辑字段：

| 事实 | 约束 |
| --- | --- |
| 命令 | `commandId`、owner、状态、版本、创建/更新时间、过期时间 |
| 材料指纹 | owner + 规范化证件指纹 + 用途唯一；绝不保存可逆明文作为幂等 key |
| 协议 | agreement 版本、同意主体、同意时间、用途、撤回时间 |
| provider 关联 | provider、用途、加密/受控引用、最后确认时间；不进入 read model |
| 绑定关系 | owner + 内部 `patientId` 唯一；provider 关系冲突可审计 |
| 外部调用 | operation、trace/request ID、状态摘要、可重试性、最终确认时间 |

必须覆盖：

1. 两次相同提交只产生一次外部建档副作用；
2. 两个不同 owner 不能绑定同一不可共享档案；
3. 同一 owner 不能重复建立同一患者关系；
4. 建档返回成功但绑定超时时，恢复任务先查询，不直接再次建档；
5. 目录同步失败不能删除或失效当前已确认绑定；
6. 事务提交前不发送“绑定成功”事件；
7. 关系/协议撤回后，后续临床读取必须按业务规则重新授权或拒绝。

## 6. 日志、脱敏和错误映射

允许记录的低敏字段：

- `event`、`traceId`、内部 `commandId`、owner 的不可逆日志维度；
- provider 名、操作名、provider request ID、HTTP 状态、耗时、`retryable`；
- 状态迁移的旧/新状态、幂等命中、最终确认结果；
- 材料指纹前缀或哈希版本（仅用于排障关联，不记录证件正文）。

禁止记录：

- Authorization、AppSecret、session_key、openid、unionid；
- 身份证号、手机号、姓名与证件的原始组合；
- `patId`、`thirdPatientId`、医院原始 JSON、绑定卡号和协议正文；
- provider URL query 中的身份证/卡号；
- 小程序“成功”截图中可还原患者身份的字段。

候选稳定错误码：

| 错误码 | 语义 | 页面动作 |
| --- | --- | --- |
| `patient-binding-contract-not-ready` | provider 或本平台依赖尚未配置 | 显示迁移提示，不重试写入 |
| `patient-identity-mismatch` | 姓名/证件/档案匹配不一致 | 要求核对或联系医院 |
| `patient-binding-duplicate` | 已存在绑定或命令重复 | 刷新患者目录 |
| `patient-binding-awaiting-confirmation` | 外部结果未知 | 查询命令状态，不重复建档 |
| `patient-binding-rejected` | provider 明确拒绝 | 展示安全文案和人工处理入口 |
| `patient-binding-rate-limited` | owner 或材料触发限流 | 等待后重试 |

## 7. 必须由新 provider 文档回答的问题

在这些问题没有书面答案、脱敏样例和测试环境证据前，不得实现写入：

| 编号 | 必须确认的内容 |
| --- | --- |
| PB-01 | 查档案接口完整路径、HTTP 方法、认证头、签名、超时和环境地址 |
| PB-02 | `type=2`/`type=3` 的正式含义、必填字段、证件类型枚举和匹配规则 |
| PB-03 | 查档案返回 0/1/多条时的 JSON、业务码、HTTP 状态和唯一性保证 |
| PB-04 | 查询超时、网关 5xx、空数据、字段缺失如何区分“未找到” |
| PB-05 | 建档必填字段、姓名/证件/手机号格式、卡类型和出生日期时区规则 |
| PB-06 | 建档的幂等键、重复请求响应、超时后的最终事实查询接口 |
| PB-07 | 绑卡的 owner/关系语义、重复绑定、跨 owner 冲突和解绑规则 |
| PB-08 | 建档成功但绑卡失败/超时的补偿、人工处理和可重试边界 |
| PB-09 | 修改患者资料的字段白名单、审计、版本冲突和是否允许自助修改 |
| PB-10 | 协议文本版本、同意用途、患者关系、撤回/重新同意和保留期限 |
| PB-11 | provider `patId`、目录 `thirdPatientId` 和平台患者的生命周期映射 |
| PB-12 | 真实测试账号、脱敏 fixture、错误样例和生产回滚方案 |
| PB-13 | 手机号是否需要验证码验证；验证码主体、用途、有效期、每日/每 owner 限流和通知责任方 |
| PB-14 | `cardNo` 是否可以由证件号代替；`cardType=3` 的正式含义、卡号来源和重复建卡规则 |
| PB-15 | 性别、出生日期、年龄的权威来源、格式、时区和 provider 校验；客户端推导值是否只用于预填 |
| PB-16 | 默认就诊人是平台展示偏好还是医院关系；是否需要跨设备同步、冲突处理和撤销语义 |

## 8. 实现和验收顺序

1. provider 文档冻结 PB-01 至 PB-16，确认旧服务当前生产行为不变；
2. 先实现领域状态机和纯函数测试，不接真实写入；
3. 实现命令持久化、唯一约束、协议事实和 owner 隔离；
4. 实现查档案 adapter，只读验证“找到/未找到/异常”三类，不开放建档；
5. 实现绑定 adapter 和最终事实查询，完成超时恢复与审计；
6. 最后实现建档，并以灰度账号验证重复提交、跨 owner、回滚和目录同步；
7. 通过内网 provider、平台公网 HTTPS、微信开发者工具、真机四层验收后，才移除
   患者选择页的迁移提示。

验收最小集合：

- 未登录、未同意协议、字段不合法；
- 已有档案唯一匹配、无档案、多个匹配；
- provider 超时、5xx、空响应、重复响应和未知业务码；
- 两次相同提交、并发点击、跨 owner 绑定冲突；
- 建档成功/绑卡失败、建档超时/最终查询成功、绑定超时/重试；
- 目录刷新、会话失效、命令查询 owner 越权；
- 日志没有身份证、手机号、openid、unionid、provider 患者号和原始报文；
- 旧 Python 服务、旧域名、旧数据库表和旧 Redis namespace 保持可用。

## 9. 当前代码门禁

在契约冻结前，新端必须保持以下状态：

- `POST /api/v2/patient-binding/*` 不注册；
- `pages/patient-select` 的“添加就诊人”只显示迁移提示；
- 页面只保存平台 `patientId`，不保存 `patId`、`thirdPatientId` 或完整患者资料；
- `/patients/sync` 只负责已绑定目录的服务端同步，不承担新增、绑卡或解绑；
- 任何 provider 写入凭证、证件正文和原始响应只存在于服务端受控边界。

这不是功能缺失的临时借口，而是防止旧端“异常即建档”和“客户端持有医院身份”
进入新生产系统的发布门禁。provider 文档到达后，必须先更新本文状态、问题答案、
contract、日志和验收手册，再提交代码。
