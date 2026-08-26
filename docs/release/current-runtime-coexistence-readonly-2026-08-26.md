# 新旧服务共存只读复核（2026-08-26）

本文只记录本次不带业务凭据的运行层预检，不代表患者、预约、费用或 Provider 业务已经验收。
本次只读取服务状态、监听端口、健康检查和公网 readiness；没有读取环境变量、数据库/Redis 业务内容、
Bearer token、患者标识，也没有重启、切换或修改任何服务。

## 复核结果

| 检查项 | 结果 | 能证明什么 |
| --- | --- | --- |
| 新 Elysia systemd 服务 | `hospital-platform-api-v2.service=active` | 新服务进程仍在运行 |
| 新服务监听 | `10.0.0.3:18081` | 新服务使用独立内网监听，不占用旧端口 |
| 旧 Python 监听 | `0.0.0.0:8001` | 旧服务仍在监听，本次没有停止或重启 |
| 内网 readiness | `database=ok`、`redis=ok`、`schema=ok` | 新服务基础依赖和 schema 已就绪 |
| 公网 live | `https://test-hp.meiyi.pro/api/v2/health/live` 返回 HTTP 200 | 公网反向代理和新服务健康入口可达 |
| 公网 ready | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 HTTP 200 | 公网路径上的数据库、Redis、schema readiness 可达 |

## 业务边界

这次复核没有调用 `/patients`、预约历史、门诊费用、报告或普通资料业务接口，因此不能证明：

- 当前微信会话和患者 owner 映射有效；
- 预约记录、爽约记录和门诊费用能够从 Provider 返回；
- 普通资料 GET/PUT 的 canonical 版本和 409 冲突链路有效；
- 页面、客户端 `requestId`、服务端 `traceId` 和 Provider 低敏请求号已经形成同链证据。

下一步仍按 A 批次验收计划执行：使用已经发布到 live `dist` 且与 `02dbf10` 绑定的运行包，重新普通编译并生成二维码，
再使用一次性短时 Bearer 会话和对应的 opaque `patientId` 进行受控只读验收。凭据不得写入仓库、命令行参数、shell history、
常驻 systemd 环境、日志或验收文档；没有三层/四层证据时继续保持 `pending`，不扩大到支付、医保、二维码、
患者绑定或 HIS 回写。

## 证据来源

- SSH 只读检查：`ps@192.168.112.172`，使用本机专用 inspection key；仅执行 systemd、监听端口和 readiness 查询。
- 公网只读检查：`test-hp.meiyi.pro` 的 `/api/v2/health/live` 与 `/api/v2/health/ready`。
- 相关执行顺序：[`next-readonly-business-acceptance-plan-2026-08-26.md`](next-readonly-business-acceptance-plan-2026-08-26.md)。
