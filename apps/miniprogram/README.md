# Native WeChat Mini Program

这里保留原生微信小程序边界：WXML、WXSS、JavaScript 和微信原生 API。

页面只能通过 `src/services/api-client.js` 调用 Hospital API，不允许把众阳、医保或微信商户配置放到小程序环境变量中。

当前只提供首页和构建复制脚本。后续按领域迁移：登录/就诊人 → 挂号 → 支付 → 报告 → 健康服务 → AI。
