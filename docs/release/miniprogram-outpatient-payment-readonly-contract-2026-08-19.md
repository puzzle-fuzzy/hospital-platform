# 小程序门诊缴费只读响应边界（2026-08-19）

## 结论

本次只收紧新小程序的门诊费用只读读取边界，不修改 Provider adapter、Elysia API、MySQL、Redis、旧 Python
服务，也没有打开微信支付、医保授权、退费或结算回写。

用户切换“待缴费/已缴费”时，客户端现在要求服务端成功响应的列表状态与本次查询状态一致，并逐条校验：

- `total` 必须等于完整 `items` 数量；
- 每条记录的 `status` 必须等于当前查询状态；
- `recordId`、`billDate`、科室名和医生名必须是有界字符串；
- `amountFen` 必须是非负安全整数。

任何不一致都使用 `provider-response-invalid` fail-closed，不降级为空列表，不把错误记录渲染成费用事实。
服务端 Provider adapter 仍是金额、日期、状态、owner 映射和权限的权威校验层；客户端检查只是防止响应错配
进入页面，不能替代服务端授权或支付状态确认。

## 未开放边界

只读查询仍不等于支付成功。`wx.requestPayment`、医保授权、支付通知、退款、6301/结算查单和 HIS 写回继续
保持独立 contract 与 gate，不能因为本次读模型校验通过而提前开放。
