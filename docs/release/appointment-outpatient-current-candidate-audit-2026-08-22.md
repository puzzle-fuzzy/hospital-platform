# 预约历史与门诊费用候选审计（历史记录，2026-08-22）

> 历史候选声明：本文中的业务页面与服务端日志证据使用小程序运行包来源
> `5b4b0667d76ce443290116352d27f5eb94eba49c`，不能升级为当前候选 `41c708e1adf864ef6fef1f788e97aa8fb4371227` 的真机或业务证据。
> 当前发布基线请阅读 [`current-device-acceptance-gate-2026-08-22.md`](current-device-acceptance-gate-2026-08-22.md) 和
> [`current-runtime-coexistence-readonly-audit-2026-08-22-1335.md`](current-runtime-coexistence-readonly-audit-2026-08-22-1335.md)。

## 当前结论

本历史记录以服务端 release `9f479c9a` 和小程序运行包来源 `5b4b0667d76ce443290116352d27f5eb94eba49c` 为当时的配对候选。
预约历史只读链路已经取得一次真实 Provider 请求和真实服务日志证据；门诊费用只读代码仍保持严格 gate，
本轮没有发现费用 Provider 请求日志，因此不能把门诊费用页面或支付流程宣称为真实验收完成。

支付、医保授权、医保结算、微信支付、退款和 HIS 写回仍然关闭。本审计没有修改旧 Python 项目、旧服务、
数据库或 Redis，也没有发起新的业务写入。

## 当前 13f 候选门诊费用复核（2026-08-24）

本节只描述当前候选 `13f597ea9ee3f65b9be858117826d948339d904a` 和小程序提交 `13f597e`，不继承历史运行包的
Provider 或真机证据。通过 SSH 只读检查新服务的 systemd 环境文件，确认当前线上配置为：

| 项目 | 当前值/结论 |
| --- | --- |
| `ZHONGYANG_OUTPATIENT_PAYMENT_READY` | `true` |
| `OUTPATIENT_PAYMENT_AUTH_SYS_CODE` | `thirdSelfMachine` |
| 旧端门诊费用查询渠道 | `internetHospital` |
| 当前 13f Provider 成功链 | 未观察到可接受的 `requested → loaded` 业务证据 |
| 当前 13f 真机三层证据 | 未提供，不能标记为通过 |

这里存在必须保留的业务阻断：旧端“门诊子费用查询”使用 `internetHospital`，旧端后续支付流程又使用过
`thirdSelfMachine`。两个值不能仅凭名称或支付代码推断为同一渠道。新端已经把渠道码固定在服务端配置，并且
没有提供 `internetHospital` 或 `thirdSelfMachine` 的代码默认值；因此本轮没有覆盖线上环境，也没有为了让页面
显示数据而把支付渠道值套到只读查询上。只有 Provider/医院正式确认“门诊子费用查询”的渠道权限、排序分页、
状态语义和时间窗口后，才能改写生产配置并执行真实只读验收。

当前代码门禁与回归测试结果如下：adapter `20 pass / 0 fail / 46 expect`，API service `15 pass / 0 fail /
55 expect`，domain `3 pass / 0 fail / 5 expect`，配置 `8 pass / 0 fail / 45 expect`。测试证明缺少渠道码、
未知状态、错配状态、越界账单和非法金额都会在 Provider 请求前或公共响应边界 fail-closed；这些测试通过不等于
当前生产渠道已获授权。

## 1. 运行包与服务共存基线

| 项目 | 当前事实 |
| --- | --- |
| 新 API | `9f479c9a`，生产模式，监听 `10.0.0.3:18081` |
| 旧 Python API | 继续监听 `0.0.0.0:8001`，本轮未重启、未修改进程 |
| 小程序源码 | 运行输入来源 `5b4b0667d76ce443290116352d27f5eb94eba49c` |
| 小程序 dist | 通过运行包门禁；存在 `services/single-flight.js`，不包含 `single-flight.test.js` |
| 运行时验证 | `pnpm --filter @hospital/miniprogram runtime:verify` 通过，14 个页面入口完整 |

`single-flight.test.js` 的历史 ENOENT 属于运行包污染/缺失相对模块问题，当前构建脚本只把排除测试文件后的
TypeScript 输出发布到 `dist/`，并在发布前扫描 `*.test.js`、`*.spec.js` 和缺失相对 import。不能通过把测试文件
复制进运行包来修复微信真机问题。

## 2. 预约历史真实只读证据

### 2.1 Provider 请求契约

旧端 `hospital-app/src/api/modules/ZY.ts` 和 `hospital-app/src/pagesB/user/my_registration.vue` 证明：

- 预约历史路径是 `/msun-middle-business-appointment-server/v1/appointment-infos/{patId}`；
- 在线挂号使用 `requestChannel=3`；
- `isMzFlag=1` 表示门诊记录；
- `dateFlag=1` 表示按就诊日期筛选；
- 当前新端由服务端固定 Provider 参数，小程序只提交平台内部 `patientId` 与有限日期窗口；
- “全部挂号”使用旧端的 `requestChannel=4`，但当前没有独立 Provider 合同，因此新端继续拒绝把渠道 3
  结果伪装成全部渠道。

