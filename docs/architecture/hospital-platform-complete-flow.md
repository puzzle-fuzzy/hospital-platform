# Hospital Platform 完整体业务流程图

> 审计基线：2026-08-24。本文按当前工作区实际注册的路由、页面事件、service、domain、adapter、repository 和 worker 绘制；“代码文件存在”不等于“用户入口已开放”。

## 1. 先看结论

- 患者端主链路：原生微信小程序 → 公网 Nginx `/api/v2` → Elysia 内部 `/api/v1` → 认证/业务 service → domain contract → MySQL/Redis 或 Provider adapter。
- 当前实际开放的患者端业务以“登录、患者目录同步、预约只读目录、预约历史/爽约只读、报告目录/部分检验详情、门诊费用只读、普通资料”为主。
- 预约下单、锁号、取消、挂号费、医保结算、门诊缴费调起、报告下载/分享/复诊、健康百科公共挂载、智能服务等没有被当前代码证明为可用。
- 支付 API、微信通知验签解密、outbox 和查单 worker 已有代码边界，但 `WECHAT_PAYMENT_READY`/完整配置/真实验收同时满足前，运行时保持 fail-closed；当前小程序门诊费用页面不调用 `wx.requestPayment`。
- `.codegraph/` 当前不存在，也没有可调用的 codeGraph 服务；本文的“调用图”由实际 import、路由注册、页面事件和跨层方法调用重建。

## 2. 图例

```mermaid
flowchart LR
    U[用户点击或页面生命周期]:::ui --> M[微信小程序页面与服务]:::ui
    M --> A[HTTP API 路由与认证边界]:::api
    A --> S[业务 service / domain]:::domain
    S --> P[MySQL / Redis 读写模型]:::store
    S --> X[Provider adapter / 外部系统]:::provider
    X --> V[响应校验、trace、白名单投影]:::guard
    V --> A

    classDef ui fill:#e8f1ff,stroke:#4a78c2,color:#17345f;
    classDef api fill:#fff2d9,stroke:#bd7b00,color:#5a3a00;
    classDef domain fill:#e8f7ed,stroke:#3d8d5d,color:#1f4d30;
    classDef store fill:#f2eafd,stroke:#7954a7,color:#38215b;
    classDef provider fill:#ffe8e8,stroke:#c75252,color:#681e1e;
    classDef guard fill:#fff8c9,stroke:#a98b00,color:#5e4d00;
```

## 3. 总体架构与真实可达边界

```mermaid
flowchart LR
    subgraph Client[患者端：原生微信小程序]
        Launch[App onLaunch\n固定 apiBaseUrl + apiPrefix]
        Home[首页 pages/index/index\n健康检查、会话恢复、快捷入口]
        Patient[就诊人选择\npatient-select]
        Appt[预约只读\n医院 → 科室 → 排班]
        Records[我的挂号 / 爽约记录]
        Reports[报告目录 → 检验详情]
        OutPay[门诊费用只读\n待缴/已缴]
        Profile[普通资料\n读取/编辑]
        Static[静态或迁移中页面\n公众号、反馈、院内地图等]
    end

    subgraph Edge[公网与 API 边界]
        Nginx[Nginx\n/api/v2/* → API /api/v1/*]
        Elysia[Elysia createApp\nnormalize=false、CORS、requestId、错误映射]
        Auth[Bearer principal resolver\n认证发生在 schema 前]
        Health[health/live、health/ready]
    end

    subgraph Services[应用服务与领域层]
        AuthSvc[AuthService]
        PatientSvc[PatientService]
        ApptSvc[AppointmentService]
        ReportSvc[ReportService]
        OutSvc[OutpatientPaymentService]
        ProfileSvc[UserProfileService]
        PaySvc[PaymentOrderService + WechatPrepayService]
        State[领域校验、opaque ID、状态机、日期窗口]
    end

    subgraph Persistence[持久化]
        Redis[(Redis\nhospital:session:* TTL)]
        MySQL[(MySQL\nidentity / patients / mappings / profiles / reports / payments / outbox)]
    end

    subgraph Providers[外部系统与适配器]
        WxIdentity[微信身份\nGET /sns/jscode2session]
        ZYPatient[众阳患者目录\npatientInfoByUnionId + patInfosFind]
        ZYAppt[众阳 AMC\n科室、排班、预约历史]
        ZYReport[众阳 LIS/PACS/ECG\n报告目录、检验详情]
        ZYFee[众阳门诊费用只读]
        WxPay[微信支付 APIv3\nJSAPI、查单、通知]
    end

    Launch --> Home
    Home --> Patient
    Home --> Appt
    Home --> Records
    Home --> Reports
    Home --> OutPay
    Home --> Profile
    Home --> Static
    Patient --> Nginx
    Appt --> Nginx
    Records --> Nginx
    Reports --> Nginx
    OutPay --> Nginx
    Profile --> Nginx
    Nginx --> Elysia --> Auth
    Elysia --> Health
    Auth --> AuthSvc --> WxIdentity
    AuthSvc --> MySQL
    AuthSvc --> Redis
    Auth --> PatientSvc --> MySQL
    PatientSvc --> ZYPatient
    Auth --> ApptSvc --> MySQL
    ApptSvc --> ZYAppt
    Auth --> ReportSvc --> MySQL
    ReportSvc --> ZYReport
    Auth --> OutSvc --> MySQL
    OutSvc --> ZYFee
    Auth --> ProfileSvc --> MySQL
    Auth --> PaySvc --> MySQL
    PaySvc --> WxPay
    Services --> State

    classDef ui fill:#e8f1ff,stroke:#4a78c2,color:#17345f;
    classDef api fill:#fff2d9,stroke:#bd7b00,color:#5a3a00;
    classDef domain fill:#e8f7ed,stroke:#3d8d5d,color:#1f4d30;
    classDef store fill:#f2eafd,stroke:#7954a7,color:#38215b;
    classDef provider fill:#ffe8e8,stroke:#c75252,color:#681e1e;
```

