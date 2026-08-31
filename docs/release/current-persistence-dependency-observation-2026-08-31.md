# 持久化 503 依赖来源观测与日志修正（2026-08-31）

本文记录 2026-08-31 线上登录 503 的只读证据，以及本仓库对后续排障日志的最小修正。本文不包含数据库地址、账号、连接串、SQL、Redis 键、微信凭证或用户数据；不授权重启、部署或重放登录请求。

## 1. 已观测的线上事实

通过 `ps@192.168.112.172` 读取 `hospital-platform-api-v2.service` 的 journald，确认本次 503 不是众阳 6201，也不是 Provider 业务拒绝：

| 字段 | 观测结果 |
| --- | --- |
| 请求路径 | `POST /api/v1/auth/wechat` |
| HTTP 状态 | `503` |
| 应用错误类型 | `PersistenceUnavailableError` |
| 持久化操作 | `read` |
| 安全错误码 | `ETIMEDOUT` |
| 单次耗时 | 约 `9.3s` |
| 运行环境 | `production` |

同一时间窗口可见多个不同 `requestId/traceId` 的失败请求。随后 `/health/ready` 恢复为 200，database、Redis 和 schema 探针均为 `ok`，因此该证据支持“持久化连接/传输层发生过瞬态超时并已恢复”的判断；它不能仅凭现有日志进一步证明故障来自 MySQL 还是 Redis。

当前线上 release 是 `5738a71e...`，仍缺少本次仓库修正中的依赖来源字段。因此本次没有把故障臆测为某一个具体依赖，也没有修改线上服务。

## 2. 仓库内修正

本次为 `PersistenceUnavailableError` 增加可选的固定来源 `persistenceDependency`：

- MySQL repository 和事务边界统一标记为 `mysql`；
- Redis session store 以及 Redis session service 的兜底包装统一标记为 `redis`；
- 未知或可替换实现不猜测来源，字段保持省略；
- HTTP 响应仍然是 `503 persistence-temporarily-unavailable`，没有改变用户可见文案、重试次数或写入安全边界；
- 日志仍只输出固定枚举、持久化操作和允许列表中的错误码，不输出原始异常消息。

相关测试覆盖来源枚举、MySQL/Redis 投影和请求日志白名单。该修正进入下一次受控 API release 后，维护人员可以使用同一个 `requestId/traceId` 判断 `read + mysql + ETIMEDOUT` 或 `read + redis + ETIMEDOUT`，再分别核对对应基础设施日志。

## 3. 发布边界

本修正不需要数据库 migration，但当前线上服务与仓库存在已登记的 runtime drift，且线上 schema 仍为 `0016`、仓库 head 为 `0017`。因此必须随完整候选 bundle 在受控窗口发布，先通过 release provenance、preflight、旧 Python `8001` 共存检查和 readiness，再观察新日志字段。不能只上传一个 JavaScript 文件，也不能通过修改审计器绕过漂移。

未取得下一次候选真实部署和运行日志前，本条只证明仓库代码已完成，不能反推线上已经具备 `persistenceDependency`。
