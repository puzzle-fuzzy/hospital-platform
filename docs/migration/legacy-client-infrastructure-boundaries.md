# 旧端非页面业务逻辑迁移边界

> 盘点基准：2026-08-16。旧端来源为 `G:\\fuck\\hospital\\hospital-app\\src`，新端来源为
> `E:\\__Super_Core__\\hospital-platform\\apps\\miniprogram`。
> 本文专门记录页面清单之外的请求封装、状态仓储、WebSocket、复用组件和静态业务配置。
> 页面数量完整不等于这些逻辑已经迁移。

## 1. 盘点结论

旧端有 64 个生产页面文件，但业务行为还分散在以下非页面层：

```text
请求封装 -> 直接决定 token 去向、错误处理和日志内容
状态仓储 -> 持久化用户身份、患者 ID、卡号和身份证字段
WebSocket -> 通过 URL/query 携带 token 与 patId，并自行重连
复用组件 -> 承载自测评分、随访问卷和院区/患者选择逻辑
静态配置 -> 承载页面入口、医疗题目分值、科室定位和外部图片地址
```

这些内容不能按“前端工具代码”直接复制到原生小程序。新端只保留平台会话、内部 opaque
`patientId` 和已注册的 Hospital API；provider 标识、身份证、openid/unionid、金额和临床结论
必须由服务端或版本化业务域掌握。

## 2. 请求与实时通道

| 旧来源 | 实际行为 | 新端状态 | 正确迁移边界 |
| --- | --- | --- | --- |
| `src/api/http.ts` | 给旧 API 自动附加 Bearer；按旧 `{code,msg,data}` 判断成功；401 后清理状态并跳转不存在/未登记的登录页 | 已由新 `api-client`/`session-service` 形成安全子集 | 只保留平台 API、统一错误码和一次重试；不能根据英文 message 或旧 `code=0` 推断业务成功 |
| `src/api/httpZy.ts` | 直接访问 `VITE_ZHONGYI_BASE_API`；把平台 Bearer 带给众阳；记录请求参数和响应 body；全局弹窗处理 provider 业务错误 | 未迁移，且被架构审计禁止进入新小程序 | 所有 provider 调用必须位于服务端 adapter；日志只保留操作名、requestId、provider request id、状态码和可重试性 |
| `src/api/ws.ts` | 以 `VITE_APP_WS_API` 组装 WebSocket；query 中携带 `token` 和 `patId`；客户端自行重连 5 次 | 未迁移；新 API 没有患者端 WebSocket 路由 | 先取得消息类型、鉴权握手、owner/患者上下文、心跳、断线补偿和幂等协议；不能把 token 或 provider 患者号放进 URL |
| `src/api/modules/companion.ts` | 陪诊历史走旧 API，队列位置另有直连 provider 路径 | 未迁移 | AI/陪诊会话和实时队列必须分别定义 contract；队列位置不能由客户端提交 dept/patId 直接查询 |

旧 `httpZy` 的日志虽然刻意不打印 Authorization 的实际值，但仍会序列化业务参数和完整响应；
这些内容可能包含姓名、身份证、卡号、provider 患者号、金额或医保字段。新端的 Pino 脱敏规则
不能被理解为允许小程序继续把原始报文打印到控制台。

## 3. 会话和患者状态

| 旧来源 | 旧端持久化/读取内容 | 风险 | 新端处理 |
| --- | --- | --- | --- |
| `src/stores/user.ts` | Pinia 持久化 `userInfo`、access token、refresh token | 用户对象可能包含 openid/unionid、实名字段和旧端可直接使用的身份信息 | 由 `session-service` 管理平台 opaque 会话；小程序不解析身份、不持久化 provider 凭证 |
| `src/stores/patient.ts` | 持久化 `selCard`、`patId`、`patCardNo`、`medicalCardNo`、`idCardNo`、`thirdPatientId` 等任意字段 | 客户端缓存同时混合目录 ID、临床 ID、卡号和身份证；不同业务会把同一字段当成不同 provider 标识 | 只保存服务端返回的 opaque `patientId`；业务页面每次按当前 owner 重新解析用途映射 |
| `src/utils/index.ts` | 通过 unionId 获取患者列表、从缓存选择患者、拼接任意 provider proxy URL | 把微信身份、provider 患者目录和客户端选择耦合；`proxyForward` 形成万能转发入口 | 新端禁止客户端提交 unionId、provider 患者号或任意 URL；患者列表由 `/api/v2/patients` 返回 |
| `src/components/health/patient-hospital-selector.vue` | 在多个页面中按旧 `patId`/卡号选择患者和院区，显示 provider ID | 选择结果会被不同模块解释为不同患者上下文，且可能展示内部标识 | 拆为患者选择、机构/院区选择两个独立 contract；选择结果使用 opaque ID，owner 和用途由服务端校验 |

患者状态不能用本地缓存作为业务事实：缓存可以作为上次选择的 UI 提示，但目录失效、切换账号、
服务端撤销关系和 provider 映射变化时，必须以当前会话下的服务端读模型为准。

