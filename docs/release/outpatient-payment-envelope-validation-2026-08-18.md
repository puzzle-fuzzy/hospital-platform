# 门诊费用 Provider 响应包络校验记录

> 记录时间：2026-08-18
> 变更类型：门诊费用只读 adapter 的 Provider 响应边界加固
> 状态：本地代码与定向测试完成，未部署生产，未改变旧 Python 服务

## 1. 发现的问题

众阳 2.6.33 文档定义了响应包络中的 `success` 布尔字段和 `data` 数组。
原 adapter 在包络形态下只判断 `success !== false`，因此 `{ data: [] }` 或
`{ success: "true", data: [] }` 可能被误当成合法空列表。这样会把 Provider
响应结构异常隐藏成“暂无门诊费用”，页面和日志也无法区分真实空结果与上游故障。

## 2. 本次修正

- 包络形态必须明确满足 `success === true`，否则按
  `ProviderRequestError(responseInvalid=true)` 失败；不会进入 `loaded` 日志，也不会
  返回 `200 + items: []`。
- Provider 明确返回 `success: false` 仍保持“业务拒绝”分支，不误报为响应结构异常。
- 已有的裸数组解析分支暂时保留，作为当前 adapter 的兼容输入形态；它不改变公共
  contract、患者归属、时间窗口、金额单位或支付 gate。
- 该修正只影响门诊费用只读查询；不打开费用详情、微信支付、医保授权、结算回写或退款。

## 3. 自动化验证

- `pnpm --filter @hospital/adapters test src/zhongyang-outpatient-payments.test.ts`
  当前定向结果：15 项通过，35 个断言。
- `pnpm --filter @hospital/api test src/modules/outpatient-payments/service.test.ts`
  当前定向结果：9 项通过，34 个断言。
- 新增回归覆盖：缺失 `success`、非布尔 `success` 均拒绝，且保留
  `responseInvalid=true` 的低敏错误事实。

## 4. 线上与验收边界

本次未通过 SSH 修改服务器、未重启新旧服务、未触碰用户已有的
`apps/miniprogram/project.config.json` 修改。当前生产服务端以 `687690e` 为准，
本地代码变更必须经过全仓门禁、独立候选发布和公网/真机/Provider 三层证据后才能进入线上。
真实门诊费用仍需在有效微信会话下取得页面结果、HTTP trace、低敏业务日志和 Provider
字段对照；不能用本次测试替代真实业务验收。
