# 普通个人资料契约

> 状态：代码契约、本地测试、生产 0014 schema、API 生产运行、未登录公网路由和真实微信资料默认值读取已验收；真实首次写入、版本冲突和真机证据仍待单独完成。
>
> 本文只覆盖旧端个人中心中可以与医疗身份、患者绑定、微信身份和文件资源明确分离的
> 普通展示资料。它不代表旧 `system/user/current/info/update` 已经整体迁移。

## 1. 旧端事实

旧页面 `hospital-app/src/pagesB/user/edit_profile.vue` 会读取和修改昵称、性别、年龄、邮箱，
另外还会展示/上传头像。旧服务的 `UpdateUserInfoParams` 允许更多字段，包括姓名、手机号、
身份证、实名姓名、`openid` 和 `unionid`；这些字段混在同一个更新入口中，不能原样复制到新 API。

旧头像上传返回 `file_url`，但旧代码没有给新端提供对象存储授权、内容安全、下载 TTL、删除和
owner 审计的完整契约。因此头像的持久化上传本轮仍然关闭，不能因为普通资料已经迁移就顺带开放。
当前“我的”页已经单独实现微信用户主动授权：授权回调中的昵称、头像 URL 和性别可以用于本机
展示；头像 URL 只作为当前 owner 的短期本地缓存，不是服务端头像字段，也不等价于旧端头像上传。

## 2. 新端范围

| 字段 | 新端类型 | 允许行为 | 明确不做的事 |
| --- | --- | --- | --- |
| `displayName` | 1 到 64 个 Unicode code point 的非空、无控制字符字符串 | 修改展示昵称；首次微信资料授权且服务端仍为默认值时可补全 | 不把它当作实名姓名或患者档案姓名 |
| `gender` | `male`、`female`、`unknown` | 修改普通展示性别；首次微信资料授权时可同步 | 不推导医保、临床或实名结论 |
| `age` | `0` 到 `150` 的整数或 `null` | 修改或清空展示年龄 | 不用于临床年龄判断，不接受小数/字符串年龄 |
| `email` | RFC 风格的非空、无控制字符邮箱或 `null` | 修改或清空邮箱 | 不作为登录身份，不在日志中记录原文 |
| `version` | `0` 到 MySQL `INT UNSIGNED` 上限的整数 | 乐观锁版本 | 不由客户端自由递增，服务端返回下一版本 |

实现备注：TypeBox 0.34 的 `maxLength` 运行时按 UTF-16 code unit 计数，不能直接表达本契约的
Unicode code point 上限。共享 `UserProfileDisplayNameSchema` 使用代理项对模式约束 1–64 个
code point，并由合同测试覆盖中文、emoji、混合字符、第 65 个字符和孤立代理项；资料 service
继续负责首尾空白和控制字符校验。

头像的本机展示不是服务端持久化契约。微信授权返回的头像 URL 经过 HTTPS 校验后按
`wechat-user-profile:{userId}` 保存，仅用于当前设备展示，账号 owner 不匹配或数据不完整时丢弃。
用户更换微信头像、URL 失效、清理缓存后的重新授权都属于正常情况。真正的头像上传仍需要独立的
对象存储和内容安全契约。

不属于本契约的持久化字段：头像、手机号、身份证、实名姓名、微信 `openid`/`unionid`、患者号、
医保身份和任何 provider 原始字段。

微信资料授权不能提供年龄和邮箱；这两个字段仍只能来自普通资料读取或资料页的显式编辑，不能根据
微信授权结果猜测或填充。

小程序输入层不能通过删除字符来“帮助”用户修正年龄。`-1`、`1.5` 和科学计数法如果在输入事件中
被改写成另一组数字，服务端将无法再区分用户原始意图；因此页面保留年龄原文，只在保存命令边界解析，
空字符串表示 `null`，非空值必须是 `0` 到 `150` 的十进制整数。客户端提前校验只改善反馈速度，服务端
仍执行最终 contract 校验。

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
`user-profile-conflict`，客户端应重新读取后让用户确认，而不是自动覆盖。请求版本达到
MySQL `INT UNSIGNED` 上限时已经没有合法的下一版本，服务层必须在仓储写入前返回
`user-profile-invalid`，不能让数据库尝试写入越界值。

