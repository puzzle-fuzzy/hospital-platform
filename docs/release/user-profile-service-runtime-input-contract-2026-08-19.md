# 普通资料服务运行时输入契约（2026-08-19）

## 结论

本次只收紧普通资料更新服务的运行时输入边界，不扩大资料字段，不开放头像、手机号、实名、身份证或微信身份写入，
也不修改 MySQL、Redis、线上服务或旧 Python 服务。

`UserProfileService.update` 现在在字段解构和归一化前拒绝：

- `null`、数组或其他非普通对象请求体；
- 非字符串的 `displayName`；
- 非字符串且非 `null` 的 `email`；
- 其他类型异常继续由统一字段归一化和版本校验拒绝。

## 为什么 Service 层必须重复校验

Elysia 的 `UserProfileUpdateRequest` 只保护 HTTP 路由。组合根、回放任务和未来 Worker 可能直接调用 service；TypeScript 的输入类型也不会出现在微信或 Bun 的运行时。
如果 service 直接解构 `null`，或对数字昵称调用 `.trim()`，就会产生未映射的 `TypeError`，公共接口可能返回 500，无法保持资料域约定的 400 `user-profile-invalid`。

当前顺序固定为：

```text
请求体对象形状
        ↓
字段类型与内容归一化
        ↓
version 条件与可选字段语义
        ↓
仓储更新
        ↓
canonical 读模型校验
```

任何输入失败都不会触碰仓储，不会记录 `user.profile.updated`，而是记录低敏 `user.profile.update_failed` 并由 API 映射稳定错误。

## 日志边界

日志只保留 `traceId`、固定事件和错误类型，不记录请求体、用户 ID、昵称、邮箱、身份证、手机号或微信身份。
`null` 继续表示清空可选资料字段；缺失字段仍表示不修改，二者不能混淆。

## 验证证据

- 新增 service 回归覆盖 `null`、数组、数字昵称和对象邮箱；
- 4 类畸形输入均返回 `UserProfileInputError`，仓储更新次数为 0；
- 资料 service 定向测试、TypeScript、Biome 和文档链接审计通过；
- 本次代码尚未因此部署，真实微信 PUT、MySQL 持久化和 409 真机验收仍需单独完成。
