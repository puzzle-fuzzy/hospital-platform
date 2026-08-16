# 候选 `b4dc33b` 生产环境临时端口 Smoke（2026-08-16）

> 本文记录当前仓库 `main` 候选 bundle 在真实生产依赖环境中的发布前只读证据。
> 候选没有切换 `current`，没有重启线上 API，没有启动 Worker，没有执行 migration，也没有修改旧 Python 服务。

## 1. 候选与运行边界

| 项目 | 结果 |
| --- | --- |
| 仓库候选 commit | `b4dc33b`，本地 `main` 与 `origin/main` 一致 |
| 候选 release | `/home/ps/code/hospital-platform/releases/b4dc33b` |
| 当前线上 release | `/home/ps/code/hospital-platform/releases/55fce6c`，全程未改变 |
| 候选实际网络端口 | `10.0.0.3:18082`，仅由临时候选进程使用 |
| smoke loopback 端口 | `127.0.0.1:18083`，仅用于运行时 smoke 的本机 HTTP 安全边界 |
| 现有新 API | `10.0.0.3:18081`，未重启 |
| 旧 Python API | `0.0.0.0:8001`，未重启、未切换 |
| 生产环境文件 | 只读取服务器受控 `shared/api.env`，没有复制或打印值 |
| 支付/医保/HIS Worker | 未启动，支付 gate 保持 `disabled` |

## 2. Bundle 来源与 checksum

本地 `pnpm check` 生成的五个 bundle 上传后，在服务器解包目录逐一计算 SHA-256，结果完全一致：

| 文件 | SHA-256 | 本地大小 |
| --- | --- | ---: |
| `apps/api/dist/index.js` | `3bc390ae386067ee1ac6dfb4789546a86733b1976bb82c58d921c34d0a9cca38` | 3068311 bytes |
| `apps/worker/dist/index.js` | `8bbc7596434548f2a1b645cd8ef88925a130f171537311e2222322b24a8a9912` | 2019301 bytes |
| `apps/worker/dist/preflight.js` | `4fcd4722a0246959861be78fa1947d0b11fa96f94f4546c0fbae52b36cc6db76` | 1964429 bytes |
| `apps/worker/dist/provider-directory-smoke.js` | `a3eae37b64a5703b269dbfbb297f54cc0f70215ce8c4e8ceae479b3c720fbf17` | 154397 bytes |
| `apps/worker/dist/api-runtime-smoke.js` | `ad77a116eddea4a681a95769e708cbd995ee491089ee4cfff39a5c1238414987` | 149898 bytes |

这证明候选验收运行的是本地已通过门禁的独立 bundle，而不是服务器 release 目录中的未构建源码或 workspace 链接。

## 3. 真实生产 env preflight

2026-08-16 20:08 CST 使用服务器受控的 `shared/api.env` 执行候选 preflight，结果为
`runtime.preflight.succeeded`：

| 检查 | 结果 |
| --- | --- |
| runtime configuration | `passed` |
| MySQL | `passed / ok` |
| Redis | `passed / ok` |
| schema | `passed / schemaStatus=verified / expected=0015_patient_directory_sync_operations` |
| 微信身份 | `configured` |
| 患者目录 | `configured` |
| 预约目录/预约历史 | `configured` |
| 门诊费用只读目录 | `configured` |
| 报告目录/详情 | `disabled` |
| 微信支付 | `disabled` |

preflight 只读取运行配置、MySQL、Redis 和 schema，不执行 migration、业务写入、支付、医保或 HIS 调用。

## 4. 候选启动日志

候选 API 使用生产 env，仅覆盖端口后分别启动：

- `10.0.0.3:18082`，进程 PID `503134`；
- `127.0.0.1:18083`，进程 PID `507687`。

两份启动日志均记录 `environment=production`、`runtimeMode=production`、数据库/Redis/schema probe 为 `ok`、
`authRuntimeStatus=ready`、`authIdentityGateway=injected` 和 `authSessionStore=injected`；支付保持关闭，报告 gate 保持关闭。

## 5. 候选运行验证

### 5.1 loopback runtime smoke

使用 `127.0.0.1:18083` 执行仓库内的 `api-runtime-smoke.js`，并设置
`HOSPITAL_RUNTIME_REQUIRE_READY=true`：

| 检查 | 结果 | traceId |
| --- | --- | --- |
| `health-live` | `200 / passed`，含 `Cache-Control: no-store` | `041dc383-dadb-4027-a068-8d2fc8895e42` |
| `health-ready` | `200 / passed`，要求 ready 且依赖全部可用 | `84299330-682d-4e06-98c8-f5c46766e52d` |
| `system-ping` | `200 / passed` | `bbc9d749-70fe-4134-b958-706175095c01` |
| `auth-boundary` | `401 / passed`，六个合法保护路由均拒绝未登录请求 | `0d546dd2-8611-497b-8987-a7f4a9be2bb6` |

### 5.2 实际候选网卡路径

从服务器访问 `10.0.0.3:18082`，验证真实候选绑定地址：

| 请求 | 结果 | requestId |
| --- | --- | --- |
| `GET /health/live` | `200`，`status=ok`，含 `Cache-Control: no-store` | `b4dc33b-live-18082` |
| `GET /health/ready` | `200`，database/redis/schema 全部 `ok`，含 `Cache-Control: no-store` | `b4dc33b-ready-18082` |
| `GET /api/v1/system/ping` | `200`，`apiVersion=0.1.0` | `b4dc33b-ping-18082` |
| `GET /api/v1/patients`（无认证） | `401`，错误码 `unauthorized` | `b4dc33b-auth-18082` |

候选日志中同时保存了上述 requestId、traceId、路径、状态码和 `environment=production`，未记录 token、密码、
微信临时 code、provider 患者号或原始响应。

## 6. 收尾与证据边界

验证完成后仅向候选 PID `503134`、`507687` 发送 `SIGTERM`。复核结果：

- `18082` 和 `18083` 已停止监听；
- `current` 仍指向 `releases/55fce6c`；
- 新 API `18081` 仍由 Bun PID `2935571` 监听；
- 旧 Python `8001` 仍由 PID `636918` 监听；
- 未执行 systemd restart、Nginx reload、数据库 migration、Redis 清理或业务写入。

本次只证明 `b4dc33b` 的生产配置、真实基础设施、schema gate、日志、健康探针、no-store 和未登录认证边界正确，
不能证明：

- 公网 `/api/v2` 已经切换到 `b4dc33b`；
- 真实微信账号登录、患者同步/失效恢复、预约目录、预约历史、报告或门诊费用 provider 已完成验收；
- 微信开发者工具或真机页面已经验收；
- 支付、医保、退款、HIS 回写或 Worker 已开放。

下一步仍需先取得窄权限 systemd 管理能力，按发布手册原子切换 `current`，切换前后复测公网 `/api/v2`、requestId、
ready/no-store 和旧 `8001`，之后才进入真实微信和 P0 只读业务验收。
