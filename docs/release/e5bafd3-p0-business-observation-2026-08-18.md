# `e5bafd3` 微信登录与患者目录真实业务观察

> 观察时间：2026-08-18 10:09:11-10:09:14 CST
>
> 观察对象：当前生产 release `e5bafd3`，新 Bun/Elysia API；旧 Python API 未修改。
>
> 结论：本次有效微信会话完成登录、平台会话建立、患者目录读取、众阳患者同步和 HIS 患者引用映射；当前账号返回 1 位有效患者。预约历史、爽约记录、门诊费用和报告在这次操作中没有进入业务请求，不能标记为已验收。

## 1. 证据范围

- 证据来源：`hospital-platform-api-v2.service` 的 journald 结构化日志。
- 当前 release：`/home/ps/code/hospital-platform/releases/e5bafd3`。
- 日志时间统一按 UTC 记录；本文换算为中国标准时间（UTC+8）。
- 本文只记录 traceId、事件名、数量和状态码，不记录微信 code、session token、provider 患者号、用户 ID、身份证号或金额。

## 2. 已通过的业务链路

| 时间（CST） | HTTP/事件 | 结果 | 低敏证据 |
| --- | --- | --- | --- |
| 10:09:11 | `POST /api/v1/auth/wechat` | HTTP 200；微信身份交换成功，会话有效期 3600 秒 | traceId `mp-msy0xzja-wzo8iqun` |
| 10:09:12 | `GET /api/v1/me` | HTTP 200 | requestId `mp-msy0xzx9-q9dxxiyd` |
| 10:09:12 | `GET /api/v1/patients` | HTTP 200；读取 1 条目录记录 | traceId `mp-msy0y04f-g0knskr3` |
| 10:09:12-10:09:14 | `POST /api/v1/patients/sync` | HTTP 200；同步 1 条，active 1 条，deactivated 0 条，HIS patient mapping 1 条 | traceId `mp-msy0y0c1-xlbme8o2` |
| 10:09:14 | 同步后的 `GET /api/v1/patients` | HTTP 200；读取 1 条目录记录 | traceId `mp-msy0y0c1-xlbme8o2` |

同步日志同时记录了 `provider=zhongyang`、`attemptCount=1` 和 `hisPatientReferenceCount=1`。这证明当前账号的预约/费用查询前置映射已经落库，但不代表后续 provider 查询本身成功。

## 3. 尚未取得的证据

本次观察窗口没有出现以下事件，因此状态保持“未验收”，不能从配置项或空列表推导成功：

- `appointment.records.requested/synced`：我的挂号、预约历史；
- `appointment.records.*` 派生的爽约记录筛选；
- `outpatient.payment.records.requested/loaded`：门诊待缴/已缴只读列表；
- `report.*`：报告目录或详情；报告 gate 当前仍关闭。

此前登录前的一次报告请求返回 `401 unauthorized`，属于未登录认证边界，不属于报告 provider 验收。

## 4. 下一次真机取证顺序

使用同一 release 对应的小程序运行包，在已经登录且患者目录显示成功后，按以下顺序逐项操作，并为每项保留页面结果、HTTP 状态和低敏日志：

```text
进入“我的” -> 我的挂号（在线渠道） -> 爽约记录 -> 门诊缴费/待缴费 -> 已缴费 -> 更换就诊人后重复读取
```

“全部挂号”标签当前只保留原版视觉位置并提示迁移中，不应作为本轮业务验收入口；它需要独立的 Provider 渠道 contract。

若任一项返回 `unauthorized`、`patient-selection-required`、`patient-not-found`、`persistence-temporarily-unavailable` 或 provider 错误，先根据同一 traceId 定位会话、患者映射和 provider 边界；不能把失败降级为空列表，也不能在当前证据不足时打开支付、医保或 HIS 写回。
