# 普通个人资料契约

> 状态：代码契约、本地测试、生产 0014 schema、API 生产运行和未登录公网路由已验收；真实微信资料读写、版本冲突和真机证据仍待单独完成。
>
> 本文只覆盖旧端个人中心中可以与医疗身份、患者绑定、微信身份和文件资源明确分离的
> 普通展示资料。它不代表旧 `system/user/current/info/update` 已经整体迁移。

## 1. 旧端事实

旧页面 `hospital-app/src/pagesB/user/edit_profile.vue` 会读取和修改昵称、性别、年龄、邮箱，
另外还会展示/上传头像。旧服务的 `UpdateUserInfoParams` 允许更多字段，包括姓名、手机号、
身份证、实名姓名、`openid` 和 `unionid`；这些字段混在同一个更新入口中，不能原样复制到新 API。

旧头像上传返回 `file_url`，但旧代码没有给新端提供对象存储授权、内容安全、下载 TTL、删除和
owner 审计的完整契约。因此头像本轮仍然关闭，不能因为普通资料已经迁移就顺带开放。

## 2. 新端范围

| 字段 | 新端类型 | 允许行为 | 明确不做的事 |
| --- | --- | --- | --- |
| `displayName` | 1 到 64 个字符的非空字符串 | 修改展示昵称 | 不把它当作实名姓名或患者档案姓名 |
| `gender` | `male`、`female`、`unknown` | 修改普通展示性别 | 不推导医保、临床或实名结论 |
| `age` | `0` 到 `150` 的整数或 `null` | 修改或清空展示年龄 | 不用于临床年龄判断，不接受小数/字符串年龄 |
| `email` | RFC 风格的非空邮箱或 `null` | 修改或清空邮箱 | 不作为登录身份，不在日志中记录原文 |
| `version` | 非负整数 | 乐观锁版本 | 不由客户端自由递增，服务端返回下一版本 |

不属于本契约的字段：头像、手机号、身份证、实名姓名、微信 `openid`/`unionid`、患者号、
医保身份和任何 provider 原始字段。

## 3. API

公网前缀为 `/api/v2`，Elysia 内部路径为 `/api/v1`。

### `GET /me/profile`

要求当前 Bearer 会话。服务端从会话解析 `userId`，不接受 query/body 中的 owner。

资料还没有持久化记录时返回安全默认值，不在 GET 中隐式创建数据库行：

```json
{
  "success": true,
  "data": {
    "displayName": "微信用户",
    "gender": "unknown",
    "age": null,
    "email": null,
    "version": 0
  }
}
```

### `PUT /me/profile`

请求必须带 `version`，并至少提供一个普通资料字段。未提供的字段保持原值，`age: null` 或
`email: null` 表示清空：

```json
{
  "version": 0,
  "displayName": "张三",
  "gender": "male",
  "age": 32,
  "email": "user@example.com"
}
```

首次写入使用 `version=0` 创建版本 1；后续写入必须匹配数据库当前版本，并以条件更新
`WHERE user_id = ? AND version = ?` 递增版本。版本不匹配返回 HTTP 409 和稳定错误码
`user-profile-conflict`，客户端应重新读取后让用户确认，而不是自动覆盖。

## 4. 数据和权限不变量

1. `hp_user_profiles.user_id` 引用 `hp_identity_users.user_id`，删除身份时级联清理普通资料。
2. 个人资料查询和更新只能使用当前会话的 `userId`，客户端不能提交另一个用户的 owner。
3. MySQL 首次插入遇到并发重复键时返回冲突；不能把重复键当作“再次更新”或静默覆盖。
4. 普通资料不存在时 GET 返回默认值，但不会制造持久化副作用。
5. 读取和更新都必须记录资料域事件：读取区分 `requested`、`loaded`、`read_failed`，更新记录成功、冲突和失败；日志只记录事件名、traceId、是否已有持久化记录、修改字段数量、版本和错误类型，禁止记录 userId、昵称、邮箱和完整请求体。
6. 选择就诊人仍然进入独立的 `patient-select` 页面；普通个人资料不改变当前患者上下文。
7. 小程序资料页的并发 GET 必须由最后一次请求获胜；刷新期间禁止保存，不能让旧响应覆盖较新的 `version`。

## 5. 实现和门禁

- 领域：`packages/domain/src/user-profile.ts`；明确排除身份、实名、患者和头像字段。
- 契约：`packages/contracts/src/index.ts`；TypeBox 负责请求/响应边界校验。
- 持久化：`packages/persistence/migrations/0014_user_profiles.sql`；MySQL 使用版本条件更新，
  内存仓储只用于测试。
- API：`apps/api/src/modules/profile/`；路由挂在 `/api/v1/me/profile`，错误统一由 API 错误处理器映射。
- 小程序：`apps/miniprogram/src/pages/profile/`；“我的”页的资料卡和家庭成员卡分别导航到资料页、
  就诊人选择页；资料页用请求守卫淘汰旧 GET，并在加载/保存期间禁用保存动作。
- 验收：API owner/版本测试、MySQL SQL 条件更新测试和小程序源码/构建门禁均已补齐。

生产 0014 migration、schema probe、API 重启和公网 HTTPS readiness 已完成；未登录 `/me/profile` 的
401 鉴权边界也已验证。真实微信会话的默认值读取、首次更新、409 版本冲突和真机页面仍未验收，
因此不能把本文的“生产运行就绪”写成“个人资料业务全部迁移完成”。详细证据见
[`../release/user-profile-production-acceptance-2026-08-16.md`](../release/user-profile-production-acceptance-2026-08-16.md)。

## 6. 后续契约问题

头像、手机号、实名资料和患者绑定分别处理：

- 头像需要对象存储、MIME/大小/内容安全、owner 授权、下载 TTL、删除和审计；
- 手机号和实名资料需要微信能力、医院实名规则、变更/撤回和敏感字段访问控制；
- 患者新增/绑卡继续遵循 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md)，
  在 provider 文档和超时最终状态查询冻结前保持 fail-closed；
- 法律协议不能只靠页面 Toast，必须有版本、展示内容摘要、同意时间、撤回和业务动作绑定。
