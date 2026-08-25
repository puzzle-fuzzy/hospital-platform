# `0bb4877e` 小程序运行候选（2026-08-26）

## 当前事实

- 来源提交：`0bb4877ee890894bdb63e32c4b2b2d9e1167d555`。
- pending 运行包：`.local/hospital-miniprogram/pending/`。
- 页面数量：21 个；前四个主入口继续由微信原生 `tabBar` 统一管理。
- 当前源码回归：`292 pass / 0 fail / 3250 expect()`。
- `runtime:verify:pending`：通过，21 个页面脚本和根文件完整。
- 配套真机清单：[`device-evidence-0bb4877-pending.json`](device-evidence-0bb4877-pending.json)，9 个业务域均保持 `pending`。

## 本候选迁移内容

本轮把旧端 `pagesB/patient/agreement.vue` 的协议正文迁移到
`pages/patient-agreement/patient-agreement`。页面保留旧端十一章文本、条款编号和主要样式，使用单一外层 `scroll-view`，不增加底部主 Tab，不新增网络请求。

旧端脚本中的 `handleAccept`/`handleReject` 没有绑定到模板，且未发现协议版本、同意记录、撤回和审计契约。因此本候选只开放静态阅读；新增/绑定就诊人的真实协议同意能力继续留在 D 患者 contract 队列，不接受本地勾选或阅读行为替代。

## 构建与发布边界

构建阶段检测到微信开发者工具仍占用 `apps/miniprogram/dist/`，按保护策略返回 `EBUSY` 并保留已完整校验的 pending 运行包；旧 live `dist` 没有被覆盖，也没有发布服务端或修改旧 Python 服务。

发布前必须关闭占用 `dist` 的微信开发者工具窗口和真机调试会话，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后仍需用本候选重新采集页面状态、客户端 `requestId`、服务端 Pino 事件和 Provider 低敏请求号；当前清单全部 pending，不能把自动化回归或静态页面打开视为真实业务验收。

## 本轮未触碰范围

- 旧 Python 服务、旧数据库、Redis 和线上运行进程；
- `packages/adapters/src/zhongyang-appointments.ts`（另一会话负责）；
- 协议同意写入、患者新增/绑定、二维码、医保、支付、临床写入、外部 WebView 和 HIS 回写。
