# Native WeChat Mini Program

这里保留原生微信小程序边界：WXML、WXSS、JavaScript 和微信原生 API。

页面只能通过 `src/services/api-client.js` 调用 Hospital API，不允许把众阳、医保或微信商户配置放到小程序环境变量中。

当前首页已经完成最小纵向切片：健康检查、`wx.login()` 换取服务端会话、会话恢复和服务端归属的就诊人列表。
后续按领域迁移：登录/就诊人 → 挂号 → 支付 → 报告 → 健康服务 → AI。

开发者工具默认请求 `http://127.0.0.1:3000`。真机调试时请在本地存储写入 `api_base_url`，使用手机可访问的
局域网 HTTPS/开发地址；小程序始终只接收平台会话，不接收 openid、session_key、医保凭证或商户配置。
