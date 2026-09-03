# 临床只读旧逻辑跨域审计（2026-08-26）

> 本文是对旧端源码的只读观察，不是新端接口实现授权。
> 本次只查看 `G:\\fuck\\hospital\\hospital-app`，没有修改旧 Python 项目、旧数据库、旧 Redis、线上进程，
> 也没有修改另一会话负责的众阳预约适配器。
>
> 目的不是继续死磕某一个页面，而是把四条容易互相误用的临床线一次性拆开：门诊记录、住院 episode、我的医生关系、电子导诊/问诊。
> 在正式 Provider/HIS contract 到达前，新端继续保持状态页或未注册路由；本审计不把旧端“能请求”当作迁移完成。

> **2026-08-27 复核结果**：重新执行 `pnpm clinical:contract:audit`，四个域仍为 `normalized / unregistered`，对应自动化审计 `4 pass / 0 fail / 18 expect()`。当前材料仍只有旧端源码观察和 contract 草案，没有同版本成功/空/拒绝/超时样例、owner 映射、字段白名单和权限证据，因此本轮不注册临床 API、不复用预约/报告/门诊费用模型，也不修改旧服务。

## 1. 审计指纹与范围

以下文件来自旧端当前工作树，仅用于复核来源和后续材料定位。SHA-256 是源码指纹，不代表旧接口已经被新服务采纳。

| 旧端文件 | 行数 | SHA-256 | 本次用途 |
| --- | ---: | --- | --- |
| `hospital-app/src/pagesB/health/electronic_record.vue` | 121 | `7e9842d10fce9e954a059c9dba9827fda66cb0ce629360e89a9333df4b10f669` | 门诊记录页面查询与错误处理 |
| `hospital-app/src/pagesB/health/inpatient_center.vue` | 504 | `f618b93b237234f5d3f484efcfc40e5035267e3e83f54ca69ed573f354391e70` | 住院患者与日费用两段查询 |
| `hospital-app/src/pagesB/patient/doctor.vue` | 142 | `b868f1fd446bbde58bac005d1ff5567daee2afb33d04082049f42f7397803472` | 我的医生列表和展示字段 |
| `hospital-app/src/pagesB/health/electronic_consultation.vue` | 182 | `4c82236dac47a3ea61118d0431a8204d26231a9ca140c70fa4afd49e90a8bdf6` | 电子导诊页面实际复用的历史就诊查询 |
| `hospital-app/src/pagesB/user/my_consultation.vue` | 141 | `5c1492b6818424b4a620d38df0d8689f709a9cc8bf06c637b45635f1d107ed2d` | “我的问诊”外部陪诊历史 |
| `hospital-app/src/api/modules/medicalRecord.ts` | 297 | `1a0db15d194e468ec2ef8b8502f9687322d07007b1c8a447d9a53d3cf61ef801` | 门诊/住院 Provider 路径与旧类型 |
| `hospital-app/src/api/modules/ZY.ts` | 203 | `659408140db42dd1705a143850dd568d8f286285cf31b58dfa7ae865607bfe38` | 另一份门诊记录 API 声明 |
| `hospital-app/src/api/modules/user.ts` | 175 | `3c20e2b0f16c9e177ecb063d559b181a3b0e8a24d8091e60e2fcbd602949bed6` | 我的医生关系命令与列表 |
| `hospital-app/src/api/modules/companion.ts` | 172 | `99a5cc48c0f1354af99bccb2bef98d375bef7c3e002d40faf29b9928c78145b2` | 历史就诊和治疗陪诊历史 |

## 2. A 线：门诊就诊记录

### 旧端实际行为

- 页面 `electronic_record.vue` 在选中患者后，按当前时间向前 30 天查询。
- 请求方法为 `POST`，路径为 `/msun-middle-aggregate-clinic/v1/out-visit-records`。
- 页面发送 `{ startDate, endDate, type: "5", patId }`，其中 `patId` 来自旧端患者选择器。
- 旧端把非数组响应和所有异常都转换为空数组；因此“Provider 返回异常”和“确实没有记录”在页面上无法区分。
- `medicalRecord.ts` 和 `ZY.ts` 对同一路径各自定义了一份接口，字段类型仍是开放字典/未审计旧字段。

