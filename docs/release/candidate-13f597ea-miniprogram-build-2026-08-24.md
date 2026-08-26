> 当前发布基线：线上服务端 release 为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；当前小程序运行包来源为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本记录只描述小程序运行包，不代表真机业务已验收。
> 当前线上服务端 release（2026-08-26）：`e5d941aef3a8b0d1df24a518bea03f36f2ee505d`，已完成候选 preflight、隔离 smoke、原子切换和公网 runtime smoke；该运行层证据不等价于真实 Provider 或支付业务成功。

# 小程序候选 `13f597e` 当前运行包记录（2026-08-24）

> 本文是当前真机验收唯一使用的小程序运行包记录；它与线上服务端 `8eb51b5f` 形成有意分层配套，不要求服务端和小程序来自同一份 Git 提交。
> 它只证明运行包来源和本地准入门禁，不代表微信真机、众阳、HIS、支付或医保已经完成真实验收。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 服务端 release | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 小程序客户端 | `13f597e` |
| 小程序构建来源 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 页面入口 | 14 个，全部生成 `.js/.json/.wxml/.wxss` |
| 运行包测试脚本 | `*.test.js`、`*.spec.js` 均为 0 |
| 运行包关键模块 | `services/single-flight.js` 存在；`services/single-flight.test.js` 不存在 |

## 本候选包含的业务收口

- 预约历史在线/全部两个标签使用服务端明确的业务范围；小程序不会把在线结果复制成全部结果。
- 患者、预约和门诊费用读取继续经过平台 API、会话代际和显式就诊人门禁；小程序不接收 Provider 患者号或渠道数字。
- 预约详情、预约写入、支付、医保、退款、报告 Provider 和 HIS 写回仍保持关闭或迁移提示。

## 已通过门禁

```text
pnpm --filter @hospital/miniprogram build          通过
pnpm --filter @hospital/miniprogram runtime:verify 通过
pnpm --filter @hospital/miniprogram test           222 pass / 0 fail / 1643 expect()
```

构建输出 `dist/build-info.json.sourceRevision` 为完整的
`13f597ea9ee3f65b9be858117826d948339d904a`；运行包不含测试脚本、workspace 裸依赖或缺失的相对模块。

## 真机准入

真机必须打开 `E:\__Super_Core__\hospital-platform\apps\miniprogram` 项目，确认 `miniprogramRoot=dist/`，
普通编译后再次核对上述 `sourceRevision=13f597ea...`，再生成新二维码。不得继续使用旧 `4ba492a` 二维码。

当前仍缺同一 `13f597ea` 服务端/小程序配对下的手机页面、小程序客户端 `requestId`、服务端 Pino/Provider requestId
三层业务证据；真机验收应按微信登录 → 患者显式切换 → 预约只读 → 门诊费用只读顺序执行。
> 当前发布基线更新（2026-08-24 19:54 CST）：线上服务端 release 已切换为 `8eb51b5ffe85b0b8f8a032783f893117d3df549d`；小程序运行包来源仍为 `13f597ea9ee3f65b9be858117826d948339d904a`（提交 `13f597e`）。本轮只重启新 API，旧 Python `8001` 未修改；普通资料 PUT、支付、医保和 Provider 真机证据仍待。
