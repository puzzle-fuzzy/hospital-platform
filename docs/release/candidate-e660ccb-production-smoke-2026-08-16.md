# 候选 `e660ccb` 生产环境临时端口 Smoke（2026-08-16）

> 本文只记录候选 bundle 在真实生产依赖环境中的发布前只读证据。
> 候选没有切换 `current`，没有重启线上 API，没有启动 Worker，没有执行 migration，也没有修改旧 Python 服务。

## 1. 候选与环境边界

| 项目 | 结果 |
| --- | --- |
| 仓库候选 commit | `e660ccb`（完整 SHA 以仓库 `git rev-parse HEAD` 为准） |
| 候选 release | `/home/ps/code/hospital-platform/releases/e660ccb` |
| 当前线上 release | `/home/ps/code/hospital-platform/releases/55fce6c`，全程未改变 |
| 候选 API 临时端口 | `10.0.0.3:18082`，仅由候选进程使用 |
| 现有新 API | `10.0.0.3:18081`，未重启 |
| 旧 Python API | `0.0.0.0:8001`，未重启、未切换 |
| 生产环境文件 | 只读取服务器受控 `shared/api.env`，没有复制或打印值 |
| 支付/医保/HIS Worker | 未启动，支付 gate 仍为 `disabled` |

## 2. Bundle provenance

本地构建产物和服务器解包后的 SHA-256 完全一致：

| 文件 | SHA-256 | 大小 |
| --- | --- | ---: |
| `apps/api/dist/index.js` | `cc8159314a67e168686ae168ae3eb48ceb16bc9657d2b1fe1ed4956acb608b2d` | 3067076 bytes |
| `apps/worker/dist/index.js` | `663e01333fca830f4ee8f4349312f3198c827bb664b206db8c66be852dd6e939` | 2018126 bytes |
| `apps/worker/dist/preflight.js` | `a02a8385da3d9dca8a5230d8fd2ce50588549cc074f0c07bb251a662f1ab42ef` | 1963254 bytes |
| `apps/worker/dist/provider-directory-smoke.js` | `a3eae37b64a5703b269dbfbb297f54cc0f70215ce8c4e8ceae479b3c720fbf17` | 154397 bytes |
| `apps/worker/dist/api-runtime-smoke.js` | `ad77a116eddea4a681a95769e708cbd995ee491089ee4cfff39a5c1238414987` | 149898 bytes |

这证明服务器没有使用缺失 workspace 链接的源码运行候选验收，而是运行了本地已通过门禁的独立 bundle。

## 3. 真实生产 env preflight

2026-08-16 19:05 CST 使用：

```bash
set -a
. /home/ps/code/hospital-platform/shared/api.env
set +a
/home/ps/.bun/bin/bun /home/ps/code/hospital-platform/releases/e660ccb/apps/worker/dist/preflight.js
```

结果为 `runtime.preflight.succeeded`：

| 检查 | 结果 |
| --- | --- |
| runtime configuration | `passed` |
| MySQL | `passed / ok` |
| Redis | `passed / ok` |
| schema | `passed / schemaStatus=verified / expected=0015_patient_directory_sync_operations` |
| 微信身份 | `configured` |
| 预约目录/预约历史 | `configured` |
| 门诊费用只读目录 | `configured` |
| 报告目录/详情 | `disabled` |
| 微信支付 | `disabled` |

本次同时确认了一个发布脚本问题：此前错误地使用 `shared/worker.env` 时，因该文件尚未配置 Worker
连接串而得到 `DATABASE_URL/REDIS_URL` 缺失；改为 API 候选 preflight 使用 `shared/api.env` 后，真实
MySQL、Redis 和 schema 检查通过。支付关闭时不再要求支付密钥，但 Worker 自身仍保留严格的支付配置门禁，
所以没有因为 preflight 通过而启动 Worker。

## 4. 候选 API 临时端口

候选 API 使用 `shared/api.env`，只覆盖 `PORT=18082` 启动；日志确认：

- `environment=production`、`runtimeMode=production`；
- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`；
- `authRuntimeStatus=ready`、`authIdentityGateway=injected`、`authSessionStore=injected`；
- 患者、预约、预约历史、门诊费用配置为 `configured`；报告和支付保持关闭。

候选端口请求结果：

| 请求 | 结果 | requestId |
| --- | --- | --- |
| `GET http://10.0.0.3:18082/health/live` | `200`，`status=ok`，含 `Cache-Control: no-store` | `7a05c63a-2b33-429a-b3a7-95d66b2b99da` |
| `GET http://10.0.0.3:18082/health/ready` | `200`，`database/redis/schema=ok`，含 `Cache-Control: no-store` | `e2043aa6-516e-4cdc-966c-475ddbddfba3` |
| `GET http://10.0.0.3:18082/api/v1/system/ping` | `200`，`apiVersion=0.1.0` | `b7adf90e-0bc7-4242-bb19-f1059b14cde0` |
| `GET http://10.0.0.3:18082/api/v1/patients`（无认证） | `401 unauthorized` | `690cd2db-c1f9-45be-b860-196783808598` |

候选进程随后收到 `SIGTERM` 并停止。清理后复核：

- `current` 仍为 `/home/ps/code/hospital-platform/releases/55fce6c`；
- `10.0.0.3:18081` 和 `0.0.0.0:8001` 仍在监听；
- `18082` 已关闭；
- 未执行 systemd restart、数据库 migration、Redis 写操作或业务写入。

## 5. 证据边界与下一步

本次只证明候选运行时、真实基础设施、schema gate、健康探针和未登录认证边界正确，不能证明：

- 当前公网 `/api/v2` 已经切换到 `e660ccb`；公网 `no-store` 仍需切换后重新验收；
- 真实微信账号、患者同步、预约历史、报告或门诊费用 provider 业务已经完成；
- 真机登录、患者切换、预约目录和门诊费用页面已经验收；
- 支付、医保、退款、HIS 回写或 Worker 已经开放。

下一步仍需取得窄权限 systemd 管理能力后，按照发布手册执行原子切换；切换前后继续保留旧 Python `8001`，
并重新做公网 `/api/v2`、requestId、ready/no-store 和旧服务共存复核。
