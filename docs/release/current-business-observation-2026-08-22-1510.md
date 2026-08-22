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

## 解释边界

本窗口只能证明新 API 的事件名计数中没有新的业务域请求，不能证明微信、Provider 或页面功能正常/失败；
也不能替代手机页面、客户端 requestId/traceId 和服务端业务事件的三层证据。尤其不能把“没有 `auth.*`”
解释成微信登录失败，因为当前没有对应的手机操作或客户端请求作为起点。

下一次真实验收仍必须从当前小程序运行包重新普通编译、生成新二维码并扫码，先取得微信登录和患者目录三层链，
再按预约历史/爽约、门诊费用、普通资料只读顺序推进。报告 Provider、患者绑定、二维码、支付、医保和 HIS 回写
继续保持关闭。