## 4. 启动、健康检查与 API 运行时闸门

```mermaid
flowchart TD
    Start[API 进程启动\napps/api/src/index.ts] --> Config[读取 RuntimeConfig\nprovider / DB / Redis / schema gate]
    Config --> Build[组合根创建 adapter、persistence、services]
    Build --> Probe{并行只读探针}
    Probe --> DB[(MySQL SELECT 1)]
    Probe --> R[(Redis connection/readiness)]
    Probe --> Schema[(migration + schema probe)]
    DB --> Gate{database=ok\nredis=ok\nschema=ok?}
    R --> Gate
    Schema --> Gate
    Gate -->|是| ReadyRepo[注入真实 MySQL repositories\nRedis session store]
    Gate -->|否| FailClosed[repositories/session/provider 能力保持\nnot_configured 或 unavailable]
    ReadyRepo --> Listen[监听 API 端口]
    FailClosed --> Listen

    Listen --> Live[GET /health/live\n只证明进程存活]
    Listen --> Ready[GET /health/ready\n实时检查 DB/Redis/schema]
    Ready --> ReadyState{全部 ok?}
    ReadyState -->|是| Ready200[200 ready]
    ReadyState -->|否| Ready503[仍响应但 not_ready\n发布要求时返回失败]

    classDef ok fill:#e8f7ed,stroke:#3d8d5d,color:#1f4d30;
    classDef warn fill:#fff8c9,stroke:#a98b00,color:#5e4d00;
    classDef bad fill:#ffe8e8,stroke:#c75252,color:#681e1e;
    class Gate,ReadyState ok;
    class FailClosed,Ready503 bad;
```

关键事实：readiness 不是业务成功证明；schema 未通过时，API 可以继续提供 health/readiness，但业务 repositories 不会被伪装成可用。每个受保护请求还要经过 Bearer session 校验，Redis 故障返回暂时不可用，不能被错误映射成“用户未登录”。

## 5. 用户登录与会话恢复

