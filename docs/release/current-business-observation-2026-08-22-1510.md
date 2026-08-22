# 当前新 API 低敏业务观察（2026-08-22 15:10 CST）

## 观察范围

本次通过 `ps@192.168.112.172` 只读 SSH，在服务器端查询新 API
`hospital-platform-api-v2.service` 最近约 45 分钟的 journald。只提取日志中的事件名并计数，未读取、复制或
带回原始日志正文、请求头、token、患者信息或 Provider 响应。

本次没有执行部署、重启、数据库/Redis 写入、Provider 请求，也没有操作旧 Python 服务。

## 低敏结果

| 事件 | 数量 |
| --- | ---: |
| `http.request.completed` | 6 |
| `service.started` | 1 |
| `service.stopped` | 1 |
| `service.stop.requested` | 1 |
| 微信登录 `auth.*` | 未出现 |
| 患者目录/同步 `patient.*` | 未出现 |
| 预约 `appointment.*` | 未出现 |
| 门诊费用 `outpatient.payment.*` | 未出现 |
| 普通资料 `user.profile.*` | 未出现 |
| 报告 `report.*` | 未出现 |

## 2026-08-22 15:16 CST 当前发布基线复核

随后通过同一台服务器执行只读运行层检查，并在本地对当前工作树执行 `pnpm check`。这些检查没有
触发部署、重启或业务写入：

| 检查项 | 结果 |
| --- | --- |
| 当前服务端 release | `1e58bb66bf24021d2b680eb5fd03abfec467989a` |
| 当前小程序来源 | `7f09bbb2cf32d4753795bcbc91fe23ec05eeeee6` |
| 新 API systemd 状态 | `active` |
| 新 API 内网监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，仍在监听 |
| Worker 状态 | `inactive` |
| 新 API `/health/live` | `200` |
| 新 API `/health/ready` | `200` |
| 最近 60 分钟业务证据 | 所有指定业务域 `requested=0 / success=0` |
| journald 解析错误 / systemd 警告 | `0 / 0` |
| 本地 `pnpm check` | 通过：架构、迁移、Provider、文档、日志、发布基线、Biome、类型检查、测试、构建均通过 |

这里的 `requested=0 / success=0` 只表示该时间窗口没有进入这些业务链路，不能作为 Provider、微信登录或页面
功能失败的结论；当前候选仍需要从正确的小程序运行包重新生成二维码，并取得手机页面、客户端 requestId
和服务端同链业务事件三层证据。旧 Python 服务未修改、未重启。

## 解释边界

本窗口只能证明新 API 的事件名计数中没有新的业务域请求，不能证明微信、Provider 或页面功能正常/失败；
也不能替代手机页面、客户端 requestId/traceId 和服务端业务事件的三层证据。尤其不能把“没有 `auth.*`”
解释成微信登录失败，因为当前没有对应的手机操作或客户端请求作为起点。

下一次真实验收仍必须从当前小程序运行包重新普通编译、生成新二维码并扫码，先取得微信登录和患者目录三层链，
再按预约历史/爽约、门诊费用、普通资料只读顺序推进。报告 Provider、患者绑定、二维码、支付、医保和 HIS 回写
继续保持关闭。
