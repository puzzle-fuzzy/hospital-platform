# `daee96d` 生产切换与 Provider 失败诊断验收（2026-08-17）

## 结论

候选 `daee96d` 已完成本地门禁、服务器真实生产 env preflight、候选临时端口 smoke，并于 2026-08-17 15:39 CST 左右原子切换为新 API 的生产 `current`。切换后只重启 `hospital-platform-api-v2.service`；旧 Python 服务 `8001` 未停止、未重启，Worker 仍保持 inactive。

本次发布只增强 Provider 失败的低敏诊断字段和日志文档，不改变 Provider 请求、重试、响应契约、支付、医保、退款或 HIS 写回。真实微信会话、患者切换、预约历史和门诊费用 Provider 业务仍需真机或受控账号验收。

## 1. 本地门禁

提交 `daee96d8bd23ca3fa5f687685e0652fbf8f70060` 已推送 `origin/main`。以下命令全部通过：

- `pnpm typecheck`；
- `pnpm lint`；
- `pnpm format:check`；
- `pnpm docs:audit`：98 个 Markdown 文档无断链；
- `pnpm architecture:audit`：26 条边界规则通过；
- `pnpm test`：9 个包成功，API 95 项测试、457 个断言通过；
- `pnpm build`：9 个包成功，原生小程序生成 14 个页面运行脚本。

工作树中已有的 `apps/miniprogram/project.config.json` 用户修改未纳入提交。

## 2. 本次代码边界

Provider 失败现在由统一白名单函数提取以下低敏字段（字段存在时才记录）：

- `provider`；
- `providerOperation`；
- `providerRequestId`；
- `providerStatusCode`；
- `providerRetryable`。

覆盖 HTTP 请求失败、微信身份登录失败、预约目录/预约历史失败、门诊费用失败、报告目录/详情失败。原始 `Error.message`、URL、请求体、响应体、患者号、金额、医保字段、token 和凭证不会进入日志。微信登录继续保留旧的 `retryable` 别名，避免破坏既有告警查询。

## 3. 候选上传与生产 preflight

候选 release 为 `/home/ps/code/hospital-platform/releases/daee96d`，上传后远端五个 bundle 的 SHA-256 与本地产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `eac69801492f4bd75c53c8b727a3005ad1ac9a82ee62618983c67d29e8b73bf9` |
| `apps/worker/dist/index.js` | `5d22ca8ed3b9d78791d967bb73c2c0792fff47fc020d2da202faa4e62cebf6d1` |
| `apps/worker/dist/preflight.js` | `f9e8e350db6806ec2212cd2818630755bd1b6787ed1ec7631686df740c7a40ff` |
| `apps/worker/dist/provider-directory-smoke.js` | `635bc31b1732a52bd6399c5b19d1256679004505d6ef9d60d7b319b7e6255d90` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

2026-08-17 15:38 CST 使用服务器既有 `shared/api.env` 执行 preflight，结果为：

- `environment=production`；
- MySQL：`ok`；
- Redis：`ok`；
- schema：`schemaStatus=verified`，目标为 `0016_patient_directory_sync_owner_index`；
- 微信身份、患者目录、预约目录、预约历史、门诊费用配置为 `configured`；
- 微信支付、报告目录、报告详情保持 `disabled`。

preflight 只读取依赖和配置 gate，没有执行 migration、Provider 业务请求、支付、医保、退款或 HIS 写入。

## 4. 候选隔离 smoke

候选使用 `127.0.0.1:18082`、`NODE_ENV=production` 启动，旧 `current` 和线上新 API 全程不变。runtime smoke 通过：

- `health-live`：HTTP 200；
- `health-ready`：HTTP 200，连续 3/3，MySQL/Redis/schema 均为 `ok`；
- `system-ping`：HTTP 200；
- `auth-boundary`：未登录受保护路由均返回 401 / `unauthorized`。

候选收到 SIGTERM 后正常停止，`18082` 已确认释放。

## 5. 原子切换与新旧服务共存

切换前 `current` 为 `releases/9833a01`。按 runbook 执行同目录 `current.next -> current` 原子替换，并只重启 `hospital-platform-api-v2.service`。

| 项目 | 切换后结果 |
| --- | --- |
| 新 API current | `/home/ps/code/hospital-platform/releases/daee96d` |
| 新 API | `10.0.0.3:18081`，systemd `active` |
| 旧 Python API | `0.0.0.0:8001`，仍监听 |
| Worker | `inactive`，未启动 |
| 临时候选 | `18082`，已释放 |
| 内网 ready | 200，database/redis/schema 均为 `ok` |

新 API 启动日志确认 `environment=production`、`runtimeMode=production`、`persistenceRepositories=enabled`，并明确打印 MySQL/Redis/schema 探针状态和支付/报告 gate 状态。

## 6. 公网运行时 smoke

通过 `https://test-hp.meiyi.pro/api/v2` 执行生产 runtime smoke，结果为：

- live：200；
- ready：连续 6/6 为 200，响应包含 `Cache-Control: no-store`；
- system ping：200；
- 未登录认证边界：401 / `unauthorized`。

本次公网 smoke 只证明发布运行层、反向代理路径和认证边界，不证明 Provider 业务成功，也没有创建微信会话、读取患者、预约历史或门诊费用数据。

## 7. 后续业务边界

如果后续出现“external service rejected the request”，先按 `traceId` 查 `http.request.failed`，再用 `providerRequestId` 对照 Provider 网关日志；只有确认 Provider request/response contract 后才修改 adapter。不能把 Provider 失败解释成“没有数据”，也不能在未确认时增加 fallback、重试或降级为空列表。

下一步继续按以下顺序取得当前 release 的真实证据：微信登录 → 患者目录 → 更换就诊人 → 我的挂号 → 门诊费用只读列表。支付、医保授权、退款和 HIS 回写继续最后处理。

## 8. 切换后业务日志复核

本节只记录切换完成后的即时观察窗口，截止当时的结果；后续日志不能回写本节的历史快照。
当前较新的低敏聚合观察见 [`current-server-p0-observation-2026-08-17.md`](current-server-p0-observation-2026-08-17.md)。

切换后通过 SSH 复核新 API journald：当前 `current` 仍为 `releases/daee96d`，systemd 为 `active`，旧 Python `8001` 仍监听。切换后的日志只有服务启动和公网 runtime smoke 的健康/认证边界事件，没有出现：

- `auth.wechat.login.*`；
- `patient.directory.*`；
- `appointment.records.*`；
- `outpatient.payment.records.*`。

复核中看到的微信登录和患者目录事件时间为 2026-08-17 14:55 CST，发生在 `daee96d` 切换前，不能并入本 release 的业务验收。当前发布因此仍只标记为“运行层已验收、真实业务待验收”，不会把历史日志误记为新版本成功。
