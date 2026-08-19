# 当前 `b7c9451` P0 业务日志只读观察（2026-08-19 08:15 CST）

## 1. 结论

本次通过 SSH 对当前线上新 API 做只读复核，没有重启、切换、迁移、Redis 清理或业务写入；旧 Python 服务也没有被修改。
当前 `hospital-platform-api-v2.service` 为 `active`，新 Bun/Elysia API 监听 `10.0.0.3:18081`，旧 Python/Gunicorn
继续监听 `0.0.0.0:8001`，新旧服务共存边界保持不变。

当前日志窗口只证明患者目录读模型链路真实进入并完成过；它不证明微信真机页面、患者显式切换、预约历史、门诊费用、报告或普通资料已经验收。

## 2. 取证范围和方法

| 项目 | 结果 |
| --- | --- |
| 服务端 release | `b7c9451` |
| 日志窗口 | `2026-08-19 07:30:00` 起至本次 SSH 复核时间 |
| 解析方式 | 当前 release 的 `apps/worker/dist/p0-log-aggregate.js --json` |
| 输入范围 | `hospital-platform-api-v2.service` journald；不读取旧 Python 服务日志 |
| 解析记录 | 84 条有效记录，1 条空行 |
| 解析错误 | `0` |
| systemd warning | `0` |
| HTTP 完成 | 28 次，全部为 `200` |
| 关联链 | 28 条，缺失链 `0`，截断 `false` |
| Provider request ID | 仅记录数量 `7`，不保存或输出原值 |

聚合结果只保留事件计数、HTTP 状态和不可逆关联指纹；本记录不保存 traceId、requestId、openid、患者号、金额或 Provider 原文。

## 3. P0 业务域结果

| 业务域 | 请求/成功 | 同链 HTTP 2xx | 结论 |
| --- | ---: | ---: | --- |
| 患者目录读取 | `14/14` | `14` | 通过日志链门禁 |
| 患者目录同步 | `7/7` | `7` | 通过日志链门禁 |
| 微信登录 | `0/0` | `0` | 本窗口没有新的登录事件，不能推断真机登录成功 |
| 预约历史 | `0/0` | `0` | 未验收 |
| 门诊费用只读 | `0/0` | `0` | 未验收 |
| 报告目录 | `0/0` | `0` | 未验收 |
| 普通资料读取/更新 | `0/0` | `0` | 未验收 |

患者同步成功事件的低敏摘要均显示 `patientCount=1`、`activePatientCount=1`、`deactivatedPatientCount=0`，并建立了 `1` 条医院档案引用。
这只能说明当前账号在该窗口观察到一位可用患者，不能替代第二位患者显式切换或失效/恢复场景验收。

## 4. 下一步

1. 使用当前小程序候选 `b2ce91e` 重新编译并扫码，建立新的真机微信会话。
2. 保存首页、患者选择页和切换后的业务页面截图，同时记录同一请求的 `requestId/traceId`，但不要保存 token、openid、完整身份证或 Provider 患者号。
3. 先验收患者选择和显式切换，再按只读候选手册验收预约历史、爽约记录和门诊费用。
4. 只有页面、HTTP 和同一时间窗口低敏日志三层对齐后，才更新对应业务域为已验收；支付、医保、二维码、HIS 和预约写入继续保持关闭。

关联文档：

- [`miniprogram-readonly-acceptance-candidate-2026-08-18.md`](miniprogram-readonly-acceptance-candidate-2026-08-18.md)
- [`p0-readonly-business-acceptance-runbook-2026-08-17.md`](p0-readonly-business-acceptance-runbook-2026-08-17.md)
- [`b7c9451-production-acceptance-2026-08-19.md`](b7c9451-production-acceptance-2026-08-19.md)
