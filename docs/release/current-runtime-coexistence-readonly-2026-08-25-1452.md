# 当前运行层共存只读复核（2026-08-25 14:52 CST）

本记录只证明服务器运行层和探针地址，不证明微信真机、患者、预约、费用、报告、Provider 或任何写入业务已经完成。
本次通过 `ps@192.168.112.172` 的 inspection key 执行只读命令，没有重启、切换 release、修改 env、读取数据库/Redis
业务内容、调用 Provider 或触发小程序业务请求。

## 复核结果

| 检查项 | 结果 |
| --- | --- |
| 服务器时间 | `2026-08-25T14:52:03+08:00` |
| 新 API systemd | `hospital-platform-api-v2.service=active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001`，仍与新 API 共存 |
| 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 正确 readiness | `GET http://10.0.0.3:18081/health/ready` 返回 `200`，database/redis/schema 均为 `ok` |
| 正确 system ping | `GET http://10.0.0.3:18081/api/v1/system/ping` 返回 `200` |

## 公网只读边界

随后从本机访问 `https://test-hp.meiyi.pro/api/v2`，只发送无会话 GET：

| 路径 | HTTP | 结论 |
| --- | --- | --- |
| `/health/live` | `200` | 新 API 存活 |
| `/health/ready` | `200` | database/redis/schema 就绪 |
| `/system/ping` | `200` | 版本化探针可达 |
| `/me/profile` | `401` | 普通资料没有绕过会话 |
| `/patients` | `401` | 患者目录没有绕过会话 |
| `/medical-records` | `404` | 门诊病历仍保持未注册/关闭 |
| `/payments/insurance/authorization` | `404` | 医保授权仍保持未注册/关闭 |

上述请求没有带 Bearer、患者标识或 Provider 参数，因此不产生患者/Provider 业务读取证据。

## 探针地址约束

本次第一次访问 `127.0.0.1:18081` 被拒绝，随后根据监听结果改用 `10.0.0.3:18081` 成功。
这不是服务异常，而是新 API 按设计只绑定内网地址 `10.0.0.3`。后续服务器侧 readiness 检查必须使用实际绑定地址，
不能把 `127.0.0.1` 失败误判为新服务停止；公网探针仍需沿用公网反向代理的正式地址单独核对。

## 对迁移验收的结论

- 新旧服务端口仍然共存，本次没有触碰旧 Python `8001`。
- 新 API 的依赖 readiness 正常，但这只代表运行层就绪，不增加任何业务完成度。
- 下一步仍按当前候选验收手册采集页面、客户端 `requestId`、服务端 `traceId`/业务日志和 Provider 低敏请求号；支付、医保、二维码、患者绑定和 HIS 回写继续关闭。

## 2026-08-25 15:05 CST 复核刷新

为避免后续会话继续依赖 14:52 的旧观察，本次再次使用同一个 inspection key 做只读检查：

| 检查项 | 当前结果 |
| --- | --- |
| 服务器时间 | `2026-08-25 15:05:44 CST` |
| 新 API systemd | `active` |
| 新 API 监听 | `10.0.0.3:18081` |
| 旧 Python 监听 | `0.0.0.0:8001` |
| 当前 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 内网 `/health/ready` | `200`，database/redis/schema 均为 `ok` |
| 公网 `/api/v2/health/ready` | `200`，database/redis/schema 均为 `ok` |

本次仍未重启服务、切换 release、修改 env、读取数据库/Redis 业务内容、调用 Provider 或触发小程序业务请求。
