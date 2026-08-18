# `b7c9451` P0 同链证据门禁候选验收

更新时间：2026-08-18 23:37 CST

## 1. 结论

`b7c9451` 已完成服务端构建产物校验、真实生产配置 preflight 和隔离运行时 smoke。候选包可以进入下一次受控切换窗口，但本次**没有切换 `current`、没有重启正式 API、没有启动 Worker**。

当前线上仍保持：

- 新 Bun/Elysia API：`/home/ps/code/hospital-platform/current -> releases/c26e696`，监听 `10.0.0.3:18081`；
- 旧 Python/Gunicorn API：继续监听 `0.0.0.0:8001`，未停止、未重启、未修改；
- `hospital-platform-worker.service`：保持 inactive；
- 临时候选端口 `127.0.0.1:18082`：冒烟结束后已释放。

本轮没有执行数据库迁移，没有写入 MySQL/Redis，没有打开预约写入、支付、医保、退款或 HIS 回写。真实微信会话、患者切换、预约历史、爽约、报告和门诊费用的三层业务证据仍需后续在当前 release 或受控切换后的候选上重新采集。

## 2. 候选产物来源与远端校验

候选目录：`/home/ps/code/hospital-platform/releases/b7c9451`。以下 SHA-256 是本地构建产物上传后在服务器逐项计算的结果；任何一项不一致都不能进入切换步骤。

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `a3caab446e9922f1322e6a797be2bbf4f7ea808d73b5f898a6faa8c468ad3cfd` |
| `apps/worker/dist/index.js` | `28ed16524fc2ad021d4406528b794a434b928156b102545a973c5c89f0fbff65` |
| `apps/worker/dist/preflight.js` | `63d6f7658620fcce3bfea146990c42d6a0b7edb742798af351aefdd6eae57859` |
| `apps/worker/dist/provider-directory-smoke.js` | `8486a5668b6155a7523fe2dcbe4d285c028ac5d013108d80898b03172b7a01fe` |
| `apps/worker/dist/api-runtime-smoke.js` | `ee24f42c4b667b1d8e08bab341c1d34d409e0baf7a1896c446d0261d8e76abff` |
| `apps/worker/dist/p0-log-aggregate.js` | `0b62c36d0a546eacd31b0ed6cb1c0c92412f06868eab4f3475e50bd72de65864` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `75fa9071358ebf29a24ef61055cccf7ef7decd164eacf7a2948cfae699e65500` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `08e0406e23be04c7f266b67d5a4327827fc347433a90e6b7e137ac0a1ad60127` |

## 3. 真实生产配置 preflight

候选使用服务器已有的 `/home/ps/code/hospital-platform/shared/api.env`，没有在日志中打印密钥、连接串或 token。结果如下：

| 检查项 | 结果 |
| --- | --- |
| 运行模式 | `production` |
| runtime configuration | passed |
| 微信身份 | `configured` |
| 微信支付 | `disabled`，符合当前暂不进入支付阶段的边界 |
| 众阳患者目录 | `configured` |
| 众阳预约目录 | `configured` |
| 众阳预约历史 | `configured` |
| 众阳门诊费用 | `configured` |
| 报告目录/详情 | `disabled`，没有伪造未冻结的 Provider 能力 |
| MySQL | passed |
| Redis | passed |
| schema | `verified`，基线为 `0016_patient_directory_sync_owner_index` |

## 4. 候选隔离运行时 smoke

候选 API 临时绑定 `127.0.0.1:18082`。因为这是直接访问 Elysia 的内部监听地址，业务 smoke 使用 `/api/v1`；公网 Nginx 转发验收才使用 `/api/v2`。这一区分避免把公网前缀错误地拼到内网服务上。

| 检查项 | 结果 |
| --- | --- |
| 启动日志 | `environment=production`、`runtimeMode=production`、`persistenceDatabaseProbe=persistenceRedisProbe=persistenceSchemaProbe=ok` |
| live | HTTP `200` |
| ready | HTTP `200`，连续 `3/3`，依赖稳定为 `ok` |
| system ping | HTTP `200` |
| 未登录认证边界 | `me`、`patients`、预约目录、预约历史、报告、门诊费用均返回 HTTP `401` 和 `unauthorized` |
| 临时进程回收 | 已收到停止信号，`18082` 已释放 |

## 5. 本候选包含的 P0 证据修正

`p0-log-aggregate` 现在会优先使用 `traceId`、其次使用 `requestId` 建立单次请求关联链，只输出 SHA-256 指纹和事件计数，不输出原始 trace/request 值。`p0-business-evidence-audit` 要求“请求事件”和“成功事件”必须出现在同一条关联链中；只在不同请求之间凑出总数，或关联链被截断、缺失，均不能通过。

这条门禁只修正验收证据的真实性，不会把没有真实微信会话或 Provider 返回的业务误判为完成。候选未切换前，线上 journald 仍不能被解释为已经使用该新门禁；下一次切换后必须重新聚合对应时间窗口并保留候选来源。

## 6. 下一步停止条件

只有在以下条件同时满足时，才可以把候选原子切换到 `current`：

1. 再次确认旧 Python `8001` 的 PID、监听和健康状态未漂移；
2. 再次确认 `current` 的实际目标为 `c26e696`，并保存回滚指针；
3. 只重启 `hospital-platform-api-v2.service`，不触碰旧服务，不启动 Worker；
4. 切换后重新验证内网 `/health/*`、公网 `/api/v2/health/*`、公网 `system/ping`、未登录 `401` 和新旧监听；
5. 使用真实微信会话完成患者同步/切换及当前允许的只读业务证据；支付、医保、退款和 HIS 回写仍保持关闭，直到对应 Provider contract、金额边界和真机验收独立通过。
