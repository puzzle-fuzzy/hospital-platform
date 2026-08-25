# 小程序当前 pending 运行包候选（e01796d）

> 本文只记录本地 pending 构建事实，不代表已经发布到微信开发者工具、微信线上版本或真实业务验收通过。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `e01796d9b22d92cba4cb8492835f18d0323bb5c9` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `297 pass / 0 fail / 3390 expect()` |
| 类型检查 | 通过 |
| pending 运行包校验 | `runtime:verify:pending` 通过 |
| live `dist` | 未替换；微信开发者工具占用目录，原子发布返回 `EBUSY` |
| 线上服务 | 未修改；仍为 `8eb51b5f`，旧 Python `8001` 继续共存 |

## 本候选覆盖

- 旧端 64 个入口全部保留明确落点、状态和 `FeatureKey` 记录；
- 四个主 Tab 继续只使用微信原生 `tabBar`；
- 健康自测加入不产生临床结论的 BMI 公式和血压读数安全数值子集；
- 临床、外部入口、预约 Provider、患者写入、协议同意、二维码、支付和医保继续保持关闭态；
- 通过页面事件、迁移台账、边界、日志和中文注释门禁。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后，执行：

```bash
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新核对 `dist/build-info.json.sourceRevision`，再开始真机验收；不能使用旧 live 包或历史候选的截图、日志和 requestId 作为本候选证据。

