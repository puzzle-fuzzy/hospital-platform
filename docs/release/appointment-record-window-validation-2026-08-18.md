# 预约历史日期窗口校验记录

> 记录时间：2026-08-18
> 变更类型：预约历史只读链路的服务层业务正确性加固
> 状态：代码与自动化验证完成，尚未替代真实 Provider、真机和线上业务验收

## 1. 为什么需要这道校验

“我的挂号”按请求的 `startDate`、`endDate` 查询预约历史。即使网关适配器已经校验
Provider 成功包络和字段形状，服务层仍不能假设上游一定遵守日期参数：旧系统、代理层或
Provider 版本差异都可能导致返回窗口之外的记录。

如果直接把这些记录返回小程序，患者会看到不属于当前查询范围的预约事实；如果只过滤掉
异常行，又会把 Provider 返回不完整或不可靠伪装成成功，患者无法知道列表缺失。因此本次
采用 fail-closed 语义：发现任意一条窗口外记录，整批结果返回 `502/provider-response-invalid`
对应的内部失败原因 `work-date-outside-query`，不落 `appointment.records.synced` 成功日志。

## 2. 当前规则

- `startDate` 和 `endDate` 使用严格 ISO 日历日期比较；查询端点包含首尾日期。
- 每条返回记录的 `workDate` 必须存在且位于 `[startDate, endDate]`。
- 窗口外、非法日期或未来绕过入口调用得到的非法窗口，均拒绝整批结果。
- 失败日志只保留稳定的 `resultViolation`，不记录 Provider 原始报文、患者标识或费用信息。
- 本次只收紧预约历史读取，不打开预约写入、取消、支付、医保或 HIS 回写。

## 3. 验证证据

- API 服务测试：105 项通过；新增回归测试覆盖“窗口内 + 窗口外混合返回”场景。
- 领域包测试：21 项通过。
- API、领域包 TypeScript 类型检查通过。
- Biome format、lint 与 `git diff --check` 通过后，才允许进入全量 `pnpm check`。

## 4. 尚未完成的线上边界

本记录是代码正确性证据，不是线上真实业务证据。当前生产观察窗口仍未出现
`appointment.records.requested/synced` 或 `outpatient.payment.*` 事件；后续必须使用与当前
服务版本对应的小程序运行包，在有效微信会话中完成页面、HTTP、低敏日志三层交叉验收。
