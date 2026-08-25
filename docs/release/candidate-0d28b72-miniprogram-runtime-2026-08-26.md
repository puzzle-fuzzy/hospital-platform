# 小程序候选 `0d28b72` 运行包交接（2026-08-26）

> 本文记录就诊页业务日快照修正对应的 pending 运行包，不代表已替换微信开发者工具当前 live `dist`，也不代表已经完成真机业务验收。
> 旧 Python 服务、旧数据库、旧 Redis、线上服务和另一会话负责的众阳预约适配器均未修改。

## 1. 候选来源

| 项目 | 值 |
| --- | --- |
| 小程序提交 | `0d28b724` |
| 完整 sourceRevision | `0d28b7241f40de95f4049d7d2a18e07f6f162268` |
| 页面数 | 20 |
| 小程序回归 | 288 pass / 0 fail / 3225 expect() |
| 当前线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| pending 目录 | `.local/hospital-miniprogram/pending/` |

## 2. 本候选业务修正

就诊页的预约历史是一次 `scope=all` 只读快照，未来/历史标签和加载更多必须使用同一个中国标准时间业务日。此前首次加载固定了请求时间，但标签点击和加载更多会重新读取设备当前时间；页面跨过零点后，同一批服务端结果可能被重新分到不同标签。

本候选已完成：

- 在页面加载批次开始时固定 `requestNow` 和 `businessDate`；
- 将记录筛选窗口抽到 `consult-record-view`，统一处理 today、未来、历史、分批展开和空快照；
- 标签切换与加载更多只使用页面保存的业务日，不再隐式创建新的时间快照；
- 对跨零点、加载更多和空业务日增加中文注释与回归测试；
- 保持今日实时队列关闭，不把预约摘要伪装成叫号或就诊事实。

## 3. 构建与验证

已执行：

```powershell
pnpm --filter @hospital/miniprogram test
pnpm --filter @hospital/miniprogram typecheck
pnpm exec biome check apps/miniprogram/src/services/consult-record-view.ts apps/miniprogram/src/services/consult-record-view.test.ts apps/miniprogram/src/pages/consult/consult.ts
pnpm --filter @hospital/miniprogram build
pnpm --filter @hospital/miniprogram runtime:verify:pending
```

结果：

- 全量小程序测试 `288 pass / 0 fail / 3225 expect()`；
- 类型检查和 Biome 检查通过；
- 构建在原子替换 live `dist` 时遇到微信开发者工具文件锁并返回 `EBUSY`；
- 构建脚本保留了完整 pending 候选，没有清空旧 live `dist`；
- `runtime:verify:pending` 已确认 `0d28b72`、20 个页面和根文件完整；
- 当前 9 个真机证据域仍为 `pending`，不能由本地测试替代。

## 4. 解锁后的发布顺序

关闭微信开发者工具当前小程序窗口和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

随后只打开 `apps/miniprogram/dist/` 独立工程，普通编译并重新生成二维码。不能使用旧 `fcc6630e`、线上 `13f597e` 或其它候选的二维码和真机证据。