小程序收到 `user-profile-conflict` 后必须退出已加载可编辑态并隐藏保存入口；只有重新 GET
取得最新 `version` 和资料值后才能再次编辑提交。保留旧页面的 `loaded=true` 会让用户用同一
个过期版本重复 PUT，冲突提示虽然正确，但页面状态仍然允许错误操作。

## 4. 数据和权限不变量

1. `hp_user_profiles.user_id` 引用 `hp_identity_users.user_id`，删除身份时级联清理普通资料。
2. 个人资料查询和更新只能使用当前会话的 `userId`，客户端不能提交另一个用户的 owner。
3. MySQL 首次插入遇到并发重复键时返回冲突；不能把重复键当作“再次更新”或静默覆盖。
4. 普通资料不存在时 GET 返回默认值，但不会制造持久化副作用。
5. 读取和更新都必须记录资料域事件：读取区分 `requested`、`loaded`、`read_failed`，更新区分 `user.profile.update.requested`、成功、冲突和失败；日志只记录事件名、traceId、是否已有持久化记录、修改字段数量、版本和错误类型，禁止记录 userId、昵称、邮箱和完整请求体。更新开始事件只证明请求进入资料 service，不能替代成功写入；`conflict` 仍代表明确的 409 并发结果。昵称和邮箱的控制字符校验必须在 API service 边界执行，不能只依赖小程序输入控件或数据库列类型；昵称长度按 Unicode code point 计数，不能使用 UTF-16 code unit 造成中文或 emoji 被错误拒绝。版本上限与 `INT UNSIGNED` 一致，越界输入在进入数据库前返回 `user-profile-invalid`。
   非法输入也属于更新失败，必须记录固定错误类型；`age: null` 和 `email: null` 是合法清空操作，日志字段数量按请求中明确出现的字段统计，不能按归一化后的非空值统计。HTTP 的 `additionalProperties=false` 之外，资料 service 还必须独立拒绝未知字段，防止组合根或 Worker 绕过 Elysia 后静默丢弃 `avatar`/`openid` 等旧端意图。service 在仓储返回后还必须确认版本严格等于 `expectedVersion + 1`；后置版本漂移按既有 409 冲突处理，不能记录 `updated` 成功。
6. 选择就诊人仍然进入独立的 `patient-select` 页面；普通个人资料不改变当前患者上下文。
7. 小程序资料页的并发 GET 必须由最后一次请求获胜；刷新期间禁止保存，不能让旧响应覆盖较新的 `version`。

   资料页还必须把可编辑快照绑定到取得它的会话代际：PUT 发出前以及成功响应准备回写页面前都要再次
   比较代际。账号切换后即使本地仍有新的 Bearer token，也不能把旧账号页面里的资料和 `version` 作为
   新账号的更新意图发送；代际不一致时清理旧资料并要求重新建立当前会话。

   保存成功后的延迟返回定时器按页面实例保存，并在 `onUnload` 中清理；页面已经卸载后不能再
   `setData` 或继续执行 `navigateBack`，避免用户手动返回后旧回调影响新的页面栈。
8. “我的”页读取 `/me` 或患者目录失败时，只清理当前页面的用户标签、患者卡片和数量，保留可重试的
   本地选择与会话 token；在下一次 owner-scoped 读取成功前，不能继续展示上一轮患者上下文。
9. “我的”页读取普通资料时，资料只负责个人资料卡的展示增强，不是患者上下文成立条件：`/me` 和患者目录
   成功、普通资料失败时仍可展示安全的“微信用户”兜底和已确认的患者目录，同时给出可重试的资料提示；
   不能因为资料读取失败而清理已经确认的患者上下文，也不能把资料失败伪装成成功昵称。
10. 资料 service 不能把 TypeScript 的仓储返回类型当作数据库事实：`get` 和 `update` 返回前都必须再次确认
    当前 owner、昵称/邮箱的无控制字符和长度边界、性别枚举、年龄范围以及持久化版本，并按公开资料白名单
    重新投影。读模型错 owner、非法字段或非法版本时返回 `persistence-invalid`，不能降级成默认资料或记录
    `user.profile.loaded` / `user.profile.updated` 成功；成功事件只能发生在读模型门禁通过之后。
