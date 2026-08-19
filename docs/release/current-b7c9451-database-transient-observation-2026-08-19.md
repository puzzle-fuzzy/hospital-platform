# `b7c9451` 数据库瞬态连接故障观察（2026-08-19）

## 1. 观察范围

本次通过 SSH 对当前生产运行层做只读检查，没有重启、切换 release、修改环境变量、执行数据库写入或操作旧 Python 服务。

当时线上事实：

- 新 API release：`b7c9451`，systemd `hospital-platform-api-v2.service` 为 `active/running`；
- 新 API：`10.0.0.3:18081`，旧 Python：`0.0.0.0:8001`，两者同时监听；
- 脱敏读取服务配置后确认新 API 的数据库目标是远端 MySQL `8.130.127.184:3306/hospital-dev`，不是服务器本机的 3306；
- Redis 探针保持 `ok`。

## 2. 瞬态故障与恢复

约 2026-08-19 11:43 CST，API journald 出现低敏事件：

```text
event=persistence.probe.unavailable
dependency=database
errorCode=PROTOCOL_CONNECTION_LOST
operation=mysql.health_check
attempts=2
```

同一时间 schema 探针也短暂不可用，`/health/ready` 返回 `not_ready`；`/health/live` 仍正常。没有证据表明是业务代码、患者参数或旧 Python 服务导致。

约 11:44 CST 再次只读请求 `/health/ready`，结果恢复为：

```json
{
  "status": "ready",
  "dependencies": {
    "database": "ok",
    "redis": "ok",
    "schema": "ok"
  }
}
```

MySQL systemd 服务本身没有发生近期重启；本机 3306 的访问测试仅得到正常的无凭据 `Access denied`，只能证明本机端口响应，不能证明远端生产数据库健康。服务器根分区约 95% 已用，属于需要后续运维关注的独立风险，但本次没有擅自清理文件或重启数据库。

## 3. 结论和后续动作

1. 本次属于远端数据库连接瞬态，API 的 readiness gate 正确阻止业务在依赖不可用时继续运行；恢复后自动重新变为 ready。
2. `persistence-temporarily-unavailable` 仍是正确公共错误语义，不能在小程序侧改成空列表或自动重复业务写入。
3. 后续应由服务器/数据库负责人检查远端 MySQL、网络链路、连接池和连接空闲超时，并观察 `persistence.probe.unavailable/recovered` 是否重复出现。
4. 应持续关注服务器根分区使用率；在确认 release、日志和备份保留策略前，不删除旧 release、日志、数据库文件或 Docker 数据卷。
5. 本记录只证明运行层故障及恢复，不增加微信登录、患者目录、预约、报告、费用或真机业务验收证据。
