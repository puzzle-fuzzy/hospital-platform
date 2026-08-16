# 可观测性与错误契约临时运行验收（2026-08-16）

> 本文只记录候选 release 的隔离运行证据，不代表生产公网已经切换，也不代表真实微信登录、患者目录或真机业务已经验收。
> 本次没有重启 `hospital-platform-api-v2.service`，没有修改 `current`，没有触碰旧 Python 服务和旧端口。

## 1. 验收范围

本次验证两个与线上排障直接相关的改动：

- `cb11bc8`：persistence 数据库、Redis、Schema 探针只在状态变化时记录 `persistence.probe.unavailable` / `persistence.probe.recovered`，且不输出原始异常；
- `f2c6d99`：认证、依赖未配置、provider 拒绝/暂时不可用等稳定错误码返回中文安全文案，小程序按错误码做兜底映射。

未验证内容：真实 `wx.login` code、微信 provider 成功登录、真实患者同步、预约/报告/费用 provider 业务、公网 v2 经过 Nginx 的新 release、真机页面。

## 2. 本地代码门禁

候选 commit `f2c6d99` 的 `pnpm check` 已通过：

- 架构边界审计 19/19；
- Biome format/lint；
- 9 个 workspace 类型检查；
- API 58、持久化 59、原生小程序 37、适配器 41、worker 29 等测试全部通过；
- 9 个 workspace 构建全部通过。

## 3. 服务器隔离 smoke

主机：`ps@192.168.112.172`。候选代码仅解包到：

```text
/home/ps/code/hospital-platform/releases/f2c6d99
```

使用既有受控 `shared/api.env`，只将临时进程端口覆盖为 `18082`。没有写入共享 env，没有执行 migration，
没有切换 `current`，没有重启任何 systemd unit。

启动日志确认：

```text
environment=production
runtimeMode=production
port=18082
persistenceDatabaseProbe=ok
persistenceRedisProbe=ok
persistenceSchemaProbe=ok
persistenceRepositories=enabled
authRuntimeStatus=ready
authIdentityGateway=injected
authSessionStore=injected
patientDirectoryConfiguration=configured
appointmentDirectoryConfiguration=configured
```

只读 HTTP smoke：

| 请求 | 结果 | 证明范围 |
| --- | --- | --- |
| `GET http://10.0.0.3:18082/health/ready` | HTTP 200，database/redis/schema 均为 `ok` | 候选 release 的真实依赖和 schema 探针可用 |
| `GET http://10.0.0.3:18082/api/v1/me`（无 Authorization） | HTTP 401，`unauthorized`，文案为“请先登录后再继续操作” | 认证失败边界和中文安全文案生效 |

临时进程收到 `SIGTERM` 后停止，`18082` 已确认关闭。复核结果：

```text
current=/home/ps/code/hospital-platform/releases/55fce6c
f2c6d99 release dist=present
18081=listening
8001=listening
18082=down
```

这证明新旧服务共存边界未被临时 smoke 改变，但也证明 `f2c6d99` 当前尚未进入公网 `18081`。

## 4. 结论与下一步

当前结论是“代码门禁通过、生产 env 隔离 smoke 通过、线上 current 未切换”。不能据此宣称：

- 生产公网已经使用新的中文错误文案或 persistence 状态日志；
- 微信登录已经真实成功；
- readiness 200 可以替代登录和业务验收；
- 患者同步 `0015`、预约、报告或门诊费用已经完成线上迁移。

切换候选 release 前仍需具备 systemd 管理权限，并按旧服务不变的顺序执行：

1. 只将新 API `current` 原子切换到 `f2c6d99`；
2. 只重启 `hospital-platform-api-v2.service`，确认 production mode、真实依赖探针和启动状态；
3. 复测 `18081` 内网与 `/api/v2` 公网健康检查，同时确认旧 `8001` 仍监听；
4. 用真实 `wx.login` code 做一次登录，按同一 requestId 核对 `http.request.*`、`auth.wechat.login.*` 和 persistence 探针日志；
5. 再进行开发者工具/真机患者选择、预约只读、报告和门诊费用回归。
