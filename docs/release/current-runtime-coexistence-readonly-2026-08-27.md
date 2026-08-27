# 当前线上运行层共存只读观察（2026-08-27）

> 当前观察时间：2026-08-27 16:42:35（Asia/Shanghai）。当前服务端 release 为
> `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；本地 live 小程序运行包来源为
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
| 新 API `current` | `/home/ps/code/hospital-platform/releases/1bc8b0a85f21cb58205a99ce4de0de6afe9bf240` |
| `hospital-platform-api-v2.service` | `active` |
| `hospital-platform-worker-v2.service` | `inactive` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| `/health/ready` | `success=true`，`database=ok`、`redis=ok`、`schema=ok` |

## 3. 结论与边界

1. 新旧服务仍然共存，旧 Python `8001` 未因本轮操作停止、重启或改动。
2. 新 API 运行层健康，数据库、Redis 和 schema readiness 正常；这不等于当前本地健康知识候选已经部署。
3. 当前工作树包含尚未进入线上 release 的健康知识服务运行时代码，因此 `pnpm release:baseline:audit`
   继续阻断是正确的，不能用本次 readiness 观察把发布门禁改成通过。
4. 当前没有微信开发者工具或真机会话，九个真机证据域继续保持 `pending`；没有页面截图、客户端
   requestId、服务端 Pino 同链事件和适用的 Provider 低敏 requestId，不能声明只读业务完成。

## 4. 下一步

有明确发布窗口后，先按 [`../../infra/systemd/api-v2-release-runbook.md`](../../infra/systemd/api-v2-release-runbook.md)
完成新 API 候选的本地 bundle、远端 checksum、生产 env preflight 和隔离端口 smoke；确认旧 `8001`
持续监听后，只原子切换新 API 并重启 `hospital-platform-api-v2.service`。发布后再重新生成当前 live
小程序二维码，按微信登录、患者显式切换、预约只读、报告目录、门诊费用和普通资料顺序采集真机证据。
支付、医保、预约写入、取消、HIS 回写和旧 Python 仍不在本次开放范围。
