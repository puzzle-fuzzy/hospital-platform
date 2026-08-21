# 当前公网只读 smoke（2026-08-21 10:21 CST）

> 本记录只证明公网新 API 的健康、认证和关闭路由边界，不代表微信登录、患者同步、Provider、真机页面或任何写入业务已经验收。探针未携带 Bearer、微信身份、患者标识或 Provider 凭证。

## 1. 当前候选

| 项目 | 结果 |
| --- | --- |
| 公网入口 | `https://test-hp.meiyi.pro/api/v2` |
| 服务端 release 基线 | `5a31427` |
| 小程序候选来源（事后绑定） | `39ad2c5` |
| 小程序完整来源（事后绑定） | `39ad2c5937af2fdc735ffb223c0648464af3a48c` |
| 检查时间 | `2026-08-21 10:21:23 +08:00` |

## 2. 公网响应边界

| 请求 | HTTP | 结果 |
| --- | ---: | --- |
| `GET /health/live` | 200 | `status=ok`，服务 `hospital-api` |
| `GET /health/ready` | 200 | `database=ok`、`redis=ok`、`schema=ok` |
| `GET /system/ping` | 200 | API 基础响应正常 |
| `GET /me` | 401 | 未登录按预期拒绝 |
| `GET /patients` | 401 | 未登录按预期拒绝 |
| `GET /appointments/records` | 401 | 未登录按预期拒绝 |
| `GET /payments/outpatient/records` | 401 | 未登录按预期拒绝 |
| `GET /medical-records` | 404 | 病历目录 gate 保持关闭 |
| `GET /patient-binding/commands` | 404 | 患者绑定命令 gate 保持关闭 |

## 3. 证据边界

本次只读请求没有执行微信登录、患者同步、预约/支付/医保命令、Provider 调用或数据库写入；因此没有新增 `auth.*`、`patient.*`、预约或费用业务成功结论。该公网请求发生在本轮 `39ad2c5` 运行包于 10:30 CST 最终构建之前，表中的小程序来源只是事后绑定的当前发布基线，不能当作 10:21 已在真机运行的证据。SSH 只读连接本轮返回 `Permission denied (publickey,password)`，未进行服务器配置、日志或服务重启操作。真机验收仍必须使用 `39ad2c5` 重新生成的运行包和二维码，并采集页面、客户端请求、服务端低敏日志三层证据。
