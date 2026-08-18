# 1b94c46 生产切换与普通资料版本门禁验收

更新时间：2026-08-18 16:31-16:32 CST

## 1. 发布范围

- 服务端 release：`/home/ps/code/hospital-platform/releases/1b94c46`；
- 服务端代码来源：`1b94c46`，包含普通资料版本达到 MySQL `INT UNSIGNED` 上限时的写入前 fail-closed 修正；
- 数据库没有执行 migration，schema 仍使用已验证的 `0016_patient_directory_sync_owner_index`；
- 支付、医保、HIS 写入、预约写入、报告 gate 和 Worker 继续关闭；
 - 原生小程序当前配套候选为 `bc1752f`，构建来源指纹为
   `bc1752f1a4531a15b8121e8a2bac9d9e4d625cb9`；本次 API 发布没有替代或上传小程序运行包。

## 2. 本地产物与检查

本次服务端改动完成全仓 `pnpm check`；API 为 115 项测试、525 个断言，普通资料 service 定向测试为 10 项、37 个断言。候选预生产 smoke 使用本地构建产物，八个 bundle 上传后 SHA-256 与本地一致：

| 产物 | SHA-256 |
| --- | --- |
| `apps/api/dist/index.js` | `bcbfd9f933cabe9b1b9b0206137b361a93328849e373d9c5cb990c2e10071dbe` |
| `apps/worker/dist/index.js` | `3e1c39ca8f09570ea2e0f85c848a8c8b6169f07132b4f49204a806cb80badef9` |
| `apps/worker/dist/preflight.js` | `a2fc8cdb460671f19e7a8a75167ace220bac4ba5c458f9266b518fab7a389284` |
| `apps/worker/dist/provider-directory-smoke.js` | `3ac16889bc3d106e9ea259d680bff980c0884ed04c7cd3b192ff93e90fd86d6d` |
| `apps/worker/dist/api-runtime-smoke.js` | `1246914eece1aceaee8d644d7199ff0ee825c5be05ffa5f4f2bc4a42e8bb21f3` |
| `apps/worker/dist/p0-log-aggregate.js` | `5da0f845226891901d5a4c4fb5b6fa8f9e9be3522fa272830175e44cb91b7cb1` |
| `apps/worker/dist/p0-business-evidence-audit.js` | `ae82730903e392b061b5cd08a86c09cadedeb3b01a3b25342fcaa925912d5907` |
| `apps/worker/dist/redis-session-ttl-audit.js` | `3f8190fb7acc75a41fb2be12181ad9eb99cafc2302f7044a157452228d4fcd70` |

## 3. 发布前隔离验证

使用服务器真实 `shared/api.env` 的候选 preflight 通过：

- `environment=production`；
- 微信身份、患者目录、预约目录、预约历史、门诊费用为 `configured`；
- 微信支付、报告目录、报告详情为 `disabled`；
- MySQL、Redis、schema 均为 `ok`，schema 为 `verified`。

候选在 `127.0.0.1:18082` 独立启动，live、ready、`/api/v1/system/ping` 和未登录资料接口分别通过；未登录资料接口返回 401。候选进程随后正常回收，`18082` 已释放。

## 4. 原子切换与共存

切换前 `current` 为 `releases/4ae2a31`；通过同目录 `current.next -> current` 原子替换后，只重启 `hospital-platform-api-v2.service`。

切换后证据：

- `current -> releases/1b94c46`；
- systemd 为 `active/running`，主进程 PID `3389416`，启动时间 `2026-08-18 16:31:42 CST`；
- `ExecStart` 使用 `/home/ps/code/hospital-platform/current/apps/api/dist/index.js`，环境文件仍为 `shared/api.env`；
- 新 API 监听 `10.0.0.3:18081`；
- 旧 Python Gunicorn 继续监听 `0.0.0.0:8001`；
- Worker 未启动，没有执行 migration 或业务写入。

## 5. 公网与日志窗口

- 内网 `/health/ready` 返回 MySQL、Redis、schema 均为 `ok`；
- 公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 连续 3/3 通过；
- 公网未登录 `GET /api/v2/me/profile` 返回 401；
- 以服务启动时间为边界使用候选 release 的低敏聚合工具：`parseErrors=0`、`systemdWarningCount=0`，事件为 1 次 `service.started`、2 次 HTTP 200 健康请求和 1 次预期的未登录 401；没有真实资料 PUT/409 事件。

本记录证明的是服务端 release、运行依赖、部署共存和认证边界；不证明真实微信资料首次 PUT、普通资料 409、多患者切换、预约/费用 Provider 或真机页面验收完成。

## 6. 回滚边界与下一步

如新 API readiness、公网路径或旧 `8001` 出现异常，只将 `current` 原子切回 `releases/4ae2a31` 并重启新 API；禁止停止旧 Python、删除旧 release、清空 Redis 或回滚数据库 schema。

下一步使用 `bc1752f` 小程序候选完成真实微信会话、患者切换和预约/费用只读三层证据；随后用专用账号完成普通资料首次 PUT、版本递增和 409 冲突验收。支付、医保、HIS 和报告继续最后处理。
