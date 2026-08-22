# `dc8cd5b8` 小程序运行包与真机准入记录（2026-08-22）

> 本记录只覆盖小程序运行包、门诊缴费页面的只读布局和开发者工具入口恢复。
> 它不代表微信真机、众阳 Provider、支付、医保或 HIS 业务已经验收。

## 1. 当前候选

| 项目 | 结果 |
| --- | --- |
| 小程序提交 | `dc8cd5b8`（`补齐门诊缴费旧端就诊人院区布局`） |
| 运行包来源 | `dc8cd5b8bbf99411831cc5112bc39683108cd990` |
| 运行包生成时间 | `2026-08-22T01:27:14.901Z`（北京时间 09:27:14） |
| 注册页面 | 14/14 |
| 测试脚本进入 `dist/` | 0 个 `*.test.js` / `*.spec.js` |
| `runtime:verify` | 通过 |
| 服务端配套基线 | 上一次已验证的 `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 旧 Python 服务 | 本轮未修改、未停止、未重启 |

## 2. 本次代码范围

门诊缴费页恢复旧端的两行选择结构：

1. 就诊人行继续跳转到统一的患者选择页，不能把当前登录用户直接当作不可更换的就诊人；
2. 医院行展示受控的静态单院区名称，不调用未确认的动态院区 Provider；
3. 顶部网络异常提示保持在选择器上方；
4. 门诊费用仍然只读，未增加费用详情、微信支付、医保授权、结算、退费或 HIS 写回；
5. 医院行点击只提示当前支持的医院，不把静态展示项伪装成可切换业务。

关键实现位于：

- `apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.ts`
- `apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.wxml`
- `apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.wxss`
- `apps/miniprogram/src/types.ts`

## 3. 门禁结果

| 门禁 | 结果 |
| --- | --- |
| Biome | 通过 |
| 小程序 TypeScript 类型检查 | 通过 |
| 小程序测试 | `206 pass / 0 fail / 1552 expect()` |
| 小程序构建 | 通过，14 个页面入口存在 |
| 运行包来源校验 | 通过 |
| `single-flight.test.js` 搜索 | 源码只有测试文件，运行包没有测试脚本引用 |

## 4. `single-flight.test.js` ENOENT 边界

`apps/miniprogram/src/services/single-flight.test.ts` 是开发测试源码，构建配置明确不会把它编译到
`apps/miniprogram/dist/`。运行时必须使用 `services/single-flight.js`；手工复制测试文件会污染生产包并掩盖
开发者工具的旧增量索引问题，因此不采用。

本轮重新构建后确认：

- `dist/services/single-flight.js` 存在；
- `dist/services/single-flight.test.js` 不存在；
- `dist/` 中没有 `*.test.js` 或 `*.spec.js`；
- 微信开发者工具当前 `miniprogram` 项目重新生成了 iOS/局域网真机二维码。

## 5. 真机验收仍未完成

二维码和模拟器页面只证明入口与运行包已经准备好，不能证明手机已经完成业务。下一次必须使用本记录的
`dc8cd5b8` 来源扫码，并按以下顺序记录页面、客户端公共 `requestId` 和服务端 Pino 同链日志：

1. 微信登录；
2. 患者目录同步与显式切换；
3. 我的挂号、爽约记录；
4. 门诊缴费的待缴费/已缴费只读列表；
5. 切换患者后重复第 3、4 步，确认旧列表不会回写。

任一环节出现会话失效、患者映射缺失、Provider 响应非法或日志链不一致，都应停止本轮业务验收，不进入支付、医保或 HIS 写回。
