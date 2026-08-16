# 个人中心与外部入口迁移边界审计

> 盘点基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app`，旧服务来源为
> `G:\\fuck\\hospital`。本文记录旧页面真实行为和新端迁移门禁；不代表个人资料、绑卡、签名、WebView、
> 互联网医院或消息订阅已经迁移。

## 1. 旧页面和真实接口

| 旧页面/入口 | 旧端实际行为 | 旧接口/外部依赖 | 新端结论 |
| --- | --- | --- | --- |
| `pagesB/user/edit_profile.vue` | 读取并修改昵称、性别、年龄、邮箱、头像 | `GET /system/user/current/info`、`PUT /system/user/current/info/update`、`POST /system/user/current/avatar/upload` | 个人资料必须拆分普通资料、实名资料和头像资源；旧请求允许 `openid`、`unionid`、身份证等字段，不能原样迁移 |
| `pagesB/user/feedback.vue` | 展示热点问题和客服电话；点击“意见反馈”只弹 Toast，未提交反馈 | 新端已迁移为静态帮助页；无真实反馈写入接口，旧页面硬编码客服电话 | 只能标记为“反馈帮助页部分迁移”；真实意见写入、客服工单、电话号码和工作时间应由受控配置提供 |
| `pagesB/user/miss_appointment.vue` | 查询预约记录后只过滤 `status === 4` | 预约记录 provider 查询 | 只能作为预约记录的筛选视图；不能把列表过滤结果当独立爽约事实 |
| `pagesB/user/my_consultation.vue` | 查询陪诊历史；账单、病历、住院预约、就诊码按钮均只弹 Toast | `GET /intelligent/treatment_companion/history`；旧代码另有直连队列位置接口 | 需要独立 AI/陪诊会话、患者上下文和二维码 contract；当前不迁移 |
| `pagesB/user/subscription_message.vue` | 本地维护开关、搜索和折叠状态，点击确定直接显示“设置已保存” | 没有 `wx.requestSubscribeMessage`，没有服务端保存 | 当前不是微信订阅能力；必须取得模板、授权时机、业务事件和撤回规则后重做 |
| `pagesB/patient/patientAdd.vue` | 采集姓名、手机号、身份证；查询旧档案，存在则绑卡，否则建档后绑卡 | `GET /msun-middle-aggregate-patient/v1/patInfosFind`、`POST /.../patients`、`POST /.../patCards`，并修改旧用户资料 | 必须改为服务端受控的患者绑定命令；查询失败不能静默进入建档，需防重复和人工核验 |
| `pagesB/patient/patientChange.vue` | 读取旧患者列表，切换时再查档案并把旧 `patId` 写入缓存 | 旧患者查询与 `patInfosFind` | 新端安全选择页已替换；新增/绑卡仍未开放，不能让客户端保存 provider 患者号 |
| `pagesB/patient/agreement.vue` | 展示静态条款；同意只 Toast 后跳首页，不记录版本/主体/时间 | 无同意记录接口 | 必须有版本化法律文本、同意事实、撤回和重新同意策略 |
| `pagesB/patient/patient_signature.vue` | 使用本地/缓存患者列表，携带患者 ID/姓名跳转固定签名小程序 | `navigateToMiniProgram`，固定目标 AppID `wx0b76c9904392518f` | 需要目标小程序、字段、受众、回跳和签名结果回调 contract；不能透传内部或 provider 患者标识 |
| `pagesB/account/follow.vue` | 展示关注公众号的静态宣传页 | 新端已迁移为 `pages/official-account`，图标改为本地受控资源 | 仅可作为静态内容；公众号二维码/关注状态/订阅消息需要单独确认，不把静态页面当授权事实 |
| `pagesB/hospital/hospitalList.vue` | 页面硬编码一个医院和地址，点击卡片进入挂号；“查看路线”没有真实路线逻辑 | 无医院列表 API；新端已迁移为静态 `pages/hospital-list` | 静态卡片只作为预约前置展示；动态医院列表、机构选择和路线必须独立 contract，不能把静态配置扩展成动态能力 |
| `pagesB/hospital/bloodAppointment.vue` | 患者姓名/年龄和院区均为硬编码，始终展示“无可预约项目” | 无采血 API；空态图片来自外部 OSS | 不能展示硬编码患者；等待采血服务 contract、院区和号源状态 |
| `pagesB/health/webview.vue`、`pages/hospital/hospital.vue` | 根据 `path` 或完整 URL 打开外部 WebView | `POST /system/auth/ticket`；外部 AI/互联网医院 URL | 必须使用固定 audience/allowlist/短期会话；不能接受任意完整 URL 或把平台 token 交给外部页面 |

## 2. 个人资料和患者绑定的关键风险

### 2.1 普通资料不能携带身份凭证

旧 `UpdateUserInfoParams` 同时允许 `username`、姓名、手机号、邮箱、性别、头像、`openid`、`unionid`、身份证和实名姓名。
旧 `patientAdd.vue` 会把 `openid`、身份证、实名姓名和手机号一起发到“更新当前用户资料”接口。新端必须把字段分成不同权限域：

- 普通展示资料：昵称、性别、年龄、邮箱；
- 实名资料：真实姓名、证件类型、证件号，只允许服务端在明确的实名/患者绑定流程写入；
- 微信身份：openid/unionid/provider subject 只由服务端 code2session 产生，客户端永远不能提交或修改；
- 头像资源：客户端上传临时文件，服务端完成 MIME、大小、图片内容安全、owner 和访问 TTL 校验后返回受控资源引用。

旧头像上传直接返回 `file_url`，新端不能默认信任任意返回 URL，也不能让日志记录 multipart body、临时路径或图片元数据中的敏感信息。

### 2.2 新增就诊人的状态机必须可恢复

旧页面的“查询档案失败后继续建档”会把网络异常、provider 暂时不可用和“确实没有档案”混成同一个分支，
可能产生重复档案。新端应将命令拆成服务端状态机：

```text
requested -> identity_verified -> archive_lookup
                                  |             |
                                  v             v
                             existing_found   not_found
                                  |             |
                                  v             v
                              bind_pending  create_pending
                                  |             |
                                  v             v
                                bound <----- bind_pending
