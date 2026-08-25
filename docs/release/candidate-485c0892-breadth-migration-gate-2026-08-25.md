# 小程序候选 `485c0892`：全量迁移覆盖门禁（2026-08-25）

> 本记录描述当前源码提交生成的本地 pending 运行包，不代表已经发布到 `dist/`、上传微信或完成真机业务验收。
> 线上仍使用小程序运行包 `13f597ea`；服务端仍使用 release `8eb51b5f`。本候选没有修改服务端、旧 Python、数据库或 Redis。

## 当前来源

| 项目 | 值 |
| --- | --- |
| Git 来源 | `485c0892e6850e43d09443ca6eecd539eea503d8` |
| pending 目录 | `.local/hospital-miniprogram/pending/` |
| pending 页面数 | 17 |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 线上小程序 | `13f597ea9ee3f65b9be858117826d948339d904a` |
| 线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |

## 本候选内容

- 旧端 64 个页面继续由 TypeScript 逐页台账覆盖，并新增首页、就诊、互联网医院、预约、患者、健康、用户 7 个业务域的派生统计。
- 迁移状态页、实际原生页面和生产排除项继续分开；阻塞类型仍区分 provider、临床、支付/回写、患者绑定和外部入口。
- `pnpm migration:audit` 同时核对旧端实际页面、Markdown 矩阵、TypeScript 台账和业务域摘要，避免新增旧页面后静默漏记。
- 不开放预约写入、患者绑定、二维码、支付、医保、临床问卷、实时 WebSocket、外部 WebView 或 HIS 回写。

## 已通过的本地门禁

```text
pnpm --filter @hospital/miniprogram typecheck   通过
pnpm --filter @hospital/miniprogram test        256 pass / 0 fail / 2426 expect()
pnpm migration:audit                            64 old page(s) + 64 catalog page(s) 通过
pnpm docs:audit                                 677 docs，无断链
pnpm format:check                               通过
```

构建已生成并校验 pending 运行包，但发布阶段因为微信开发者工具锁定 live `dist/` 安全停止；旧完整运行包没有被半替换。

## 发布与验收前置

关闭当前微信开发者工具窗口和真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

随后必须从新的 `485c0892` 运行包重新编译、扫码，再按
[`readonly-acceptance-next-2026-08-25.md`](readonly-acceptance-next-2026-08-25.md) 采集页面、客户端 requestId、服务端 trace 和 Provider 低敏请求号。
旧 `fcc6630e`、线上 `13f597ea` 或任何历史候选不能作为本候选证据。