11. MySQL 行映射必须复用领域层 `normalizeUserProfileReadModel`，不能为性别、年龄、版本等字段另抛普通
    `Error`。这样数据库读模型异常会保持与内存仓储、API service 相同的 `UserProfileReadModelValidationError`、
    `persistence-invalid` 和有限 `readModelViolation` 语义，避免监控把同一种脏数据拆成不同故障类型。
12. 小程序收到 `/me/profile` 的 2xx 响应后仍要运行时校验完整 canonical 快照；缺少字段、错误枚举、错误版本或
    非法邮箱统一归类为 `provider-response-invalid`。这不是登录失效，也不允许沿用上一账号/上一版本的昵称、年龄或邮箱：
    资料页必须清空当前编辑快照并保留“重新加载”入口，但不能因此 `reLaunch` 到登录页。网络暂时失败仍可保留最近一次已确认
    的资料，直到下一次成功读取或明确收到上述读模型损坏错误。

## 5. 实现和门禁

- 领域：`packages/domain/src/user-profile.ts`；明确排除身份、实名、患者和头像字段。
- 契约：`packages/contracts/src/index.ts`；TypeBox 负责请求/响应边界校验。
- 持久化：`packages/persistence/migrations/0014_user_profiles.sql`；MySQL 使用版本条件更新，
  内存仓储只用于测试。
- API：`apps/api/src/modules/profile/`；路由挂在 `/api/v1/me/profile`，错误统一由 API 错误处理器映射。
- 小程序：`apps/miniprogram/src/pages/profile/`；“我的”页的资料卡和家庭成员卡分别导航到资料页、
   就诊人选择页；资料页用请求守卫淘汰旧 GET，并在加载/保存期间禁用保存动作。“我的”页并行读取
   `/me`、患者目录和普通资料时，资料读取采用可降级分支，不阻断核心患者上下文，但会展示安全的重试提示。
   微信昵称、头像和性别由 `apps/miniprogram/src/services/wechat-user-profile.ts` 在用户主动点击后读取；
   昵称/性别仅在服务端仍为默认值时通过普通资料的 version 条件更新补全，头像不写入服务端。
- 读模型：普通资料 service 对仓储 `get/update` 结果做第二次 owner、字段、版本校验和白名单投影；更新输入还要在 service 层复核固定字段白名单，即使调用方绕过 HTTP schema 也不能静默丢弃未知字段。这道
  边界用于防止数据库损坏、回放仓储或未来 adapter 绕过 TypeScript 类型后把脏资料返回给小程序，也防止
  失败响应在业务日志中被提前记为成功。
- 验收：API owner/版本测试、MySQL SQL 条件更新测试和小程序源码/构建门禁均已补齐；新增回归断言确认
  非法资料在 service 校验失败时不会触碰仓储写入，小程序保存流程必须先通过 loaded/saving/navigationPending
  门禁，只有拿到服务端新 version 才展示保存成功，409 进入刷新提示并强制退出 loaded 可编辑态。上述新增断言属于本地候选代码证据，
  不替代真实微信资料 GET/PUT/409 和真机证据。

生产 0014 migration、schema probe、API 重启和公网 HTTPS readiness 已完成；未登录 `/me/profile` 的
401 鉴权边界也已验证。微信资料授权的本地运行时校验、owner 隔离和默认资料补全已经有代码门禁；
真实微信同意/拒绝行为、真实头像 URL 展示、首次更新、409 版本冲突和真机页面仍未验收，
因此不能把本文的“生产运行就绪”写成“个人资料业务全部迁移完成”。详细证据见
[`../release/user-profile-production-acceptance-2026-08-16.md`](../release/user-profile-production-acceptance-2026-08-16.md)。

## 6. 后续契约问题

头像的持久化上传、手机号、实名资料和患者绑定分别处理：

- 头像需要对象存储、MIME/大小/内容安全、owner 授权、下载 TTL、删除和审计；
- 手机号和实名资料需要微信能力、医院实名规则、变更/撤回和敏感字段访问控制；
- 患者新增/绑卡继续遵循 [`patient-binding-contract-draft.md`](patient-binding-contract-draft.md)，
  在 provider 文档和超时最终状态查询冻结前保持 fail-closed；
- 法律协议不能只靠页面 Toast，必须有版本、展示内容摘要、同意时间、撤回和业务动作绑定。
