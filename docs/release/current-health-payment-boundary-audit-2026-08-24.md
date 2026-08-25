# 健康内容与支付边界审计（2026-08-24，历史快照）

> 本文是 2026-08-24 的历史审计快照；当前服务端 release：`8eb51b5ffe85b0b8f8a032783f893117d3df549d`，当前小程序运行包来源：
> `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本记录只审计入口和关闭态，
> 不代表健康内容、微信支付、医保结算或真机业务已经完成。

## 结论

本轮没有发现需要修改运行时代码的真实逻辑缺口：

1. 健康百科、自测、BMI 和血压计算器没有被误认为已迁移。健康百科的 domain/service/repository
   骨架可以独立测试；截至 2026-08-25，`healthKnowledgeModule` 已挂载到 `apps/api/src/app.ts` 以冻结
   只读公共 contract，但默认仓储仍要求已审核发布版本，没有真实内容 bundle、临床审核、版本负责人或
   staging 发布/撤回证据时不会向患者端返回内容。
2. 微信支付的订单、订单查询、预支付和通知入口共用 `wechatPaymentEnabled` 闸门。默认值是关闭；
   关闭时认证之后、任何支付仓储/provider 操作之前返回 `503 dependency-not-configured`，不会读取报价、
   写订单、创建预支付尝试、验签解密或写通知去重事实。
3. 小程序门诊费用页仍是只读页面。待缴、已缴记录点击只显示迁移状态提示，不调用 `wx.requestPayment`，
   不发起医保授权，不修改服务端结算状态。`api-client.ts` 的支付调起函数只是后续受控 contract 的
   服务端参数适配器，当前没有页面入口调用它。

## 代码证据

### 健康内容与自测

- `apps/api/src/modules/knowledge/index.ts` 保留了经过会话认证的只读 HTTP contract，当前已由
  `apps/api/src/app.ts` 挂载；默认仓储没有审核发布版本时仍 fail-closed。
- `apps/api/src/app.test.ts` 固定验证未登录访问 `/api/v1/knowledge/health/part/list` 返回 `401`，防止
  路由注册被误解为内容已公开；健康知识 service/repository 测试继续覆盖未发布版本的关闭语义。
- `tools/architecture-audit.mjs` 的 `knowledge.route-contract-fail-closed` 规则要求路由可以冻结公共
  contract，但内容必须由版本化审核仓储控制；
  `docs/migration/health-content-and-self-test-audit-2026-08-24.md` 记录了旧端自测评分、BMI/血压阈值
  和适用人群的未决临床问题。

因此本轮不导入旧正文、不复制旧评分配置、不新增计算器 API，也不通过前端静态 fixture 制造健康内容
“已迁移”的成功状态。

### 支付与医保

- `apps/api/src/modules/payments/index.ts` 的 `ensureWechatPaymentEnabled` 是所有支付入口的共同前置
  闸门，避免只关闭预支付而留下半成品订单。
- `apps/api/src/index.ts` 只有在真实支付 gateway 和通知验签/解密器同时注入时才把闸门传为 `true`；
  环境变量齐全本身不等于真实支付链路已验收。
- `apps/worker/src/runtime.ts` 仍要求持久化密钥、商户证书、APIv3 密钥、通知地址和 schema 等完整条件，
  失败时不启动支付补偿循环。API 关闭态与 Worker 严格配置态是两个有意分离的门禁，不能合并。
- `apps/api/src/app.test.ts` 覆盖了关闭态无报价读取、无订单写入和预支付 `503`；通知入口也在读取原始
  body、验签和通知去重之前受闸门保护。

医保授权、6201/6202/6301、微信自费支付、退款和 HIS 回写继续最后专项处理；不能因为门诊费用只读列表
能返回 `200`，就把它解释为支付或医保已完成。

## 本轮验证

以下检查用于确认边界没有被当前候选破坏：

- `pnpm --filter @hospital/api test src/app.test.ts src/modules/knowledge/index.test.ts`
- `pnpm --filter @hospital/miniprogram test`
- `pnpm architecture:audit`
- `pnpm release:baseline:audit`
- `pnpm docs:audit`
- `pnpm format:check`
- `pnpm lint`

这些检查证明代码、运行包和文档门禁一致，但不替代真实 Provider 响应、支付沙箱/生产凭证、微信回调、
线上低敏业务日志或真机页面证据。

## 下一步准入

健康域只有在真实脱敏内容、临床审核、版本发布/撤回演练和患者端页面验收齐全后，才单独评估健康百科内容；
自测、BMI/血压必须分别冻结规则版本和适用人群。支付/医保则等待金额权威、授权回跳、回调/查单、幂等、
补偿和 HIS 写回 contract 全部冻结后，按门诊费用与预约挂号两条独立状态机分别验收。

本轮没有 SSH 写入、部署、重启或修改旧 Python 服务，也没有触碰并行会话维护的众阳自动化代码和用户未
提交的 `apps/miniprogram/project.config.json`。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
