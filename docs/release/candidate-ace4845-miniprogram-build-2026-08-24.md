# `ace4845` 原生小程序本地候选构建记录（2026-08-24）

> 本文记录重制项目当前本地候选，不代表已经上传微信开发者工具、替换线上小程序、部署服务端或完成真机验收。
> 本轮只修改新项目小程序代码和测试；旧 Python 服务、线上 API、数据库、Redis、支付、医保和 HIS 回写均未触碰。

## 来源与构建结果

| 项目 | 值 |
| --- | --- |
| 原生小程序提交 | `ace48459407586aa2c0f8ef2a9ab7083793dc25f` |
| 构建入口 | `apps/miniprogram/` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面数量 | 14 |
| 测试脚本数量 | 0 |
| 线上配套服务端 | `28a5c0c1`，本轮未修改 |

`dist/build-info.json.sourceRevision` 已与上表完整提交一致；`runtime:verify` 确认 14 个页面入口和必需根文件存在，
且没有把 `*.test.js` 或 `*.spec.js` 带入运行包。

## 本候选的业务修正

“我的挂号”在线/全部两个标签现在在请求启动时固定本轮 `requestedTab`：

1. 点击标签时，页面把明确的 `online`/`all` 传给本轮加载函数；
2. `/me`、患者目录和预约记录请求等待期间不再反复读取可变的 `activeTab`；
3. 用户快速切换标签时，旧请求仍由页面 request guard 淘汰，当前请求不会把渠道 3/4 混发；
4. 页面只表达业务范围，Provider 渠道数字仍由服务端选择，全部历史不会由在线结果本地拼接。

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
的业务证据。页面结果、客户端 requestId、服务端日志和 Provider requestId 必须来自同一候选、同一二维码会话和同一患者。

