# 小程序历史 pending 运行包候选（34d86d9）

> 本候选已被 `dee4803f` 替代；当前真机验收只认 [`candidate-dee4803f-miniprogram-runtime-2026-08-26.md`](candidate-dee4803f-miniprogram-runtime-2026-08-26.md)。

> 本文记录采血预约原生空态迁移后的运行包候选。它只证明源码、自动化测试和 pending 运行包来源，不代表已经发布到微信开发者工具、线上版本或完成真机业务验收。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `34d86d918ecaf09d0adec9a6a5cf3e225add0722` |
| 短提交 | `34d86d9` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `302 pass / 0 fail / 3450 expect()` |
| 类型检查 | 通过 |
| 构建前置 | 通过；发布阶段因 `dist/` 被微信开发者工具锁定返回 `EBUSY` |
| 真机证据清单 | [`device-evidence-34d86d9-pending.json`](device-evidence-34d86d9-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；旧完整运行包保留 |
| 线上服务 | 未修改；旧 Python `8001` 继续共存 |

## 本批迁移内容

旧端 `pagesB/hospital/bloodAppointment.vue` 没有采血号源请求，患者姓名/年龄和院区文字是硬编码，项目列表始终为空。本批按事实迁移：

- 当前就诊人改为 owner-scoped 平台患者读模型；
- 保留患者区域、院区区域和白色空态卡片的视觉层级；
- 院区位置保留为关闭态，不把旧端硬编码院区当作动态当前院区；
- 使用本地空态资源展示“无可预约项目！”；
- 支持统一就诊人选择、顶部错误、重试、迁移说明和返回医疗服务；
- 不复用普通门诊号源，不创建采血预约，不显示成功或取消结果。

因此台账仍为 `surface-only`：旧端可观察行为已迁移，但采血号源、患者映射、预约写入、取消和最终查询 contract 尚未开放。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，再开始真机验收。不能使用 `c7220d7` 或更早候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- pending 校验不能证明微信真机已加载本候选；
- 采血预约仍为关闭态，支付、医保、预约写入、HIS 回写和其他 Provider 业务继续关闭。
