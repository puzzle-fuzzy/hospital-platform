# 下一业务闭环：普通个人资料真实验收计划（2026-08-25）

## 结论

下一项只推进普通个人资料 `GET /me/profile` 与 `PUT /me/profile` 的真实验收，不扩大到众阳、医保、微信支付、HIS 写回或旧 Python 服务。

选择它的原因是：资料只属于平台登录用户，不依赖患者临床映射和 Provider；当前代码已经具备 owner 隔离、版本条件更新、读模型校验、低敏日志和小程序页面。现在缺少的是当前运行包下的真实首次读取、一次合法写入、旧版本 `409` 和日志链证据，而不是继续增加新的未冻结业务接口。

## 当前边界

| 项目 | 当前事实 | 说明 |
| --- | --- | --- |
| 新 API | 生产 release `8eb51b5f` | 只读复核显示与旧 Python `8001` 共存；本轮不切换服务 |
| 小程序候选 | `c3c7eec30e9303ff9b8996876f452c05e3bd310d` | 项目最终固定使用微信原生 `tabBar`，直接打开 `apps/miniprogram/dist/` 独立工程；自定义底栏不再引入，仍需真机验收 |
| 资料字段 | 昵称、性别、年龄、邮箱、`version` | 不接受头像、手机号、身份证、实名字段、`openid`、`unionid` 或患者字段 |
| 写入策略 | `version` 条件更新 | 成功后必须返回 `expectedVersion + 1`；旧版本返回 `user-profile-conflict` |
| 日志 | `user.profile.*` + HTTP `x-request-id`/`traceId` | 不记录 userId、昵称、邮箱、Authorization 或请求正文 |
| 旧服务 | 不修改、不停止、不重启 | 资料验收只走新 API `/api/v2` |

## 当前运行层只读证据（2026-08-25）

本轮只通过内网 SSH inspection key 读取运行状态，没有写入配置、切换 release、重启服务或访问数据库内容：

| 检查项 | 结果 |
| --- | --- |
| 新 API release | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新 API 服务 | `hospital-platform-api-v2.service=active`，日志环境为 `production` |
| 旧 Python 服务 | `hospital-backend.service=inactive`（旧进程仍监听 `0.0.0.0:8001`，未被本轮操作触碰） |
| 新 API 内网监听 | `10.0.0.3:18081` |
| 公网 ready | `/api/v2/health/ready` 返回 `200`，`database/redis/schema=ok` |
| 未授权资料读取 | `/api/v2/me/profile` 返回 `401 unauthorized`，未触发 profile 业务事件 |

公网未授权探针的 requestId 为 `01a67c25-5870-4f33-b159-36c22c313038`；服务端只记录了低敏的
`http.request.failed`、`requestId`、`traceId`、路径、状态码和错误码，没有记录 Authorization 或请求正文。
这只能证明认证边界和日志链路正常，不能替代微信登录后的资料 GET，更不能替代 PUT/409 验收。

## 当前 SSH 只读复核（2026-08-25 00:54 CST）

通过 `ps@192.168.112.172` 的 inspection key 只读核对，没有修改配置、重启服务、写入数据库/Redis 或读取患者/Provider 原始数据：

| 检查项 | 结果 |
| --- | --- |
| `current` 发布目录 | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧服务边界 | `hospital-backend.service=inactive`；旧端口 `0.0.0.0:8001` 仍在监听，本轮未触碰 |
| 内部健康检查 | `/health/ready=200`，`/api/v1/system/ping=200` |
| 未登录资料接口 | `/api/v1/me/profile=401 unauthorized`；内部服务不直接挂 `/api/v2` 前缀 |

这组结果只证明新旧端口和认证边界仍在预期状态；不能把未登录 401、健康检查 200 或服务 active
当作资料真实读取、写入成功或并发 409 的业务证据。

## 真机操作顺序

必须使用当前二维码重新编译后的运行包，并先在控制台确认来源：

```text
   [医院小程序] 运行包来源：微信原生 tabBar；revision=c3c7eec30e9303ff9b8996876f452c05e3bd310d
```

随后使用专用测试微信账号执行：

1. 微信登录完成后进入“我的 → 个人资料”；记录 `GET /me/profile` 的客户端 requestId 和页面初始资料。
2. 若返回 `version=0` 的默认资料，修改一个合法字段并保存；确认响应是 `200`，且页面只采用服务端返回的 canonical 资料和递增版本。
3. 用同一测试账号保留一个旧版本请求，在另一会话先完成一次更新，再提交旧版本；确认返回 HTTP `409`、错误码 `user-profile-conflict`，页面退出可编辑态并要求重新加载，不能自动覆盖另一会话。
4. 下拉刷新取得新版本后再次保存，确认不会重复提交旧版本，也不会把患者选择或 Tab 导航状态清空。
5. 观察服务端同一 trace 是否出现 `user.profile.requested`、`user.profile.updated` 或 `user.profile.conflict`，并确认日志没有敏感正文。

真实写入只能使用可回滚的专用测试账号和已约定的测试资料；不能用患者真实姓名、身份证、手机号或生产用户资料做冲突测试。资料写入没有完成人工确认前，不把 HTTP 成功或本地测试写成业务迁移完成。

## 代码门禁

本轮代码不需要为“看起来有功能”新增兼容字段。当前必须保留以下不变量：

- HTTP 和 service 两层都拒绝未知字段，不能静默吞掉旧端 `avatar`/`openid` 等意图。
- 资料读取或保存期间发生会话代际变化时，页面清理旧快照并停止保存，不能把账号 A 的 `version` 发给账号 B。
- 仓储返回快照的 owner、字段、邮箱、年龄、性别和版本必须再次校验；后置版本不是本次版本加一时按 `409` 失败。
- Redis、数据库暂时故障不能被误报成未登录；只有明确会话失效才回主 Tab。
- 保存成功后的页面回退定时器必须按页面实例隔离并在 `onUnload` 清理。

以上边界已经由 `apps/api/src/modules/profile/`、`packages/domain/src/user-profile.ts`、`packages/persistence` 和小程序资料页回归测试覆盖；下一步重点是取得当前候选的真实证据，而不是复制一套第二实现。

## 暂不推进的业务

报告附件/影像、门诊病历、患者新增绑定、二维码、普通头像上传、预约写入、门诊支付、医保授权、退款和 HIS 回写分别缺少 Provider contract、资源授权、幂等或最终状态语义。继续保持 fail-closed；另一会话负责的众阳文档采集文件不在本轮修改范围内。

## 证据归档要求

验收记录只保存：运行包完整 revision、页面操作时间、客户端 requestId、HTTP 状态/错误码、服务端低敏 trace 事件和截图路径。不得把 access token、openid、session_key、身份证、完整卡号或 Provider 原始响应写入文档、终端历史或 Git。
