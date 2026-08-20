# 小程序历史候选真机三层证据记录模板（`9340846`）

> 本模板已被当前候选 [`miniprogram-real-device-evidence-template-6677671.md`](miniprogram-real-device-evidence-template-6677671.md) 替代，仅用于追溯。

> 本文件是空白记录模板，不代表任何业务已经验收。每条 `passed` 必须同时具备真机页面、客户端 HTTP 和服务端低敏日志三层证据。

## 候选锁定

| 项目 | 现场记录 |
| --- | --- |
| 服务端 release | `5a31427` |
| 小程序提交 | `9340846` |
| 完整运行包来源 | `93408462f3eeadffed172f1ea3b10c043d461b1b` |
| 开发者工具项目 | `miniprogram` |
| 运行根目录 | `apps/miniprogram/dist/` |
| `dist/build-info.json.sourceRevision` | 必须等于上述完整来源 |
| 是否使用历史二维码 | 必须为“否” |

## 记录规则

1. 先普通编译并核对 `build-info.json`，再生成二维码；不要使用旧候选二维码。
2. 页面证据记录真实页面状态和截图；只有 HTTP 200 不算业务成功。
3. 客户端记录脱敏后的 `requestId`、HTTP 状态和页面动作；不要记录 token、身份证、完整卡号或原始 JSON。
4. 服务端只记录同链的低敏业务事件、结果和有限 Provider 请求号；不要复制 Provider 原始身份字段。
5. GET 可在明确会话失效时恢复；POST/PUT/支付等命令不得自动重放。

## 可执行证据清单

页面操作完成后，使用脱敏 JSON 记录同一候选的六个 P0 业务域：`candidate` 必须包含服务端 release、
小程序提交和 40 位 `sourceRevision`；每个 `passed` 域必须同时包含：

- `page.screenshot=true`、ISO 观察时间和不含患者身份的页面摘要；
- 无查询参数的 `/api/v2/` 客户端路径、UUID 形状的 requestId/traceId 和 HTTP 状态码；
- SHA-256 关联指纹、`requested/succeeded/http2xx/failed` 计数和 `auditPassed=true`。

`pending` 可以只记录固定原因；`passed` 不允许只凭页面或 HTTP 200 得出。工具会拒绝 token、Bearer、
身份证、完整卡号、Provider 患者号、原始报文和带敏感查询参数的 URL：

```powershell
pnpm device:evidence:audit -- --file .\path\to\redacted-device-evidence.json
```

工具输出只包含候选指纹、域名标签和安全计数，不回显输入中的敏感值；退出码为 `0` 仅表示所有六个域均通过，
`1` 表示仍有 pending/failed，`2` 表示清单格式或脱敏门禁失败。

## 业务取证表

| 业务 | 页面结果 | 客户端 requestId/状态 | 服务端事件/结果 | 结论 |
| --- | --- | --- | --- | --- |
| 微信登录与 `/me` | 待记录 | 待记录 | 待记录 | pending |
| 首页患者目录 | 待记录 | 待记录 | 待记录 | pending |
| 更换就诊人 | 待记录 | 待记录 | 待记录 | pending |
| 我的挂号 | 待记录 | 待记录 | 待记录 | pending |
| 爽约记录 | 待记录 | 待记录 | 待记录 | pending |
| 门诊缴费待缴/已缴 | 待记录 | 待记录 | 待记录 | pending |

## 立即停止条件

- 出现 `single-flight.test.js` ENOENT、页面 404 或 WXSS 本地资源错误；
- 患者切换后页面、请求和服务端 owner 不一致；
- 只有 HTTP 成功而没有同链业务成功事件；
- 入口调起支付、医保授权、退费、预约写入、HIS 写入或未配置 Provider 后返回伪成功。
