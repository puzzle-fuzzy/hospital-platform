# 小程序候选 `5493659` 运行包交接（2026-08-26）

> 本文记录 B 批次健康百科状态逻辑修正对应的 pending 运行包，不代表健康内容已经发布，也不代表已替换微信开发者工具当前 live `dist`。

## 候选来源

| 项目 | 值 |
| --- | --- |
| 小程序提交 | `5493659e` |
| 完整 sourceRevision | `5493659ead8a70fcc9a2ad6ad4619a155b8a362a` |
| 页面数 | 20 |
| 小程序回归 | 291 pass / 0 fail / 3233 expect() |
| 当前线上服务端 | `8eb51b5ffe85b0b8f8a032783f893117d3df549d` |
| 当前 live `dist` | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b`，仍由微信开发者工具占用 |
| pending 目录 | `.local/hospital-miniprogram/pending/` |

## 本候选内容

健康百科三页继续保持只读和审核 fail-closed。本候选只修正分类 Tab 没有目录缓存时的请求来源：重新读取目录，不再把空标识传给关联查询并误显示“暂无内容”。正式审核 bundle、内容版本、撤回演练和真机证据仍未完成，不能把本候选标记为健康业务已发布。

## 构建结果

执行 `pnpm --filter @hospital/miniprogram build` 时类型检查通过；原子发布阶段因微信开发者工具锁定 `apps/miniprogram/dist/` 返回 `EBUSY`，候选已保留到 pending。`runtime:verify:pending` 已确认来源为 `5493659`、页面数为 20 且根文件齐全。

关闭开发者工具和真机调试会话后，再执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
```

发布后必须重新采集真机证据；旧 live `dist` 不能证明本候选已经加载。

## 未改变的边界

- 健康知识源快照仍为 `not-approved`，没有自制审核 bundle；
- 没有打开自测、风险评估、临床问卷、病历、住院或问诊；
- 没有修改旧 Python 服务、旧数据库、旧 Redis 或线上服务；
- 没有修改、暂存或部署 `packages/adapters/src/zhongyang-appointments.ts`；
- 9 个既有真机证据域仍为 `pending`。
