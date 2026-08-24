# 2026-08-24 日志链路与敏感信息边界审计

> 本文记录当前代码的日志链路审计结果，四个 adapter 输入门禁已随服务端 release `28a5c0c131794ce9dcc5f94bd3809402188ac87a` 进入线上。
> 当前小程序运行包仍为 `13f597e`；旧 Python
> `8001` 与新 Bun `18081` 共存；当前进程窗口没有新的患者、预约、门诊费用、普通资料或报告业务事件。
> 线上窗口证据见 [`28a5c0c1-production-acceptance-2026-08-24.md`](./28a5c0c1-production-acceptance-2026-08-24.md)。

## 1. 审计结论

当前新项目的日志实现满足代码级链路和低敏边界要求：

1. 原生小程序为每一次 `wx.request` 生成独立的 `x-request-id`，成功和失败响应都读取服务端最终返回的 `X-Request-Id`。
2. API 入口先归一化调用方关联号；非法、超长、带空白或控制字符的值不会进入响应头、Pino 或 Provider 上下文。
3. HTTP 生命周期日志、业务 service 事件和 Provider 低敏诊断字段使用同一个 `traceId`/`requestId` 关联；幂等键只记录是否存在，不记录原值。
4. Pino 使用项目统一的 JSONL 输出和递归最终脱敏边界；患者身份、完整卡号、身份证号、手机号、令牌、密钥、请求/响应正文和 Provider 原始报文不会进入日志。
5. `401`、依赖未配置、持久化暂时不可用、Provider 拒绝和读模型损坏保持不同的 HTTP/错误码语义，不通过“重新登录”或“空列表”掩盖依赖故障。

这说明“代码是否能定位问题”已经具备可审计基础，但不能把本地测试通过等同于真机或生产业务通过。当前仍需用同一个线上候选重新触发微信登录、患者切换、预约历史和门诊费用，并采集页面、客户端 requestId、服务端事件和 Provider requestId 的同链证据。

## 2. 关联链路

```text
小程序 wx.request
  -> x-request-id（每个物理请求独立）
  -> Nginx /api/v2 转发
  -> Elysia request-context（校验或生成安全值）
  -> Pino http.request.completed / http.request.failed
  -> service event（同 traceId）
  -> adapter/provider requestId（仅保留低敏关联号）
```

### 小程序层

- `apps/miniprogram/src/services/api-client.ts` 在真正调用 `wx.request` 前生成 request id。
- `apps/miniprogram/src/services/api-request-observability.ts` 只保存最近 64 条低敏观测。
- 观测只保留 method、无查询串的内部 path、状态码、耗时、结果类型和 error code。
- 不保存请求体、`Authorization`、患者 ID、Provider ID、查询参数或 Provider 原文。
- 网络失败使用 `statusCode=0` 和固定 `network-failed`，不能被解释为服务端返回的业务状态。

### API 层

- `apps/api/src/plugins/request-context.ts` 统一校验 `x-request-id` 和 `idempotency-key` 的字符集与长度。
- `apps/api/src/plugins/request-logging.ts` 在响应完成后记录最终 HTTP 状态，避免把统一错误处理后的 `503` 误记为默认 `500`。
- 请求失败日志只记录 `errorName`、稳定 `errorCode`、依赖名、Provider 低敏诊断字段、持久化操作/允许列表错误码或固定 `readModelViolation`。
- 不记录 headers、body、Authorization、异常 message、SQL、连接串、Provider URL 或 Provider 响应体。

### 业务与 Provider 层

业务 service 从 `adapterContextFromHeaders(headers)` 取得同一关联上下文；登录、患者、预约、报告、门诊费用和普通资料的业务事件沿用该 `traceId`。Provider 返回的 request id 经过 domain/service 二次投影后才允许进入成功或失败日志，越界时只记录固定违规原因。

`http.request.completed` 只能说明 HTTP 响应完成，不能代替 `*.synced`、`*.loaded` 或 `*.succeeded` 业务成功事件。Provider 返回空数组时要有明确的业务成功事件和 `itemCount=0`；没有业务事件的 HTTP 200 或健康探针都不能当作业务成功。

