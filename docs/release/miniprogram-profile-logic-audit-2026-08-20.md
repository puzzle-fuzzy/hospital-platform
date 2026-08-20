# 普通资料逻辑审计记录（2026-08-20）

## 审计结论

当前发布基线小程序 `39e2caac27ec4bf569f5debc8edb47947bc398d2` 与服务端 `0e360d3` 的普通资料读写 contract 已通过服务层和页面状态审计；本次继续发现并修正了资料页页面栈复用时缺少 `onShow` 重新读取的生命周期缺口。修正后的候选仍保持“代码已实现、真实写入待验收”。本次只审计新项目，未修改旧 Python 服务、线上服务、数据库或 Redis。

## 2026-08-21 生命周期补强

普通资料页此前只在 `onLoad` 读取资料。大多数用户保存后会返回并销毁页面，因此该缺口不一定在普通路径暴露；但开发者工具热重载、页面栈复用或账号在其他页面发生切换时，页面可能继续显示上一轮资料，直到用户手动下拉刷新。资料是账号归属数据，不能依赖用户主动刷新来恢复正确性。

本轮为资料页增加实例级 `hasShown` 和 `onShow`：首次 `onShow` 只消费 `onLoad` 已发起的请求，后续重新可见时重新经过 `/me/profile` 的当前 Bearer/session 校验；明确会话失效仍清理旧资料并回到登录入口，临时依赖故障仍保留可重试语义。该状态保存在页面实例 `data`，不使用模块级首次展示变量，也不改变服务端资料 contract。

## 已核对的不变量

| 边界 | 当前实现 | 判定 |
| --- | --- | --- |
| 资料归属 | API 只从当前 Bearer principal 解析 `userId`，客户端不能提交 owner | 通过 |
| 首次读取 | 没有资料行时返回 `version=0` 的安全默认值，不创建持久化副作用 | 通过 |
| 页面加载门禁 | `loaded=false` 或仍在加载时不允许提交 PUT | 通过 |
| 字段范围 | 只允许昵称、性别、年龄、邮箱；未知旧端字段拒绝，不静默吞掉 | 通过 |
| 版本更新 | 必须携带当前版本；成功返回服务端 canonical 快照和递增版本 | 通过 |
| 并发冲突 | 旧版本只能返回 `409 user-profile-conflict`，页面隐藏保存入口并要求重新读取 | 通过 |
| 会话失效 | `unauthorized`/`session-changed` 或本地 token 消失时清理旧资料显示并回到登录入口 | 通过 |
| 普通故障 | 网络、持久化暂不可用不被误判为换号，保留对应错误和重试能力 | 通过 |
| 日志 | 资料域只记录 trace、事件、字段数量、版本结果和固定错误类型，不记录资料正文、userId 或 token | 通过 |
| 成功回写 | 页面消费服务端完整 canonical 响应，不把本地输入值直接当作最终事实 | 通过 |
| 页面栈复用 | 资料页后续 `onShow` 重新验证当前会话并读取资料，首次展示不重复请求 | 通过 |

## 代码位置

- 服务端路由：`apps/api/src/modules/profile/index.ts`
- 服务端业务与中文边界注释：`apps/api/src/modules/profile/service.ts`
- 领域读模型和版本冲突：`packages/domain/src/user-profile.ts`
- MySQL 条件更新：`packages/persistence/src/mysql-repositories.ts`
- 小程序资料页面：`apps/miniprogram/src/pages/profile/profile.ts`
- 小程序运行时响应校验：`apps/miniprogram/src/services/api-client.ts`

页面中较绕的部分已经用中文注释固定：资料页面的请求代际、页面栈 `onShow` 生命周期、保存并发锁、409 后的重新读取、会话失效后的旧资料清理，以及成功后的延迟返回定时器都按页面实例隔离，避免旧请求或旧页面栈回写当前页面。

## 本地证据

```text
服务端 profile service：13 pass，0 fail，53 expect()
小程序原生全量回归：169 pass，0 fail，1349 expect()
小程序 TypeScript：通过
```

覆盖内容包括默认值无副作用、损坏读模型 fail-closed、非法输入不写仓储、Unicode 长度、版本上限、字段清空、低敏日志、409 冲突、页面会话失效清理和 picker 边界。

## 尚未宣称完成的部分

以下必须使用当前二维码建立的新微信会话，并取得页面、HTTP、服务端日志三层同链证据后，才能把普通资料标为真实验收完成：

1. 真机首次 `GET /me/profile` 与安全默认值展示；
2. 受控测试资料的 `PUT /me/profile`，确认版本严格递增并重新 GET 验证；
3. 两个受控会话提交同一旧版本，确认一个成功、另一个 `409 user-profile-conflict`；
4. 真实日志中的 `user.profile.*` 事件与请求 `traceId/requestId` 关联，且没有敏感字段。

当前二维码尚未产生新的微信登录或患者业务事件，因此本审计不替代真机验收，也不授权真实账号资料写入。支付、医保、退款、预约写入和 HIS 回写继续保持最后专项关闭。
