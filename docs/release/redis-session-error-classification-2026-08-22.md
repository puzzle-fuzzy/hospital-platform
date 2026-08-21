# Redis 会话错误分类审计（2026-08-22）

## 结论

本轮发现新 API 会话层的一个错误分类缺口：Redis 已注入但发生连接、ACL 或传输失败时，
会话服务原先将异常包装为 `dependency-not-configured`。这与“Redis 未配置/未注入”混淆，
也会让运维和小程序无法区分配置缺失与暂时故障。

现在已将会话存储的读写故障统一投影为 `PersistenceUnavailableError`：

| 事实 | HTTP | 公共错误码 | 客户端语义 |
| --- | ---: | --- | --- |
| Redis 未注入或 gate 未打开 | 503 | `dependency-not-configured` | 配置缺失，不进入业务重试 |
| Redis 正常读取但 token 不存在/已过期 | 401 | `unauthorized` | 允许有限的一次重新登录 |
| Redis 已配置但连接/ACL/传输失败 | 503 | `persistence-temporarily-unavailable` | 保留本地会话，不误清理为退出登录 |
| Redis 返回非法 userId 读模型 | 500 | `persistence-invalid` | 停止 owner-scoped 业务，不伪装成 401 |

这四类事实不能通过“都是 503”合并，也不能让客户端依据英文或底层异常文本分支。

## 修复边界

- `packages/persistence/src/redis-session.ts`
  - `GET`/`SET` 传输失败在 persistence 适配边界转换为 `PersistenceUnavailableError`；
  - 保留操作分类 `read`/`write` 和允许列表错误码，原始 Redis 异常只保留在内部 cause；
  - 不记录 token、Redis key 或用户身份。
- `apps/api/src/modules/auth/service.ts`
  - 生产和可替换 session store 都保持持久化暂不可用错误，不再把已配置故障误报为配置缺失；
  - `requirePrincipal` 不把该错误降级为 401；
  - 只有 Redis 正常返回空值时才进入“登录状态已失效”的 401 分支。
- `apps/api/src/app.test.ts`、认证/持久化测试
  - 覆盖会话写入、读取、HTTP 映射和鉴权入口的分类边界。
- `docs/api-v2-public.md`、`docs/logging.md`、`docs/wechat-auth-login.md`
  - 同步公共错误码、日志检索和真机排障说明。

## 本地验证

```text
packages/persistence：94 pass / 0 fail / 607 expects
apps/api：206 pass / 0 fail / 849 expects
定向 auth/error/logging/redis：84 pass / 0 fail / 388 expects
docs:audit：453 篇文档，无断链
typecheck、Biome：通过
```

## 生产边界

本轮只修改新项目代码和文档，未修改旧 Python 项目、Nginx、线上 MySQL/Redis、Redis ACL。
修复已随 `7181e99e3a352244102f5591279528b3b66332c9` 完成隔离候选 preflight、runtime smoke、
原子切换和旧 `8001` 共存复核；当前生产 release 已是 `7181e99e`。详细的 checksum、切换前后
监听和启动日志证据见 [`7181e99e-production-acceptance-2026-08-22.md`](7181e99e-production-acceptance-2026-08-22.md)。

本次发布只重启新 `hospital-platform-api-v2.service`，没有重启旧 Python、Worker，也没有执行
数据库 migration 或业务写入；`PersistenceUnavailableError` 的真实 Redis 故障路径仍需通过
受控故障注入或真实故障日志继续观察，不能用健康探针代替。

即使修复部署，真实微信登录、患者切换、预约/门诊费用 Provider 和真机链路仍需按当前准入记录
单独验收；支付、医保、HIS 写回继续保持最后专项。
