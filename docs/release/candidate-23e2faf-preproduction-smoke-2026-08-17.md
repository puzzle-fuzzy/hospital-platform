# `23e2faf` 候选发布前隔离验收（2026-08-17）

## 结论

候选 `23e2faf` 已完成本地完整门禁、真实生产依赖 preflight 和隔离端口 runtime smoke，当前状态为
`preproduction-smoke`。本次没有切换线上 `current`，没有重启新 API systemd 服务，没有触碰旧 Python
服务，没有执行数据库迁移，也没有调用支付、医保、HIS 写入或真实患者业务。

本次候选包含 worker 的 `profile-read` 只读 smoke：它只请求平台 `GET /me/profile`，校验普通资料字段
类型和非负 `version`，不执行 `PUT`，不输出昵称、邮箱或资料正文。由于本次没有向候选注入真实 Bearer
会话，本记录不能宣称普通资料公网业务、真机页面或资料写入/409 已验收。

## 候选固定信息

| 项目 | 结果 |
| --- | --- |
| Git commit | `23e2faf006724ab8a9f5ed269e49103fadfc8687` |
| 远端候选目录 | `/home/ps/code/hospital-platform/releases/23e2faf` |
| 验证期间线上 current | `/home/ps/code/hospital-platform/releases/bf67b9673708a6e5188880eba9a6d29b8e78f0c5`，未改变 |
| 候选监听地址 | `127.0.0.1:18082`，smoke 后已停止并释放 |
| 当前新 API | `10.0.0.3:18081`，保持监听 |
| 旧 Python API | `0.0.0.0:8001`，保持监听 |
| Worker | 未启动，本次不扩大 systemd 权限范围 |

候选 bundle 上传后逐个执行 SHA-256 比对，结果与本地构建产物一致：

| 文件 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `69e78e99b20cc52a0336610e71160e0c17e472e9f7ceb8e018fc6b5b0ba789c1` |
| `apps/worker/dist/index.js` | `e7494f7bb38f75f069131e12a785a716829a3f287c0d8ea017586ff85e0b5299` |
| `apps/worker/dist/preflight.js` | `896522efc1b11ddab11908814e86c86097b852f9ff69ec6d3e35cb1206b83078` |
| `apps/worker/dist/provider-directory-smoke.js` | `e2a5fdc85d59b2bfb6e8ec99d3480bf27f7f33d84f324c8bb0b2d83810d90046` |
| `apps/worker/dist/api-runtime-smoke.js` | `a724efcd5d73135157cb9a96f9ac3e81aeb152058cef57320ba524301ecd9e46` |
| `apps/worker/dist/p0-log-aggregate.js` | `23b062c44396847a03fe9733755fc20fabf81ba0b8ddcf7805f65d813689f0f9` |

## 本地代码门禁

`23e2faf` 发布前已通过：

- `pnpm check`：架构边界、迁移台账、Provider 接收审计、文档断链、Biome、lint、typecheck、test 和 build；
- worker 定向测试：49 项通过，0 项失败；
- 文档链接审计：110 篇文档，无断链；
- 小程序构建产物检查：14 个原生 TypeScript 页面脚本均生成。

## 真实生产依赖 preflight

2026-08-17 21:03:31 CST 使用服务器现有受保护环境文件执行候选 bundle 的 preflight。环境文件只作为进程
环境加载，没有复制、打印或写入仓库。结果为 `runtime.preflight.succeeded`：

- runtime configuration：passed；
- provider configuration：微信身份、患者目录、预约目录、预约历史和门诊费用为 configured；微信支付、报告目录和报告详情为 disabled；
- MySQL：`ok`；
- Redis：`ok`；
- schema：`verified`，目标 migration 为 `0016_patient_directory_sync_owner_index`。

preflight 只读检查，不执行 migration、不调用 provider、不创建患者或费用业务数据。

## 隔离 runtime smoke

候选 API 于 2026-08-17 21:03:42 CST 以 `NODE_ENV=production`、`HOST=127.0.0.1`、`PORT=18082`
启动。启动日志明确记录 `runtimeMode=production`、MySQL/Redis/schema probe 为 `ok`，业务 gate 与线上
一致。随后使用候选 bundle 的 `api-runtime-smoke.js`，内网前缀 `/api/v1`，连续 readiness 采样 6 次，
间隔 500 毫秒：

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `health-live` | 200 / passed | 响应包含 `Cache-Control: no-store` |
| `health-ready` | 200 / passed | 连续 `6/6`，database、Redis、schema 可用 |
| `system-ping` | 200 / passed | 候选 API 响应正常 |
| `auth-boundary` | 401 / passed | 未登录受保护请求返回 `unauthorized` |

runtime smoke 于 21:04:03 CST 完成，结果为 `runtime.smoke.completed`。它只证明候选运行时边界，
不证明微信登录、患者同步、Provider 字段、普通资料、预约历史或门诊费用业务成功。

## 清理与共存复核

runtime smoke 完成后只向候选 PID 发送 `SIGTERM`，并确认：

- `127.0.0.1:18082` 已释放；
- `current` 仍指向 `bf67b9673708a6e5188880eba9a6d29b8e78f0c5`；
- 新 API `10.0.0.3:18081` 仍监听；
- 旧 Python API `0.0.0.0:8001` 仍监听；
- 没有执行 `systemctl restart`、软链接切换、数据库迁移或 Worker 启动。

## 下一步门禁

1. 候选切换前，先由受控环境提供真实 Bearer 和内部患者 ID，单独执行 `profile-read`，只保留字段类型、版本、HTTP 状态和 trace 数量；
2. 使用最新小程序运行包做“我的/我的挂号”真机视觉与页面网络三层验收，特别检查背景、功能分组、图标、固定底栏、就诊人切换和挂号卡片；
3. 只有取得当前 release 的微信会话、平台响应、页面结果和低敏日志后，才能更新对应业务 gate；
4. 预约写入、微信支付、医保授权、结算回写、退款和 HIS 写入继续关闭。
