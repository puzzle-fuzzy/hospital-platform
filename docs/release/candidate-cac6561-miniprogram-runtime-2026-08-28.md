# 小程序运行候选 `cac6561` 发布记录（2026-08-28）

> 本记录只锁定本地微信开发者工具使用的 TypeScript 原生小程序运行包。它不表示微信线上版本已经上传，也不表示真实微信业务或 Provider 已完成验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 配套服务端 release | `5738a71e0bcddaa8849106754baf5b296427bed7` |
| 小程序提交 | `cac6561` |
| 小程序构建来源 | `cac6561b3f4ebbae2de8c632b052837fe7bc28b6` |
| 当前 live `dist` | `apps/miniprogram/dist/`，sourceRevision=`cac6561b3f4ebbae2de8c632b052837fe7bc28b6` |
| 页面与 Tab | 38 个页面、4 个微信原生 Tab |
| 微信线上版本 | 历史运行包，当前候选尚未上传 |

## 本轮修复

- 患者范围页面在同一会话、同一就诊人刷新期间保留稳定的患者卡片，避免暂时故障时先闪成“未选择就诊人”；会话失效、账号切换和患者切换仍会清理旧患者。
- 运行时预检清单明确登记未确认临床 Provider 的关闭态依赖，避免页面入口存在就误认为病历等业务已经开放。
- 继续使用微信原生 `tabBar`，患者显式切换、预约历史/爽约和门诊费用只读保持既定边界。

## 本地验证

- 小程序 TypeScript 检查通过。
- 小程序测试：352 pass、0 fail、3818 个断言。
- `runtime:verify` 与 `runtime:verify:pending` 均通过，38 个页面脚本和根运行文件齐全。
- 当前候选证据清单 [`device-evidence-cac6561-pending.json`](device-evidence-cac6561-pending.json) 九个域全部为 `pending`；清单结构通过不等于真实业务通过。

## 运行包锁定处理

微信开发者工具曾持有 `apps/miniprogram/dist` 的文件锁，完整聚合构建因此停止覆盖并保留 pending 候选。释放工具锁后，使用 `pnpm --filter @hospital/miniprogram runtime:publish-pending` 原子发布，再用 `pnpm --filter @hospital/miniprogram runtime:verify` 核对 live 来源，确认无测试 JS 后才重新生成真机二维码。

## 当前边界

本候选不调用未知外部小程序、不调用微信订阅授权、不伪造号源、预约写入、公开记录或临床 Provider。支付、医保、临床真实读取、实时就诊、外部 WebView 和患者写入业务继续按各自 contract 关闭。
