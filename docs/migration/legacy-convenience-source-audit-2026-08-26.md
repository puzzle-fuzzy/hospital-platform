# 旧便民库存到新 owner/patient 的只读审计

本文新增的是迁移准备工具，不是便民业务 API，也不代表旧数据已经迁移。
工具只读取旧便民表、新身份表和患者 Provider 映射表，输出聚合数量与缺口分类；
不会执行 migration、INSERT、UPDATE、DELETE、DDL、旧服务重启、Redis 操作或 Provider 请求。

## 运行方式

在具备只读数据库访问权限的环境执行：

```powershell
pnpm --filter @hospital/persistence legacy:convenience:audit
```

命令需要 `DATABASE_URL`，但不会把连接串写入输出。输出只包含：

- 旧表是否存在；
- 总行数；
- 旧 `system_users.openid` 是否能桥接到新 `hp_identity_users.provider_subject`；
- 问卷 `pat_id` 是否能桥接到当前 owner 的 `his-patient` 引用；
- 固定的迁移缺口原因。

输出中禁止出现旧 `user_id`、原始 `pat_id`、患者姓名、问卷正文、医护信息、完整卡号和数据库连接串。

## 业务判定边界

即使某张表全部 owner 映射成功，也不能直接把页面从关闭态改为真实业务：

| 旧表类型 | 当前工具能证明 | 当前工具不能证明 |
| --- | --- | --- |
| 入院预问诊、出院随访、风险评估 | owner 与部分患者引用的数量关系 | 问卷版本、任务/就诊引用、临床审核、结果权限和撤回 |
| 表扬信、电子锦旗 | owner 桥接数量 | 旧 `patient_id` 对应的新 encounter、医护关系、内容审核、公开脱敏和撤回 |
| 我的医生 | owner 桥接数量 | 医生目录当前有效性、关系失效、头像 allowlist 和展示字段白名单 |

因此 `readyForReadOnlyMigration` 固定为 `false` 是设计要求，不是脚本遗漏。映射审计只是
下一步 contract 材料的事实输入；真正开放仍要经过：

```text
owner/patient 映射
  -> 独立 contract 与字段白名单
  -> domain 不变量与历史数据隔离
  -> 只读 API 与低敏日志
  -> staging / 空 / 拒绝 / 暂时故障验收
  -> 小程序页面与真机证据
```

## 代码边界

实现位于 `packages/persistence/scripts/legacy-convenience-source-audit.ts`，表名采用固定白名单，
连接池固定为单连接。该工具与旧 Python 项目完全分离，不修改旧模型、旧路由和旧表；运行失败时
也不能被页面降级成“暂无记录”。便民领域的最终 contract 仍以
[`convenience-service-boundaries.md`](convenience-service-boundaries.md) 和
[`contract-intake-catalog-2026-08-25.md`](contract-intake-catalog-2026-08-25.md) 为准。
