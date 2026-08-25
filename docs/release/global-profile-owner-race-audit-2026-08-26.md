# 全局微信资料 owner 回调边界审计（2026-08-26）

> 本轮只修改新项目，未修改旧 Python 服务、旧数据库、旧 Redis、线上进程或微信开发者工具当前锁定的 live `dist/`。
> 该文档记录一个跨 Tab 的客户端业务一致性修正，不代表已经完成新的真机发布或线上切换。

## 1. 发现的问题

微信头像/昵称授权是用户手势触发的异步回调，可能晚于以下任一事件返回：

- 当前账号退出或重新登录；
- 另一个 bundle 收到会话失效并清理全局资料；
- 资料仓库被重置，但会话代际号尚未同步推进。

原有成功路径只校验 `sessionGeneration`。如果全局 `ownerId` 已经被清空而代际暂时保持不变，旧授权结果仍可能继续写入头像、昵称，甚至触发普通资料 PUT，造成新 Tab 看到旧账号资料。

## 2. 修正后的不变量

授权回调在写入本机缓存、更新全局快照和提交资料 PUT 前，必须同时满足：

1. 当前会话代际仍等于授权开始时的代际；
2. 全局 `ownerId` 仍等于授权开始时的 owner；
3. 全局资料状态仍为 `ready` 或可降级授权的 `error`；
4. 任一条件不满足，都返回 `session-changed`，不写缓存、不写全局资料、不发 PUT。

`error` 被保留为允许状态，是因为普通资料 GET 暂时不可用时，当前 owner 仍可以通过明确手势取得微信资料；这不等同于会话失效。

## 3. 代码与测试证据

| 项目 | 位置 |
| --- | --- |
| 上下文校验 | `apps/miniprogram/src/services/global-user-profile.ts` 的 `assertCurrentWechatProfileContext` |
| 成功回调保护 | `apps/miniprogram/src/services/global-user-profile.ts` 的微信资料读取和 PUT 返回提交前 |
| 回归测试 | `apps/miniprogram/src/services/global-user-profile.test.ts` 的“资料快照被清理但代际尚未推进时，旧授权成功回调也不能回写” |

本地验证结果：

```text
全局资料定向测试：9 pass / 0 fail / 53 expect()
小程序全量测试：286 pass / 0 fail / 3217 expect()
小程序类型检查：通过
```

## 4. 运行与发布边界

本修正只影响源码和待发布候选，必须在新的 pending 运行包重新构建、通过 runtime verify、导入正确的 `dist/` 工程后，才可以进行真机授权验证。
当前微信开发者工具仍可能锁定旧 live `dist/`；在锁定未释放前不能覆盖旧包，也不能把本地测试结果写成线上证据。

