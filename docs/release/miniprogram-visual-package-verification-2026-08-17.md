# 原生小程序个人中心视觉运行包核验（2026-08-17）

> 本文只证明本地构建产物包含当前“我的/我的挂号”视觉修正和全部注册页面，不证明微信开发者工具、真机、公网 API 或 Provider 业务已经验收。

## 1. 核验范围

| 项目 | 结果 |
| --- | --- |
| 视觉代码提交 | `f562d61`（`对齐我的挂号原版视觉`） |
| 文档核验提交 | `8dc53dd`（`补充个人中心迁移台账`） |
| 构建命令 | `pnpm --filter @hospital/miniprogram build` |
| 构建结果 | TypeScript 检查通过；`app.json` 注册页面 14 个，运行脚本全部生成 |
| 开发者工具/真机 | 尚未取得真实加载证据，仍需导入 `apps/miniprogram/dist/` 验收 |

## 2. 视觉资源与页面产物

以下文件均从本次 `dist` 目录读取并计算 SHA-256；哈希用于确认开发者工具导入的是同一份产物，不能替代屏幕截图或真机交互证据。

| 相对路径 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `pages/my/my.js` | 9419 | `ca74d3cbf3341572201778f559141e3074fd0088bc9072b507c1b2a3dc9fd8ea` |
| `pages/my/my.wxml` | 2544 | `e7bb174c18df5c0c9b7acde681198fc9c3cdeffff6a9845d7469738137114297` |
| `pages/my/my.wxss` | 2952 | `eb0d11bbe94bd093aac7e108c3f6ddd876afb1cd286a9f3e042b3819033a8d12` |
| `pages/appointment-records/appointment-records.js` | 9676 | `e17a21094482b18bf557400b25f2f17a775c75802ff41a831f032da54ec5e56e` |
| `pages/appointment-records/appointment-records.wxml` | 4925 | `2ae6fe3a312bdbeb16cc56cf16f2a5f8acd74e88d0d5b5b6f914b8033f6e5d44` |
| `pages/appointment-records/appointment-records.wxss` | 6671 | `7365a6641d1cfe0995d4eaa244a371248da563a9008f211595b2fe4f462b3944` |
| `assets/legacy-user/legacy-user-background.png` | 23457 | `1e067a8965b720a1eb60416344b8203da9da9cc9810b3785888d4e0112e152b4` |
| `assets/legacy-user/appointment-status.svg` | 6440 | `83e45a46c186ff54a30b29f33a8217f1a60cf949c0870a2f4456de08dc473f9e` |
| `assets/legacy-home/tab-04-active.png` | 1583 | `fe5dbbfc75dd975c2fffb385b068a06d876490b8c00d79ac0f1f2c41f49af2ee` |

## 3. 导入后的验收边界

1. 开发者工具必须导入包含 `project.config.json` 的 `apps/miniprogram/dist/`，不能继续运行旧 `src` 或旧 `dist`。
2. “我的”页核对背景、头像占位、家庭成员入口、三组功能分类、图标顺序和固定底部导航；点击家庭成员必须进入独立患者选择页。
3. “我的挂号”核对全宽就诊人/院区信息区、在线/全部标签、列表灰色背景、预约状态图标、卡片间距和院内导航弹窗；更换就诊人后不能沿用上一位患者的记录。
4. 真机产生的 request id、服务端事件和页面结果仍必须按 [`P0 只读业务验收手册`](p0-readonly-business-acceptance-runbook-2026-08-17.md) 记录；本文件不允许用静态包哈希替代业务证据。

预约写入、详情、预问诊、取消、退号、微信支付、医保授权、退款和 HIS 回写继续保持关闭。