```mermaid
sequenceDiagram
    autonumber
    actor User as 用户
    participant MP as 小程序首页 / api-client
    participant Nginx as Nginx /api/v2
    participant API as Elysia /api/v1/auth
    participant Auth as AuthService
    participant Wx as 微信身份 API
    participant DB as MySQL
    participant Redis as Redis session

    User->>MP: 打开首页或点击登录
    MP->>MP: wx.login() 获取一次性 code
    MP->>Nginx: POST /api/v2/auth/wechat\n{ code }
    Nginx->>API: POST /api/v1/auth/wechat
    API->>Auth: 认证公开入口，校验 body/context
    Auth->>Wx: GET /sns/jscode2session\nappid、secret、js_code、grant_type
    Wx-->>Auth: openid、可选 unionid、trace
    Auth->>DB: findOrCreateByWechat(providerSubject)
    DB-->>Auth: 内部 userId
    Auth->>Redis: SET hospital:session:{token}\nuserId + EX 3600
    Redis-->>Auth: 保存成功
    Auth-->>API: accessToken + Bearer + user.id
    API-->>Nginx: success(data)
    Nginx-->>MP: 200
    MP->>Nginx: GET /api/v2/me\nAuthorization: Bearer
    Nginx->>API: GET /api/v1/me
    API->>Redis: verify token
    Redis-->>API: userId
    API-->>MP: current owner userId
    MP->>MP: sessionState=signed_in\n推进 session generation

    alt code 无效、微信拒绝或 provider 暂时不可用
        Wx-->>Auth: ProviderRequestError
        Auth-->>MP: 502/503 安全错误码
        MP->>MP: 清理页面展示态，保留可重试会话状态
    else Redis/MySQL 未配置或不可用
        Auth-->>MP: 503 dependency/persistence error
        MP->>MP: 不把基础设施故障误报为 401
    end
```

登录之后的首页初始化不是“拿到 token 就完成”：

```mermaid
flowchart TD
    LoginDone[登录或恢复 /me 成功] --> ReadPatients[GET /patients\n读取 owner-scoped 患者快照]
    ReadPatients --> ReadOk{目录读取结果}
    ReadOk -->|最新读取成功| Sync[POST /patients/sync\nIdempotency-Key]
    ReadOk -->|被新页面/新请求淘汰| Superseded[旧结果无回写资格\n不继续同步]
    ReadOk -->|401/503/错误| SessionState[invalid 或 unavailable\n清空展示态]
    Sync --> SyncGate{配置、identity、directory、sync lease?}
    SyncGate -->|否| Sync503[503 fail-closed]
    SyncGate -->|是| SyncLedger[MySQL operation ledger\n幂等键 + owner/provider 活跃 lease]
    SyncLedger --> Replay{operation 状态}
    Replay -->|succeeded| ReplayList[直接 replay 已提交快照\n再 list]
    Replay -->|in_progress| Conflict[409 patient-sync-in-progress]
    Replay -->|started| ProviderPatient[众阳患者目录查询]
    ProviderPatient --> Normalize[完整快照校验、去重、字段投影]
    Normalize --> Archive[逐患者 patInfosFind\n只在服务端取得 his-patient 引用]
    Archive --> Snapshot[同一事务替换患者快照\n写映射、停用缺失患者、完成 operation]
    Snapshot --> PatientView[返回脱敏患者列表\ninternal patientId + clinicalAccess]
    ReplayList --> PatientView
    PatientView --> Select[恢复或要求用户显式选择 patientId]

    classDef good fill:#e8f7ed,stroke:#3d8d5d,color:#1f4d30;
    classDef warn fill:#fff8c9,stroke:#a98b00,color:#5e4d00;
    classDef bad fill:#ffe8e8,stroke:#c75252,color:#681e1e;
    class SyncGate,Replay good;
    class Superseded,Conflict warn;
    class SessionState,Sync503 bad;
```

患者同步的关键数据边界：

- 小程序只提交 `wx.login` code、内部 opaque `patientId` 和幂等键；不提交 unionId、openid、身份证号或 Provider 患者号。
- 众阳目录通常先走 `/api/public/patientInfoByUnionId`，再按患者资料走 `/msun-middle-aggregate-patient/v1/patInfosFind`；`his-patient` 映射只保存在服务端。
- 完整快照缺失的患者会被标记 inactive，不物理删除，以保留历史订单/报告等外键语义；缺失 `his-patient` 映射的患者 `clinicalAccess` 不再是 ready。

## 6. 首页点击分流

