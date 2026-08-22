# 当前运行层与新旧服务共存只读审计（2026-08-22 13:35 CST）

> 本文只记录服务器、内网、公网和低敏日志的只读观察，不把日志中的登录事件自动认定为手机真机证据。全程未执行重启、sudo、配置写入、数据库迁移或业务写入；旧 Python 服务保持不动。

## 运行基线

| 项目 | 只读结果 |
| --- | --- |
| 服务器 | `ps@192.168.112.172` |
| 新 API current | `/home/ps/code/hospital-platform/releases/9f479c9a` |
| 新 API systemd | `hospital-platform-api-v2.service=active/running` |
| 新 API 启动时间 | `2026-08-22 10:26:06 CST` |
| 新 API 监听 | `10.0.0.3:18081`，Bun PID `1040037` |
| 旧 Python 监听 | `0.0.0.0:8001`，原 Gunicorn PID 集合仍在监听 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 最近两小时 systemd warning | 0 |

## 内网与公网探针

服务器内网和工作区公网探针均未写入业务数据：

| 路径 | HTTP | 结果 |
| --- | ---: | --- |
| 内网 `/health/live` | 200 | `status=ok` |
| 内网 `/health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` |
| 内网 `/api/v1/system/ping` | 200 | API 响应正常 |
| 公网 `/api/v2/health/live` | 200 | `status=ok` |
| 公网 `/api/v2/health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` |
| 公网 `/api/v2/system/ping` | 200 | API 响应正常 |

## 低敏业务日志观察

服务器上只做事件计数和固定字段聚合，不把原始日志带回仓库。本窗口观察到：

- 微信登录成功事件、患者目录读取和患者同步事件均存在；
- 预约科室读取返回 60 条，排班读取返回 1 条；
- 门诊费用读取存在一次待缴费查询，结果数量为 0；
- 低敏 HTTP 事件以 200 为主，另有一次 `/me` 的 401；
- 未观察到支付、医保、退款、HIS 回写、预约写入或患者绑定事件。

这些事件没有与手机页面截图和客户端 requestId/traceId 配对，因此只能作为服务器运行观察，不能升级为真机业务验收。

## 排班快照持久化边界

本窗口有一条排班读取链同时出现：

```text
appointment.schedule_snapshots.failed
  errorType=PersistenceUnavailableError
        ↓
appointment.directory.schedules.synced
  snapshotPersistenceStatus=unavailable
  HTTP 200
```

这不是把持久化失败伪装成预约成功：当前排班接口是只读目录，Provider 返回的已校验排班仍可展示；`snapshotPersistenceStatus=unavailable` 明确表示本次没有形成可供未来写入复核的短期快照事实。预约锁号、预约写入、费用、支付和取消接口仍未注册，页面也没有把排班点击转换成副作用。

因此当前处理结论是：

1. 只读目录结果可以保留，但必须保留 `unavailable` 状态和失败日志；
2. `unavailable` 不能进入预约写入前置评估，只有 `persisted` 才能作为后续快照观察事实；
3. 若同一问题持续出现，应继续排查新 API 的 MySQL/连接池/迁移状态；不应通过降低校验、忽略失败或重启旧服务解决；
4. 当前 readiness 恢复为 `ok` 只证明探针时刻依赖可用，不会覆盖本次排班快照失败事实。

## 当前结论

新旧服务共存边界正常，当前 release 与文档基线一致；旧 Python `8001` 未停止、未重启、未修改。真机微信登录、显式多患者切换、预约历史/门诊费用页面的手机—客户端—服务端三层配对证据仍未形成。支付、医保、退款、预约写入、患者绑定和 HIS 回写继续保持关闭。
