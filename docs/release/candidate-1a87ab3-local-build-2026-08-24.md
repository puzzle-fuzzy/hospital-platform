# `1a87ab3` 原生小程序本地候选构建记录（2026-08-24）

> 本文只记录重制项目的本地候选，不代表已经上传微信开发者工具、替换线上小程序、部署服务端或完成真机验收。
> 本轮不修改旧 Python 服务、不重启旧服务、不调用真实 Provider，不触发支付、医保、预约写入或 HIS 回写。

## 来源与构建结果

| 项目 | 值 |
| --- | --- |
| 原生小程序提交 | `1a87ab3e232973dbe0ac0774f341cb4c6eec463e` |
| 构建入口 | `apps/miniprogram/` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面数量 | 14 |
| 测试脚本数量 | 0 |
| 线上配套服务端 | `28a5c0c1`，本轮未修改 |

本地构建写入的 `dist/build-info.json.sourceRevision` 与上表完整提交一致；运行包校验确认 14 个页面入口存在，
且没有把 `*.test.js` 或 `*.spec.js` 带入 `dist/`。

## 本候选的业务收口

1. “我的挂号”卡片保留旧端的业务层级，重新整理状态、科室、就诊日期/时段和操作区；不改变预约查询范围、状态映射或任何写入副作用。
2. “爽约记录”从“我的”页只使用已验证平台会话进入。缺少患者上下文时留在本页显示稳定错误态，不自动打开或嵌入“选择就诊人”；只有用户明确点击“更换就诊人”才进入选择页。
3. 预约历史、爽约、报告、门诊费用、报告详情、患者选择和个人中心的查询状态共用固定空间契约，加载转为空结果或错误时不改变页面骨架高度。
4. 业务边界、中文注释、迁移台账和业务正确性文档已同步；旧服务和并行众阳自动化不在本候选范围内。

## 已通过的本地门禁

```text
pnpm --filter @hospital/miniprogram test           228 pass / 0 fail
pnpm --filter @hospital/miniprogram typecheck      通过
pnpm --filter @hospital/miniprogram build          通过
pnpm --filter @hospital/miniprogram runtime:verify 通过
```

## 真机和发布边界

如需人工检查，必须重新打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram` 项目，确认项目根目录指向
`dist/`，普通编译后从本候选重新生成二维码。不能继续使用旧二维码，也不能把本地候选的页面结果写成线上 `13f597e`
的业务证据。页面截图、客户端 requestId 和服务端 Pino/Provider requestId 必须来自同一候选和同一二维码会话；
在这些证据产生前，所有真实业务域继续保持 `pending`。
