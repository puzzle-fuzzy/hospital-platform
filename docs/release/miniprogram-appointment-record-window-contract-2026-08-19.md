# 小程序预约记录窗口运行时契约（2026-08-19）

## 结论

本次只收紧原生小程序“我的挂号”和“爽约记录”的查询窗口边界，不修改预约 Provider、Elysia API、MySQL、Redis、旧 Python 服务，
也没有打开预约写入、锁号、取消、详情、支付或医保。

`createAppointmentRecordQuery` 现在会在生成日期窗口和发起请求前验证窗口值：

- `history`：查询中国标准时间前后各 90 天的预约历史；
- `missed`：只查询过去 90 天，再从服务端明确返回的 `missed` 状态派生爽约记录；
- 其他运行时值：返回 `appointment-record-query-invalid`，不降级成 `history`，不发起网络请求。

## 为什么必须 fail-closed

`AppointmentRecordQueryWindow` 是 TypeScript 联合类型，只能约束编译期代码。微信事件、页面参数、旧缓存或未来页面改动仍可能在运行时传入未知字符串。
如果未知值直接落入原来的 `history` 分支，用户点击“爽约记录”时可能得到普通挂号历史；接口状态为 200 也无法证明业务语义正确。

因此窗口值必须在客户端请求构造层拒绝。服务端仍保留自己的 query schema、日期窗口、owner 映射和 Provider 权限校验；客户端门禁不是授权替代，而是避免无意义请求和错误日志的第一道边界。

## 日志与错误边界

本次错误发生在小程序请求构造前，不会产生预约 Provider 请求或服务端业务事件。若未来存在绕过客户端的非法 query，服务端继续使用稳定错误码 `appointment-record-query-invalid`，日志不得记录患者身份证、Provider 患者号或原始 query。

## 验证证据

- `apps/miniprogram/src/services/dashboard-service.test.ts` 新增未知窗口回归，断言稳定错误码；
- 小程序定向测试及既有 acceptance 测试：`159/159` 通过，`1253` 个断言；
- 小程序 TypeScript 检查通过；
- 文档链接审计通过：200 个文档，无断链；
- `git diff --check`（排除用户正在修改的 `apps/miniprogram/project.config.json`）通过。

本地门禁不替代真实微信设备、真实 Provider、线上 HTTP 和低敏日志三层验收；本次代码尚未作为新 release 部署，也没有重启任何服务。
