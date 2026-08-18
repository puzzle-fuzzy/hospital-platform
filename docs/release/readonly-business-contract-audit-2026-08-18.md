# P0 只读业务 contract 审计（2026-08-18）

本文记录当前源码对“预约历史 / 爽约记录 / 门诊缴费只读查询”的逻辑审计结果。
它用于新会话、代码评审和真机验收前的边界复核；“代码和测试通过”不等于
真实微信会话、Provider、公网 HTTPS 或真机业务已经验收。

## 1. 证据范围与当前发布边界

审计对象：

- 原生小程序的患者上下文恢复、显式切换、预约历史、爽约筛选和门诊费用页；
- Bun/Elysia 服务端的 owner-scoped 映射、日期窗口、Provider 结果校验、错误映射和日志事件；
- 众阳预约历史与门诊费用 adapter 的字段白名单、状态映射和空结果语义。

主要源码入口：

- `apps/miniprogram/src/services/dashboard-service.ts`
- `apps/miniprogram/src/services/patient-selection-service.ts`
- `apps/miniprogram/src/services/api-client.ts`
- `apps/miniprogram/src/pages/appointment-records/appointment-records.ts`
- `apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts`
- `apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.ts`
- `apps/api/src/modules/appointments/service.ts`
- `apps/api/src/modules/outpatient-payments/index.ts`
- `apps/api/src/plugins/error-handler.ts`
- `packages/adapters/src/zhongyang-appointments.ts`
- `packages/adapters/src/zhongyang-outpatient-payments.ts`
- `packages/domain/src/appointments.ts`
- `packages/domain/src/outpatient-payments.ts`

当前线上 release 以 [`1b94c46-production-acceptance-2026-08-18.md`](1b94c46-production-acceptance-2026-08-18.md)
为准；配套小程序构建来源为 `e5aef63d086e59bf66d43de4156b875314f39912`：新 Bun/Elysia API 与旧 Python API 共存，旧服务没有被停止。当前 release 的窄观察窗口没有新的
`appointment.*` 或 `outpatient.payment.*` 业务事件，因此本文不把历史日志、readiness 200、页面注册
或“依赖 configured”当作真实业务成功证据。

## 2. 已验证的不变量

### 2.1 患者上下文先于 Provider

1. 页面只提交平台内部、有限长度且无控制字符的 opaque `patientId`。
2. 服务端使用当前登录用户的 owner 条件解析 `referenceKind: "his-patient"`；目录中的
   `thirdPatientId` 不会直接变成预约、报告或费用 Provider 患者号。
3. 映射不存在时在 Provider 调用前失败，页面展示“当前就诊人暂无可查询的预约记录”或
   “当前就诊人暂未建立门诊缴费映射”，不会伪造空列表。
4. 页面请求开始时清除旧患者卡片和列表；Promise 返回前后都检查页面请求代次及当前显式患者，
   因此患者切换后旧响应不能回写新页面。
5. 已保存患者从最新 owner 目录消失时进入 stale 状态，不能静默替换成 `patients[0]`；只有
   从未保存过选择的首次页面才允许默认第一位可查询患者。

这部分规则与 [`../migration/patient-context-read-contract.md`](../migration/patient-context-read-contract.md)
和 [`../business-correctness.md`](../business-correctness.md) 保持一致。

### 2.2 查询窗口和状态语义

| 页面/接口 | 服务端或客户端窗口 | 状态来源 | 空结果语义 |
| --- | --- | --- | --- |
| 我的挂号 | 中国标准时间当前日前后各 90 天 | 服务端预约状态枚举 | Provider 成功且整批校验通过后，`200 + items: []` 才表示暂无记录 |
| 爽约记录 | 中国标准时间过去 90 天 | 只筛选服务端归一化的 `missed` | 只表示该窗口内没有已确认爽约，不表示 Provider 失败或未知状态 |
| 门诊待缴/已缴 | 服务端生成的中国标准时间最近 30 天窗口 | 请求状态白名单 `unpaid` / `paid` | Provider 成功且状态、金额、时间、标识全部通过后，`200 + items: []` 才表示暂无账单 |

预约状态 `scheduled/cancelled/completed/missed/stopped/substituted/registered` 在 adapter 和领域层
归一化；未知状态不会被猜成“已预约”或“爽约”。门诊费用只把 Provider 已确认的 `tradeStatus`
映射为 `unpaid/paid`，未知状态不会被当成已缴费。

### 2.3 错误分流与 fail-closed

| 事实 | 服务端行为 | 小程序行为 |
| --- | --- | --- |
| 会话无效/过期 | `401 unauthorized` | 清理失效 token，重新登录最多重试一次；并发请求复用单飞登录结果，不无限重试 |
| Redis/MySQL/schema 暂时不可用 | `503 persistence-temporarily-unavailable` | 保留错误和重试入口，不展示“暂无记录” |
| 业务依赖未配置 | `503 dependency-not-configured` | 展示服务未配置提示，不调用 Provider |
| Provider 可重试失败 | `503 provider-temporarily-unavailable` | 展示暂时不可用，不清空为成功空态 |
| Provider 明确拒绝 | `502 provider-request-rejected` | 展示外部服务拒绝，不伪造成功 |
| Provider HTTP 200 但 envelope/条目非法 | `502 provider-response-invalid` | 整批失败；不筛掉坏行后继续显示部分成功 |
| owner-scoped HIS 映射缺失 | 对应患者映射 404 | 提示当前患者不可查询，并允许重新选择/刷新 |
| Provider 成功、合法空数组 | `200` 且记录成功事件 | 展示旧端空状态 |

