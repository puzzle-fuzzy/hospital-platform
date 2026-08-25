# 小程序候选 `b587c7ea`：20 页运行包来源刷新（2026-08-25）

> 本记录是对健康百科功能候选 `99c7e8fd` 的运行包来源刷新，不代表已经发布到 live `dist`、上传微信或完成真机业务验收。
> `b587c7ea` 触及了小程序运行输入中的迁移门禁和构建脚本，因此运行包来源必须更新；页面业务内容仍以 `99c7e8fd` 健康百科候选记录为功能里程碑。
> 本轮只修改新项目；旧 Python 服务、线上 API、MySQL、Redis 和另一会话负责的众阳自动化均未修改。

## 当前来源

| 项目 | 值 |
| --- | --- |
| 运行输入来源 | `b587c7ea8479e38d47055f3f5b672263f32aec41` |
| 功能里程碑 | `99c7e8fd76bd7b38de50d1c5cfdbc7002cba4a15` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending `build-info.json` 页面数 | 20 |
| pending 生成时间 | `2026-08-25T06:43:43.806Z` |
| 小程序测试 | `259 pass / 0 fail / 2445 expect()` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍为 16 页旧运行包 |
| 线上配套小程序 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |

## 本次验证

```text
pnpm --filter @hospital/miniprogram build   类型检查通过；20 页候选写入 pending
pnpm --filter @hospital/miniprogram test    259 pass / 0 fail / 2445 expect()
```

原子发布尝试因微信开发者工具持有 `apps/miniprogram/dist/` 文件锁而返回 `EBUSY`。发布器保留了完整 pending，
没有清空或半替换旧 live 运行包；`runtime:publish-pending` 仍需在关闭开发者工具和真机调试会话后执行。

## 发布前后边界

1. 关闭当前微信开发者工具窗口和真机调试会话后，执行 `runtime:publish-pending` 与 `runtime:verify`。
2. 发布后直接打开 `apps/miniprogram/dist/` 独立工程，普通编译并确认 `build-info.json.sourceRevision` 为 `b587c7ea...`。
3. 新二维码只能用于验证四个原生 Tab、登录、就诊人显式切换和已接入的只读页面；不能把运行包来源证明写成 Provider、支付、医保、患者绑定、二维码或 HIS 业务完成。
4. 线上 `13f597e` 与本地 pending `b587c7ea` 不得混写真机证据；旧 live `fcc6630e` 也不能作为本候选证据。
