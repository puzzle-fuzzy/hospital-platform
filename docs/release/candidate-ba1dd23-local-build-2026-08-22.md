# 小程序候选 `ba1dd23` 本地运行包记录（2026-08-22）

> 本文记录反馈静态行为修正后的最新小程序运行包来源、构建门禁和开发者工具准入边界。它不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` |
| 小程序客户端 | `ba1dd23` |
| 小程序构建来源 | `ba1dd23e0f40191745a60997939b31b4c47795cd` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均为 0 |
| 运行包关键模块 | `services/single-flight.js` 存在；`services/single-flight.test.js` 不存在 |

## 本次代码内容

本候选修正了反馈帮助页与旧端的可见行为差异：点击“意见反馈”恢复为旧端实际使用的“跳转到意见反馈页面” Toast，仍然不提交工单、不伪造成功状态；FAQ、客服电话和用户确认后拨号行为保持不变。对应验收测试和迁移文档已同步。

## 已通过门禁

```text
pnpm --filter @hospital/miniprogram test           220 pass / 0 fail / 1636 expect()
pnpm --filter @hospital/miniprogram typecheck      通过
pnpm --filter @hospital/miniprogram build          通过
pnpm --filter @hospital/miniprogram runtime:verify 通过
```

构建发布器和运行包校验会拒绝测试脚本、缺失相对模块和错误来源指纹；当前运行包中没有任何测试脚本或对测试脚本的运行时引用。

## 真机准入与 ENOENT 边界

真机必须从 `E:\__Super_Core__\hospital-platform\apps\miniprogram` 正确项目重新普通编译后生成二维码，且 `dist/build-info.json.sourceRevision` 必须等于本候选完整来源。若再次出现 `dist/services/single-flight.test.js`，应结束真机调试、关闭并重新打开正确项目、清理文件/编译缓存后重新编译；不得把测试文件复制到 `dist/`，也不得使用旧二维码。

## 尚未完成

当前仍缺同一候选下的真实手机三层证据：手机页面结果、小程序客户端 `requestId`、服务端 Pino 同链事件。微信登录、患者同步/显式切换、预约历史/爽约、门诊费用只读和报告目录必须按证据门禁逐项验收；支付、医保、退款、报告附件和 HIS 写回继续关闭。本次未修改旧 Python 服务、旧数据库或旧 Redis。
