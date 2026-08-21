# 当前公网健康探针观察（2026-08-22）

## 观察时间

2026-08-22 07:25:17（Asia/Shanghai）。本次只通过公网 HTTPS 访问新 API 的健康与系统探针，
没有携带 Bearer 会话、患者参数、Provider 参数，也没有写入 MySQL/Redis。

## 结果

| 请求 | HTTP | 低敏响应事实 |
| --- | ---: | --- |
| `GET /api/v2/health/live` | `200` | `status=ok`，服务名为 `hospital-api` |
| `GET /api/v2/health/ready` | `200` | `status=ready`，`database=ok`、`redis=ok`、`schema=ok` |
| `GET /api/v2/system/ping` | `200` | 新 API 的 `apiVersion=0.1.0` |

## 证据边界

- 这是公网代理、TLS、路由和新 API 依赖就绪的运行层证据，不是微信登录、患者同步、患者切换、预约、报告或门诊费用的业务证据。
- 没有携带会话，因此没有调用众阳、医保或 HIS，也没有产生业务 Provider 请求号。
- 本窗口没有 SSH 服务器端监听快照，不能据此声明旧 Python `8001` 的 PID 或 systemd 共存状态；旧项目和旧服务均未修改。
- 当前小程序 `dist/` 仍是未部署 `b0e09356` 本地候选；真实验收必须遵守 [`candidate-b0e0935-local-build-2026-08-22.md`](candidate-b0e0935-local-build-2026-08-22.md) 的来源边界。

## 下一步

继续使用与线上 release 配套的运行包取得微信真机三层证据：页面结果、客户端 `requestId/traceId`、
服务端低敏同链日志。健康探针不能替代这三层证据，也不能作为开放支付、医保、HIS 回写或 Provider gate 的理由。