```

`archive_lookup` 超时或 provider 错误必须进入 `awaiting_confirmation`，不能自动走 `create_pending`。
`create_pending` 和 `bind_pending` 必须使用 owner + 证件指纹 + 幂等键约束，并在超时后先查询最终事实。
身份证明正文不进入日志；可使用不可逆指纹或内部命令 ID 关联排障。

旧页面还有三个必须修正的事实：

1. “使用条款和隐私政策”复选框默认是 `true`，提交函数没有强制检查，未同意也可能继续提交；
2. 编辑模式只修改标题，实际回填和更新患者数据是 TODO；
3. 查询档案成功后只要得到 `patId` 就直接绑卡，没有公开的 owner、姓名/证件一致性和重复关系验证。

## 3. 法律文本、签名和跨小程序

### 3.1 协议同意

静态页面上的“同意”不是可审计授权。新端至少要存储：文本版本、用途、主体内部用户 ID、同意时间、客户端来源、
必要时的患者关系和撤回时间。协议更新后，只有影响当前业务用途的版本才要求重新同意；撤回后相关能力必须进入明确的拒绝状态。

### 3.2 患者签名

旧签名页面使用本地示例患者作为回退，并通过 `navigateToMiniProgram.extraData` 发送患者 ID 和姓名。
新端必须改成：

- 由服务端按当前 owner 生成短期、一次性、限定受众的 `signatureSessionRef`；
- 目标小程序只收到不可推导患者身份的引用和必要业务上下文；
- 回跳后服务端验签/验回调并落库，不能由小程序前端把“已签名”当成功；
- 目标 AppID、环境版本、页面路径、回跳字段和失败状态必须来自已确认的跨小程序协议。

在这些资料到达前，入口只能显示迁移提示，不允许带真实患者 ID 跳转。

## 4. 外部 WebView 和票据安全

旧服务 `/system/auth/ticket` 的实现是：读取请求的 `Authorization`，在 Redis 中以 `ticket:{ticket}` 保存原始 access token，
TTL 60 秒；`/system/auth/ticket/verify` 读取后删除票据并把 `access_token` 返回给外部页面。它比把 JWT 直接拼在 URL 中好一点，
但仍然存在受众混淆和凭证扩散问题：票据可被错误页面消费，外部页面最终拿到了平台 token，且旧接口没有绑定目标 origin、scope、
业务资源或一次性回调上下文。

新端不得照搬这个 token exchange。正确边界应是：

1. 页面入口只接受服务端预先登记的 `resourceKey`，不接受任意 `fullUrl`；
2. 服务端为固定 audience 生成短期、一次性、最小 scope 的会话引用，引用不承载 JWT；
3. 外部服务使用后端到后端校验或受控回调确认身份，不向浏览器/WebView 返回平台 access token；
4. URL、域名、证书、路径和 query 参数使用 allowlist；不允许以 `decodeURIComponent(fullUrl)` 绕过检查；
5. 票据消费、过期、重放、错误 audience 和回调结果都必须落低敏审计事件。

互联网医院固定外部 URL、AI 导诊 URL、微信医保小程序和签名小程序属于不同 audience，不能共享同一种票据或配置。

## 5. 其他入口的正确迁移边界

### 爽约记录

旧端从预约记录接口拉取全部记录，再在小程序本地筛 `status=4`，同时使用设备本地时间格式化日期。新端已经提供安全的派生视图：
小程序只筛选服务端预约历史读模型返回的 `missed` 状态，使用中国标准时间近 90 天窗口，并支持重新选择就诊人；不能从空列表推导“没有爽约”，
也不能把 provider 未知状态映射为爽约。该页面目前只有代码级闭环，真实 provider、公网 API 和真机证据仍待保存。

### 意见反馈

旧页面没有真实提交功能，只有客服电话和 FAQ 静态文案。新端若要做反馈，应独立定义：内容长度和类型、附件安全、限流、提交幂等、
处理状态、客服/管理端可见性、用户撤回和保留期限。客服电话不得继续硬编码在小程序包内，变更应可审计。

### 消息订阅

旧页面的开关只改变内存状态，重新进入页面不会从微信或服务端恢复；“确定修改”也没有调用微信授权 API。真实迁移必须区分：
微信模板授权事实、业务事件订阅关系、患者/家庭成员范围、发送结果、失败重试和撤销。没有模板 ID、场景和业务事件 contract 时，
页面只能显示建设中，不能提示“设置已保存”。

### 互联网医院、医院列表和采血预约

- 当前已迁移的医院列表只是核对过的单院区静态配置，不产生 server event，也不代表机构服务已完成；若扩展为动态医院列表，必须有机构 ID、可用服务、院区、地址、路线来源和版本；
- 采血预约必须区分项目、院区、号源、预约状态、取消规则和患者上下文；不能保留硬编码“张三/18”；
- 互联网医院 WebView 必须独立外部服务协议、域名 allowlist、登录态隔离和失败回退；
- 静态院内地图和实时院内导航是两种能力，不能用前者掩盖后者未迁移。

## 6. 迁移顺序与验收门禁

1. 先把当前新端“我的”页面未开放入口标记为迁移提示，避免出现空页面或伪成功。
2. 先做普通个人资料只读，再做普通字段更新；实名资料、头像、患者绑定、签名分别使用独立 contract。
3. 患者新增/绑卡必须先完成 owner、重复、超时查询和协议同意事实，再开放真实写入；不能直接复用旧 `patients`/`patCards`。
4. 爽约记录只能在预约历史读模型完成真实状态映射后作为筛选视图开放；当前实现仍不得扩展为独立爽约写入、申诉或统计事实。
5. 意见反馈、消息订阅、跨小程序签名、互联网医院和 AI WebView 分别完成 audience、allowlist、回调和审计后再开放。
6. 医院列表、采血预约和住院服务继续等待各自 provider 文档，不与预约挂号目录共用未经确认的字段。

验收必须覆盖：未同意协议、非 owner 患者、重复绑定、provider 超时、命令重试、票据重放、错误 audience、任意 URL、
微信模板未授权、外部小程序回跳失败、真机域名校验和旧服务保持可用。单元测试不能替代公网 HTTPS、微信真机和外部服务回调证据。

在新的 provider、跨小程序、法律文本和微信订阅资料到达前，以上入口保持未注册/迁移提示，旧服务继续承担原能力。
