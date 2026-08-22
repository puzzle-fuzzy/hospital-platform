# `84370077` 新 API 生产共存发布验收记录（2026-08-22）

> 本记录是当前服务端运行层发布事实源。它证明支付关闭态修复已经部署到新 API，
> 以及新旧服务共存没有被破坏；它不把真机、微信会话、众阳业务成功或支付能力误记为已完成。

## 版本与范围

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `84370077024762d92050cf077c27f3c60302e8f8` |
| 发布前线上 release | `1e58bb66` |
| 配套小程序运行包来源 | `7f09bbb2cf32d4753795bcbc91fe23ec05eeeee6`（提交 `7f09bbb`） |
| 新 API | 仅切换并重启 `hospital-platform-api-v2.service` |
| 旧 Python | 未修改、未停止、未重启；`8001` 持续监听，PID 集合复核未变化 |
| Worker | `hospital-platform-worker-v2.service` 未启动，保持 inactive |
| 数据库/Redis/schema | 使用真实 `shared/api.env` 的只读 preflight 和 readiness 通过；未执行 migration |
| 支付/医保/HIS/报告 | 支付运行闸门为 `fail_closed`；未发起支付、医保、HIS 写回或报告 Provider 请求 |

## 候选产物与发布前验证

- 本地提交后的 `pnpm build` 通过，9 个 workspace 构建成功；小程序运行包仍为 14 个页面且不含测试脚本；
- 上传压缩包 SHA-256 为 `E4CF8A4D1F473F3033BD051C282C861D08006756CED7610FAD7EEF4556846613`；
  服务器解包后 8 个 bundle 文件均存在并完成 SHA-256 复核；
- 真实生产 preflight 通过：MySQL、Redis、schema 均为 `passed`，schema 已验证到
  `0016_patient_directory_sync_owner_index`；微信支付为 `disabled`，患者/预约/门诊费用配置状态只表示字段完整，
  不表示 Provider 业务已经验收；
- 候选在 `127.0.0.1:18082` 以 production 模式隔离启动；runtime smoke 通过：live `200`、ready 连续 `3/3` 为 `200`、
  system ping `200`、未授权边界 `401`、关闭能力边界 `404`；
- smoke 结束后临时进程已回收，`18082` 无残留。

## 原子切换与共存复核

切换使用同目录 `current.next -> current` 原子替换：

```text
1e58bb66 -> 84370077024762d92050cf077c27f3c60302e8f8
```

切换后独立只读复核结果：

- `current` 指向 `/home/ps/code/hospital-platform/releases/84370077024762d92050cf077c27f3c60302e8f8`，服务为 `active`；
- 新 API 监听 `10.0.0.3:18081`，内网 readiness 和公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 均为 `200/ready`；
- 启动时间为 `2026-08-22 16:37:01 CST`，启动日志确认 `environment=production`、`runtimeMode=production` 和
  `wechatPaymentRuntime=fail_closed`；
- 旧 Python `0.0.0.0:8001` 仍监听，原 Gunicorn PID 集合为 `3687390、3687419、3687420、3687421、3687422`，
  与切换前一致；
- `18082` 无残留；Worker 没有被启动。

## 低敏日志聚合

从新 API active 时间开始使用候选 release 的 `p0-log-aggregate.js` 读取 journald：

| 指标 | 结果 |
| --- | ---: |
| inputLines | 14 |
| parsedRecords | 8 |
| parseErrors | 0 |
| systemdWarningCount | 0 |
| HTTP 200 完成事件 | 5 |
| 业务域 | 仅 infrastructure |

该窗口只有启动、停止、健康探针和运行层请求，没有微信登录、患者、预约、门诊费用或 Provider 业务事件。
因此日志证明的是部署和可观测性，不是业务验收成功。

## 当前业务停止条件

本次发布没有打开患者新增/绑定、二维码、病历、预约写入、支付、医保授权、退款、HIS 写回或报告 Provider。
当前下一步仍是使用配套 `7f09bbb` 小程序候选取得微信登录、显式就诊人切换、预约历史和门诊费用的页面、客户端
requestId、Provider requestId（如有）与服务端 Pino 日志三层证据；真实支付、医保和结算继续最后处理。
