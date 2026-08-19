# 报告目录旧患者事件边界（2026-08-19）

## 1. 修正内容

报告目录卡片的 WXML 事件只能通过当前渲染批次的 `viewKey` 找回报告引用，
但在患者切换发生于另一个页面时，旧页面仍可能收到一个晚到的点击事件。此前
页面只检查 `selectedPatient` 存在，就会尝试把旧患者的 `patientId` 和报告引用
带入详情页；服务端最终会执行 owner、患者和详情引用校验，但客户端不应先制造
一次确定会失败的旧患者导航。

现在报告目录在导航前额外执行 `isCurrentSelectedPatient(patientId)`：

- 当前本地显式选择已经变化时，停止导航并提示重新加载；
- 不把旧患者的 opaque 报告引用写入新的详情页参数；
- 服务端 owner + patient + reportId + TTL 校验仍保留，客户端检查不是授权替代；
- 报告目录仍只消费平台 API 的白名单数据，不接触 Provider 报告号或患者号。

核心中文注释位于 `apps/miniprogram/src/pages/report-directory/report-directory.ts`。

## 2. 验证边界

本地已通过：

- Biome 格式与 lint；
- 小程序 TypeScript 类型检查；
- 小程序测试 `159 pass / 0 fail`；
- API 测试 `162 pass / 0 fail`；
- 全仓 `pnpm check`；
- 构建生成 14 个页面脚本，运行包来源为 `b55df37`。

本次没有打开报告 Provider、详情附件、PACS/ECG、线上 release、数据库、Redis、
旧 Python 服务或真机验收。因此这只是候选代码的页面边界修正，不代表报告业务
已经在生产或真机完成。

