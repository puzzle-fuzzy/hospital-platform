# `9f479c9a` 生产共存发布验收记录（2026-08-22）

> 本次只发布报告 adapter 的医疗时间字段纠偏：LIS 严格使用 `reportTime`，ECG 严格使用旧端展示的 `diagnoseTime`，不再用采样、登记或审核时间猜测报告时间。报告目录/详情 gate 仍关闭，因此没有打开报告公网能力。

## 版本与范围

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `9f479c9a` |
| 发布前线上 release | `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 配套小程序运行包来源 | `a33416d8417661fa5256deb22df55a97456cc608`（提交 `a33416d8`） |
| 新 API | 仅重启 `hospital-platform-api-v2.service` |
| 旧 Python | 未修改、未停止、未重启；`8001` 持续监听，Gunicorn PID 集合前后未变化 |
| Worker | `hospital-platform-worker-v2.service` 保持 `inactive` |
| 数据库/Redis/schema | 只读 preflight 和 readiness 探针；未执行 migration 或清理 |
| 报告目录/详情 | gate 保持 `disabled`，未发起 Provider 报告请求 |
| 支付/医保/HIS | gate 保持关闭，未发起相关请求 |

## 发布前验证

- adapter 测试 `110 pass / 0 fail`，API/Worker typecheck 通过；
- API 和 Worker bundle 已上传到独立 release 目录，远端 SHA-256 与本地一致；
- 使用服务器真实 `shared/api.env` 执行 production preflight：微信身份、众阳患者/预约/费用配置、MySQL、Redis 和 schema 均通过，报告 gate 保持关闭；
- 候选在 `127.0.0.1:18082` 以 production mode 隔离启动；
- 隔离 runtime smoke 通过：live `200`、ready 连续 `3/3` 为 `200`、system ping `200`、未授权边界 `401`、关闭边界 `404`；
- smoke 结束后已按 PID 回收临时进程，`18082` 无残留监听。

## 原子切换与共存复核

切换使用同目录 `current.next -> current` 原子替换，随后只重启新 API：

```text
2a2acd9bcc89c35988b75fc03304dbd48078c9d5
        -> 9f479c9a
```

切换后确认：

- `current` 指向 `/home/ps/code/hospital-platform/releases/9f479c9a`；
- 新 API systemd 为 `active`，监听 `10.0.0.3:18081`，启动日志明确记录 `environment=production`、`runtimeMode=production`；
- 内网 `/health/live`、`/health/ready` 返回 `200`，ready 的 database/redis/schema 均为 `ok`；
- 公网 `https://test-hp.meiyi.pro/api/v2` runtime smoke 通过：live/ready/system ping 为 `200`，未授权为 `401`，关闭能力为 `404`；
- 旧 Python `0.0.0.0:8001` 仍由原 Gunicorn PID 集合监听；
- Worker 为 `inactive`，`18082` 无残留监听。

## 当前停止条件

本次只推进报告时间字段正确性和新 API 运行层发布，不打开报告 Provider gate。报告真实数据、患者切换、预约历史/爽约和门诊费用仍需当前小程序候选的页面、客户端 HTTP、服务端 Pino 三层证据；支付、医保授权、退款、预约写入和 HIS 回写继续最后处理。
