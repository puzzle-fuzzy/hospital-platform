# 患者空快照的当前读模型校验边界（2026-08-19）

## 背景

患者同步收到 `complete=true` 且 `patients=[]` 时，平台不能直接把当前目录批量标记为失效。Provider 的空数组可能代表真实无绑定患者，也可能来自权限过滤、临时异常或不完整响应；当前策略是先检查 owner-scoped 当前目录，已有医院目录患者时拒绝破坏性替换，首次且确实为空时才允许空快照提交。

## 本次修正

空快照保护现在复用 `normalizePatientReadModel` 校验仓储返回值后再判断 `source`：

- 必须是数组，且每条记录满足当前 owner、唯一平台 ID、脱敏卡号、来源和临床可用性 contract；
- 畸形仓储结果不会被解释成“当前没有就诊人”；
- 校验失败发生在快照事务调用前，不会继续批量停用或提交空目录；
- 失败日志只记录固定 `readModelViolation`，不记录患者正文、owner 或 provider 引用；
- 公共错误继续使用 `500 persistence-invalid`，不伪装成 Provider 空结果 `502`。

## 为什么不能直接调用 `.some()`

TypeScript 的数组类型不能约束 MySQL 映射、缓存、回放任务或测试替身的运行时返回值。直接读取 `currentPatients.some((patient) => patient.source)` 会让 `null`、数组元素或错 owner 数据在业务决策点产生未映射的 `TypeError`，或者更危险地被当作合法空目录。先做完整读模型投影，才能保证“是否允许破坏性替换”建立在可信的 owner-scoped 事实之上。

## 证据与边界

- API 回归验证非数组仓储结果在快照写入前返回 `PatientReadModelValidationError`，并记录 `patients-not-array`。
- 本次没有扩展 Provider contract、患者新增/绑定、预约写入、报告详情、门诊费用详情、支付、医保或 HIS 能力。
- 本次没有修改旧 Python 服务、线上服务、数据库、Redis 或生产 release；真实微信设备和 Provider/HIS 业务验收仍需单独完成。
