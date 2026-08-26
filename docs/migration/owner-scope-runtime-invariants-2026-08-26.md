# Owner 作用域运行时不变量审计（2026-08-26）

## 本轮结论

普通资料、患者目录读模型和报告短期引用都属于 owner 作用域，但它们可能被 API、
回放任务、Worker 或替换仓储直接调用，不能只依赖 Elysia route 或 TypeScript 类型。
本轮补齐了三个 domain 边界：

- 普通资料 `normalizeUserProfileReadModel` 先校验 `expectedUserId` 是合法 opaque 标识，
  再比较仓储返回的资料归属；
- 报告 `ReportReference.ownerUserId` 复用 opaque 标识校验，拒绝控制字符和首尾空白；
- 患者 `normalizePatientReadModel` 先校验 `expectedOwnerUserId`，再比较仓储返回的患者归属。

非法 owner 现在会在进入持久化查询、页面读模型和后续 Provider 链路前停止。合法
业务行为不变，也没有把客户端提交的 owner 变成授权条件。

## 固定边界

| 业务对象 | 授权根 | domain 必须证明 | 仍需下一层证明 |
| --- | --- | --- | --- |
| 普通资料 | 当前会话 userId | expected userId 是合法 opaque ID；资料归属与它相等 | repository 必须按当前 userId 读取/条件更新；版本冲突不能覆盖新值 |
| 患者目录 | 当前会话 userId | expected owner 是合法 opaque ID；每条患者归属与它相等 | repository 查询必须按 owner 过滤；同步必须使用服务端身份和租约 |
| 报告引用 | 当前会话 userId + patientId | 引用 owner、患者、报告 ID、Provider、类型和 TTL 均合法 | MySQL 查询必须同时绑定 owner/patient/report；详情 Provider 只能收到服务端引用 |
| 预约/门诊费用 | 当前会话 userId + patientId | service 校验 owner、患者和临床映射 | Provider 合同、真实公网/真机证据仍未完成 |

这里的“domain 已证明”不等于业务已经上线：它只说明运行时对象没有越过当前
公共模型边界。任何业务 service 仍必须继续执行 owner、患者、Provider 和会话代际
校验，不能因为 domain 做过一次验证就省略后续授权条件。

## 回归证据

- `packages/domain/src/patients-read-model.test.ts` 覆盖控制字符、首尾空白 owner；
- `packages/domain/src/reports.test.ts` 覆盖报告引用 owner 的相同边界；
- `packages/domain/src/user-profile-read-model.test.ts` 覆盖普通资料 expected userId 的
  控制字符、首尾空白和错 owner；
- 患者 service、报告 service、Persistence 和 API 测试继续验证 owner 隔离、跨患者
  拒绝、过期引用和不调用 Provider 的行为；
- 运行时测试、类型检查、Biome 和文档链接审计仍需在提交前重新执行。

## 未完成业务边界

本审计不开放新增临床、外部、患者写入或支付能力。住院、门诊病历、我的医生、
电子导诊、互联网医院、患者绑定、签名、健康内容正式发布、支付和医保仍需各自的
正式 contract、字段白名单、错误样例、日志证据和真机验收；不能把本轮 owner 校验
通过写成这些业务已经完成。
