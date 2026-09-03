# miniprogram-pay

高平医院“医保测试一键挂号”原生微信小程序。它只做一件事：选择就诊人后，固定预约 `内科风湿 / 配置日期 / 上午 / 指定号源`，创建预约并继续医保支付。

## 真实链路

```text
微信登录
  → unionId 绑定就诊人 → 众阳 patId
  → 查当天有效预约
      ├─ 已有预约：停止，不重复挂号
      └─ 无预约：2.10.4.1 创建预约（isPay=0）
          → 2.6.65.1 发起结算
          → 2.6.65.2 医保支付下单
          → 国家医保小程序授权
          → 1101 → 6201 → 6202 → 6301
          → 医保无自费：医院最终结算回写
          → 有自费：微信支付 → 医院最终结算回写
```

页面不会因为已有预约而自动取消。用户必须点击“取消后重新挂号”，先调用取消预约，再重新查号源、查重、挂号和支付。

## 真实接口配置

所有业务地址和非敏感业务常量在 [`src/config.ts`](src/config.ts)。首次联调前必须补齐：

- `medicalCityCode`、`medicalChannel`：医保小程序授权参数；
- `medicalEnvVersion`：测试环境使用 `trial`；正式发布前才改为 `release`；
- `medicalOrgChannelCredential`：机构渠道凭证；构建时从本机忽略文件 `.local/medical-insurance/test-environment-key-material.json` 的 `identityVerificationFeedback.orgChannelAuthCode` 注入，不能提交到仓库；
- `pluginPayType`、`pluginWorkStationId`：只有 6202 返回微信自费金额时才需要；
- `targetDate`：本次测试日期；
- `targetSourceId` 或 `targetSerialNumber`：要固定命中的号源，均为空时取该排班第一个返回号源。

医保机构渠道凭证用于医保小程序授权跳转，只在本机联调配置；微信支付商户私钥等材料仍由 `test-hp.meiyi.pro` 的中转接口持有。前端不把医保“下单成功”当支付成功，必须拿到医院最终结算确认。

## 构建

```bash
pnpm --filter @hospital/miniprogram-pay typecheck
pnpm --filter @hospital/miniprogram-pay test
pnpm --filter @hospital/miniprogram-pay build
```

构建后用微信开发者工具打开本目录，项目配置会将运行根目录指向 `dist/`。

真机联调还需要在微信公众平台配置两个 `request` 合法域名：
`gpsrmyy.meiyi.pro`、`test-hp.meiyi.pro`，并确认当前小程序已配置为可跳转医保小程序 `wxe183cd55df4b4369`。开发者工具可暂时关闭域名校验，但不代表真机配置已完成。
