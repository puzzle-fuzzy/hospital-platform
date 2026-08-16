# 候选 `d177991` 生产切换与共存验收（2026-08-16）

本文记录候选 `d177991` 从隔离 release 到公网 `/api/v2` 切换的证据。支付、医保、HIS、Worker 和真实患者业务
仍未因本次基础 API 切换而自动开放；真实微信和真机业务验收必须另行记录。

## 1. 切换范围

| 项目 | 切换前 | 切换后 |
| --- | --- | --- |
| 候选 release | `/home/ps/code/hospital-platform/releases/d177991` | `current` 指向 `d177991` |
| 旧新 API | `18081` PID `2935571` | `18081` PID `639955`，新 API unit active |
| 旧 Python API | `8001` PID `636918` | PID 和监听保持不变 |
| Worker | `inactive` | `inactive` |
| 临时 smoke | `18082`、`18083` | 验收后均已停止并清理日志 |
| systemd 操作 | 无 | 只执行 `sudo -n systemctl restart hospital-platform-api-v2.service` |
| 其他操作 | 无 | 未重启旧 Python、未 reload Nginx、未执行 migration/业务写入 |

切换前保存的 `current` 为 `/home/ps/code/hospital-platform/releases/55fce6c`；切换采用同一目录内的
`current.next` 软链接和 `mv -Tf`，没有让 systemd 看到半成品目录。失败时按发布手册将 `current` 指回
`55fce6c` 并只重启新 API。

## 2. Bundle checksum

候选在本地 `pnpm build` 后上传，服务器 release 中的 SHA-256 与本地产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `3bc390ae386067ee1ac6dfb4789546a86733b1976bb82c58d921c34d0a9cca38` |
| `apps/worker/dist/index.js` | `8bbc7596434548f2a1b645cd8ef88925a130f171537311e2222322b24a8a9912` |
| `apps/worker/dist/preflight.js` | `4fcd4722a0246959861be78fa1947d0b11fa96f94f4546c0fbae52b36cc6db76` |
| `apps/worker/dist/provider-directory-smoke.js` | `a3eae37b64a5703b269dbfbb297f54cc0f70215ce8c4e8ceae479b3c720fbf17` |
| `apps/worker/dist/api-runtime-smoke.js` | `ad77a116eddea4a681a95769e708cbd995ee491089ee4cfff39a5c1238414987` |

## 3. 生产 env preflight 与候选隔离 smoke

使用服务器已有 `shared/api.env`，只读取真实配置，不复制、打印或修改 env：

- `runtime.preflight.succeeded`，environment 为 `production`；
- MySQL、Redis、schema 均通过，schema 为 `verified`，期望 migration 为 `0015_patient_directory_sync_operations`；
- 微信身份、患者目录、预约目录、预约历史、门诊费用只读目录均 `configured`；
- 报告目录/详情和微信支付均 `disabled`，符合当前未完成边界；
- 候选 `18082` 启动日志为 production mode，MySQL/Redis/schema probe 均为 `ok`；
- `127.0.0.1:18083` 的仓库 runtime smoke 全部通过：live、ready、system-ping、auth-boundary。

候选实际网卡 `10.0.0.3:18082` 的 request 验证：

| 请求 | 结果 | requestId |
| --- | --- | --- |
| `GET /health/live` | `200`、`status=ok`、`Cache-Control: no-store` | `d177991-live-18082` |
| `GET /health/ready` | `200`、database/redis/schema 全部 `ok`、`Cache-Control: no-store` | `d177991-ready-18082` |
| `GET /api/v1/system/ping` | `200`、`apiVersion=0.1.0` | `d177991-ping-18082` |
| `GET /api/v1/patients`（无认证） | `401`、错误码 `unauthorized` | `d177991-auth-18082` |

## 4. 切换后公网验收

公网 smoke 使用仓库内 `api-runtime-smoke.js`，设置 `HOSPITAL_API_BASE_URL=https://test-hp.meiyi.pro`、
`HOSPITAL_API_PREFIX=/api/v2`、`HOSPITAL_RUNTIME_REQUIRE_READY=true`：

| 检查 | 结果 | traceId |
| --- | --- | --- |
| `health-live` | `200 / passed`，公网保留 `no-store` | `2d739858-7d84-45f5-b459-d737b16f306a` |
| `health-ready` | `200 / passed`，database/redis/schema ready | `d630cbb9-9b91-40f5-8e7d-8fa7346009cc` |
| `system-ping` | `200 / passed` | `241cf68e-3038-4c42-877d-74afd73520ea` |
| `auth-boundary` | `401 / passed`，六路合法保护接口均拒绝未登录请求 | `d59e4fce-34ed-40ec-a08d-daa2f8575387` |

公网响应的 `x-request-id` 已透传，候选 Bun 日志记录了对应请求和状态码。切换前公网 health 曾缺少
`no-store`，切换后已由候选响应修复；切换后的手工路径误将 `/api/v1` 再拼到 `/api/v2` 下而得到 404，
随后使用正确的 runtime smoke 路径复核通过，该 404 不属于服务回归。

## 5. 当前业务边界

本次只证明新 API 基础运行时、公网路由、依赖 readiness、日志关联、认证边界和旧服务共存正确；不能据此
宣称以下能力已真实验收：

- 微信真机授权登录、真实 session、患者目录同步和就诊人切换；
- 预约科室/排班/预约历史的真实 provider、公网和真机业务链路；
- 报告目录/详情（当前 gate 关闭）；
- 门诊费用真实数据、支付、医保授权、结算查单、退款和 HIS 回写；
- Worker、二维码、WebView、便民服务、病历/住院和患者新增/绑卡。

下一步必须使用真实微信登录产生的 session，按“患者同步与切换 → 预约只读 → 门诊费用只读 → 报告 gate/contract”
分层验收，并记录每层的 requestId、owner 映射、provider 状态和真机结果；不得用未登录 smoke 替代业务证据。
