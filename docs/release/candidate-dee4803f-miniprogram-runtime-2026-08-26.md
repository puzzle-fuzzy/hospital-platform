# 小程序历史 pending 运行包候选（dee4803f）

> 本候选已被 `ad7bd1f` 替代；当前真机验收只认 [`candidate-ad7bd1f-miniprogram-runtime-2026-08-26.md`](candidate-ad7bd1f-miniprogram-runtime-2026-08-26.md)。本文仅保留 `dee4803f` 的历史构建和迁移证据。

> 本文记录“我的问诊”当前就诊人上下文横向迁移后的运行包候选。它只证明源码、自动化测试和 pending 运行包来源，不代表已经发布到微信开发者工具、线上版本或完成真机业务验收。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `dee4803fb94ad50c59c9ef8fda996bc0f37427c6` |
| 短提交 | `dee4803f` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `307 pass / 0 fail / 3511 expect()` |
| 类型检查 | 通过 |
| 构建前置 | 通过；发布阶段因 `dist/` 被微信开发者工具锁定返回 `EBUSY` |
| 真机证据清单 | [`device-evidence-dee4803-pending.json`](device-evidence-dee4803-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；旧完整运行包保留 |
| 线上服务 | 未修改；旧 Python `8001` 继续共存 |

## 本批迁移内容

本批继续按广度优先补齐旧端“我的问诊”的患者作用域：

- 问诊入口显示当前登录 owner 的脱敏患者姓名和卡号；
- 点击当前患者进入统一选择页，返回后重新读取当前上下文；
- 患者读取中的、未选择、会话失效和暂时故障状态保持稳定布局，并提供明确重试；
- 页面卸载或请求代际变化时丢弃过期患者响应；
- 不打开问诊 Provider、外部 WebView、ticket、正文、附件或医生信息。

本批只修正页面作用域和入口交互，不代表问诊业务已经完成。问诊会话索引、患者归属、正文/附件白名单、短期引用、allowlist、退出、撤回和审计 contract 仍属于外部队列；支付、医保、预约写入和 HIS 回写继续关闭。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，再开始真机验收。不能使用 `c7db7f04` 或更早候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- pending 校验不能证明微信真机已加载本候选；
- 问诊、临床 Provider、外部会话、支付、医保、HIS 回写和患者写入不能因为页面显示当前患者而被标记为成功。
