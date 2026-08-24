# 2026-08-24 17:27 CST 线上运行层共存只读复核

> 本文只记录新服务运行层的只读证据，不代表微信登录、患者切换、预约、报告、门诊费用或真机业务已经完成验收。支付、医保、HIS 和旧 Python 业务均未被本次操作触发。

## 1. 复核范围

通过已配置的内网审计 SSH 连接 `192.168.112.172`，只读取当前 release、systemd 状态、监听端口、健康探针和新 API 启动日志。没有执行重启、停止服务、切换 release、修改 env、数据库写入、Redis 操作或 schema migration。

## 2. 结果

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/28a5c0c131794ce9dcc5f94bd3809402188ac87a` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python | `0.0.0.0:8001` 仍在监听；本次没有对旧服务执行任何操作 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 内网 readiness | `http://10.0.0.3:18081/health/ready` 返回 HTTP 200，database/redis/schema 均为 `ok` |
| 公网 readiness | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 HTTP 200，database/redis/schema 均为 `ok` |
| 启动模式 | journald 低敏日志包含 `environment=production` |
| 复核时间 | `2026-08-24 17:27:37 CST`（服务器时间） |

## 3. 与当前本地候选的关系

本地小程序候选 `dc287a4a82ceaded88909250cd9c8f13741670ab` 未部署到线上；线上小程序运行包仍按当前生产基线维护。运行层正常只证明新旧服务共存和依赖可用，不能把 readiness 200 当作患者端业务成功，也不能代替页面、客户端 requestId、服务端 traceId 和 Provider 低敏 requestId 的同链证据。

下一步仍按当前候选验收手册采集已开放的只读业务；病历、二维码、患者新增绑定、支付、医保和 HIS 回写继续保持关闭，直到正式 contract 和真实验收材料齐全。
