# `2a2acd9b` 生产共存发布验收记录（2026-08-22）

> 本次只发布预约排班快照日志的 `traceId` 关联修正。新 API 与旧 Python 服务继续共存；不执行 migration、支付、医保、HIS 写回或预约提交。

## 1. 版本与范围

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 小程序运行包来源 | `b0e093565493285e07fe549879f8b87eda649cc7`（`b0e0935`） |
| 发布前线上 release | `49f74e0209778836db41bef6249758b4f590792a` |
| 新 API | 仅重启 `hospital-platform-api-v2.service` |
| 旧 Python | 未修改、未停止、未重启；`8001` 持续监听，Gunicorn PID 集合未变化 |
| Worker | `hospital-platform-worker-v2.service` 保持 `inactive` |
| 数据库/Redis/schema | 只读 preflight 和 readiness 探针；未执行 migration 或清理 |
| 支付/医保/HIS | gate 保持关闭，未发起相关请求 |

## 2. 发布前候选验证

- 8 个服务端 bundle 已上传到独立 release 目录，并与本地 SHA-256 逐个一致；
- 使用服务器真实 `shared/api.env` 执行 preflight：微信身份、众阳患者/预约/费用配置、MySQL、Redis 和 schema 均通过；
- 候选在 `127.0.0.1:18082` 以 `environment=production`、`runtimeMode=production` 启动；
- 隔离 runtime smoke 通过：live `200`、ready 连续 `3/3` 为 `200`、system ping `200`、未授权边界 `401`、关闭边界 `404`；
- smoke 结束后已回收临时进程，`18082` 无残留监听。

## 3. 原子切换与共存复核

切换使用同目录 `current.next -> current` 原子替换，随后只重启新 API：

```text
49f74e0209778836db41bef6249758b4f590792a
        -> 2a2acd9bcc89c35988b75fc03304dbd48078c9d5
```

切换后确认：

- `current` 指向 `2a2acd9bcc89c35988b75fc03304dbd48078c9d5`；
- 新 API systemd 为 `active`，监听 `10.0.0.3:18081`；
- 内网和公网 `/api/v2/health/ready` 均返回 `database=ok`、`redis=ok`、`schema=ok`；
- `8001` 仍由原 Gunicorn 进程监听；
- Worker 为 `inactive`；`18082` 无残留监听。

## 4. 日志链路修正的只读验收

切换后重新从当前小程序候选打开预约目录，页面仍显示两列科室/排班布局，并触发真实只读请求。使用当前 release 自带的
P0 聚合和业务审计工具得到：

| 业务域 | requested | success | 同链 HTTP 2xx | 结果 |
| --- | ---: | ---: | ---: | --- |
| 预约科室目录 | 1 | 1 | 1 | 通过 |
| 预约排班目录 | 1 | 1 | 1 | 通过 |

两条业务链的 `missing=[]`，`parseErrors=0`、`systemdWarningCount=0`，证明快照日志已能和所属请求保持可关联。
启动/停止生命周期日志天然没有请求链路，可能使窗口级 `correlation.missingCount` 非零；它们不属于业务链，不能与预约请求混为一谈。

## 5. 当前停止条件

本次只推进日志可维护性与预约目录只读证据。微信真机页面截图、预约历史/爽约、门诊费用只读和报告目录仍按三层证据逐项验收；
支付、医保授权、退款、预约写入和 HIS 回写继续最后处理。若新 API readiness 或公网路径异常，只回滚 `current` 并重启新 API，
不触碰旧 Python `8001`。

下一项预约历史/爽约验收按 [`next-appointment-records-acceptance-2026-08-22.md`](next-appointment-records-acceptance-2026-08-22.md)
执行；在真实 Provider 和真机三层证据齐全前，不能把代码闭环标记为业务完成。
