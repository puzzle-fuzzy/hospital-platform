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
| 当前服务端 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` | 当前线上仍是既有候选，未出现完整新 candidate |
| 内网 readiness | `database=ok`、`redis=ok`、`schema=ok` | 新服务基础依赖和 schema 已就绪 |
| 公网 live | `https://test-hp.meiyi.pro/api/v2/health/live` 返回 HTTP 200 | 公网反向代理和新服务健康入口可达 |
| 公网 ready | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 HTTP 200 | 公网路径上的数据库、Redis、schema readiness 可达 |

## 健康路径前缀边界

内网服务监听 `10.0.0.3:18081` 时，直接访问的路径是 `/health/live` 和
`/health/ready`；公网 Nginx 才把 `/api/v2/health/*` 路径转发到该服务的健康路由。
因此内网直接请求 `http://10.0.0.3:18081/api/v2/health/live` 得到 404 是预期的路由前缀不匹配，
不能据此判断 Elysia 服务停止；内网探针必须使用不带 `/api/v2` 的路径，公网验收必须使用带 `/api/v2` 的路径。

本次只读核对还确认：服务启动时间为 `2026-08-24 19:54:07 CST`，新服务和旧
Gunicorn 均保持运行；内网 `/health/*` 及公网 `/api/v2/health/*` 的成功结果不能替代业务请求证据。

## 11:06 CST 进程归属复核

2026-08-26 11:06 CST 进一步通过 inspection key 只读核对进程归属：

- 旧服务实际为 `/home/ps/miniconda3/envs/hospital/bin/gunicorn main:create_app`，工作目录为
  `/home/ps/code/Hospital-Backend`，4 个 worker 继续监听 `0.0.0.0:8001`；本次未停止、未重启、未修改该进程。
- 旧 Gunicorn 的 master 进程由 PID 1 直接托管并运行在 `user-1000.slice/session-308823.scope`；系统当前没有匹配
  `hospital`、`gunicorn`、`backend` 或 `python` 的 systemd service unit。因此某个猜测的旧 unit 显示
  `inactive`，不能作为旧服务停止的依据；维护时必须同时检查实际进程和 `8001` 监听。
- 新服务仍由 `hospital-platform-api-v2.service` 启动，ExecStart 指向
  `/home/ps/code/hospital-platform/current/apps/api/dist/index.js`，使用独立的 `10.0.0.3:18081`。
- 公网 `GET /api/v2/health/live`、`GET /api/v2/health/ready` 均返回 `200`；未带会话访问
  `GET /api/v2/me` 返回预期 `401 unauthorized`。内网直接访问 `127.0.0.1:18081` 会拒绝连接，
  这是监听地址边界，不是新服务故障。

这次复核仍未读取环境变量、数据库/Redis 业务数据、Bearer token 或患者标识，也没有向任一服务写入数据。

## 10:56 CST 再次只读复核

2026-08-26 10:56 CST 通过内网 inspection key 再次核对：服务端 release、监听地址和新旧进程状态未变化，
内网 `/health/live` 与 `/health/ready` 仍为成功；最近 15 分钟没有观察到新的患者、预约、费用、报告或资料低敏事件。
这只说明观察窗口内没有可配对的真实业务流量，不能推断 Provider 故障，也不能把 readiness 当作真机验收证据。
本次仍没有读取 env、数据库/Redis 业务数据或患者标识，没有修改、重启或切换任何服务。

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
