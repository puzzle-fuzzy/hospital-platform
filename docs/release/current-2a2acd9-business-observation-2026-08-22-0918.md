# `2a2acd9` 线上只读业务观察（2026-08-22 09:18 CST）

> 本记录只保存新 API 的低敏运行聚合，不把日志窗口中的事件归因成真机成功。
> 真机验收仍必须同时提供手机页面、客户端公共 requestId 和服务端同链 trace；旧 Python 服务保持只读边界。

## 1. 运行边界

| 项目 | 观察结果 |
| --- | --- |
| 当前服务端 release | `2a2acd9bcc89c35988b75fc03304dbd48078c9d5` |
| 新 API | `hospital-platform-api-v2.service=active`，监听 `10.0.0.3:18081` |
| 旧 Python | 继续监听 `0.0.0.0:8001`，本次未修改、未停止、未重启 |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 观察窗口 | 服务器当前时间起向前约 2 小时 |
| 日志解析 | 未发现 `parse`、`fatal` 或 `uncaught` 关键词 |

## 2. 低敏事件聚合

| 业务事件 | 次数 |
| --- | ---: |
| `auth.wechat.login.succeeded` | 1 |
| `patient.directory.read.loaded` | 9 |
| `patient.directory.synced` | 3 |
| `appointment.directory.departments.requested` | 2 |
| `appointment.directory.schedules.requested` | 2 |
| `appointment.records.requested` | 1 |
| `appointment.records.synced` | 1 |
| `outpatient.payment.records.requested/loaded` | 0 |

同一窗口的 HTTP 完成聚合为 `200=42`、`401=9`、`404=10`；包含
`providerRequestId` 字段的日志条目为 14。这里仅用于判断下一步观察方向，不记录
Provider 患者号、费用、预约号、姓名、身份证、手机号、token 或原始响应。

## 3. 当前结论

1. 新 API 与旧 Python 共存边界仍然成立，当前不需要为真机验收重启或修改旧服务。
2. 微信身份、患者目录和预约历史已经在当前 release 的线上日志中出现；但没有手机页面截图和客户端 requestId，不能据此完成真机三层验收。
3. 当前窗口没有门诊费用请求，因此门诊费用只读仍未取得 Provider/客户端/页面三层证据。
4. 旧端门诊缴费页面包含支付、医保、结算和详情写入/跳转逻辑；新端继续只开放已确认字段的只读列表。任何待缴卡片点击只能提示“支付流程迁移中”，不得调用 `wx.requestPayment`、医保授权或 HIS 写回。

## 4. 下一步动作

使用当前 `b0e0935` 小程序运行包重新扫码后，按以下顺序操作并记录低敏证据：

1. 登录后明确选择就诊人；
2. 进入“我的挂号”和“爽约记录”，保存页面结果及公共 requestId；
3. 进入“门诊缴费”，分别打开“待缴费”和“已缴费”，只观察列表、空态或明确错误；
4. 回到选择就诊人页面切换另一位患者，再重复第 2、3 步，确认旧费用/预约列表不会回写；
5. 若任一请求返回 `401`、患者映射缺失、Provider 响应非法或同链不一致，停止当前业务，不进入支付/医保。

## 5. 证据边界

本记录属于线上低敏运行观察，不能替代：

- 真机页面截图或人工页面结果；
- 客户端公共 requestId 与页面动作的对应关系；
- 服务端 `requested → synced/failed → http.completed` 的同链核对；
- Provider 返回字段与当前合同的逐字段核验。

