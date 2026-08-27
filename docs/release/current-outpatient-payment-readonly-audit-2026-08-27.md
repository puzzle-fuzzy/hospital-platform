# 当前门诊缴费只读业务审计（2026-08-27）

> 本文记录当前新项目对“门诊缴费列表”的代码和本地回归结论。它只覆盖费用查询读模型，不代表支付、医保授权、结算、退费或 HIS 回写已经迁移，也不代表 Provider 或微信真机业务已经验收。

## 1. 审计结论

当前门诊缴费列表可以继续作为“只读低风险域”保留：

- API 只接受内部 `patientId` 和 `unpaid/paid` 状态，不接受 Provider 患者号、金额、卡号或旧端 URL；
- 服务端先验证登录主体，再通过 owner-scoped 患者映射取得众阳 `patId`，映射缺失时不会请求 Provider；
- 查询窗口由服务端固定生成，使用 `Asia/Shanghai` 的最近 30 个自然日，不由小程序传入；
- Provider 响应必须明确 `success=true`，并逐条核对 `tradeStatus`、账单时间、金额、稳定费用身份和展示字段；异常记录整批拒绝，不能过滤坏行后伪装成空列表；
- 小程序只把完整查询结果做本地首屏 10 条展示和“加载更多”，没有把本地窗口冒充 Provider 分页；
- 待缴记录和已缴记录点击后都进入明确的迁移状态页，不调用 `wx.requestPayment`，不发起医保授权，不执行 6201/6202/6301 或 HIS 写回。

因此，本轮没有发现需要修改现有门诊费用只读实现的业务逻辑缺陷，也没有打开支付或医保能力。

## 2. 代码链路核对

| 层 | 当前实现 | 关键正确性边界 |
| --- | --- | --- |
| 领域模型 | `packages/domain/src/outpatient-payments.ts` | 公共状态仅为 `unpaid/paid`；金额统一为人民币分；账单时间必须是严格的中国标准时间文本；最多 512 条，越界整批失败 |
| 众阳 adapter | `packages/adapters/src/zhongyang-outpatient-payments.ts` | 只读路径为 `outpatient-child-payment-records`；状态只接受 `1=待缴费`、`3=已缴费`；`amount` 使用十进制无损转换；稳定身份缺失或重复时拒绝 |
| API service | `apps/api/src/modules/outpatient-payments/index.ts` | owner → 患者 → `his-patient` Provider 引用 → gateway；Provider 结果和时间窗口二次校验；日志仅保留低敏关联字段 |
| API 路由 | `GET /api/v1/payments/outpatient/records`（公网由 `/api/v2` 映射） | 参数只包含内部 `patientId` 和状态；响应使用 `OutpatientPaymentListResponse` contract |
| 小程序页面 | `apps/miniprogram/src/pages/outpatient-payment/` | 先确认会话和当前就诊人；患者/会话变化时清空旧费用；请求失败不降级为空列表；卡片事件回查当前渲染批次 |

## 3. 业务状态与停止条件

### 3.1 可以保留的只读范围

1. 展示待缴费/已缴费标签；
2. 展示已核对的科室、医生、账单时间和人民币金额；
3. 在当前患者上下文内刷新和本地展开列表；
4. Provider 返回业务拒绝、超时、结构异常、患者映射缺失时展示独立错误态；
5. 患者没有门诊费用映射时展示“当前就诊人暂未建立门诊缴费映射”，不自动把它解释为应更换患者。

### 3.2 明确关闭的范围

以下能力不能由本只读列表推导或复用：

- 费用详情和电子票据下载；
- 微信自费支付、支付订单和 `wx.requestPayment`；
- 医保授权、医保结算及 FSI `1101/6201/6202/6301/6203/6401`；
- 退款、关单、支付回调、查单和补偿任务；
- HIS 回写、费用状态本地持久化和任何“支付成功”前端模拟。

这些能力必须另建金额守恒、幂等键、最终状态查询、回调去重、重试补偿和回滚 contract；在正式 Provider 材料和真实环境证据到齐前，继续进入最后专项。

## 4. 日志与敏感数据边界

服务端使用现有 Pino 事件：

- `outpatient.payment.records.requested`：记录 `traceId`、状态、查询窗口和内部 `patientId`；
- `outpatient.payment.records.loaded`：记录 Provider、请求关联号、状态和条数；
- `outpatient.payment.records.failed`：记录错误类型、固定 `resultViolation` 和 Provider 低敏错误元数据。

Provider 患者号、费用金额明细、单据号、支付 token、原始响应正文和原始错误文本不进入日志或客户端响应。服务层还会对可注入 gateway 的结果做第二次白名单校验，避免回放器或未来任务绕过 adapter 后污染 API。

## 5. 本轮验证证据

执行命令：

```powershell
bun test packages/domain/src/outpatient-payments.test.ts packages/adapters/src/zhongyang-outpatient-payments.test.ts apps/api/src/modules/outpatient-payments/service.test.ts
```

结果：`41 pass / 0 fail / 115 expect()`。

覆盖了状态和金额精度、严格账单日期、资源上限、Provider 包络、业务拒绝、稳定费用 ID、患者引用隔离、owner 映射、查询窗口、重复记录、异常 trace、日志脱敏和支付关闭边界。

这组证据是本地代码回归，不替代：

1. 当前线上 release 与当前小程序 live 运行包的同源真机链路；
2. Provider 非空、空结果、拒绝和超时的三层关联证据；
3. 当前患者下金额非空且与旧端一致的现场样例；
4. 支付/医保/结算/退费/HIS 写回的独立 contract 和真实验收。

## 6. 下一步

门诊费用只读列表本轮停在正确的安全边界。下一步继续做尚未完成的独立入口覆盖和页面细节迁移；如果进入支付专项，必须先登记正式接口版本、字段单位、状态机、幂等与补偿材料，不能从当前只读列表直接扩展写入。

本轮未修改旧 Python 项目、旧服务 `8001`、旧数据库、旧 Redis，也未修改并行会话负责的预约 Provider adapter。
