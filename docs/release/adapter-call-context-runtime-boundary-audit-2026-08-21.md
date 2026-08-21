# AdapterCallContext 运行时边界审计（2026-08-21）

## 结论

本轮统一了非支付业务 service 的 Provider 调用上下文运行时校验。HTTP 请求会由服务端生成合法的
`traceId/idempotencyKey`，但组合根、回放任务和未来 Worker 仍可以直接调用 service；因此不能把 TypeScript 类型或 HTTP
schema 当作唯一边界。

本轮没有修改旧 Python 服务、线上配置、数据库、Redis、众阳自动化 adapter，也没有打开支付/医保/HIS 或任何写入 gate。

## 共享 contract

`packages/domain/src/ports.ts` 现在提供 `normalizeAdapterCallContext` 和 `adapterContextTraceId`：

- 只允许 `traceId`、`idempotencyKey`、`signal`、`timeoutMs` 四个字段，未知字段 fail-closed；
- 两个标识必须通过有界 opaque identifier 校验；
- `timeoutMs` 必须是大于 0 的安全整数；
- `signal` 必须具备布尔 `aborted` 以及标准事件监听方法；
- 返回新对象，不把 direct-call 的未知属性透传给 Provider；
- 失败日志使用安全 trace 投影，坏上下文不能让错误日志再次抛出 TypeError。

## 已接入 service

| service | 非法上下文停止位置 | 复用的稳定错误契约 |
| --- | --- | --- |
| 微信登录 | 身份 Provider、身份仓储和会话签发前 | `validation` |
| 患者目录 | owner、租约、幂等账本和 Provider 前 | `patient-query-invalid` |
| 预约目录/排班/预约历史 | Provider、排班快照和 owner 映射前 | `appointment-query-invalid` / `appointment-record-query-invalid` |
| 门诊费用只读 | owner 映射和 Provider 前 | `outpatient-payment-query-invalid` |
| 报告目录/详情 | owner 映射、引用仓储和 Provider 前 | `report-query-invalid` |
| 普通资料 | 资料仓储读写前 | `user-profile-invalid` |

这些错误契约没有把内部上下文字段暴露给小程序；HTTP 真实请求仍由 request-context 生成合法上下文，正常业务语义不变。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| domain 全量测试 | 61 pass / 127 expects |
| API 全量测试 | 199 pass / 829 expects |
| API/domain typecheck | 通过 |
| Biome 定向检查 | 通过 |
| `git diff --check`（排除并行 `project.config.json`） | 通过 |

每个接入 service 都有回归测试证明非法上下文不会触达 Provider、仓储或会话下游；domain 测试还覆盖未知字段、缺失标识、
控制字符、非法 timeout 和不完整 signal。

## 保留边界

支付预支付、支付通知、医保授权、6201/6202/6301、结算、退款和 HIS 回写仍未纳入本轮共享 service 改造，继续按最后专项
处理。真实微信、Provider、公网日志和真机页面三层证据仍需用当前候选单独采集，不能由本地测试替代。