```mermaid
flowchart TD
    Home[首页页面生命周期或点击] --> Action{用户动作}
    Action --> Login[点击登录/需要会话]
    Action --> PatientAction[新增/更换就诊人]
    Action --> Appointment[预约挂号]
    Action --> Outpatient[门诊缴费]
    Action --> AppointmentRecords[我的挂号]
    Action --> Missed[爽约记录]
    Action --> Report[报告查询]
    Action --> Profile[我的/个人资料]
    Action --> Static[静态/迁移中入口]

    Login --> AuthFlow[走登录与 /me 恢复]
    PatientAction --> PatientGate{有已验证会话?}
    PatientGate -->|否| AuthFlow
    PatientGate -->|是| PatientPage[进入 patient-select]

    Appointment --> ApptGate{有已验证会话?}
    ApptGate -->|否| AuthFlow
    ApptGate -->|是| HospitalList[静态医院列表]
    HospitalList --> ApptDirectory[appointment-directory]

    Outpatient --> ScopedGate1{会话 + 当前 ready 患者?}
    AppointmentRecords --> ScopedGate2{会话 + 当前 ready 患者?}
    Missed --> ScopedGate3{会话 + 当前 ready 患者?}
    Report --> ScopedGate4{会话 + 当前 ready 患者?}
    ScopedGate1 -->|否| PatientPage
    ScopedGate2 -->|否| PatientPage
    ScopedGate3 -->|否| PatientPage
    ScopedGate4 -->|否| PatientPage
    ScopedGate1 -->|是| OutPayPage[outpatient-payment]
    ScopedGate2 -->|是| RecordsPage[appointment-records]
    ScopedGate3 -->|是| MissedPage[missed-appointments]
    ScopedGate4 -->|是| ReportPage[report-directory]

    Profile --> ProfilePage[my → profile\nGET /me/profile]
    Static --> ToastOrStatic[公众号、院内导航、反馈、迁移提示\n不进入 API 业务链路]
```

页面侧所有受保护业务读取都遵循同一组合原则：先 `GET /me` 确认 owner，再 `GET /patients` 解析当前显式选择，再以同一 session generation 发起 patient-scoped 查询；请求前后都检查页面 request guard、会话代际和当前 `patientId`，过期响应不得回写页面。

## 7. 预约只读目录

```mermaid
flowchart TD
    Click[首页点击预约挂号] --> Authenticated[认证门禁]
    Authenticated --> Hospital[静态高平市人民医院卡片]
    Hospital --> Register[点击“预约挂号”]
    Register --> Departments[GET /api/v2/appointments/departments]
    Departments --> API1[内部 /api/v1/appointments/departments\nAppointmentService.listDepartments]
    API1 --> Date7[服务端生成最多未来 7 天窗口]
    Date7 --> AMC1[GET /msun-middle-business-amc-server/v1/schedulings/scheduling-depts\nrequestChannel=4]
    AMC1 --> DepartmentValidate[Provider envelope、字段、唯一 ID 校验]
    DepartmentValidate --> DepartmentUI[左栏显示科室]
    DepartmentUI --> ChooseDept[用户点击科室]
    ChooseDept --> Schedules[GET /api/v2/appointments/schedules\ndepartmentId + startDate + endDate]
    Schedules --> API2[AppointmentService.listSchedules]
    API2 --> AMC2[GET /msun-middle-business-amc-server/v1/schedulings\nrequestChannel=4 + deptId/docId]
    AMC2 --> ScheduleValidate[号源、日期、字段、重复 ID 校验]
    ScheduleValidate --> ScheduleId[服务端生成 opaque scheduleId]
    ScheduleId --> Snapshot[可选写入短期排班观察快照\nproviderScheduleId 不出现在公共响应]
    Snapshot --> ScheduleUI[右栏显示医生/日期/时段/剩余号源]
    ScheduleUI --> ClickSlot[点击号源]
    ClickSlot --> NotOpen[Toast：预约下单功能迁移中]

    Departments -.异常.-> Error[400/502/503 → 页面清空旧目录并允许重试]
    Schedules -.异常.-> Error
```

当前没有从该页面触发的预约写入 API。`POST /appointments`、锁号、取消和挂号费在 runtime smoke 中属于刻意关闭边界，不能把 `scheduleId` 解释成已经获得 Provider 写入授权。

## 8. 我的挂号与爽约记录

```mermaid
flowchart LR
    Records[我的挂号] --> RQuery[GET /api/v2/appointments/records\npatientId + startDate/endDate]
    Missed[爽约记录] --> MQuery[同一 GET 路由\n过去 90 天窗口]
    RQuery --> Service[AppointmentService.listRecords\nowner 来自 Bearer]
    MQuery --> Service
    Service --> Ref[MySQL resolveProviderReference\nprovider=zhongyang\nreferenceKind=his-patient]
    Ref --> RefOK{映射存在且 owner/patient 匹配?}
    RefOK -->|否| NotFound[业务错误：当前患者暂无可查询记录]
    RefOK -->|是| Provider[GET /msun-middle-business-appointment-server/v1/appointment-infos/{patId}\nrequestChannel=3、isMzFlag=1、dateFlag=1]
    Provider --> Validate[字段/日期/重复记录/trace 校验]
    Validate --> View[只返回平台预约摘要\n小程序本地分页/筛选]
    View --> Detail[点击记录]
    Detail --> DetailNotOpen[Toast：挂号详情暂未开放]
    View --> Actions[预问诊、全部挂号等未开放动作\n显示迁移提示]
```

