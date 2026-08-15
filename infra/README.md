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

PowerShell 中运行 migration 和 integration 时，需要为当前进程提供本地连接串：

```powershell
$env:DATABASE_URL = "mysql://hospital:hospital_dev_password@127.0.0.1:3307/hospital_platform"
$env:REDIS_URL = "redis://127.0.0.1:6380"
pnpm db:migrate
pnpm db:integration
```

Compose 使用的是显式开发凭据，只允许绑定到本机端口。不要把这些凭据或这个 Compose 配置当成生产部署模板；生产环境必须使用密钥管理、独立账号和独立数据库。

`pnpm db:migrate` 是唯一的 schema 变更入口。API 启动不会自动迁移，也不会因为 migration 命令成功就自动设置 `PERSISTENCE_SCHEMA_READY`。
