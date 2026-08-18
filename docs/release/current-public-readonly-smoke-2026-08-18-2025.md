# 当前公网只读探针记录（2026-08-18 20:25 CST）

本文记录重启后的公网运行层复核。它只证明新 Bun/Elysia API 的健康状态、依赖可用性和认证关闭边界，
不证明微信登录、患者同步、患者切换、预约、报告、门诊费用或真机页面业务已经验收。

## 1. 探针范围

| 请求 | 结果 | 结论 |
| --- | --- | --- |
| `GET /api/v2/health/live` | `200`，`status=ok` | 进程存活 |
| `GET /api/v2/health/ready` | `200`，`database/redis/schema=ok` | 当前依赖和 schema 探针通过 |
| `GET /api/v2/system/ping` | `200` | 新 API 路由可达 |
| `GET /api/v2/me/profile`（无 Bearer） | `401 unauthorized` | 受保护资料边界正常 |
| `GET /api/v2/patients`（无 Bearer） | `401 unauthorized` | 受保护患者边界正常 |

公网入口为 `https://test-hp.meiyi.pro`。请求未携带真实会话、openid、患者标识或 Provider 参数，
也没有触发写入、微信 code 交换、Provider 查询、支付、医保或 HIS 调用。

## 2. 共存和业务边界

- 本次只读请求没有修改或重启旧 Python 服务；旧服务继续由原端口承载未迁移能力。
- 本次没有取得新的业务 `requested → success` 事件，因此不能更新预约历史、报告、门诊费用或多患者切换的业务证据等级。
- 真实微信会话下的页面、HTTP trace 和低敏日志仍需按
  [`miniprogram-readonly-acceptance-candidate-2026-08-18.md`](miniprogram-readonly-acceptance-candidate-2026-08-18.md)
  逐域采集。
