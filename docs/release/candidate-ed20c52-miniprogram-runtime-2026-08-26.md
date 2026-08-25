# 小程序当前 pending 运行包候选（ed20c52）

> 本文是 2026-08-26 横向迁移批次的当前运行包事实源。它记录的是源码提交、pending 构建和可验证的自动化结果，不代表已经发布到微信开发者工具、微信线上版本或真实业务验收通过。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `ed20c525de0f0ae0ed3b047b95b7365b39c4dec9` |
| 短提交 | `ed20c52` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `299 pass / 0 fail / 3407 expect()` |
| 类型检查 | 通过 |
| pending 运行包校验 | `runtime:verify:pending` 通过 |
| 真机证据清单 | [`device-evidence-ed20c52-pending.json`](device-evidence-ed20c52-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；微信开发者工具占用目录，原子发布安全返回 `EBUSY` |
| 线上服务 | 未修改；仍为 `8eb51b5f`，旧 Python `8001` 继续共存 |

## 本批横向迁移内容

旧端“我的快递”页面的实际实现只有患者选择器和一个始终为空的预留列表，没有物流 provider 请求、物流单号、物流状态或患者归属字段。本批已经迁移为原生 TypeScript 页面：

- 保留当前就诊人展示和跳转选择其他就诊人的入口；
- 保留加载、错误、重试、返回“我的”和迁移状态说明；
- 保留旧端空列表语义，并使用本地空态图标；
- 明确提示旧端当前没有接入物流记录服务；
- 不凭空生成物流记录，也不把未知字段命名为 `providerPatientId` 或其他 provider 身份。

因此该页面仍登记为 `surface-only`，这表示“旧端真实可见行为已迁移，但真实物流业务 contract 尚未开放”，不是把页面标记为已完成物流业务。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后，执行：

```bash
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新核对 `dist/build-info.json.sourceRevision`，再开始真机验收。不能使用旧 live 包或 `d204425` 历史候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或另一会话负责的众阳预约适配器；
- `pending` 校验只能证明运行包文件完整和来源指纹正确，不能证明微信真机已经加载本候选；
- 9 个真实业务证据域仍需绑定当前候选、客户端 requestId、服务端 Pino 日志和 provider 低敏 requestId；
- 支付、医保、预约写入、HIS 回写、真实物流 provider 和其他 contract-blocked 业务继续关闭。
