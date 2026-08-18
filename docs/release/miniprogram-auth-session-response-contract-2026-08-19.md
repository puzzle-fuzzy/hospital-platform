# 小程序微信登录与会话恢复响应边界（2026-08-19）

## 结论

本轮收紧原生小程序 `wx.login()` 换取平台会话和 `/me` 会话恢复的客户端响应边界。
这只修改新小程序客户端的运行时校验、中文注释、测试和文档，不修改旧 Python 服务、线上 API、MySQL、Redis、
微信配置或线上小程序包。

此前登录请求使用 TypeScript 泛型接收成功 JSON，然后只检查 `accessToken` 是否 truthy；`/me` 则直接把任意 2xx
JSON 交给会话服务。类型声明不会在微信运行时验证真实 JSON，因此代理错配、字段缺失或错误会话可能被误标记为已登录。

现在两个入口都 fail-closed：

- 登录响应必须是 `success: true`，包含非空且无控制字符的 `accessToken`、`tokenType: "Bearer"`、安全整数
  `expiresInSeconds >= 1` 和有界的 `user.id`；
- token 长度最多 512 个字符，user id 长度最多 64 个字符。前者受 Authorization 传输边界约束，后者与服务端
  会话 principal 的内部 user id 列宽保持一致；这些限制不是对 token 内容做 JWT 解码或业务猜测；
- `/me` 必须返回 `success: true`、`data.user.id`，并重新投影为最小 canonical 响应；未知字段不会进入页面状态；
- 只有登录响应完整通过校验后才写入 token、递增会话代际和标记 `signed_in`；协议错误不会污染本地会话；
- `/me` 协议错误与 `401/unauthorized` 保持不同语义：前者返回 `provider-response-invalid`，后者仍由会话请求层负责
  重新登录一次或清理失效 token；命令请求仍禁止自动重放。

## 代码边界

权威实现位于 `apps/miniprogram/src/services/api-client.ts`：

- `requireAuthSessionResponse(value)`：微信登录成功 JSON 的运行时验证和白名单投影；
- `requireCurrentUserResponse(value)`：会话恢复 JSON 的运行时验证和白名单投影；
- `performLogin()`：使用 `request<unknown>()` 后先校验、再写入 token；
- `getCurrentUser()`：使用 `requestWithSession<unknown>()` 后先校验、再交给 `session-service`。

小程序不会解析 token、猜测 user id、接收 openid/session_key 或 AppSecret。客户端校验也不能替代服务端 Redis TTL、
owner 认证、微信 code2session 和数据库身份映射；它只负责阻止损坏的成功响应进入页面状态。

## 本地证据

- 代码提交：`c727e1c73969e16d94531c8e385ca772c51de62e`，已推送 `origin/main`；
- 小程序定向测试：`152` 项通过、`1215` 个断言通过；TypeScript 类型检查通过；
- 新增回归覆盖：成功包络、未知字段重投影、缺失字段、错误 token 类型、非整数/非正过期时间、控制字符、超长 user id；
- 用户已有的 `apps/miniprogram/project.config.json` 修改未触碰、未暂存、未提交。

## 未完成项

本轮没有重新取得微信真机扫码、服务端同链 `auth.wechat.login.succeeded`、`GET /me`、患者目录和低敏日志三层证据，
因此不能把本地响应契约测试写成真实微信登录验收。Provider、真实多就诊人切换、预约/报告/费用业务、支付、医保和 HIS
回写仍按路线图保持独立验收与关闭边界。
