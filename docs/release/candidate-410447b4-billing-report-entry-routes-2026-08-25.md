# 小程序候选：费用与报告二级入口状态路由（2026-08-25）

> 候选来源：`410447b4ee7f19413fb3b3c790c52d51f5806ccb`。
> 本记录只描述新项目的本地候选构建，不代表微信开发者工具、真机或线上小程序已经切换。

## 1. 候选状态

| 项目 | 结果 |
| --- | --- |
| 源码提交 | `410447b4ee7f19413fb3b3c790c52d51f5806ccb` |
| 候选目录 | `.local/hospital-miniprogram/pending/` |
| 运行包页面数 | 17 |
| 候选生成时间 | `2026-08-25T04:01:18.509Z` |
| 当前 live 运行包 | `apps/miniprogram/dist/` 仍为 `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 原子发布 | 未完成；微信开发者工具占用 `dist/`，发布器收到 Windows `EBUSY` |

类型检查和 staging 构建已完成。发布器先保留了旧 live 运行包，再把新候选留在 pending，未清空或半替换
`apps/miniprogram/dist/`。旧运行包因此仍可继续用于当前开发者工具会话，但不能用于验收本候选的新增行为。

## 2. 本轮迁移内容

### 2.1 门诊缴费

- 待缴记录点击固定进入 `outpatient-payment-write` 状态页；不创建订单、不调起微信支付、不触发医保授权。
- 已缴记录点击固定进入 `outpatient-payment-detail` 状态页；不把已缴记录误导成待支付。
- 状态目录写明账单引用、患者归属、金额单位、订单状态机、查单和结算回写仍需独立 contract。

### 2.2 报告目录

- 报告缺少安全详情引用时固定进入 `report-detail` 状态页，不再只显示一次性 Toast。
- 状态目录写明来源详情合同、患者归属、脱敏字段和资源授权仍未完成。
- 没有打开报告详情 gate，也没有把 provider 引用、临床正文或附件地址交给小程序。

### 2.3 验收保护

- 统一状态导航使用固定 `FeatureKey`，不接受旧端 URL、provider ID 或任意 query。
- 验收测试覆盖费用读写入口键、报告详情入口键及旧迁移 Toast 的移除。
- 本轮没有修改旧 Python 项目、旧服务、数据库、Redis 或服务器配置。

## 3. 自动化结果

```text
pnpm --filter @hospital/miniprogram typecheck 通过
pnpm --filter @hospital/miniprogram test 通过
250 pass / 0 fail / 2039 expect() calls
```

`pnpm --filter @hospital/miniprogram build` 的 TypeScript 检查和候选 staging 通过；最后替换 live 目录时因
微信开发者工具仍持有 `apps/miniprogram/dist/` 文件锁而安全失败。该失败是可恢复的发布阻塞，不是业务构建失败。

## 4. 发布与验收顺序

关闭微信开发者工具和真机调试会话后，在仓库根目录执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布后必须重新打开 `apps/miniprogram/dist/` 独立工程并生成新的二维码，不能用旧 `fcc6630e` 运行包证明本候选。
真机只做门诊费用只读、报告关闭态和入口导航验收；真实支付、医保、二维码、患者绑定和 HIS 回写仍保持关闭。

## 5. 下一批广度迁移

入口完整性已进一步收口，但业务完成度仍按业务域推进：先采集患者、预约历史/爽约、门诊费用和普通资料的真实只读
三层证据，再批量补齐病历、健康内容、互联网医院和其他低风险目录；患者新增绑定、二维码、预约写入、支付、医保和
HIS 回写继续最后单独冻结 contract。任何没有 provider 字段白名单、owner 映射、权限和回滚证据的能力不提前开放。
