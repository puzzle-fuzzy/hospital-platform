# `8863f09` 原生小程序本地候选构建记录（2026-08-24）

> 本文记录重制项目当前本地候选，不代表已经上传微信开发者工具、替换线上小程序、部署服务端或完成真机验收。
> 本轮不修改旧 Python 服务、不重启旧服务、不调用真实 Provider，不触发支付、医保、预约写入或 HIS 回写。

## 来源与构建结果

| 项目 | 值 |
| --- | --- |
| 原生小程序提交 | `8863f09a62364b77701b255b30a92a8fa166d436` |
| 构建入口 | `apps/miniprogram/` |
| 运行包目录 | `apps/miniprogram/dist/` |
| 页面数量 | 14 |
| 测试脚本数量 | 0 |
| 线上配套服务端 | `28a5c0c1`，本轮未修改 |

`dist/build-info.json.sourceRevision` 已与上表完整提交一致；运行包校验确认 14 个页面入口存在，且没有把
`*.test.js` 或 `*.spec.js` 带入 `dist/`。

## 本候选的业务收口

本候选继承 `1a87ab3` 的挂号卡片、爽约入口和查询状态容器修正，并新增预约目录状态稳定性修正：

1. 首层科室目录的加载、错误和合法空目录共用固定状态空间；
2. 右侧排班的加载和空排班共用固定状态空间，切换科室时不因空态插图改变右栏高度；
3. 级联科室、日期筛选、号源本地分页和只读下单关闭边界保持不变；
4. Provider 错误仍独立展示，不会降级成“暂无科室/暂无排班”。

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

