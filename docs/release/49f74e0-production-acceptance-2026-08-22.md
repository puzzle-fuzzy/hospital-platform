# `49f74e0` 新 API 生产切换与新旧服务共存验收（2026-08-22）

> 本记录只证明新 Bun/Elysia API 的生产运行层切换，不代表微信、众阳 Provider、真机业务、支付或医保已经验收。
> 旧 Python 服务、旧数据库、旧 Redis 和旧域名入口必须继续按原边界运行。

## 1. 当前发布结论

本次已将新 API 从 `7181e99e3a352244102f5591279528b3b66332c9` 原子切换到
`49f74e0209778836db41bef6249758b4f590792a`，只重启
`hospital-platform-api-v2.service`。没有修改或重启旧 Python 服务，没有执行数据库迁移，没有启动 Worker，
没有调用 Provider 业务接口，也没有触发支付、医保、预约写入或 HIS 回写。

旧服务仍由 Gunicorn 监听 `0.0.0.0:8001`，切换前后 PID 集合均为：

```text
3687390 3687419 3687420 3687421 3687422
```

这是本次“允许重启新 API、但旧服务不停止”的关键共存证据。公网 Nginx 仍按既有域名和转发边界工作；新 API
继续由 `hospital-platform-api-v2.service` 监听内网 `10.0.0.3:18081`。

## 2. 发布包与生产 preflight

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `49f74e0209778836db41bef6249758b4f590792a` |
| API 运行包 SHA-256 | `58ca4f588defda4d3d684f671e86d63a874f547481e1393b7f1defe22713ce7e` |
| Worker 运行包 SHA-256 | `a878a89f927ceb3f6994fa1ee305db6d0074aed296db06672a97d2aef69db368` |
| 发布归档 SHA-256 | `F20270301B018F4C33604F7F728E555C5FBA61EB5AD9020F3616D76664244BFB` |
| MySQL | preflight 通过 |
| Redis | preflight 通过 |
| schema | 已验证 `0016_patient_directory_sync_owner_index` |
| 微信身份 | configured |
| 微信支付 | disabled |
| 患者/预约/预约历史/门诊费用 Provider | configured |
| 报告目录/详情 | disabled |
| Worker | `inactive`，本次未启动 |

preflight 还验证了当前生产环境的配置项组合。`configured` 只表示运行时依赖和必要配置存在，不能推导出 Provider
权限、字段契约、真实业务数据或微信真机成功；这些仍需页面、HTTP 与 Pino 同链证据。

## 3. 隔离候选与缓存进程处理

正确切换前先发现一个没有 systemd 所属的遗留候选进程：它来自旧的 `84fac75ceeb2247b252cf7e160eedbda220378b9`
候选，父进程为 1，监听 `127.0.0.1:18082`。该进程不是当前生产 API，也不是旧 Python `8001`；仅对这个已确认
范围内的遗留 PID 执行 `SIGTERM`，并确认 `18082` 已释放。旧 Python PID 集合在处理前后保持不变。

随后用 `49f74e...` 完整发布目录在 `127.0.0.1:18082` 做隔离 smoke：

- 启动日志明确打印 `environment=production`、`runtimeMode=production` 和
  `Hospital API listening in production mode`；
- MySQL、Redis、schema 探针通过，认证运行状态为 `ready`；
- live、ready（含 3 次样本）、system ping 为 200；
- 未登录认证边界为 401，关闭路由边界为 404；
- smoke 正常退出，`18082` 没有残留监听。

这里保留“先隔离、后切换”的顺序，是因为业务 Provider 和旧端口都不能通过候选 smoke 被误触发。

## 4. 原子切换与切换后探针

切换前确认 `current` 精确指向 `7181e99e3a352244102f5591279528b3b66332c9`，然后创建
`current.next` 并使用同一文件系统的原子替换切换到：

```text
/home/ps/code/hospital-platform/current
  -> /home/ps/code/hospital-platform/releases/49f74e0209778836db41bef6249758b4f590792a
```

仅执行 `sudo systemctl restart hospital-platform-api-v2.service`。切换后 systemd 主进程为 `444220`，启动时间为
`2026-08-22 08:04:03 CST`，新 API 继续监听 `10.0.0.3:18081`。切换后通过了：

- 内网 `/health/live`、`/health/ready`、`/api/v1/system/ping`；
- 公网 `https://test-hp.meiyi.pro/api/v2/health/ready`；
- ready 中 MySQL、Redis、schema 均为 `ok`；
- 未登录鉴权和关闭路由边界；
- 启动日志中的 production mode、依赖状态和 gate 状态。

公网 ready 只证明代理、API 进程和基础依赖链可用，不能替代微信登录或业务 Provider 请求。当前 release 的微信、患者、
预约历史、门诊费用尚未取得新的“真机页面 + 客户端 HTTP + 服务端 Pino”三层同链证据；切换前 `7181e99e` 的历史日志不能
冒充 `49f74e...` 的业务验收。

## 5. 与小程序候选的配套关系

当前小程序运行包来源为 `b0e093565493285e07fe549879f8b87eda649cc7`，对应当前服务端 release `49f74e...`。
小程序构建、`runtime:verify` 和开发者工具缓存恢复记录见
[`candidate-b0e0935-current-build-2026-08-22.md`](candidate-b0e0935-current-build-2026-08-22.md)。

真机业务验收仍必须从该运行包重新普通编译、生成二维码并按顺序采集登录、患者目录/切换、预约历史和门诊费用的三层证据。
报告、病历、患者绑定、二维码协议、支付、医保、退款和 HIS 回写继续保持各自 fail-closed 或最后专项，不因本次运行层切换放行。

## 6. 回滚边界

如果新 API 的运行层探针失败，只允许把新 API 的 `current` 原子切回上一份已验证目录
`7181e99e3a352244102f5591279528b3b66332c9`，再重启 `hospital-platform-api-v2.service` 并重跑 live/ready/public smoke。
回滚动作不停止、不重启、不覆盖旧 Python `8001`，也不删除旧服务的日志、数据库或 Redis 数据。

回滚或再次发布前必须重新记录 `current` 指针、systemd 主 PID、旧 Python PID 集合和公网探针结果；不能只看 systemd 的
`active` 状态就宣称线上恢复。
