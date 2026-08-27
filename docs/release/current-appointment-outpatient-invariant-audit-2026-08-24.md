> 当前配套小程序运行包（2026-08-27）：本地 live `dist` 的 sourceRevision 为 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`（`62cdb8f`），共 40 个页面；当前没有运行中的微信开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方历史候选仅作追溯。

> 当前配套小程序运行包来源（2026-08-27）：`62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`（`62cdb8f`）；当前没有开发者工具或真机会话，九个真机证据域仍为 `pending`。本文下方更早候选仅作历史追溯。

# 当前预约历史与门诊费用不变量审计（2026-08-24）
> 历史配套小程序构建来源（2026-08-26）：`0be59f966de2c3a0861cb44e9a526a1ef557f6c7`，仅表示当时本地 live 候选，未证明微信线上版本或真机业务已验收；当前入口以当前项目基线为准。
> 当前线上服务端 release（2026-08-27）：`1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。
> 当前小程序配套运行包来源（2026-08-27）：`62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`（`62cdb8f`）；本文中更早候选和真机窗口仅作历史追溯，当前无真机/开发者工具会话。

> 当前服务端 release：`28a5c0c131794ce9dcc5f94bd3809402188ac87a`；当前小程序运行包来源：
> `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本记录只审计只读业务链和代码回归，
> 不代表真实 Provider、微信真机、支付、医保或 HIS 写回已经验收。

## 结论

本轮没有发现值得直接修改运行时代码的逻辑缺口，因此没有为了“继续迁移”而引入未经业务证据支持的改动。
预约历史、爽约记录和门诊费用三条链的当前实现满足以下不变量：

1. 预约历史的“在线”与“全部”是两个独立业务范围。在线使用 Provider `requestChannel=3` 并携带服务端
   日期窗口；全部使用 `requestChannel=4` 且不携带日期，不能把在线结果复制成本地全部历史。
2. Provider 状态只在适配器边界归一化。`0/1/3/4/5/6/7` 分别映射为已预约、已取消、已完成、已爽约、停诊、
   替诊、已登记；未冻结的数字进入 `unknown`，不能被页面猜成爽约或已完成。
3. 爽约页只查询中国标准时间过去 90 天的在线记录，并只筛选服务端明确归一化后的 `missed`。它不读取 Provider
   数字状态，也不把空列表解释成 Provider 已完整返回历史。
4. 预约服务会在 Provider 前校验 owner、内部 `patientId`、会话上下文和日期范围；Provider 返回的在线记录若有
   窗口外日期，整批拒绝而不是过滤坏行伪装成功。患者切换期间的旧响应由页面请求代际和患者上下文双重淘汰。
5. 门诊费用只接受 `unpaid/paid` 两种公开状态。Provider `tradeStatus=1/3` 才能分别归一化为未缴/已缴；取消、
   处理中、失败、质疑等状态不能折叠成已缴。服务端固定查询最近 30 个中国标准时间自然日，并整批校验账单时间、
   金额分、稳定记录标识、重复记录和 owner-scoped 患者映射。
6. 门诊费用当前仍是只读列表。页面不会调起微信支付、医保授权、6201/6202/6301、退款或 HIS 写回；这些能力继续
   作为后置独立状态机处理。

## 代码核对结果

| 业务链 | 关键入口 | 当前门禁 |
| --- | --- | --- |
| 我的挂号 | `apps/api/src/modules/appointments/service.ts` | scope/日期/owner/patient/Provider 结果窗口二次校验；失败只记录低敏原因 |
| 众阳预约适配 | `packages/adapters/src/zhongyang-appointments.ts` | 渠道、日期、状态、重复预约号、展示字段和资源上限 |
| 小程序挂号页 | `apps/miniprogram/src/pages/appointment-records/appointment-records.ts` | 重新验证会话和患者；标签切换重新请求服务端范围；分页只展开已确认结果 |
| 爽约页 | `apps/miniprogram/src/pages/missed-appointments/missed-appointments.ts` | 只接受 `missed`；不从客户端推断 Provider 状态 |
| 门诊费用服务 | `apps/api/src/modules/outpatient-payments/index.ts` | 固定 Asia/Shanghai 30 日窗口；owner 映射、状态、金额、时间和重复 ID 全部 fail-closed |
| 众阳门诊适配 | `packages/adapters/src/zhongyang-outpatient-payments.ts` | 明确 `success=true`、`tradeStatus=1/3`、精确金额转换和稳定身份字段 |
| 小程序门诊费用页 | `apps/miniprogram/src/pages/outpatient-payment/outpatient-payment.ts` | 未缴/已缴独立查询；详情/支付入口保持迁移关闭提示 |

关键绕弯业务的处理原则已经写在核心代码中文注释中：Provider 患者号只在仓储到适配器的调用帧内流转，公共 API
只接受平台 opaque `patientId`；空结果是“成功且确实为空”，异常响应不能被筛选成空列表；日志只保留事件、关联 ID、
状态、计数和有限失败原因，不记录患者号、金额明细、原始响应或认证凭证。

## 回归证据

本地针对当前候选运行了以下测试：

- API 预约 service 与门诊费用 service：`40 pass / 0 fail / 155 expect()`。
- 众阳预约与门诊费用适配器：`39 pass / 0 fail / 93 expect()`。
- 原生小程序当前测试入口（包含预约记录视图、爽约窗口、门诊费用、患者会话代际和页面状态门禁）：`223 pass / 0 fail / 1648 expect()`。

这些是代码层证据，不是线上 Provider 成功证据。当前线上只读观察窗口没有出现 `appointment.*` 或
`outpatient.payment.*` 业务事件，因此不能把本审计写成“真机已完成”。真机验收仍以
[`current-13f-real-device-acceptance-runbook-2026-08-24.md`](current-13f-real-device-acceptance-runbook-2026-08-24.md) 为准，
必须逐步配对页面、客户端 requestId 和服务端低敏事件。

## 后续顺序

1. 先收集当前候选的预约历史、爽约和门诊费用三层真机证据；没有请求证据时不修改 Provider 字段或状态映射。
2. 若 Provider 返回真实数据与本审计不一致，先冻结具体字段、渠道和状态的证据，再更新 contract、适配器、服务层和回归，
   不用页面兼容分支掩盖差异。
3. 只读链通过后，再分别审计报告详情、普通资料写入和患者绑定；支付、医保、退款、HIS 写回最后单独验收。

本轮没有 SSH 写入、部署、重启或修改旧 Python 服务，也没有触碰并行会话维护的众阳自动化代码和用户未提交的
`apps/miniprogram/project.config.json`。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
> 当前统一发布基线补充（2026-08-27）：服务端 release 为 `1bc8b0a85f21cb58205a99ce4de0de6afe9bf240`；小程序本地 live 运行包来源为 `62cdb8f82b4169dd1b9a6ed3403e3be2f7422328`，共 40 个页面。本文更早版本仅作历史追溯，真机证据仍为 pending；旧 Python `8001` 未修改。
