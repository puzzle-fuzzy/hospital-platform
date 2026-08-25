# `3b42b86` 小程序运行候选（2026-08-26）

## 当前事实

- 来源提交：`3b42b867ae19f6dd23bacd88648d1f5917dabf26`。
- pending 运行包：`.local/hospital-miniprogram/pending/`。
- 页面数量：21 个；前四个主入口继续由微信原生 `tabBar` 统一管理。
- 当前源码回归：`293 pass / 0 fail / 3237 expect()`。
- `runtime:verify:pending`：通过，21 个页面脚本和根文件完整。
- 配套真机清单：[`device-evidence-3b42b86-pending.json`](device-evidence-3b42b86-pending.json)，9 个业务域均保持 `pending`。

## 本候选迁移内容

本轮继续保持旧端 `pagesB/patient/agreement.vue` 的协议正文原文只读迁移，并修正迁移台账的契约关联：协议页面标记为 `replaced`，同时保留 `patient-agreement` 关联键，供未来版本、同意、撤回和审计 contract 追踪；关联键不代表已经记录同意。

状态页和 readiness 现在明确区分两层事实：静态阅读页已接入原生页面，真实协议写入仍属于 D 患者 contract 队列；边界审计不会因为页面可打开而放行患者绑定或授权操作。

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