“我的挂号”覆盖中国标准时间前后各 90 天；“爽约记录”只覆盖过去 90 天。两者复用 Provider 记录接口，但页面和 service 的窗口语义不同，未知窗口不会静默降级为普通历史查询。

## 9. 报告目录与检验详情

```mermaid
flowchart TD
    OpenReports[进入 report-directory] --> Me[GET /api/v2/me]
    Me --> Patients[GET /api/v2/patients]
    Patients --> Current[解析 owner-scoped 当前 ready 患者]
    Current --> ReportList[GET /api/v2/reports\npatientId + 最近 30 天 start/end + 可选 kind]
    ReportList --> ReportService[ReportService.list]
    ReportService --> ReportRef[resolveProviderReference\nreferenceKind=his-patient]
    ReportRef --> ZYReports[按 kind 查询众阳报告]
    ZYReports --> L[检验：/msun-middle-business-lis/v1/lis-reports-filter]
    ZYReports --> I[影像：对应 imaging path]
    ZYReports --> E[心电：/msun-middle-business-ecg/v2/ecg-reports]
    L --> Merge[字段白名单、去重、来源/日期/trace 校验\n多来源任一路失败则整批失败]
    I --> Merge
    E --> Merge
    Merge --> DetailGate{检验 + providerReportId + detail adapter + references?}
    DetailGate -->|否| Summary[保留摘要，但不提供详情 reportId]
    DetailGate -->|是| RefStore[生成 hash reportId\n写 hp_report_references\nowner/patient/TTL≈10分钟]
    RefStore --> SummaryWithLink[摘要 + 服务端短期 reportId]
    Summary --> ReportUI[报告列表，本地分批渲染]
    SummaryWithLink --> ReportUI
    ReportUI --> Tap{用户点击报告}
    Tap -->|没有短期引用| Unavailable[Toast：该报告详情暂未开放]
    Tap -->|有 reportId 且当前患者未变化| DetailRequest[GET /api/v2/reports/:reportId?patientId]
    DetailRequest --> DetailService[ReportService.detail]
    DetailService --> RefCheck[按 owner + patient + reportId + now 查引用\n再次校验范围和 TTL]
    RefCheck -->|失败/过期| Detail404[report-not-found / 详情不可用]
    RefCheck -->|通过| LISDetail[GET LIS 详情 path\nreportId=providerReportId]
    LISDetail --> DetailValidate[白名单检测项/附件/trace 校验]
    DetailValidate --> DetailUI[展示检验详情]
    DetailUI --> Image[云影像]
    DetailUI --> Share[分享]
    DetailUI --> Consultation[复诊预约]
    Image --> Migrating[Toast：云影像功能迁移中]
    Share --> Migrating
    Consultation --> Migrating
```

影像与心电当前只证明目录适配器存在；详情页的已接入路径是检验详情。报告目录请求的 Provider 结果不是“有一条成功就返回”，未指定 `kind` 时三路结果会合并，任一路响应异常都保持整批 fail-closed，避免把缺失报告伪装成空列表。

## 10. 门诊费用只读链路

```mermaid
flowchart TD
    OpenFee[进入 outpatient-payment] --> Context[GET /me → GET /patients\n确认 owner + ready patient]
    Context --> Tab[点击“待缴费”或“已缴费”]
    Tab --> Query[GET /api/v2/payments/outpatient/records\npatientId + status=unpaid|paid]
    Query --> Service[OutpatientPaymentService.list]
    Service --> Window[按 Asia/Shanghai 生成最近 30 个自然日窗口]
    Window --> Ref[resolveProviderReference\nreferenceKind=his-patient]
    Ref --> Provider[GET /msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records\npatId + startTime/endTime + authSysCode]
    Provider --> StatusMap[unpaid→tradeStatus=1\npaid→tradeStatus=3]
    StatusMap --> Validate[账单日期、金额分、状态和 trace 校验]
    Validate --> FeeUI[展示金额、日期、科室/医生、已缴/待缴摘要]
    FeeUI --> Tap[点击账单]
    Tap --> Local[当前仅本地查看/提示\n不调用 wx.requestPayment]
    FeeUI --> ChangePatient[更换就诊人]
    ChangePatient --> Context
```

