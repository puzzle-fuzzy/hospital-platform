# 当前线上新旧服务共存只读复核（2026-08-24）

## 结论

本次通过受控 SSH 对 `192.168.112.172` 进行只读复核，确认新旧服务仍然共存，且新 API 的
生产运行层正常：

- 新 API 服务 `hospital-platform-api-v2.service` 为 `active`；
- 当前 release 目录为 `28a5c0c131794ce9dcc5f94bd3809402188ac87a`；
- 进程使用 `/home/ps/.bun/bin/bun` 启动，`NODE_ENV=production`；
- 新 API 监听 `10.0.0.3:18081`；
- 旧 Gunicorn 服务继续监听 `0.0.0.0:8001`；
- Worker 当前为 `inactive`，本次没有启动它；
- 内网 `/health/live`、`/health/ready`、`/api/v1/system/ping` 均为 HTTP 200；
- 公网 `/api/v2/health/live`、`/api/v2/health/ready`、`/api/v2/system/ping` 均为 HTTP 200；
- `/health/ready` 返回 `database=ok`、`redis=ok`、`schema=ok`。

本次没有重启任何服务、切换 release、修改配置、写入 MySQL/Redis，也没有访问患者正文、Provider
原始报文或支付/医保接口。旧 Python `8001` 没有被操作。

## 路径说明

新 API 的系统探针挂在 `/api/v1` 分组下，因此内网路径是：

```text
/api/v1/system/ping
```

公网 Nginx 再将公开版本前缀映射为：

```text
/api/v2/system/ping
```

直接请求内网 `/system/ping` 得到 404 是路径不完整，不是服务不可用；健康路径 `/health/live` 和
`/health/ready` 位于 API 分组外，内网不带 `/api/v1`。

## 日志边界

本次尝试使用服务端既有的安全聚合工具读取 journald，但 `ps` 账号的无密码 `sudo journalctl`
权限当前不可用，系统返回“需要密码”。因此本记录不写入业务事件数量，不宣称微信登录、患者、预约、
报告或门诊费用已经产生新的线上业务证据。

后续真机验收必须由具备独立只读日志权限的运维账号执行：只输出 `p0-log-aggregate` 的低敏计数，
不复制原始日志、token、患者标识、Provider 报文或金额。

## 下一步

当前本地小程序候选代码为 `356705e41852e585b07296c5e6e3dec52bce1381`，包含挂号卡片和查询状态
外壳修正；线上小程序运行包仍是 `13f597ea9ee3f65b9be858117826d948339d904a`，两者不能混称。

在发布新的小程序运行包前，先使用本地候选重新构建并通过 `runtime:verify`，再按
[`current-13f-real-device-acceptance-runbook-2026-08-24.md`](current-13f-real-device-acceptance-runbook-2026-08-24.md)
取得页面、客户端 requestId 和服务端低敏日志三层证据。报告详情、二维码、患者绑定、支付、医保和 HIS
回写继续等待各自正式契约，不因本次运行层检查提前开放。
