# 患者范围页面上下文一致性审计（2026-08-22）

> 本轮只审计当前候选的客户端业务边界，不代表真实微信、Provider 或公网业务验收。旧项目、旧服务、数据库和 Redis 未修改。

## 审计基线

| 项目 | 值 |
| --- | --- |
| 小程序来源 | `41c708e1adf864ef6fef1f788e97aa8fb4371227` |
| 服务端配套 release | `1e58bb66bf24021d2b680eb5fd03abfec467989a` |
| 审计范围 | 预约历史、爽约、门诊费用、报告目录、报告详情、患者选择页 |
| 定向测试 | 216 pass / 0 fail / 1619 expects |
| 运行包测试脚本 | 0 个 `*.test.js` / `*.spec.js` |

## 统一业务链路

患者范围页面必须按以下顺序建立上下文：

```text
当前会话 `/me`
    ↓ owner 证明
owner-scoped `/patients`
    ↓ 目录与当前账号复核
本地显式 patientId + clinicalAccess=ready
    ↓ 会话代际与本地选择双重检查
预约历史 / 爽约 / 门诊费用 / 报告目录读取
```

这条顺序不是页面加载习惯，而是授权和数据归属边界：

- `/me` 失败不能被页面伪装成“没有就诊人”；
- 患者目录为空、已失效或临床映射不可用必须保持不同错误语义；
- 已保存患者失效时不能静默切换到目录第一位；
- `clinicalAccess` 未达到 `ready` 时不能进入预约、报告或费用查询；
- 请求发出前和响应提交前都必须检查会话代际与当前显式患者；
- 旧患者事件、旧页面栈和旧 WXML 事件不能覆盖当前读模型。

## 页面核对结果

| 页面 | owner/目录复核 | 请求前代际检查 | 响应提交检查 | 旧结果清理 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `appointment-records` | 有 | 有 | 有 | 有 | 只读边界成立 |
| `missed-appointments` | 有 | 有 | 有 | 有 | 只从明确 `missed` 派生，不猜状态 |
| `outpatient-payment` | 有 | 有 | 有 | 有 | `unpaid/paid` 不串台，支付仍关闭 |
| `report-directory` | 有 | 有 | 有 | 有 | 报告 Provider 未配置时不伪装空列表 |
| `report-detail` | 有 | 有 | 有 | 有 | owner + patient + opaque reportId + TTL 复核 |
| `patient-select` | 有 | 同步完成后记录 | 选择前复核 | 会话失效时清理 | 新增/绑卡继续关闭 |

## 已核对的关键实现

- `apps/miniprogram/src/services/patient-selection-service.ts` 集中维护 opaque `patientId` 形状、首次默认、`stale`、`unavailable` 和 `clinicalAccess=ready` 规则；页面没有各自复制默认患者逻辑。
- `apps/miniprogram/src/services/dashboard-service.ts` 的 `loadCurrentPatientForOwner` 先读取完整目录，再重新验证 owner，最后返回绑定的会话代际；患者范围查询使用固定代际读取，不会在旧 `patientId` 上自动登录重放。
- `apps/miniprogram/src/services/api-client.ts` 的 `requestWithStableSession` 只允许认证 GET，遇到代际变化直接丢弃结果，不把旧患者请求发送到新会话。
- 患者页面在刷新和失败时清理旧读模型；依赖故障、会话失效、患者未绑定和临床映射不可用不会降级为空列表。
- 患者选择页的“添加就诊人”仍只展示迁移提示，不调用未冻结的 `patients`/`patCards` 写入接口。

## 验收与未完成范围

本轮运行 `pnpm --filter @hospital/miniprogram test`，结果为 `216 pass / 0 fail`。测试和源码审计证明当前客户端的患者归属、异步淘汰和错误边界一致，但不能替代：

- 真机微信登录、患者同步和第二位就诊人显式切换；
- 真实 Provider 请求、字段映射和服务端低敏日志；
- 报告详情/附件、患者绑定、二维码、挂号写入；
- 微信支付、医保授权、结算、退款和 HIS 回写。

本轮没有发现可以在缺少 Provider contract 的情况下安全新增的业务实现，因此没有修改业务代码。下一步仍是当前候选二维码的真机三层证据；在证据到达前保持上述写入和支付能力关闭。
