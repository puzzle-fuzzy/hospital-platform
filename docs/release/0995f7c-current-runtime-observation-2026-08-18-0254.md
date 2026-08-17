# 0995f7c 当前运行时只读观察（2026-08-18 02:54 CST）

本文记录本次通过 SSH 和公网 HTTPS 取得的运行时快照。它只证明当前 release、
新旧服务共存和健康检查边界，不证明微信登录、患者切换、预约历史、爽约记录或门诊费用
已经完成真实业务验收。

## 1. 采集范围

本次只执行以下只读动作：

- SSH 登录服务器，读取当前 release 软链接、API systemd 状态和 TCP 监听状态；
- 通过公网 HTTPS 请求 `/api/v2/health/live` 和 `/api/v2/health/ready`；
- 通过公网 HTTPS 对预约历史和门诊费用保护接口发送不带会话的请求，只验证认证边界；
- 不读取原始 journald，不执行 sudo，不重启服务，不修改文件、数据库、Redis 或配置；
- 不发送任何患者、预约、报告、费用或支付业务请求。

## 2. 结果

| 检查项 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/0995f7c` |
| 新 Bun/Elysia API | `10.0.0.3:18081`，systemd `hospital-platform-api-v2.service=active` |
| 旧 Python API | `0.0.0.0:8001`，仍在监听 |
| 公网 live | `GET https://test-hp.meiyi.pro/api/v2/health/live` 返回 `200` |
| 公网 ready | `GET https://test-hp.meiyi.pro/api/v2/health/ready` 返回 `200` |
| 缓存策略 | live/ready 均返回 `Cache-Control: no-store` |
| ready.database | `ok` |
| ready.redis | `ok` |
| ready.schema | `ok` |
| 本次患者/Provider 业务请求 | `0`；健康检查和未登录认证边界请求均未进入业务链路 |
| 未登录预约历史 | `GET /api/v2/appointments/records` 返回 `401 unauthorized` |
| 未登录门诊费用 | `GET /api/v2/payments/outpatient/records` 返回 `401 unauthorized` |

公网响应包含安全 `x-request-id`，但本文不保存该值；需要排障时应从受控日志权限中按采集时间检索，
不能把 request id、token 或患者标识写入小程序或普通文档。

## 3. 证据边界

本次观察可以证明：

1. `0995f7c` 仍是服务器当前 release；
2. 新 API 与旧 Python API 继续并行监听，没有因为本次只读检查停止旧服务；
3. 公网版本前缀、HTTPS、健康检查的 `200` 和 no-store 边界正常；
4. 当前 ready 探针报告 MySQL、Redis 和 schema 可用。
5. 预约历史和门诊费用在没有平台会话时会先经过统一认证边界，不会把未登录请求误送入患者映射或 Provider。

本次观察不能证明：

- 微信 `code2session`、平台会话 TTL 或真机授权登录成功；
- 当前账号的患者目录、`his-patient` 映射、多患者切换或失效恢复；
- 众阳预约历史、爽约状态、门诊待缴/已缴账单和字段映射；
- 业务日志的 `requested/synced/loaded/failed` 链路；
- 预约写入、微信支付、医保结算、退款或 HIS 回写。

因此本记录不能替代 [`readonly-business-contract-audit-2026-08-18.md`](readonly-business-contract-audit-2026-08-18.md)
要求的“页面 + HTTP/trace + 当前 release 低敏业务事件”三层证据。

## 4. 下一步

使用与 `0995f7c` 匹配的小程序运行包，在有效微信会话下按以下顺序操作，并逐页保存页面结果、HTTP 状态/trace
和低敏业务事件：

1. 登录并刷新患者目录；
2. 显式切换另一位可查询就诊人；
3. 进入“我的挂号”和“爽约记录”；
4. 分别进入门诊“待缴费”和“已缴费”；
5. 任一步出现持久化暂不可用、患者串用、Provider 字段非法或成功事件缺失，立即停止该域验收。

支付、医保、退款和 HIS 回写仍保持最后处理。
