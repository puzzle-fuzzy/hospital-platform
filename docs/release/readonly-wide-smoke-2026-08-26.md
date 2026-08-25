# A 线横向只读验收批次（2026-08-26）

> 本文把已有安全只读域放进同一次受控验收批次，避免迁移过程长期停留在患者目录或预约单一页面。
> 它只验证新平台公开 contract、owner 映射、字段脱敏和低敏日志链，不修改旧 Python 服务、旧数据库、旧 Redis
> 或线上进程，也不触发预约写入、取消、支付、医保、退款和 HIS 回写。

## 默认覆盖范围

运行 `pnpm provider:smoke:secure` 时，凭据注入器默认要求一次性验证：

- 平台健康与 readiness；
- 当前登录会话和普通资料读取；
- 患者目录；
- 预约科室、排班和预约历史（包含在线、全部、爽约读取范围）；
- 门诊费用只读列表（已支付、未支付状态读取）；
- 报告目录只读列表。

报告详情不在默认批次内。它需要目录先返回同一轮、同一患者范围内的短期 opaque `reportId`，
应在报告 Provider contract、详情权限和真机操作员明确确认后，用显式能力单独执行：

```powershell
$env:HOSPITAL_SMOKE_CAPABILITIES = "session,profile-read,patients,appointment-directory,appointment-records,outpatient-payments,reports,report-detail"
pnpm provider:smoke:secure
```

## 凭据和日志边界

- Bearer token 和平台内部 `patientId` 只在交互式终端中输入，由安全 wrapper 注入子进程环境；
- 不把 token、患者姓名、身份证、卡号、Provider 患者号或原始响应写入命令参数、文件或日志；
- 每个请求保留低敏 `traceId`，用于和 Elysia 请求日志、业务事件、Provider requestId 配对；
- 某一个能力失败时，只记录固定异常类型和该能力的 traceId，不把其它已通过能力重新解释为失败；
- `patient-sync` 是唯一可选的幂等 POST，默认不执行；它必须由操作员显式加入能力列表。

## 通过标准

一次批次通过不等于小程序业务全部迁移完成。它只增加 A 线对应只读域的证据：

```text
真机页面操作
  -> 小程序 requestId
  -> 新 API traceId / Pino 业务事件
  -> Provider requestId（如有）
  -> 脱敏结果与页面状态
```

以下能力仍然不在本批次：临床病历/住院/医生/导诊、患者绑定和签名写入、外部互联网医院会话、健康内容正式发布、
预约下单、门诊/住院支付、医保授权、微信支付、退款和 HIS 回写。它们继续按各自 contract 队列推进，不能用本批次结果替代。

## 代码位置

- 安全凭据注入器：`tools/provider-smoke-secure.ts`；
- 只读 smoke 执行器：`apps/worker/src/provider-directory-smoke.ts`；
- A 线页面与 API 范围：`docs/migration/overall-migration-wave-2026-08-26.md`；
- 机器门禁：`pnpm provider:audit`、`pnpm readonly:audit`、`pnpm docs:audit`。
