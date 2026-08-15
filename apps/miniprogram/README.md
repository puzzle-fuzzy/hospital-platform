# Native WeChat Mini Program

## Visual baseline

首页和报告详情按旧端页面逐项复刻，而不是重新设计：保留旧端的 710rpx 主宽度、580rpx
就诊人卡片、4 格业务入口、340rpx 轮播区、右侧快捷图片、门诊/住院/便民四列服务布局、
四 Tab 底栏以及报告页的蓝色标题、深蓝操作条、双 Tab 和底部复诊条。旧端使用的图标和图片
集中在 `src/assets/legacy-home/`，页面只引用本地副本，避免用字符图标或新的抽象图形替代原设计。

视觉复刻不等于开放业务能力：未完成的住院、便民、健康百科、支付、二维码、云影像和分享能力
只保留原位置并给出迁移提示，不新增虚假成功路径或 provider 直连。

这里保留原生微信小程序边界：WXML、WXSS、TypeScript 源码和微信原生 API；微信开发者工具通过
公共 `project.config.json` 启用官方 TypeScript 编译插件，不引入运行时框架或自定义运行时适配层。

页面只能通过 `src/services/api-client.ts` 调用 Hospital API，不允许把众阳、医保或微信商户配置放到小程序环境变量中。

微信开发者工具的 `src/project.private.config.json` 仅用于本机设置，已加入仓库忽略；项目公共配置和业务代码不保存 provider 密钥。

打开项目时请选择 `apps/miniprogram/`，不要直接把 `apps/miniprogram/src/` 作为微信项目根目录。
公共配置中的 `miniprogramRoot` 已经指向 `src/` 并开启 `useCompilerPlugins: ["typescript"]`。
如果开发者工具曾经直接打开过 `src/`，它可能生成被忽略的 `src/project.config.json`；该副本也必须保持
`useCompilerPlugins: ["typescript"]`，否则工具会按纯 JavaScript 查找页面 `.js` 文件并报“找不到对应文件”。

