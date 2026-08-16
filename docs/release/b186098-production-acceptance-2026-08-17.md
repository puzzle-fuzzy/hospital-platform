# `b186098` 生产切换与新旧服务共存验收

> 历史记录：本文只描述 `b186098` 在 2026-08-17 约 01:16 CST 的生产切换窗口。
> 当前线上 release 已进一步切换为 `527d163`，请以 [`527d163-production-acceptance-2026-08-17.md`](527d163-production-acceptance-2026-08-17.md)
> 和当前迁移检查点为准；本文中的健康、进程和 release 指针不能回填当前版本的业务验收。

## 1. 发布边界

本次只切换新 API `hospital-platform-api-v2.service`，不修改旧 Python 服务、不重启旧端口
`8001`、不启动 Worker、不执行 migration，也没有调用支付、医保、退款或 HIS 写入。
候选 release 保留在服务器 `releases/b186098`，旧 release `41c9c18` 仍可按 runbook 回滚。

仓库状态：`main=b186098e8ec62d32682384c851cd8f9fe22b2234`，对应提交已推送到远程。

## 2. 候选构建与生产 preflight

候选 bundle 在本地 `pnpm check` 通过后上传；服务器 release 五个文件的 SHA-256 与本地产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `ff67da12df57d3aebbcc783be7b72bbe4eadbaeb4b97ab4647cc3ed2ec9e471c` |
| `apps/worker/dist/index.js` | `2ce60d98d37ca2e7a3779d4155c95e79913d62e52596b06ff4cad4c169a723a8` |
| `apps/worker/dist/preflight.js` | `0606e8c2101a8d4dc4b5392f888d13a4b98f5edb40f5ec2493c44356ceb7ae22` |
| `apps/worker/dist/provider-directory-smoke.js` | `dd22c5d402ba63eccc7f6962e2e89cc17736eea35f84da107d586d6bcf21eb00` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |

使用服务器 `shared/api.env` 的真实生产配置执行 preflight，结果为：

- runtime configuration：passed；
- 微信身份、患者目录、预约目录、预约记录、门诊费用：configured；
- 微信支付、报告目录、报告详情：disabled；
- MySQL、Redis：`ok`；
- schema：`schemaStatus=verified`，`expected=0015_patient_directory_sync_operations`。

候选先在 `127.0.0.1:18082` 启动，production 日志确认 database/Redis/schema 为 `ok`，随后使用
服务器 release 内的 runtime smoke 完成 live、ready、system ping、no-store、未登录 401 和
3 次连续 readiness。候选 smoke 结束后发送 SIGTERM 并确认 `18082` 已释放。

## 3. 原子切换与切换后状态

切换前：

- `current=/home/ps/code/hospital-platform/releases/41c9c18`；
- 内网旧 API ready：`database/redis/schema=ok`；
- 公网 `/api/v2/health/ready`：`ready`；
- 新 API `18081`、旧 Python `8001` 均在监听。

随后执行 `current.next -> current` 的同目录原子替换，并只执行
`sudo -n systemctl restart hospital-platform-api-v2.service`。

切换后（上海时间约 `2026-08-17 01:16:20 CST`）：

| 检查项 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/b186098` |
| 新 API unit | `active`，PID `1803489` |
| 新 API 启动日志 | `runtimeMode=production`，host `10.0.0.3`，port `18081`，database/Redis/schema `ok` |
| capability | 微信身份、患者目录、预约目录、预约记录、门诊费用 `configured`；支付/报告 gate `disabled` |
| 旧 Python | PID `636918`，`python main.py run --env prod`，仍监听 `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 新旧端口 | `18081` 与 `8001` 同时监听；没有 `18082` 残留 |

## 4. 公网切换后 runtime smoke

使用 `releases/b186098/apps/worker/dist/api-runtime-smoke.js`，参数为：

```text
NODE_ENV=production
HOSPITAL_API_BASE_URL=https://test-hp.meiyi.pro
HOSPITAL_API_PREFIX=/api/v2
HOSPITAL_RUNTIME_REQUIRE_READY=true
HOSPITAL_RUNTIME_READINESS_SAMPLES=6
HOSPITAL_RUNTIME_READINESS_INTERVAL_MS=1000
```

上海时间约 `01:17:19-01:17:26 CST` 的结果：

| 检查 | 结果 |
| --- | --- |
| `health-live` | HTTP 200，通过 no-store |
| `health-ready` | HTTP 200，6/6 `ready`，通过 no-store |
| `system-ping` | HTTP 200，通过 |
| `auth-boundary` | HTTP 401，通过稳定 `unauthorized` 边界 |

readiness 六次 traceId：

```text
5714744a-d2f8-4fc9-8f19-ab14efdfa046
5a2a63b4-de13-4740-a2a9-c44302d1c553
33266e07-6f03-4cd9-be9d-33926de2cb21
3019b7e1-edff-4a4f-bf4a-be1ecc7a2cb3
36a92f8b-2270-453a-81db-5682963abbeb
917d2e39-b1bc-4ee8-b989-4af5642ecdff
```

启动与请求日志可以通过非特权 `journalctl -u hospital-platform-api-v2.service` 按上述时间和
traceId 关联；日志只确认运行/请求边界，不包含本次业务 Provider 或真机验收。

## 5. 当前业务结论与下一步

本次正式切换证明 `b186098` 的候选构建、生产配置、依赖 schema、API 公网边界和旧服务共存均通过。
它仍不能证明微信真机登录、Redis TTL、第二位就诊人、多患者失效恢复、预约历史、报告、门诊费用
Provider 读取或支付/医保/HIS 已完成。

下一步按 P0 顺序使用真实微信会话执行：

1. 登录会话与 Redis TTL 证据；
2. 患者同步、独立选择、第二位患者切换及 inactive/recovery；
3. 患者上下文下的预约历史、报告目录、门诊费用只读；
4. 真机页面网络与服务端 trace 对齐；
5. Provider 业务稳定后再接收新文档逐域推进，写入、支付、医保和 HIS 继续关闭。
