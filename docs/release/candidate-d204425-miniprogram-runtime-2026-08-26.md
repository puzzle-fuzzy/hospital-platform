# 小程序当前 pending 运行包候选（d204425）

> 本文只记录本次就诊页预约摘要边界修正的 pending 构建事实，不代表已经发布到微信开发者工具、微信线上版本或真实业务验收通过。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `d204425420ddc8633260053e32ff042e2b0635c7` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `298 pass / 0 fail / 3394 expect()` |
| 类型检查 | 通过 |
| pending 运行包校验 | `runtime:verify:pending` 通过 |
| live `dist` | 未替换；微信开发者工具占用目录，原子发布返回 `EBUSY` |
| 线上服务 | 未修改；仍为 `8eb51b5f`，旧 Python `8001` 继续共存 |

## 本候选业务修正

- “就诊”页的“今日就诊”现在展示同一中国标准时间业务日内已确认的预约摘要；
- 摘要只展示服务端已返回的预约事实，不推导叫号、排队、候诊或已经就诊；
- 今日、未来、历史三个窗口继续使用同一业务日快照和固定分批展开，避免跨零点时标签漂移；
- 实时就诊、队列和叫号仍等待独立 contract，不新增 WebSocket 或未知 Provider 字段。

## 全量边界

- 旧端 64 个入口继续保留明确落点、状态和 `FeatureKey` 记录；
- 四个主 Tab 继续只使用微信原生 `tabBar`；
- 健康自测 BMI/血压安全数值子集、临床/外部/预约 Provider 页面外壳仍按既有边界运行；
- 患者写入、协议同意、二维码、支付、医保、预约写入、取消和 HIS 回写继续保持关闭态。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后，执行：

```bash
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新核对 `dist/build-info.json.sourceRevision`，再开始真机验收；不能使用旧 live 包或历史候选的截图、日志和 requestId 作为本候选证据。
