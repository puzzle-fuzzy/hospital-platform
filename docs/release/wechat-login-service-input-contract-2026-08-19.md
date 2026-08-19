# 微信登录服务层输入边界（2026-08-19）

## 目的

`POST /auth/wechat` 的 HTTP body 由 Elysia `WechatLoginRequest` 校验，但 `AuthService.login` 也可能被组合根、回放任务或未来 Worker 直接调用。服务层不能把编译期的 `WechatLoginPayload` 当作运行时事实。

## 固定规则

- 输入必须是非数组对象；
- `code` 必须是长度 1–256 的字符串；
- 不满足形状时在微信 Provider 调用前失败；
- 公共响应沿用现有 `400 validation`，文案为“微信登录参数不合法”；
- 日志仍只记录事件、trace、错误类型和安全的 Provider 诊断字段，不记录 code、openid、unionId、session_key 或 access token。

## 为什么服务层也要校验

HTTP schema 只保护 HTTP 路由。内部调用、测试替身、回放任务和未来 Worker 都可能绕过该层；如果直接访问 `input.code`，畸形值会产生未映射 `TypeError/500`，或者在修改实现后误把异常 payload 发到微信。把校验放在 Provider 调用前可以保证所有入口共享同一业务错误语义。

## 证据与边界

- 认证服务回归验证 `null` 输入不会调用微信 gateway，并返回 `WechatLoginInputError`。
- Elysia 错误处理回归验证该错误返回 `400 validation`。
- 本次没有改变微信 code2session、会话签发、Redis TTL、域名、真实凭据或 Provider contract；真实微信设备验收仍需单独完成。
