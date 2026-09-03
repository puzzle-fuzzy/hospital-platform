# miniprogram-pay 三个支付按钮业务说明

## 1. 页面进入后的公共流程

小程序只访问新版平台 API，地址为：

```text
https://test-hp.meiyi.pro/api/v2
```

页面加载后按以下顺序准备固定预约条件：

1. 建立新版平台会话：`POST /auth/wechat`（由 `ensureSession()` 负责，已有会话时复用）。
2. 读取当前用户的就诊人：`GET /patients`。
3. 读取预约科室：`GET /appointments/departments`。
4. 从服务端返回的目录中匹配“内科风湿”及已确认的 Provider 正式名称。
5. 读取固定日期的上午排班：

   ```text
   GET /appointments/schedules
   ?startDate=固定日期
   &endDate=固定日期
   &departmentId=服务端返回的科室引用
   ```

6. 读取该排班的分时段号源：

   ```text
   GET /appointments/schedules/{scheduleId}/sources
   ```

7. 如果配置了指定序号，就选择该序号；否则选择返回的第一个可用号源。

三个按钮在“没有就诊人、没有可用号源、正在处理、已有重复预约”时不可点击。
金额、Provider 患者号、Provider 排班号和 Provider 号源号都不由小程序提交。

## 2. 医保支付

### 2.1 首次点击

点击“医保支付”后，先完成预约写入，再进入医保授权和结算：

| 顺序 | 小程序调用的新版平台接口 | 服务端实际业务 |
| --- | --- | --- |
| 1 | `POST /appointments/holds` | 校验当前用户、就诊人和排班快照；读取众阳号源 `2.10.3.2`，调用众阳号源锁定 `2.10.3.3`，再查询实际挂号费 `2.10.3.8`，保存短期 hold |
| 2 | `POST /appointments/registrations` | 先查询当天已有预约；没有重复预约时调用众阳执行预约 `2.10.4.1`，保存平台预约事实 |
| 3 | 无网络接口 | 调用 `wx.navigateToMiniProgram` 跳转医保授权小程序，用户完成授权后返回 `authCode` |
| 4 | `POST /payments/medical-insurance/authorize` | 服务端使用 `authCode` 发起医保授权，创建医保订单 |
| 5 | `POST /payments/medical-insurance/orders/{orderId}/fees` | 服务端调用医保 6201 上传真实费用明细、参保/授权关联信息 |
| 6 | `POST /payments/medical-insurance/orders/{orderId}/settle` | 服务端调用医保 6202 发起结算 |
| 7 | `GET /payments/medical-insurance/orders/{orderId}` | 结算未完成时查询医保 6301，直到得到明确终态 |

医保授权跳转使用配置中的医保小程序 AppID 和机构参数。授权码只在服务端授权接口中使用，
不会写入小程序本地存储或服务端日志。

### 2.2 结算分支

- `insurance_settled`：医保全额结算完成，清除待支付上下文，显示成功。
- `cash_pending`：纯医保按钮停止，不会偷偷改成混合支付；页面提示改选“医保混合支付”。
- `failed` 或 `manual_review`：停止流程，提示查看后台订单日志；不重新预约。
- 结算仍处理中：保留待支付上下文，用户之后继续医保支付；不会重新挂号。

## 3. 医保混合支付

医保混合支付前半段与“医保支付”完全相同：

```text
占用号源
  -> 写入预约
  -> 医保小程序授权
  -> 医保授权
  -> 6201 上传费用
  -> 6202 医保结算
```

当 6202 返回 `cash_pending` 时，继续执行：

| 顺序 | 调用 | 作用 |
| --- | --- | --- |
| 1 | `POST /payments/medical-insurance/orders/{orderId}/wechat-pay` | 服务端根据 6202 返回的真实自费金额创建医保混合支付单，返回微信医保支付参数 |
| 2 | `wx.requestMedicalInsurancePay(...)` | 调起微信医保混合支付收银台 |
| 3 | `GET /payments/medical-insurance/orders/{orderId}/wechat-pay` | 服务端查混合支付结果，校验现金支付和医保支付状态 |
| 4 | 服务端医保后置查询 | 两部分都明确成功后，再调用医保 6301/后置结算处理，确认最终医保订单状态 |

