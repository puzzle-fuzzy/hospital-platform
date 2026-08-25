# 就诊与互联网医院迁移边界审计（2026-08-25）

## 结论

本轮只完成旧端行为取证、业务边界冻结和新端防误接入门禁，没有把旧接口、旧 WebSocket 或旧外部 URL 复制到新项目。

两个入口虽然都位于旧端四个顶层 Tab 中，但它们不是同一类能力：

- `就诊` 是患者范围的实时临床动态聚合，包含今日 WebSocket 消息、未来/历史预约读取和叫号队列位置查询；
- `互联网医院` 是外部服务入口，依赖独立域名、外部登录态、主体授权、回跳和失败语义；
- 预约历史、电子导诊单、互联网医院和智能客服不能因为页面名称相近就共用患者字段、票据或读模型。

当前新端保留四个正式主 Tab。就诊页已经接入未来/历史预约摘要的只读子集，仍禁止未经 contract 证明的副作用、外部跳转和实时数据展示。

## 1. 旧端事实证据

审计范围为旧项目 `G:\\fuck\\hospital\\hospital-app`，本轮只读检查以下文件：

- `src/pages/consult/consult.vue`
- `src/api/modules/companion.ts`
- `src/api/modules/ZY.ts`
- `src/api/ws.ts`
- `src/pages/hospital/hospital.vue`
- `src/pagesB/health/webview.vue`

### 1.1 “就诊”页面不是单一预约历史页

旧 `pages/consult/consult.vue` 展示三个业务标签：`今日就诊`、`未来就诊`、`历史就诊`。页面会从旧患者缓存读取 `patId`、`thirdPatientId` 和医疗卡字段，并在界面展示就诊 ID。

当标签为“今日就诊”时，旧端会：

1. 关闭旧 WebSocket 后延迟清空消息；
2. 连接 `VITE_APP_WS_API + /webSocket/online/message`；
3. 将 `token` 和 `patId` 放入连接查询参数，同时发送 `Authorization` 请求头；
4. 按旧消息中的 `messages` 数组拼接科室、科室 ID、消息文本和消息来源；
5. 对“叫号通知”再调用队列位置接口，并按消息索引回填队列位置。

当标签为“未来就诊”或“历史就诊”时，旧端通过 `companion.ts` 调用：

```text
GET /msun-middle-business-appointment-server/v1/appointment-infos/{patId}
```

未来范围默认是当前日至未来三个月，历史范围默认是过去三个月；旧端还在客户端把状态数值和 `sourceType` 数值翻译成中文。该接口返回的是预约/号源事实，不是实时就诊事件。

队列位置则另走旧端直连的：

```text
GET {VITE_ZHONGYI_BASE_API}/shift-scheduling/queue-position/{deptId}/{patId}
```

这使旧页面同时持有平台会话、provider 患者 ID、provider 科室 ID、WebSocket 消息结构和队列查询结构，不能作为新端的安全 API 设计直接复用。

### 1.2 旧 WebSocket 生命周期存在迁移风险

旧 `src/api/ws.ts` 使用模块级 socket、模块级回调和全局重连计数。旧页面在 `onShow` 中重新加载患者并重新加载数据，`onHide` 关闭逻辑被注释，只有切换标签或组件卸载时才明确关闭连接。

新端如果直接复制这套实现，至少会产生以下问题：

- 页面实例之间可能共享错误的 socket、回调或患者上下文；
- `patId` 和 token 进入 URL，日志、代理和第三方接入层可能记录敏感关联信息；
- 断线重连没有会话代际、患者 owner、订阅范围和页面存活证明；
- 消息没有版本、事件 ID、游标、去重和补偿读取协议；
- 连接错误、空消息和 provider 暂不可用可能被页面显示成“没有就诊记录”；
- 队列位置与消息之间没有服务端确认的关联键，客户端无法证明它属于当前患者和当前就诊事件。

### 1.3 “互联网医院”是外部 WebView，不是新端页面

旧 `pages/hospital/hospital.vue` 直接打开固定外部地址：

```text
https://cx.o2o.bailingjk.net/wechat/#/bluser/userCard/index?publicNoCode=gzh-048400_0001
```

页面在每次 `onShow` 时递增 key 并追加时间戳，强制外部页面重新加载。旧实现没有在当前页面中证明新端主体、audience、短期登录引用、外部回调、退出、失败或撤销语义。

旧 `pagesB/health/webview.vue` 还支持由路由传入 `path` 或完整 `url`，然后调用旧 `/system/auth/ticket` 并把 ticket 拼到最终 URL。该页面把智能客服、智能导诊、患者绑定等不同 audience 混在一个通用 URL 代理中，不能迁移为新端通用能力。

## 2. 新端当前状态

新端对应文件为：

- `apps/miniprogram/src/pages/consult/consult.ts`
- `apps/miniprogram/src/pages/consult/consult.wxml`
- `apps/miniprogram/src/pages/hospital/hospital.ts`
- `apps/miniprogram/src/pages/hospital/hospital.wxml`

当前实现分成两类边界：

1. 在 `app.json.tabBar.list` 中保留原有四个主入口的位置；
2. 就诊页的未来/历史标签读取已存在的 owner-scoped 预约记录公共读模型：
   - 服务端范围使用“全部挂号”只读查询，不把在线结果复制为全部结果；
   - 使用医院中国标准时间的 `workDate` 进行客户端分组；
   - 当天记录明确排除，不进入未来/历史列表，避免把预约摘要显示成实时就诊；
   - 页面只展示科室、医生、地点、日期、时段、序号和服务端归一化状态；
   - 加载、空结果和错误共用固定状态外壳，记录过多时按每次 8 条分批展开，不一次性创建全部卡片。
