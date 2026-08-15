# Provider Contract v1

本文档记录重构阶段已经从旧项目源码和官方资料确认的 provider 边界。
它是 adapter 实现的输入，不是“已经接通生产 provider”的证明。

## 已确认的调用链

| 能力 | 旧项目证据 | 新仓库边界 | 当前状态 |
| --- | --- | --- | --- |
| 小程序登录 | `G:\\fuck\\hospital\\app\\api\\v1\\module_common\\...` 与 `wechat_util.py` | 公网 `/api/v2/auth/wechat` → 内部 `WechatIdentityGateway.exchangeCode` | adapter、平台会话和 v2 路由已实现；真实凭据、schema 和真机验收待完成 |
| 微信自费 JSAPI | `wechat_medical.py::_build_jsapi_order` | `WechatPaymentGateway.createJsapiOrder` | APIv3 adapter 已实现，默认未接入 |
| 医保费用上传 | `MbsFsiService.forward_6201` | `MedicalInsuranceGateway.uploadFees` | contract/金额校验已实现，密码 adapter 待实现 |
| 医保支付下单 | `MbsFsiService.forward_6202` | `MedicalInsuranceGateway.settle` | contract/金额校验已实现，密码 adapter 待实现 |
| 医保结算查询 | `MbsFsiService.forward_6301` | `MedicalInsuranceGateway.query` | contract/金额校验已实现，密码 adapter 待实现 |
| 医保退款/撤销 | `forward_6203` / `forward_6401` | `legacy-fsi-contract.ts` validators | contract 已拆分，退款状态 port 待补充 |
| HIS 回写 | 旧项目订单服务的回写调用 | `HospitalSettlementGateway.writeBack` | 待实现 |

Phase 7A 已建立众阳患者目录 adapter：

- 服务端调用旧小程序使用的 `/api/public/patientInfoByUnionId`，unionId 只能来自已落库的服务端身份；
- provider 响应只允许映射为 `providerPatientId`、脱敏姓名、规范化关系和脱敏卡号；手机号、身份证号、完整卡号和原始响应不会进入 domain；
- adapter 会统一注入 trace/idempotency headers，并把 provider 业务失败转换为不可伪装的 `ProviderRequestError`；
- provider 患者号已经通过 `hp_patients.provider_name/provider_patient_id` 做内部映射，生产组合根仍默认保持 not-configured；只有 `ZHONGYANG_PATIENT_DIRECTORY_READY=true`、服务端 HTTPS 地址完整且 provider 合同确认后才会注入患者 adapter。
- `ZHONGYANG_AUTHORIZATION_TOKEN` 是可选的服务端 secret，是否需要以及具体授权格式必须以众阳/HIS 合同确认；配置状态 configured 只代表字段完整，不代表真实请求成功。旧的 `ZHONGYANG_PATIENT_DIRECTORY_AUTHORIZATION_TOKEN` 仅作为迁移兼容变量读取。

报告 Phase 7C/7C-1 实现众阳 LIS/PACS/ECG 只读目录，以及独立 gate 下的 LIS 详情读模型：

- LIS 使用 `/msun-middle-business-lis/v1/lis-reports-filter`，影像使用 `/msun-middle-business-pacs/v1/exclude-privacy-patient-reports`，心电使用 `/msun-middle-business-ecg/v2/ecg-reports`；三者都由服务端从内部 `patientId` 解析 provider 患者号后调用；
- 目录 contract 只返回来源、报告摘要标题、报告时间、状态和是否有附件；详情 gate 打开后，目录可返回服务端生成的 opaque `reportId`，它只定位短期 MySQL 引用，不是 provider 报告号或 bearer token；
- LIS 详情使用 `/msun-middle-business-lis/v1/lis-reports/details`，服务端先按 owner 查询未过期引用，再把 provider 报告号留在 adapter 请求内；公开详情只返回检测项名称、结果、单位、参考范围、异常标记和附件存在性，不返回患者字段、provider 报告号、文件 URL 或原始 JSON；
- 旧体检接口 `/msun-peis-app-peis-new/v1/find-report-list-for-wechat` 依赖完整身份证号和院方 hospitalId，新患者模型不保存完整身份证，因此本阶段不迁移该接口；
- 报告解读、下载、门诊病历和体检报告仍需要单独的 provider 合同、资源授权和审计边界，不能由目录接口顺手开放；
- 报告目录使用独立的 `ZHONGYANG_REPORT_DIRECTORY_READY` gate，和患者/预约目录共享连接配置但分别验收；configured 只表示配置字段完整，不代表真实 provider 已联调。
- LIS 详情使用独立的 `ZHONGYANG_REPORT_DETAIL_READY` gate，并额外依赖 `0009_report_references`、owner 复合外键和 TTL 查询；configured 不代表真实 provider 资源授权或真机可用。

预约 Phase 7B 目前只实现众阳 AMC 的只读目录：

