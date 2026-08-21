# 患者目录 service 直接调用输入边界审计（2026-08-21）

## 结论

本轮只修正患者目录 service 的运行时输入边界，没有修改众阳 adapter、旧 Python 服务、线上配置、数据库或 Redis。
HTTP 路由已有请求 schema，但组合根、回放任务和测试也可以直接调用 `PatientService.list/sync`，因此 HTTP 校验不能作为
service 的唯一安全边界。

## 发现的问题

此前 `PatientService.list` 和 `PatientService.sync` 依赖 TypeScript 类型声明来保证 `ownerUserId` 与 `AdapterCallContext` 正确。
绕过 HTTP 直接传入 `null`、控制字符、未知上下文字段、无效 `timeoutMs` 或不完整 `AbortSignal` 时，可能在仓储/Provider
边界前才失败，也可能让失败日志再次读取损坏的 `traceId`。

这类问题不能通过静默修正输入解决：患者 owner 由服务端会话决定，幂等键会进入 durable operation ledger，trace 会用于
Provider 请求关联，任意丢字段或替换字段都会增加跨请求误关联和错误重放风险。

## 修正内容

- 新增 `PatientServiceInputError`，对 owner 和调用上下文使用固定的运行时错误分类。
- `ownerUserId`、`traceId`、`idempotencyKey` 必须通过有界 opaque identifier 校验。
- 调用上下文只允许 `traceId`、`idempotencyKey`、`signal`、`timeoutMs` 四个字段；未知字段 fail-closed。
- `timeoutMs` 只能是大于 0 的安全整数；`signal` 必须具备布尔 `aborted` 与标准事件监听方法。
- 进入仓储、租约、幂等账本或 Provider 之前完成归一化；非法输入不会触发仓储调用。
- 失败日志使用安全 trace 投影，输入错误只记录固定 `inputViolation`，不记录原始 owner、幂等键或患者正文。
- 公共错误契约增加 `400 patient-query-invalid`，小程序客户端统一显示“就诊人查询条件不合法”。

## 不变的业务边界

患者 service 仍只接受服务端解析的会话 owner，不接受小程序提交的 openid、unionid、患者姓名、卡号或身份证号作为归属证明。
本轮没有扩大患者绑定、二维码、医保、支付、预约写入或 HIS 回写能力，也没有改变 `patInfosFind` 的 Provider 访问方式。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 患者 service 与错误处理测试 | 39 pass / 159 expects |
| API 应用契约测试 | 40 pass / 241 expects |
| 小程序全量测试 | 174 pass / 0 fail / 1377 expects |
| API typecheck | 通过 |
| 小程序 typecheck | 通过 |
| Biome 与 `git diff --check` | 通过 |

真实微信扫码、患者同步、众阳真实响应和公网日志三层证据仍未由本轮产生；发布前仍须按当前运行包来源指纹重新构建并执行
`runtime:verify`，不能把本地测试结果当作真机验收。
