# miniprogram-pay

高平医院医保测试小程序。页面只保留一条清晰业务流程：选择就诊人后，固定预约 `内科风湿 /
后天（无可约时顺延大后天）/ 上午 / 指定号源`，依次调用预约占位、预约写入、医保授权、费用上传和医保结算。

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

页面不会因为已有预约而自动取消。服务端发现已有预约后，用户必须点击“取消后重新挂号”，先调用
独立取消命令，再重新占位、预约写入和医保支付。不存在“预约+支付”的单一快速编排接口。

## 真实接口配置

所有业务地址和非敏感业务常量在 [`src/config.ts`](src/config.ts)。首次联调前必须补齐：

- `medicalCityCode`、`medicalChannel`：医保小程序授权参数；
- `medicalEnvVersion`：测试环境使用 `trial`；正式发布前才改为 `release`；
- `medicalOrgChannelCredential`：机构渠道凭证；构建时从本机忽略文件 `.local/medical-insurance/test-environment-key-material.json` 的 `identityVerificationFeedback.orgChannelAuthCode` 注入，不能提交到仓库；
- `departmentName` / `departmentProviderNames`：页面固定业务名称与 Provider 目录正式名称的对应关系；
- `targetDateOffsets`：候选日期偏移，当前为 `[2, 3]`（后天优先，无可约时顺延大后天）；不会请求当天；
- `targetSerialNumber`：要固定命中的号源；为空时取该排班第一个返回号源。

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