- `/msun-middle-business-amc-server/v1/schedulings/scheduling-depts` 映射为科室读模型；
- `/msun-middle-business-amc-server/v1/schedulings` 映射为排班、时间和号源数量读模型，服务端固定 `requestChannel=4`；
- 新 API 不返回挂号费、医生电话/照片、provider 原始字段，也不允许小程序透传任意 query；预约写入、锁号、取消和支付仍等待完整 contract。
- 预约目录使用独立的 `ZHONGYANG_APPOINTMENT_DIRECTORY_READY` gate；患者目录和预约目录共享连接配置，但必须分别完成合同与真实验收。

预约记录 Phase 7D 只实现历史记录只读摘要：

- 使用旧项目记录查询对应的 `/msun-middle-business-appointment-server/v1/appointment-infos/{pat-id}`，服务端固定 `requestChannel=3`、`isMzFlag=1` 和 `dateFlag=1`，日期范围由平台限制；provider 患者号只能来自服务端 mapping；
- 新 contract 只返回科室、医生、就诊日期/时间、地点、序号和规范化状态；`appointmentInfoId`、患者身份字段、电话、挂号费、支付状态、HIS 挂号号和 provider 原始字段全部丢弃；
- 旧项目的预约写入/取消请求仍未作为新 contract 依据，因为它们把 provider 患者号、完整身份信息、挂号费、结算方式和支付状态混在小程序 payload 中，且缺少当前 provider 的金额单位、幂等和状态回写证据；
- 记录使用独立的 `ZHONGYANG_APPOINTMENT_RECORDS_READY` gate，不会因 AMC 排班目录 gate 打开而隐式启用；默认组合根仍注入 fail-closed gateway。

预约写入、锁号、取消和挂号费的目标入口与证据门槛见
[appointment-write-contract-v1.md](appointment-write-contract-v1.md)。在 provider 合同、
金额单位、幂等/锁号生命周期和支付/HIS 回写顺序确认前，不注册写入 route，也不增加
`ZHONGYANG_APPOINTMENT_WRITE_READY` 配置开关。

## 设计不变量

1. 小程序只提交 `wx.login()` 产生的临时 `code`；`openid`、`session_key`、AppSecret 和商户私钥不能由客户端提交或接收。
2. 微信 code2session 返回的 `session_key` 只在 adapter 层短暂存在，不能进入 domain、日志、outbox、数据库业务事件或 API response。
3. provider 请求必须带 trace/idempotency 上下文；响应错误必须区分可重试和不可重试，不能把 HTTP 200 的业务错误当成功。
4. 微信 APIv3 自费下单使用 `/v3/pay/transactions/jsapi`，返回 `prepay_id` 后由后端生成小程序调起参数；前端支付回调不等于业务订单完成。
5. 6202 的 `feeSumamt`、`ownPayAmt`、`psnAcctPay`、`fundPay` 是医保混合支付金额的后端事实来源；不能让客户端金额覆盖已落库结算结果。
6. `/v3/med-ins/orders` 的权限、商户模式和 `channel_no` 必须以当前官方配置确认为准；不能因为旧项目曾经调用过就宣称新环境已授权。

## 本批实现范围

`packages/adapters/src/wechat-identity.ts` 只实现 code2session：

- 默认请求 `https://api.weixin.qq.com/sns/jscode2session`；
- 固定 `grant_type=authorization_code`；
- `40029` 等无效 code 不重试，`-1`/`45011` 分类为可重试；
- 缺少 `openid` 或配置不完整时 fail-closed；
- API 组合根只有在 `WECHAT_IDENTITY_READY=true` 时才注入它，默认仍使用 not-configured gateway。
- API 只有同时注入真实 MySQL identity repository 和 Redis session store 才把启动日志标记为
  `authRuntimeStatus=ready`；缺任一依赖时登录保持 503 fail-closed。

微信支付 APIv3 的 JSAPI 下单路径、请求签名和响应验签已单独实现，避免把身份、支付、回调和医保加密混成一个不可审计的 adapter。

Phase 5B-2 已实现 `packages/adapters/src/wechat-pay.ts`：

- `POST /v3/pay/transactions/jsapi` 使用 APIv3 RSA-SHA256 请求签名，body 通过 `bodyText` 保证签名字节与发送字节一致；
- 成功响应必须校验 `Wechatpay-Serial`、`Wechatpay-Timestamp`、`Wechatpay-Nonce` 和 `Wechatpay-Signature`，再读取 `prepay_id`；
- 后端用商户私钥生成小程序 `payParams`，小程序只负责调用支付 API，不自行拼装签名；
- 查单路径为 `/v3/pay/transactions/out-trade-no/{out_trade_no}?mchid={mchid}`，只把已验签的明确交易状态映射成内部状态，未知状态 fail-closed；
- 通知入口提供 APIv3 验签和 `AEAD_AES_256_GCM` 解密函数，解密后的 provider payload 仍需 callback mapper 白名单映射，不能直接迁移订单状态；

