# 原生小程序会话与依赖暂时故障边界（2026-08-24）

> 状态：本地代码候选已补回归，尚未因本轮改动重新部署。本文不把本地测试当作真机或线上故障注入验收。

## 1. 为什么单独冻结这条边界

线上曾出现过两类容易被页面混淆的错误：

- `401 unauthorized`：服务端明确拒绝当前 Bearer，会话可能已经失效；
- `503 persistence-temporarily-unavailable`：数据服务暂时不可用，不能据此推断 token 失效。

如果把所有非 2xx 都当成登录失效，页面会清理仍然有效的会话并重复微信登录；如果把 401 当成普通列表空结果，
页面又会继续展示旧患者上下文。两者必须在请求层和页面状态层保持不同语义。

## 2. 当前请求规则

| 请求类型 | 收到 `401` | 收到 `503` 或其它非 `401` 故障 |
| --- | --- | --- |
| 独立受保护 `GET` | 最多重新建立一次微信会话并重试；同一新会话再次 401 时清理确定失效的 token | 原样保留稳定错误码，不清理 token，不重新登录 |
| 已绑定患者的 `requestWithStableSession` `GET` | 不自动登录、不重放旧 `patientId`；只有当前代际仍匹配时清理失效 token | 原样抛出依赖/Provider 错误，保留当前 token 和患者会话代际 |
| `PUT`/`POST`/`DELETE` 命令 | 不自动重放；当前 token 确定失效时只清理旧会话 | 不把暂时故障转换为登录失效，也不重复提交请求体或幂等键 |

这里的“保留 token”不代表本次业务成功，只代表仍保留用户重新点击或稍后重试的会话条件；页面必须显示稳定中文错误，不能显示空列表
或继续提交旧的患者上下文。

## 3. 实现位置与中文注释

- `apps/miniprogram/src/services/api-client.ts`
  - `requestWithSession` 只进入恢复分支 `statusCode === 401`；
  - `requestWithStableSession` 固定 token/会话代际，只允许患者范围只读 GET；
  - 503 和 Provider 错误通过 `ApiError.code` 传递，不触发 token 清理。
- `apps/miniprogram/src/services/session-service.ts`
  - `/me` 验证的 `401` 映射为 `invalid`；
  - 持久化、网络或 Provider 暂时故障映射为 `unavailable`，不误报退出登录。
- `apps/miniprogram/src/services/api-client.test.ts`
  - 新增“患者范围固定代际读取遇到持久化暂时故障时保留会话且不重放”回归，断言请求次数、登录次数、token 清理次数和 token 值。

## 4. 本地证据

```text
pnpm --filter @hospital/miniprogram test -- src/services/api-client.test.ts
223 pass / 0 fail / 1648 expect()
```

该命令包含原生小程序全套 acceptance、运行包来源、会话、患者上下文、预约、资料和费用相关回归；本轮新增用例确认：

1. 已确认患者上下文的 GET 收到 `503 persistence-temporarily-unavailable` 后只发出 1 次请求；
2. 不调用 `wx.login()`；
3. 不删除 token；
4. 不把旧 `patientId` 重放到新会话。

## 5. 发布边界

本轮只修改新项目测试与文档，没有重启 API、修改生产 env、写入 MySQL/Redis 或修改旧 Python 服务。当前生产仍以 `13f597ea` 为准，
真实微信登录、患者切换和业务页面三层证据仍待当前候选重新扫码取得。支付、医保、退款、预约写入和 HIS 回写继续关闭。
