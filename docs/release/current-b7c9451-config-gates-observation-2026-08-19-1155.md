# `b7c9451` 生产配置 gate 只读观察（2026-08-19 11:55 CST）

## 1. 观察范围

本次通过 SSH 只读检查新 API 当前 release、systemd 状态、正确监听地址、readiness 和共享环境文件中的
非敏感运行开关。环境文件中的 URL、密钥、token、证书和数据库凭证均未打印；没有调用 Provider、没有写入
数据库/Redis、没有修改 ACL、没有重启服务，也没有操作旧 Python 服务。

## 2. 当前运行事实

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/b7c9451` |
| 运行模式 | `NODE_ENV=production` |
| systemd | `hospital-platform-api-v2.service=active/running` |
| 新 API | `10.0.0.3:18081` |
| 旧 Python | `0.0.0.0:8001`，继续共存 |
| readiness | `database=ok`、`redis=ok`、`schema=ok` |
| 根分区 | 95% 使用率，继续作为运维风险跟踪 |

## 3. 非敏感 gate 状态

| gate | 当前值 | 解释 |
| --- | --- | --- |
| `PERSISTENCE_SCHEMA_READY` | `true` | 允许使用已确认 schema 的持久化运行时 |
| `WECHAT_IDENTITY_READY` | `true` | 微信身份交换配置准入 |
| `ZHONGYANG_PATIENT_DIRECTORY_READY` | `true` | 患者目录 adapter 配置准入 |
| `ZHONGYANG_APPOINTMENT_DIRECTORY_READY` | `true` | 预约科室/排班目录配置准入 |
| `ZHONGYANG_APPOINTMENT_RECORDS_READY` | `true` | 预约记录配置准入 |
| `ZHONGYANG_OUTPATIENT_PAYMENT_READY` | `true` | 门诊费用只读配置准入 |
| `WECHAT_PAYMENT_READY` | `false` | 微信支付继续关闭 |
| `ZHONGYANG_REPORT_DIRECTORY_READY` | `false` | 报告目录继续 fail-closed |
| `ZHONGYANG_REPORT_DETAIL_READY` | `false` | 报告详情继续 fail-closed |

`true` 只表示配置和代码 gate 允许进入下一层，不等于 Provider 成功、页面正确、真机完成或支付可用。
患者切换、预约/费用公网链路、报告真实 Provider、Redis 实际 TTL 和真机三层证据仍必须单独取得。

相关 readiness 与会话边界见 [`current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md`](current-b7c9451-session-and-readiness-observation-2026-08-19-1149.md)。
