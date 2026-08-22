> 当前候选刷新（2026-08-22）：服务端 release 为 `0e2a366efcca8da25d7edd4a286781f2d3dfdbec`；小程序运行包来源为 `4ba492a3fdae8283409bd2ab4a0a45247c46600c`（提交 `4ba492a`）。本次运行包显式校验修正已进入最新本地候选，真实真机证据仍待。

# `0e2a366e` 新 API 生产共存发布验收记录（2026-08-22）

> 本记录是当前服务端运行层发布事实源。它证明门诊费用只读 adapter 的安全作用域补丁已部署到新 API，
> 以及新旧服务共存没有被破坏；它不把真机、微信会话、众阳门诊费用业务成功或支付能力误记为已完成。

## 版本与范围

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` |
| 发布前线上 release | `84370077024762d92050cf077c27f3c60302e8f8` |
| 配套小程序运行包来源 | `4ba492a3fdae8283409bd2ab4a0a45247c46600c`（提交 `4ba492a`） |
| 新 API | 仅切换并重启 `hospital-platform-api-v2.service` |
| 旧 Python | 未修改、未停止、未重启；`8001` 持续监听，Gunicorn PID 集合保持不变 |
| Worker | `hospital-platform-worker-v2.service` 未启动，保持 `inactive` |
| 数据库/Redis/schema | 使用真实 `shared/api.env` 的只读 preflight 和 readiness 通过；未执行 migration |
| 支付/医保/HIS/报告 | 支付运行闸门为 `fail_closed`；未发起支付、医保、HIS 写回或报告 Provider 请求 |

## 候选产物与发布前验证

- 本地 `pnpm build` 通过，9 个 workspace 构建成功；小程序运行包仍为 14 个页面且不含测试脚本；
- 8 个服务端 bundle 的本地/远端 SHA-256 已逐项对照；上传压缩包 SHA-256 为
  `64e31332903bf598678a456f3f189da36b40beafba8e3417a9428874afde50c2`；
- 使用真实生产 `shared/api.env` 的 preflight 通过：MySQL、Redis、schema 均为 `passed`，schema 已验证到
  `0016_patient_directory_sync_owner_index`；微信身份、患者、预约和门诊费用依赖配置已加载，微信支付保持关闭；
- 候选先在 `127.0.0.1:18082` 以 production 模式隔离启动；runtime smoke 的 live/ready、system ping、未授权边界和关闭能力边界全部通过，随后临时进程已回收。

## 原子切换与共存复核

切换使用同目录 `current.next -> current` 原子替换：

```text
84370077024762d92050cf077c27f3c60302e8f8 -> 0e2a366efcca8da25d7edd4a286781f2d3dfdbec
```

切换后独立只读复核结果：

- `current` 指向 `/home/ps/code/hospital-platform/releases/0e2a366efcca8da25d7edd4a286781f2d3dfdbec`，服务为 `active`；
- 新 API 监听 `10.0.0.3:18081`，内网和公网 `https://test-hp.meiyi.pro/api/v2/health/ready` 均为 `200/ready`；
- 启动日志确认 `environment=production`、`runtimeMode=production`、`persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`，并保持 `wechatPaymentRuntime=fail_closed`；
- 旧 Python `0.0.0.0:8001` 仍监听，Gunicorn PID `3687390、3687419、3687420、3687421、3687422` 与切换前一致；
- `18082` 无残留；Worker 没有被启动。

## 公网 runtime smoke

使用当前 release 的 `api-runtime-smoke.js` 对 `https://test-hp.meiyi.pro/api/v2` 验证：

| 检查 | 结果 |
| --- | --- |
| live | `200` |
| ready 连续 3 次 | `200`，3/3 通过 |
| system ping | `200` |
| 无会话认证边界 | `401 unauthorized` |
| 关闭能力边界 | `404 not-found` |

该 smoke 只证明运行层和认证/关闭边界，不登录微信、不读取患者、不访问预约或门诊费用 Provider。

## 低敏日志观察

切换窗口使用当前 release 的日志聚合 bundle 读取 journald：

| 指标 | 结果 |
| --- | ---: |
| inputLines | 33 |
| parsedRecords | 27 |
| parseErrors | 0 |
| systemdWarningCount | 0 |
| HTTP 200/401/404 | `9/8/7` |
| 业务域 | 仅 infrastructure |
| 门诊费用 requested/success | `0/0` |

其中 `401/404` 是 runtime smoke 的预期认证和关闭能力边界，不能解释为门诊费用 Provider 失败；窗口没有真实微信、患者、预约或门诊费用业务事件。

## 当前停止条件

本次发布只完成门诊费用只读代码和运行层部署，没有完成真实 Provider 非空样例、微信真机页面、客户端 requestId、Provider requestId 与服务端 Pino 日志的三层同链验收。
下一步必须使用当前配套小程序执行微信登录、显式就诊人切换、预约历史和门诊费用只读操作；支付、医保、退款、HIS 写回和 Worker 继续关闭。