这组分流的关键点是：`empty` 只能来自“成功且已验证的读模型”，不能来自超时、依赖故障、
映射缺失、业务失败或格式不完整。

### 2.4 日志闭环

预约历史和门诊费用都遵循：

```text
requested -> owner mapping / provider call -> synced 或 loaded
                                      \-> failed
```

- `requested` 只在基础输入校验通过、即将进入 owner/Provider 链路时写入；
- `synced/loaded` 只在整批结果完成公共字段、状态、时间窗口、重复标识校验后写入；
- 所有异常出口都写 `failed`，并使用固定 `errorType/resultViolation` 和低敏 Provider 诊断字段；
- 不记录 token、openid、unionid、session_key、Provider 患者号、支付凭证、金额明细或原始报文；
- `http.request.completed` 只能证明 HTTP 生命周期，不能替代上述业务成功事件。

详细字段规则见 [`../logging.md`](../logging.md)。

## 3. 当前工作树测试证据

服务端生产候选固定为 `1b94c46`，小程序当前运行输入来源为 `e5aef63d086e59bf66d43de4156b875314f39912`，包含微信身份边界修正、患者引用 fail-closed 修正、空目录下已有选择的 stale 修正、同步回写不能覆盖 stale/unavailable 的状态门禁、精确运行包来源输入校验、选择页手动刷新事件边界、会话代际隔离修正、预约目录两阶段查询边界、刷新期间科室/日期事件校验、挂号卡片操作事件 key 回查、报告目录详情事件 key 回查、报告详情患者范围复核和失败态临床读模型清理、“我的”页未迁移菜单稳定 key、根入口全局脚本门禁和门诊费用失败态患者上下文清理；小程序修正未改变旧服务。
本节计数于 2026-08-18 当前工作树重新执行取得，不把更早审计窗口的测试数字继续当作当前证据：

- `pnpm --filter @hospital/miniprogram test`：122 项通过，1040 个断言；
- `pnpm --filter @hospital/miniprogram build`：类型检查通过，14 个页面脚本生成；候选 `dist/build-info.json` 来源指纹为
  `e5aef63d086e59bf66d43de4156b875314f39912`；
- `pnpm --filter @hospital/miniprogram runtime:verify`：14 个页面运行包完整；
- `pnpm --filter @hospital/adapters test`：75 项通过，168 个断言；
- `pnpm --filter @hospital/domain test`：23 项通过，51 个断言；
- `pnpm --filter @hospital/api test`：115 项通过，528 个断言；其中包含预约记录、门诊费用、错误处理、
  患者归属和日志脱敏用例。

测试只能证明注入网关和固定 fixture 下的不变量，不能证明当前线上账号能查询到真实预约或费用。

## 4. 尚未完成的证据与停止条件

以下事项仍不能标记完成：

1. 使用与服务端 `1b94c46` 配套、来源指纹为 `e5aef63d086e59bf66d43de4156b875314f39912` 的小程序运行包，在有效微信会话下完成登录、患者刷新/显式切换、我的挂号、
   爽约记录和门诊待缴/已缴页面操作；
2. 每个页面同时保存页面结果、HTTP 状态/trace 和当前 release 的低敏业务事件；
3. 取得真实账号的预约历史状态、未来预约窗口、门诊费用状态和 Provider 字段对照；
4. 确认真实多就诊人切换、映射失效/恢复和持久化短暂故障时页面不会串患者或降级为空；
5. 预约写入、微信支付、医保授权/结算、退款和 HIS 回写仍必须另行冻结 contract、状态机、幂等和补偿，
   不得由本只读审计推导开放。

任一真机步骤出现 `persistence-temporarily-unavailable`、患者上下文错配、Provider 字段非法或
成功事件缺失，应立即停止该业务域验收，保留 gate，先修复证据链。

## 5. 下一步执行顺序

1. 用当前 release 对应的小程序包取得有效会话；
2. 刷新患者目录并显式切换另一位可查询患者，确认页面清空旧数据后再加载；
3. 进入“我的挂号”和“爽约记录”，核对当前日前后/过去 90 天窗口及服务端状态；
4. 分别进入门诊待缴和已缴，核对最近 30 天窗口、状态和金额展示；
5. 只有以上只读证据连续稳定后，再处理预约写入；费用相关的微信支付、医保和 HIS 最后处理。

当前客户端与服务端的固定验收组合、操作顺序、证据字段和停止条件见
[`miniprogram-readonly-acceptance-candidate-2026-08-18.md`](miniprogram-readonly-acceptance-candidate-2026-08-18.md)。
