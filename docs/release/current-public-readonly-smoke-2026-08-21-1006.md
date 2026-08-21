# 公网只读边界复核（2026-08-21 10:06 CST）

> 本文只记录从开发机访问 `test-hp.meiyi.pro` 的无凭证 HTTPS 探针，不代表微信登录、患者目录、预约、门诊费用、Provider 或真机页面已经完成验收。本次没有携带 Bearer、患者标识、Provider 凭证，也没有写入 MySQL/Redis。

## 1. 请求结果

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `GET /api/v2/health/live` | 200 | `success=true`，服务状态 `ok` |
| `GET /api/v2/health/ready` | 200 | `success=true`，`database=ok`、`redis=ok`、`schema=ok` |
| `GET /api/v2/system/ping` | 200 | `success=true`，服务为 `hospital-api` |
| `GET /api/v2/me` | 401 | `unauthorized`，中文提示要求先登录 |
| `GET /api/v2/patients` | 401 | `unauthorized`，未登录不能读取患者目录 |
| `GET /api/v2/medical-records` | 404 | `not-found`，病历路由保持关闭 |
| `GET /api/v2/patient-binding/commands` | 404 | `not-found`，患者绑定命令路由保持关闭 |

## 2. 结论

1. 公网 `/api/v2` 版本前缀和新 API 健康边界可达；
2. 未登录请求没有绕过会话进入患者数据；
3. 尚无 Provider、业务数据或真机页面证据，不能把这些 HTTP 结果计入微信登录、患者同步、预约历史或门诊费用成功；
4. 病历、患者绑定、二维码、支付、医保和 HIS 回写继续保持未开放。

本次 SSH 只读连接 `ps@192.168.112.172` 仍返回 `Permission denied (publickey,password)`，因此没有在本记录中声称线上 `current` 已切换到本地候选 `e5ef94a`；候选发布准备和前置条件见 [`candidate-e5ef94a-server-local-build-2026-08-21.md`](candidate-e5ef94a-server-local-build-2026-08-21.md)。
