# 微信 code2session 响应边界复核（2026-08-26）

## 结论

本轮只收紧新项目微信身份适配器的响应分类，没有修改微信 App 配置、旧 Python 服务、旧数据库、Redis、线上进程
或真实登录凭证。

## 发现的问题

`errcode` 原实现通过 `Number(value)` 转换。JavaScript 会把数组、`false` 和 `null` 转成 `0`，导致异常微信
响应可能绕过错误分支；如果响应体是 `null`，直接访问 `.errcode` 还会抛出没有稳定分类的原生 `TypeError`。
这条路径位于身份写入和 Redis 会话签发之前，不能依赖 API 层 schema 掩盖。

## 处理规则

- code2session 响应必须是普通 JSON 对象，null、数组和标量统一拒绝。
- `errcode` 缺失表示成功包络未携带错误码；字段出现时只接受安全整数。
- 数字字符串、数组、布尔值、null 和超出安全整数范围的值统一映射为
  `ProviderRequestError(responseInvalid=true)`。
- 只有响应对象和错误码通过校验后，才继续读取 `openid`/`unionid`，因此不会写入身份表或签发会话。

## 回归证据

- `pnpm --filter @hospital/adapters test src/wechat-identity.test.ts`：10 pass / 0 fail / 22 expect
- `pnpm --filter @hospital/adapters typecheck`：通过
- 覆盖 null 响应、数组/布尔/null/数字字符串错误码，并验证保留 Provider requestId。

微信真机登录仍需使用当前 live 配套运行包完成公网、服务端日志和设备证据闭环；本地 adapter 回归不能替代真实验收。
