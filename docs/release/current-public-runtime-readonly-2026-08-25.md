# 当前公网运行层只读复核（2026-08-25）

> 观察时间：2026-08-25 23:35 CST。目标为 `https://test-hp.meiyi.pro`。
> 本记录只证明公网反向代理能够到达新 API 的运行层，不证明小程序候选已经发布，
> 也不证明任何患者、Provider、预约、报告、费用、支付或医保业务已经验收。

## 1. 只读结果

| 路径 | HTTP | 返回事实 |
| --- | ---: | --- |
| `/api/v2/health/live` | 200 | `success=true`，服务 `hospital-api`，状态 `ok` |
| `/api/v2/health/ready` | 200 | `success=true`，状态 `ready`，`database/redis/schema=ok` |
| `/api/v2/system/ping` | 200 | `success=true`，服务 `hospital-api`，API 版本 `0.1.0` |

## 2. 边界

- 本次仅使用无认证 GET 请求，没有写入数据库、Redis 或 Provider。
- 本次没有重启、修改或停止旧 Python 服务，也没有修改阿里云转发配置。
- SSH 只读核对当前仍未取得权限，因此不能仅凭公网探针推断线上 release、监听进程或旧服务共存状态；
  这些事实仍以对应的服务器侧发布记录为准。
- 运行层探针通过不代表 A 批次业务完成。预约历史、爽约、报告、门诊费用、普通资料和患者切换仍需要
  同一候选下的页面、客户端 requestId、服务端低敏事件和 Provider 结果组成同链证据。

