# 预约、门诊费用与患者档案只读闭环审计（2026-08-20）

> 本文记录新项目本地候选的业务逻辑审计和回归测试证据。
> 本次只检查代码、测试和文档，没有修改旧 Python 服务、线上服务、MySQL、Redis、Provider 数据或微信小程序线上包。
> 通过本地测试不等于真实 Provider、真机或生产业务验收。

## 1. 审计目标

本轮围绕用户提供的真实 `patInfosFind` 响应，复核以下只读链路是否保持同一位就诊人：

```text
患者目录同步
  -> patInfosFind.data.patId
  -> owner-scoped his-patient 映射
  -> 预约历史 / 门诊费用 Provider 查询
  -> 服务端白名单读模型
  -> 原生小程序页面投影
  -> 低敏请求与业务日志
```

这里的 `patId` 是众阳/HIS 的临床患者主档引用，不能与目录侧的 `thirdPatientId`、医院卡号，或首页二维码载荷混用。旧端首页虽然同时展示患者信息和二维码，但当前源码证据只证明二维码实际使用 `medicalCardNo`；没有证明 `patId` 就是二维码协议字段。因此二维码继续保持关闭，等待医院确认载荷、签名、有效期、受众和防重放规则。

## 2. 已确认的业务边界

### 2.1 患者档案与临床引用

- `patInfosFind` 是按姓名和卡号查询 HIS 患者档案的只读接口，不是微信登录、平台账号绑定、二维码生成或支付接口。
- 新 adapter 只接受明确成功包络中的 `data.patId`，并保留为字符串，避免 19 位 HIS 引用经过 JavaScript 数字转换后失真。
- 查询姓名、卡号、档案姓名、顶层卡号以及显式 `patCardVOList` 之间必须满足归属校验；卡片列表不能被顶层卡号的并集结果绕过。
- 身份证号、手机号、生日、地址、民族、原始档案和卡片列表不会进入公共 API 响应，也不会写入业务日志。
- 只有 owner-scoped、Provider 一致且 `referenceKind=his-patient` 的内部映射，才允许进入预约、报告和门诊费用查询。

### 2.2 预约历史

- 新服务固定已确认的历史查询渠道 `requestChannel=3`，并由服务端生成查询日期窗口；小程序不能自行传入 Provider 患者号或修改渠道。
- 预约记录按状态白名单映射为公共 `scheduled`、`cancelled`、`completed`、`missed`、`stopped`、`substituted`、`registered` 和已确认的 `unknown`。
- 未确认的 `requestChannel=4`“全部挂号”合同、详情、取消、预问诊、预约下单和挂号费支付均保持关闭。旧端不同页面存在默认渠道差异，不能用页面筛选名称猜测 Provider 语义。
- Provider 返回的重复预约号、非法日期、越界记录、异常 trace 或明确业务失败不能降级为空列表；必须整批 fail-closed。

### 2.3 门诊费用

- 新服务只开放 `unpaid` 与 `paid` 两种只读状态，并固定映射到已确认的 `tradeStatus=1` 与 `tradeStatus=3`。
- 金额只使用 Provider 已确认的 `amount` 元字段转换为整数分；旧端的 `waitPayAmount`、科室/医生兜底字段和渠道差异不在没有正式合同前猜测接入。
- 服务端固定生成最近 30 个中国标准时间自然日的账单窗口，账单日期、状态、金额和稳定记录标识均进行二次校验。
- 该链路不创建支付订单、不调起微信支付、不请求医保授权、不结算、不退款，也不向 HIS 写回。

### 2.4 日志

预约与门诊费用只记录操作名、内部低敏关联字段、状态、条目数、服务端请求号和固定失败原因。以下内容禁止进入日志：

- 微信临时 `code`、session token、Provider Authorization；
- 姓名、身份证号、手机号、完整卡号、HIS `patId` 和原始 Provider 报文；
- Provider 原始错误 message、支付凭证、医保凭证和二维码载荷。

## 3. 代码与测试证据

本次在 `E:\__Super_Core__\hospital-platform` 执行，未使用旧项目的兼容脚本：

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| Provider adapter、患者档案、预约、门诊费用 | `pnpm --filter @hospital/adapters test` | 95 项通过，0 项失败，207 个断言 |
| Elysia API、owner 归属、业务 service、日志 | `pnpm --filter @hospital/api test` | 163 项通过，0 项失败，713 个断言 |
| 原生小程序、患者上下文、预约/费用页面投影 | `pnpm --filter @hospital/miniprogram test` | 163 项通过，0 项失败，1302 个断言 |

重点代码位置：

- `packages/adapters/src/zhongyang-patients.ts`：档案包络、`patId` 字符串边界和卡片独立归属校验；
- `packages/adapters/src/zhongyang-appointments.ts`：预约渠道、状态、日期和重复记录校验；
- `packages/adapters/src/zhongyang-outpatient-payments.ts`：费用状态、金额、账单日期和稳定记录标识校验；
- `apps/api/src/modules/appointments/service.ts`：owner-scoped 映射、窗口和服务端二次投影；
- `apps/api/src/modules/outpatient-payments/index.ts`：费用查询状态门禁、患者引用复核和 30 日窗口；
- `apps/miniprogram/src/services/dashboard-service.ts`：小程序只发送内部患者标识和有限查询状态；
- `apps/miniprogram/src/services/appointment-record-view.ts`：预约状态展示和未开放渠道门禁。

## 4. 当前结论

代码层面没有发现可以在不猜测 Provider 合同的情况下安全修复的预约或门诊费用业务缺口。本轮不新增兼容字段、不把旧端的备用字段提升为真实字段、不开放 `requestChannel=4`，也不把 `patId` 猜成二维码 ID。

当前仍未完成的真实证据：

1. 有效微信会话下的真实患者同步及多就诊人切换；
2. 真实 Provider 预约历史与门诊费用的页面、HTTP trace、低敏日志三层闭环；
3. 报告目录/详情、预约写入、取消、支付、医保、退款、HIS 回写；
4. 医院确认后的二维码协议和真机扫码验收。

后续继续按“真实微信会话 → 患者显式选择 → 预约历史 → 门诊费用 → 报告”的顺序取证。任何一步出现字段、状态或患者归属不一致，应停止该业务域并回到 Provider 合同审计，不用兼容兜底掩盖问题。
