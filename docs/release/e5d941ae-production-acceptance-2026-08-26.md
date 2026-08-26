# `e5d941ae` 新 API 生产共存发布验收记录（2026-08-26）
> 当前配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示本地 live 候选，未证明微信线上版本或真机业务已验收。

> 本记录证明服务端候选完成本地全量门禁、远端 bundle 校验、真实生产依赖 preflight、隔离 runtime smoke、原子切换和公网 runtime smoke。
> 它不把健康检查或认证边界误写成微信登录、患者、预约、门诊费用、Provider、支付或医保业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `e5d941aef3a8b0d1df24a518bea03f36f2ee505d` |
| 切换前服务端 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 小程序线上配套基线 | `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`） |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |
| 数据库 schema | `0016_patient_directory_sync_owner_index`，未执行 migration |

## 发布前证据

- 本地 `pnpm check` 通过：架构、迁移、Provider、文档、日志、错误码、release baseline、Biome、工具测试、9 个 workspace 类型检查、测试和构建全部通过。
- 工具测试：`99 pass / 0 fail / 747 expect()`；API 测试：`212 pass / 0 fail / 897 expect()`。
- 生产 env preflight 通过：微信身份、患者目录、预约目录/记录、门诊费用、MySQL、Redis 和 schema 均为 `ok`；支付和报告 gate 保持关闭。
- 候选远端 bundle 与本地产物 SHA-256 一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `b8f00b871d487a5d5cae65b05d9a3bd06989572c43ffbacbba0aa8eebbd99684` |
| `apps/worker/dist/index.js` | `baaffe2de767ea5818c67e54e382683ac4c2695231debb6c86ed6a04b9d61d95` |
| `apps/worker/dist/preflight.js` | `41c3efabe5963e7b6138cb6904b1c7f790884f009c65433e151107cd4647c549` |
| `apps/worker/dist/provider-directory-smoke.js` | `787c6aa90e877c80400dd6e9544012d1e9540b0b04ad14fc6489cf88e7d20b56` |
| `apps/worker/dist/api-runtime-smoke.js` | `82fde0f81e4dc5783eb50dc6f08dfd8a8cf0706a9f914be2115961fed098d295` |
| `apps/worker/dist/p0-log-aggregate.js` | `280b175341c2794290ab61bf6175295922c79bd588972732f05caefa0bd54746` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `afa687b6e52021237f275e808466800433bd8d48a344c7c879f944e5a2a1eb9e` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `ea1997c6beb5715caf67ee462d6e685065e65f17d97df25ef9eb479f79f88b72` |

## 隔离 runtime smoke

候选使用服务器真实 `shared/api.env`，以 `NODE_ENV=production`、`127.0.0.1:18082` 启动，未接收公网流量。
同一 release 的 smoke bundle 结果如下：

| 检查 | 结果 |
| --- | --- |
| 启动日志 | `environment=production`、`runtimeMode=production` |
| 依赖探针 | `database=ok`、`redis=ok`、`schema=ok` |
| `health-live` | `200` |
| `health-ready` | 连续 `3/3`，`200` |
| `system-ping` | `200` |
| 未登录认证边界 | `401 unauthorized` |
| 关闭能力边界 | `404 not-found` |
| 临时端口 | smoke 结束后已回收，`18082` 无残留 |

隔离 smoke 没有携带微信 code、Bearer、患者标识、Provider 原始参数、支付或医保字段。

## 原子切换与共存验收

2026-08-26 18:01 CST 左右，先确认 `current=8eb51b5f`、旧 Python Gunicorn PID 集合未变化、`18082` 已释放，再执行同目录：

```text
current.next -> releases/e5d941aef3a8b0d1df24a518bea03f36f2ee505d
mv -Tf current.next current
只重启 hospital-platform-api-v2.service
```

切换后结果：

- `current` 指向 `/home/ps/code/hospital-platform/releases/e5d941aef3a8b0d1df24a518bea03f36f2ee505d`。
- 新 API 为 `active`，监听 `10.0.0.3:18081`；启动日志明确为 production，依赖探针全部 `ok`。
- 旧 Python 的 `3687390、3687419、3687420、3687421、3687422` 进程仍存活，`0.0.0.0:8001` 持续监听。
- Worker 仍为 `inactive`，没有启动支付/医保/HIS 写回任务。

## 公网 runtime smoke

使用同一 `e5d941ae` bundle 对 `https://test-hp.meiyi.pro/api/v2` 验证：

- live `200`；
- ready 连续 `3/3` 为 `200`，database/redis/schema 均为 `ok`；
- system ping `200`；
- 未登录认证边界 `401 unauthorized`；
- 关闭能力边界 `404 not-found`。

启动 journald 记录包含 `environment=production`、`runtimeMode=production`、`authRuntimeStatus=ready`、
`persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok` 和 `persistenceSchemaProbe=ok`。日志只保留结构化低敏字段，未输出环境变量值、令牌、患者标识或 Provider 原文。

## 业务边界与回滚

本次只完成服务端运行层发布和新旧服务共存复核；真实微信登录、患者切换、预约历史、爽约、门诊费用和 Provider 业务仍需绑定同一小程序来源、页面、客户端 requestId、服务端 Pino 和 Provider 低敏 requestId 逐域取证。

支付、医保授权/结算、预约写入/取消、退款、HIS 回写、报告 Provider 和 Worker 继续关闭。

若出现新 API readiness、公网路径或旧 `8001` 异常，只能把 `current` 原子切回
`releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` 并只重启新 API；禁止停止旧 Python、删除 release、清空 Redis 或回滚 schema。