旧端状态映射已再次核对：`0=已预约`、`1=已取消`、`3=已就诊`、`4=爽约`、`5=停诊`、`6=替诊`、`7=已登记`。
新端 adapter 将这些已确认数字映射成有限英文枚举，未知数字保留 `unknown`；小程序只把服务端明确的
`missed` 状态交给爽约页面，不根据日期、状态名称或未知数字猜测。

### 2.2 线上日志证据

通过 SSH 只读查询 `hospital-platform-api-v2.service` 的低敏业务日志，发现以下两次预约历史请求：

| 时间（中国标准时间） | trace | Provider 结果 | 业务含义 |
| --- | --- | --- | --- |
| 2026-08-22 04:25:44 | `mp-mt3efq74-m7ahs7lc` | `itemCount=61`，`cancelled=61` | Provider 成功返回，当前在线标签过滤后为空是预期结果 |
| 2026-08-22 09:09:19 | `mp-mt3okf22-pvsnuom3` | `itemCount=61`，`cancelled=61` | 新候选再次完成真实 Provider 只读读取与状态归一化 |

对应日志顺序均为 `appointment.records.requested → appointment.records.synced`，没有出现失败事件。
日志只保留平台患者引用、状态计数和 trace 关联；本文件不记录患者姓名、证件、卡号、Provider 患者号或原始响应。

因此当前“在线挂号”页显示“暂无在线挂号记录”属于业务结果，不是 404、Provider 超时或空响应故障。
“全部挂号”仍不能打开，因为渠道 4 的权限、日期缺省语义、分页、排序和状态合同尚未冻结。

## 3. 门诊费用只读代码复核

### 3.1 已确认的旧端事实

旧端 `hospital-app/src/api/modules/payment.ts` 和 `hospital-app/src/pagesB/health/outpatient_pay.vue` 证明：

- 门诊父子项目查询路径是 `/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records`；
- 查询参数包含 `patId`、`startTime`、`endTime`、`tradeStatus` 和 `authSysCode`；
- `tradeStatus=1` 是待支付，`tradeStatus=3` 是已支付；
- 旧页面当前使用的读取渠道是 `authSysCode=internetHospital`；
- 旧页面还直接持有 Provider 患者号、订单号、医保编码，并把这些字段交给后续支付/医保页面，不能原样迁移到新端；
- 旧端详情页还会用结算单号拼接第三方二维码 URL，这不是医院扫码协议，不能作为新端二维码实现依据。

### 3.2 新端当前边界

新端 `packages/adapters/src/zhongyang-outpatient-payments.ts`、`apps/api/src/modules/outpatient-payments/index.ts`
和 `apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.ts` 已完成以下只读边界：

- `authSysCode` 只来自服务端配置，不接受小程序 query 覆盖；
- Provider 患者号只能由当前 owner + `patientId` 的 `his-patient` 映射取得；
- 金额在 adapter 边界从元精确转换为分，缺失、负数、超安全整数或非法小数全部拒绝；
- `tradeStatus` 必须与本次查询状态一致，`1/3` 以外的中间态、退款态、作废态不能粗暴映射为已缴费；
- 账单时间严格使用中国标准时间最近 30 个自然日，窗口外记录整批拒绝，不过滤后伪装成功；
- 公共响应不含 Provider 订单号、患者号、医保编码和支付凭证；
- 费用卡片只读展示，点击不会调用 `wx.requestPayment`，不会发起结算、医保授权或支付写入；
- 费用查询失败时清空患者和金额列表，避免旧患者金额残留在当前页面。

## 4. 当前停止条件

门诊费用下一步只能在以下证据具备后继续：

1. 由并行众阳接口工作取得并登记 2.6.33 的脱敏成功、空结果、业务拒绝和超时样例；
2. 确认当前生产 `authSysCode` 的正式渠道权限、时间边界、排序/分页和状态语义；
3. 取得真实 Provider 请求与 `outpatient.payment.records.requested/loaded/failed` 日志的同链证据；
4. 在不暴露订单号、医保编码和患者身份的前提下完成小程序真机待缴/已缴页面验收；
5. 以上只读证据稳定后，另行设计支付命令、幂等、微信支付回调、医保授权、6201/6202/6301 状态机和 HIS
   写回，不能从当前只读列表直接扩展支付按钮。

在这些条件满足前，不修改费用 Provider 参数、不开放支付按钮、不新增医保转发、不生成第三方二维码，也不因
页面能够显示空态就记录为“门诊缴费已迁移”。

## 5. 本轮验证与边界

- 预约历史线上日志：已取得真实 Provider 成功读取证据；
- 门诊费用线上日志：本轮未发现请求，真实 Provider/真机证据未完成；
- 小程序运行包：`runtime:verify` 通过；
- 旧服务：保持运行，未修改、未重启；
- 数据库、Redis：未写入业务数据；
- 支付、医保、退款、HIS 写回：继续关闭。