### 新端不能直接照搬的地方

- 新端客户端只能提交平台内部 `patientId`，不能接收或转发旧 `patId`。
- 30 天窗口、`type=5`、分页/排序和时区都必须进入正式 contract，不能由页面常量隐式决定。
- 目录摘要和病历正文是两个权限层；旧页面只展示摘要，不能据此推导正文接口已经可用。
- 旧端错误折叠为空列表违反新端“错误与合法空结果分离”的统一语义。

### 放行前材料

需要同一版本的请求、成功、合法空、未登录、非 owner、Provider 拒绝、超时、字段异常样例；同时冻结日期窗口、分页、
记录唯一标识、患者映射、摘要字段白名单、正文短期引用和日志禁止字段。材料未齐前，`/api/v2/medical-records` 不注册。

## 3. B 线：住院 episode 与住院日费用

### 旧端实际行为

旧端实际是两段调用，不是“有一个患者就有一条住院记录”：

1. `GET /msun-middle-aggregate-hsz/v1/patients?patId=...` 查询住院患者信息，响应被当作数组。
2. 页面从第一条结果取 `patInHosId`，再调用
   `GET /msun-middle-open-settlepay/v1/inpatient-settle-singles/inpatient-in-day-singles`，按 `patInHosId` 和时间范围查询日费用。

旧页面还展示住院号、入出院时间、床位/病区、医生/护士、诊断、婴儿信息和费用项目等敏感或高风险字段；时间范围无选择时默认最近 30 天。

### 新端不能直接照搬的地方

- `patInHosId` 是住院 episode 的 Provider 标识，不是平台患者 ID，也不能从门诊患者或门诊费用记录推导。
- 多次住院时不能静默取第一条；在院、出院、取消、结算中和未知状态必须有稳定枚举。
- 住院日费用不是门诊费用的另一种列表，必须独立定义金额单位、时间区间、明细权限、总额守恒和结算状态。
- 诊断、住院号、床位和医护信息需要单独字段白名单；不能把旧端开放接口类型直接变成公共响应。

### 放行前材料

需要 episode 权威来源、多个 episode 的选择规则、患者授权边界、状态枚举、住院号/诊断/医护字段脱敏样例，
以及住院费用的金额单位、分页、汇总和 Provider 拒绝/超时样例。住院信息和住院支付必须保持两个 gate；支付仍归 F 批次最后处理。

## 4. C 线：我的医生关系

### 旧端实际行为

- 列表请求为 `GET /convenience/my-doctor/list`，页面将 `doctor_id`、`doctor_name`、`title_name`、`expertise`、
  `department_location`、`department_name` 等字段映射成展示卡片。
- 关注命令为 `POST /convenience/my-doctor/create`。
- 取消关注在旧端封装为 `GET /convenience/my-doctor/delete?doctor_id=...`，这属于不应复制到新端的命令语义。
- 页面没有显示关系版本、失效时间、医院目录版本或医生离职/科室变更的处理；异常也会退化为空列表并弹 Toast。

### 新端不能直接照搬的地方

- 医生目录事实和用户关注关系必须分离；患者不能通过提交医生姓名、科室或旧 `doctor_id` 自行制造关系。
- 新端取消关系必须使用明确的命令方法和幂等键，不能继承旧端 GET 删除。
- 医生目录下线、离职、科室变化和关系失效必须有可解释状态，不能继续展示长期缓存快照。
- 医生头像、联系方式、专长和内部 Provider 标识必须分别确定展示白名单；任何旧 `avatar_url` 都不能自动成为新端可信资源。

### 放行前材料

需要当前医院医生目录的权威来源和版本、医生引用映射、关系 owner 规则、创建/取消幂等语义、失效/撤销样例、
列表空态与拒绝/超时样例，以及医护侧是否可见关系的授权说明。材料未齐前，`doctor` 入口继续保持 `blocked-provider`。

