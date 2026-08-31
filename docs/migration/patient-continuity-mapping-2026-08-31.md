# 旧患者关系到新患者读模型的连续性映射设计（2026-08-31）

> 本文完成的是患者关系映射设计，不是生产回填或患者数据导入。当前仍按新库冷启动；本文不读取线上患者原文、不修改旧库或新库，也不授权把旧 `pat_id`、卡号或身份证直接写入新端。

## 1. 已核实的边界

旧端的患者来源同时包含微信账号关联、众阳患者目录和档案查询结果，不能把这些不同层级的值当成同一个 ID。当前仓库已经核实：

- 新 `hp_patients` 的 `patient_id` 是平台内部 opaque ID，另有 `owner_user_id`、展示名、关系、脱敏卡号和来源。
- `hp_patient_provider_references` 按 owner、平台患者、Provider 和用途保存外部引用，并限制同一 owner/provider/用途下外部患者号唯一。
- 众阳目录 `thirdPatientId` 只能作为 `directory` 引用；`patInfosFind.data.patId` 才能在正式校验后作为预约、报告和门诊费用使用的 `his-patient` 引用。
- 旧便民数据的只读盘点曾得到 42 行，但没有一行完成旧 `system_users.openid` 到新微信 owner 的桥接，患者引用也没有可直接进入新域的证据。因此旧记录不能直接显示成新用户的患者关系。

上述事实意味着：账户映射必须先完成且唯一，患者映射还必须通过当前 Provider 重新确认；仅凭旧表中的展示字段无法证明患者关系连续。

## 2. 源与目标字段

| 来源 | 可能包含的事实 | 新目标 | 处理规则 |
| --- | --- | --- | --- |
| 旧用户关联 | 旧整数用户 ID、`openid`/`unionid` | 新 `owner_user_id` | 只能引用已批准的账户连续性映射；没有 owner 就不能建患者关系 |
| 旧目录快照 | 旧 `pat_id`、姓名、关系、卡号、身份证等 | `hp_patients` 展示读模型 | 不能直接导入；展示字段须经脱敏、白名单和当前 Provider 复核 |
| 众阳目录 | `thirdPatientId` | `reference_kind=directory` | 只有同 owner、同 Provider、精确唯一且当前目录复核通过才可作为候选 |
| 众阳档案 | `patInfosFind.data.patId` | `reference_kind=his-patient` | 必须由服务端用当前目录卡号/姓名发起档案查询，并通过身份关联校验后写入 |
| 旧卡号、身份证、姓名、手机号 | 仅能作为受限人工复核线索 | 不进入公共 contract | 禁止作为自动匹配键、日志字段或小程序参数 |

`directory` 和 `his-patient` 必须分别存储。不能因为两个值来自同一个旧页面，就把目录 `thirdPatientId` 填入临床引用，也不能把历史页面显示的 `pat_id` 直接当作当前有效档案。

## 3. 映射前置条件

患者映射必须满足以下顺序，任一条件不满足就停在隔离区：

1. 先取得同一微信 AppID/环境下唯一的账户 owner 映射；账户冲突、未匹配或已撤回时，该 owner 下所有患者关系都不得自动迁移。
2. 从旧数据导出最小必要字段到受限、加密的 staging；原始姓名、卡号、身份证和旧 Provider ID 不进入普通日志或提交到 Git。
3. 对每个候选 owner 重新调用当前众阳目录接口，验证目录对象的 Provider 身份、数量和完整性；不能以旧快照证明当前关系仍存在。
4. 对需要预约、报告或门诊费用的患者，再由服务端按当前已确认的卡号/姓名查询 `patInfosFind`，校验返回 `patId`、姓名/卡片关联和 Provider 机构边界；没有当前 `his-patient` 就不能开放临床查询。
5. 只有所有候选都通过唯一性、owner 隔离、用途区分和字段白名单，才能生成待批准映射报告。

## 4. 精确匹配与冲突规则

自动候选只允许使用以下精确关系：

1. `approved owner mapping + provider=zhongyang + reference_kind=directory + exact thirdPatientId` 唯一命中时，保留或建立同一平台 `patientId` 候选。
2. 在同一 owner 和 Provider 下，当前档案查询返回唯一 `patId`，并且与对应目录患者完成一对一关联时，补充 `his-patient` 引用。
3. 目录引用或临床引用缺失时标记为 `unmatched` 或 `clinical-reference-pending`，不使用姓名、卡号末位、身份证脱敏值、手机号、关系或生日补匹配。
4. 同一 owner 下两个旧患者竞争同一个平台患者或同一个用途引用、一个旧关系出现多个 Provider 候选、Provider 机构不一致、档案卡片关联不一致，统一标记 `quarantined`，不自动合并。
5. Provider 返回重复 `thirdPatientId`、重复/共享 `his-patient`、空目录但旧 owner 已有患者，按现有 adapter/service 的 fail-closed 规则处理；不把“暂时查不到”解释为解绑。

映射报告只输出规则版本、快照指纹、计数、冲突类型和内部审计引用。原始患者号、姓名、卡号、身份证和 Provider 响应只能留在受限 staging，并且必须有保留期限。

## 5. 目标写入顺序

受控迁移如果最终获批，应按以下顺序执行：

1. 生成并冻结旧/新脱敏快照、账户映射版本和 Provider 复核时间点。
2. 在 staging 完成数量、重复、owner 隔离、孤儿关系和 `directory`/`his-patient` 用途校验。
3. 先以幂等键写入或复用 `hp_patients` 平台患者读模型，再写入对应的 Provider 引用；两个写入必须处于同一目标事务或可审计的受控步骤中。
4. 重新读取新 owner 的患者列表，确认公共响应只包含平台 `patientId`、展示名、关系、脱敏卡号和 `clinicalAccess`，不包含 Provider ID 或旧原始字段。
5. 对预约、报告、门诊费用逐域执行只读 smoke；缺少 `his-patient` 的患者继续保持不可用于临床查询。
6. 发布期间旧 Python 服务和旧数据库保持原状；不做旧表双写、不删除旧关系、不把新平台 ID 回写旧系统。

## 6. 回滚与重复执行

- 映射执行前后都保留版本和摘要；重复运行同一版本必须得到同一结果，新增快照只能通过新的迁移批次进入。
- 候选冲突、Provider 复核失败或目标事务失败时，整批停止并保留 staging，不提交半套患者关系。
- 回滚通过停用本次映射批次、恢复新平台的上一版快照并重新执行 owner-scoped 读取完成；不删除新用户、不覆盖其他批次、不反向修改旧库。
- 已产生预约、报告或费用引用时，不能因为患者映射回滚就自动改绑；这些领域必须依据各自最终事实和对账规则人工处置。
- 任何清理都必须遵守患者数据生命周期策略，不能用“删行”掩盖无法解释的孤儿或冲突记录。

## 7. 当前状态与准入条件

当前只完成了映射设计。要从冷启动改为受控存量迁移，还需要：

- 业务/数据负责人批准账户和患者匹配规则；
- 脱敏 staging 快照与真实数量/冲突/孤儿报告；
- Provider 当前目录与档案复核证据；
- 目标 schema、唯一索引、幂等重跑和审计验证；
- 公网/真机只读验收，以及明确的旧端只读窗口和回滚演练。

在这些材料完成前，发布单继续使用：

```text
dataCutoverMode = cold-start
legacyPatientImport = disabled
patientMappingExecution = pending-approval
rollback = keep-legacy-service-and-database-unchanged
```
