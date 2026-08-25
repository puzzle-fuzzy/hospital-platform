# 临床只读四线共用结果契约基础（2026-08-26）

> 本文记录 C 批次的横向基础，不代表门诊病历、住院信息、我的医生或电子导诊单已经开放。
> 旧 Python 服务、旧数据库、旧 Redis、线上进程和另一会话维护的预约适配器均未修改。

## 1. 本轮解决的问题

旧端的四个入口虽然都在“就诊/健康”范围内，但事实来源不同。迁移时最容易出现三类错误：

1. 把 Provider 超时或拒绝包装成空列表，页面因此误显示“暂无记录”；
2. 没有明确选择的患者时，服务端自动取当前用户或上一次患者，造成跨患者读取；
3. 为了让四个页面快速接通，直接共享一个病历/预约/报告兼容模型，导致字段和权限边界漂移。

本轮只共享安全的结果摘要，不共享临床条目字段：

- `medical-record`：门诊病历目录；
- `inpatient-center`：住院 episode 摘要；
- `doctor`：医生目录或患者关系目录；
- `electronic-consultation`：电子导诊单目录。

实现位置：[`packages/domain/src/clinical-read-contract.ts`](../../packages/domain/src/clinical-read-contract.ts)。

## 2. 固定不变量

| 状态 | 条目数量 | 错误码 | 页面含义 |
| --- | ---: | --- | --- |
| `ready` | 大于 0 | 无 | 已取得并完成域内脱敏的结果 |
| `empty` | 0 | 无 | Provider 明确确认合法无记录 |
| `rejected` | 0 | 必须有 | 权限或业务拒绝，不能渲染为空 |
| `unavailable` | 0 | 必须有 | 超时/不可用，允许重试但不能覆盖已确认快照 |

所有结果都必须绑定内部 `ownerUserId + patientId`，并带 `sourceVersion` 与显式时区的
`observedAt`。这两个 ID 只允许是平台内部 opaque 标识；Provider 患者号、住院号、医生号、
原始响应和临床正文不进入这个共用结果。

`ready` 只能表示数量大于 0，`empty` 只能表示数量为 0；`rejected` 和 `unavailable`
必须带固定错误码，且数量必须为 0。任何一条线不能把“尚未查询”“请求超时”或“权限拒绝”
包装成合法空列表，否则页面会覆盖之前已经确认的临床结果。

## 3. 为什么暂不注册 API

这个领域基础不能替代四条线各自的正式材料。每条线仍必须单独完成：

```text
Provider contract
  -> 脱敏成功/空/拒绝/超时样例
  -> owner/患者映射
  -> 条目字段白名单
  -> adapter
  -> 本域 domain 条目模型
  -> API 与页面
  -> Pino 低敏日志
  -> 内网、公网、真机证据
```

在材料到达前不注册临床 API，不创建兼容转发，不把报告、预约历史或门诊费用结果复制成临床
数据。四个 FeatureKey 的业务准入仍保持 `blocked-provider`，对应页面现在进入
`surface-only` 外壳阶段；这次提交只把它们的共同边界提前固定，
方便后续按材料先到的域分别接入。

## 4. 自动化验证

```powershell
pnpm --filter @hospital/domain test
pnpm --filter @hospital/domain typecheck
pnpm migration:contract:audit
pnpm clinical:contract:audit
pnpm docs:audit
```

测试覆盖四条线的成功/合法空结果、拒绝/不可用、状态与条目数量不一致、错误码缺失、未知
字段、无时区时间和缺少患者范围等边界。
