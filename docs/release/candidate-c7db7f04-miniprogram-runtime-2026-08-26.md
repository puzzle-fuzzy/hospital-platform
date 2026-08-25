# 小程序历史 pending 运行包候选（c7db7f04）

> 本候选已被 `dee4803f`、随后被 `ad7bd1f` 替代；当前真机验收只认 [`candidate-ad7bd1f-miniprogram-runtime-2026-08-26.md`](candidate-ad7bd1f-miniprogram-runtime-2026-08-26.md)。本文保留上一批“当前就诊人上下文”迁移证据。

> 本文记录“当前就诊人上下文”横向迁移后的运行包候选。它只证明源码、自动化测试和 pending 运行包来源，不代表已经发布到微信开发者工具、线上版本或完成真机业务验收。

## 当前事实

| 项目 | 结果 |
| --- | --- |
| 功能提交 | `c7db7f04a0dee5a8aad6ba149f17bd413b0d1d5d` |
| 短提交 | `c7db7f04` |
| 构建输出 | `.local/hospital-miniprogram/pending/` |
| 页面数量 | 40 |
| 小程序测试 | `307 pass / 0 fail / 3501 expect()` |
| 类型检查 | 通过 |
| 构建前置 | 通过；发布阶段因 `dist/` 被微信开发者工具锁定返回 `EBUSY` |
| 真机证据清单 | [`device-evidence-c7db7f0-pending.json`](device-evidence-c7db7f0-pending.json)，9 个域均为 `pending` |
| live `dist` | 未替换；旧完整运行包保留 |
| 线上服务 | 未修改；旧 Python `8001` 继续共存 |

## 本批迁移内容

本批按广度优先把多个临床/服务入口统一到同一个当前就诊人上下文：

- 临床内容入口（入院预问诊、出院随访、预问诊、风险评估）统一读取 owner-scoped 当前患者；
- 临床入口（门诊病历、住院中心、我的医生、电子问诊）统一展示当前患者卡片，并支持进入选择页；
- 预约详情入口统一使用相同的当前患者卡片和重试语义；
- 患者上下文只投影脱敏姓名和卡号，不展示内部患者 ID，不触发 Provider 同步或业务写入；
- 页面返回或选择其他患者后，会重新加载当前上下文；页面卸载和请求代际变化时丢弃过期响应；
- 加载、未选择、临时失败和依赖未开放保持稳定的卡片高度，错误提供显式重试，不把错误降级成空列表。

这批代码解决的是跨页面患者归属和交互一致性，不代表门诊病历、住院、医生关系、电子问诊或预约详情的真实 Provider 已开放。相关临床字段白名单、授权说明、脱敏样例和 Provider requestId 仍需独立 contract；支付、医保、预约写入、HIS 回写和外部会话继续关闭。

## 发布前置

关闭占用 `apps/miniprogram/dist/` 的微信开发者工具和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须核对 `dist/build-info.json.sourceRevision` 等于完整来源 SHA，再开始真机验收。不能使用 `87ad1092` 或更早候选的截图、日志和 requestId 作为本候选证据。

## 证据边界

- 本批没有修改旧 Python 服务、旧数据库、旧 Redis、线上进程或众阳预约适配器；
- pending 校验不能证明微信真机已加载本候选；
- 患者读取失败、临床 Provider、预约详情、支付、医保、HIS 回写和外部能力不能因为页面已显示当前患者而被标记为成功。