该 adapter 明确是“门诊费用只读”，不承载支付调起、医保结算或退款。Provider 返回窗口外账单时整批拒绝，而不是静默过滤，以免用户看到不完整的账本。

## 11. 普通资料与“我的”页面

```mermaid
flowchart LR
    My[我的页面] --> Me[GET /api/v2/me]
    Me --> ProfileGet[GET /api/v2/me/profile]
    Me --> PatientGet[GET /api/v2/patients]
    ProfileGet --> MySQLProfile[(hp_user_profiles)]
    PatientGet --> MySQLPatient[(hp_patients + clinical mapping)]
    ProfileGet --> MyView[展示昵称、性别、年龄、邮箱、患者数]
    PatientGet --> MyView
    MyView --> Edit[点击头像/资料入口]
    Edit --> GetProfile[GET /api/v2/me/profile]
    GetProfile --> Form[编辑普通资料字段]
    Form --> Save[PUT /api/v2/me/profile\nversion + displayName/gender/age/email]
    Save --> Version{version 匹配?}
    Version -->|否| Conflict[409 user-profile-conflict\n强制重新 GET]
    Version -->|是| Canonical[MySQL 事务更新 version+1\n返回服务端 canonical 快照]
    Canonical --> Back[成功提示后返回“我的”]
    MyView --> Family[家庭成员管理]
    Family --> PatientSelect[进入 patient-select\n完整目录/同步/显式选择]
```

头像、手机号、真实姓名、身份证等字段不会借普通资料接口写入；“我的挂号、爽约记录、门诊缴费”在没有当前 ready 患者时会进入就诊人选择页，而不是先发一个必然失败的业务请求。

## 12. 支付、微信通知与 worker 补偿链路（代码存在，默认关闭）

```mermaid
flowchart TD
    Quote[服务端已有 payment quote\n金额事实只能来自 quote] --> CreateOrder[POST /api/v2/payments/orders\nowner + patient + quoteId + idempotency-key]
    CreateOrder --> PayGate{wechatPaymentEnabled?}
    PayGate -->|否| Pay503[503 dependency-not-configured\n默认路径]
    PayGate -->|是| OrderSvc[PaymentOrderService.createFromQuote\n校验 owner/patient/quote/expiry/幂等]
    OrderSvc --> OrderDB[(hp_payment_orders\nstate + version + amounts)]
    OrderDB --> Prepay[POST /api/v2/payments/orders/:orderId/wechat-prepay]
    Prepay --> PrepaySvc[WechatPrepayService.create]
    PrepaySvc --> PrepayCheck{订单 cash_pending\n现金金额 > 0\n幂等尝试可复用?}
    PrepayCheck -->|否| PrepayReject[拒绝或 replay pending/unknown]
    PrepayCheck -->|是| WxJSAPI[微信支付 APIv3\nPOST /v3/pay/transactions/jsapi\n商户请求签名 + 平台响应验签]
    WxJSAPI --> AttemptDB[(hp_payment_prepay_attempts\npayParams 加密、prepay 摘要、nextQueryAt)]
    AttemptDB --> MPLaunch[小程序拿白名单 payParams\nwx.requestPayment 调起]
    MPLaunch --> UserPayment{用户/微信结果}
    UserPayment -->|调起成功| Await[只代表支付 UI 调起\n不直接改业务订单]
    UserPayment -->|取消/失败| Await
    Await --> Notify[微信 POST /api/v2/payments/wechat/notifications]
    Notify --> Decode[APIv3 原文验签 → AES-256-GCM 解密 → app/mch/金额/状态白名单]
    Decode --> NotifyDB[(hp_wechat_payment_notifications\nnotificationId + transaction 去重)]
    NotifyDB --> Outbox[(hp_outbox_events\npayment.wechat-notification.received)]
    Outbox --> Worker[Worker OutboxWorker claim]
    Worker --> Reconcile[PaymentOrderService.reconcileWechatPayment\n金额/状态/version 校验]
    Reconcile --> State[状态机\ncash_pending → cash_paid\n不匹配 → awaiting_confirmation]

    AttemptDB --> Due[到 nextQueryAt]
    Due --> QueryWorker[PaymentReconciliationWorker claim lease]
    QueryWorker --> WxQuery[微信 APIv3 查单\nGET /v3/pay/transactions/out-trade-no/:orderId]
    WxQuery --> Reconcile
    Worker -->|handler 失败| Retry[指数退避重试 outbox]
    QueryWorker -->|provider/版本异常| QueryRetry[更新 nextQueryAt，继续查单]
```

