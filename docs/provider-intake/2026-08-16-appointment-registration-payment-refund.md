# Provider 文档接收记录：挂号登记、支付挂号与外部退款

> 接收日期：2026-08-16（Asia/Shanghai）
> 当前状态：`normalized`（已标准化，未确认、未实现、未开放）
> 适用原则：本记录只登记 Provider 文档中已经出现的事实，不把旧页面参数、示例值或推测写成新平台 contract。

## 1. 接收范围与证据指纹

原始文件来自旧项目工作区 `G:\\fuck\\hospital\\hospital-app\\docs`。原始 HTML 保留在旧工作区，
没有复制到新仓库；原因是示例中包含患者、设备或 Provider 环境信息，不能把未脱敏原文带入 Git。
以下只记录文件元数据和 SHA-256，便于后续重新核对来源。

| documentId | 原始文件 | 大小 | 原始更新时间 | SHA-256 | 状态 |
| --- | --- | ---: | --- | --- | --- |
| `zhongyang-registration-2.6.7-20260813` | `2.6.7. 挂号登记.html` | 184759 bytes | 2026-08-13 15:15:51 | `D0CDAA022BFF643EAD0E7EC2DF7FE5E06F918AA8A1528FD2800DBE7CC749CC15` | `normalized` |
| `zhongyang-appointment-payment-2.10.4.2-20260814` | `2.10.4.2. 支付挂号接口.html` | 119510 bytes | 2026-08-14 11:14:21 | `BFEE2FC8AD72833FB7E82762C615A619B26981246BC5ED06992607D4C4A733FA` | `normalized` |
| `zhongyang-external-refund-2.6.65.7-20260813` | `2.6.65.7.退款（外部系统提供接口）.html` | 107813 bytes | 2026-08-13 09:11:15 | `32B1BFBE004B2704029FFA94C58EBA13575C7D6E69D5609A9F4E9E777B7B4D2D` | `normalized` |

文档没有同时提供确认人、适用环境、鉴权方式、超时/重试策略、完整错误码和可回放的脱敏成功/失败样例。
因此本记录不是生产授权证明，也不是 Provider 可用性证明。

## 2. 已确认的接口事实

### 2.1 2.6.7 挂号登记

| 项目 | 文档事实 |
| --- | --- |
| method/path | `POST /msun-middle-open-settlepay/v1/registers` |
| 编码 | `application/json` |
| 文档目的 | 选择医生和号源后创建正式 HIS 挂号记录，生成挂号流水并锁定号源；这是写入型接口 |
| 关键患者字段 | `patId`、`patCardNo`、`patName`，均来自 Provider 患者档案接口 |
| 关键号源字段 | `schedulingId`、`serialNumber`、`sequence`、`registrationDate`，预约挂号场景条件必填 |
| 机构字段 | `hospitalId`、`deptId`、`deptName`，以及可选的 `docId`、`docName` |
| 渠道字段 | `authSysCode`、`workStationId`、`registerSource`；文档列出 `1/2/7` 等来源值 |
| 收费分支 | `freeFlag`、`chargeStatus`；文档说明未缴费登记可使用 `chargeStatus=4`，支付挂号场景可能需要后续 2.6.8 |
| 响应 envelope | 根节点至少包含 `code`、`message`、`data`；`data` 含 `registerId`、`registerCode`、`registerStatus`、`chargeStatus`、`amount`、`getAmount` 等字段 |

必须特别注意：文档列出了 `registerStatus` 和 `chargeStatus`，但没有给出完整枚举、终态定义、重复请求语义或超时后的查单方式。
`amount`、`expenseAmount`、`getAmount`、`preferentialAmount`、`ascendAmount` 的数值单位和精度也没有冻结。
`getAmount` 只确认了公式“应收金额 = 商品金额 - 优惠金额 + 加收金额”，不能据此推断人民币元/分或支付最终金额。

### 2.2 2.10.4.2 支付挂号接口

