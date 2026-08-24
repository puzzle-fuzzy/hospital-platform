# 原生小程序页面迁移台账

> 本文的“页面已注册”只表示它出现在 `apps/miniprogram/src/app.json`，不表示 provider、生产、公网或真机业务已经验收。
> `pnpm migration:audit` 会以 `app.json` 为事实源检查这里是否逐页登记，防止再次出现页面文档、源码和上传包互相脱节。

## 业务状态定义

| 状态 | 严格含义 |
| --- | --- |
| `静态已迁移` | 页面视觉/交互的安全静态子集已存在；不包含外部业务事实。 |
| `只读已实现` | API、服务端 owner 隔离和小程序读取链路已有代码；仍需 provider、公网和真机证据时，不能称为真实完成。 |
| `读写已实现` | API、服务端 owner/version 隔离和小程序读写链路已有代码；仍需真实会话、冲突场景和真机证据时，不能称为真实完成。 |
| `部分迁移` | 页面可展示已确认的只读或静态内容，但写入、支付、外部回写或详情能力明确关闭。 |
| `待 contract` | 旧页面依赖尚未冻结的 provider、HIS、微信能力或外部入口；不得猜字段、拼 URL 或用占位成功响应。 |

## 当前注册页面

| 页面路径 | 当前状态 | 当前真实能力 | 必须保持的业务边界 | 下一步验收/输入 |
| --- | --- | --- | --- | --- |
| `pages/index/index` | `部分迁移` | 首页布局、健康探针、患者读模型、服务入口和底部导航已接入。 | 首页选择的是平台内部 opaque `patientId`；未有患者时不能把微信用户直接当作就诊人；二维码、门诊病历和未迁移服务不能伪造成功。 | 真实微信登录、患者同步、真机视觉与路由验收。 |
| `pages/consult/consult` | `部分迁移` | 旧端“智能陪诊”入口的安全静态说明和迁移状态已接入正式主 Tab；页面不调用旧端 WebSocket 或队列接口。详细旧链路和 C-01 至 C-12 准入条件见 [`consult-and-internet-hospital-boundary-audit-2026-08-25.md`](consult-and-internet-hospital-boundary-audit-2026-08-25.md)。 | 静态说明不代表已经取得叫号、排队、就诊动态或患者临床状态；不能把患者 ID、队列位置或旧端消息字段直接迁入页面。 | 陪诊/叫号 Provider contract、患者与就诊事件映射、实时连接生命周期、断线重连和真机证据。 |
| `pages/hospital/hospital` | `待 contract` | 正式主 Tab 入口已注册，并明确展示互联网医院业务迁移状态。旧端固定 WebView、通用 WebView 和票据边界已完成只读审计，详见 [`consult-and-internet-hospital-boundary-audit-2026-08-25.md`](consult-and-internet-hospital-boundary-audit-2026-08-25.md)。 | 旧端依赖外部 WebView；未冻结 audience、域名 allowlist、短期引用、回调和退出策略前，不加载外部 URL，不把打开页面解释成互联网医院登录或服务成功。 | 外部入口安全 contract、主体授权、短期会话、回调审计、失败/撤回策略和真机证据。 |
| `pages/official-account/official-account` | `静态已迁移` | 公众号通知说明和受控本地图标。 | 打开静态说明页不等于已关注；不能生成伪二维码或把订阅消息开关当作微信授权事实。 | 公众号主体、二维码、关注状态、模板消息文档。 |
| `pages/feedback/feedback` | `静态已迁移` | 热点问题、客服电话和迁移提示。 | 当前不写工单、不承诺客服受理、不把拨号成功当作医院处理结果。 | 工单字段、受理状态、工作时间和审计 contract。 |
| `pages/patient-select/patient-select` | `只读已实现` | owner-scoped 患者列表、选择、刷新和失效选择处理；会话失效或账号切换时清理旧目录；可展示记录与临床可用记录分开标记。 | 页面只保存内部 `patientId`；只有 `clinicalAccess=ready` 才能选择并进入业务页；关系/证件号文案来自服务端规范化读模型；未确认当前 owner 时不能保留上一账号目录；新增家属和绑卡仍关闭。 | 真实账号同步、失效/恢复、真机切换患者证据；新增绑定 provider contract。 |
| `pages/hospital-list/hospital-list` | `静态已迁移` | 旧端单院区卡片、预约前置和受控本地图片。 | 静态单院区不能冒充动态机构目录；路线按钮不能猜坐标；互联网医院 web-view 不从这里伪造。 | 机构/院区目录、坐标路线和外部入口 allowlist。 |
| `pages/appointment-directory/appointment-directory` | `只读已实现` | 科室、日期级联和排班只读目录；本地分批渲染。 | 排班快照只是短期观察事实；点击号源不能创建预约、锁号、收费或显示成功。 | provider 排班/锁号/写入/取消完整 contract，公网和真机只读证据。 |
| `pages/appointment-records/appointment-records` | `只读已实现` | 按当前就诊人读取前后各 90 天预约历史，并翻译服务端的预约、取消、完成、爽约、停诊、替诊和已登记状态；在线范围固定读取渠道 3，全部范围通过独立 `scope=all` 读取渠道 4 并保留取消记录；查询由 dashboard service 的统一构造器生成并覆盖自然日/内部患者校验；页面首批渲染 10 条，本地继续展开；已按旧端恢复全宽就诊人/院区信息行、状态标签、列表背景、预约状态图标和院内导航弹窗；本轮将卡片收敛为科室/状态、医生/院区、日期/时段、号序、操作的旧端层级，并让 loading/错误/空数据复用同一固定状态外壳。当前院区仍是单院区静态展示，不渲染未实现的动态选择入口。布局和差异边界见 [`personal-center-visual-contract.md`](personal-center-visual-contract.md)。 | 本地分批不是 provider 分页；`missed` 只能来自服务端明确状态；页面不自行推断爽约，不展示 provider 订单或支付事实；详情、预问诊、取消、退号和支付仍不能伪造；小程序只能提交 `scope=online|all`，不能透传渠道码。当前候选已完成代码和生产只读核对，但尚未切换线上。 | 先受控发布预约范围候选，再取得当前 release 的真实 provider、公网/真机三层证据；动态院区、取消/退号、详情和预问诊另立 contract。 |
| `pages/missed-appointments/missed-appointments` | `部分迁移` | 从预约历史 `status=missed` 派生的过去 90 天只读筛选页，首批渲染 10 条并支持本地继续展开；“我的”页入口只要求已验证平台会话，缺少患者上下文时留在本页稳定错误态并允许重试；没有患者选择器模块，只有页面内已确认患者卡片上的“更换就诊人”才进入统一选择页；爽约卡片与挂号卡片共用阅读层级，空态只代表已确认患者没有记录。 | 空列表不等于没有历史；未知状态不能变成爽约；本地分批不是 provider 分页；不得通过客户端传入状态制造记录；Provider/网络/持久化错误不能误导成选择患者，也不能自动打开选择模块；显式更换患者时仍须消费统一导航结果，不能把被同步门禁拦截的入口显示成永久加载。 | provider 状态映射和真实账号证据。 |
| `pages/report-directory/report-directory` | `只读已实现` | 近 30 天报告摘要、患者切换和本地分批渲染。 | `reportId` 是服务端 opaque 引用；报告目录不能冒充门诊病历；列表存在不等于详情/附件已授权。 | LIS/PACS/ECG 真实目录、详情、附件短期授权和真机证据。 |
| `pages/report-detail/report-detail` | `部分迁移` | 仅保留已开放的报告详情入口和空态/错误态。 | 只接受服务端生成的 `reportId` 与当前内部 `patientId`；服务端复核 owner + patient + TTL；不能把 provider 报告号、文件 URL 或患者字段放进小程序。 | 真实详情字段白名单、资源 TTL、下载审计和 provider 文档。 |
| `pages/outpatient-payment/outpatient-payment` | `部分迁移` | 按患者读取待缴/已缴门诊费用只读目录，金额仅由服务端展示模型转换；完整结果在页面按 10 条本地分批渲染；顶部提示明确当前仅查询，避免沿用旧端支付/医保引导。 | 本地分批不是 provider 分页；当前点击费用只提示迁移中，不调起微信支付，不做医保授权，不把列表状态当作最终结算。 | 费用详情、微信/医保状态机、回调、查单、退费和 HIS 回写 contract。 |
| `pages/profile/profile` | `读写已实现` | 普通昵称、性别、年龄、邮箱资料及版本并发更新；会话失效或账号切换时清理旧资料展示并回到未加载态。 | 普通资料不等于实名资料、微信身份、手机号或患者档案；409 冲突不能静默覆盖；未确认当前会话时不能保留上一账号资料。代码读写完成不等于真实业务验收完成。 | 真实微信会话读写、首次更新、409 真机验收；头像/实名另立 contract。 |
| `pages/my/my` | `部分迁移` | 资料、患者选择、预约历史、爽约和门诊费用入口；保留旧端电子导诊单、智能客服、我的问诊、我的医生和医保电子凭证入口的视觉位置；背景、头像占位、三组功能分类、图标顺序和固定底部导航已按旧端资源复刻，详见 [`personal-center-visual-contract.md`](personal-center-visual-contract.md)。 | “我的”页只编排已有能力；上述未开放入口只显示能力级迁移/授权提示，不直连旧 WebView、医生关系接口或医保小程序。门诊病历/咨询/住院等必须明确显示未开放。 | 逐入口公网/真机验收；补齐患者中心扩展 contract。 |
| `pages/hospital-navigation/hospital-navigation` | `静态已迁移` | 旧端静态地图、背景色、`aspectFit` 和预览。 | 静态地图不等于实时定位、楼层导航或路线规划；不得返回虚假的距离/路线。 | 动态楼层、科室坐标、路线服务和数据版本 contract。 |

