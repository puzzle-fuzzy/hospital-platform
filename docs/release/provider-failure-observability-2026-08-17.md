# Provider 失败可观测性修正（2026-08-17）

## 1. 触发原因

线上历史日志曾出现预约科室、排班和预约历史请求返回 `502`，业务错误表现为
“外部服务拒绝了本次请求”。同一能力在后续请求中又成功返回科室和排班数据，说明
不能把这类错误直接解释成“功能未配置”或“没有预约数据”。旧业务事件只记录了
`ProviderRequestError`，缺少 Provider 操作、请求号、HTTP 状态和是否可重试字段，
排障必须依赖另一条请求日志。

## 2. 本次修正

- 在 `@hospital/observability` 中统一提供 `providerFailureMetadata()`，只提取低敏
  `provider`、`providerOperation`、`providerRequestId`、`providerStatusCode` 和
  `providerRetryable`；外部文本先经过长度和控制字符校验。
- 微信登录、预约目录/历史、门诊费用和报告失败事件统一使用该白名单字段。
- API 通用 `http.request.failed` 复用同一个提取器，避免业务事件和 HTTP 事件的字段
  定义逐渐分叉。
- 保留微信登录日志既有的 `retryable` 别名，兼容已有检索和告警规则；新业务优先
  使用语义更明确的 `providerRetryable`。
- 不记录 Provider 原始响应、请求 URL、请求体、患者号、金额、临时 code、token 或
  任何凭证；不增加重试、不改变错误码、不打开预约写入、支付或医保能力。

## 3. 验证

- observability 测试覆盖字段白名单、状态码边界、控制字符和原始错误消息隔离。
- API 测试覆盖微信登录、预约历史和门诊费用 Provider 失败日志关联字段。
- 既有 API 错误契约仍保持：Provider 可恢复故障返回 503，不可重试拒绝返回 502；
  页面仍按稳定中文文案处理，不能把 502 显示成空列表或预约成功。

## 4. 证据边界

这项修正只提升诊断能力，不证明 Provider 当前已经稳定，也不替代微信会话、患者
映射、公网和真机验收。下一次真实操作应按 `traceId`/`providerRequestId` 对齐：

1. 先确认 `appointment.*.requested` 是否出现；
2. 再查看 `appointment.*.failed` 和 `http.request.failed` 的低敏字段是否一致；
3. 若 `providerRetryable=false` 且没有 `providerStatusCode`，优先检查 Provider
   业务 envelope 是否返回 `success=false` 或响应字段不符合已确认 contract；
4. 若有 HTTP 状态码，再按 Provider 网关日志中的 request id 追查，不把原始报文复制
   到聊天、Git 或小程序响应。