支付状态只能沿 `packages/domain/src/payment-state.ts` 的显式边迁移；前端调起成功、一次 HTTP 200 或未验签的 Provider 结果都不等于业务完成。Worker 只有在完整支付配置、持久化密钥、DB/schema 探针全部通过后才进入 provider 循环。

## 13. 统一错误与旧响应保护

```mermaid
flowchart LR
    Request[HTTP 请求] --> Context[x-request-id / traceId\n幂等键受限]
    Context --> AuthCheck{公开入口或 Bearer 有效?}
    AuthCheck -->|否| E401[401 unauthorized]
    AuthCheck -->|是| Schema[TypeBox body/query/headers 校验]
    Schema -->|失败| E400[400 validation/parse]
    Schema --> Service[service 运行时二次校验]
    Service --> Domain[domain / repository / adapter]
    Domain --> Result{结果}
    Result -->|依赖未注入| E503[503 dependency-not-configured]
    Result -->|Provider 暂时故障| E503b[503 provider-temporarily-unavailable]
    Result -->|Provider 结果非法| E502[502 provider-response-invalid]
    Result -->|业务资源不存在| E404[404/not-found 或业务安全错误]
    Result -->|并发/版本/租约冲突| E409[409 conflict]
    Result -->|成功| Success[success=true + data]
    E401 --> Client[小程序 api-client 映射安全中文文案]
    E400 --> Client
    E503 --> Client
    E503b --> Client
    E502 --> Client
    E404 --> Client
    E409 --> Client
    Success --> Client
    Client --> Guard[页面 request guard + session generation\n决定是否允许回写]
    Guard -->|当前请求有效| Render[渲染最新读模型]
    Guard -->|旧页面/账号/患者/代际| Drop[丢弃结果，不污染新页面]
```

保护规则贯穿各层：HTTP 层不静默吞掉未知字段，service 不依赖 TypeScript 类型作为运行时事实，adapter 白名单投影 Provider 响应，页面不把旧患者/旧账号响应写回当前页面，错误文案不直接展示 Provider 原文。

## 14. 当前页面和 API 能力矩阵

| 用户入口 / 动作 | 实际调用 | 当前状态 | 关键边界 |
| --- | --- | --- | --- |
| 首页打开 | `GET /health/live`；有缓存 token 时 `GET /me`、`GET /patients` | 已实现 | live 不等于 ready；恢复失败清空展示态 |
| 微信登录 | `POST /auth/wechat` → 微信 `code2session` → Redis session | 已实现但需真实配置/真机验收 | 小程序只提交 code；provider secret 不出服务端 |
| 新增/更换就诊人 | `GET /patients`、`POST /patients/sync` | 已实现边界 | operation ledger、租约、完整快照、临床映射 |
| 预约科室 | `GET /appointments/departments` → 众阳 AMC | 只读已实现 | 服务端最多未来 7 天；无写入 |
| 预约排班 | `GET /appointments/schedules` → 众阳 AMC | 只读已实现 | 生成 opaque `scheduleId`；排班快照为未来前置事实 |
| 点击号源下单 | 无真实写入请求 | 未开放 | 页面 Toast“预约下单功能迁移中” |
| 我的挂号 | `GET /appointments/records` → 众阳预约记录 | 只读已实现 | 过去/未来 90 天窗口 |
| 爽约记录 | 同一 `GET /appointments/records` | 只读已实现 | 仅过去 90 天；不是另一个 Provider endpoint |
| 报告目录 | `GET /reports` → LIS/PACS/ECG 三路目录 | 只读已实现 | 最近 30 天；三路聚合整批校验 |
| 检验详情 | `GET /reports/:reportId` → 短期引用 → LIS detail | 条件开放 | 详情 gate、引用 TTL、owner+patient+reportId 三重绑定 |
| 云影像/分享/复诊 | 无真实接口 | 未开放 | 详情页只显示迁移提示 |
| 门诊费用 | `GET /payments/outpatient/records` → 众阳费用只读 | 只读已实现 | 最近 30 天、unpaid/paid；不调支付 |
| 普通资料读取 | `GET /me/profile` | 已实现 | canonical read model |
| 普通资料保存 | `PUT /me/profile` | 已实现 | version 乐观并发控制；未知字段拒绝 |
| 微信支付订单/预支付 | `/payments/orders*`、`/wechat-prepay` | 代码存在、默认关闭 | quote 金额、幂等、APIv3 签名/验签、通知闭环 |
| 微信支付通知 | `POST /payments/wechat/notifications` | 代码存在、默认关闭 | 验签、解密、白名单、去重、outbox |
| 支付补偿 worker | outbox + 查单 | 代码存在、默认 inactive | 完整配置/DB/schema/密钥 gate |
| 健康百科 | `apps/api/src/modules/knowledge` 文件存在 | 当前不可达 | `app.ts` 未挂载 module，不能写成公共 API 已开放 |
| 智能客服/导诊/互联网医院 | 页面入口或迁移提示 | 未迁移/静态 | 不把 UI 占位当作后端能力 |
| 院内导航 | 本地地图 + `wx.previewImage` | 静态已实现 | 无实时路线、楼层定位或导航 API |
| 意见反馈 | 静态问题 + 电话拨号 | 无在线工单 | 点击反馈只 Toast，不代表已提交 |