## 当前代码和文档的结论

1. 目前共注册 16 个页面；注册表、页面 TypeScript 源码、构建生成的 JavaScript 和本台账必须同时存在。
2. 当前安全可继续推进的是“真实只读 provider → 服务端脱敏/owner 隔离 → 公网 → 真机”闭环；预约写入、病历、费用支付、医保、退款和 HIS 回写仍然遵守最后处理原则。
3. 页面跳转存在不等于业务完成。尤其是 `appointment-directory`、`report-directory`、`outpatient-payment` 三类页面，必须把“目录读到了”与“可以执行副作用”分开验收。
4. 任何新 provider 文档到达后，应先更新本台账的能力和边界，再更新 contract、adapter、domain、persistence、API、小程序、日志和 release 证据；缺字段时保持 `待 contract`。

## 下一步顺序

1. 先取得新的 provider 文档和脱敏样例，完成患者同步、预约历史、报告目录、门诊费用的真实账号只读验收；每个域分别保存 traceId、provider requestId、状态映射和脱敏结果。
2. 完成候选 release 的公网 `no-store`、readiness、`/api/v2` 认证边界和旧 Python `8001` 共存复测，再做真实业务请求；未完成发布切换前不把公网旧版本结果写成新版本证据。
3. 只读证据稳定后，再分别冻结门诊病历、患者绑定/新增、二维码、外部入口和意见反馈 contract。
4. 最后处理预约写入、费用支付、医保授权/结算、退款和 HIS 回写；每个副作用必须有幂等键、最终状态查单、补偿和日志证据。
