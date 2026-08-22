# 普通资料当前候选读写验收协议（2026-08-22）

> 当前配套服务端 release：`84370077024762d92050cf077c27f3c60302e8f8`；当前小程序运行包来源：
> `a64fe023bc34fe6e44f93846c39e202fe02d64a5`（提交 `a64fe023`）。本协议只适用于重新构建并通过
> `runtime:verify` 的新项目运行包，不能使用旧 `mp-weixin` 项目、旧二维码或历史 token。

## 当前结论

普通资料的服务端 contract、小程序页面状态和本地回归已经完成；真实微信会话下的资料读取、受控写入、
版本冲突和日志三层证据仍未完成。因此当前状态是：**代码已实现，真机写入待授权、待验收**。

本协议不开放实名资料、头像、手机号、身份证、患者关系、微信身份、医保身份、支付或任何 HIS 回写。
普通资料更新也会改变数据库中的用户资料，除非用户明确指定受控测试账号和可恢复的测试值，否则不能
自动执行 `PUT /me/profile`。

## 已确认的实现边界

| 边界 | 当前规则 |
| --- | --- |
| owner | 只从当前 Bearer 会话解析，客户端不能提交 `userId`、openid、unionId 或患者标识 |
| 读取 | `GET /api/v2/me/profile` 没有资料行时返回 `version=0` 默认值，不隐式创建记录 |
| 写入字段 | 严格只允许 `version`、`displayName`、`gender`、`age`、`email` |
| 版本 | 成功写入后必须从 `N` 变为 `N+1`；旧版本返回 `409 user-profile-conflict` |
| canonical | 页面必须使用服务端成功响应回写，不能把本地输入值当成最终事实 |
| 日志 | 只记录事件、trace、字段数量、版本结果和固定错误类型，不记录正文、userId、token 或邮箱 |
| 会话竞态 | 页面在 PUT 前和成功回写前检查会话代际；账号切换或 token 失效时 fail-closed |

对应实现入口：服务端 `apps/api/src/modules/profile/`，小程序
`apps/miniprogram/src/pages/profile/profile.ts` 和 `apps/miniprogram/src/services/api-client.ts`。
服务端较绕的 owner、未知字段、版本和会话边界均已在核心代码中用中文注释固定。

## 验收前门禁

在微信开发者工具中必须先结束旧真机调试，重新打开
`E:\__Super_Core__\hospital-platform\apps\miniprogram`，执行一次普通编译，并使用新生成的二维码。
运行目录必须是 `dist/`，不能打开 `src/` 或 `dist/` 作为项目根目录。若再次出现
`dist/services/single-flight.test.js`，先按 [运行包 ENOENT 恢复记录](miniprogram-runtime-enoent-recovery-2026-08-22.md)
处理，不进入资料验收。

本地候选已具备以下门禁证据：

```text
pnpm --filter @hospital/miniprogram build       通过
pnpm --filter @hospital/miniprogram runtime:verify 通过
pnpm --filter @hospital/miniprogram test        217 pass / 0 fail / 1624 expect()
dist/ 页面入口                              14/14
dist/ 测试运行脚本                           0 个
```

这些门禁只能证明运行包和代码边界正确，不能代替手机页面、客户端请求和服务端日志三层证据。

## 受控验收顺序

### 1. 先只读，不写数据库

1. 使用新二维码完成微信登录，进入“我的”→“个人资料”。
2. 记录页面最终状态和 `GET /api/v2/me/profile` 的 HTTP 状态、请求 ID；证据中只保留脱敏后的关联信息。
3. 预期响应为 `200`，数据只包含 `displayName`、`gender`、`age`、`email`、`version`。
4. 如果 `version=0`，只能说明当前用户没有资料行；不能据此声称资料已持久化。
5. 服务端低敏日志应能在同一关联链看到：

   - `user.profile.requested`
   - `user.profile.loaded`

   `persisted` 只表示是否已有资料行，不能把用户资料正文带入日志。

### 2. 受控普通字段写入

只有在明确指定测试账号和可恢复测试值后才能执行。推荐只改 `displayName`，保存前先私下记录当前
`version=N`，不要把版本、昵称或邮箱写入聊天、截图或提交文件。

1. 在页面修改一个可恢复的普通展示字段，提交体必须携带当前 `version=N`。
2. 预期 HTTP 为 `200`，返回 canonical 快照的 `version=N+1`。
3. 页面应显示服务端返回的规范化值，然后重新进入资料页触发 GET，确认值和版本仍来自当前 owner。
4. 服务端关联日志应包含 `user.profile.update.requested` 和 `user.profile.updated`；`fieldCount` 应与
   请求中明确出现的普通字段数量一致。
5. 验收结束后，如测试值不是用户希望保留的资料，必须用新的当前版本再次恢复；恢复操作同样需要明确授权，
   不能在未知版本时自动重试。

### 3. 版本冲突

该场景必须使用两个属于同一 owner 的受控会话，或使用已经保存的两个相同版本快照。两个不同微信账号
不能证明同一 owner 的版本冲突。

1. 两个会话都先读取并保存同一个版本 `N`。
2. 会话 A 用 `N` 更新成功，得到 `N+1`。
3. 会话 B 仍用旧版本 `N` 更新，必须返回 `409 user-profile-conflict`。
4. 页面 B 应清理可提交状态并提示重新读取，不能自动覆盖、无限重试或显示保存成功。
5. 服务端应出现 `user.profile.conflict`，不能同时出现该请求的 `user.profile.updated`。

### 4. 非法输入（只在受控账号执行）

以下请求必须在数据库写入前失败，且不产生成功事件：

- 携带 `avatar`、`openid` 或其它未知字段；
- 昵称为空、含控制字符或超过 64 个 Unicode code point；
- 年龄不是 `0`–`150` 的整数；
- 邮箱格式不合法；
- 没有任何可更新字段，或版本达到不可递增上限。

预期错误码为 `user-profile-invalid`，日志只记录固定错误类型；不能记录非法字段名、字段值或原始请求体。

## 证据接收和停止条件

普通资料只有在以下材料属于同一小程序来源、同一服务端 release 和同一时间窗口时，才能标记为“真机已验收”：

1. 页面截图或录屏：读取、受控编辑、保存成功、重新读取和冲突提示；
2. 客户端 HTTP：GET、成功 PUT、冲突 PUT（以及可选的非法输入）及其 requestId/traceId 关联；
3. 服务端低敏日志：对应 `user.profile.*` 事件，`parseErrors=0`，无 systemd warning；
4. 重新 GET：证明成功版本和值仍属于当前会话 owner；
5. 全部证据已脱敏，没有 token、openid、unionId、userId、邮箱、真实昵称或 provider 原文。

遇到 `401 unauthorized`、`session-changed`、`persistence-temporarily-unavailable`、读模型异常、
版本不一致或日志关联缺失时，立即停止写入验收，先回到 GET/会话恢复，不重放旧 PUT。支付、医保、退款、
预约写入和 HIS 回写继续保持关闭。

## 当前未完成项

- 尚未取得当前二维码对应的真机 `GET /me/profile` 页面、客户端和服务端三层证据；
- 尚未获得用户对受控资料写入/恢复的明确授权，因此没有执行真实 `PUT /me/profile`；
- 尚未取得同一 owner 的双会话 `409 user-profile-conflict` 真机证据。
