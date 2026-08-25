# 小程序候选 `2f4b136f`：广度入口覆盖与迁移状态页（2026-08-25）

> 本文记录的是已经完成 staging 校验、但尚未替换 live `dist/` 的候选。微信开发者工具当前占用 `apps/miniprogram/dist/`，原子发布因此被安全阻断；不能用本记录证明真机已经运行新候选。
> 本次没有修改旧 Python 服务、服务器配置、MySQL、Redis 或线上微信小程序。

## 1. 候选边界

| 项目 | 结果 |
| --- | --- |
| Git 提交 | `2f4b136f30b87d6eb0c9ec91915e2942d28118e0` |
| 已验证 staging | `.local/hospital-miniprogram/pending/` |
| 当前 live dist | `fcc6630ebfa7b0697cbd03a5e376ce6765d1643b` |
| 页面数量 | 17 |
| 小程序测试 | 249 pass / 0 fail / 2007 expect() |
| 类型检查 | 通过 |
| 发布结果 | staging 和页面门禁通过；替换 live 时收到 Windows `EBUSY`，pending 已保留 |

## 2. 本次迁移内容

新增统一迁移状态页和固定入口目录：

- 首页顶部快捷入口和服务分组的未完成项目不再保留空 action；
- “我的”中的问诊、医生、门诊病历、电子导诊单、智能客服和医保电子凭证点击后都有稳定页面；
- 住院、预问诊、随访、风险自评、健康自测、健康百科、锦旗和表扬信入口也统一收敛到状态页；
- 状态页不读取旧缓存、不调用未确认 provider、不跳转任意外部 URL、不发起支付；
- 预约、患者选择、报告、门诊费用、静态医院/院内导航等已迁移能力保持原有业务路由。

这是一层入口完整性迁移，不代表状态页列出的业务已经完成。真实 provider contract 到达后，按广度优先计划逐域替换状态页。

## 3. 发布边界

构建已在 staging 完成，但 `dist/` 被微信开发者工具锁定。关闭当前小程序窗口和真机调试会话后执行：

```powershell
pnpm --filter @hospital/miniprogram runtime:publish-pending
pnpm --filter @hospital/miniprogram runtime:verify
```

发布器会先保留旧 live 运行包，再原子替换；不要强制结束工具进程，也不要手工把测试脚本复制到 `dist/`。

## 4. 仍未完成的业务

真实预约写入/取消、患者新增绑定、二维码、门诊病历、住院查询与支付、微信支付、医保授权/结算/退款、HIS 写回、AI/导诊、健康内容与风险评估仍按各自 contract 处理，不能从本候选的页面存在推断为完成。
