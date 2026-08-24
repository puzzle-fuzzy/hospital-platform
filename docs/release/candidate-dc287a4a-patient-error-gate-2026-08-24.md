# `dc287a4a` 患者范围错误态入口候选记录（2026-08-24）

> 本文只记录本地重制小程序候选，不代表已经替换线上小程序、完成微信真机业务验收或开放支付/医保能力。旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 1. 本轮修正

本轮把挂号记录、报告目录和门诊缴费三个患者范围页面的错误态入口统一为明确的患者上下文分流：

- `patient-selection-required`
- `patient-selection-stale`
- `patient-not-bound`
- `patient-clinical-unavailable`

只有上述错误才显示错误态中的“选择就诊人”。网络、Provider、持久化和依赖配置错误只显示“重新加载”，不把服务故障伪装成用户未选患者。

门诊缴费的 `outpatient-payment-patient-not-found` 只表示当前患者没有门诊费用映射，不自动引导换人；待缴/已缴标签在没有患者时产生的本地明确状态，仍保留选择入口。服务故障清空旧患者快照后，页面使用“当前就诊人信息暂不可用”中性文案，避免错误态跳成“请先选择就诊人”。

## 2. 来源和验证

| 项目 | 结果 |
| --- | --- |
| 页面代码来源 | `dc287a4a82ceaded88909250cd9c8f13741670ab` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 运行包来源 | `dist/build-info.json.sourceRevision` 与上述提交一致 |
| 小程序测试 | `233 pass / 0 fail`，`1800 expect()` |
| TypeScript | 通过 |
| 构建 | 通过，16 个页面脚本存在 |
| 运行包校验 | 通过，16 个页面和根文件存在 |

本轮没有部署服务端，也没有打开支付、医保授权/结算、预约写入、取消、HIS 回写或真实患者绑定。真机仍需按 [`ff931d7c-real-device-business-acceptance-runbook-2026-08-24.md`](ff931d7c-real-device-business-acceptance-runbook-2026-08-24.md) 重新导入和编译当前候选。
