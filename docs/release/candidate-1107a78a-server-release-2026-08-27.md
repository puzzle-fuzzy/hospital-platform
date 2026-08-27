# 服务端独立候选 `1107a78a` 发布记录（2026-08-27）

> 本候选只更新新 Bun/Elysia API 运行包，不上传微信线上小程序版本。当前真机配套使用本地 live
> `0be59f96`；线上历史小程序仍为 `13f597e`。服务端与小程序来源不同是分层发布，不代表业务证据可以跨版本拼接。
> 本记录证明候选构建、生产依赖、隔离 smoke 和新旧服务共存切换，不代表微信真机、众阳、HIS、支付或医保完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `1107a78a47ac2fbe0557958251d66da9effc66de` |
| 小程序客户端 | `0be59f96` |
| 小程序构建来源 | `0be59f966de2c3a0861cb44e9a526a1ef557f6c7` |
| 服务端运行时变化 | 门诊费用 service 将运行时非字符串或空白渠道码统一收敛为依赖未配置，避免直接 `trim()` 产生未映射 TypeError；其余支付、报告和写入能力继续 fail-closed |
| 数据库 schema | 未新增 migration；使用线上已验证 `0016_patient_directory_sync_owner_index` |
| Worker | 未启动，继续保持 inactive |

## 服务端构建产物

服务端 bundle 在本地使用 Bun 构建后上传到独立 release 目录，没有在生产目录现场构建。远端文件与本地产物逐项 SHA-256 一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `7ca2fce058d3436bed526040fe5c41327339da2891b35ee2d8c8d63ace57a8a9` |
| `apps/worker/dist/index.js` | `baaffe2de767ea5818c67e54e382683ac4c2695231debb6c86ed6a04b9d61d95` |
| `apps/worker/dist/preflight.js` | `41c3efabe5963e7b6138cb6904b1c7f790884f009c65433e151107cd4647c549` |
| `apps/worker/dist/provider-directory-smoke.js` | `787c6aa90e877c80400dd6e9544012d1e9540b0b04ad14fc6489cf88e7d20b56` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `ea1997c6beb5715caf67ee462d6e685065e65f17d97df25ef9eb479f79f88b72` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |

## 发布前门禁

- API 测试 `213 pass / 0 fail / 899 expect()`、API TypeScript 检查和 Biome 检查通过。
- 真实 production env preflight 通过：微信身份、患者目录、预约目录/记录、门诊费用已配置；支付、报告 gate 关闭；MySQL、Redis、schema 均为 `ok`。
- 候选在 `127.0.0.1:18082` 以 `runtimeMode=production` 启动，live `200`、ready 连续 `3/3`、system ping `200`、未登录边界 `401`、关闭能力 `404` 均通过。
- 隔离进程按 PID 正常 SIGTERM 回收，`18082` 无残留；没有 migration、Redis 清理、真实 Provider、支付、医保或 HIS 写入。

## 原子切换与共存验收

2026-08-27 约 10:02 CST，先确认 `current=e5d941aef3a8b0d1df24a518bea03f36f2ee505d`、旧 Python `8001` 监听及 Gunicorn PID 集合未变化、`18082` 已释放，再执行同目录原子切换：

```text
current.next -> releases/1107a78a47ac2fbe0557958251d66da9effc66de
mv -Tf current.next current
只重启 hospital-platform-api-v2.service
```

切换后结果：

- `current` 指向 `/home/ps/code/hospital-platform/releases/1107a78a47ac2fbe0557958251d66da9effc66de`。
- 新 API 为 `active`，监听 `10.0.0.3:18081`。
- 旧 Python 的 `3687390、3687419、3687420、3687421、3687422` 进程仍存活，`0.0.0.0:8001` 持续监听，PID 集合与切换前一致。
- Worker 仍为 `inactive`，没有启动支付/医保/HIS 写回任务。

## 公网 runtime smoke

使用同一 `1107a78a` bundle 对 `https://test-hp.meiyi.pro/api/v2` 验证：

- live `200`；
- ready 连续 `3/3` 为 `200`，database/redis/schema 均为 `ok`；
- system ping `200`；
- 未登录认证边界 `401 unauthorized`；
- 关闭能力边界 `404 not-found`。

公网 smoke 使用 HTTPS 默认证书校验通过；服务启动日志明确为 `environment=production`、`runtimeMode=production`、
`authRuntimeStatus=ready`，并记录 `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、
`persistenceSchemaProbe=ok`。日志只保留结构化低敏字段，未输出环境变量值、令牌、患者标识或 Provider 原文。

## 业务边界与回滚

本次只完成一个服务端运行时边界修复及新旧服务共存发布；真实微信登录、患者切换、预约历史、爽约、门诊费用和 Provider
业务仍需绑定同一小程序来源、页面、客户端 requestId、服务端 Pino 和 Provider 低敏 requestId 逐域取证。

支付、医保授权/结算、预约写入/取消、退款和 HIS 回写继续关闭；不启动 Worker，不改变旧 Python 服务。

若出现新 API readiness、公网路径或旧 `8001` 异常，只能把 `current` 原子切回
`releases/e5d941aef3a8b0d1df24a518bea03f36f2ee505d` 并只重启新 API；不得停止旧 Python、删除 release、清理 Redis 或回滚 schema。
