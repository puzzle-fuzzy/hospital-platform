# 小程序当前 pending 运行包候选（731c9571）

> 本候选对应当前已提交的小程序运行输入。它保留微信资料被拒绝后的设置页重试、
> 患者展示脱敏、全量入口覆盖和统一患者上下文等既有边界。本记录只证明源码、
> 构建产物和 pending 运行包来源，不代表已经发布到微信、完成真机验收或改变线上服务。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能与运行输入提交 | `731c95718d26bcf2826987b72f79295413b203d7` |
| 短提交 | `731c9571` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `312 pass / 0 fail / 3548 expect()` |
| 类型检查、pending 运行包来源校验 | 通过；`runtime:verify:pending` 已确认当前来源和 40 个页面 |
| live `dist` | 未替换；仍为旧来源 `fcc6630e`，被微信开发者工具占用 |
| 真机证据 | [`device-evidence-731c9571-pending.json`](device-evidence-731c9571-pending.json)，9 个域均为 `pending` |
| 线上服务 | 未修改；新 API 与旧 Python `8001` 继续共存 |

## 来源纠偏

上一份 pending 构建仍标记为 `adf536bf`，但当前运行输入已经推进到 `731c9571`。
重新构建时开发者工具仍锁定 `dist`，构建器保留了新的 pending 目录并拒绝覆盖 live 运行包；
随后单独执行 `runtime:verify:pending` 已通过。旧的 `adf536bf` 候选记录保留用于追溯，
不能继续作为当前二维码或真机证据来源。

## 发布边界

当前 `apps/miniprogram/dist/` 仍被微信开发者工具锁定。关闭开发者工具和真机调试后，
才允许按 [`pending-runtime-publication-runbook-2026-08-26.md`](pending-runtime-publication-runbook-2026-08-26.md)
执行原子发布；在此之前不能覆盖 live `dist`，也不能使用本候选生成真机完成证据。
