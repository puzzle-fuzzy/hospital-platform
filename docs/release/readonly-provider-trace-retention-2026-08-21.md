# 预约与门诊费用多请求 trace 日志保留（2026-08-21）

## 结论

本轮修正了预约目录、预约历史和门诊费用只读 service 的日志关联边界。
领域层的 `ExternalTrace` 已允许一个业务读取关联多个有界 Provider 请求号，但此前
预约和门诊费用 service 只写入兼容主字段 `providerRequestId`，导致多请求链在业务日志
中被压缩。现在这些模块在成功事件、后续读模型校验失败事件和排班快照事件中，都会在
保留主字段的同时写入已经通过 domain 校验的 `providerRequestIds`。

这只增强日志关联，不改变 Provider 请求参数、患者归属、状态、金额、日期窗口、API
响应或任何预约/支付业务语义；预约写入、微信支付、医保、退费和 HIS 回写仍然关闭。

## 修改边界

- `apps/api/src/modules/appointments/service.ts`
  - 目录科室、排班和预约历史成功日志保留主请求号及可选完整请求号列表；
  - trace 已验证但后续公共读模型校验失败时，失败日志仍保留这组请求号；
  - 排班短期快照持久化成功/失败日志沿用同一投影；
  - 只有通过 `normalizeExternalTrace` 的请求号才能进入日志，失败 trace 不会原样写入。
- `apps/api/src/modules/outpatient-payments/index.ts`
  - 门诊费用 `loaded/failed` 日志保留主请求号及可选完整请求号列表；
  - 费用状态、金额、账单日期或资源上限校验失败时，不会把费用明细写入日志。
- `docs/logging.md`
  - 明确预约、排班快照和门诊费用事件的多请求字段及脱敏边界。

## 安全和业务边界

`providerRequestIds` 只能作为内部低敏关联字段，不能进入小程序响应、患者读模型、
数据库患者字段、Provider URL 或原始报文。列表必须满足 domain 的数量、字符和主 ID
包含关系门禁；否则整个 gateway trace 读模型 fail-closed。

日志中的 `providerRequestIdCount` 表示去重后的关联请求号数量，不表示业务请求次数，
也不表示 Provider 字段、预约状态、费用金额或真机页面已经验收。真实业务仍须同时具备
页面结果、客户端 HTTP 和服务端同链日志三层证据。

## 本地验证

```text
API typecheck：通过
预约 service + 门诊费用 service：37/37 tests，142 个断言
Biome format：251 个文件通过
git diff --check（排除并行会话 project.config.json）：通过
```

本轮没有部署、没有重启新旧服务、没有修改旧 Python、线上 MySQL/Redis 或并行维护的
众阳患者自动化代码。
