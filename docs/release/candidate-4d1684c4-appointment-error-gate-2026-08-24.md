# `4d1684c4` 挂号错误态患者入口候选记录（2026-08-24）

> 本文只记录本地重制小程序候选，不代表已经替换线上小程序、完成微信真机业务验收或开放支付/医保能力。旧 Python 服务、线上 API、数据库和 Redis 均未修改。

## 1. 本轮修正

预约记录页此前在错误态无条件展示“选择就诊人”。这会把网络失败、Provider 拒绝、持久化暂时不可用和服务依赖未配置误导成“用户没有选择患者”，导致错误的业务分流。

本轮在 `patient-selection-service.ts` 集中维护患者上下文错误码集合，页面只在以下错误出现时展示错误态选择动作：

- `patient-selection-required`
- `patient-selection-stale`
- `patient-not-bound`
- `patient-clinical-unavailable`

其它错误只显示“重新加载”，仍由当前页面重新执行 `/me → 患者目录 → 挂号记录` 完整链路。爽约页继续保持不自动嵌入或跳转患者选择页的规则。

## 2. 来源和验证

| 项目 | 结果 |
| --- | --- |
| 页面代码来源 | `4d1684c449228b86674f85fffdd873cde151792e` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 运行包来源 | `dist/build-info.json.sourceRevision` 与上述提交一致 |
| 小程序测试 | `233 pass / 0 fail`，`1792 expect()` |
| TypeScript | 通过 |
| Biome 格式与 Lint | 通过 |
| 构建与运行包校验 | 通过 |

本轮只修改原生小程序业务错误态、中文注释、测试和文档，没有修改旧 Python 服务或线上运行层。支付、医保授权/结算、预约写入、取消、HIS 写回和真实患者绑定仍不在本候选开放范围。
