# 门诊费用 Provider 接口与 `patId` 契约审计

> 当前候选：服务端 release `5a31427`；小程序运行包来源 `cdb27e5023a188ab36a340497cebe18f1e274013`（提交 `cdb27e50`）。

> 当前基线更新：服务端 `5a31427`；小程序候选 `cdb27e50`；完整运行包来源 `cdb27e5023a188ab36a340497cebe18f1e274013`。下文更早候选只作历史追溯。

> 审计时间：2026-08-19  
> 审计范围：旧小程序 2.6.33 门诊子费用查询、新 Elysia 只读门诊费用链路、`patInfosFind.data.patId` 的用途边界  
> 当前代码/运行基线：服务端 `5a31427`，小程序候选 `cdb27e50`（来源 `cdb27e5023a188ab36a340497cebe18f1e274013`）
> 当前结论：只读代码与本地回归通过；真实 Provider 字段对照、当前 release 的公网/真机三层证据仍未完成。支付、医保、结算和 HIS 写回继续关闭。

## 1. 这条旧接口是做什么的

旧端调用的接口是：

```text
GET /msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records
```

旧端请求参数由 `hospital-app/src/api/modules/payment.ts` 定义：

| 参数 | 旧端含义 | 新端处理 |
| --- | --- | --- |
| `patId` | 2.1.3/档案查询得到的 HIS 临床患者号 | 只允许服务端从 owner-scoped `his-patient` 映射取得 |
| `startTime` / `endTime` | `yyyy-MM-dd HH:mm:ss` 时间窗口 | 服务端生成最近 30 个 `Asia/Shanghai` 日历日 |
| `tradeStatus=1` | 待支付 | 映射为公共状态 `unpaid` |
| `tradeStatus=3` | 已支付 | 映射为公共状态 `paid` |
| `authSysCode` | Provider 业务渠道标识 | 只从服务端配置注入，缺失时 fail-closed |

因此，这不是“查询患者基本资料”的接口，而是根据临床患者号读取门诊费用父子项目列表的接口。
它可以返回待缴和已缴目录，但不能仅凭列表响应推导支付成功、医保结算成功、退款成功或 HIS 回写成功。

## 2. `patInfosFind` 返回的 `patId` 是否有用

有用，而且是临床业务链路中的关键引用，但它不是二维码编号，也不是应该下发给小程序的公开字段。

旧端链路应理解为：

```text
患者目录 thirdPatientId / medicalCardNo / patientName
    -> patInfosFind(type=3, cardNo, patName)
    -> data.patId
    -> 预约历史、报告、门诊费用等临床 Provider 请求
```

用户提供的真实响应中，`data.patId` 为 19 位字符串。它应按字符串保存和传输，不能转成 JavaScript
`number`；超出安全整数范围的 JSON number 已经发生精度损失，无法在 adapter 中恢复，必须整次拒绝。

响应中的以下字段不能混入公共患者模型：

- `idCardNo`、`phone`、`addr` 等个人敏感资料；
- `patCardVOList` 中的卡号、身份证号和 HIS 卡片内部标识；
- Provider 原始对象、`traceId`、创建人和医院内部字段。

新平台只把 `data.patId` 写入服务端 `hp_patient_provider_references` 的
`referenceKind=his-patient` 映射。小程序提交的是平台内部 opaque `patientId`，服务端再按
`ownerUserId + patientId + provider + referenceKind` 解析外部引用；不会接受小程序直接提交 `patId`。

## 3. 它和首页二维码不是一回事

旧首页二维码源码读取的是 `medicalCardNo`，不是 `patInfosFind.data.patId`。因此“二维码展示的 ID”和
“门诊费用接口使用的 `patId`”不能因为页面上同时展示了 ID 就认定相同。

当前二维码继续关闭，原因是医院尚未提供可以验证的扫码协议。至少还需要确认：

1. 二维码载荷究竟是卡号、患者号、短期 token 还是签名对象；
2. 签名算法、密钥归属、有效期、重放保护和撤销方式；
3. 医院扫码端如何回执，以及回执是否需要服务端二次校验；
4. 真实微信小程序域名和扫码网络边界。

在这些字段没有冻结前，不能把 `patId` 直接生成二维码，也不能把完整卡号拼到第三方二维码图片 URL。

## 4. 新端当前只读实现

新端 adapter 位于 `packages/adapters/src/zhongyang-outpatient-payments.ts`，当前规则如下：

