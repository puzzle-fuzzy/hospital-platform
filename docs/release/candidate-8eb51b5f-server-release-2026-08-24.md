# 服务端独立候选 `e5d941ae` 发布记录（2026-08-26）

> 本候选只更新新 Bun/Elysia API 运行包，不上传微信线上小程序版本。当前真机配套使用本地 live
> `0be59f96`；线上历史小程序仍为 `13f597e`。服务端与小程序来源不同是分层发布，不代表业务证据可以跨版本拼接。
> 本记录证明候选构建、生产依赖、隔离 smoke 和新旧服务共存切换，不代表微信真机、众阳、HIS、支付或医保完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `e5d941aef3a8b0d1df24a518bea03f36f2ee505d` |
| 小程序客户端 | `0be59f96` |
| 小程序构建来源 | `0be59f966de2c3a0861cb44e9a526a1ef557f6c7` |
| 服务端运行时变化 | 收紧 owner/患者/外部会话/时间窗口边界，统一预约与费用只读 adapter 投影，保留支付、报告和写入能力的 fail-closed 门禁 |
| 数据库 schema | 未新增 migration；使用线上已验证 `0016_patient_directory_sync_owner_index` |
| Worker | 未启动，继续保持 inactive |

## 服务端构建产物

服务端 bundle 在本地使用 Bun 构建后上传到独立 release 目录，没有在生产目录现场构建。远端文件与本地产物逐项 SHA-256 一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `b8f00b871d487a5d5cae65b05d9a3bd06989572c43ffbacbba0aa8eebbd99684` |
| `apps/worker/dist/index.js` | `baaffe2de767ea5818c67e54e382683ac4c2695231debb6c86ed6a04b9d61d95` |
| `apps/worker/dist/preflight.js` | `41c3efabe5963e7b6138cb6904b1c7f790884f009c65433e151107cd4647c549` |
| `apps/worker/dist/provider-directory-smoke.js` | `787c6aa90e877c80400dd6e9544012d1e9540b0b04ad14fc6489cf88e7d20b56` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `ea1997c6beb5715caf67ee462d6e685065e65f17d97df25ef9eb479f79f88b72` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |

## 发布前门禁

- 本地 API/Worker 构建和 TypeScript 检查通过。
- 真实 production env preflight 通过：微信身份、患者目录、预约目录/记录、门诊费用已配置；支付、报告 gate 关闭；MySQL、Redis、schema 均为 `ok`。
- 候选在 `127.0.0.1:18082` 以 `runtimeMode=production` 启动，live `200`、ready 连续 `3/3`、system ping `200`、未登录边界 `401`、关闭能力 `404` 均通过。
- 隔离进程按 PID 正常 SIGTERM 回收，`18082` 无残留；没有 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 当前线上状态

候选已于 2026-08-26 18:01 CST 按原子切换手册上线。切换前 `current` 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；切换时只执行新 API 单元的 restart。

| 检查 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/e5d941aef3a8b0d1df24a518bea03f36f2ee505d` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python | 继续监听 `0.0.0.0:8001`，没有停止、重启或修改 |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 依赖 | 内网 readiness 与公网 readiness 均为 `200`，database/redis/schema 均为 `ok` |
| 启动模式 | journald 明确记录 `environment=production`、`runtimeMode=production` |

新 API readiness 在切换后窗口内通过；公网 `https://test-hp.meiyi.pro/api/v2` runtime smoke 的 live、ready 连续 `3/3`、system ping、未登录 `401` 和关闭能力 `404` 全部通过。

## 业务边界

普通资料 PUT 的真实首次写入、恢复值和同 owner 双会话 `409` 仍未执行；本次部署收紧运行时 owner、时间和 adapter 边界，不把运行层 smoke 当作普通资料业务验收。微信真实登录、患者显式切换、预约历史、爽约、门诊费用和报告仍需页面、客户端 requestId、服务端 Pino 与 Provider 低敏 requestId 同链取证。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭；不启动 Worker，不改变旧 Python 服务。

若需要回滚，只能把 `current` 原子指回切换前的 `8eb51b5ffe85b0b8f8a032783f893117d3df549d` 并只重启新 API；不得停止旧 Python、删除 release、清理 Redis 或回滚 schema。
