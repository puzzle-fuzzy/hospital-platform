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

旧库和新库的字符串列可能使用不同的 MySQL collation（当前线上旧 `openid/pat_id` 与新映射列
就存在差异）。审计 SQL 对 owner/provider 标识和患者引用统一使用 `utf8mb4` + `utf8mb4_bin` 的
显式比较规则：只解决字符集比较错误，不做大小写折叠或模糊匹配；因此“无法桥接”不会被错误地
当成成功映射。该处理只作用于只读审计查询，不修改任何表的字符集、排序规则或数据。

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

## 2026-08-26 07:51 CST 服务器只读结果

通过 `ps@192.168.112.172` 的 inspection key，读取新服务使用的 `shared/api.env` 中的数据库连接配置，
仅执行固定白名单 `SELECT`；没有读取或输出连接串，没有写入数据库，没有重启服务，也没有调用旧 API 或 Provider。

首次直接 join 时发现旧表与新映射表的 collation 不一致，查询被 MySQL 拒绝为 `collation-mismatch`；
修正为显式 `CONVERT(... USING utf8mb4) COLLATE utf8mb4_bin` 后，六张表均可完成聚合。该事实已同步到审计 SQL 和单元测试。

| 旧表 | 总行数 | owner 桥接成功 | 患者引用成功 | 患者引用是否适用 |
| --- | ---: | ---: | ---: | --- |
| `admission_preconsultation` | 2 | 0 | 0 | 是 |
| `commendatory_letter` | 4 | 0 | 0 | 否 |
| `discharge_follow_up` | 4 | 0 | 0 | 是 |
| `my_doctor` | 21 | 0 | 0 | 否 |
| `risk_assessment` | 7 | 0 | 0 | 是 |
| `silk_banner` | 4 | 0 | 0 | 否 |

结论：当前旧便民库存共 42 行，但没有一行能通过旧 `system_users.openid` 到新微信 owner 的桥接，
也没有患者引用可以进入新域。因此不能把这些记录导入、展示为新用户记录或降级成成功空列表；当前仍保持
`owner-mapped-patient-contract-pending`。下一步需要先完成身份桥接规则和各业务 contract，再做隔离区抽样，
而不是直接向新 API 增加兼容读取。
