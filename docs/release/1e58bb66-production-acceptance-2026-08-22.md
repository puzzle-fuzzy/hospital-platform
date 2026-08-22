# `1e58bb66` 生产共存发布验收记录（2026-08-22）

> 本记录是当前服务端运行层发布事实源。它只证明新 API 的安全切换和运行层健康，
> 不把真机、微信会话、众阳业务成功或支付能力误记为已完成。

## 版本与范围

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `1e58bb66bf24021d2b680eb5fd03abfec467989a` |
| 发布前线上 release | `9f479c9a` |
| 配套小程序运行包来源 | `41c708e1adf864ef6fef1f788e97aa8fb4371227`（提交 `41c708e1`） |
| 新 API | 仅重启 `hospital-platform-api-v2.service` |
| 旧 Python | 未修改、未停止、未重启；`8001` 持续监听，原 Gunicorn PID 集合保持不变 |
| Worker | `hospital-platform-worker-v2.service` 保持 `inactive` |
| 数据库/Redis/schema | 生产 preflight 和 readiness 只读探针通过；未执行 migration 或清理 |
| 支付/医保/HIS/报告 | 现有关闭闸门保持关闭；未发起相关写入或 Provider 请求 |

## 发布前验证

- 远端 release bundle 八个文件的 SHA-256 与本地构建产物一致，`shared/api.env` 权限为 `600`；
- 使用服务器真实生产环境执行 preflight：MySQL、Redis、schema 均通过，schema 已验证到
  `0016_patient_directory_sync_owner_index`；微信身份和患者/预约/门诊费用只读配置已加载；
- 候选在 `127.0.0.1:18082` 以 production 模式隔离启动；
- runtime smoke 通过：live `200`、ready 连续 `3/3` 为 `200`、system ping `200`、未授权边界 `401`、关闭能力边界 `404`；
- smoke 结束后候选收到 `SIGINT` 正常停止，`18082` 已释放。

## 原子切换与新旧服务共存

切换使用同目录 `current.next -> current` 原子替换，随后只重启新 API：

```text
9f479c9a -> 1e58bb66bf24021d2b680eb5fd03abfec467989a
```

切换后确认：

- `current` 指向 `/home/ps/code/hospital-platform/releases/1e58bb66`，新 API 为 `active`；
- 新 API 启动日志明确记录 `environment=production`、`runtimeMode=production`，database/Redis/schema 探针均为 `ok`；
- 内网 `/health/live`、`/health/ready`、`/api/v1/system/ping` 均返回 `200`；
- 公网 `https://test-hp.meiyi.pro/api/v2` 的 live、ready、system ping 均返回 `200`，健康响应带 `Cache-Control: no-store`；
- `10.0.0.3:18081` 与旧 Python `0.0.0.0:8001` 同时监听，`18082` 无残留；
- Worker 保持 `inactive`，旧 Python PID 集合与切换前一致。

## 低敏日志观察

切换窗口使用候选 release 的聚合工具读取 journald：`inputLines=15`、`parsedRecords=9`、
`parseErrors=0`、`systemdWarningCount=0`；事件仅为服务启动、停止和基础设施探针，
没有把 runtime smoke 误记为微信登录、患者、预约、费用或 Provider 业务成功。

## 当前停止条件

小程序 `single-flight.test.js` ENOENT 的运行包门禁已通过：当前 `dist/services/single-flight.js` 存在，
`single-flight.test.js` 和其它测试脚本不进入 `dist/`。若开发者工具仍请求该绝对路径，必须关闭旧真机调试、
退出并重新打开 `apps/miniprogram/`、普通编译后重新生成二维码，不能复制测试脚本到运行包。

本次发布没有打开患者新增/绑定、二维码、病历、预约写入、支付、医保授权、退款、HIS 写回或报告 Provider。
真实微信登录、显式就诊人切换、预约历史/爽约和门诊费用仍需当前小程序候选的页面、客户端 HTTP、服务端低敏日志
三层证据；旧 Python 服务继续独立运行。
