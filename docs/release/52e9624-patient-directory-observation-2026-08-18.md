# 52e9624 患者目录业务观察（2026-08-18）

## 1. 观察范围

本记录只覆盖生产 release `52e9624` 自服务启动后、从 `2026-08-18 01:31:00 CST`
开始的 journald 低敏聚合。服务器使用当前 release 自带的
`apps/worker/dist/p0-log-aggregate.js` 生成 JSON，再使用同一 release 的
`p0-business-evidence-audit.js` 做业务域门禁。

不读取或保存微信 code、Bearer token、openid、患者标识、完整卡号、姓名、金额或 Provider 原始报文。

## 2. 运行时边界

| 项目 | 结果 |
| --- | --- |
| 当前 release | `/home/ps/code/hospital-platform/releases/52e9624` |
| 新 API | `hospital-platform-api-v2.service`，active，`10.0.0.3:18081` |
| 旧 Python API | 继续监听 `8001`，未停止、未替换 |
| 日志解析 | `parseErrors=0` |
| HTTP 完成事件 | 11 次，全部为 `200` |
| trace 数量 | 11 |
| Provider request id 数量 | 2 |

## 3. 业务证据

| 业务域 | 请求事件 | 明确成功事件 | 失败事件 | 门禁结论 |
| --- | ---: | ---: | ---: | --- |
| 患者目录同步 `patientSync` | 2 | 2 | 0 | 通过 |
| 患者目录读取 `patientRead` | 4 | 4 | 0 | 通过 |
| 微信登录 | 0 | 0 | 0 | 未触发 |
| 我的挂号 | 0 | 0 | 0 | 未触发 |
| 门诊费用 | 0 | 0 | 0 | 未触发 |

患者目录同步和读取门禁的 JSON 结果均为 `passed=true`，且 `parseErrors=0`。这证明当前 release
确实执行过患者目录只读链路，但不证明：

- 当前会话对应的页面一定展示了正确患者；
- Provider 返回了多位患者；
- 显式切换、失效回收和恢复行为已经验收；
- “我的挂号”未来预约窗口、状态归一化或门诊费用状态已经验收。

## 4. 下一步执行顺序

使用与当前 `52e9624` 源码构建的微信小程序运行包，在有效微信会话中继续执行：

1. 进入患者选择页，刷新目录并记录脱敏后的患者数量；
2. 如果存在两位或以上患者，显式选择患者 A，再选择患者 B；
3. 进入“我的挂号”，触发 `appointment.records.requested` → `appointment.records.synced`；
4. 进入“爽约记录”，确认只显示服务端归一化的 `missed`；
5. 进入门诊缴费，分别触发 `unpaid` 和 `paid` 只读查询；
6. 以页面结果、HTTP request/trace id 和同一时间窗口的低敏 journald 三层证据交叉记录。

如果第 3 步出现 Provider 字段错误、患者归属错误、`persistence-temporarily-unavailable` 或
状态/日期不一致，立即停止预约历史验收，保持当前只读 gate，不降级为空列表，也不打开预约写入。

## 5. 当前结论

本记录将当前 release 的患者目录同步/读取推进为“已有真实运行证据”；“我的挂号”、门诊费用、
报告真实业务、普通资料写入、预约写入、支付、医保、退款和 HIS 回写仍未验收。

下一次产生业务事件后，应在本记录或新的同 release 观察记录中补充窗口、门禁输出和三层证据，不能把
旧 release 的日志回填到 `52e9624`。
