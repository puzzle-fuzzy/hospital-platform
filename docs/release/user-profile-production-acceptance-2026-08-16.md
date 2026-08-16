# 普通个人资料生产发布验收（2026-08-16）

本文记录 `55fce6c` 普通个人资料切片的生产数据层、服务进程和公网路由证据。
它不等同于真实微信用户的资料读写和真机验收；后者仍需受控登录后单独完成。

## 1. 发布范围

| 项目 | 结果 |
| --- | --- |
| 代码提交 | `55fce6c`，父版本为生产当前 `3fd069d` |
| 新增 migration | `0014_user_profiles` |
| 新表 | `hp_user_profiles`，只保存昵称、性别、年龄、邮箱和版本 |
| 新 API | `/api/v2/me/profile`，内部路径 `/api/v1/me/profile` |
| 旧服务 | Python `8001` 保持运行，本次未切换、未修改、未重启 |
| 支付/医保/HIS | 继续关闭，本次没有打开任何费用写入或支付 gate |

## 2. 代码证据

发布前本地已执行 `pnpm check`：架构审计 19/19、Biome、9 个 workspace 类型检查、全仓测试和
构建均通过；API 个人资料服务测试覆盖默认值无副作用、字段归一化、低敏日志、空更新、邮箱/版本
校验和冲突；MySQL 测试覆盖首次插入及 `WHERE user_id + version` 条件更新；小程序验收覆盖资料卡和
家庭成员卡分流、加载失败禁止使用默认值保存，以及不携带 openid/unionid/身份证/头像字段。

服务器没有 `pnpm` 可执行文件，因此候选 release 使用本地已验证 commit 的 Git archive 传输，复用
已安装依赖目录后直接执行 API bundle：

```text
Bundled 584 modules in 173ms
index.js 3.1 MB
API_BUNDLE_OK
```

这只证明生产 API bundle 构建成功；不能替代本地完整 `pnpm check`，本次完整门禁已在发布前完成。

## 3. 数据库证据

迁移前只读 schema probe：

```text
status=incomplete
expectedMigrationId=0014_user_profiles
missingMigrationIds=[0014_user_profiles]
missingSchemaObjects=[]
appliedMigrationIds 最后为 0013_patient_directory_snapshot
```

随后仅在受控生产 migration 开关下执行 `0014_user_profiles`，日志出现：

```text
2026-08-16T05:11:23.520Z persistence.migration.started migrationId=0014_user_profiles
2026-08-16T05:11:23.829Z persistence.migration.succeeded migrationId=0014_user_profiles
```

迁移后只读 schema probe：

```text
status=ready
schemaStatus=verified
expectedMigrationId=0014_user_profiles
missingMigrationIds=[]
missingSchemaObjects=[]
```

没有执行旧表迁移、患者新增、患者绑定、支付订单、医保请求或业务数据写入。

## 4. 运行和公网证据

- `current` 已原子切换到 `/home/ps/code/hospital-platform/releases/55fce6c`。
- `hospital-platform-api-v2.service` 重启后为 `active`；旧 Python 仍监听 `0.0.0.0:8001`。
- 新 API 仍监听 `10.0.0.3:18081`。
- 启动日志包含 `environment=production`、`runtimeMode=production`、
  `persistenceDatabaseProbe=ok`、`persistenceRedisProbe=ok`、`persistenceSchemaProbe=ok`、
  `persistenceRepositories=enabled`、`authRuntimeStatus=ready`、`authIdentityGateway=injected`、
  `authSessionStore=injected`。
- 内网 `GET http://10.0.0.3:18081/health/ready` 返回 database/redis/schema 全部 `ok`。
- 公网 `GET https://test-hp.meiyi.pro/api/v2/health/ready` 返回 database/redis/schema 全部 `ok`。
- 内网和公网 `GET /me/profile` 在没有 Bearer 会话时均返回 HTTP 401、错误码 `unauthorized`；
  journald 记录了对应低敏 `http.request.failed` 事件。

## 5. 尚未完成的证据

本次没有在日志、命令行或文档中保存 access token、openid、邮箱或用户资料内容。以下验收仍未完成：

1. 使用真实微信登录后的 `GET /api/v2/me/profile` 默认值读取；
2. 使用真实会话执行 `PUT version=0` 首次保存，再读取 `version=1`；
3. 两个设备/两个请求使用旧版本时确认 HTTP 409 `user-profile-conflict`；
4. 微信开发者工具/真机打开“我的 → 个人资料”并确认加载失败时不能提交默认值；
5. 确认 journald 不出现昵称、邮箱或完整请求体。

因此当前状态应写成“生产 schema 和 API 运行就绪，真实资料业务/真机验收待完成”，不能写成“个人资料
全部迁移完成”。

## 6. 回滚边界

若新 API 启动或 ready 异常，只回滚新服务指针到上一 release `3fd069d` 并重启新 API；不得停止
旧 Python、不得执行 `FLUSHDB`、不得删除 `hp_user_profiles`。0014 是向后兼容的新表，正常回滚代码不需要
回滚数据库 DDL；是否删除表必须另行 DBA 审批。

后续真实资料验收通过后，继续按 [`remaining-migration-inventory.md`](../migration/remaining-migration-inventory.md)
推进病历、医院动态目录、二维码、便民服务和 provider 文档冻结项；支付、医保和 HIS 仍保持最后处理。
