# 小程序当前 pending 运行包候选（adf536bf）

> 本候选修正了微信个人资料被拒绝后的重试链路：拒绝后不再直接重复调用资料接口，
> 而是在用户点击提示后打开微信授权设置页，返回后再复用全局单飞授权流程。
> 本文只证明源码、自动化测试和 pending 运行包来源，不代表已经发布到微信、完成真机
> 验收或改变线上服务。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `adf536bff5b01a2cd27c664f05b7feae2be6ec3f` |
| 短提交 | `adf536bf` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `312 pass / 0 fail / 3548 expect()` |
| 类型检查、格式、Lint | 通过 |
| pending 静态验证 | 通过；`runtime:verify:pending` 已确认来源和 40 个页面 |
| live `dist` | 未替换；仍为旧来源 `fcc6630e`，被微信开发者工具占用 |
| 真机证据 | [`device-evidence-adf536bf-pending.json`](device-evidence-adf536bf-pending.json)，9 个域均为 `pending` |
| 线上服务 | 未修改；新 API 与旧 Python `8001` 继续共存 |

## 本批修改

- 用户首次拒绝微信头像/昵称授权后，页面提示会进入真正的授权设置页，而不是直接重复
  调用导致无弹窗失败；
- 设置页调用失败、基础库不支持和用户再次拒绝分别保留独立错误语义；
- 新增设置页调用的单元测试、页面源代码门禁和运行包来源校验；
- 没有改变微信登录 code 兑换、服务端普通资料、患者目录和任何支付/医保流程。

## 发布边界

当前 `apps/miniprogram/dist/` 仍被微信开发者工具锁定。关闭开发者工具和真机调试后，
才允许按 [`pending-runtime-publication-runbook-2026-08-26.md`](pending-runtime-publication-runbook-2026-08-26.md)
执行原子发布；在此之前不能覆盖 live `dist`，也不能使用本候选生成真机完成证据。