- 请求路径与旧端 2.6.33 一致；`patId`、时间窗口、`tradeStatus` 和 `authSysCode` 由服务端生成或注入。
- Provider 包络必须明确 `success=true`；明确业务拒绝与响应结构异常分开记录，不能把故障降级为空列表。
- 仅确认 `amount` 为金额来源，并在 adapter 边界把 Provider 的元转换为公共模型的人民币分。
- `waitPayAmount`、`registerDept`、`registerDoctor` 等只在旧端出现、尚未冻结的新契约字段不会参与展示、金额计算或支付编排。
- `tradeStatus` 只接受请求对应的 `1` 或 `3`；未知状态、缺失状态和状态错配整批拒绝。
- 账单时间必须是严格有效的 `YYYY-MM-DD HH:mm:ss`，并且落在服务端生成的闭区间内。
- adapter 还会独立校验调用输入：只接受患者引用、起止时间和状态四个字段；非法/倒序时间、未知字段和畸形对象在触网前拒绝，不能只依赖 service 的 HTTP schema。
- 费用记录必须有稳定内部引用；重复引用、缺少稳定标识和 Provider 原始字段不会出现在公共响应。
- 金额在进入十进制解析前必须是 Provider JSON 字符串或数字；对象、数组和其它可隐式转换形状一律判定为响应异常，不能让 JavaScript 的 `String()` 把错误结构变成合法金额。
- 公共接口只返回 `recordId`、状态、科室、医生、账单时间和 `amountFen`，不返回 Provider 订单号、患者卡号、身份证号、医保字段或原始对象。

服务层和 adapter 双重校验的目的，是防止未来替换真实网关、回放网关或任务调用方绕过 Elysia HTTP schema
后，把错误状态、窗口外账单或敏感字段带到小程序。

### 4.1 页面展示字段与业务事实分离

旧端门诊费用列表通过 `formatBillDate` 只展示 `YYYY-MM-DD`，而 Provider 的完整
`YYYY-MM-DD HH:mm:ss` 仍然是查询窗口校验和费用记录稳定引用的一部分。新端因此保留完整
`billDate` 在服务端和客户端读模型中，只在原生小程序渲染边界生成 `billDateLabel` 展示自然日；
不能为了视觉一致性在 adapter、API contract 或持久化边界截断时间，也不能让页面展示字段反过来参与支付、医保或结算判断。

## 5. `authSysCode` 不能凭旧代码猜测

旧端查询页面曾使用 `internetHospital`，旧端后续支付流程又使用过 `thirdSelfMachine`；这两个值不能直接
视为同一业务渠道。当前新服务生产配置曾观察到 `thirdSelfMachine`，但“配置存在”不等于 Provider 已确认
该渠道对门诊只读接口有权限，也不等于真实业务响应已经通过。

所以新端采取以下边界：

- `authSysCode` 是服务端启动配置，不接受小程序请求参数覆盖；
- 没有明确配置时，服务层和 adapter 都在 Provider 请求前停止；
- 不在代码里设置 `internetHospital` 或 `thirdSelfMachine` 默认值；
- 只有拿到 Provider/医院针对“门诊子费用查询”的渠道确认和真实样例后，才能固定生产值。

## 6. 本轮验证结果

- `pnpm --filter @hospital/adapters test src/zhongyang-outpatient-payments.test.ts`：21 项通过，51 个断言通过。
- `pnpm --filter @hospital/api test src/modules/outpatient-payments/service.test.ts`：12 项通过，47 个断言通过。
- 回归覆盖金额单位、状态映射、响应包络、稳定引用、重复记录、窗口边界、患者映射、日志脱敏和公共字段白名单。
- 2026-08-24 又补充 adapter 直接调用的畸形输入门禁；本轮测试确认非法对象、日期和字段均未触发 Provider 请求。该修正已进入本地 `main`，尚未部署生产。
- 本轮未调用真实 Provider，未执行支付、医保授权、结算、退款或 HIS 写回，未修改旧 Python 项目。

## 7. 下一步与停止条件

门诊费用只读下一步应取得当前 release 的三层证据：

1. 有效微信会话下，小程序分别打开“待缴”和“已缴”；
2. 公网 API 记录同一 `traceId`，服务端日志记录脱敏后的 Provider `requestId`；
3. Provider 返回样例确认 `amount` 单位、空字段语义、稳定身份字段、`authSysCode` 权限和空列表包络；
4. 页面金额、状态、患者切换和失败态与服务端日志逐项对应。

如果 Provider 不能确认金额或状态含义，立即停止该域，不通过猜测补 `waitPayAmount`、医保金额、费用详情或支付参数。
只有只读链路和支付/医保各自的正式 contract、状态机、幂等和补偿方案全部冻结后，才进入资金相关实现。
