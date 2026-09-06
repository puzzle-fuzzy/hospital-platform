# miniprogram-pay

高平医院挂号医保测试小程序。页面只保留一条清晰业务流程：选择就诊人后，自动预约 `内科风湿 /
后天（无可约时顺延大后天）/ 上午 / 当前可用号源`，依次调用预约占位、预约写入、医保授权、费用上传和医保结算。

本端业务标识固定为 `businessType=registration`、`orderType=RegPay`。它对应统一医保核心的挂号入口，
不承载门诊费用记录；统一分层依据见 [医保统一核心与业务入口 ADR](../../docs/架构决策/0005-医保统一核心与业务入口.md)。

## 真实链路

```text
微信登录
  → 新平台患者目录
  → 新平台预约目录/指定号源
  → POST /appointments/holds
  → POST /appointments/registrations
  → 医保小程序授权回跳
  → POST /payments/medical-insurance/authorize
  → POST /payments/medical-insurance/orders/{orderId}/fees
  → POST /payments/medical-insurance/orders/{orderId}/settle
  → GET /payments/medical-insurance/orders/{orderId}（处理中时查单）
```

如果费用上传阶段收到众阳 2.6.33 明确的“正在收款中，不允许再次缴费”（服务端错误码
`medical-insurance-payment-in-progress`），本端才进入专用恢复分支：

```text
2.6.33 payment-in-progress
  → POST /payments/medical-insurance/orders/{orderId}/cancel
  → 服务端 2.6.65.4 支付查单
  → 2.6.65.11 支付关单
  → 2.6.65.6 取消结算
  → 返回 status/paymentState/settlementState/restartAllowed
  → 复用仍在有效期内的医保授权上下文
  → 创建新的平台医保订单
  → 重新执行费用上传和医保结算
```

只有 `status=cancelled` 且 `restartAllowed=true` 才会重开；查到已支付、关单失败、取消结算失败或
上下文缺失时进入人工复核，不会盲目重复 6201/6202。新门诊小程序不会调用这个 cancel 接口，
只向前端返回“当前已有一笔支付在进行中”。同一恢复尝试最多重开一次，避免形成循环订单。

注意：挂号医保当前链路里的 2.6.33 是在 `.1` 已创建本次结算后、`.2` 发起支付前读取当前
`tradeOrderIdList` 的明细；其中 `tradeStatus=2`/`disableSettleFlag=1` 只能说明当前结算处于阶段性状态，
不能据此触发本端的关单重开分支。只有服务端明确返回 `medical-insurance-payment-in-progress`，并且订单已保存
完整关单上下文时，支付小程序才允许调用 cancel。

用户在医保授权、医保混合支付或普通自费收银台明确退出时，页面调用统一的
`POST /payments/appointments/{appointmentId}/payment-exit`。服务端先查单并安全关闭未支付的微信订单，
再作废医保订单，最后取消预约以释放号源；所有步骤成功后才清除本地 `pendingPayment`。
如果支付结果已确认成功，或者 provider 状态未知，服务端拒绝释放，页面保留 pending 上下文供用户重试确认。

页面不会因为已有预约而自动取消。服务端发现已有预约后，用户必须点击“取消后重新挂号”，先调用
独立取消命令，再重新占位、预约写入和医保支付。不存在“预约+支付”的单一快速编排接口。

## 真实接口配置

所有业务地址和非敏感业务常量在 [`src/config.ts`](src/config.ts)。首次联调前必须补齐：

- `medicalCityCode`、`medicalChannel`：医保小程序授权参数；
- `medicalEnvVersion`：测试环境使用 `trial`；正式发布前才改为 `release`；
- `medicalOrgChannelCredential`：机构渠道凭证；构建时从本机忽略文件 `.local/medical-insurance/test-environment-key-material.json` 的 `identityVerificationFeedback.orgChannelAuthCode` 注入，不能提交到仓库；
- `departmentName` / `departmentProviderNames`：页面固定业务名称与 Provider 目录正式名称的对应关系；
- `targetDateOffsets`：候选日期偏移，当前为 `[2, 3]`（后天优先，无可约时顺延大后天）；不会请求当天；
- pay 小程序不开放号源选择：自动取服务端返回的第一条可用候选；真正写入前服务端会重新读取并锁定号源，
  如果号源已被其他用户占用则刷新候选后重试一次。
- `pendingPaymentMaxAgeMs`：支付上下文有效期，当前为 15 分钟；超过后不复用旧预约，重新获取可用号源。
  服务端医保授权入口也会再次校验同一窗口，不能通过重放旧 `appointmentId` 绕过。

医保机构渠道凭证只用于跳转医保授权小程序。小程序不直连医院 provider，也不保存患者实名资料、
provider 号、授权码或 payToken；医保 adapter 未配置时服务端保持 fail-closed。

## 构建

```bash
pnpm --filter @hospital/miniprogram-pay typecheck
pnpm --filter @hospital/miniprogram-pay test
pnpm --filter @hospital/miniprogram-pay build
```

构建后用微信开发者工具打开本目录，项目配置会将运行根目录指向 `dist/`。

真机联调需要在微信公众平台配置 `test-hp.meiyi.pro` 为 `request` 合法域名，并确认当前小程序
已配置为可跳转医保小程序 `wxe183cd55df4b4369`。开发者工具可暂时关闭域名校验，但不代表真机配置已完成。
