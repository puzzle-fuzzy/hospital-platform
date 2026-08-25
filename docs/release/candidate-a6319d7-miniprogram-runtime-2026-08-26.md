# 小程序候选 `a6319d7` 运行包交接（2026-08-26）

> 本文记录本次微信小程序源码修正对应的 pending 运行包，不代表已替换微信开发者工具当前 live `dist`，也不代表已经完成真机业务验收。
> 旧 Python 服务、旧数据库、旧 Redis、线上服务和另一会话负责的众阳预约适配器均未修改。

## 1. 候选来源

| 项目 | 值 |
| --- | --- |
| 小程序提交 | `a6319d79` |
| 完整 sourceRevision | `a6319d79f9f1e940ea5bcbd2ab7fe6500345466f` |
| 页面数 | 20 |
| 小程序回归 | 286 pass / 0 fail / 3217 expect() |
| 当前线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| pending 目录 | `.local/hospital-miniprogram/pending/` |

## 2. 本候选业务修正

本候选修正全局微信头像/昵称授权回调的 owner 与会话代际边界：

- 授权回调成功时同时确认 owner、sessionGeneration 和资料状态；
- 全局资料已被清理时，旧回调不再写入头像/昵称缓存；
- 旧回调不会继续触发普通资料 PUT；
- 普通资料暂时故障时，当前 owner 仍保留明确手势授权能力；
- 四个主 Tab 继续共用微信原生 `tabBar`，没有重新引入页面级底栏。

## 3. 构建与验证

已执行：

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram build
$env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION = "a6319d79f9f1e940ea5bcbd2ab7fe6500345466f"
pnpm --filter @hospital/miniprogram runtime:verify:pending
Remove-Item Env:HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION
```

结果：

- 类型检查、全量小程序测试通过；
- 构建在原子替换 live `dist` 时遇到微信开发者工具文件锁并返回 `EBUSY`；
- 构建脚本保留了完整 pending 候选，没有清空旧 live `dist`；
- `runtime:verify:pending` 已确认 `a6319d7`、20 个页面和根文件完整；
- 当前 9 个真机证据域仍为 `pending`，不能由本地测试替代。

## 4. 解锁后的发布顺序

关闭微信开发者工具当前小程序窗口和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

随后只打开 `apps/miniprogram/dist/` 独立工程，普通编译并重新生成二维码。不能使用旧 `fcc6630e`、线上 `13f597e` 或其它候选的二维码和真机证据。
