# 小程序当前 pending 运行包候选（ad7bd1f）

> 本文记录患者协议原文安全入口补齐后的运行包候选。它只证明源码、自动化测试和 pending 运行包来源，不代表已经发布到微信开发者工具、线上版本或完成真机业务验收。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `ad7bd1f7148463be5b2f48e6b389108e7ce43531` |
| 短提交 | `ad7bd1f` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `307 pass / 0 fail / 3513 expect()` |
| 类型检查 | 通过 |
| 构建前置 | 通过；发布阶段因 `dist/` 被微信开发者工具锁定返回 `EBUSY` |
| 真机证据清单 | [`device-evidence-ad7bd1f-pending.json`](device-evidence-ad7bd1f-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；旧完整运行包保留 |
| 线上服务 | 未修改；旧 Python `8001` 继续共存 |

## 本批迁移内容

本批继续按广度优先补齐患者中心的静态入口：

- 患者绑定和签名页面都可以打开已经迁移的协议原文页；
- 页面文案明确“仅查看、不代表同意”，不会写入授权、绑定或签名结果；
- 共享患者页面工厂的新增 WXML 事件已纳入交互广度审计，避免复用页面漏报点击方法；
- 协议版本、同意、撤回和审计仍由独立患者 contract 控制，不读取 Provider 或旧缓存。

本批只补齐静态原文入口和审计门禁，不代表患者绑定、协议同意、签名上传或临床业务已经完成。支付、医保、预约写入和 HIS 回写继续关闭。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，再开始真机验收。不能使用 `dee4803f` 或更早候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- pending 校验不能证明微信真机已加载本候选；
- 协议同意、患者绑定、签名、临床 Provider、外部会话、支付、医保、HIS 回写和患者写入不能因为页面可打开而被标记为成功。
