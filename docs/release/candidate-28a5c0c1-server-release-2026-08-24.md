# 服务端独立候选 `28a5c0c1` 发布记录（2026-08-24）

> 本候选只更新服务端运行包，不重建小程序运行包。线上小程序继续使用已经通过运行包门禁的
> `13f597e`；服务端与小程序来源不同是本次有意的分层发布，不代表配套关系失效。
> 本记录只证明服务端候选的构建、生产依赖和发布边界，不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `28a5c0c131794ce9dcc5f94bd3809402188ac87a` |
| 小程序客户端 | `13f597e` |
| 小程序构建来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 服务端变更范围 | 四个只读众阳 adapter 的运行时输入门禁 |
| 小程序运行包变更 | 本次未重建，继续使用线上已验收运行包 |

## 服务端构建产物

服务端 bundle 在本地使用 Bun 构建，再上传到独立 release 目录；没有在生产 release 目录直接构建。
8 个 API/worker bundle 均完成远端 SHA-256 校验，摘要如下：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `ca13817a77dee6ae105121ecb75c83eaea938b24a492c6d4a866ebe98550b062` |
| `apps/worker/dist/index.js` | `df43cad8f40cb80772f5b30c4fea09b4fe5e51c95174a32997433e2b715d5b4f` |
| `apps/worker/dist/preflight.js` | `44bb4332b6db1a6f596f36a03c6431a6928bb08de8607c1a87ebcb3656085447` |
| `apps/worker/dist/provider-directory-smoke.js` | `1138c0f9fa06d398ef463954cf9fd8836e873e892ca54094cd146dc27570f28a` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50df6c08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `bacb3293d4f229299ddf035e89e010dc3dd3af2b9b592e477e91b58f88fb78ff` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |

## 已通过的服务端门禁

- Bun API/worker bundle 构建通过；仓库 TypeScript 检查 `9/9` 通过。
- 生产 env preflight 通过：微信身份已配置，MySQL、Redis、schema 均为 `ok`；支付和报告能力仍关闭。
- 临时 `127.0.0.1:18082` production runtime smoke 通过：live、ready 连续 3 次、system ping、未登录 `401`、关闭能力 `404`。
- 临时 smoke 进程已按精确 PID 回收，`18082` 已释放；没有清理 Redis、迁移数据库或访问真实 Provider。

## 小程序边界

本次没有强行关闭微信开发者工具，也没有覆盖用户的 `project.config.json`。由于工具锁定
`apps/miniprogram/dist`，小程序没有重新构建；当前真机必须继续打开正确项目并核对
`dist/build-info.json.sourceRevision=13f597ea9ee3f65b9be858117826d948339d904a`。
不得把本次服务端 release `28a5c0c1` 写成新的小程序二维码来源。

## 真机准入

当前真机只能使用 `13f597e` 运行包，对线上 `28a5c0c1` 服务端按微信登录 → 患者显式切换 →
预约历史在线/全部 → 爽约 → 门诊费用只读顺序取证。页面、客户端 `requestId`、服务端 Pino
事件和 Provider 低敏 requestId 必须来自同一会话；没有这些证据时，不能把 runtime smoke 或
空日志窗口写成业务成功/失败。
