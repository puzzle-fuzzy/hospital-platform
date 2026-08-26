# 公网运行层只读复核（2026-08-26 14:27 CST）

## 结论

本次只访问新 Elysia API 的健康探针和未登录边界，没有发送患者、预约、报告、费用、支付、医保或 Provider 业务请求，
没有写入 MySQL/Redis，没有重启进程，也没有修改旧 Python 服务。结果证明公网入口和依赖就绪状态当前没有明显漂移，
不等于小程序候选已发布，也不等于任何业务域已完成真机验收。

## 公网结果

| 请求 | HTTP | 响应事实 |
| --- | ---: | --- |
| `GET https://test-hp.meiyi.pro/api/v2/health/live` | 200 | `success=true`，服务状态 `ok`；响应带 `Cache-Control: no-store` |
| `GET https://test-hp.meiyi.pro/api/v2/health/ready` | 200 | `status=ready`，`database=ok`、`redis=ok`、`schema=ok`；响应带 `Cache-Control: no-store` |
| `GET https://test-hp.meiyi.pro/api/v2/system/ping` | 200 | `success=true`，服务 `hospital-api`，API 版本 `0.1.0` |
| `GET https://test-hp.meiyi.pro/api/v2/me/profile`（无 Authorization） | 401 | `error.code=unauthorized`，返回统一中文未登录提示；未进入资料或患者读取 |

## SSH 边界

使用只读命令尝试连接 `ps@192.168.112.172`，当前结果为 `Permission denied (publickey,password)`。
本轮没有尝试密码、没有改动 `/home/ps/.ssh/authorized_keys`、没有查看或重启 systemd 服务，也没有读取旧服务日志。
因此本记录不能证明内网 `18081` 与旧 Python `8001` 的当前监听状态；该项需要在 SSH 公钥恢复后重新做只读核验。

## 与业务验收的边界

- 这些探针只证明公网运行层、依赖 readiness 和认证边界；不能证明患者目录、挂号、爽约、门诊费用或普通资料的页面结果；
- 当前小程序 pending 候选仍为 `ded78c58`，live `dist` 仍为 `02dbf10`；候选发布锁和服务端 release baseline 仍按候选交接文档处理；
- 真机业务验收仍需同一候选的页面结果、客户端 `requestId`、服务端低敏日志和适用 Provider 关联证据。