当前首页已经完成最小纵向切片：健康检查、`wx.login()` 换取服务端会话、会话恢复、服务端归属的就诊人列表和显式的就诊人同步。
首页默认使用服务端目录第一位患者，但点击顶部“更换就诊人”会进入独立的
`pages/patient-select/patient-select` 页面；选择页把当前选择的 opaque `patientId` 写入
`selected_patient_id`，返回首页后由 `onShow` 恢复，并清空上一位患者的报告和挂号记录状态。
首页卡片只显示 `displayName` 和服务端生成的 `cardNumberMasked`，不会把内部 `patientId`、众阳患者号或完整医疗卡号作为用户可见 ID。
新增/绑定就诊人仍未开放，因为当前平台只具备真实的目录同步契约，不能在小程序侧伪造绑定成功。
页面只负责状态和交互事件；会话生命周期集中在 `src/services/session-service.ts`，日期窗口和患者/预约/报告
读模型编排集中在 `src/services/dashboard-service.ts`。新增页面应优先复用领域服务，不要在 WXML 页面里直接拼接 provider 参数。
`wx.login()` 不会弹出头像/昵称授权框；登录成功后首页会显示“微信已登录”，头像昵称不属于当前医疗登录契约。
登录后如果本地没有患者映射，页面会主动执行一次服务端患者目录同步；同步失败必须按配置或 provider 错误提示，不能展示假患者。
同步按钮只调用平台 API 的 `POST /patients/sync`；生产前缀由 `app.ts` 的 `apiPrefix=/api/v2` 注入，
本地 API 使用默认 `/api/v1`。unionId 从服务端会话解析，provider 患者号只在服务端映射表内使用。
首页的“预约挂号”入口会进入 `pages/appointment-directory/appointment-directory`，只调用平台 API 的
`GET /appointments/departments` 和 `GET /appointments/schedules`，日期范围由客户端限制为未来 7 天展示；
“我的挂号”进入 `pages/appointment-records/appointment-records`，按当前选择的内部 `patientId` 查询近 90 天记录。
预约目录按旧版“两列级联”复刻：左侧科室独立滚动，右侧只加载当前科室，再按日期分组并以每次 12 条的方式展示号源；
两页只读展示服务端规范化结果，预约写入、锁号、取消和支付尚未开放。
首页的“门诊缴费”进入 `pages/outpatient-payment/outpatient-payment`，按当前内部 `patientId` 查询门诊待缴/已缴摘要；
“我的”进入 `pages/my/my`，提供就诊人管理、挂号记录和门诊缴费入口，并固定底部导航栏。门诊费用页面当前只接入查询，
点击费用记录不会伪造支付，也不会把 provider 订单号、医保字段或支付凭证交给小程序。
首页报告入口进入独立的 `pages/report-directory/report-directory`，只调用平台 API 的 `GET /reports`，传入平台内部 `patientId` 和有限日期范围；服务端负责解析众阳患者号，目录页按 10 条批次展示，避免报告较多时一次性渲染。
本期只读 LIS/PACS/ECG 摘要；服务端已准备 gated LIS 详情的 opaque 引用客户端方法，
报告目录现在只在存在服务端 `reportId` 时进入原生详情页，详情页只展示白名单检测项；默认 gate 关闭时保持摘要只读，真实 provider 详情、文件下载和体检报告仍未开放。
旧端曾把完整 `medicalCardNo` 拼接到第三方二维码 URL；新端不会复用该实现。二维码只有在医院确认扫码字段、签名、短 TTL、撤销和真机设备验收后，才由服务端生成短期引用。
`api-client.ts` 已封装 `requestWechatPrepay(orderId, idempotencyKey)`，只接收服务端生成的
`payParams`；`launchWechatPayment` 只把白名单字段交给 `wx.requestPayment`，调起成功和取消都不会直接更新业务状态。
页面仍需在订单状态为 `cash_pending` 时调用它，支付最终结果必须重新读取服务端订单状态。
同时可用 `getWechatPrepay(orderId, idempotencyKey)` 读取 `not_started/pending/ready/unknown`，避免网络重试时把未知结果误报为失败。
后续按领域迁移：登录/就诊人选择 → 预约目录与挂号记录页面 → 挂号写入契约 → 支付状态页 → 报告 → 健康服务 → AI。

线上默认请求 `https://test-hp.meiyi.pro`，业务前缀为 `/api/v2`。本地开发时把 `app.ts` 的 `apiBaseUrl`
改为 `http://127.0.0.1:3000`，把 `apiPrefix` 改为 `/api/v1`；健康检查同样必须经过版本前缀，线上地址是
`/api/v2/health/live`，避免落到旧服务根路径产生 404。
客户端只允许本机 `localhost/127.0.0.1` 使用 HTTP，其他地址必须使用 HTTPS。完整登录启用、日志检索和真机验收
请阅读 [`docs/wechat-auth-login.md`](../docs/wechat-auth-login.md)。
小程序始终只接收平台会话，不接收 openid、session_key、医保凭证或商户配置。

开发者工具的 `sdkreport` 排查结论：当前新旧项目源码、构建产物和配置中均未发现 `sdkreport` 文件或业务引用，
因此不新增无依据的忽略规则。若开发者工具在本机生成同名诊断文件，应保留在工具本地目录，不复制到 `src/`、`dist/`
或 Git 提交中；真正需要忽略的本机配置仍由 `project.private.config.json` 负责。

构建小程序时必须使用 `pnpm --filter @hospital/miniprogram build`，该命令执行 TypeScript 类型检查并验证
WXML/WXSS/JSON、`src/assets/` 和官方编译插件配置完整。微信开发者工具必须打开
`apps/miniprogram/`，由公共 `project.config.json` 将 `src/` 作为唯一小程序根目录；不要打开历史的 `dist/` 目录。
若刷新后仍请求旧地址，先重新执行构建并重新导入 `apps/miniprogram/`，再确认 `src/app.ts` 中的 `apiBaseUrl/apiPrefix`；
代码配置优先于旧的本地缓存，不会再拼出 `/api/v1/api/v2/...`。
