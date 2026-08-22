# 小程序候选 `171a874` 本地运行包记录（2026-08-22）

> 本文是当前真机验收唯一使用的小程序运行包记录。它不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `0e2a366efcca8da25d7edd4a286781f2d3dfdbec` |
| 小程序客户端 | `171a874` |
| 小程序构建来源 | `171a8743185fb4ecc1696851662659c1a0ee7ebf` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均为 0 |
| 运行包关键模块 | `services/single-flight.js` 存在；`services/single-flight.test.js` 不存在 |

## 本候选包含的业务修正

主动登录现在必须完成完整的安全读取链：`wx.login/code2session` 成功后，先请求 `/me` 并验证当前 owner，
只有 `/me` 成功才向首页返回“已登录”结果并允许受保护页面导航。这样不会把刚签发的 token 直接当作患者、资料、预约或费用业务的 owner 证明。
`/me` 仍然是 GET，不会重放资料保存、患者同步、支付或其它命令；失败继续由首页的 `invalid/unavailable` 状态机处理。

代码中的中文注释说明了 code 兑换、owner 证明和受保护入口之间的顺序；客户端也增加了请求顺序回归测试，防止未来再次在 token 落盘后提前放行。

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
`dist/build-info.json.sourceRevision=171a8743185fb4ecc1696851662659c1a0ee7ebf`，再生成新二维码。

如果仍出现 `dist/services/single-flight.test.js`，说明开发者工具仍持有旧增量模块索引；应结束真机调试、关闭并重新打开正确项目、
清理文件/编译缓存后重新编译。不得把测试文件复制到 `dist/`，也不得继续使用旧 `ba1dd23` 二维码。

## 尚未完成

当前仍缺同一候选下的真实手机三层证据：手机页面结果、小程序客户端 `requestId`、服务端 Pino 同链事件。微信登录、患者同步/显式切换、
预约历史/爽约、门诊费用只读和报告目录必须按证据门禁逐项验收；支付、医保、退款、报告附件和 HIS 写回继续关闭。
本次未修改旧 Python 服务、旧数据库或旧 Redis。
