# 患者同步幂等生产验收记录（2026-08-16）

> 本记录只证明 `0015` schema 和新代码的受控运行边界，不代表真实微信账号、真实患者同步、
> 公网新 release 或真机验收已经完成。敏感连接串、token、openid、unionId 和患者标识不写入本文。

## 1. 本次范围

本次处理的是患者目录同步的 durable operation ledger：

- migration：`0015_patient_directory_sync_operations`；
- owner/provider/key 唯一约束；
- `in_progress` 租约、过期接管和 `attempt_count` 代次；
- 患者快照与 operation 成功标记同一 MySQL 事务；
- 成功 replay、处理中 409 和旧租约请求回滚边界；
- Pino operation 日志和中文业务注释。

预约写入、患者绑定、支付、医保、HIS 和真实微信真机仍保持原 gate，不在本次开放范围。

## 2. 代码证据

| 项目 | 结果 |
| --- | --- |
| 代码提交 | `1447a2e`：实现患者同步持久化幂等 |
| 文档提交 | `69c0f20`：校正患者同步发布文档状态 |
| 本地门禁 | `pnpm check` 通过：架构审计 19/19、类型检查、全量测试、build |
| 患者服务回归 | 成功 replay、租约处理中 409、provider 失败后到期接管、请求发起时间快照 |
| 持久化回归 | owner-scoped lease/replay、同事务完成、旧代次不能提交、schema manifest |

## 3. 生产 schema 证据

生产目标由 `ps@192.168.112.172` 上的新 release 临时目录执行，未修改旧服务 env，也未重启服务。

迁移前只读 probe：

```text
expectedMigrationId=0015_patient_directory_sync_operations
appliedMigrationIds=...0014_user_profiles
missingMigrationIds=[0015_patient_directory_sync_operations]
status=incomplete
```

迁移命令只对本次进程临时设置了两个安全确认变量，未改写共享 env：

```text
PERSISTENCE_MIGRATION_ALLOW_REMOTE=true
PERSISTENCE_MIGRATION_ALLOW_PRODUCTION=true
```

执行日志确认：

```text
persistence.migration.started migrationId=0015_patient_directory_sync_operations
persistence.migration.succeeded migrationId=0015_patient_directory_sync_operations
```

迁移后只读 probe：

```text
status=ready
schemaStatus=verified
expectedMigrationId=0015_patient_directory_sync_operations
missingMigrationIds=[]
missingSchemaObjects=[]
```

该 migration 只新增 `hp_patient_directory_sync_operations`，没有修改或删除旧 Python 服务的业务表。

## 4. 新旧服务共存证据

| 检查 | 结果 |
| --- | --- |
| 旧 Python 端口 | `0.0.0.0:8001` 仍监听，旧进程未停止 |
| 当前新 API systemd | `hospital-platform-api-v2.service=active`，仍运行旧 release `55fce6c` |
| 当前新 API 端口 | `10.0.0.3:18081` 仍监听 |
| 内网 readiness | `http://10.0.0.3:18081/health/ready` 返回 database/redis/schema 全部 `ok` |
| 公网 readiness | `https://test-hp.meiyi.pro/api/v2/health/ready` 返回 database/redis/schema 全部 `ok` |
| 新代码临时 smoke | release `69c0f20` 在 `18082` production mode 启动，MySQL/Redis/schema/auth/patient-directory 均 ready |
| 临时 smoke 清理 | `18082` 进程收到 `SIGTERM` 并停止，端口已关闭 |

## 5. 当前未完成和下一步

当前公网 `18081` 仍未切换到 `69c0f20`，所以公网患者同步仍不应宣称已经使用新 operation ledger。
切换新 release 还需要具备 systemd 管理权限，然后按以下顺序执行：

1. 只切换 `hospital-platform-api-v2.service` 的 `current` release，不修改旧 Python service；
2. `systemd-analyze verify`、重启新 API，确认 production mode、`persistenceSchemaProbe=ok`；
3. 复测内网和公网 `/health/ready`，确认 `8001` 仍监听；
4. 用受控平台 access token 做一次患者同步和同 key replay，保存 trace、operationId、provider request 次数和安全响应摘要；
5. 再进行微信开发者工具/真机的患者选择、刷新和预约只读回归。

目前 SSH 用户可以运行 Bun 和读取受控 env，但没有可用的 systemd `sudo` 密码；因此本次没有擅自重启线上服务。
