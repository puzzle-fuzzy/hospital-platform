# 患者平台内部 ID 稳定性契约（2026-08-22）

## 结论

患者目录同步时，服务层每次都会为 Provider 返回的患者生成一个候选平台内部 `patientId`，但这个候选值只允许在首次建立映射时使用。持久化层必须按：

```text
ownerUserId + provider + providerPatientId
```

找回已有患者并沿用原来的平台内部 `patientId`。否则用户每次刷新或重新同步都会得到第二条患者记录，首页、预约、报告和门诊费用可能分别绑定到不同的内部患者。

## 代码边界

1. `PatientService.sync()` 只负责生成有界、唯一、不可推断的候选 opaque ID，并把 Provider 患者号留在仓储映射边界内。
2. 内存仓储和 MySQL 仓储都按 owner、Provider 和 Provider 目录患者号识别同一患者。
3. 找到旧记录时只刷新患者展示资料、目录最后见到时间和用途映射，不替换 `hp_patients.patient_id`。
4. 患者属于 owner 范围；跨 owner 即使提交相同 Provider 患者号，也不能解析或复用平台内部 ID。
5. 小程序只接收平台内部 ID 和脱敏读模型；Provider 患者号、HIS 临床患者号和完整身份资料不进入 API 响应或业务日志。

## 回归证据

服务层回归测试使用两次不同幂等键触发两次真实同步流程，并让 ID 生成器故意返回两个不同候选值：

- 第一次同步返回 `generated-patient-id-first`；
- 第二次同步候选值变为 `generated-patient-id-second`；
- 两次响应最终都返回第一次建立的内部 ID；
- 仓储中仍只有一条患者记录；
- Provider 被调用两次，证明这不是 durable replay 的假阳性。

对应测试：`apps/api/src/modules/patients/service.test.ts` 的“患者目录不同次同步沿用同一 provider 患者的平台内部 ID”。持久化层另有内存和 MySQL upsert 回归测试，覆盖同患者更新、HIS 引用更新和跨患者映射冲突回滚。

本轮验证命令：

```text
pnpm --filter @hospital/api exec bun test src/modules/patients/service.test.ts
```

结果：23 项通过，0 项失败，85 个断言。

## 验收边界

这项回归证明代码和仓储契约正确，不等同于真实微信、众阳 Provider 或真机验收。线上仍需在同一会话下完成：

1. 首次同步得到患者目录；
2. 页面刷新或重新同步；
3. 确认同一患者的内部 `patientId` 未变化；
4. 再执行显式患者切换，确认预约历史、爽约和门诊费用均使用新选择；
5. 关联客户端 requestId、服务端 traceId 和低敏业务日志。

如果 Provider 的患者号不稳定，不能仅凭姓名、卡号展示值或身份证脱敏值猜测同一患者；必须先暂停该链路并补充正式身份 contract。