Phase 6B 已加入 `WechatPrepayService` 和 `POST /api/v1/payments/orders/:orderId/wechat-prepay`，Phase 6D 又加入对应的 GET 状态读模型：

- 服务端通过 `UserIdentityRepository.findByUserId` 读取当前会话对应的 provider subject，小程序不能提交 openid；
- 只有 `cash_pending` 且 `cashFen > 0` 的订单可以申请 JSAPI 预支付，金额来自已落库订单，不来自页面；
- 返回值只包含服务端生成的 `payParams`，不返回 provider 原始报文，不改变订单状态；
- 预支付闸门由 `WECHAT_PAYMENT_READY` 控制，默认关闭；真实环境还需要补齐通知入站、查单补偿和设备验收后，才能宣称支付链路完成。
- 预支付成功后，`prepay_id` 只保存摘要，`payParams` 只以 AES-256-GCM 密文保存；`PAYMENT_DATA_ENCRYPTION_KEY` 缺失时不得调用 provider。
- 同一幂等键可以通过 GET 读出 `not_started`、`pending`、`ready` 或 `unknown`；`unknown` 必须等待查单/人工对账，不能被小程序回调改写成支付成功。
- 单元测试使用进程内生成的 RSA/AES 材料，证明协议实现和失败分支，不证明商户号、证书、微信产品权限或公网回调已经可用。

Phase 6E-1 已加入 `POST /api/v1/payments/wechat/notifications`：

- 入站读取原始请求字节，先校验 `Wechatpay-*` 签名，再使用 APIv3 key 解密 `AEAD_AES_256_GCM`；APIv3 key 不得复用数据库 `PAYMENT_DATA_ENCRYPTION_KEY`。
- mapper 当前只接受 `TRANSACTION.SUCCESS`，并白名单提取 `out_trade_no`、`amount.total`、`transaction_id`；`appid/mchid` 配置存在时也必须匹配。
- `hp_wechat_payment_notifications` 以 `notification_id` 和 `provider_transaction_id` 去重，并与 `payment.wechat-notification.received` outbox 同事务写入。
- webhook ack 只表示“通知事实已接收/已去重”，不表示订单已进入 `cash_paid`；订单状态迁移属于后续 worker，仍需校验订单金额和版本。

Phase 6E-2/6E-3 已加入持久化驱动的查单补偿和通知消费核心：

- 预支付尝试记录 `queryAttempts`、`lastQueriedAt`、`nextQueryAt` 和数据库 claim lease；`FOR UPDATE SKIP LOCKED` 防止多副本重复领取，进程重启或 lease 过期后仍可恢复查单计划。
- 每次 claim 递增 attempt `version`，过期 worker 的结果会被版本条件更新拒绝，不能覆盖接管后的新结果。
- 查单 adapter 必须返回已验签的 provider 状态和 `amount.total`；应用层再次校验该金额等于订单 `cashFen`。
- `SUCCESS` 只有在金额一致且订单仍处于可迁移状态时才进入 `cash_paid`；金额不一致进入 `awaiting_confirmation`，不能自动成功。
- `PaymentReconciliationWorker` 只依赖 repository、domain service、gateway 和 Pino logger；通知 handler 只消费白名单事实并复用 domain reconciliation。
- `apps/worker` 的组合根和共享配置已实现“完整配置 + MySQL/schema 启动探针”才进入 provider 循环的 fail-closed 规则；真实商户配置运行、provider 回调联调和真机验收仍未完成。
- API/worker 启动日志只输出配置状态和缺失的环境变量名，不输出密钥、证书内容或签名材料；`configured` 仅表示字段完整，不代表 provider 已完成真实联调。
- 通知 outbox handler 只消费上述白名单事实，并复用同一订单 reconciliation service；它不重新解密、不读取原始 resource，也不把 HTTP ack 当成订单成功。

医保 5B-3 当前只实现 `legacy-fsi-contract.ts` 的纯规则层：固定五个专用 path、有限层级
响应展开、元转分、6201 明细守恒、6202/6301 结算金额守恒、6203 退款边界和 6401 明确成功。
5B-4 又增加了 `legacy-fsi-crypto.ts` 的严格 envelope port 和 fail-closed 默认实现，但
SM2/SM3/SM4 尚未发送真实请求；正式实现必须先取得 golden vectors，并通过 sidecar 或验证过的
Bun/Node 实现完成双向兼容测试。`MedicalInsuranceGateway.settle/query` 的 port 现在都要求
返回受限医保阶段、整数分金额和 trace；查单不能只返回状态，也不能把 6202/6301 的金额
权威性留给调用方猜测。6201 的 payToken 只能由 adapter/服务端内部安全边界持有，不能伪装成
客户端可用的 `feeUploadId`。

参考：[微信支付 JSAPI/小程序下单](https://pay.wechatpay.cn/doc/v3/merchant/4012791856)、[APIv3 请求签名规则](https://pay.wechatpay.cn/doc/v3/merchant/4012365336)。
