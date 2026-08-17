# 普通个人资料只读观察记录（2026-08-17）

> 本文只记录普通个人资料 `GET` 的真实会话只读证据，不代表资料首次写入、版本冲突、真机验收或头像/实名/手机号能力已经完成。

## 1. 观察范围

| 项目 | 结果 |
| --- | --- |
| 线上 release | `5f5915e`，production 模式 |
| 新旧服务边界 | 新 Elysia API `18081` 与旧 Python API `8001` 同时监听 |
| 会话来源 | 当前已登录的微信开发者工具模拟器会话 |
| 观察时间 | 2026-08-17 19:00-19:01 CST |
| 请求范围 | 只调用 `GET /api/v1/me/profile`；没有执行 `PUT`、支付、医保或 HIS 写回 |
| 脱敏边界 | 本文不记录 userId、token、requestId、姓名、邮箱或数据库原始行 |

## 2. 三层只读证据

### 页面层

从个人中心进入“编辑个人信息”页面成功。页面显示昵称、性别、年龄、邮箱四个普通资料字段，
并显示“资料边界”说明；默认资料展示为“微信用户”和“未知”，可选字段显示为空的输入提示。
页面没有把患者目录、微信身份或实名字段混入普通资料表单。

### HTTP 与服务层

服务端 journald 观察到两次真实资料读取的完整链路：

| 业务事件 | HTTP | 结果 |
| --- | ---: | --- |
| `user.profile.requested` → `user.profile.loaded` | 200 | `persisted=false`，返回安全默认资料 |
| `http.request.completed` | 200 | `GET /api/v1/me/profile` 成功结束 |

`persisted=false` 证明本次 GET 在没有资料行时走默认值分支；服务层没有在读取过程中隐式创建资料行。
请求由当前 Bearer 会话解析 owner，客户端没有提供 userId，也没有把微信用户资料误当作临床就诊人。

## 3. 开发者工具控制边界

本次为了打开页面和复测路由，使用了开发者工具的自动化控制和控制台导航。控制台同时出现了
`clickCheckTask`、`Cannot read property '0' of null` 以及 `undefined is not iterable` 等控制/渲染层日志；
堆栈位于微信开发者工具的 `WAServiceMainContext`，并与自动化点击/控制台操作同时产生。

因此本次证据只证明资料页面能渲染、资料 GET 能返回 200 和安全默认值，不把该模拟器控制层日志归因于
业务 API 成功，也不把本次结果描述成“调试器零错误”或真机验收。后续需要人工开发者工具操作或真机
复测页面错误计数，才能补齐干净的视觉证据。

## 4. 当前结论与下一步

普通资料已经从“没有真实微信请求证据”推进到“真实会话默认值只读闭环”：

`当前微信会话 → owner-scoped GET /me/profile → requested/loaded → persisted=false 默认资料 → 页面展示`

仍未完成：

- 使用受控测试资料执行一次真实 `PUT` 首次写入；
- 使用两个明确的版本值取得真实 `409 user-profile-conflict`；
- 真机页面和网络验收；
- 头像、手机号、实名、身份证、微信身份和任何患者绑定操作。

在获得明确的测试资料和写入授权前，不修改当前账号的个人资料。下一步仍先完成普通资料本地
contract 门禁和文档核对，再决定是否使用专用测试账号做首次写入/409 验收。

相关规则见 [`普通个人资料契约`](../migration/user-profile-contract.md)、[`P0 只读业务验收手册`](p0-readonly-business-acceptance-runbook-2026-08-17.md)、
[`日志规范`](../logging.md) 和 [`当前服务器 P0 只读观察`](current-server-p0-observation-2026-08-17.md)。
