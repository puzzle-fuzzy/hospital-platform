# `6d58c9c` 生产切换与 0016 migration 验收（2026-08-17）

> 本文记录 2026-08-17 12:50-12:58 CST 对新 Elysia API 的候选切换。旧 Python `8001` 全程保持运行；
> 没有启动 Worker，没有打开支付、医保、报告或 HIS gate，没有执行预约写入、患者绑定或任何支付业务。
> 真机微信资料、多患者切换、预约历史和门诊费用仍需单独取得业务证据。

## 1. 候选与发布边界

| 项目 | 结果 |
| --- | --- |
| 本地候选 commit | `6d58c9c`（运行时代码基于 `7807aa8`，随后只增加发布/审计文档） |
| 线上切换前 | `current -> releases/131fb5a` |
| 线上切换后 | `current -> releases/6d58c9c` |
| API 端口 | 新 Bun/Elysia `10.0.0.3:18081`；旧 Python `0.0.0.0:8001` |
| 新 API unit | `hospital-platform-api-v2.service=active` |
| 运行模式 | journald `environment=production`、`runtimeMode=production` |
| 候选压缩包 SHA-256 | `99d0de97ef3017a54e41039be4980b61dfa3e110a0ff8b18aa33d1c2c817026e` |
| 旧服务 | 未停止、未修改、未重启 |

发布文件在本地构建后传输，服务器只执行已构建 bundle，不在 release 目录临时安装依赖或重新构建。
首次 dry-run 发现 Windows ZIP 的反斜杠路径和 runner 相对目录问题，均在 `current` 切换前被候选文件检查拦截；
错误目录已隔离，数据库当时 marker/index 均未改变。最终改用跨平台 tar，并按源码相对路径放置 runner 与 SQL。

## 2. 0016 migration

### 2.1 执行前

- 候选 schema probe 针对线上 `0015` 返回 `incomplete`，缺失项只有 `0016_patient_directory_sync_owner_index`；
- 新 API unit 被单独停止，旧 Python `8001` 仍有 1 个监听；新 API `18081` 暂时释放；
- 当前 release 仍为 `131fb5a`，没有先切换不完整候选。

### 2.2 执行结果

使用候选 release 自带的 `packages/persistence/src/migrate.js`，并通过受控环境显式允许远程生产 migration：

- `0015_patient_directory_sync_operations` 及之前 migration 均安全跳过；
- `0016_patient_directory_sync_owner_index` 执行成功；
- `hp_schema_migrations` marker 为存在；
- `hp_schema_migration_runs` 最新状态为 `succeeded`；
- `ix_hp_patient_sync_owner_provider_state` 列顺序为 `owner_user_id,provider_name,status,lease_until`；
- 候选 schema probe 返回 `status=ready`、`schemaStatus=verified`、`missingMigrationIds=[]`、`missingSchemaObjects=[]`。

这条 migration 只增加新端 operation ledger 的非唯一查询索引，不修改旧 Python 的 legacy 表、患者目录数据或
Redis namespace。若后续回滚 API 代码，保留该兼容索引，不自动删除，也不重放 migration。

## 3. 运行时与公网验收

启动日志确认：

- `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`；
- `authRuntimeStatus=ready`、微信身份配置 `configured`；
- 患者目录、预约目录、预约记录、门诊费用 `configured`；
- 微信支付、报告目录、报告详情 `disabled`。

候选生产 env preflight 通过：runtime configuration、微信/众阳配置、MySQL、Redis 和 `0016` schema 全部通过。

公网 `https://test-hp.meiyi.pro/api/v2` 的 runtime smoke 结果：

| 检查 | 结果 |
| --- | --- |
| `health/live` | 200 |
| `health/ready` | 6/6 连续采样通过，database/redis/schema 均为 `ok` |
| `system/ping` | 200 |
| 未登录受保护路由 | 401，错误码 `unauthorized` |
| 旧 Python `8001` | 仍监听 |

这证明的是候选运行边界和 schema readiness，不等于真实微信业务已完成。

## 4. 当前业务验收状态

已确认：

- 新旧服务继续共存；
- 新 API 已使用 `0016` schema 并正常启动；
- 公网 API 前缀仍为 `/api/v2`；
- 支付、医保、报告、HIS 和 Worker 没有被意外打开。

仍未宣称：

- Redis 会话 TTL 和过期后的 401；
- 真机微信资料默认值、首次更新、409 冲突；
- 第二位患者、多患者切换、inactive/recovery 和跨页面上下文；
- 预约历史、爽约、门诊费用的真实 Provider/公网/真机三层闭环；
- 预约写入、微信支付、医保授权/6201/6202/6301/6203/6401、退款和 HIS 回写。

下一步由真机操作触发真实低敏日志，再按“登录/会话 → 患者同步 replay → 显式切换 → 预约历史 → 门诊费用”的顺序验收；
任何 Provider 字段、状态或患者映射不符合已冻结 contract 时，立即停止该域，不用兼容分支掩盖问题。

## 5. 回滚边界

如果候选业务出现未解释的 5xx、schema 不一致或旧 `8001` 消失，只回滚新 API：

1. 将 `current` 原子切回切换前的 `131fb5a`；
2. 只重启 `hospital-platform-api-v2.service`；
3. 复核新 `18081`、公网 `/api/v2/health/ready` 和旧 `8001`；
4. 保留 `0016` 索引及 migration 证据，不执行 `DROP INDEX`、`FLUSHDB`、`FLUSHALL` 或删除 release。

`0016` 是向后兼容的非唯一索引；回滚代码不代表删除 schema。若 schema probe 报告 marker、索引或 run 状态不一致，
保持 gate 未就绪并交由 DBA 按 migration recovery 手册处理。