## 4. 复用组件中的医疗和业务规则

| 旧来源 | 承载的逻辑 | 当前状态 | 迁移门禁 |
| --- | --- | --- | --- |
| `components/health/SelfTestEngine.vue` | 单选/填空题渲染、答案收集、跳题和提交 payload | 未迁移 | 组件只是渲染器；题目、选项、分值、跳转和结果解释必须来自版本化题库与临床审核 |
| `jsonData/selfTestConfig.ts` | BMI、血压、慢病等题目、分值和部分结果阈值 | 未迁移 | 不能把 TypeScript 常量当医疗事实；先完成内容版本、审核人、适用人群、免责声明、下线和回滚 |
| `components/health/discharge-followup-form*.vue` | 按心内、神经、日间等场景渲染出院随访表单 | 未迁移 | 表单版本必须绑定出院事件/随访任务、患者授权、医护读取、提交幂等和撤回；不能复制旧 JSON 数组覆盖逻辑 |
| `components/form/formItem.vue` | 旧患者新增/资料表单的通用展示与校验 | 未迁移 | 新端按 profile、实名资料、患者绑定拆开；身份证/手机号校验不能绕过服务端身份核验 |
| `components/account/FollowPrompt.vue` | 关注公众号提示弹窗 | 未迁移 | 静态提示不等于关注事实；二维码、目标主体、域名和关注状态必须单独确认 |

## 5. 静态配置、导航和资源

| 旧来源 | 实际作用 | 新端状态 | 处理规则 |
| --- | --- | --- | --- |
| `layouts/fg-tabbar/tabbarList.ts` | 四个底部 Tab 指向首页、导诊、互联网医院和我的 | 新端已按原视觉资产实现底栏；只有已注册页面允许真实跳转 | 未迁移 Tab 只能显示迁移状态，不能注册不存在的页面或恢复外部 WebView |
| `jsonData/homeNavData.json`、`userNavData.json` | 首页/我的页服务入口、旧页面路径和外部 OSS 图标 | 部分静态视觉资产已复制 | 图标可作为视觉资产复用；入口路径必须由新 `app.json` 和 contract 状态驱动，不能照抄旧 URL |
| `jsonData/department.json`、`departmentLocation.json` | 科室名称、院内定位和预约历史本地展示映射 | 静态院内地图已迁移，动态定位未迁移 | 静态地图与实时医院/科室目录分离；名称、院区和坐标版本须有数据 owner |
| `static/tabbar/*`、`static/images/*`、外部 OSS 图片 | Tab 图标、地图、空态、报告和宣传素材 | 新端只迁移已核对的本地资源 | 生产页面不得依赖未审核的外部图片 URL；图片资源要有来源、版权、缓存和失效策略 |
| `pagesB/patient/patientChange.bak2` | 旧页面备份文件 | 不纳入生产页面盘点 | 备份不能作为实现依据，也不能加入新小程序构建 |

## 6. 新端不得出现的兼容残留

以下搜索结果一旦出现在 `apps/miniprogram/src` 或编译产物中，应视为迁移回退：

- `VITE_ZHONGYI_BASE_API`、`VITE_APP_WS_API` 或 provider 域名；
- `openid`、`unionid`、`session_key`、`thirdPatientId`、`patId`、完整卡号/身份证作为页面输入或缓存字段；
- `proxy/forward`、任意 `fullUrl` WebView、把 token 放入 query 的 WebSocket；
- 旧 `/system`、`/common`、`/knowledge`、`/intelligent`、`/convenience` 路径的直连调用；
- 将题目分值、风险分级、支付状态或 HIS 状态写死在小程序常量中。

现有架构审计已覆盖 provider URL、provider 患者 ID、报告 ID 和支付入口；新增实时通道、临床
内容或静态入口时，必须同步增加同类规则和回归测试。

## 7. 迁移顺序与验收

1. 先完成当前只读纵向切片的 provider、公网、真机和日志证据；不因发现旧端 helper 而扩大功能面。
2. 新 provider 文档到达后，先登记 [`../provider-document-intake.md`](../provider-document-intake.md)，
   再决定是患者读模型、实时会话、临床内容还是外部入口；文档缺失的字段不进入公共 contract。
3. 若迁移 WebSocket，必须先用服务端握手/短期会话引用替代 URL token，并提供断线后最终事实查询；
   单纯“连接成功”不能代表消息已送达或业务状态已完成。
4. 若迁移自测/随访，必须先完成临床审核和版本化持久化，再实现原生页面；不能先复制旧组件再补规则。
5. 若迁移导航/入口配置，必须校验目标页面是否在 `app.json` 注册、域名是否在微信白名单、资源是否来自受控来源。

验收证据至少包含：源码扫描无直连 provider、无敏感缓存、无 token query；页面入口与 `app.json` 一致；
旧服务和旧小程序继续可用；Pino 日志能按 `requestId/traceId` 定位且无原始 body；真实 provider 或临床审核
证据缺失时，状态保持“未迁移/待契约”，不能标记为兼容完成。
