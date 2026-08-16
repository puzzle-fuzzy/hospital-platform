# 候选 `3129148` 会话边界与真实依赖隔离验收（2026-08-16）

本文记录候选 `3129148` 上传后的 bundle checksum、真实生产 env preflight 和临时端口 runtime smoke。
本次没有切换公网 `current`，没有重启 systemd 服务，没有执行 migration，也没有发起真实微信、患者、预约、
报告、门诊费用、支付、医保或 HIS 业务请求。敏感连接串、token、openid、unionId 和患者标识不写入本文。

## 1. 发布边界

| 项目 | 结果 |
| --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/3129148` |
| 当前生产 release | `/home/ps/code/hospital-platform/releases/d177991`，未改变 |
| 当前新 API | `hospital-platform-api-v2.service`，监听 `10.0.0.3:18081`，未重启 |
| 旧 Python API | 监听 `0.0.0.0:8001`，未重启 |
| 候选临时 API | `127.0.0.1:18086`，验证后已 SIGTERM 停止并释放端口 |
| Worker | 未启动，支付/医保/HIS gate 未打开 |

## 2. 本次业务边界修复

Provider directory smoke 新增显式 `session` 能力：

1. 健康检查通过后先调用带 Bearer 的 `GET /me`；
2. 只验证返回的当前平台用户结构，不把 userId 写入 smoke 结果；
3. 会话无效时立即停止，不继续访问患者、预约、报告和门诊费用接口；
4. CLI 默认能力列表包含 `session`，健康-only 的显式空能力仍不访问认证业务。

这使“会话有效”“患者 owner 目录”“Provider 只读请求”成为可分别定位的验收层，不把业务接口的偶然 401/200
当成完整 session 证据。预约写入、锁号、取消、支付、医保、退款和 HIS 回写边界未改变。

## 3. Bundle checksum

本地 `pnpm check` 已通过；服务器上传后的 SHA-256 与本地产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `8a7206a98916d894fdb4d99f60953d39134a6d71f3453495baadc372cfbe4fbf` |
| `apps/worker/dist/index.js` | `04c77638af59306d372fec569eb3b61a87b1e85f654c0755d784e130690676aa` |
| `apps/worker/dist/preflight.js` | `48c37a68cf24dbf6a772075b2f669ac8e48bde64edb3edbc546926cd08b7c37a` |
| `apps/worker/dist/provider-directory-smoke.js` | `e9cb283fb6d1286eb25c3eacd381e7d31c7f31ef49b558c410b7acf7148dcd7f` |
| `apps/worker/dist/api-runtime-smoke.js` | `eb285ee332a9ea7782e7f539fe784fd8af9083abc6f8c76082197faaf9712dec` |

## 4. 真实生产 env preflight

候选只读取服务器现有 `shared/api.env`，不复制、不打印、不修改。结果为：

- `runtime.preflight.succeeded`，`environment=production`；
- 微信身份、患者目录、预约目录、预约记录和门诊费用 gate 为 `configured`；
- 报告目录/详情和微信支付 gate 为 `disabled`；
- MySQL、Redis 通过；
- schema `verified`，目标 migration 为 `0015_patient_directory_sync_operations`。

## 5. 临时端口 runtime smoke

候选 API 使用真实生产 env 启动在 `127.0.0.1:18086`，runtime smoke 结果为：

| 检查 | 结果 | HTTP 状态 |
| --- | --- | ---: |
| `health-live` | passed | 200 |
| `health-ready` | passed | 200 |
| `system-ping` | passed | 200 |
| `auth-boundary` | passed | 401 |

候选启动日志确认 `runtimeMode=production`、数据库/Redis/schema probe 为 `ok`、repository 已启用；
验证后收到 `SIGTERM`，记录 `service.stop.requested` 和 `service.stopped`，临时端口已释放。

## 6. 下一步

候选已经具备执行真实业务 smoke 的运行时条件，但尚未切换公网，也没有真实 session 证据。下一步使用受控
微信真机 session 执行：`session` → 患者同步首轮/同 key replay → 患者目录 → 就诊人切换 → 预约目录/历史 →
门诊费用只读。每一步保存 traceId、服务端业务事件和安全响应摘要；在 Provider 新文档确认前继续保持
预约写入、支付、医保、退款和 HIS 回写关闭。
