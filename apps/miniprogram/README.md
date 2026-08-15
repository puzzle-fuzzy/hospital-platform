# Native WeChat Mini Program

这里保留原生微信小程序边界：WXML、WXSS、JavaScript 和微信原生 API。

页面只能通过 `src/services/api-client.js` 调用 Hospital API，不允许把众阳、医保或微信商户配置放到小程序环境变量中。

当前首页已经完成最小纵向切片：健康检查、`wx.login()` 换取服务端会话、会话恢复、服务端归属的就诊人列表和显式的就诊人同步。
同步按钮只调用 `POST /api/v1/patients/sync`；unionId 从服务端会话解析，provider 患者号只在服务端映射表内使用。
`api-client.js` 已封装 `requestWechatPrepay(orderId, idempotencyKey)`，只接收服务端生成的
`payParams`；`launchWechatPayment` 只把白名单字段交给 `wx.requestPayment`，调起成功和取消都不会直接更新业务状态。
页面仍需在订单状态为 `cash_pending` 时调用它，支付最终结果必须重新读取服务端订单状态。
同时可用 `getWechatPrepay(orderId, idempotencyKey)` 读取 `not_started/pending/ready/unknown`，避免网络重试时把未知结果误报为失败。
后续按领域迁移：登录/就诊人 → 挂号 → 支付状态页 → 报告 → 健康服务 → AI。

开发者工具默认请求 `http://127.0.0.1:3000`。真机调试时请在本地存储写入 `api_base_url`，使用手机可访问的
局域网 HTTPS/开发地址；客户端只允许本机 `localhost/127.0.0.1` 使用 HTTP，其他地址必须使用 HTTPS。
小程序始终只接收平台会话，不接收 openid、session_key、医保凭证或商户配置。
