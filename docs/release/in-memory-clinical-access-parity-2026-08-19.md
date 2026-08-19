# 内存患者临床可用性与 MySQL 读模型对齐（2026-08-19）

## 修正原因

患者公共读模型中的 `clinicalAccess` 必须由当前 owner-scoped `his-patient` 映射决定：

- 映射存在时才是 `ready`；
- 映射不存在时必须是 `unavailable`；
- 不能因为患者行、seed 或旧内存对象上残留 `clinicalAccess=ready` 就继续放行预约、报告或门诊费用上下文。

MySQL repository 原本通过 `EXISTS` 查询实时计算这个字段，生产读模型已经遵守上述规则。内存 repository 此前在缺少映射时会沿用 `PatientRecord.clinicalAccess`，导致测试组合根可能掩盖生产环境应当触发的 fail-closed 行为。

## 本次变更

- `packages/persistence/src/repositories.ts`：内存读模型在 `his-patient` 映射不存在时固定返回 `unavailable`。
- `packages/persistence/src/index.test.ts`：新增历史 `ready` 枚举但没有独立临床映射的回归测试，并确认临床引用解析同样返回空。
- 核心代码增加中文注释，说明为什么不能信任旧枚举以及它与 MySQL `EXISTS` 读模型的关系。

## 验证与发布边界

- 持久化测试：`77 pass / 0 fail`。
- 持久化 TypeScript 类型检查：通过。
- 本次只修改新项目本地代码和测试，没有修改旧 Python 项目、数据库、Redis、线上配置或线上服务。
- 该修正尚未随线上 `968af78` 部署；完成全仓门禁和中文提交后，仍需按发布流程单独决定是否部署。