| 项目 | 文档事实 |
| --- | --- |
| method/path | `POST /msun-middle-business-appointment-server/v1/appointment-infos/registrations` |
| 编码 | `application/json` |
| 前置依赖 | 文档明确依赖 2.10.4.1 执行预约接口产生的 `appointmentInfoId` |
| 患者字段 | `patId`、`patName`、`patCardNo`；还列出可选敏感字段 `idcardNo` |
| 金额字段 | `registrationFee`、`surcharge`、`balancePay`；均为数值，但未确认单位、精度和总额守恒规则 |
| 支付事实 | `payOrderNo`、`payState`、`payTime`、`payType`、可选 `transactionId` |
| `payState` | `0` 未支付；`1` 已支付；`2` 支付失败；`3` 支付成功、院内处理中；`4` 院内处理失败（原文存在“理失败”疑似笔误）；`5` 已退款 |
| 渠道字段 | `requestChannel` 文档举例微信为 `3`、自助机为 `4`，但生产渠道码仍需确认 |
| 响应字段 | `appointmentInfoId`、`hisRegisterId`、`outSettleMainId`、`outInvoiceMainId` |

`payState=1`、`payState=3` 和接口响应成功不能直接等价为“预约已完成”。文档把“支付成功、院内处理中”单独列为 `3`，
说明支付事实与院内挂号最终事实必须分开落库和展示；但最终状态查询、重复提交和 `payState=4` 的补偿路径尚未提供。

### 2.3 2.6.65.7 外部系统退款

| 项目 | 文档事实 |
| --- | --- |
| method/path | `POST /ReFund/Api/MYDService/ThirdpartyCardRefund` |
| 文档角色 | “外部系统提供接口”；文档描述为众阳在收费退款时调用外部系统 |
| 业务范围 | 住院处/住院结算，`tradeType` 同时列出了门诊挂号、预约挂号等多种业务类型 |
| 必填输入 | 患者/订单/退款号、退款金额、支付方式、收费员、设备 IP/MAC、账务日期、医院和机构标识 |
| `tradeType` | 文档列出 `1/2/3/5/7/9/10/25/34` 等业务编码；其中 `10` 为预约挂号 |
| 响应字段 | `refundNo`、`payTypeId`、`refundAmount`、`result`、`thirdRefundNo` |
| `result` | `0` 成功；`1` 失败；`2` 质疑/未知；`thirdRefundNo` 供 2.6.65.8 退款结果查询使用 |

这份文档不能证明新 Elysia 应该主动调用该地址，还是应该实现一个由 Provider 调入的新地址。
在调用方向、鉴权、退款查单 2.6.65.8、未知结果处理和金额单位明确前，不得实现退款 adapter 或患者端退款按钮。

## 3. 依赖缺口矩阵

本次在旧项目文档目录中只找到本记录第 1 节的 3 份文件；以下依赖没有随文档到达，故不能把本次材料视为完整流程。

| 依赖 | 被谁引用 | 当前缺口 | 未补齐前的处理 |
| --- | --- | --- | --- |
| 2.10.4.1 执行预约接口 | 2.10.4.2 支付挂号 | 预约创建请求、响应、幂等、最终状态、失败语义 | 不开放预约写入和支付挂号 |
| 2.10.2.2 医生排班 | 2.6.7 挂号登记 | `deptId`、`docId`、挂号类别和号源上下文来源 | 只读排班不能作为写入授权 |
| 2.10.2.3 号源查询 | 2.6.7 挂号登记 | `serialNumber`、`sequence`、`registrationDate` 的生命周期和并发语义 | 不提交客户端号源字段 |
| 2.1.3 / 2.1.53 患者档案 | 2.6.7、2.10.4.2 | Provider `patId`、卡号和档案归属映射 | 只允许服务端 owner-scoped 映射 |
| 2.6.8 支付挂号 | 2.6.7 | 登记后支付的金额、订单和状态更新顺序 | 不把登记响应当支付成功 |
| 2.6.65.8 退款结果查询 | 2.6.65.7 | `result=2` 的最终确认和 `thirdRefundNo` 查单语义 | 未知退款进入待确认，不自动重试或宣称失败 |

## 4. 尚未冻结的业务问题

以下问题必须由 Provider 文档、脱敏 fixture 或明确的联调确认回答。它们不是实现细节，而是会改变数据模型、状态机和用户提示的业务事实。

