# `8eb51b5f` 新 API 生产共存发布验收记录（2026-08-24）

> 本记录证明普通资料日志边界修正候选完成受控切换、生产依赖 readiness、公网 runtime smoke 和旧 Python 共存复核。
> 它不把健康检查误写成微信、患者、预约、门诊费用、Provider、支付或医保业务成功。

## 发布来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 切换前服务端 release | `28a5c0c131794ce9dcc5f94bd3809402188ac87a` |
| 小程序客户端 | `13f597e` |
| 小程序构建来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python API | `0.0.0.0:8001` |
| Worker | `hospital-platform-worker-v2.service=inactive`，未启动 |

## 切换窗口证据

1. 切换前只读确认 `current=28a5c0c131794ce9dcc5f94bd3809402188ac87a`、新 API active、旧 `8001` 监听，内外 readiness 均为 `200`。
2. 候选目录已完成 8 个 bundle 的 SHA-256 对照；production env 文件仍为 `0600`，没有把真实值写入 release。
3. `127.0.0.1:18082` 隔离候选通过 preflight 和 runtime smoke 后按精确 PID 回收。
4. 使用同目录 `current.next -> current` 原子替换，再执行唯一被授权的 `sudo -n systemctl restart hospital-platform-api-v2.service`。
5. 新 API 在 15 秒窗口内第 1 秒恢复 ready；旧 Python 的 Gunicorn PID 集合保持为 `3687390、3687419、3687420、3687421、3687422`，监听持续存在。

## 切换后运行层验收

| 检查 | 结果 |
| --- | --- |
| `current` | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| systemd | `hospital-platform-api-v2.service=active`，新 API PID `3016509` |
| 内网 readiness | `200`，`database=ok`、`redis=ok`、`schema=ok` |
| 公网 live | `https://test-hp.meiyi.pro/api/v2/health/live` 返回 `200` |
| 公网 readiness | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 `200`，依赖均为 `ok` |
| 公网 system ping | `200` |
| 公网未登录认证边界 | `401 unauthorized` |
| 公网关闭能力边界 | `404 not-found` |
| 运行模式 | 启动日志明确 `environment=production`、`runtimeMode=production` |
| 旧 Python | `8001` 切换前后持续监听，未重启、未修改 |

公网 runtime smoke 使用同一候选的 `api-runtime-smoke.js`，没有携带微信 code、Bearer、患者标识、Provider 原始参数或支付字段。该证据只证明部署和安全边界，不证明真实业务成功。

## 当前业务准入

当前服务端可以继续采集线上真机三层业务证据。普通资料 GET 已观察到线上只读链；普通资料 PUT、版本冲突、患者切换、预约历史、爽约、门诊费用和报告仍需绑定同一小程序来源 `13f597e` 的页面与 requestId 证据。

支付、医保授权/结算、预约写入/取消、退款、HIS 回写和 Worker 继续关闭。若出现新 API readiness、公网路径或未解释业务异常，只允许按手册将 `current` 回滚至 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`，并只重启新 API；旧 Python、数据库、Redis 和 schema 不在回滚范围内。