3. 今日标签仍用固定高度状态外壳展示“实时就诊 contract 尚未完成”，不调用旧 WebSocket、不读取 provider 患者号、不直连队列接口、不打开外部 WebView、不接受任意 URL。

这不是两个旧页面的全部业务完成，而是就诊页可验证只读子集的迁移。实时就诊和互联网医院仍继续等待各自 contract、服务端实现、公网证据和真机证据。

## 3. “就诊”开放前必须冻结的 contract

以下项目必须由服务端和 provider 文档共同确认；缺一项就保持迁移状态：

| 编号 | 必须确认的事实 | 最低要求 |
| --- | --- | --- |
| C-01 | 事件来源 | 明确 HIS/众阳/平台哪个系统产生事件，事件类型、版本、生产时间和业务日历。 |
| C-02 | 患者上下文 | 只接受平台 opaque `patientId`，服务端根据当前 session owner 映射 provider 患者，不由小程序提交 `patId`。 |
| C-03 | 连接认证 | 明确 WebSocket 握手认证方式；不得把 Bearer token 或 provider 患者号放入 URL。 |
| C-04 | 订阅范围 | 明确当前患者、当前就诊、科室和医院范围，服务端必须拒绝越权订阅。 |
| C-05 | 事件可靠性 | 每条事件必须有 schema version、event ID、发生时间、顺序/游标和去重规则。 |
| C-06 | 断线恢复 | 明确心跳、重连上限、退避、游标补发、会话失效和患者切换时的关闭语义。 |
| C-07 | 队列位置 | 明确队列位置是否属于事件快照、查询接口还是独立服务，并提供患者/就诊/科室关联证明。 |
| C-08 | HTTP 读取 | 明确未来/历史范围、时区、分页/游标、状态枚举、未知状态、空结果和 provider 超时语义。 |
| C-09 | 数据脱敏 | 小程序只接收展示字段；患者 ID、卡号、身份证、provider request 参数不得进入日志和前端 URL。 |
| C-10 | 页面生命周期 | 连接必须绑定页面实例、会话代际、患者选择代际和 `onHide`/`onUnload` 清理结果。 |
| C-11 | 可观测性 | 服务端记录低敏 requestId、session generation、patient context hash、event source 和耗时；禁止记录 token、patId 原文和消息正文。 |
| C-12 | 真机验收 | 至少验证今日无事件、有事件、顺序/去重、断网恢复、会话失效、切换患者和普通业务页返回。 |

在 C-01 至 C-12 完成前，不创建新端 WebSocket 客户端，不把预约历史 API 冒充实时陪诊，不在页面中显示队列位置。

## 4. “互联网医院”开放前必须冻结的 contract

| 编号 | 必须确认的事实 | 最低要求 |
| --- | --- | --- |
| IH-01 | 外部主体和 audience | 明确外部服务主体、医院主体、微信业务主体和票据 audience，互联网医院、AI 导诊、客服、医保小程序不得共用票据。 |
| IH-02 | 资源 allowlist | 服务端固定 resourceKey、origin、path 和 HTTPS 要求；小程序不得接收任意完整 URL。 |
| IH-03 | 短期会话 | 由服务端创建一次性、短 TTL、最小权限引用；不得把平台 JWT、provider token 或身份证信息放入 URL。 |
| IH-04 | 回调与退出 | 明确成功、取消、失败、过期、重复消费、退出登录和返回小程序的结果协议。 |
| IH-05 | 主体授权 | 明确外部服务是否需要微信登录、医院登录、患者关系确认或额外隐私同意，并记录版本化同意事实。 |
| IH-06 | 加载与故障 | 明确白屏、超时、域名校验失败、外部服务拒绝和网络异常的用户文案与重试边界。 |
| IH-07 | 审计 | 记录 resourceKey、audience、引用 ID 哈希、创建/消费/过期结果和 requestId，不记录完整 URL 中的敏感参数。 |
| IH-08 | 域名与真机 | 完成小程序业务域名、TLS、外部页面兼容性、回跳和至少一台真实设备验收。 |

在 IH-01 至 IH-08 完成前，新端不恢复 `web-view`，不复用旧 `/system/auth/ticket`，不接受 `path`/`url` 路由参数，也不把打开外部页面当成登录成功。

## 5. 本轮停止条件和下一步

本轮停止条件已经满足：旧链路事实已记录，新端没有复制危险调用，自动化测试会阻止旧 WebSocket、队列直连、任意外部 WebView 和旧票据入口回归。

下一步按以下顺序推进：

1. 已按 C-08 的现有预约记录公共读模型完成未来/历史只读子集；后续只需补齐真实 Provider、公网日志和真机三层证据，不把该证据扩展成实时事件证据；
2. 从现有众阳文档/服务端 contract 中继续确认 C-01 至 C-07、C-09 至 C-12，未完成前不实现“今日就诊”；
3. 单独收集互联网医院正式入口的 audience、域名和回跳协议，不与 AI/客服 WebView 共用配置；
4. contract 冻结后再设计服务端 adapter、脱敏读模型、日志字段和小程序页面状态机；
5. 取得公网、服务端日志和真机三层配对证据后，才把对应页面从“迁移中”改为“只读已实现”或“外部入口已验收”。

本审计没有修改旧项目、旧服务、服务器、数据库或 Redis。