| 编号 | 必须确认的事实 | 错误实现的后果 |
| --- | --- | --- |
| AR-01 | 每个接口的鉴权/签名/证书、环境地址、超时和限流规则 | 密钥暴露、生产调用失败或错误重试 |
| AR-02 | HTTP 成功与业务 `code`/`success` 的联合成功条件 | 把业务失败当成功写入 |
| AR-03 | `registerStatus`、`chargeStatus` 完整枚举及终态 | 前端错误显示已挂号或已收费 |
| AR-04 | 挂号登记、执行预约和支付挂号的先后关系及事务边界 | 产生“已扣款但无院内挂号”或重复挂号 |
| AR-05 | 锁号 TTL、释放接口、并发冲突和重复请求结果 | 号源泄漏、超卖或重复扣费 |
| AR-06 | 所有金额字段的单位、精度、舍入和 `registrationFee + surcharge - balancePay` 关系 | 金额不守恒或支付金额错误 |
| AR-07 | 超时、连接断开、Provider 处理中时的最终查单接口 | 网络抖动导致重复提交或误退款 |
| AR-08 | `requestChannel`、`authSysCode`、`registerSource` 的生产配置值 | 渠道权限拒绝或流量进入错误业务 |
| AR-09 | `patId`、`patCardNo` 与新平台 `patientId` 的 owner-scoped 映射和失效策略 | 错患者挂号或越权读取 |
| AR-10 | 取消窗口、已支付预约的撤销/退款/HIS 回写顺序 | 取消后仍占号或退款与院内状态不一致 |
| AR-11 | 退款接口的调用方向、鉴权、`result=2` 查单和重复退款幂等 | 重复退款或将未知退款当失败 |
| AR-12 | 退款 `billDate` 格式、设备 IP/MAC 是否仍必需及隐私日志规则 | 请求拒绝或设备/患者敏感信息泄露 |

## 5. 新平台冻结决策

在 AR-01 至 AR-12 和第 3 节依赖缺口补齐前：

- 不注册 `POST /api/v2/appointments/holds`、`POST /api/v2/appointments` 或取消接口；
- 不注册 Provider 挂号登记、支付挂号、退款的公共或内部真实 adapter；
- 不新增预约写入、支付挂号或退款 migration、outbox、worker 状态表；
- 不让小程序提交 `patId`、`patCardNo`、`idcardNo`、金额、`payState`、`registerStatus` 或退款结果；
- 不打开微信支付、医保、HIS 回写或退款 gate；
- 继续允许只读预约目录、预约历史和门诊费用目录按现有 contract 运行，但不把只读目录视为写入授权。

本记录状态保持 `normalized`。它只证明“已经收到并解析了文档”，不证明接口权限、网络可达、业务可用或真机可验收。

## 6. 下一步执行顺序

1. 补齐第 3 节列出的前置文档和 2.6.65.8 退款结果查询文档。
2. 由 Provider/院方确认 AR-01 至 AR-12，取得脱敏成功、空结果、业务失败、重复请求、超时后查单和未知状态样例。
3. 按“排班/号源快照 → 锁号 → 执行预约 → 预约查询/取消 → 挂号登记/支付状态 → 退款/查单”的边界拆分 versioned contract；不能把多个 path 合成万能调用。
4. 先实现 domain 状态机和金额不变量测试，再实现 adapter 白名单、持久化幂等和补偿 worker；患者 API 与小程序最后接入。
5. 每个 Provider 调用只记录 `requestId`、`traceId`、低敏 operation、provider request id、HTTP/业务状态和重试判断；禁止记录 Authorization、身份证、卡号、原始报文、支付签名和设备敏感值。
6. 通过内网受控请求、候选 API、公网 HTTPS、开发者工具和真机逐层验收后，才允许把状态从 `normalized` 升级为 `confirmed`，并打开对应 gate。

关联文档：

- [`../provider-document-intake.md`](../provider-document-intake.md)
- [`../provider-contract-template.md`](../provider-contract-template.md)
- [`../appointment-write-contract-v1.md`](../appointment-write-contract-v1.md)
- [`../migration/payment-contract.md`](../migration/payment-contract.md)
- [`../migration/remaining-migration-inventory.md`](../migration/remaining-migration-inventory.md)