## 5. D 线：电子导诊、历史就诊和“我的问诊”不是一回事

### 电子导诊页面的实际行为

`electronic_consultation.vue` 没有调用独立的电子导诊 Provider。选中患者后，它调用的是旧的历史就诊封装：

- 页面请求 `GetAppointmentHistoryApi(patId, { startTime, endTime })`；
- 时间范围为最近 30 天；
- `GetAppointmentHistoryApi` 继续转到预约历史接口并把结果映射成陪诊/就诊列表；
- 页面内的缴费账单、病历查询、住院预约和二维码等入口是独立按钮或占位交互，不能从这个历史列表推导出对应业务已经存在。

因此，电子导诊当前只能登记为“来源未确认的 Provider 入口”，不能把预约历史改名成电子导诊单，也不能把固定按钮当成真实功能。

### “我的问诊”的实际行为

`my_consultation.vue` 调用的是独立的 `GET /intelligent/treatment_companion/history`，页面语义是治疗陪诊历史；
它与电子导诊页面复用的预约历史不是同一事实来源。但旧服务的 `get_treatment.py` 在真正的 httpx 请求前
直接返回硬编码演示记录，后面的众阳查询代码不可达；即使移除演示返回，查询函数还把 Provider 患者号写死为
`10625603`，也没有建立当前用户到患者的 owner 映射。因此旧端当前只能证明“页面和接口声明存在”，不能证明
有可用的真实问诊历史数据。

这条入口暂时按 E 批次独立能力处理，不能与 C 批次电子导诊共用模型或权限；新端也不能复制旧端演示记录、写死
患者号，或把预约历史改名为问诊历史。

### 放行前材料

C 线需要电子导诊单的专用来源、生命周期、患者/用户 owner、实时状态与只读字段；E 线的“我的问诊”首先需要
补齐真实治疗陪诊/问诊来源、患者 owner 映射、内容字段白名单；若确认存在外部主体，再继续冻结域名 allowlist、
短期会话、受众、退出、回跳、撤回和保留周期。两者均不能通过预约历史、旧端演示数据、空列表或长期 ticket 兼容开放。

## 6. 跨域结论与全量队列推进

本次审计没有发现可以在不新增正式 contract 的情况下安全打开上述四类真实业务的路径。这个结论不是停止迁移，而是把后续工作拆成并行队列：

| 队列 | 当前可以继续做 | 暂不做 |
| --- | --- | --- |
| A：已有只读 | 预约、报告、门诊费用、患者、普通资料的同候选验收和真实日志配对 | 写入、附件、支付、医保 |
| B：健康内容 | 审核 bundle 校验、staging 导入/撤回演练 | 未审核题库、风险结论、个体化建议 |
| C：临床只读 | 按本文四条线登记 contract、字段白名单、错误样例和越权矩阵 | 旧 Provider 兼容转发、复用预约/报告模型 |
| D：患者与便民 | 同意、幂等、撤回、文件安全、医护读取规则 | 直接建档、旧端隐式绑卡和身份证/卡号混用 |
| E：外部入口 | allowlist、短期会话、回跳、退出与保留规则 | 任意 WebView、长期 ticket、伪造问诊成功 |
| F：支付与医保 | 金额与状态机、回调/查单/补偿的设计材料 | 真实支付、医保授权、HIS 写回；仍最后处理 |

统一放行阶梯仍为：

```text
正式材料指纹
  -> 请求/响应/空/拒绝/超时样例
  -> owner 与患者映射
  -> 字段白名单和禁止字段
  -> adapter
  -> domain 不变量
  -> persistence（必要时）
  -> Elysia API
  -> 原生小程序页面
  -> Pino 低敏日志
  -> 内网、公网、开发者工具、真机证据
```

本审计完成后，四条临床线都有明确的旧逻辑依据、当前阻断理由和下一份材料清单；后续任何一条线拿到正式材料，
都可以独立进入实现，不需要再重新扫描全部旧项目。当前 `pnpm clinical:contract:audit` 仍保持通过，四条线仍未注册真实 API。