只有服务端确认医保和现金两部分都完成，页面才显示“挂号和医保支付成功”。
`wx.requestMedicalInsurancePay` 的成功回调本身不代表业务完成。

## 4. 自费支付

自费支付不跳转医保授权，也不调用 6201、6202、6301：

| 顺序 | 小程序调用的新版平台接口 | 服务端实际业务 |
| --- | --- | --- |
| 1 | `POST /appointments/holds` | 与其它支付方式相同，服务端重新锁定众阳号源并读取挂号费 |
| 2 | `POST /appointments/registrations` | 与其它支付方式相同，服务端检查重复预约后调用众阳 `2.10.4.1` |
| 3 | `POST /payments/appointments/{appointmentId}/self-pay` | 服务端读取已保存的预约金额，创建现金待支付订单，并通过微信支付 APIv3 创建 JSAPI 预支付单 |
| 4 | `wx.requestPayment(...)` | 调起普通微信支付收银台 |
| 5 | `GET /payments/appointments/{appointmentId}/self-pay` | 服务端调用微信支付查单，只有明确 `SUCCESS` 才将平台订单置为 `cash_paid` |

普通自费预支付由服务端调用微信：

```text
POST /v3/pay/transactions/jsapi
```

金额来自服务端已保存的预约事实，小程序不能提交或修改金额。当前没有使用门户中分类不匹配的
`2.6.65.*` 接口来伪造门诊自费 HIS 终结链路。

## 5. 已有待支付上下文时的处理

用户取消授权或取消微信支付时，预约不会被取消，页面会保留待支付上下文：

| 待支付阶段 | 允许继续点击 | 行为 |
| --- | --- | --- |
| 医保授权中 | 医保支付、医保混合支付 | 重新跳转医保授权，不重新预约 |
| 医保结算产生自费金额 | 仅医保混合支付 | 继续创建/查询混合支付，不重新预约 |
| 微信医保混合支付中 | 仅医保混合支付 | 继续混合支付和服务端查单，不重新预约 |
| 微信自费支付中 | 仅自费支付 | 继续自费预支付和微信查单，不重新预约 |

用户点击其它支付方式时，页面只提示当前订单必须继续原支付分支，不会切换订单类型。

## 6. 已有预约、取消后重挂

写入预约前，服务端会调用众阳预约记录查询：

```text
GET /msun-middle-business-appointment-server/v1/appointment-infos/{patId}
requestChannel=3
startDate=预约日期
endDate=预约日期
isMzFlag=1
dateFlag=1
```

如果发现同一就诊人当天已有同门诊预约：

1. 不再调用众阳执行预约接口。
2. 页面显示“该就诊人当天已有同门诊预约”。
3. 用户确认“取消后重新挂号”后，调用平台：

   ```text
   POST /appointments/registrations/{appointmentId}/cancel
   ```

4. 服务端校验预约归属和医保订单状态，然后调用众阳取消预约 `2.10.4.3`：

   ```text
   POST /msun-middle-business-appointment-server/v1/appointment-infos/d
   ```

5. 只有取消成功后，才重新执行“锁号 → 查费 → 执行预约 → 原支付方式”的流程。

取消失败时，页面保留原预约信息，不会误显示成“没有重复预约”。如果该预约已有有效的医保支付或结算事实，
服务端会拒绝取消，避免形成无法对账的半成品订单。

## 7. 服务端日志

所有关键日志写在 API 服务端，不依赖小程序控制台：

- 预约 hold 日志关联号源读取、号源锁定和实际费用查询的众阳请求号。
- 预约写入日志关联重复预约查询和执行预约请求号。
- 取消完成日志关联众阳取消请求号。
- 医保授权、6201、6202、6301、医保混合支付和微信查单分别记录业务阶段和请求号。
- 不记录 `authCode`、openid、支付签名、prepay_id、完整卡号、身份证号、手机号或 Provider 原始响应。

最终业务成功只由服务端确认的医保/微信终态决定，不由小程序按钮回调决定。
