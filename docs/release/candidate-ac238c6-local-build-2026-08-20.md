# 小程序候选 `ac238c6` 本地构建记录（2026-08-20）

## 固定来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e360d3` |
| 小程序客户端 | `ac238c6` |
| 小程序构建来源 | `ac238c6156f085fdb56f5806fefac3613e5f85be` |
| 运行根目录 | `apps/miniprogram/dist/` |
| 上传线上 | 否 |
| 旧服务 | Python `8001`，本次未修改、未重启 |

## 本候选变更

门诊费用仍保持只读查询。服务端众阳 adapter 将 Provider 元字符串通过十进制 `BigInt` 精确转换为分，拒绝超过
`Number.MAX_SAFE_INTEGER` 的分值；小程序使用整数拆分展示金额，不通过浮点 `toFixed` 重新舍入。患者 owner 映射、
`tradeStatus=1/3`、最近 30 个中国标准时间自然日、账单日期真实性、页面旧请求淘汰和本地分批渲染边界保持不变。
支付、医保、退费、结算查单和 HIS 写回仍未开放。详细审计见
[`miniprogram-outpatient-payment-logic-audit-2026-08-20.md`](miniprogram-outpatient-payment-logic-audit-2026-08-20.md)。

## 构建与门禁

- `pnpm --filter @hospital/miniprogram typecheck`：通过。
- 小程序完整测试：169 项通过，0 项失败，1335 个断言。
- `pnpm --filter @hospital/miniprogram build`：通过，14 个页面脚本完整生成。
- `pnpm --filter @hospital/miniprogram runtime:verify`：通过。
- 全仓 `pnpm check`：9/9 任务通过；架构门禁 67 条、文档审计 278 个文档、工具测试 31 项通过。
- `dist/` 中 `*.test.js` 和 `*.spec.js` 数量为 0。
- `dist/build-info.json.sourceRevision` 已核对为上表完整来源。

## 微信授权与真机边界

本候选仍只调用 `wx.login()` 获取一次性 code，不调用 `wx.getUserProfile()` 或 `wx.getUserInfo()`，因此扫码登录不会
弹出头像/昵称授权框。旧 `8f80b3e` 二维码和开发者工具旧增量缓存不属于本候选；真机验收前必须重新编译当前 `dist/`
并生成二维码，先核对本记录的完整 `sourceRevision`。

本记录只证明本地代码和运行包门禁通过，不证明真实微信登录、患者同步、多患者切换、预约历史、门诊费用或普通资料写入
已经在真机完成。每个业务域仍需页面结果、客户端 `requestId/traceId` 和服务端低敏日志三层同链证据。
