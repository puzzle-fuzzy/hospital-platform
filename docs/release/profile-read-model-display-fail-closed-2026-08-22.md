# 普通资料读模型失效与会话失效边界（2026-08-22）

> 当前小程序候选：`937bb2ad`；完整运行包来源：`937bb2ad2c71a2e83fac679939d31ed6bb3f0996`。本记录只描述前端错误分流，不代表真实微信或生产资料读写验收已经完成。

## 1. 为什么要拆分两类错误

普通资料页同时依赖平台登录会话和资料读模型。两者出错时，页面处理不能相同：

| 错误事实 | 页面处理 | 不能做的事 |
| --- | --- | --- |
| 没有 token、`unauthorized`、`session-changed` | 清空资料展示并回到登录入口 | 不能继续把旧资料当成当前账号 |
| `persistence-invalid` | 清空资料展示，留在资料页等待刷新 | 不能把数据层损坏误报成“未登录” |
| `persistence-temporarily-unavailable`、普通网络错误或其他临时 5xx | 保留最近一次已确认资料，提示重试 | 不能把暂时不可用误清成空资料 |

这里的关键是不把“资料读模型不能读取”推导成“微信登录已经失效”。如果混用这两类状态，用户会被错误地跳转到登录页，维护人员也会把 Redis/数据库故障误判成授权问题。

## 2. 当前代码约束

- `shouldClearProfileDisplay()` 只负责判断旧资料是否还能安全展示；它包含 `persistence-invalid`。
- `shouldReturnToLogin()` 只负责判断是否必须重新登录；它只接受明确的会话失效事实。
- `showError()` 使用 `shouldReturnToLogin()` 决定是否回到登录入口，不再复用“清理展示状态”的判断。
- 清空资料后仍可留在资料页，是为了让用户执行刷新；这不是降级成可编辑空表单，保存动作仍受当前资料快照和会话代际校验保护。
- 资料 GET/PUT 成功后只使用服务端完整快照回写页面，不能用本地请求值伪造保存结果。

## 3. 回归证据

当前已完成本地静态验收：

```text
pnpm --filter @hospital/miniprogram test
205 pass / 0 fail / 1542 expects

pnpm --filter @hospital/miniprogram build
通过；14 个页面入口

pnpm --filter @hospital/miniprogram runtime:verify
通过；dist/ 不包含 *.test.js 或 *.spec.js
```

专项测试覆盖两个边界：

1. 会话所有者丢失时必须回到登录入口；
2. `persistence-invalid` 必须清空资料展示，但不能触发登录跳转。

## 4. 真机验收仍未完成的部分

需要在当前 `apps/miniprogram/` 项目普通编译后，用同一微信会话分别观察：正常资料读取、Redis 暂时不可用、资料读模型失效、会话过期，以及资料保存期间会话代际变化。每条都要同时保存页面结果、客户端 `requestId` 和服务端低敏日志；在此之前只能标记为代码和本地测试完成，不能标记为生产业务完成。

本次没有修改旧 Python 服务、旧域名、旧 MySQL、旧 Redis 或并行会话维护的众阳自动化代码。
