# 当前线上运行层共存只读观察（2026-08-27）

> **发布后当前事实（2026-08-27）**：服务端 release 已原子切换为
> `b44421cd321ff9ff23eeb49b12641d1772d2bdc1`；当前配套小程序运行包来源为
> `d4f67485a34195a2e1e392071502cf2a7006dd27`（`d4f6748`）。下方 16:42:35
> 的观察是切换前历史窗口，保留用于证明切换前新旧服务共存，不能覆盖发布后事实。

> **发布后只读复核（2026-08-27 18:10:40，Asia/Shanghai）**：使用受控 inspection key
> 只读连接 `192.168.112.172`，确认 `current` 仍指向上述 `b44421cd`，
> `hospital-platform-api-v2.service=active/running`、`hospital-platform-worker-v2.service=inactive`，
> 新 API 监听 `10.0.0.3:18081`，旧 Python 仍监听 `0.0.0.0:8001`；公网
> `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 `success=true`，
> `database/redis/schema` 均为 `ok`。该复核没有读取业务数据、原始日志或环境变量，也没有执行写入、切换或重启。

> 切换前观察时间：2026-08-27 16:42:35（Asia/Shanghai）。切换前服务端 release 为
> `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；切换前本地 live 小程序运行包来源为
> `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`（`62cdb8f`）。本文只记录运行层
> 共存和依赖 readiness，不把它们推断成微信登录、Provider、真机或支付业务成功。

## 1. 观察范围

本次通过阿里云中转机 `8.130.127.184`，使用本机内网 inspection key 连接
`ps@10.0.0.3`，目标对应此前的 `ps@192.168.112.172`。只执行以下无副作用读取：

- 当前 `current` 符号链接指向的 release；
- `hospital-platform-api-v2.service` 和 `hospital-platform-worker-v2.service` 的活动状态；
- `18081`、`8001` 的监听状态；
- 新 API 内网 `/health/ready` 的依赖摘要。

本次没有读取 `shared/api.env`、MySQL 数据、Redis 数据、journald 原始日志或患者/Provider
内容，没有上传 release、切换 `current`、重启任何服务，也没有修改旧 Python 项目。

## 2. 只读结果

| 检查项 | 结果 |
| --- | --- |
| 新 API `current` | `/home/ps/code/hospital-platform/releases/b44421cd321ff9ff23eeb49b12641d1772d2bdc1` |
| `hospital-platform-api-v2.service` | `active` |
| `hospital-platform-worker-v2.service` | `inactive` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| `/health/ready` | `success=true`，`database=ok`、`redis=ok`、`schema=ok` |

## 3. 结论与边界

1. 新旧服务仍然共存，旧 Python `8001` 未因本轮操作停止、重启或改动。
2. 切换前新 API 运行层健康，数据库、Redis 和 schema readiness 正常；切换后发布事实以本文顶部和
   [`candidate-b44421cd-production-acceptance-2026-08-27.md`](candidate-b44421cd-production-acceptance-2026-08-27.md) 为准。
3. 当前服务端 release 已完成 API-only 原子发布并通过发布基线门禁；该门禁证明来源和运行层一致，仍不能代替真机业务证据。
4. 当前没有微信开发者工具或真机会话，九个真机证据域继续保持 `pending`；没有页面截图、客户端
   requestId、服务端 Pino 同链事件和适用的 Provider 低敏 requestId，不能声明只读业务完成。

## 4. 下一步

当前 API-only 发布已完成；后续只需在有真实微信开发者工具/真机会话时，从当前 live `dist` 重新普通编译并生成二维码，
按微信登录、患者显式切换、预约只读、报告目录、门诊费用和普通资料顺序采集真机证据。若源码再次变化，
必须重新执行 bundle、远端 checksum、production preflight、隔离 smoke、原子切换和发布基线审计。
支付、医保、预约写入、取消、HIS 回写和旧 Python 仍不在本次开放范围。
