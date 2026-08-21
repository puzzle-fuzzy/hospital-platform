# 普通资料 MySQL 读模型校验审计（2026-08-21）

## 结论

当前本地候选服务端为 `160e7c8533c3a1d42c832184c90e274c6a4a1e9e`，属于未发布代码，未替换线上
`c8eef370`，未修改旧 Python 服务、线上配置、MySQL 或 Redis。

本轮确认并修正了一个跨层错误边界：普通资料 service 原本会对仓储返回值执行
`normalizeUserProfileReadModel`，但 MySQL 行映射在此之前已经对未知性别、越界年龄和越界版本抛出普通
`Error`。因此同一种资料脏数据在内存仓储和 MySQL 仓储可能产生不同错误类型，MySQL 路径还可能绕过
API 已冻结的 `persistence-invalid` 和请求日志 `readModelViolation`。

现在 MySQL `userProfile` 映射统一调用领域层 `normalizeUserProfileReadModel`：

1. 数据库驱动的 TypeScript 行类型不再被当作运行时事实；
2. 未知 gender、非法 age、非法 email/displayName 或越界 version 统一转换为
   `UserProfileReadModelValidationError`；
3. API 错误处理器继续返回固定 `persistence-invalid`，不把资料损坏降级成默认资料；
4. 请求日志只保留有限的 `readModelViolation`，不记录昵称、邮箱、userId 或原始数据库错误正文。

## 回归证据

```text
packages/persistence：93 pass，0 fail，605 expect()
pnpm check：architecture / migration / provider / docs / release baseline / Biome / typecheck / test / build 全部通过
小程序 runtime:verify：14 个页面入口齐全，dist 中没有 *.test.js 或 *.spec.js
```

新增并调整的重点测试：

- 版本超过 MySQL `INT UNSIGNED` 上限时返回 `profile-version-invalid`；
- 未知 gender 时返回 `profile-gender-invalid`；
- MySQL 仓储返回的领域错误可以继续被 API 层映射为 `persistence-invalid`。

## 尚未完成

这项修复只证明本地代码和测试边界，不构成真实业务验收。仍需使用当前发布候选取得：

- 微信会话下真实 `GET /me/profile`；
- 受控资料 `PUT /me/profile` 和重新读取；
- 两个会话同版本提交时一成功一 `409 user-profile-conflict`；
- 页面、HTTP、服务端日志同一 trace/request 链路证据。

支付、医保、退款、预约写入和 HIS 回写继续保持最后专项，不因本轮资料读模型修复而开放。
