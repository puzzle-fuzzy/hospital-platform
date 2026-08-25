# 当前新旧服务共存只读核对（2026-08-25）

> 本记录只保存一次只读运行层核对结果，不修改旧项目、旧 Python 服务、数据库、Redis、Nginx 或新服务配置，也不执行重启。
> 它只证明进程和监听边界，不替代当前候选的公网、Provider、客户端 requestId 或真机业务证据。

## 1. 核对范围

通过中转内网服务器 `192.168.112.172`，使用已经加入服务器的 inspection key，执行以下只读检查：

```text
systemctl is-active hospital-platform-api-v2.service
systemctl is-active hospital-platform-worker.service
ss -ltn
readlink -f /home/ps/code/hospital-platform/current
systemctl show hospital-platform-api-v2.service -p ActiveState -p MainPID
journalctl -u hospital-platform-api-v2.service --since '24 hours ago' --no-pager -n 5
```

第一次不带显式私钥的 SSH 尝试返回 `Permission denied`；使用本机
`hospital-internal-inspection-ed25519` 显式连接后核对成功。私钥内容、密码、环境变量和日志中的请求标识不写入本文。

## 2. 结果

| 项目 | 结果 | 解释 |
| --- | --- | --- |
| 新 Elysia API | `active` | `hospital-platform-api-v2.service` 正在运行 |
| 新 API 监听 | `10.0.0.3:18081` | 新服务独立监听，不占用旧 Python 端口 |
| 旧 Python 服务 | `0.0.0.0:8001` 仍监听 | 本轮没有停止、重启或修改旧服务 |
| Worker | `inactive` | 当前没有额外启动异步 worker |
| 当前线上 release | `/home/ps/code/hospital-platform/releases/8eb51b5ffe85b0b8f8a032783f893117d3df549d` | 仍是线上 `8eb51b5f`，不是本地 `b42922f4` 候选 |
| 运行模式 | `production` | journald 中的 Pino 事件包含 `environment=production` |

最近可见的低敏日志包括 `/api/v1/me`、`/api/v1/me/profile` 成功读取和 `/health/ready` 成功探针；
这些日志属于线上旧 release 的运行观察，不能证明 pending 小程序 `7bc5956` 或本地服务端候选已经产生业务请求。

## 3. 发布结论

当前新旧服务共存边界正常，但本地候选仍不能直接发布：

1. `release:baseline:audit` 继续拒绝线上 release 之后的未部署运行时代码；
2. 未部署文件包含另一会话负责的众阳预约适配器，本会话不修改、不暂存、不部署；
3. 小程序 pending 运行包仍需先释放微信开发者工具对 `dist/` 的锁；
4. 在统一候选完成 production preflight 后，才可以重新启动新 API 并采集当前候选的只读业务证据；旧 Python `8001` 必须保持共存。

## 4. 后续业务队列

运行层确认后，业务仍按以下顺序并行推进：

- 先验收患者、预约目录/历史/爽约、报告目录、门诊费用和普通资料五个只读域；
- 健康百科等待正式审核 bundle，不把旧源快照当作已发布内容；
- 门诊病历、住院、医生关系、问诊分别等待独立 Provider contract；
- 患者绑定、临床问卷、外部 WebView、预约写入、支付和医保继续保持各自状态页与 fail-closed 门禁。

## 5. 2026-08-25 17:16 CST 只读复核刷新

本次仍只执行运行层探针，没有重启服务、切换 release、修改环境变量、读取业务数据或触发 Provider 请求。

| 检查项 | 当前结果 |
| --- | --- |
| 服务器时间 | `2026-08-25T17:16:06+08:00` |
| 新 API systemd | `active` |
| Worker | `inactive` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，继续共存 |
| 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 内网 `/health/ready` | `200`，database/redis/schema 均为 `ok` |
| 内网 `/api/v1/system/ping` | `200`，`service=hospital-api`，`apiVersion=0.1.0` |
| 公网 `/api/v2/health/ready` | `200`，database/redis/schema 均为 `ok` |
| 公网 `/api/v2/system/ping` | `200`，`service=hospital-api`，`apiVersion=0.1.0` |

探针路径必须区分内外层：内网使用 `/health/*` 和 `/api/v1/system/ping`，公网反向代理使用 `/api/v2/health/*` 和
`/api/v2/system/ping`。`/health/system-ping` 不是已注册路由，返回 404 属于错误探测路径，不代表服务异常。
