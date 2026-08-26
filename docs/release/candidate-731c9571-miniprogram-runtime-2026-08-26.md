# 小程序当前运行包候选（731c9571）

> 本候选对应当前已提交的小程序运行输入。它保留微信资料被拒绝后的设置页重试、
> 患者展示脱敏、全量入口覆盖和统一患者上下文等既有边界。本记录证明源码、
> 构建产物和 live 运行包来源；它不代表已经完成真机验收或改变线上服务。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能与运行输入提交 | `731c95718d26bcf2826987b72f79295413b203d7` |
| 短提交 | `731c9571` |
| 构建输出 | `apps/miniprogram/dist/`；发布后的 pending 目录已清理 |
| 页面数量 | 40 |
| 小程序测试 | `312 pass / 0 fail / 3548 expect()` |
| 类型检查、运行包来源校验 | 通过；`runtime:verify` 已确认当前来源和 40 个页面 |
| live `dist` | 已原子发布；`build-info.sourceRevision=731c95718d26bcf2826987b72f79295413b203d7` |
| 真机证据 | [`device-evidence-731c9571-pending.json`](device-evidence-731c9571-pending.json)，9 个域均为 `pending` |
| 线上服务 | 未修改；新 API 与旧 Python `8001` 继续共存 |

## 来源纠偏

上一份 pending 构建仍标记为 `adf536bf`，但当前运行输入已经推进到 `731c9571`。
本候选已在释放开发者工具锁后由原子发布器切换到 live `dist`，随后执行
`runtime:verify` 已通过。旧的 `adf536bf` 候选记录保留用于追溯，不能继续作为当前二维码
或真机证据来源。

## 发布边界

当前 `apps/miniprogram/dist/` 仍被微信开发者工具锁定。关闭开发者工具和真机调试后，
才允许按 [`pending-runtime-publication-runbook-2026-08-26.md`](pending-runtime-publication-runbook-2026-08-26.md)
执行原子发布；在此之前不能覆盖 live `dist`，也不能使用本候选生成真机完成证据。
