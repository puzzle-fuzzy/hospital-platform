# 小程序候选 `4ba492a` 本地运行包记录（2026-08-22）

> 本文是当前真机验收唯一使用的小程序运行包记录。它不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` |
| 小程序客户端 | `4ba492a` |
| 小程序构建来源 | `4ba492a3fdae8283409bd2ab4a0a45247c46600c` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均为 0 |
| 运行包关键模块 | `services/single-flight.js` 存在；`services/single-flight.test.js` 不存在 |

## 本候选包含的运行包加固

本候选在上一轮主动登录 owner 校验的基础上，把 `services/single-flight.ts` 加入构建脚本的显式关键运行模块清单，
并让 `runtime:verify` 直接检查生成的 `services/single-flight.js`。这样间接依赖缺失会在构建/验收阶段失败，
不会等到微信开发者工具或真机沿用旧增量模块索引后才暴露。

主动登录仍必须完成完整安全读取链：`wx.login/code2session` 成功后先请求 `/me` 并验证当前 owner，
只有 `/me` 成功才向首页返回“已登录”结果并允许受保护页面导航；命令请求不会因为会话失效而自动重放。

## 已通过门禁

```text
pnpm --filter @hospital/miniprogram test           221 pass / 0 fail / 1640 expect()
pnpm --filter @hospital/miniprogram typecheck      通过
pnpm --filter @hospital/miniprogram build          通过
pnpm --filter @hospital/miniprogram runtime:verify 通过
```

运行包发布器和校验脚本会拒绝测试脚本、缺失相对模块、workspace 裸依赖和错误来源指纹；当前 `dist/` 不含测试脚本。

## 真机准入与 ENOENT 边界

真机必须打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram` 项目，确认 `miniprogramRoot=dist/`，普通编译后核对
`dist/build-info.json.sourceRevision=4ba492a3fdae8283409bd2ab4a0a45247c46600c`，再生成新二维码。

如果仍出现 `dist/services/single-flight.test.js`，说明开发者工具仍持有旧增量模块索引；应结束真机调试、关闭并重新打开正确项目、
清理文件/编译缓存后重新编译。不得把测试文件复制到 `dist/`，也不得继续使用旧候选二维码。

## 尚未完成

当前仍缺同一候选下的真实手机三层证据：手机页面结果、小程序客户端 `requestId`、服务端 Pino 同链事件。微信登录、患者同步/显式切换、
预约历史/爽约、门诊费用只读和报告目录必须按证据门禁逐项验收；支付、医保、退款、报告附件和 HIS 写回继续关闭。
本次未修改旧 Python 服务、旧数据库或旧 Redis。