## 15. 源码索引

| 层 | 关键入口 |
| --- | --- |
| 小程序页面 | [`apps/miniprogram/src/app.json`](../../apps/miniprogram/src/app.json)、[`pages/index/index.ts`](../../apps/miniprogram/src/pages/index/index.ts)、[`services/api-client.ts`](../../apps/miniprogram/src/services/api-client.ts)、[`services/session-service.ts`](../../apps/miniprogram/src/services/session-service.ts)、[`services/dashboard-service.ts`](../../apps/miniprogram/src/services/dashboard-service.ts) |
| API 组合根 | [`apps/api/src/app.ts`](../../apps/api/src/app.ts)、[`apps/api/src/application.ts`](../../apps/api/src/application.ts)、[`apps/api/src/index.ts`](../../apps/api/src/index.ts) |
| API 路由 | [`apps/api/src/modules/auth/index.ts`](../../apps/api/src/modules/auth/index.ts)、[`patients/index.ts`](../../apps/api/src/modules/patients/index.ts)、[`appointments/index.ts`](../../apps/api/src/modules/appointments/index.ts)、[`reports/index.ts`](../../apps/api/src/modules/reports/index.ts)、[`outpatient-payments/index.ts`](../../apps/api/src/modules/outpatient-payments/index.ts)、[`payments/index.ts`](../../apps/api/src/modules/payments/index.ts)、[`profile/index.ts`](../../apps/api/src/modules/profile/index.ts) |
| 业务 service | `apps/api/src/modules/*/service.ts`；门诊费用 service 与 route 同在 `outpatient-payments/index.ts` |
| 外部适配器 | [`packages/adapters/src/wechat-identity.ts`](../../packages/adapters/src/wechat-identity.ts)、[`wechat-pay.ts`](../../packages/adapters/src/wechat-pay.ts)、[`zhongyang-patients.ts`](../../packages/adapters/src/zhongyang-patients.ts)、[`zhongyang-appointments.ts`](../../packages/adapters/src/zhongyang-appointments.ts)、[`zhongyang-reports.ts`](../../packages/adapters/src/zhongyang-reports.ts)、[`zhongyang-outpatient-payments.ts`](../../packages/adapters/src/zhongyang-outpatient-payments.ts) |
| 持久化 | [`packages/persistence/src/runtime.ts`](../../packages/persistence/src/runtime.ts)、[`mysql-repositories.ts`](../../packages/persistence/src/mysql-repositories.ts)、[`redis-session.ts`](../../packages/persistence/src/redis-session.ts)、[`migrations/`](../../packages/persistence/migrations/) |
| Worker | [`apps/worker/src/runtime.ts`](../../apps/worker/src/runtime.ts)、[`outbox-worker.ts`](../../apps/worker/src/outbox-worker.ts)、[`payment-reconciliation-worker.ts`](../../apps/worker/src/payment-reconciliation-worker.ts)、[`wechat-payment-notification-handler.ts`](../../apps/worker/src/wechat-payment-notification-handler.ts) |
| 运行边界 | [`infra/nginx/test-hp.meiyi.pro.conf.example`](../../infra/nginx/test-hp.meiyi.pro.conf.example)、[`README.md`](../../README.md)、[`docs/migration/api-matrix.md`](../migration/api-matrix.md) |
