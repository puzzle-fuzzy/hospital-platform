# Native WeChat Mini Program

## Visual baseline

首页和报告详情按旧端页面逐项复刻，而不是重新设计：保留旧端的 710rpx 主宽度、580rpx
就诊人卡片、4 格业务入口、340rpx 轮播区、右侧快捷图片、门诊/住院/便民四列服务布局、
四 Tab 底栏以及报告页的蓝色标题、深蓝操作条、双 Tab 和底部复诊条。旧端使用的图标和图片
集中在 `src/assets/legacy-home/`，页面只引用本地副本，避免用字符图标或新的抽象图形替代原设计。

视觉复刻不等于开放业务能力：未完成的住院、便民、健康百科、支付、二维码、云影像和分享能力
只保留原位置并给出迁移提示，不新增虚假成功路径或 provider 直连。

这里保留原生微信小程序边界：WXML、WXSS、JavaScript 和微信原生 API。

页面只能通过 `src/services/api-client.js` 调用 Hospital API，不允许把众阳、医保或微信商户配置放到小程序环境变量中。

微信开发者工具的 `src/project.private.config.json` 仅用于本机设置，已加入仓库忽略；项目公共配置和业务代码不保存 provider 密钥。

当前首页已经完成最小纵向切片：健康检查、`wx.login()` 换取服务端会话、会话恢复、服务端归属的就诊人列表和显式的就诊人同步。
页面只负责状态和交互事件；会话生命周期集中在 `src/services/session-service.js`，日期窗口和患者/预约/报告
读模型编排集中在 `src/services/dashboard-service.js`。新增页面应优先复用领域服务，不要在 WXML 页面里直接拼接 provider 参数。
同步按钮只调用平台 API 的 `POST /patients/sync`；生产前缀由 `app.js` 的 `apiPrefix=/api/v2` 注入，
本地 API 使用默认 `/api/v1`。unionId 从服务端会话解析，provider 患者号只在服务端映射表内使用。
首页的预约目录入口只调用平台 API 的 `GET /appointments/departments` 和
`GET /appointments/schedules`，日期范围由客户端限制为未来 7 天展示，预约写入和支付尚未开放。
报告入口只调用平台 API 的 `GET /reports`，传入平台内部 `patientId` 和有限日期范围；服务端负责解析众阳患者号。
本期只读 LIS/PACS/ECG 摘要；服务端已准备 gated LIS 详情的 opaque 引用客户端方法，
报告目录现在只在存在服务端 `reportId` 时进入原生详情页，详情页只展示白名单检测项；默认 gate 关闭时保持摘要只读，真实 provider 详情、文件下载和体检报告仍未开放。
`api-client.js` 已封装 `requestWechatPrepay(orderId, idempotencyKey)`，只接收服务端生成的
`payParams`；`launchWechatPayment` 只把白名单字段交给 `wx.requestPayment`，调起成功和取消都不会直接更新业务状态。
页面仍需在订单状态为 `cash_pending` 时调用它，支付最终结果必须重新读取服务端订单状态。
同时可用 `getWechatPrepay(orderId, idempotencyKey)` 读取 `not_started/pending/ready/unknown`，避免网络重试时把未知结果误报为失败。
后续按领域迁移：登录/就诊人 → 挂号 → 支付状态页 → 报告 → 健康服务 → AI。

线上默认请求 `https://test-hp.meiyi.pro`，业务前缀为 `/api/v2`。本地开发时把 `app.js` 的 `apiBaseUrl`
改为 `http://127.0.0.1:3000`，把 `apiPrefix` 改为 `/api/v1`；健康检查不经过版本前缀。
客户端只允许本机 `localhost/127.0.0.1` 使用 HTTP，其他地址必须使用 HTTPS。完整登录启用、日志检索和真机验收
请阅读 [`docs/wechat-auth-login.md`](../docs/wechat-auth-login.md)。
小程序始终只接收平台会话，不接收 openid、session_key、医保凭证或商户配置。

构建小程序时必须使用 `pnpm --filter @hospital/miniprogram build`，构建脚本会把 `src/assets/` 完整复制到
`dist/assets/`。开发者工具应打开 `src/` 或完整的 `dist/` 小程序根目录，不能打开不包含 `app.json` 和 `assets/`
的上层目录。若刷新后仍请求旧地址，先重新编译，再确认 `app.js` 中的 `apiBaseUrl/apiPrefix`；代码配置优先于旧的本地缓存，
不会再拼出 `/api/v1/api/v2/...`。
