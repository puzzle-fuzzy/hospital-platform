# 小程序历史 pending 运行包候选（87ad1092）

> 本候选已被 `dee4803f`、随后被 `ad7bd1f` 替代；当前真机验收只认 [`candidate-ad7bd1f-miniprogram-runtime-2026-08-26.md`](candidate-ad7bd1f-miniprogram-runtime-2026-08-26.md)。本文仅保留上一批电子锦旗、表扬信安全页面迁移证据。

> 本文记录电子锦旗、表扬信原生安全页面迁移后的运行包候选。它只证明源码、自动化测试和 pending 运行包来源，不代表已经发布到微信开发者工具、线上版本或完成真机业务验收。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `87ad1092e9b067454f85c06217b0c102b49c000c` |
| 短提交 | `87ad1092` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `303 pass / 0 fail / 3462 expect()` |
| 类型检查 | 通过 |
| 构建前置 | 通过；发布阶段因 `dist/` 被微信开发者工具锁定返回 `EBUSY` |
| 真机证据清单 | [`device-evidence-87ad109-pending.json`](device-evidence-87ad109-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；旧完整运行包保留 |
| 线上服务 | 未修改；旧 Python `8001` 继续共存 |

## 本批迁移内容

本批横向推进两个便民业务域：电子锦旗和表扬信。旧端分别存在列表、赠送/提交和记录详情页面；新端按业务域收口到两个原生页面，并迁移可确认的页面结构：

- 当前就诊人使用 owner-scoped 平台患者读模型，并支持统一就诊人选择；
- 列表/记录区域使用固定高度的本地空态插图，明确显示“公开记录暂未开放”；
- 患者读取失败显示顶部错误和显式重试，不把错误降级成“暂无记录”；
- 通过独立 `FeatureKey` 查看完整迁移状态；
- 不读取旧端患者/医生快照，不提交文字或文件，不显示提交成功。

“公开记录暂未开放”是服务能力关闭态，不是 Provider 返回的真实空列表。内容审核、文件安全、脱敏公开、幂等、撤回、分页和管理端读取仍等待独立 contract。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，再开始真机验收。不能使用 `34d86d9` 或更早候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- pending 校验不能证明微信真机已加载本候选；
- 锦旗/表扬信提交、内容审核、公开记录、支付、医保、预约写入、HIS 回写和其他 Provider 业务继续关闭。
