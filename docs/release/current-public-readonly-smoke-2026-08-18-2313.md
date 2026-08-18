# 当前公网只读复核（2026-08-18 23:13 CST）

本记录只覆盖重启后的公网运行层和未登录认证边界，不代表微信会话、患者目录、预约、报告或门诊费用业务已经完成真机验收。
本次只读取新 API 公网入口，没有访问旧 Python 端口，没有写入 MySQL/Redis，也没有调用 Provider。

## 复核结果

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `GET /api/v2/health/live` | 200 | `success=true`、服务 `hospital-api`、`version=0.1.0` |
| `GET /api/v2/health/ready` | 200 | `status=ready`，`database/redis/schema=ok` |
| `GET /api/v2/system/ping` | 200 | `success=true`、`apiVersion=0.1.0` |
| 未携带会话 `GET /api/v2/patients` | 401 | `unauthorized`，认证边界按预期拒绝 |

`health/live` 和 `health/ready` 均返回 `Cache-Control: no-store`。响应中没有记录患者、openid、token、Provider 引用或金额字段。

## 证据边界

- 这次探针证明公网 HTTPS、反向代理、新 API 响应和未登录 401 边界正常；
- readiness 的三个依赖为 `ok` 只证明当前探针时刻可用，不替代 Redis TTL、真实微信登录或 Provider 业务证据；
- 当前本地真机验收候选为小程序 `2902917`，完整来源指纹见 [`miniprogram-readonly-acceptance-candidate-2026-08-18.md`](miniprogram-readonly-acceptance-candidate-2026-08-18.md)；
- 预约写入、支付、医保、退款、HIS 回写和报告详情 gate 继续关闭；旧 Python 服务保持原样。
