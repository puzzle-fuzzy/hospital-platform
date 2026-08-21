# 当前新旧服务运行观察（2026-08-22）

## 结论

本次只读观察确认新旧服务继续共存，但从 `2026-08-21 23:53:00 CST` 到
`2026-08-22 00:07:25 CST` 没有新的应用业务请求。当前没有足够的微信、患者、预约、
门诊费用或 Provider 日志证据可以替代真机验收；本次不修改旧 Python 服务，不重启旧
服务，不启动 Worker，不执行数据库迁移，也不调用支付、医保或 HIS 写回。

## 1. 运行层快照

| 检查项 | 结果 |
| --- | --- |
| 新 API | `hospital-platform-api-v2.service=active` |
| Worker | `hospital-platform-worker-v2.service=inactive` |
| 旧 Python API | 继续保留在 `8001`，本次未触碰 |
| 观察窗口 | `2026-08-21 23:53:00` 至 `2026-08-22 00:07:25 CST` |
| 日志输入 | `inputLines=1`、`parsedRecords=0`、`parseErrors=0`、`ignoredBlankLines=1` |
| 业务事件 | 无；`eventCounts={}`、`domainCounts={}` |
| HTTP 事件 | 无；`httpStatusCounts={}` |
| Provider 请求号 | `providerRequestIdCount=0` |
| systemd warning | `0` |

日志只通过服务器上的低敏聚合器读取；没有输出原始日志、token、openid、患者标识、
请求体或 Provider 报文。

## 2. 当前候选与真机入口

当前新小程序候选运行包来源为 `13b86a5a400ca0ccbee67abdfed726476a4749d4`，
构建目录为 `apps/miniprogram/dist/`。该运行包已通过 `runtime:verify`，注册的 14 个
页面均有对应 JavaScript 文件，且 `*.test.js`、`*.spec.js` 均为零。

如果开发者工具仍请求 `dist/services/single-flight.test.js`，应将其视为旧增量模块索引：

1. 停止旧真机调试并关闭当前新项目窗口；
2. 执行 `pnpm --filter @hospital/miniprogram build` 和
   `pnpm --filter @hospital/miniprogram runtime:verify`；
3. 重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram`，普通编译；
4. 重新生成二维码并使用受控微信账号扫码。

不得把测试脚本复制进 `dist/`，也不得打开旧的 `G:\fuck\hospital\hospital-app` 项目
替代当前候选。

## 3. 下一条业务验收顺序

扫码后必须使用同一会话、同一候选和服务端低敏日志逐步取证：

1. `wx.login`、`/auth/wechat`、`/me`：确认新服务会话恢复；
2. 首页患者目录与选择页：明确点击另一位患者，确认 owner、内部 `patientId` 和展示卡片
   始终来自同一份服务端目录；
3. “我的挂号”和爽约记录：确认患者上下文门禁、日期窗口和只读状态；
4. 门诊缴费待缴/已缴：只验证费用读模型、金额边界和 Provider 请求链，不调起支付；
5. “我的 → 个人资料”：验证首次读取、一次成功更新和旧版本 `409`，不提交实名身份或
   临床患者字段。

每一步都要同时保留页面结果、HTTP 状态/requestId、服务端事件和 Provider request id。
若出现会话失效、患者映射冲突、Provider 拒绝、数据服务暂时不可用或页面与日志不一致，
立即停止该业务域验收，不能把异常降级为空列表或成功提示。

## 4. 明确后置边界

预约写入、锁号、取消、现金/微信支付、医保授权与结算、退款、HIS 回写、患者新增绑卡、
二维码真实协议、病历目录和报告附件仍然没有足够的正式合同或真实证据。本观察不会因服务
处于 active 就改变这些 gate 的状态。