## 3. 代码级验证

本轮在工作树执行了以下验证：

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| API 请求日志/错误映射定向测试 | `27 pass / 0 fail`，`94 expect()` | 覆盖 Provider、持久化、读模型、依赖和敏感字段边界 |
| API requestId/traceId 定向测试 | `7 pass / 0 fail`，`17 expect()` | 覆盖安全回退、响应头保留、HTTP 成功/失败和不记录 Authorization |
| `pnpm logging:audit` | 通过 | 81 个静态事件均已登记 |
| API TypeScript 检查 | 通过 | 使用 `tsc --noEmit`，不把 Bun 转译当作类型检查 |
| Pino 深层脱敏测试 | 已有回归覆盖 | 覆盖大小写变体、嵌套对象、数组和非法 JSON 输出边界 |

小程序请求观测和服务端 HTTP 日志的关联测试仍应在真机上重复一次；开发者工具模拟器只能证明 mock 收到了响应头，不能证明公网代理、微信网络层和当前线上进程使用了同一条链。

## 4. 发布基线边界

当前线上 release 已更新为 `28a5c0c1`，本次发布包含四个只读 adapter 的运行时输入门禁：

- `packages/adapters/src/zhongyang-appointments.ts`
- `packages/adapters/src/zhongyang-outpatient-payments.ts`
- `packages/adapters/src/zhongyang-patients.ts`
- `packages/adapters/src/zhongyang-reports.ts`

发布前 `bun tools/release-baseline-audit.mjs` 曾按设计返回失败，原因是旧线上 release 尚未包含这些文件；切换后已按新的候选基线重新执行该审计：

```text
服务端 release 13f597ea9ee3f65b9be858117826d948339d904a 之后存在未部署运行时代码（发布前状态）：
packages/adapters/src/zhongyang-appointments.ts,
packages/adapters/src/zhongyang-outpatient-payments.ts,
packages/adapters/src/zhongyang-patients.ts,
packages/adapters/src/zhongyang-reports.ts
```

这不是日志代码失败，而是发布前门禁阻止将本地 adapter 变化冒充线上候选；该门禁现已通过新的 `28a5c0c1` 基线重新验证。当前不通过文档修改绕过门禁，也没有触碰旧 Python 服务。

## 5. 真机取证顺序

下一次取得手机后，按以下顺序操作并保存低敏证据：

1. 清空小程序本地请求观测，重新登录，记录登录成功请求的客户端 requestId。
2. 进入患者选择页，刷新并显式切换一个可用就诊人；记录患者目录读取和切换后的业务请求 requestId。
3. 进入“我的挂号”，分别点击“在线”和“全部”；两个标签必须产生独立请求，不能用本地数组复制假装全部历史。
4. 进入门诊缴费，只做只读查询；支付、医保、退款和 HIS 回写继续不触发。
5. 用客户端 requestId 查询线上 `http.request.*`，再用同一 trace 查询业务事件，最后用已脱敏的 Provider requestId 对接 Provider 日志。

证据中禁止出现微信临时 code、openid、unionId、session_key、accessToken、完整身份证号、完整卡号、手机号、Provider 患者号、请求正文和原始 Provider 响应。若线上当前候选没有对应业务事件，应记录为“未触发/未观测”，不能记录为“业务失败”或“业务成功”。

## 6. 后续动作

1. 已按发布 runbook 将四个 adapter 门禁作为一个完整候选完成隔离 preflight、readiness 和新旧服务共存复核；未经真机业务触发，仍不能把 runtime smoke 当作业务证据。
2. 继续取得当前 `28a5c0c1` 服务端与 `13f597e` 小程序运行包的真机三层证据；若只看到 HTTP 失败而没有业务事件，按错误边界排查，不把空日志窗口当作 Provider 空数据。
3. 只有预约、门诊费用和报告只读证据稳定后，才继续评估真实支付、医保授权、退款和 HIS 写回；日志链路本身不能替代这些业务 contract、授权和状态机验收。
