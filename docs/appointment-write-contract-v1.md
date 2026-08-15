# 预约写入目标合同 v1

## 状态

**Blocked by provider contract evidence；当前不开放 API、不注入真实 adapter。**

本文档用于把旧项目已经观察到的调用事实，与新平台真正允许实现的写入边界分开。
旧项目源码只能证明某些请求曾经被页面发起，不能证明当前医院环境仍接受这些字段，
也不能证明金额、幂等、锁号、取消或支付回写语义已经稳定。

## 已观察到的旧调用事实

| 能力 | 旧项目 endpoint | 旧页面/模块传递的关键事实 | 新项目结论 |
| --- | --- | --- | --- |
| 号源锁定 | `POST /msun-middle-business-amc-server/v1/sources/locked-sources` | 页面可取得 `hisScheduleId`、`sourceId`、序号和时间 | 需要独立确认锁定 TTL、释放方式和重复锁定语义 |
| 实际挂号费 | `GET /msun-middle-business-appointment-server/v1/appointment-infos/fact-register-fee` | 页面展示 `registrationFee`/`fee` | 不能把页面金额或旧接口数字直接当人民币分 |
| 执行预约 | `POST /msun-middle-business-appointment-server/v1/appointment-infos` | `patId`、姓名、卡号、身份证、电话、排班/号源、挂号费、`registerSource`、`settleWay`、`isPay`、`recordId` | 必须由服务端身份、排班快照、报价和幂等事实重新编排 |
| 取消预约 | `POST /msun-middle-business-appointment-server/v1/appointment-infos/d` | `requestChannel`、`appointmentInfoId`、`patId` | 必须由服务端保存的预约映射和当前用户归属发起 |
| 预约历史 | `GET /msun-middle-business-appointment-server/v1/appointment-infos/{pat-id}` | `requestChannel=3`、日期范围、`isMzFlag=1`、`dateFlag=1` | 已作为只读摘要迁移，写入不能复用历史查询 contract |

旧页面还会把 `appointmentInfoId`、`registerId`、`hisRegisterId`、支付订单号和患者身份
拼接进页面跳转参数。这些字段均不能进入新小程序 URL、API response、日志或客户端状态。

## 旧证据无法证明的事项

以下事项在获得 provider 书面合同、脱敏 fixture 或授权 staging 回放前，均视为未知：

1. `hisScheduleId`、`sourceId`、`patId`、`recordId` 的当前格式、长度和生命周期；
2. `requestChannel="my"`、数字渠道码 `3/4` 的当前含义，以及 `registerSource=15`、`settleWay=6`
   是否仍适用于当前商户和医保流程；
3. 挂号费字段的单位、精度、是否含附加费、实际费用查询与锁号之间的时序；
4. 锁号成功后的保留时长、并发冲突、释放/过期机制和重复请求结果；
5. 执行预约接口的幂等键、超时后的最终状态查询、业务失败与 HTTP 200 的区分；
6. 取消窗口、已支付预约的退款/撤销规则、取消后的 HIS 回写和重试语义；
7. 预约写入与医保 6201/6202、微信支付、HIS 挂号回写之间的事务边界和补偿顺序。

## 新平台目标入口（提案，不是已实现 API）

小程序只提交平台资源引用和用户意图，不能提交 provider 身份、金额或支付状态：

```text
POST /api/v1/appointments/holds
Authorization: Bearer <platform-session>
Idempotency-Key: <client-generated-key>
{
  "patientId": "internal-patient-id",
  "scheduleId": "platform-schedule-reference",
  "sourceId": "platform-source-reference"
}
```

```text
POST /api/v1/appointments
Authorization: Bearer <platform-session>
Idempotency-Key: <client-generated-key>
{
  "patientId": "internal-patient-id",
  "holdId": "internal-hold-id"
}
```

```text
POST /api/v1/appointments/:appointmentId/cancel
Authorization: Bearer <platform-session>
Idempotency-Key: <client-generated-key>
```

上面的资源名和字段是平台方向性合同，provider 映射仍需由 adapter 根据真实合同实现。
服务端必须在每次写入前校验：当前会话拥有 `patientId`、排班/号源引用来自服务端可验证的
目录快照、锁定未过期、幂等键没有 payload 冲突，并且写入目标仍允许当前状态迁移。

当前只读排班 adapter 将 provider 的 `hisScheduleId`、`deptId` 和 `docId` 映射成读模型
引用，这些值目前只允许用于展示和查询筛选，不能直接成为写入授权。真正开放写入前，必须
补上服务端排班快照/引用映射（或经过密钥保护的不可伪造引用）以及过期校验；不能因为读接口
返回了一个 `scheduleId` 就把它当成可信的预约指令。

## 明确禁止从小程序提交的字段

```text
provider patient id / patId
patName / patCardNo / idcardNo / telephone
registrationFee / registFree / fee
isPay / payOrderNo / settleWay / registerSource
appointmentInfoId / registerId / hisRegisterId
HIS 完成状态、医保基金金额、现金金额或 provider 原始 JSON
```

患者姓名、卡号、身份证和手机号由服务端已绑定身份/患者映射取得；金额必须来自服务端
报价或 provider 真实返回；支付成功必须来自已验签通知、查单和订单状态迁移，不能来自页面
调起回调或 `isPay` 字段。

## 目标状态机

```text
available
  -> hold_pending
  -> held
  -> booking_pending
  -> booked
  -> cancellation_pending
  -> cancelled
```

任何 provider 超时、重复请求、响应缺少关键字段或无法确定最终结果的情况进入
`awaiting_confirmation`，由查询/人工对账/补偿任务推进；不能因为 HTTP 200 或本地页面状态
直接判定成功，也不能在未知状态下自动取消或退款。

## 实现前必须取得的证据

- 当前 provider 的锁号、实际费用、执行预约、预约查询、详情和取消接口合同；
- 脱敏的成功、业务失败、字段缺失、重复请求、超时后查询和并发冲突 fixture；
- `sourceId`/排班引用的生命周期、幂等键和锁号 TTL；
- 费用单位、金额守恒规则和支付/医保/HIS 的时序图；
- 取消、退款、撤销和 HIS 回写的状态矩阵；
- provider request id、trace、错误分类和敏感字段脱敏验收样例。

只有上述证据完成后，才新增 `ZHONGYANG_APPOINTMENT_WRITE_READY` gate、domain command、
持久化预约事实、outbox 事件和真实 adapter。当前仓库继续保持写入、锁号、取消和挂号费
接口未注册，避免把旧页面 payload 重新包装成看似安全但无法维护的 API。
