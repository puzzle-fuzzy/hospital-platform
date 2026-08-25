# 小程序候选 `896a83c` 运行包交接（2026-08-26）

> 本文记录首页就诊人二维码安全展示壳对应的 pending 运行包，不代表已经替换微信开发者工具当前 live `dist`，也不代表真实二维码或真机业务验收已经完成。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 小程序提交 | `896a83cf` |
| 完整 sourceRevision | `896a83cfb9d8b4350664cfe97f8bee643cbca434` |
| 页面数 | 20 |
| 小程序回归 | 288 pass / 0 fail / 3229 expect() |
| 当前线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| pending 目录 | `.local/hospital-miniprogram/pending/` |

## 本候选内容

本候选完成首页“就诊人二维码”入口的安全展示壳：保留旧端居中弹层的布局关系，在医院扫码字段、签名、有效期和撤销协议没有确认前显示“待开放”。入口不会请求第三方二维码服务，也不会把 `medicalCardNo`、`patId` 或患者标识拼接到外部 URL。真实二维码不计入已完成业务。

同时保留当前就诊人的显式选择和临床映射门禁，患者目录刷新、会话切换和清空上下文时不会残留上一位患者的二维码展示字段。

## 构建结果

执行 `pnpm --filter @hospital/miniprogram build` 时，类型检查通过；发布阶段因微信开发者工具占用 `apps/miniprogram/dist/` 返回 `EBUSY`。构建脚本已经把完整候选保留到 pending，随后执行 `runtime:verify:pending` 通过，确认来源为 `896a83cf`、页面数为 20 且根文件齐全。

发布前需关闭占用 `dist` 的微信开发者工具窗口和真机调试会话，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
```

发布后必须从新候选重新采集真机证据；当前 live `dist` 和旧二维码均不能证明本候选已经加载。

## 未改变的边界

- 未修改旧 Python 服务、旧数据库、旧 Redis 或线上服务；
- 未修改、暂存或部署另一会话负责的 `packages/adapters/src/zhongyang-appointments.ts`；
- 未打开真实二维码、支付、医保、预约写入、取消、HIS 回写或其他缺少 contract 的能力；
- 9 个既有真机证据域仍为 `pending`，本候选不能标记为真实业务完成。
