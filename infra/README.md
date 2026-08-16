# 本地基础设施

这里的 Compose 只服务于本地开发和隔离集成验收，不承载生产数据。

| 服务 | 地址 | 用途 |
| --- | --- | --- |
| MySQL 8.4 | `127.0.0.1:3307` | 订单、患者、报价和 outbox 目标库 |
| Redis 7.4 | `127.0.0.1:6380` | API session TTL 存储 |

启动与停止：

```powershell
pnpm infra:up
pnpm db:migrate
pnpm db:integration
pnpm infra:down
```

发布前可以运行只读 preflight；它检查运行配置、MySQL/Redis 探针和全部目标
migration，不执行 migration，也不会调用微信支付或其他 provider：

```powershell
pnpm runtime:preflight
```

preflight 返回非零并不代表代码故障：在真实商户配置、schema staging 验收和公网
HTTPS 回调尚未完成时，`PERSISTENCE_SCHEMA_READY` 或 provider 配置检查应当保持失败。

API 进程可响应性可以单独检查，不需要 provider 凭证：

```powershell
$env:HOSPITAL_API_BASE_URL = "http://127.0.0.1:3000"
$env:HOSPITAL_ALLOW_LOCAL_HTTP = "true"
pnpm runtime:smoke
```

发布或 staging 验收必须额外设置 `$env:HOSPITAL_RUNTIME_REQUIRE_READY = "true"`，让
`health/ready.data.status=not_ready` 使命令失败。该 smoke 还会检查 live/ready 的
`Cache-Control: no-store` 没有被反向代理移除；它只请求平台自身的 live、ready 和 ping，
不执行 migration，也不调用 provider。

PowerShell 中运行 migration 和 integration 时，需要为当前进程提供本地连接串：

```powershell
$env:DATABASE_URL = "mysql://hospital:hospital_dev_password@127.0.0.1:3307/hospital_platform"
$env:REDIS_URL = "redis://127.0.0.1:6380"
pnpm db:migrate
pnpm db:integration
```

Compose 使用的是显式开发凭据，只允许绑定到本机端口。不要把这些凭据或这个 Compose 配置当成生产部署模板；生产环境必须使用密钥管理、独立账号和独立数据库。

`pnpm db:migrate` 是唯一的 schema 变更入口。API 启动不会自动迁移，也不会因为 migration 命令成功就自动设置 `PERSISTENCE_SCHEMA_READY`。

微信授权登录的 staging/生产启用顺序、MySQL 身份表、Redis 会话 TTL、合法域名、日志检索和回滚见
[`docs/wechat-auth-login.md`](../docs/wechat-auth-login.md)。不要为了登录验收直接复用旧服务数据库或旧服务 env。
